/**
 * Feature 016: the PDF import's journey helpers - the generated PDFs of tests/fixtures/pdf/import/, the import
 * through the menu (the archive's PDF and the password answered when asked), and its end.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, shownDocId, type CoreHandle } from './core';

export const PDFS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/pdf/import',
);
export const pdf = (name: string): string => path.join(PDFS, name);

/**
 * File > Import > PDF File... with `file` queued for the Open dialog; resolves the document shown before.
 * The unsaved-changes question, when asked, is answered No (`question: false` skips waiting for it).
 */
export async function importPdfViaMenu(
  core: CoreHandle,
  page: Page,
  file: string,
  { question = true, useOcr = true }: { question?: boolean; useOcr?: boolean | null } = {},
): Promise<string | null> {
  const before = await shownDocId(page);
  const dialogResult = useOcr === null ? { paths: [file] } : { paths: [file], checks: { useOcr } };
  await core.enqueueDialog('dialog.openFile', dialogResult);
  await page.getByTestId('menu-file').click({ timeout: 15_000 });
  await page.getByTestId('menu-file-import').hover({ timeout: 15_000 });
  await page.getByTestId('menu-file-import-importPdf').click({ timeout: 15_000 });
  if (!question) return before;
  const dialog = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
  const asked = await dialog
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await dialog.getByRole('button', { name: 'No' }).click({ timeout: 15_000 });
  return before;
}

/** Types `password` into the password dialog and confirms it. */
export async function answerPassword(page: Page, password: string): Promise<void> {
  const dialog = page.getByTestId('dialog-pdf-password');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.locator('input').fill(password);
  await dialog.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
}

/** The import failed or was refused: its message. */
export class PdfImportFailed extends Error {}

/**
 * Waits for the end of the import started after `before` was shown: a new book in the window and the
 * progress gone, or the failure; a summary is closed and its text returned.
 */
export async function pdfImportDone(
  page: Page,
  before: string | null,
  timeout = 60_000,
): Promise<string> {
  const summary = page.getByTestId('dialog-pdf-import-summary');
  const failed = page.getByTestId('dialog-pdf-import-failed');
  const progress = page.getByTestId('modal-job');
  await expect
    .poll(
      async () =>
        (await failed.isVisible()) ||
        ((await shownDocId(page)) !== before && !(await progress.isVisible())),
      { timeout },
    )
    .toBe(true);
  if (await failed.isVisible()) {
    const text = (await failed.textContent()) ?? '';
    await failed.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
    throw new PdfImportFailed(text);
  }
  const shown = await summary
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return '';
  const text = (await summary.textContent()) ?? '';
  await summary.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
  return text;
}
