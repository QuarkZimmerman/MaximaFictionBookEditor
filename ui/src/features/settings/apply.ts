/**
 * Settings application (T133). What happens once settings are known or change:
 *
 *  - **Body editor look** (Settings > View > Body): the CSS variables of `app/layout.css`
 *    (`--mfbe-body-font-family`, `--mfbe-body-font-size`, `--mfbe-body-fg`, `--mfbe-body-bg`)
 *    are written on `<html>` so `editor/styles.css` repaints the Body view live. The text and
 *    background colours are written only when they differ from the defaults (black on white):
 *    the defaults mean "the colours of the theme", so a dark theme gets its own Body palette
 *    unless the user chose explicit colours. The XML source options and font are applied by the
 *    Source view itself (`views/source`), the NBSP display character by the Body view, Fast
 *    mode and the toolbar/tree flags by `actions.setSettings`, the spelling toggles by the spell
 *    feature - all of them read `store.settings`, so a `settings.changed` notification (handled
 *    in App.tsx) is enough.
 *  - **Theme** (Settings > View > Theme): `view.theme` (system / light / dark) goes to
 *    `app/theme.ts`, which writes `data-theme` on `<html>` and follows the OS preference while
 *    the setting is "system". Before the settings are known the mirrored setting of the previous
 *    session applies.
 *  - **Interface language**: a run-time change of `view.uiLanguage` switches i18next (menus
 *    re-render) unless the shell forced a language with `?lang=`; the core additionally
 *    reports `restartRequired` for language changes, which the Settings dialog turns into the
 *    original "In order to process changes the program must be restarted. Restart now?"
 *    prompt (Yes restarts the editor through `app.restart` - the shell starts it again with
 *    the same document and window - or reloads the page in browser mode; feature 003 US3).
 *  - **Session**: toolbar visibility and the document tree flag are written back to
 *    `session.*` through `settings.set` (debounced). The Find/Replace histories are persisted
 *    by the search feature itself. The window placement (`session.windowGeometry`) is the
 *    shell's: it records the native window's bounds and maximised state at quit and before a
 *    restart and applies them at window creation (feature 003 US3); browser mode has no native
 *    window, so the UI writes nothing there.
 *  - **Hotkeys**: the user overrides are loaded from `hotkeys.get` when the feature is attached
 *    to the RPC client and written with `hotkeys.set` by the Hotkeys page. A core without the
 *    `hotkeys.*` methods (-32601) keeps the bindings for the session only.
 *
 * `SettingsFeature.attach(rpc)` needs the RPC client, which feature registrars do not receive;
 * the commands of this feature attach lazily when they run, and `App.tsx` may call
 * `getSettingsFeature(store)?.attach(rpc)` once connected so the hotkeys and the session
 * persistence are active from start-up.
 */

import type { CommandRegistry } from '@/app/commands';
import type { HotkeyMap } from '@/app/hotkeys';
import type { FeatureContext } from '@/app/services';
import { forcedLanguage } from '@/app/startup';
import { DEFAULT_THEME_SETTING, applyTheme, isThemeSetting, storedThemeSetting } from '@/app/theme';
import i18next, { changeLanguage, resolveUiLanguage } from '@/i18n';
import { actions, type AppStore } from '@/model/store';
import { RpcError, type RpcClient } from '@/rpc/client';
import {
  RpcErrorCode,
  type DeepPartial,
  type HotkeyBinding,
  type Settings,
  type ThemeSetting,
  type ToolbarVisibility,
} from '@/rpc/types';

/* ------------------------------------------------------------------------ */
/* CSS variables                                                            */
/* ------------------------------------------------------------------------ */

/** Variables of `app/layout.css` driven by Settings > View > Body. */
export const BODY_CSS_VARIABLES = {
  fontFamily: '--mfbe-body-font-family',
  fontSize: '--mfbe-body-font-size',
  textColor: '--mfbe-body-fg',
  background: '--mfbe-body-bg',
} as const;

/**
 * Default Body colours (resource-formats.md §6). They stand for "the colours of the theme": the
 * stylesheet palette applies unless the user picked something else.
 */
