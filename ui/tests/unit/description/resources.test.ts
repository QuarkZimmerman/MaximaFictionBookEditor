/**
 * Feature 003 US1 - the Description form's catalogues speak the interface language: genre
 * names, category titles and language names are picked by `UiLanguage` (`uk` included) with
 * the English name as the fallback when a catalogue entry lacks the language.
 */

import {
  categoryTitle,
  genreName,
  groupGenres,
  languageName,
  localName,
  normaliseGenres,
  normaliseLanguages,
} from '@/views/description/resources';

const genres = normaliseGenres({
  entries: [
    {
      code: 'sf_history',
      category: 'sf',
      names: {
        en: 'Alternative history',
        ru: 'Альтернативная история',
        uk: 'Альтернативна історія',
      },
      source: 'standard',
    },
    {
      code: 'sf_litrpg',
      category: 'sf',
      names: { en: 'LitRPG', ru: 'ЛитРПГ' },
      source: 'user:mine.genres.tsv',
    },
  ],
  categories: [
    { key: 'sf', titles: { en: 'SF, Fantasy', ru: 'Фантастика, Фэнтези', uk: 'Химерна' } },
  ],
  userFiles: [],
  effectiveSources: [],
  issues: [],
});

const languages = normaliseLanguages({
  groups: [
    {
      key: 'main',
      title: { en: 'Main', ru: 'Основные', uk: 'Основні' },
      languages: [
        { code: 'uk', name: { en: 'Ukrainian', ru: 'Украинский', uk: 'Українська' } },
        { code: 'xx', name: { en: 'Example' } },
      ],
    },
  ],
});

describe('description catalogues under the Ukrainian interface', () => {
  it('picks the Ukrainian genre name, category title and language name', () => {
    expect(genreName(genres, 'sf_history', 'uk')).toBe('Альтернативна історія');
    expect(genreName(genres, 'sf_history', 'ru')).toBe('Альтернативная история');
    expect(genreName(genres, 'sf_history', 'en')).toBe('Alternative history');
    expect(categoryTitle(genres, 'sf', 'uk')).toBe('Химерна');
    expect(groupGenres(genres, 'uk', '')[0]?.title).toBe('Химерна');
    expect(languageName(languages, 'uk', 'uk')).toBe('Українська');
  });

  it('falls back to English when an entry has no Ukrainian name', () => {
    expect(genreName(genres, 'sf_litrpg', 'uk')).toBe('LitRPG');
    expect(languageName(languages, 'xx', 'uk')).toBe('Example');
    expect(localName({ ru: 'Только по-русски' }, 'uk', 'code')).toBe('Только по-русски');
    expect(localName(undefined, 'uk', 'code')).toBe('code');
    expect(localName({}, 'uk', 'code')).toBe('code');
  });

  it('matches the filter against the Ukrainian name too', () => {
    expect(groupGenres(genres, 'uk', 'історія')[0]?.entries.map((e) => e.code)).toEqual([
      'sf_history',
    ]);
    expect(groupGenres(genres, 'uk', 'nothing')).toEqual([]);
  });
});
