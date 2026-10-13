/** Start-up query parameters passed by the shell (`?new=1&lang=ru`, see main.tsx / App.tsx). */

import { isSupportedLanguage } from '@/i18n';
import type { UiLanguage } from '@/rpc/types';

/** `?lang=ru` forces the interface language regardless of the settings; null when absent. */
export function forcedLanguage(search: string): UiLanguage | null {
  const lang = new URLSearchParams(search).get('lang');
  return isSupportedLanguage(lang) ? lang : null;
}

/** `?new=1` asks for a blank document at start-up. */
export function wantsNewDocument(search: string): boolean {
  return new URLSearchParams(search).get('new') === '1';
}
