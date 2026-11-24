/**
 * Feature 016 (User Story 1; tasks T026): the editor's own PDF comes back as the book it was. Runs against
 * the real core and the real reader process with the reference book as 0.0.11 exported it
 * (tests/fixtures/pdf/import/reference-0.0.11-a5.pdf).
 */
import { expect, shownDocId, test } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { importPdfViaMenu, pdf, pdfImportDone } from './fixtures/pdfImport';

test.describe("US1 (feature 016) - the editor's own PDF comes back as its book", () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('the reference book comes back: description, sections, marks, notes, pictures (D5, D6)', async ({
    core,
    page,
  }) => {
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('reference-0.0.11-a5.pdf')));
    const xml = await bookXml(core, page);
    expect(xml).toContain('<book-title>The Reference Book</book-title>');
    expect(xml).toMatch(
      /<annotation>\s*<p>The annotation of the reference book\.<\/p>\s*<\/annotation>/,
    );
    expect(xml).toMatch(/<section id="ch1">/);
    expect(xml).toContain('<strikethrough>struck</strikethrough>');
    expect(xml).toContain('H<sub>2</sub>O');
    expect(xml).toMatch(/<a l:href="#n1" type="note">\[1\]<\/a>/);
    expect(xml).toMatch(/<body name="notes">/);
    for (const id of ['cover', 'pic-jpg', 'pic-png']) expect(xml).toContain(`<binary id="${id}"`);
    expect(xml).toMatch(/<stanza>\s*<v>Another stanza\.<\/v>\s*<\/stanza>/);
  });

  test('the import asks about unsaved changes first, and ends on the status line (D2, D31)', async ({
    core,
    page,
  }) => {
    // A book made by an import is unsaved: a second import asks before it replaces it.
    await pdfImportDone(page, await importPdfViaMenu(core, page, pdf('reference-0.0.11-a5.pdf')));
    const before = await shownDocId(page);
    await core.enqueueDialog('dialog.openFile', {
      paths: [pdf('reference-0.0.11-a5.pdf')],
      checks: { useOcr: true },
    });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.getByTestId('menu-file-import-importPdf').click();
    const question = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
    await expect(question).toBeVisible({ timeout: 15_000 });
    await question.getByRole('button', { name: 'No' }).click();
    await pdfImportDone(page, before);
    await expect(page.getByTestId('status-message')).toContainText('Imported from PDF');
  });

  test("Cancel during the read leaves the window's book as it was (D30)", async ({
    core,
    page,
  }) => {
    // The page model comes slowly, so that Cancel arrives while it is read.
    await page.route('**/pdf-import/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const before = await importPdfViaMenu(core, page, pdf('reference-0.0.11-a5.pdf'));
    await expect(page.getByTestId('modal-job')).toBeVisible();
    await page.getByTestId('modal-job-cancel').click();
    await expect(page.getByTestId('modal-job')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('status-message')).toContainText('cancelled');
    expect(await shownDocId(page)).toBe(before);
    await page.unroute('**/pdf-import/**');
  });

  test('File > Open refuses a PDF, pointing to the import (D4)', async ({ core, page }) => {
    await core.enqueueDialog('dialog.openFile', {
      paths: [pdf('reference-0.0.11-a5.pdf')],
      checks: { useOcr: true },
    });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    const refused = page.getByTestId('dialog-pdf-refused');
    await expect(refused).toBeVisible({ timeout: 15_000 });
    await expect(refused).toContainText('File > Import > PDF File');
    await refused.getByRole('button', { name: 'OK' }).click();
  });
});
