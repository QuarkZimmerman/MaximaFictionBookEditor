/**
 * Language selection helpers (US8, T097): system-language detection, the effective language of
 * a setting and the restart rule.
 */

import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  detectSystemLanguage,
  effectiveLanguage,
  needsRestart,
  primaryLanguage,
  resolveUiLanguage,
} from '@/i18n';

describe('i18n language selection', () => {
  it('supports exactly English and Russian with English as the default', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'ru']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('extracts the primary language subtag of BCP 47 tags and POSIX locales', () => {
    expect(primaryLanguage('ru-RU')).toBe('ru');
    expect(primaryLanguage('ru_RU.UTF-8')).toBe('ru');
    expect(primaryLanguage('RU')).toBe('ru');
    expect(primaryLanguage('en')).toBe('en');
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

    it('falls back to English when nothing is supported', () => {
      expect(detectSystemLanguage(['de-DE', 'fr'])).toBe('en');
      expect(detectSystemLanguage([])).toBe('en');
      expect(detectSystemLanguage(undefined)).toBe('en');
      expect(detectSystemLanguage(null)).toBe('en');
      expect(detectSystemLanguage('C')).toBe('en');
      expect(detectSystemLanguage(['de-DE'], 'uk')).toBe('en');
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
    });

    it('respects an explicit browser preference over the OS language', () => {
      expect(detectSystemLanguage(['ru-RU'], 'en')).toBe('ru');
      expect(detectSystemLanguage(['ru-RU', 'en-US'], 'de')).toBe('ru');
      // English ranked above Russian is a choice, not the engine default.
      expect(detectSystemLanguage(['en-US', 'ru'], 'ru')).toBe('en');
    });
  });

  describe('effectiveLanguage', () => {
    it('returns the explicit setting or the system language', () => {
      expect(effectiveLanguage('en', 'ru')).toBe('en');
      expect(effectiveLanguage('ru', 'en')).toBe('ru');
      expect(effectiveLanguage('system', 'ru')).toBe('ru');
      expect(effectiveLanguage('system', 'en')).toBe('en');
    });

    it('treats absent or unknown settings like "system"', () => {
      expect(effectiveLanguage(undefined, 'ru')).toBe('ru');
      expect(effectiveLanguage(null, 'en')).toBe('en');
      expect(effectiveLanguage('uk', 'ru')).toBe('ru');
    });
  });

  describe('needsRestart', () => {
    it('is true exactly when the effective language changes', () => {
      expect(needsRestart('en', 'ru')).toBe(true);
      expect(needsRestart('ru', 'en')).toBe(true);
      expect(needsRestart('system', 'ru', 'en')).toBe(true);
      expect(needsRestart('ru', 'system', 'en')).toBe(true);
      expect(needsRestart('en', 'system', 'ru')).toBe(true);
    });

    it('is false when only the setting changes but the language stays', () => {
      expect(needsRestart('system', 'ru', 'ru')).toBe(false);
      expect(needsRestart('ru', 'system', 'ru')).toBe(false);
      expect(needsRestart('en', 'system', 'en')).toBe(false);
      expect(needsRestart('ru', 'ru')).toBe(false);
      expect(needsRestart('system', 'system', 'ru')).toBe(false);
      expect(needsRestart(undefined, 'en')).toBe(false);
    });
  });

  describe('resolveUiLanguage (start-up path)', () => {
    it('keeps the previous behaviour for a single browser tag', () => {
      expect(resolveUiLanguage('system', 'ru-RU')).toBe('ru');
      expect(resolveUiLanguage('system', 'en-US')).toBe('en');
      expect(resolveUiLanguage('system', 'de-DE')).toBe('en');
      expect(resolveUiLanguage('system', undefined)).toBe('en');
      expect(resolveUiLanguage('ru', 'en-US')).toBe('ru');
      expect(resolveUiLanguage(undefined, 'ru')).toBe('ru');
    });

    it('accepts the browser list and the core system language', () => {
      expect(resolveUiLanguage('system', ['de-DE', 'ru'])).toBe('ru');
      expect(resolveUiLanguage('system', ['en-US'], 'ru')).toBe('ru');
      expect(resolveUiLanguage('en', ['ru-RU'], 'ru')).toBe('en');
      expect(resolveUiLanguage('system', [], 'uk')).toBe('en');
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
  });
});
