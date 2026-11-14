/**
 * Feature 014 (D11, FR-010): the few words the PDF export adds to the book itself - the cover
 * picture's alternative text, the bookmarks of the cover and the title page, and the heading of the
 * notes when they have no title of their own. They belong to the book, so they are written in the
 * book's language when the editor has it (English, Russian, Ukrainian) and in English otherwise,
 * whatever the interface language, as the EPUB export's (012 FR-016). They are the EPUB export's
 * words (src/features/epub/shared/words.ts), kept here so that the PDF export's chunk does not load
 * the EPUB export's; tests/unit/pdf/words.test.ts keeps the two equal. The bookmarks of the
 * annotation's page and of the revision history's page are the PDF export's own (requester, rc.4).
 */

export type WordsLanguage = 'en' | 'ru' | 'uk';

export interface PdfWords {
  cover: string;
  titlePage: string;
  notes: string;
  /** The bookmark of the annotation's page (the page itself has no heading; requester, rc.4). */
  annotation: string;
  /** The bookmark of the closing page, the document's history (requester, rc.4). */
  revisionHistory: string;
}

export const PDF_WORDS: Readonly<Record<WordsLanguage, PdfWords>> = {
  en: {
    cover: 'Cover',
    titlePage: 'Title page',
    notes: 'Notes',
    annotation: 'Annotation',
    revisionHistory: 'Revision history',
  },
  ru: {
    cover: 'Обложка',
    titlePage: 'Титульная страница',
    notes: 'Примечания',
    annotation: 'Аннотация',
    revisionHistory: 'История изменений',
  },
  uk: {
    cover: 'Обкладинка',
    titlePage: 'Титульна сторінка',
    notes: 'Примітки',
    annotation: 'Анотація',
    revisionHistory: 'Історія змін',
  },
};

/** The language of the added words: the primary subtag of the book's language, else English. */
export function wordsLanguage(bookLanguage: string | null | undefined): WordsLanguage {
  const primary = (bookLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return primary === 'ru' || primary === 'uk' ? primary : 'en';
}

export function pdfWords(bookLanguage: string | null | undefined): PdfWords {
  return PDF_WORDS[wordsLanguage(bookLanguage)];
}
