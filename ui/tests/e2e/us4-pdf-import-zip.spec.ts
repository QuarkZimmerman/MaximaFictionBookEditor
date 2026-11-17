/**
 * Feature 016 (User Story 4; tasks T049): PDFs in ZIP archives, with their FBD descriptions (D21 to D24), on the
 * generated archives of tests/fixtures/pdf/import/zip/: one PDF and one FBD, several PDFs and FBDs matched by
 * name, no FBD of the PDF's name (the list with None), an FBD that cannot be read, archives refused, and the
 * editor's own PDF with the same and with another description.
 */
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { importPdfViaMenu, pdf, PdfImportFailed, pdfImportDone } from './fixtures/pdfImport';

const zip = (name: string): string => pdf(`zip/${name}.zip`);

/** Picks the row naming `name` in the archive chooser and confirms it. */
async function choose(page: Page, name: string): Promise<void> {
  const chooser = page.getByTestId('archive-chooser');
  await expect(chooser).toBeVisible({ timeout: 15_000 });
  await chooser
    .locator('[data-testid^="archive-chooser-row-"]')
    .filter({ hasText: name })
    .first()
    .click();
  await page.getByTestId('archive-chooser-button-ok').click();
}

/** Answers the message `testId` with `button` (yes, no, cancel, ok). */
async function answer(page: Page, testId: string, button: string): Promise<string> {
  const dialog = page.getByTestId(testId);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const text = (await dialog.textContent()) ?? '';
  await page.getByTestId(`${testId}-button-${button}`).click();
  return text;
}

const title = (xml: string): string => /<book-title>([^<]*)<\/book-title>/.exec(xml)?.[1] ?? '';

test.describe('US4 (feature 016) - PDFs in ZIP archives, with their FBDs', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test("one PDF and one FBD: asked, naming the FBD; Yes gives its description and cover, No the PDF's (1)", async ({
    core,
    page,
  }) => {
    let before = await importPdfViaMenu(core, page, zip('one'));
    expect(await answer(page, 'dialog-pdf-fbd-take', 'yes')).toContain('book-description.fbd');
    await pdfImportDone(page, before);
    let xml = await bookXml(core, page);
    expect(title(xml)).toBe('The FBD Title');
    expect(xml).toContain('<last-name>Fbd</last-name>');
    expect(xml).toMatch(/<coverpage>\s*<image l:href="#[^"]+"\/>/);
    before = await importPdfViaMenu(core, page, zip('one'));
    await answer(page, 'dialog-pdf-fbd-take', 'no');
    await pdfImportDone(page, before);
    xml = await bookXml(core, page);
    expect(title(xml)).toBe('The Generated Book');
  });

  test('several PDFs: asked which; the FBD of its name asked about, in any folder and case (2, 3)', async ({
    core,
    page,
  }) => {
    const before = await importPdfViaMenu(core, page, zip('several'));
    await choose(page, 'second.pdf');
    expect(await answer(page, 'dialog-pdf-fbd-take', 'yes')).toContain('SECOND.fbd');
    await pdfImportDone(page, before);
    expect(title(await bookXml(core, page))).toBe('Second FBD');
  });

  test("no FBD of the PDF's name: every FBD listed, with None, the chosen one taken (4)", async ({
    core,
    page,
  }) => {
    let before = await importPdfViaMenu(core, page, zip('nomatch'));
    await choose(page, 'x.pdf');
    await choose(page, 'two.fbd');
    await pdfImportDone(page, before);
    expect(title(await bookXml(core, page))).toBe('Two FBD');
    before = await importPdfViaMenu(core, page, zip('nomatch'));
    await choose(page, 'x.pdf');
    await choose(page, 'None');
    await pdfImportDone(page, before);
    expect(title(await bookXml(core, page))).toBe('The Generated Book');
  });

  test("an FBD that cannot be read is named with its problem; the PDF's description is taken (6)", async ({
    core,
    page,
  }) => {
    const before = await importPdfViaMenu(core, page, zip('bad-fbd'));
    await answer(page, 'dialog-pdf-fbd-take', 'yes');
    expect(await answer(page, 'dialog-pdf-fbd-unreadable', 'ok')).toContain('book.fbd');
    await pdfImportDone(page, before);
    expect(title(await bookXml(core, page))).toBe('The Generated Book');
  });

  for (const [name, words] of [
    ['nopdf', 'the archive holds no PDF'],
    ['encrypted', 'protected by a password'],
    ['bomb', 'larger than the import reads'],
    ['damaged', 'damaged'],
  ] as const) {
    test(`${name}.zip is refused with its reason (5, 7)`, async ({ core, page }) => {
      const before = await importPdfViaMenu(core, page, zip(name));
      const refused = await pdfImportDone(page, before).then(
        () => '',
        (error: unknown) => (error instanceof PdfImportFailed ? error.message : String(error)),
      );
      expect(refused).toContain(words);
    });
  }

  test("the editor's own PDF: one question naming both descriptions; none when they are the same (8)", async ({
    core,
    page,
  }) => {
    let before = await importPdfViaMenu(core, page, zip('own-other'));
    expect(await answer(page, 'dialog-pdf-fbd-which', 'no')).toContain('reference.fbd');
    await pdfImportDone(page, before);
    expect(title(await bookXml(core, page))).toBe('Another Title');
    before = await importPdfViaMenu(core, page, zip('own-other'));
    await answer(page, 'dialog-pdf-fbd-which', 'yes');
    await pdfImportDone(page, before);
    expect(title(await bookXml(core, page))).toBe('The Reference Book');
    before = await importPdfViaMenu(core, page, zip('own-same'));
    await pdfImportDone(page, before);
    await expect(page.getByTestId('dialog-pdf-fbd-which')).toHaveCount(0);
    expect(title(await bookXml(core, page))).toBe('The Reference Book');
  });
});
