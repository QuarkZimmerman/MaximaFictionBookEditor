/**
 * Interface theme (Settings > View > Theme: System / Light / Dark).
 *
 * The whole look is driven by CSS variables (`app/layout.css`): the light palette lives on
 * `:root`, the dark one on `:root[data-theme='dark']`. This module resolves the setting to a
 * concrete theme and writes it on `<html>`:
 *
 *  - `data-theme="light" | "dark"` selects the palette; `color-scheme` makes the native
 *    scrollbars, form controls and the default canvas follow;
 *  - while the setting is `system` the OS preference is followed live through
 *    `matchMedia('(prefers-color-scheme: dark)')`;
 *  - the setting is mirrored to `localStorage` (`mfbeTheme`) so the next start-up can apply the
 *    chosen theme before the core answered `settings.get` (the Content-Security-Policy of the
 *    core forbids an inline pre-paint script, so this runs at module evaluation - see App.tsx).
 *
 * Views that cannot use CSS variables alone (the CodeMirror editor needs its `dark` flag and a
 * dark highlight style) subscribe with `subscribeTheme()` and read `currentTheme()`.
 */

import type { ThemeSetting } from '@/rpc/types';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME_SETTING: ThemeSetting = 'system';

/** `localStorage` key mirroring the theme setting (start-up before the settings arrive). */
export const THEME_STORAGE_KEY = 'mfbeTheme';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * The status colours of `app/layout.css` (feature 005, research R8.7): `--status-ok` for a
 * verified connection, `--status-bad` for a failed or untested one. Declared in the light
 * palette, the dark palette and the pre-paint system-dark block alike; the settings page's
 * verification text reads them through `data-status`.
 */
export const STATUS_COLOR_VARIABLES = ['--status-ok', '--status-bad'] as const;

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (THEME_SETTINGS as readonly string[]).includes(value);
}

/** The concrete theme of a setting: `system` follows the OS preference. */
export function resolveTheme(
  setting: ThemeSetting | null | undefined,
  systemDark: boolean,
): ResolvedTheme {
  if (setting === 'light' || setting === 'dark') return setting;
  return systemDark ? 'dark' : 'light';
}

/** Browser services the theme uses; every piece is optional (tests, headless). */
export interface ThemeEnvironment {
  /** Element receiving `data-theme` (`<html>` by default). */
  root: HTMLElement | null;
  /** `window.matchMedia` (null when unavailable: the system is assumed light). */
  matchMedia: ((query: string) => MediaQueryList) | null;
  /** Storage for the mirror (null disables it). */
  storage: Storage | null;
}

function defaultRoot(): HTMLElement | null {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

function defaultMatchMedia(): ThemeEnvironment['matchMedia'] {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return (query) => window.matchMedia(query);
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage access denied (sandboxed frame, privacy mode)
  }
}

function environment(overrides: Partial<ThemeEnvironment>): ThemeEnvironment {
  return {
    root: overrides.root !== undefined ? overrides.root : defaultRoot(),
    matchMedia: overrides.matchMedia !== undefined ? overrides.matchMedia : defaultMatchMedia(),
    storage: overrides.storage !== undefined ? overrides.storage : defaultStorage(),
  };
}

/** Whether the OS currently prefers a dark colour scheme (false when it cannot be asked). */
export function systemPrefersDark(
  matchMedia: ThemeEnvironment['matchMedia'] = defaultMatchMedia(),
): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia(DARK_SCHEME_QUERY).matches;
  } catch {
    return false;
  }
}

/** The mirrored setting of the previous session, `system` when there is none. */
export function storedThemeSetting(storage: Storage | null = defaultStorage()): ThemeSetting {
  if (!storage) return DEFAULT_THEME_SETTING;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemeSetting(value) ? value : DEFAULT_THEME_SETTING;
  } catch {
    return DEFAULT_THEME_SETTING;
  }
}

/* ------------------------------------------------------------------------ */
/* Live state                                                               */
/* ------------------------------------------------------------------------ */

let activeSetting: ThemeSetting = DEFAULT_THEME_SETTING;
let activeTheme: ResolvedTheme = 'light';
let activeRoot: HTMLElement | null = null;
let systemQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;
const listeners = new Set<(theme: ResolvedTheme) => void>();

function writeTheme(root: HTMLElement | null, theme: ResolvedTheme): void {
  if (!root) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function setResolved(theme: ResolvedTheme): void {
  const changed = theme !== activeTheme;
  activeTheme = theme;
  writeTheme(activeRoot, theme);
  if (!changed) return;
  for (const listener of [...listeners]) listener(theme);
}

function unfollowSystem(): void {
  if (systemQuery && systemListener) systemQuery.removeEventListener('change', systemListener);
  systemQuery = null;
  systemListener = null;
}

/** Subscribes to OS preference changes; returns whether the OS prefers dark right now. */
function followSystem(matchMedia: ThemeEnvironment['matchMedia']): boolean {
  if (!matchMedia) return false;
  let query: MediaQueryList;
  try {
    query = matchMedia(DARK_SCHEME_QUERY);
  } catch {
    return false;
  }
  const listener = (event: MediaQueryListEvent) => {
    if (activeSetting !== 'system' || systemQuery !== query) return;
    setResolved(event.matches ? 'dark' : 'light');
  };
  query.addEventListener('change', listener);
  systemQuery = query;
  systemListener = listener;
  return query.matches;
}

/**
 * Applies a theme setting: resolves it, writes `data-theme` / `color-scheme` on the root,
 * follows the OS preference while the setting is `system`, mirrors the setting to storage and
 * notifies the subscribers. Returns the resolved theme. Idempotent.
 */
export function applyTheme(
  setting: ThemeSetting | null | undefined,
  overrides: Partial<ThemeEnvironment> = {},
): ResolvedTheme {
  const env = environment(overrides);
  const next: ThemeSetting = isThemeSetting(setting) ? setting : DEFAULT_THEME_SETTING;
  unfollowSystem();
  activeSetting = next;
  activeRoot = env.root;
  const systemDark = next === 'system' ? followSystem(env.matchMedia) : false;
  if (env.storage) {
    try {
      env.storage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // quota / privacy mode: the mirror is only an optimisation
    }
  }
  setResolved(resolveTheme(next, systemDark));
  return activeTheme;
}

/** Applies the mirrored setting of the previous session (start-up, before `settings.get`). */
export function applyStoredTheme(overrides: Partial<ThemeEnvironment> = {}): ResolvedTheme {
  return applyTheme(storedThemeSetting(environment(overrides).storage), overrides);
}

/** The theme in effect (`light` until `applyTheme` ran). */
export function currentTheme(): ResolvedTheme {
  return activeTheme;
}

/** The setting in effect (`system` until `applyTheme` ran). */
export function currentThemeSetting(): ThemeSetting {
  return activeSetting;
}

/** Notifies on every change of the resolved theme (setting change or OS switch). */
export function subscribeTheme(listener: (theme: ResolvedTheme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
