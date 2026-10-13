import { createInstance } from 'i18next';

import {
  MissingTranslationError,
  initI18n,
  onMissingKey,
  parseAccelerator,
  plainLabel,
  resolveUiLanguage,
} from '@/i18n';

describe('i18n', () => {
  it('loads both catalogues and switches language', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    expect(i18n.t('status.ready')).toBe('Ready');
    expect(i18n.t('menu.file.caption')).toBe('&File');
    await i18n.changeLanguage('ru');
    expect(i18n.t('status.ready')).toBe('Готово');
    expect(i18n.t('menu.file.caption')).toBe('&Файл');
  });

  it('interpolates placeholders without HTML escaping', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    expect(i18n.t('msg.saveChanges', { name: "Tom & Jerry's.fb2" })).toBe(
      "Save changes to Tom & Jerry's.fb2?",
    );
  });

  it('uses Intl.PluralRules categories (en: one/other, ru: one/few/many)', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    expect(i18n.t('msg.replacementsDone', { count: 1 })).toBe('1 replacement done.');
    expect(i18n.t('msg.replacementsDone', { count: 5 })).toBe('5 replacements done.');
    await i18n.changeLanguage('ru');
    expect(i18n.t('msg.replacementsDone', { count: 1 })).toBe(
      'Поиск завершен. Произведена 1 замена.',
    );
    expect(i18n.t('msg.replacementsDone', { count: 3 })).toBe(
      'Поиск завершен. Произведено 3 замены.',
    );
    expect(i18n.t('msg.replacementsDone', { count: 11 })).toBe(
      'Поиск завершен. Произведено 11 замен.',
    );
    expect(i18n.t('msg.replacementsDone', { count: 21 })).toBe(
      'Поиск завершен. Произведена 21 замена.',
    );
    expect(i18n.t('cmd.source.collapse.tooltip', { count: 2 })).toBe('Свернуть дерево на 2 уровня');
  });

  it('throws on missing keys in test mode and reports them to listeners', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const reports: string[] = [];
    const off = onMissingKey((report) => reports.push(report.key));
    expect(() => i18n.t('does.not.exist')).toThrow(MissingTranslationError);
    expect(reports).toEqual(['does.not.exist']);
    off();
  });

  it('marks missing keys visibly in development mode instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const i18n = await initI18n({
      instance: createInstance(),
      react: false,
      language: 'en',
      mode: 'development',
    });
    expect(i18n.t('does.not.exist')).toBe('[missing: does.not.exist]');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('falls back to English for keys missing in Russian', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'ru' });
    i18n.addResource('en', 'translation', 'only.english', 'Only English');
    expect(i18n.t('only.english')).toBe('Only English');
  });

  it('resolves the "system" language setting', () => {
    expect(resolveUiLanguage('system', 'ru-RU')).toBe('ru');
    expect(resolveUiLanguage('system', 'en-US')).toBe('en');
    expect(resolveUiLanguage('system', 'de-DE')).toBe('en');
    expect(resolveUiLanguage('system', undefined)).toBe('en');
    expect(resolveUiLanguage('ru', 'en-US')).toBe('ru');
    expect(resolveUiLanguage(undefined, 'ru')).toBe('ru');
  });

  it('parses & accelerator markers', async () => {
    expect(parseAccelerator('&New')).toEqual({ text: 'New', index: 0, key: 'n' });
    expect(parseAccelerator('Save &As...')).toEqual({ text: 'Save As...', index: 5, key: 'a' });
    expect(parseAccelerator('Fast Mode')).toEqual({ text: 'Fast Mode', index: -1, key: null });
    expect(parseAccelerator('Tom && Jerry')).toEqual({ text: 'Tom & Jerry', index: -1, key: null });
    expect(parseAccelerator('&Файл')).toEqual({ text: 'Файл', index: 0, key: 'ф' });
    expect(parseAccelerator('trailing&')).toEqual({ text: 'trailing', index: -1, key: null });
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    expect(plainLabel(i18n.t, 'menu.file.saveAs')).toBe('Save As...');
  });
});
