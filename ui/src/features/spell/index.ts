/**
 * Spell checking feature registrar (US6, T088/T089, FR-070..FR-072).
 *
 *  - `SpellFeature` (one per store): the `SpellSession` (data-model.md §2.4), the RPC-backed
 *    `SpellChecker` (batched `spell.check`, per-word cache, suggestions, custom dictionary) and
 *    the ProseMirror plugin host (`editor/plugins/spellcheck.ts`) driven by the settings
 *    `view.spellEnabled` / `view.spellHighlight` and the document language;
 *  - `tools.spellcheck` (F7) opens the Spelling dialog, `tools.spellHighlight` (Shift+F7)
 *    toggles `view.spellHighlight` through `settings.set`;
 *  - the Body context menu `spelling` slot: up to 10 suggestions (each replaces the word as one
 *    undo step), "Ignore all" (session) and "Add to dictionary" (`spell.addWord` + re-check);
 *  - error 1020 (no dictionary for the language) is reported once in the status bar.
 *
 * Plugin installation: `getSpellPlugin(store)` is meant for the Body controller's plugin list
 * (`createBodyEditorState(doc, {plugins: [...]})`). Until that hook exists the feature installs
 * the plugin itself by reconfiguring the mounted editor state (`EditorState.reconfigure` keeps
 * the history and the other plugins) whenever the controller shows a state without it.
 *
 * RPC access: the feature context carries no RPC client, so the client is picked up from the
 * command contexts that evaluate the Tools commands (toolbar button `tools.spellcheck`) and
 * from the dialog.
 */

import { createElement } from 'react';

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { TextSelection, type Plugin } from 'prosemirror-state';

