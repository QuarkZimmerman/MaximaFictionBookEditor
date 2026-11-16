/**
 * Feature 016 (User Story 2; tasks T034): PDFs not made by the editor - made from text, and tagged - come in
 * best effort: their text in order, paragraphs, headings, the description from the document information.
 */
import { expect, test } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { importPdfViaMenu, pdf, pdfImportDone } from './fixtures/pdfImport';

test.describe('US2 (feature 016) - a PDF made from text, best effort', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('an untagged text PDF: title, author, headings, paragraphs, furniture left out (D11 to D13)', async ({
    core,
    page,
  }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('text-untagged.pdf')));
    const xml = await bookXml(core, page);
    expect(xml).toContain('<book-title>The Generated Book</book-title>');
    expect(xml).toMatch(/<last-name>Example<\/last-name>/);
    expect(xml).toMatch(/<title>\s*<p>Chapter One<\/p>\s*<\/title>/);
    expect(xml).toContain('harbour town');
    expect(xml).not.toMatch(/<p>The Generated Book<\/p>/);
  });

  test('a tagged PDF: its structure gives the headings, the list items and the table (D11)', async ({
    core,
    page,
  }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('tagged.pdf')));
    const xml = await bookXml(core, page);
    expect(xml).toMatch(/<title>\s*<p>Heading One<\/p>/);
    expect(xml).toContain('First item');
    expect(xml).toMatch(/<td>Cell one<\/td>/);
  });
});
