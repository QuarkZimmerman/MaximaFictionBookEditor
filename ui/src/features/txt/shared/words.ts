/**
 * Feature 017 (D14, DP-8; specs/017-txt-export-import/contracts/txt-format.md §4): the words the TXT
 * export writes into the file - the record's labels, the line naming the editor, "Note" and "Image".
 * They belong to the book, so they are in the book's language when the editor has it (English,
 * Russian, Ukrainian) and in English otherwise, whatever the interface language, as the EPUB and PDF
 * exports' words. The import reads the labels of all three languages back (`RECORD_WORDS`).
 */

export type TxtWordsLanguage = 'en' | 'ru' | 'uk';

/** A label for one value and for several. */
export interface Plural {
  one: string;
  many: string;
}

export interface TxtWords {
  title: string;
  series: string;
  authors: Plural;
  translators: Plural;
  illustrators: Plural;
  editors: Plural;
  compilers: Plural;
  designers: Plural;
  commentators: Plural;
  aboutTheAuthor: string;
  genres: Plural;
  language: string;
  originalLanguage: string;
  date: string;
  keywords: string;
  publisher: string;
  city: string;
  year: string;
  isbn: string;
  /** The record's last line, before the version (D5). */
  madeWith: string;
  note: string;
  image: string;
}

export const TXT_WORDS: Readonly<Record<TxtWordsLanguage, TxtWords>> = {
  en: {
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
    madeWith: 'Made with Maxima Fiction Book Editor',
    note: 'Note',
    image: 'Image',
  },
  ru: {
    title: 'Название',
    series: 'Серия',
    authors: { one: 'Автор', many: 'Авторы' },
    translators: { one: 'Переводчик', many: 'Переводчики' },
    illustrators: { one: 'Иллюстратор', many: 'Иллюстраторы' },
    editors: { one: 'Редактор', many: 'Редакторы' },
    compilers: { one: 'Составитель', many: 'Составители' },
    designers: { one: 'Оформитель', many: 'Оформители' },
    commentators: { one: 'Комментатор', many: 'Комментаторы' },
    aboutTheAuthor: 'Об авторе',
    genres: { one: 'Жанр', many: 'Жанры' },
    language: 'Язык',
    originalLanguage: 'Язык оригинала',
    date: 'Дата',
    keywords: 'Ключевые слова',
    publisher: 'Издательство',
    city: 'Город',
    year: 'Год',
    isbn: 'ISBN',
    madeWith: 'Сделано в Maxima Fiction Book Editor',
    note: 'Примечание',
    image: 'Иллюстрация',
  },
  uk: {
    title: 'Назва',
    series: 'Серія',
    authors: { one: 'Автор', many: 'Автори' },
    translators: { one: 'Перекладач', many: 'Перекладачі' },
    illustrators: { one: 'Ілюстратор', many: 'Ілюстратори' },
    editors: { one: 'Редактор', many: 'Редактори' },
    compilers: { one: 'Упорядник', many: 'Упорядники' },
    designers: { one: 'Оформлювач', many: 'Оформлювачі' },
    commentators: { one: 'Коментатор', many: 'Коментатори' },
    aboutTheAuthor: 'Про автора',
    genres: { one: 'Жанр', many: 'Жанри' },
    language: 'Мова',
    originalLanguage: 'Мова оригіналу',
    date: 'Дата',
    keywords: 'Ключові слова',
    publisher: 'Видавництво',
    city: 'Місто',
    year: 'Рік',
    isbn: 'ISBN',
    madeWith: 'Зроблено в Maxima Fiction Book Editor',
    note: 'Примітка',
    image: 'Ілюстрація',
  },
};

/** The language of the added words: the primary subtag of the book's language, else English. */
export function txtWordsLanguage(bookLanguage: string | null | undefined): TxtWordsLanguage {
  const primary = (bookLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'ru' || primary === 'uk' ? primary : 'en';
}

export function txtWords(bookLanguage: string | null | undefined): TxtWords {
  return TXT_WORDS[txtWordsLanguage(bookLanguage)];
}
