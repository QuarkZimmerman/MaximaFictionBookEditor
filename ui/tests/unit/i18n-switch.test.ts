/**
 * Language selection helpers (US8, T097; feature 003 T015 adds Ukrainian): system-language
 * detection, the effective language of a setting, the restart rule and the `?lang=` start-up
 * override.
 */

import { forcedLanguage, openPathAtStartup, restartUrl } from '@/app/startup';
import { LANGUAGE_OPTIONS } from '@/dialogs/settings/model';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  detectSystemLanguage,
  effectiveLanguage,
  isSupportedLanguage,
  needsRestart,
  primaryLanguage,
  resolveUiLanguage,
  resources,
} from '@/i18n';

describe('i18n language selection', () => {
  it('supports exactly English, Russian and Ukrainian with English as the default', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'ru', 'uk']);
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(isSupportedLanguage('uk')).toBe(true);
    expect(isSupportedLanguage('be')).toBe(false);
    expect(isSupportedLanguage('uk-UA')).toBe(false); // primary subtags only
  });

  it('has a merged catalogue for every supported language', () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    for (const language of SUPPORTED_LANGUAGES) {
      const translation = resources[language].translation as Record<string, unknown>;
      // Base catalogue and a feature catalogue (about.<lang>.json) are both merged in.
      expect(translation, language).toHaveProperty('menu');
      expect(translation, language).toHaveProperty('dialog.about.versionUnknown');
    }
  });

  it('offers system, English, Russian and Ukrainian in the Settings dialog, in that order', () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(['system', 'en', 'ru', 'uk']);
    expect(LANGUAGE_OPTIONS.map((option) => option.labelKey)).toEqual([
      'dialog.settings.view.languageSystem',
      'dialog.settings.view.languageEn',
      'dialog.settings.view.languageRu',
      'dialog.settings.view.languageUk',
    ]);
    // Every supported language is offered (and nothing that is not supported).
    const offered = LANGUAGE_OPTIONS.map((option) => option.value).filter((v) => v !== 'system');
    expect(offered.sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('accepts ?lang=uk like ?lang=ru at start-up and ignores unsupported codes', () => {
    expect(forcedLanguage('?lang=uk')).toBe('uk');
    expect(forcedLanguage('?new=1&lang=ru')).toBe('ru');
    expect(forcedLanguage('?lang=en')).toBe('en');
    expect(forcedLanguage('?lang=uk-UA')).toBeNull();
    expect(forcedLanguage('?lang=de')).toBeNull();
    expect(forcedLanguage('?new=1')).toBeNull();
    expect(forcedLanguage('')).toBeNull();
  });

  it('reads ?open=<path> and builds the browser-mode restart URL (feature 003 US3)', () => {
    expect(openPathAtStartup('?token=abc&open=%2Fbooks%2F%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0.fb2')).toBe(
      '/books/книга.fb2',
    );
    expect(openPathAtStartup('?token=abc')).toBeNull();
    expect(openPathAtStartup('?open=')).toBeNull();

    // The current query (token, lang) is kept, open= added; a stale open= / new= goes.
    const base = 'http://127.0.0.1:4000/?token=abc&lang=uk';
    const withBook = new URL(restartUrl(base, '/books/a b.fb2'));
    expect(withBook.searchParams.get('token')).toBe('abc');
    expect(withBook.searchParams.get('lang')).toBe('uk');
    expect(withBook.searchParams.get('open')).toBe('/books/a b.fb2');
    expect(openPathAtStartup(withBook.search)).toBe('/books/a b.fb2');
    const without = new URL(restartUrl(`${base}&new=1&open=%2Fold.fb2`, null));
    expect(without.searchParams.has('open')).toBe(false);
    expect(without.searchParams.has('new')).toBe(false);
    expect(without.searchParams.get('token')).toBe('abc');
  });

  it('extracts the primary language subtag of BCP 47 tags and POSIX locales', () => {
    expect(primaryLanguage('ru-RU')).toBe('ru');
    expect(primaryLanguage('ru_RU.UTF-8')).toBe('ru');
    expect(primaryLanguage('RU')).toBe('ru');
    expect(primaryLanguage('en')).toBe('en');
    expect(primaryLanguage('uk-UA')).toBe('uk');
    expect(primaryLanguage('uk_UA.UTF-8')).toBe('uk');
    expect(primaryLanguage('de-DE@euro')).toBe('de');
    expect(primaryLanguage('C')).toBeNull();
    expect(primaryLanguage('POSIX')).toBeNull();
    expect(primaryLanguage('')).toBeNull();
    expect(primaryLanguage(undefined)).toBeNull();
    expect(primaryLanguage(null)).toBeNull();
    expect(primaryLanguage('not a tag')).toBeNull();
  });

  describe('detectSystemLanguage', () => {
    it('takes the first supported browser language', () => {
      expect(detectSystemLanguage(['ru-RU', 'en-US'])).toBe('ru');
      expect(detectSystemLanguage(['de-DE', 'ru'])).toBe('ru');
      expect(detectSystemLanguage(['en-GB', 'ru-RU'])).toBe('en');
      expect(detectSystemLanguage(['en-US'])).toBe('en');
      expect(detectSystemLanguage('ru')).toBe('ru');
      expect(detectSystemLanguage('ru_RU.UTF-8')).toBe('ru');
    });

    it('detects a Ukrainian browser or desktop (feature 003, FR-001)', () => {
      // A Ukrainian browser profile, the shell's `--lang uk`, a Ukrainian desktop on Linux.
      expect(detectSystemLanguage(['uk-UA', 'uk', 'en-US'])).toBe('uk');
      expect(detectSystemLanguage(['uk'])).toBe('uk');
      expect(detectSystemLanguage('uk-UA')).toBe('uk');
      expect(detectSystemLanguage('uk_UA.UTF-8')).toBe('uk');
      // Ukrainian and Russian preferences keep their order.
      expect(detectSystemLanguage(['uk-UA', 'ru-RU'])).toBe('uk');
      expect(detectSystemLanguage(['ru-RU', 'uk-UA'])).toBe('ru');
      expect(detectSystemLanguage(['de-DE', 'uk'])).toBe('uk');
    });

    it('falls back to English when nothing is supported', () => {
      expect(detectSystemLanguage(['de-DE', 'fr'])).toBe('en');
      expect(detectSystemLanguage([])).toBe('en');
      expect(detectSystemLanguage(undefined)).toBe('en');
      expect(detectSystemLanguage(null)).toBe('en');
      expect(detectSystemLanguage('C')).toBe('en');
      expect(detectSystemLanguage(['de-DE'], 'be')).toBe('en');
    });

    it("uses the core's OS language when the browser reports only its default", () => {
      // CEF reports en-US on Windows/macOS unless the shell passes a locale.
      expect(detectSystemLanguage(['en-US', 'en'], 'ru')).toBe('ru');
      expect(detectSystemLanguage(['en-US'], 'ru_RU.UTF-8')).toBe('ru');
      expect(detectSystemLanguage([], 'ru')).toBe('ru');
      expect(detectSystemLanguage(['de-DE'], 'ru')).toBe('ru');
      expect(detectSystemLanguage(['en-US'], 'en')).toBe('en');
      expect(detectSystemLanguage(['en-US'], 'de')).toBe('en');
      expect(detectSystemLanguage(['en-US'], undefined)).toBe('en');
      // The core under `LANG=uk_UA.UTF-8` reports `uk` (or the full locale on some systems).
      expect(detectSystemLanguage(['en-US', 'en'], 'uk')).toBe('uk');
      expect(detectSystemLanguage(['en-US'], 'uk_UA.UTF-8')).toBe('uk');
      expect(detectSystemLanguage(['en-US'], 'uk-UA')).toBe('uk');
      expect(detectSystemLanguage([], 'uk')).toBe('uk');
      expect(detectSystemLanguage(['de-DE'], 'uk')).toBe('uk');
    });

    it('respects an explicit browser preference over the OS language', () => {
      expect(detectSystemLanguage(['ru-RU'], 'en')).toBe('ru');
      expect(detectSystemLanguage(['ru-RU', 'en-US'], 'de')).toBe('ru');
      expect(detectSystemLanguage(['uk-UA'], 'ru')).toBe('uk');
      expect(detectSystemLanguage(['ru-RU'], 'uk')).toBe('ru');
      // English ranked above Russian is a choice, not the engine default.
      expect(detectSystemLanguage(['en-US', 'ru'], 'ru')).toBe('en');
      expect(detectSystemLanguage(['en-US', 'uk'], 'uk')).toBe('en');
    });
  });

  describe('effectiveLanguage', () => {
    it('returns the explicit setting or the system language', () => {
      expect(effectiveLanguage('en', 'ru')).toBe('en');
      expect(effectiveLanguage('ru', 'en')).toBe('ru');
      expect(effectiveLanguage('uk', 'en')).toBe('uk');
      expect(effectiveLanguage('uk', 'ru')).toBe('uk');
      expect(effectiveLanguage('system', 'ru')).toBe('ru');
      expect(effectiveLanguage('system', 'en')).toBe('en');
      expect(effectiveLanguage('system', 'uk')).toBe('uk');
    });

    it('treats absent or unknown settings like "system"', () => {
      expect(effectiveLanguage(undefined, 'ru')).toBe('ru');
      expect(effectiveLanguage(null, 'en')).toBe('en');
      expect(effectiveLanguage('be', 'ru')).toBe('ru');
      expect(effectiveLanguage('uk-UA', 'en')).toBe('en');
    });
  });

  describe('needsRestart', () => {
    it('is true exactly when the effective language changes', () => {
      expect(needsRestart('en', 'ru')).toBe(true);
      expect(needsRestart('ru', 'en')).toBe(true);
      expect(needsRestart('ru', 'uk')).toBe(true);
      expect(needsRestart('en', 'uk')).toBe(true);
      expect(needsRestart('system', 'ru', 'en')).toBe(true);
      expect(needsRestart('system', 'uk', 'en')).toBe(true);
      expect(needsRestart('ru', 'system', 'en')).toBe(true);
      expect(needsRestart('en', 'system', 'ru')).toBe(true);
      expect(needsRestart('en', 'system', 'uk')).toBe(true);
    });

    it('is false when only the setting changes but the language stays', () => {
      expect(needsRestart('system', 'ru', 'ru')).toBe(false);
      expect(needsRestart('ru', 'system', 'ru')).toBe(false);
      expect(needsRestart('system', 'uk', 'uk')).toBe(false);
      expect(needsRestart('uk', 'system', 'uk')).toBe(false);
      expect(needsRestart('en', 'system', 'en')).toBe(false);
      expect(needsRestart('ru', 'ru')).toBe(false);
      expect(needsRestart('uk', 'uk')).toBe(false);
      expect(needsRestart('system', 'system', 'ru')).toBe(false);
      expect(needsRestart(undefined, 'en')).toBe(false);
    });
  });

  describe('resolveUiLanguage (start-up path)', () => {
    it('keeps the previous behaviour for a single browser tag', () => {
      expect(resolveUiLanguage('system', 'ru-RU')).toBe('ru');
      expect(resolveUiLanguage('system', 'uk-UA')).toBe('uk');
      expect(resolveUiLanguage('system', 'en-US')).toBe('en');
      expect(resolveUiLanguage('system', 'de-DE')).toBe('en');
      expect(resolveUiLanguage('system', undefined)).toBe('en');
      expect(resolveUiLanguage('ru', 'en-US')).toBe('ru');
      expect(resolveUiLanguage('uk', 'en-US')).toBe('uk');
      expect(resolveUiLanguage(undefined, 'ru')).toBe('ru');
    });

    it('accepts the browser list and the core system language', () => {
      expect(resolveUiLanguage('system', ['de-DE', 'ru'])).toBe('ru');
      expect(resolveUiLanguage('system', ['en-US'], 'ru')).toBe('ru');
      expect(resolveUiLanguage('system', ['en-US'], 'uk')).toBe('uk');
      expect(resolveUiLanguage('en', ['ru-RU'], 'ru')).toBe('en');
      expect(resolveUiLanguage('en', ['uk-UA'], 'uk')).toBe('en');
      expect(resolveUiLanguage('system', [], 'uk')).toBe('uk');
      expect(resolveUiLanguage('system', [], 'be')).toBe('en');
    });

    it('reads navigator.languages by default', () => {
      const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru-RU', 'ru']);
      try {
        expect(resolveUiLanguage('system')).toBe('ru');
        expect(resolveUiLanguage('en')).toBe('en');
      } finally {
        languages.mockRestore();
      }
    });

    it('reads a Ukrainian navigator.languages list by default', () => {
      const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['uk-UA', 'uk']);
      try {
        expect(resolveUiLanguage('system')).toBe('uk');
        expect(resolveUiLanguage('ru')).toBe('ru');
      } finally {
        languages.mockRestore();
      }
    });
  });
});
