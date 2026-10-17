/**
 * Start-up query parameters passed by the shell (`?new=1&lang=ru`, see main.tsx / App.tsx) and,
 * since feature 003 (US3, contracts/cli.md §1 URL hints), `?open=<path>` - the document the
 * browser-mode restart reopens: the page reloads itself with it when `app.restart` is
 * unavailable (no shell, error 1070).
 */

import { isSupportedLanguage } from '@/i18n';
import type { UiLanguage } from '@/rpc/types';

/**
 * `?lang=<code>` forces the interface language regardless of the settings; any language of
 * `SUPPORTED_LANGUAGES` (`en`, `ru`, `uk`) is accepted, null when absent or unsupported.
 */
export function forcedLanguage(search: string): UiLanguage | null {
  const lang = new URLSearchParams(search).get('lang');
  return isSupportedLanguage(lang) ? lang : null;
}

/** `?new=1` asks for a blank document at start-up. */
export function wantsNewDocument(search: string): boolean {
  return new URLSearchParams(search).get('new') === '1';
}

/**
 * `?open=<path>`: the document to open at start-up before any other start-up work (the
 * browser-mode restart); null when absent or empty.
 */
export function openPathAtStartup(search: string): string | null {
  const path = new URLSearchParams(search).get('open');
  return path ? path : null;
}

/**
 * The URL of the page after a browser-mode restart (rpc-api.md §3.1, 1070): the current page
 * with its query kept - `token`, `lang` and the rest - plus `open=<path>` when a document is to
 * be reopened; a previous `open` and `new` go, since they described the last start.
 */
export function restartUrl(href: string, openPath: string | null): string {
  const url = new URL(href);
  url.searchParams.delete('open');
  url.searchParams.delete('new');
  if (openPath) url.searchParams.set('open', openPath);
  return url.toString();
}
