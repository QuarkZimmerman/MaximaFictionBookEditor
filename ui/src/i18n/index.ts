/**
 * i18next setup: English and Russian catalogues (i18next JSON v4 with `Intl.PluralRules`
 * plural suffixes `_one/_few/_many/_other`), missing-key reporting in development and
 * loud failures in tests.
 *
 * Catalogue conventions: nested keys by area (`menu.file.new`, `dialog.find.caption`,
 * `msg.saveChanges`), `{{name}}` placeholders, `&` marks the keyboard accelerator of menu and
 * button labels (`&&` is a literal ampersand) - see `parseAccelerator()`.
 */

import i18next, { type i18n as I18n, type TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ru from './ru.json';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  detectSystemLanguage,
  effectiveLanguage,
  isSupportedLanguage,
} from './switch';

import type { UiLanguage, UiLanguageSetting } from '@/rpc/types';

export {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  detectSystemLanguage,
  effectiveLanguage,
  isSupportedLanguage,
  needsRestart,
  primaryLanguage,
} from './switch';

type Catalogue = Record<string, unknown>;

/**
 * Feature catalogues: every `<feature>.<lang>.json` file next to this module is deep-merged
 * into the base catalogue of its language (`en.json` / `ru.json`). Features own their files,
 * so independent work never edits the same catalogue. Keys must not collide across files
 * (`tools/i18n-check.mjs` verifies parity and collisions).
 */
const featureCatalogues = import.meta.glob<Catalogue>('./*.{en,ru}.json', {
  eager: true,
  import: 'default',
});

function deepMerge(target: Catalogue, source: Catalogue, file: string): Catalogue {
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('$')) continue; // "$comment" style metadata
    const existing = target[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (existing !== undefined && (typeof existing !== 'object' || existing === null)) {
        throw new Error(`i18n: "${key}" in ${file} collides with a string in the base catalogue`);
      }
      target[key] = deepMerge(
        { ...((existing as Catalogue | undefined) ?? {}) },
        value as Catalogue,
        file,
      );
    } else {
      if (existing !== undefined) throw new Error(`i18n: duplicate key "${key}" in ${file}`);
      target[key] = value;
    }
  }
  return target;
}

function buildCatalogue(language: UiLanguage, base: Catalogue): Catalogue {
  const merged: Catalogue = { ...base };
  const suffix = `.${language}.json`;
  for (const file of Object.keys(featureCatalogues).sort()) {
    if (file.endsWith(suffix)) deepMerge(merged, featureCatalogues[file], file);
  }
  return merged;
}

export const resources = {
  en: { translation: buildCatalogue('en', en as Catalogue) },
  ru: { translation: buildCatalogue('ru', ru as Catalogue) },
} as const;

export type TranslationCatalogue = typeof en;

export class MissingTranslationError extends Error {
  constructor(
    readonly key: string,
    readonly languages: readonly string[],
  ) {
    super(`Missing translation for "${key}" (${languages.join(', ')})`);
    this.name = 'MissingTranslationError';
  }
}

export interface MissingKeyReport {
  key: string;
  languages: readonly string[];
}

const missingKeyListeners = new Set<(report: MissingKeyReport) => void>();

/** Receive missing-key reports (tests use this to assert catalogue completeness). */
export function onMissingKey(listener: (report: MissingKeyReport) => void): () => void {
  missingKeyListeners.add(listener);
  return () => {
    missingKeyListeners.delete(listener);
  };
}

/** Browser preference list (`navigator.languages`, falling back to `navigator.language`). */
function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

/**
 * Resolves the setting (`en`, `ru` or `system`) to a concrete UI language. "system" follows the
 * browser/OS language when it is supported (see `switch.ts` for the detection order); everything
 * else falls back to English.
 *
 * @param systemLanguage browser preferences (`navigator.languages` by default)
 * @param coreSystemLanguage the OS language reported by the core (`app.info.systemLanguage`)
 */