export const BODY_DEFAULT_COLORS = { textColor: '#000000', background: '#ffffff' } as const;

/** True when `value` is the default colour (case-insensitive), i.e. no user override. */
export function isDefaultBodyColor(value: string, fallback: string): boolean {
  return value.trim().toLowerCase() === fallback;
}

/** The colour to write as an override, or null when the theme palette should apply. */
function bodyColorOverride(value: string, fallback: string): string | null {
  return isCssColor(value) && !isDefaultBodyColor(value, fallback) ? value : null;
}

/** CSS variable values for `settings` (`null` = remove the override, keep the stylesheet default). */
export function bodyCssVariables(settings: Settings | null): Record<string, string | null> {
  const view = settings?.view;
  if (!view) {
    return {
      [BODY_CSS_VARIABLES.fontFamily]: null,
      [BODY_CSS_VARIABLES.fontSize]: null,
      [BODY_CSS_VARIABLES.textColor]: null,
      [BODY_CSS_VARIABLES.background]: null,
    };
  }
  const family = (view.bodyFont ?? '').trim();
  const size = view.bodyFontSize;
  const fg = view.bodyTextColor ?? '';
  const bg = view.bodyBackground ?? '';
  return {
    [BODY_CSS_VARIABLES.fontFamily]: family ? quoteFontFamily(family) : null,
    [BODY_CSS_VARIABLES.fontSize]:
      typeof size === 'number' && Number.isFinite(size) && size > 0 ? `${size}px` : null,
    [BODY_CSS_VARIABLES.textColor]: bodyColorOverride(fg, BODY_DEFAULT_COLORS.textColor),
    [BODY_CSS_VARIABLES.background]: bodyColorOverride(bg, BODY_DEFAULT_COLORS.background),
  };
}

/**
 * The theme setting to apply for `settings`: `view.theme` when the core knows it, `system` for
 * an older core, and the mirrored setting of the previous session while the settings are not
 * known yet (start-up before `settings.get`).
 */
export function themeSettingOf(settings: Settings | null): ThemeSetting {
  if (!settings) return storedThemeSetting();
  const theme = settings.view?.theme;
  return isThemeSetting(theme) ? theme : DEFAULT_THEME_SETTING;
}

/** Writes the Body variables on `root` (`<html>` by default). */
export function applyBodyCssVariables(
  settings: Settings | null,
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null,
): void {
  if (!root) return;
  for (const [name, value] of Object.entries(bodyCssVariables(settings))) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
}

/** `Georgia, serif` stays, a bare family with spaces gets quotes (`'Noto Serif'`). */
export function quoteFontFamily(family: string): string {
  return family
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      /^["']/.test(part) || !/\s/.test(part) || /^[a-z-]+$/i.test(part)
        ? part
        : `'${part.replace(/'/g, "\\'")}'`,
    )
    .join(', ');
}

export function isCssColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

/* ------------------------------------------------------------------------ */
/* Patches                                                                  */
/* ------------------------------------------------------------------------ */

export function cloneSettings(settings: Settings): Settings {
  return JSON.parse(JSON.stringify(settings)) as Settings;
}

const PATCH_SECTIONS = ['view', 'other', 'words'] as const;

/**
 * The `settings.set` patch turning `before` into `after`: only the changed leaves of the
 * `view`, `other` and `words` sections (the dialog never edits `session`). Returns an empty
 * object when nothing changed.
 */
export function settingsPatch(before: Settings, after: Settings): DeepPartial<Settings> {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const section of PATCH_SECTIONS) {
    const a = before[section] as unknown as Record<string, unknown>;
    const b = after[section] as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!Object.is(a[key], b[key])) {
        (patch[section] ??= {})[key] = b[key];
      }
    }
  }
  return patch as DeepPartial<Settings>;
}

export function isEmptyPatch(patch: DeepPartial<Settings>): boolean {
  return Object.keys(patch).length === 0;
}