import { SpellingDialog } from '@/dialogs/SpellingDialog';
import { fb2Schema } from '@/editor/schema';
import {
  blockTokens,
  misspelledDecorations,
  spellcheckPlugin,
  spellPluginKey,
  type SpellHostEvent,
  type SpellPluginHost,
} from '@/editor/plugins/spellcheck';
import { actions, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import type { SpellDictionaryReport } from '@/rpc/types';
import {
  getBodyController,
  hasBodyController,
  type BodyEditorController,
} from '@/views/body/bodyEditor';
import {
  registerContextMenuExtension,
  type ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

import { SpellChecker } from './checker';
import { SpellSession } from './session';
import { tokenAt } from './tokenizer';

import '@/dialogs/spelling.css';

export const MAX_MENU_SUGGESTIONS = 10;

export class SpellFeature {
  readonly session = new SpellSession();
  readonly checker: SpellChecker;
  private rpcValue: RpcClient | null = null;
  private pluginValue: Plugin | null = null;
  private readonly hostListeners = new Set<(event: SpellHostEvent) => void>();
  private translate: ((key: string, params?: Record<string, unknown>) => string) | null = null;
  private lastLanguage: string | null = null;
  private installed = false;
  /** Last pointer position of a context-menu request inside the Body editor. */
  private lastContextMenu: { x: number; y: number; time: number } | null = null;

  constructor(readonly store: AppStore) {
    this.checker = new SpellChecker({
      store,
      session: this.session,
      getRpc: () => this.rpcValue,
      onUnavailable: (lang) => this.reportUnavailable(lang),
    });
    this.checker.subscribe((event) => {
      // The plugin re-checks on verdicts and invalidations; a new report alone (same
      // dictionaries) changes nothing in the document.
      if (event !== 'report') this.notifyHost(event);
    });
    store.subscribe((state, previous) => {
      if (state.docId !== previous.docId) {
        this.session.reset();
        this.lastLanguage = null;
        this.notifyHost('invalidate');
      }
      const language = state.document?.description.titleInfo.lang ?? '';
      if (language !== this.lastLanguage) {
        this.lastLanguage = language;
        if (!this.session.languageOverride) this.notifyHost('invalidate');
      }
      if (state.settings !== previous.settings || state.connection !== previous.connection) {
        this.notifyHost('invalidate');
      }
    });
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'contextmenu',
        (event) => {
          this.lastContextMenu = { x: event.clientX, y: event.clientY, time: Date.now() };
        },
        true,
      );
    }
  }

  /* -------------------------------------------------------------- wiring */

  get rpc(): RpcClient | null {
    return this.rpcValue;
  }

  /** Remembers the RPC client (from a command context or the dialog). */
  attachRpc(rpc: RpcClient | null): void {
    if (!rpc || rpc === this.rpcValue) return;
    this.rpcValue = rpc;
    void this.checker.loadDictionaries();
    this.notifyHost('invalidate');
  }

  /**
   * Re-reads the dictionary report after Settings were applied or the Settings page asked for
   * it (feature 003 US4): the core rescans the dictionaries folders, the checker forgets its
   * verdicts when the set of dictionaries changed. See `SpellChecker.refreshDictionaries`.
   */
  refreshDictionaries(
    rpc: RpcClient | null = this.rpcValue,
  ): Promise<SpellDictionaryReport | null> {
    this.attachRpc(rpc);
    return this.checker.refreshDictionaries();
  }

  setTranslate(translate: (key: string, params?: Record<string, unknown>) => string): void {
    this.translate = translate;
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate ? this.translate(key, params) : key;
  }

  private reportUnavailable(lang: string): void {
    actions.setStatusMessage(this.store, this.t('spell.status.noDictionary', { lang }));
  }

  /* ------------------------------------------------------------ settings */

  /** Settings `view.spellEnabled` (default true without settings). */
  get enabled(): boolean {
    return this.store.getState().settings?.view.spellEnabled ?? true;
  }

  /** Settings `view.spellHighlight` (default true without settings). */
  get highlight(): boolean {
    return this.store.getState().settings?.view.spellHighlight ?? true;
  }

  /* -------------------------------------------------------------- plugin */

  private notifyHost(event: SpellHostEvent): void {
    for (const listener of [...this.hostListeners]) listener(event);
  }

  readonly host: SpellPluginHost = {
    highlightEnabled: () => this.enabled && this.highlight && this.checker.available,
    lookup: (check) => this.checker.lookup(check),
    check: (checks) => this.checker.check(checks),
    subscribe: (listener) => {
      this.hostListeners.add(listener);
      return () => {
        this.hostListeners.delete(listener);
      };
    },
  };

  /** The ProseMirror plugin of this store (created once). */
  get plugin(): Plugin {
    if (!this.pluginValue) this.pluginValue = spellcheckPlugin(this.host);
    return this.pluginValue;
  }

  /**
   * Fallback installation: adds the plugin to the Body editor state whenever the controller
   * shows a state that lacks it (initial mount, window rebuild). No-op once the controller
   * receives the plugin through its own plugin option.
   */
  installInto(controller: BodyEditorController): void {
    if (this.installed) return;
    this.installed = true;
    const ensure = () => {
      const view = controller.editorView;
      if (!view) return;
      if (spellPluginKey.getState(view.state) !== undefined) return;
      view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, this.plugin] }));
    };
    controller.subscribeContext(ensure);
    controller.subscribe(ensure);
    ensure();
  }

  /* --------------------------------------------------------- context menu */

  /** Word under the pointer of the last context-menu request (or the caret) with its range. */
  wordAtContextMenu(controller: BodyEditorController) {
    const state = controller.editorState;
    if (!state) return null;
    let pos = state.selection.head;
    const view = controller.editorView;
    const recent = this.lastContextMenu && Date.now() - this.lastContextMenu.time < 2000;
    if (view && recent && this.lastContextMenu) {
      const at = view.posAtCoords({ left: this.lastContextMenu.x, top: this.lastContextMenu.y });
      if (at) pos = at.pos;
    }
    const $pos = state.doc.resolve(pos);
    const block = $pos.parent;
    if (!block.isTextblock) return null;
    const token = tokenAt(blockTokens(block), $pos.parentOffset);
    if (!token) return null;
    const start = $pos.start();
    return { token, from: start + token.from, to: start + token.to, pos };
  }

  /** Entries of the `spelling` context-menu slot for the word under the pointer. */
  contextMenuItems(controller: BodyEditorController): ContextMenuItem[] {
    if (!this.enabled || !this.checker.available) return [];
    const found = this.wordAtContextMenu(controller);
    if (!found) return [];
    const { token, from, to } = found;
    const state = controller.editorState!;
    const decorated = misspelledDecorations(state).some(
      (decoration) => decoration.from <= from && decoration.to >= to,
    );
    const verdict = this.checker.lookup(token.check);
    if (!decorated && verdict !== true) return [];

    const items: ContextMenuItem[] = [];
    const suggestions = this.checker.cachedSuggestions(token.check);
    if (!suggestions) {
      void this.checker.suggest(token.check, MAX_MENU_SUGGESTIONS).then(() => {
        // Re-render the open menu: a selection-only transaction makes the Body view publish.
        const current = controller.editorState;
        if (current) controller.apply(current.tr.setSelection(current.selection));
      });
      items.push({
        id: 'spelling-loading',
        label: this.t('spell.menu.loading'),
        enabled: false,
        run: () => {},
      });
    } else if (suggestions.length === 0) {
      items.push({
        id: 'spelling-none',
        label: this.t('spell.menu.noSuggestions'),
        enabled: false,
        run: () => {},
      });
    } else {
      suggestions.slice(0, MAX_MENU_SUGGESTIONS).forEach((suggestion, index) => {
        items.push({
          id: `spelling-${index}`,
          label: suggestion,
          run: () => this.replaceWord(controller, from, to, suggestion),
        });
      });
    }
    items.push({ separator: true, id: 'spelling-sep' });
    items.push({
      id: 'spelling-ignore-all',
      label: this.t('spell.menu.ignoreAll'),
      run: () => this.session.ignoreAll(token.check),
    });
    items.push({
      id: 'spelling-add',
      label: this.t('dialog.spelling.addToDictionary'),
      run: () => {
        void this.checker
          .addWord(token.check)
          .then(() =>
            actions.setStatusMessage(
              this.store,
              this.t('spell.status.wordAdded', { word: token.check }),
            ),
          )
          .catch(() => {});
      },
    });
    return items;
  }

  /** Replaces `[from, to)` of the Body editor by `replacement` (one undo step), keeping marks. */
  replaceWord(
    controller: BodyEditorController,
    from: number,
    to: number,
    replacement: string,
  ): boolean {
    const state = controller.editorState;
    if (!state || from >= to) return false;
    const marks = state.doc.resolve(from).marks();
    const tr = state.tr.replaceWith(from, to, fb2Schema.text(replacement, marks));
    tr.setSelection(TextSelection.create(tr.doc, from + replacement.length));
    controller.apply(tr);
    return true;
  }
}