export function resolveUiLanguage(
  setting: UiLanguageSetting | undefined,
  systemLanguage: string | readonly string[] | undefined = browserLanguages(),
  coreSystemLanguage?: string | null,
): UiLanguage {
  return effectiveLanguage(setting, detectSystemLanguage(systemLanguage, coreSystemLanguage));
}

export interface InitI18nOptions {
  language?: UiLanguage;
  /** `development` warns on the console, `test` throws, `production` is silent. */
  mode?: 'development' | 'test' | 'production';
  /** Use a fresh i18next instance instead of the global singleton (tests). */
  instance?: I18n;
  /** Skip the react-i18next binding (plain-TS tests). */
  react?: boolean;
}

let initialised: Promise<I18n> | null = null;

function currentMode(): 'development' | 'test' | 'production' {
  const mode = import.meta.env.MODE;
  if (mode === 'test' || mode === 'production') return mode;
  return 'development';
}

/**
 * Initialises i18next once (subsequent calls return the same promise unless a custom instance
 * is passed). Safe to call from `main.tsx` and from tests.
 */
export function initI18n(options: InitI18nOptions = {}): Promise<I18n> {
  const instance = options.instance ?? i18next;
  if (!options.instance && initialised) return initialised;

  const mode = options.mode ?? currentMode();
  const language = options.language ?? resolveUiLanguage('system');

  if (options.react !== false) instance.use(initReactI18next);

  const promise = instance
    .init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...SUPPORTED_LANGUAGES],
      interpolation: { escapeValue: false }, // React escapes already
      returnNull: false,
      returnEmptyString: true,
      saveMissing: true,
      missingKeyNoValueFallbackToKey: true,
      missingKeyHandler: (lngs, _ns, key) => {
        const report: MissingKeyReport = { key, languages: lngs };
        for (const listener of [...missingKeyListeners]) listener(report);
        if (mode === 'test') throw new MissingTranslationError(key, lngs);
        if (mode === 'development') {
          console.warn(`[i18n] missing key "${key}" for ${lngs.join(', ')}`);
        }
      },
      parseMissingKeyHandler: (key) => (mode === 'production' ? key : `[missing: ${key}]`),
    })
    .then(() => instance);

  if (!options.instance) initialised = promise;
  return promise;
}

/** Switches the interface language at run time (menus re-render through react-i18next). */
export async function changeLanguage(
  language: UiLanguage,
  instance: I18n = i18next,
): Promise<void> {
  if (instance.language === language) return;
  await instance.changeLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export function currentLanguage(instance: I18n = i18next): UiLanguage {
  return isSupportedLanguage(instance.language) ? instance.language : DEFAULT_LANGUAGE;
}

/* ------------------------------------------------------------------------ */
/* Accelerator markup                                                       */
/* ------------------------------------------------------------------------ */

export interface AcceleratorLabel {
  /** Label without the `&` markers. */
  text: string;
  /** Index into `text` of the accelerator character, or -1. */
  index: number;
  /** Lower-cased accelerator character, or null. */
  key: string | null;
}

/** Parses `"Save &As..."` into `{ text: "Save As...", index: 5, key: "a" }`; `&&` is a literal `&`. */
export function parseAccelerator(label: string): AcceleratorLabel {
  let text = '';
  let index = -1;
  for (let i = 0; i < label.length; i += 1) {
    const ch = label[i];
    if (ch === '&') {
      const next = label[i + 1];
      if (next === '&') {
        text += '&';
        i += 1;
      } else if (next !== undefined && index === -1) {
        index = text.length;
        text += next;
        i += 1;
      }
      // trailing lone '&' is dropped
    } else {
      text += ch;
    }
  }
  return { text, index, key: index >= 0 ? text[index]!.toLowerCase() : null };
}

/** `t()` wrapper returning the label without accelerator markers. */
export function plainLabel(t: TFunction, key: string, options?: Record<string, unknown>): string {
  return parseAccelerator(t(key, options ?? {}) as string).text;
}

export { i18next };
export default i18next;
