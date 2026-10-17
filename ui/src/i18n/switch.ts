/**
 * Interface language selection (US8, T097; Ukrainian added by feature 003, FR-001) - pure
 * helpers shared by the start-up code (`app/App.tsx`), the settings feature
 * (`features/settings/apply.ts`) and the tests.
 *
 * Inputs and their meaning:
 *  - the setting `view.uiLanguage` (`en` | `ru` | `uk` | `system`, contracts/rpc-api.md §3.8);
 *  - the browser preference list (`navigator.languages`; the CEF shell derives it from its
 *    locale, which follows the OS on Linux and `--lang` elsewhere);
 *  - the operating-system language reported by the core (`app.info.systemLanguage`: the Windows
 *    user locale, `LC_ALL`/`LC_MESSAGES`/`LANG` on POSIX).
 *
 * First start (FR-100): the editor follows the system language when it is one of the supported
 * languages (English, Russian, Ukrainian) and falls back to English otherwise.
 * {@link detectSystemLanguage} combines the two signals so that the result is right in every
 * environment:
 *  1. the first supported language of the browser list wins when it is not English - somebody
 *     set it on purpose (the shell's `--lang ru`, a Russian browser profile, a Ukrainian
 *     desktop on Linux where CEF reads `LANG`);
 *  2. when the browser list names nothing but English - the built-in default of every browser
 *     engine, and what CEF reports on Windows/macOS unless the shell passes a locale - the
 *     core's OS language decides if it is supported;
 *  3. otherwise the first supported browser language, then the OS language, then
 *     {@link DEFAULT_LANGUAGE}.
 *
 * Adding a language means extending {@link SUPPORTED_LANGUAGES}, the `UiLanguage` type, the
 * `resources` map of `index.ts` (with its `<lang>.json` / `<feature>.<lang>.json` catalogue
 * set, picked up by the feature-catalogue glob there), the Settings option list
 * (`dialogs/settings/model.ts`, `LANGUAGE_OPTIONS`) and the `lang.<lang>` /
 * `dialog.settings.view.language<Lang>` names in every catalogue - the completeness test
 * (`tests/unit/i18n-completeness.test.ts`) checks the new language automatically.
 */

import type { UiLanguage, UiLanguageSetting } from '@/rpc/types';

export const SUPPORTED_LANGUAGES: readonly UiLanguage[] = ['en', 'ru', 'uk'];
export const DEFAULT_LANGUAGE: UiLanguage = 'en';

export function isSupportedLanguage(value: string | undefined | null): value is UiLanguage {
  return value !== undefined && value !== null && (SUPPORTED_LANGUAGES as string[]).includes(value);
}

/**
 * Primary language subtag of a BCP 47 tag or POSIX locale name, lower-cased:
 * `"ru-RU"`, `"ru_RU.UTF-8"`, `"RU"` -> `"ru"`; `""`, `"C"`, `"POSIX"` and non-strings -> null.
 */
export function primaryLanguage(tag: string | null | undefined): string | null {
  if (typeof tag !== 'string') return null;
  const primary =
    tag
      .trim()
      .split(/[-_.@]/)[0]
      ?.toLowerCase() ?? '';
  if (primary === '' || primary === 'c' || primary === 'posix') return null;
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/** Supported languages among `tags`, in order, without duplicates. */
function supportedIn(tags: readonly (string | null | undefined)[]): UiLanguage[] {
  const found: UiLanguage[] = [];
  for (const tag of tags) {
    const primary = primaryLanguage(tag);
    if (isSupportedLanguage(primary) && !found.includes(primary)) found.push(primary);
  }
  return found;
}

/**
 * Detects the system language: the first supported match among the browser preferences and the
 * core's OS language (see the module comment for the order), else {@link DEFAULT_LANGUAGE}.
 *
 * @param navigatorLanguages `navigator.languages` (or a single `navigator.language`)
 * @param coreSystemLanguage `app.info.systemLanguage` when the core has answered
 */
export function detectSystemLanguage(
  navigatorLanguages: readonly string[] | string | null | undefined,
  coreSystemLanguage?: string | null,
): UiLanguage {
  const browser = supportedIn(
    typeof navigatorLanguages === 'string' ? [navigatorLanguages] : (navigatorLanguages ?? []),
  );
  const os = supportedIn([coreSystemLanguage])[0];
  const preferred = browser[0];
  if (preferred !== undefined && preferred !== DEFAULT_LANGUAGE) return preferred;
  const onlyDefault = browser.length > 0 && browser.every((lang) => lang === DEFAULT_LANGUAGE);
  if (onlyDefault && os) return os;
  return preferred ?? os ?? DEFAULT_LANGUAGE;
}

/**
 * The language the interface actually uses for a setting: `en`/`ru`/`uk` as such, `system` (or
 * an absent/unknown value from an older settings file) -> `system`.
 */
export function effectiveLanguage(
  setting: UiLanguageSetting | string | null | undefined,
  system: UiLanguage,
): UiLanguage {
  return setting !== 'system' && isSupportedLanguage(setting) ? setting : system;
}

/**
 * Whether switching the setting from `from` to `to` requires a restart.
 *
 * Semantics: the web UI re-renders its menus, dialogs and messages live when i18next switches,
 * so the restart is about everything that is fixed at start-up - the shell's native window
 * title and dialog captions, the browser engine's locale (spell-check language of text fields,
 * context menus), scripts and resources the core resolved for the old language. A restart is
 * therefore needed exactly when the *effective* language changes: `en -> ru`, `system -> ru`
 * on an English system. It is not needed when only the setting changes but the language stays
 * (`system -> ru` on a Russian system, `ru -> ru`). The core reports `restartRequired` whenever
 * the stored value changed; the Settings dialog may use this helper to skip the prompt in the
 * no-op cases.
 */
export function needsRestart(
  from: UiLanguageSetting | UiLanguage | null | undefined,
  to: UiLanguageSetting | UiLanguage | null | undefined,
  system: UiLanguage = DEFAULT_LANGUAGE,
): boolean {
  return effectiveLanguage(from, system) !== effectiveLanguage(to, system);
}
