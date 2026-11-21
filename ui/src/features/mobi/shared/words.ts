/**
 * Feature 018 (T014, contracts/mobi-export.md §5): added book-language labels for MOBI/KF8 exports.
 * Written in the book's language (`en`, `ru`, `uk`; fallback `en`), independent of the editor UI locale.
 */

export type MobiWordsLanguage = 'en' | 'ru' | 'uk';

export interface MobiBookWords {
  cover: string;
  titlePage: string;
  annotation: string;
  contents: string;
  start: string;
  notes: string;
  revisionHistory: string;
  version: string;
}

export const MOBI_BOOK_WORDS: Readonly<Record<MobiWordsLanguage, MobiBookWords>> = {
  en: {
    cover: 'Cover',
    titlePage: 'Title page',
    annotation: 'Annotation',
    contents: 'Contents',
    start: 'Start',
    notes: 'Notes',
    revisionHistory: 'Revision history',
    version: 'Version',
  },
  ru: {
    cover: 'Обложка',
    titlePage: 'Титульная страница',
    annotation: 'Аннотация',
    contents: 'Содержание',
    start: 'Начало',
    notes: 'Примечания',
    revisionHistory: 'История изменений',
    version: 'Версия',
  },
  uk: {
    cover: 'Обкладинка',
    titlePage: 'Титульна сторінка',
    annotation: 'Анотація',
    contents: 'Зміст',
    start: 'Початок',
    notes: 'Примітки',
    revisionHistory: 'Історія змін',
    version: 'Версія',
  },
};

/** Primary subtag of the book's language ("ru-RU" -> "ru", "uk-UA" -> "uk"), else "en". */
export function mobiWordsLanguage(bookLanguage: string | null | undefined): MobiWordsLanguage {
  const primary = (bookLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'ru' || primary === 'uk' ? primary : 'en';
}

export function mobiBookWords(bookLanguage: string | null | undefined): MobiBookWords {
  return MOBI_BOOK_WORDS[mobiWordsLanguage(bookLanguage)];
}
