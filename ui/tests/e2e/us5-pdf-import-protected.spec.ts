/**
 * Feature 016 (User Story 5; tasks T052): protected and hostile PDFs (D4, D19, D26, D27). A password is asked for,
 * asked again after a wrong one, and Cancel changes nothing; a PDF that forbids copying its text asks for its
 * owner's password; hostile files end in a message; a PDF of pictures only is refused; a PDF given on the command
 * line is refused, pointing to the import.
 */
import path from 'node:path';

import { expect, shownDocId, startCoreWith, test } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import {
  answerPassword,
  importPdfViaMenu,
  pdf,
  PdfImportFailed,
  pdfImportDone,
} from './fixtures/pdfImport';
import { scratchDir } from './fixtures/scratch';

const failure = (promise: Promise<string>): Promise<string> =>
  promise.then(
    () => '',
    (error: unknown) => (error instanceof PdfImportFailed ? error.message : String(error)),
  );

test.describe('US5 (feature 016) - protected and hostile PDFs', () => {
  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('a password is asked for, again after a wrong one; the right one imports (1)', async ({
    core,
    page,
  }) => {
    const before = await importPdfViaMenu(core, page, pdf('password-user.pdf'));
    await answerPassword(page, 'not the password');
    await expect(page.getByTestId('dialog-pdf-password')).toContainText('not right', {
      timeout: 15_000,
    });
    await answerPassword(page, 'secret');
    await pdfImportDone(page, before);
    expect(await bookXml(core, page)).toContain('harbour town');
  });

  test('Cancel at the password changes nothing (1)', async ({ core, page }) => {
    const before = await importPdfViaMenu(core, page, pdf('password-user.pdf'));
    const dialog = page.getByTestId('dialog-pdf-password');
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await shownDocId(page)).toBe(before);
  });

  test("a PDF that forbids copying its text asks for its owner's password (2)", async ({
    core,
    page,
  }) => {
    let before = await importPdfViaMenu(core, page, pdf('copy-restricted.pdf'));
    await expect(page.getByTestId('dialog-pdf-password')).toContainText('does not allow copying', {
      timeout: 15_000,
    });
    await answerPassword(page, 'owner');
    await pdfImportDone(page, before);
    expect(await bookXml(core, page)).toContain('harbour town');
    before = await importPdfViaMenu(core, page, pdf('copy-restricted.pdf'));
    await page.getByTestId('dialog-pdf-password').getByRole('button', { name: 'Cancel' }).click();
    expect(await shownDocId(page)).toBe(before);
  });

  for (const [name, words] of [
    ['hostile/truncated.pdf', 'damaged'],
    ['hostile/many-pages.pdf', 'damaged'],
    ['hostile/huge-picture.pdf', 'no text'],
    ['pictures-only.pdf', 'no text'],
  ] as const) {
    test(`${name} ends in a message, the window's book unchanged (3, 4)`, async ({
      core,
      page,
    }) => {
      const before = await importPdfViaMenu(core, page, pdf(name));
      expect(await failure(pdfImportDone(page, before))).toContain(words);
      expect(await shownDocId(page)).toBe(before);
    });
  }
});

test.describe('US5 (feature 016) - a PDF given on the command line', () => {
  test('is refused, pointing to the import (5, D4)', async ({ browser }) => {
    // The shell sends a file given on the command line and a file dropped on the window alike (app.openPaths).
    const binary = process.env.MFBE_CORE_BIN ?? '';
    test.skip(!/mfbe-core/.test(path.basename(binary)), 'needs the real mfbe-core binary');
    const second = await startCoreWith(binary, scratchDir('pdf-open-'), [
      '--open',
      pdf('text-untagged.pdf'),
    ]);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(second.url);
      await expect(page.getByTestId('dialog-pdf-refused')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('dialog-pdf-refused')).toContainText(
        'File > Import > PDF File',
      );
    } finally {
      await context.close();
      await second.stop();
    }
  });
});
