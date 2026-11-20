/**
 * Feature 017, User Story 7 (tasks T055): the other imports and the FBD beside the file - a Markdown and an
 * EPUB file the editor did not make take the FBD with their name without a question, a PDF after its question
 * (D39); and after every import the first Save As proposes what a new book proposes, nothing of the source's
 * name or folder (D25, SC-010, SC-015).
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, shownDocId, test, type CoreHandle } from './fixtures/core';
import { importDone, importViaMenu } from './fixtures/epubImport';
import { importPdfViaMenu, pdfImportDone } from './fixtures/pdfImport';
import { scratchDir } from './fixtures/scratch';
import { bookXml } from './fixtures/txt';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures',
);
const FBD_TITLE = '<book-title>Только описание</book-title>';

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

/** `source` copied as <dir>/Book.<ext>, with descriptor.fbd beside it as Book.fbd. */
function besideFbd(source: string, ext: string): string {
  const dir = scratchDir(`fbd-beside-${ext}-`);
  copyFileSync(source, path.join(dir, `Book.${ext}`));
  copyFileSync(fixtureBook('descriptor.fbd'), path.join(dir, 'Book.fbd'));
  return path.join(dir, `Book.${ext}`);
}

/** SC-015: the first Save As after the import proposes a bare name, as a new book does (D25). */
async function expectNewBookProposal(core: CoreHandle, page: Page): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', { path: null });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  const invalid = page.getByTestId('dialog-validation-failed-button-yes');
  if (
    await invalid.waitFor({ state: 'visible', timeout: 3000 }).then(
      () => true,
      () => false,
    )
  )
    await invalid.click();
  await expect
    .poll(async () => {
      const requests =
        await core.rpc<{ method: string; defaultPath?: string }[]>('test.dialogRequests');
      return requests.filter((r) => r.method === 'dialog.saveFile').at(-1)?.defaultPath ?? '';
    })
    .toMatch(/^[^/\\]+\.fb2$/);
}

test('a foreign Markdown file takes the FBD beside it (D39)', async ({ core, page }) => {
  await core.openApp(page);
  const source = path.join(scratchDir('fbd-beside-md-source-'), 'plain.md');
  writeFileSync(source, '# A plain Markdown book\n\nIts only paragraph.\n');
  const file = besideFbd(source, 'md');
  const before = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMarkdown').click();
  await expect
    .poll(
      async () =>
        (await shownDocId(page)) !== before && !(await page.getByTestId('modal-job').isVisible()),
      {
        timeout: 60_000,
      },
    )
    .toBe(true);
  const summary = page.getByTestId('dialog-markdown-import-summary');
  if (await summary.isVisible()) await summary.getByRole('button', { name: 'OK' }).click();
  expect(await bookXml(page)).toContain(FBD_TITLE);
  await expectNewBookProposal(core, page);
});

test('a foreign EPUB takes the FBD beside it (D39)', async ({ core, page }) => {
  await core.openApp(page);
  const file = besideFbd(path.join(FIXTURES, 'epub', 'calibre-like.epub'), 'epub');
  const before = await importViaMenu(core, page, file);
  await importDone(page, before);
  expect(await bookXml(page)).toContain(FBD_TITLE);
  await expectNewBookProposal(core, page);
});

test('a foreign PDF asks about the FBD beside it, and Yes takes it (D39)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const file = besideFbd(path.join(FIXTURES, 'pdf', 'import', 'text-untagged.pdf'), 'pdf');
  const before = await importPdfViaMenu(core, page, file);
  const question = page.getByTestId('dialog-pdf-fbd-take');
  await expect(question).toBeVisible({ timeout: 60_000 });
  await question.getByRole('button', { name: 'Yes' }).click();
  await pdfImportDone(page, before);
  expect(await bookXml(page)).toContain(FBD_TITLE);
  await expectNewBookProposal(core, page);
});
