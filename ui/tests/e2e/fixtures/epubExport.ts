/**
 * Feature 012: opening a book and exporting it to EPUB through the menus, shared by the round-trip
 * journey (us7-epub-round-trip) and the corpus gate's EPUB runs (corpus-epub).
 */

import { copyFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, waitForBook, type CoreHandle } from './core';

/** Opens a copy of `book` made in `dir`, so that nothing the editor does touches the original. */
export async function openBookCopy(
  core: CoreHandle,
  page: Page,
  book: string,
  dir: string,
): Promise<string> {
  const copy = path.join(dir, path.basename(book));
  copyFileSync(book, copy);
  await core.enqueueDialog('dialog.openFile', { paths: [copy] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, copy, 120_000);
  return copy;
}

/**
 * File > Export > Export as EPUB... to `target`, until the export ends: its summary closed, or the
 * status line naming the file. A failed export throws with the failure's text.
 */
export async function exportEpubTo(
  core: CoreHandle,
  page: Page,
  target: string,
  timeout = 120_000,
): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', { path: target });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportEpub').click();
  const status = page.getByTestId('status-message');
  const summary = page.getByTestId('dialog-epub-export-summary');
  const failed = page.getByTestId('dialog-epub-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`the export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button', { name: 'OK' }).click();
          return true;
        }
        return (await status.textContent())?.includes(`Exported to ${target}`) ?? false;
      },
      { timeout },
    )
    .toBe(true);
}
