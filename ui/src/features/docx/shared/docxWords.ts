/**
 * Feature 023 (T012; FR-010): export-added structural headings written in the book's language for
 * English, Russian, and Ukrainian, and in English for all other languages.
 */

export type DocxWordsLang = 'en' | 'ru' | 'uk';

export interface DocxAddedWords {
  contents: string;
  annotation: string;
  notes: string;
  history: string;
  version: string;
  untitled: string;
}

const WORDS: Record<DocxWordsLang, DocxAddedWords> = {
  en: {
    contents: 'Table of Contents',
    annotation: 'Annotation',
    notes: 'Notes',
    history: 'Revision History',
    version: 'Version',
    untitled: 'Untitled',
  },
  ru: {
    contents: 'Содержание',
    annotation: 'Аннотация',
    notes: 'Примечания',
    history: 'История изменений',
    version: 'Версия',
    untitled: 'Без названия',
  },
  uk: {
    contents: 'Зміст',
    annotation: 'Анотація',
    notes: 'Примітки',
    history: 'Історія змін',
    version: 'Версія',
    untitled: 'Без назви',
  },
};

export function docxWordsLanguage(bookLang: string | undefined): DocxWordsLang {
  const primary = (bookLang ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'ru' || primary === 'rus') return 'ru';
  if (primary === 'uk' || primary === 'ukr' || primary === 'ua') return 'uk';
  return 'en';
}

export function docxAddedWords(bookLang: string | undefined): DocxAddedWords {
  return WORDS[docxWordsLanguage(bookLang)];
}
