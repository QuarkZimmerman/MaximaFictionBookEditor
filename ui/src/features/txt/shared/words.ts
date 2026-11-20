/**
 * Feature 017 (D14, DP-8; specs/017-txt-export-import/contracts/txt-format.md §3, §4): the words the
 * TXT export writes into the file. The record of the description and the line naming the editor are
 * always in English, whatever the book's language - they are the editor's own format, which the import
 * reads back (the requester, 2026-11-17: "use same language on all metadata field names"). The words
 * inside the text - "Note" and "Image" - are for the reader, so they are in the book's language when
 * the editor has it (English, Russian, Ukrainian) and in English otherwise.
 */

export type TxtWordsLanguage = 'en' | 'ru' | 'uk';

/** A label for one value and for several. */
export interface Plural {
  one: string;
  many: string;
}

/** The record's labels (English only). */
export const RECORD_WORDS = {
  title: 'Title',
  series: 'Series',
  authors: { one: 'Author', many: 'Authors' },
  translators: { one: 'Translator', many: 'Translators' },
  illustrators: { one: 'Illustrator', many: 'Illustrators' },
  editors: { one: 'Editor', many: 'Editors' },
  compilers: { one: 'Compiler', many: 'Compilers' },
  designers: { one: 'Designer', many: 'Designers' },
  commentators: { one: 'Commentator', many: 'Commentators' },
  aboutTheAuthor: 'About the author',
  genres: { one: 'Genre', many: 'Genres' },
  language: 'Language',
  originalLanguage: 'Original language',
  date: 'Date',
  keywords: 'Keywords',
  publisher: 'Publisher',
  city: 'City',
  year: 'Year',
  isbn: 'ISBN',
  /** The record's last line, before the version (D5). */
  madeWith: 'Made with Maxima Fiction Book Editor',
} as const;

export type RecordWords = typeof RECORD_WORDS;

/** The words inside the text, in the book's language. */
export interface TxtWords {
  note: string;
  image: string;
}

export const TXT_WORDS: Readonly<Record<TxtWordsLanguage, TxtWords>> = {
  en: { note: 'Note', image: 'Image' },
  ru: { note: 'Примечание', image: 'Иллюстрация' },
  uk: { note: 'Примітка', image: 'Ілюстрація' },
};

/** The language of the text's words: the primary subtag of the book's language, else English. */
export function txtWordsLanguage(bookLanguage: string | null | undefined): TxtWordsLanguage {
  const primary = (bookLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'ru' || primary === 'uk' ? primary : 'en';
}

export function txtWords(bookLanguage: string | null | undefined): TxtWords {
  return TXT_WORDS[txtWordsLanguage(bookLanguage)];
}