const features = new WeakMap<AppStore, SpellFeature>();

export function getSpellFeature(store: AppStore): SpellFeature {
  let feature = features.get(store);
  if (!feature) {
    feature = new SpellFeature(store);
    features.set(store, feature);
  }
  return feature;
}

/** The spell checking plugin for the Body editor of `store` (hook for the editor's plugin list). */
export function getSpellPlugin(store: AppStore): Plugin {
  return getSpellFeature(store).plugin;
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                 */
/* ------------------------------------------------------------------------ */

function spellAvailable(ctx: CommandContext): boolean {
  const feature = getSpellFeature(ctx.store);
  feature.attachRpc(ctx.rpc);
  feature.setTranslate((key, params) => ctx.t(key, params ?? {}) as string);
  const state = ctx.store.getState();
  return (
    ctx.rpc !== null &&
    state.connection === 'connected' &&
    state.document !== null &&
    !state.sourceOnly &&
    feature.enabled
  );
}

/** Opens the Spelling dialog (`tools.spellcheck`). */
export async function openSpellingDialog(ctx: CommandContext): Promise<void> {
  const feature = getSpellFeature(ctx.store);
  feature.attachRpc(ctx.rpc);
  await ctx.dialogs.openCustom<void>((close) =>
    createElement(SpellingDialog, { ctx, feature, onClose: close }),
  );
}

function spellcheckCommand(): Command {
  return {
    id: 'tools.spellcheck',
    group: 'tools',
    labelKey: 'menu.tools.spellcheck',
    tooltipKey: 'cmd.tools.spellcheck.tooltip',
    descriptionKey: 'cmd.tools.spellcheck.description',
    icon: 'id_tools_spellcheck',
    enabled: (ctx) => spellAvailable(ctx) && !ctx.store.getState().sourceDirty,
    run: openSpellingDialog,
  };
}

function highlightCommand(): Command {
  return {
    id: 'tools.spellHighlight',
    group: 'tools',
    tooltipKey: 'cmd.tools.spellHighlight.tooltip',
    descriptionKey: 'cmd.tools.spellHighlight.description',
    enabled: (ctx) => {
      getSpellFeature(ctx.store).attachRpc(ctx.rpc);
      return ctx.rpc !== null && ctx.store.getState().connection === 'connected';
    },
    checked: (ctx) => getSpellFeature(ctx.store).highlight,
    run: async (ctx) => {
      const feature = getSpellFeature(ctx.store);
      const spellHighlight = !feature.highlight;
      const result = await ctx.rpc!.call('settings.set', { patch: { view: { spellHighlight } } });
      actions.setSettings(ctx.store, result.settings);
    },
  };
}

export function registerSpellFeature(ctx: FeatureContext): void {
  const { commands, store } = ctx;
  const feature = getSpellFeature(store);
  // Forward-compatible: when the feature context carries the RPC client, use it right away.
  feature.attachRpc((ctx as { rpc?: RpcClient | null }).rpc ?? null);
  commands.replace(spellcheckCommand());
  commands.replace(highlightCommand());
  registerContextMenuExtension('spelling', (controller) => feature.contextMenuItems(controller));
  // Fallback installation into the Body editor (see the module comment).
  const install = () => {
    if (hasBodyController(store)) feature.installInto(getBodyController(store));
  };
  install();
  if (!hasBodyController(store)) {
    const off = store.subscribe(() => {
      if (hasBodyController(store)) {
        install();
        off();
      }
    });
  }
}
