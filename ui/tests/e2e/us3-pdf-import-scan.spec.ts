/**
 * Feature 016 (User Story 3; tasks T044): scanned books with a text layer come in as their text - the layer
 * read in reading order and paragraphs, invisible over the page pictures or under them; words broken with
 * soft hyphens whole; running heads and page numbers left out; the first page's picture the cover and no other
 * page picture in the book; recognition errors as the layer has them; PDFs without clean text refused with the
 * number of pages concerned; covers, blank pages and plates fine, counted by the summary (D12, D14, D17, D19).
 */
import { readFileSync } from 'node:fs';

import { expect, test } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { importPdfViaMenu, pdf, PdfImportFailed, pdfImportDone } from './fixtures/pdfImport';

const expected = (name: string): { contains?: string[]; absent?: string[]; notImported?: number } =>
  JSON.parse(readFileSync(pdf(name).replace(/\.pdf$/, '.expected.json'), 'utf8'));

test.describe('US3 (feature 016) - scanned books with a text layer', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  for (const name of ['scan-invisible.pdf', 'scan-under.pdf']) {
    test(`${name}: the layer's text in paragraphs, whole words, no furniture, the cover, the summary (scenarios 1 to 6, 8)`, async ({
      core,
      page,
    }) => {
      const summary = await pdfImportDone(page, await importPdfViaMenu(core, page, pdf(name)));
      const xml = await bookXml(core, page);
      const want = expected(name);
      // 1, 2: the text in reading order, in paragraphs as the pages show them.
      for (const word of want.contains ?? []) expect(xml).toContain(word);
      expect((xml.match(/<p>/g) ?? []).length).toBeGreaterThanOrEqual(2);
      // 3: the soft hyphen's word whole.
      expect(xml).not.toMatch(/hyphen[\u00ad-]?\s+ated/);
      // 4: neither the running head nor the page numbers.
      for (const absent of want.absent ?? []) expect(xml).not.toContain(`<p>${absent}</p>`);
      expect(xml).not.toMatch(/<p>\s*[23]\s*<\/p>/);
      // 5: the first page's picture is the cover; no other page picture is in the book.
      expect(xml).toMatch(/<coverpage>\s*<image l:href="#cover"\/>\s*<\/coverpage>/);
      expect((xml.match(/<binary /g) ?? []).length).toBe(1);
      // 6: a recognition error comes in as the layer has it.
      expect(xml).toContain('earIy');
      // 8: the blank page is not in the book, and the summary counts it.
      expect(summary).toContain(
        `Pages without text not imported (blank pages, plates of a scanned book): ${want.notImported}`,
      );
    });
  }

  for (const [name, words] of [
    ['picture-of-text.pdf', '2 pages show text but have no text layer'],
    ['garbled.pdf', 'reads mostly as garbage (2 pages)'],
    ['pictures-only.pdf', 'no text (2 pages)'],
  ] as const) {
    test(`${name} is refused with the reason and the pages concerned (scenario 7)`, async ({
      core,
      page,
    }) => {
      const before = await importPdfViaMenu(core, page, pdf(name), { useOcr: false });
      const refused = await pdfImportDone(page, before).then(
        () => '',
        (error: unknown) => (error instanceof PdfImportFailed ? error.message : String(error)),
      );
      expect(refused).toContain(words);
    });
  }
});
