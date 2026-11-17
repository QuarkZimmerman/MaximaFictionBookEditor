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
  test('pictures in JPEG 2000, JBIG2 and CCITT fax come in (scenario 5)', async ({
    core,
    page,
  }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('picture-formats.pdf')));
    const xml = await bookXml(core, page);
    expect((xml.match(/<binary /g) ?? []).length).toBe(3);
  });

  test('two columns read column by column (scenario 6)', async ({ core, page }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('two-columns.pdf')));
    const xml = await bookXml(core, page);
    expect(xml.indexOf('First column, line 14')).toBeGreaterThan(0);
    expect(xml.indexOf('First column, line 14')).toBeLessThan(
      xml.indexOf('Second column, line 1 '),
    );
  });

  test('Cyrillic written in Latin-1 letters comes back in Cyrillic (scenario 7, D15)', async ({
    core,
    page,
  }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('latin1-cyrillic.pdf')));
    const xml = await bookXml(core, page);
    expect(xml).toContain('Но ничего не случилось');
    expect(xml).not.toContain('Íî');
  });

  test('a chart is a picture, its comment counted; forms by rows as a table, others drawn (scenario 8, D16)', async ({
    core,
    page,
  }) => {
    const summary = await pdfImportDone(
      page,
      await importPdfViaMenu(core, page, pdf('drawing.pdf')),
    );
    let xml = await bookXml(core, page);
    expect((xml.match(/<binary /g) ?? []).length).toBe(1);
    expect(xml).toContain('Cell one');
    // The chart's labels are in its picture, not in the text (the pictures' bytes left out of the look).
    expect(xml.replace(/<binary[\s\S]*?<\/binary>/g, '')).not.toContain('Q1');
    expect(summary).toContain('Comments and other notes on the pages, left out: 1');
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('forms.pdf')));
    xml = await bookXml(core, page);
    expect(xml).toMatch(/<tr>\s*<td>Name:<\/td>\s*<td>Ann Example<\/td>\s*<\/tr>/);
    expect((xml.match(/<binary /g) ?? []).length).toBe(0);
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('form-free.pdf')));
    xml = await bookXml(core, page);
    expect((xml.match(/<binary /g) ?? []).length).toBe(1);
  });
});
