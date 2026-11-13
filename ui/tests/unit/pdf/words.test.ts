/**
 * Feature 014 (D11, FR-010): the words the PDF export adds follow the book's language and are the
 * EPUB export's words.
 */
import { describe, expect, it } from 'vitest';

import { BOOK_WORDS } from '@/features/epub/shared/words';
import { PDF_WORDS, pdfWords, wordsLanguage } from '@/features/pdf/export/words';

describe('the words the PDF export adds (FR-010)', () => {
  it('are the EPUB export words, in each language', () => {
    for (const lang of ['en', 'ru', 'uk'] as const) {
      expect(PDF_WORDS[lang]).toEqual({
        cover: BOOK_WORDS[lang].coverDescription,
        titlePage: BOOK_WORDS[lang].titlePage,
        notes: BOOK_WORDS[lang].notes,
      });
    }
  });

  it("follow the book's language, else English", () => {
    expect(wordsLanguage('ru-RU')).toBe('ru');
    expect(wordsLanguage('uk')).toBe('uk');
    expect(wordsLanguage('de')).toBe('en');
    expect(wordsLanguage(undefined)).toBe('en');
    expect(pdfWords('ru').cover).toBe('Обложка');
    expect(pdfWords('fr').notes).toBe('Notes');
  });
});