/* ------------------------------------------------------------------------ */
/* Hotkeys persistence                                                      */
/* ------------------------------------------------------------------------ */

/** Accepts both the contract shape (`commandId`) and the `hotkeys.json` shape (`command`). */
export function normalizeHotkeyBindings(raw: unknown): Pick<HotkeyBinding, 'commandId' | 'keys'>[] {
  if (!Array.isArray(raw)) return [];
  const out: Pick<HotkeyBinding, 'commandId' | 'keys'>[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as { commandId?: unknown; command?: unknown; keys?: unknown };
    const commandId =
      typeof record.commandId === 'string'
        ? record.commandId
        : typeof record.command === 'string'
          ? record.command
          : null;
    if (!commandId || typeof record.keys !== 'string') continue;
    out.push({ commandId, keys: record.keys });
  }
  return out;
}

function isMethodNotFound(error: unknown): boolean {
  return error instanceof RpcError && error.code === RpcErrorCode.methodNotFound;
}

/** Loads the user overrides into `hotkeys`; false when the core has no `hotkeys.get`. */
export async function loadUserHotkeys(rpc: RpcClient, hotkeys: HotkeyMap): Promise<boolean> {
  try {
    const bindings = normalizeHotkeyBindings(await rpc.call('hotkeys.get'));
    hotkeys.setUserBindings(bindings);
    return true;
  } catch (error) {
    if (!isMethodNotFound(error)) {
      // Transient failure (not connected...): the defaults stay in effect.
    }
    return false;
  }
}

