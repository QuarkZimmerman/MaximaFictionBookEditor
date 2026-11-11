/**
 * Feature 012 (D8, D43, FR-016; research DP-22): the few words the EPUB export adds to the book itself -
 * the landmarks' names, the notes page's heading when the book's notes have no title, the cover
 * picture's description and the accessibility summary. They belong to the book, not to the editor's
 * user: they are written in the book's language when the editor has it (English, Russian, Ukrainian)
 * and in English otherwise, whatever the interface language - so they live here, beside the export,
 * and not in the interface catalogues.
 */

export type WordsLanguage = 'en' | 'ru' | 'uk';

export interface BookWords {
  cover: string;
  titlePage: string;
  start: string;
  notes: string;
  contents: string;
  coverDescription: string;
  /** D43: one sentence, by what the book holds. */
  summaryTextOnly: string;
  summaryAllAlt: string;
  summarySomeAlt: string;
}

export const BOOK_WORDS: Readonly<Record<WordsLanguage, BookWords>> = {
  en: {
    cover: 'Cover',
    titlePage: 'Title page',
    start: 'Start',
    notes: 'Notes',
    contents: 'Contents',
    coverDescription: 'Cover',
    summaryTextOnly: 'The book is text only.',
    summaryAllAlt: 'The book is text with pictures; every picture has a text alternative.',
    summarySomeAlt: 'The book is text with pictures; not every picture has a text alternative.',
  },
  ru: {
    cover: 'Обложка',
    titlePage: 'Титульная страница',
    start: 'Начало',
    notes: 'Примечания',
    contents: 'Содержание',
    coverDescription: 'Обложка',
    summaryTextOnly: 'Книга состоит только из текста.',
    summaryAllAlt: 'Книга — текст с иллюстрациями; у каждой иллюстрации есть текстовое описание.',
    summarySomeAlt: 'Книга — текст с иллюстрациями; не у всех иллюстраций есть текстовое описание.',
  },
  uk: {
    cover: 'Обкладинка',
    titlePage: 'Титульна сторінка',
    start: 'Початок',
    notes: 'Примітки',
    contents: 'Зміст',
    coverDescription: 'Обкладинка',
    summaryTextOnly: 'Книга складається лише з тексту.',
    summaryAllAlt: 'Книга — текст з ілюстраціями; кожна ілюстрація має текстовий опис.',
    summarySomeAlt: 'Книга — текст з ілюстраціями; не всі ілюстрації мають текстовий опис.',
  },
};

/** The language of the added words: the primary subtag of the book's language ("ru-RU" -> "ru"), else English. */
export function wordsLanguage(bookLanguage: string | null | undefined): WordsLanguage {
  const primary = (bookLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'ru' || primary === 'uk' ? primary : 'en';
}

export function bookWords(bookLanguage: string | null | undefined): BookWords {
  return BOOK_WORDS[wordsLanguage(bookLanguage)];
}
