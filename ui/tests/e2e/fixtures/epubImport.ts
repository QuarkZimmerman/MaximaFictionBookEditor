/**
 * Feature 012: the EPUB import's journey helpers - the reference EPUBs of tests/fixtures/epub/, the
 * import through the menu, its end (a new book shown and the progress gone - never the status line,
 * which may still hold the previous import's message), the book as the editor saves it, and its body's
 * validation errors.
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, shownDocId, type CoreHandle } from './core';

export const EPUBS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/epub',
);
export const epub = (name: string): string => path.join(EPUBS, name);

/** Starts File > Import > EPUB File... on `file`; returns the document the window showed before. */
export async function importViaMenu(
  core: CoreHandle,
  page: Page,
  file: string,
): Promise<string | null> {
  const before = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click({ timeout: 15_000 });
  await page.getByTestId('menu-file-import').hover({ timeout: 15_000 });
  await page.getByTestId('menu-file-import-importEpub').click({ timeout: 15_000 });
  // The book a previous import made is unsaved: the editor asks first, as Open does (D15).
  const question = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
  const asked = await question
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await question.getByRole('button', { name: 'No' }).click({ timeout: 15_000 });
  return before;
}

/**
 * Waits for the end of the import started after `before` was shown: a new book in the window and
 * the progress gone (the status line may still hold the previous import's message), or the failure;
 * a summary is closed.
 */
export async function importDone(
  page: Page,
  before: string | null,
  timeout = 30_000,
): Promise<string> {
  const summary = page.getByTestId('dialog-epub-import-summary');
  const failed = page.getByTestId('dialog-epub-import-failed');
  const progress = page.getByTestId('modal-job');
  await expect
    .poll(
      async () =>
        (await failed.isVisible()) ||
        ((await shownDocId(page)) !== before && !(await progress.isVisible())),
      { timeout },
    )
    .toBe(true);
  if (await failed.isVisible()) throw new Error(`the import failed: ${await failed.textContent()}`);
  // The summary, when there is one, follows the end of the progress at once.
  const shown = await summary
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return '';
  const text = (await summary.textContent()) ?? '';
  await summary.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
  return text;
}

/** The book as the editor writes it: saved with Save As to a scratch file and read back. */
export async function bookXml(core: CoreHandle, page: Page): Promise<string> {
  const target = path.join(mkdtempSync(path.join(os.tmpdir(), 'mfbe-epub-import-')), 'book.fb2');
  await core.enqueueDialog('dialog.saveFile', { path: target, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  // The template's blank genre makes the book invalid (FR-030): save anyway; the Save As dialog
  // asks for the encoding when the queued answer does not carry one.
  const yes = page.getByTestId('dialog-validation-failed-button-yes');
  const saveAs = page.getByRole('dialog').filter({ hasText: 'Encoding:' });
  await expect
    .poll(
      async () => {
        if (existsSync(target)) return true;
        if (await yes.isVisible()) await yes.click();
        if (await saveAs.isVisible())
          await saveAs.getByRole('button', { name: /^(OK|Save)$/ }).click();
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return readFileSync(target, 'utf8');
}

export async function bodyErrors(core: CoreHandle, page: Page): Promise<string[]> {
  const docId = await shownDocId(page);
  const report = await core.rpcJob<{
    issues: Array<{ severity: string; code: string; path?: string; message?: string }>;
  }>('doc.validate', { docId });
  return (
    report.issues
      // FR-030: only the description fields the template leaves blank may be reported; every error
      // located in a body counts.
      .filter((issue) => issue.severity === 'error' && (issue.path ?? '').includes('body'))
      .map((issue) => `${issue.code} ${issue.path ?? ''}`)
  );
}