/** Persists the user overrides; false when the core cannot store them. */
export async function saveUserHotkeys(rpc: RpcClient, hotkeys: HotkeyMap): Promise<boolean> {
  try {
    await rpc.call('hotkeys.set', { bindings: hotkeys.userBindings() });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------ */
/* Feature runtime                                                          */
/* ------------------------------------------------------------------------ */

function sameToolbars(a: ToolbarVisibility, b: ToolbarVisibility): boolean {
  return (Object.keys(a) as (keyof ToolbarVisibility)[]).every((key) => a[key] === b[key]);
}

const SESSION_SAVE_DELAY_MS = 250;

export interface SettingsFeatureOptions {
  /** `<html>` replacement for tests. */
  root?: HTMLElement | null;
  /** `window` replacement for tests (its `location.search` is the `?lang=` override). */
  window?: Window | null;
  /** Page query string for the `?lang=` override (defaults to `window.location.search`). */
  search?: string;
}

export class SettingsFeature {
  readonly store: AppStore;
  readonly hotkeys: HotkeyMap;
  /** The command registry (Hotkeys page); null in minimal test set-ups. */
  readonly commands: CommandRegistry | null;
  private rpcClient: RpcClient | null = null;
  private attachPromise: Promise<void> | null = null;
  private readonly root: HTMLElement | null;
  private readonly win: Window | null;
  private readonly search: string | undefined;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** True once `hotkeys.get` answered (or the core proved it has no hotkeys store). */
  hotkeysLoaded = false;
  hotkeysPersisted = false;

  constructor(
    ctx: Pick<FeatureContext, 'store' | 'hotkeys'> & Partial<Pick<FeatureContext, 'commands'>>,
    options: SettingsFeatureOptions = {},
  ) {
    this.store = ctx.store;
    this.hotkeys = ctx.hotkeys;
    this.commands = ctx.commands ?? null;
    this.root =
      options.root !== undefined
        ? options.root
        : typeof document !== 'undefined'
          ? document.documentElement
          : null;
    this.win =
      options.window !== undefined ? options.window : typeof window !== 'undefined' ? window : null;
    this.search = options.search;
  }

  get rpc(): RpcClient | null {
    return this.rpcClient;
  }

  /** Starts following the store: CSS variables, theme, run-time language switch, session saving. */
  install(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    const initial = this.store.getState().settings;
    applyBodyCssVariables(initial, this.root);
    applyTheme(themeSettingOf(initial), { root: this.root });
    const offStore = this.store.subscribe((state, previous) => {
      if (state.settings !== previous.settings) {
        applyBodyCssVariables(state.settings, this.root);
        applyTheme(themeSettingOf(state.settings), { root: this.root });
        this.syncLanguage(previous.settings, state.settings);
      }
      if (
        state.settings &&
        (state.toolbars !== previous.toolbars || state.treeVisible !== previous.treeVisible)
      ) {
        this.scheduleSessionSave();
      }
    });
    this.unsubscribe = () => {
      offStore();
      if (this.sessionTimer) clearTimeout(this.sessionTimer);
      this.unsubscribe = null;
    };
    return this.unsubscribe;
  }

  /**
   * Binds the feature to the RPC client (idempotent): loads the user hotkeys and enables the
   * session persistence. Safe to call from every command run.
   */
  attach(rpc: RpcClient | null): Promise<void> {
    if (!rpc) return Promise.resolve();
    if (this.rpcClient === rpc && this.attachPromise) return this.attachPromise;
    this.rpcClient = rpc;
    this.attachPromise = loadUserHotkeys(rpc, this.hotkeys).then((loaded) => {
      this.hotkeysLoaded = true;
      this.hotkeysPersisted = loaded;
    });
    return this.attachPromise;
  }

  /** Writes the user hotkey overrides to the core; remembers whether the core stores them. */
  async persistHotkeys(): Promise<boolean> {
    if (!this.rpcClient) return false;
    this.hotkeysPersisted = await saveUserHotkeys(this.rpcClient, this.hotkeys);
    return this.hotkeysPersisted;
  }

  /* ------------------------------------------------------------ language */

  private syncLanguage(previous: Settings | null, next: Settings | null): void {
    // The initial load is handled by App.tsx (which also honours `?lang=`). Partial settings
    // objects (tests, older cores) are tolerated.
    const before = previous?.view?.uiLanguage;
    const after = next?.view?.uiLanguage;
    if (!before || !after || before === after) return;
    const search = this.search ?? (this.win ? this.win.location.search : '');
    if (forcedLanguage(search)) return;
    const language = resolveUiLanguage(after);
    actions.setUiLanguage(this.store, language);
    if (i18next.isInitialized) {
      changeLanguage(language, i18next).catch(() => {
        // the catalogue of a supported language is bundled; nothing sensible to do otherwise
      });
    }
  }

  /* ------------------------------------------------------------- session */

  private scheduleSessionSave(): void {
    if (!this.rpcClient) return;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      void this.saveSession();
    }, SESSION_SAVE_DELAY_MS);
  }

  /** Persists toolbar/tree visibility when they differ from the stored session. */
  async saveSession(): Promise<boolean> {
    const rpc = this.rpcClient;
    const state = this.store.getState();
    const session = state.settings?.session;
    if (!rpc || !session) return false;
    const patch: DeepPartial<Settings['session']> = {};
    if (!session.toolbars || !sameToolbars(session.toolbars, state.toolbars)) {
      patch.toolbars = { ...state.toolbars };
    }
    if (session.treeVisible !== state.treeVisible) patch.treeVisible = state.treeVisible;
    if (Object.keys(patch).length === 0) return false;
    try {
      const result = await rpc.call('settings.set', { patch: { session: patch } });
      // Only the settings snapshot: the toolbar flags the user may have toggled meanwhile stay.
      this.store.setState({ settings: result.settings });
      return true;
    } catch {
      return false; // the session flags are a convenience
    }
  }
}

const features = new WeakMap<AppStore, SettingsFeature>();

export function registerSettingsRuntime(
  ctx: Pick<FeatureContext, 'store' | 'hotkeys'> & Partial<Pick<FeatureContext, 'commands'>>,
  options?: SettingsFeatureOptions,
): SettingsFeature {
  let feature = features.get(ctx.store);
  if (!feature) {
    feature = new SettingsFeature(ctx, options);
    feature.install();
    features.set(ctx.store, feature);
  }
  return feature;
}

/** The settings runtime of a store (undefined before the feature registered). */
export function getSettingsFeature(store: AppStore): SettingsFeature | undefined {
  return features.get(store);
}
