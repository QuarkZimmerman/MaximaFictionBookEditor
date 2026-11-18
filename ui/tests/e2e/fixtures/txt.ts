/**
 * Feature 017: the TXT export and import through the menus, shared by the TXT journeys and the corpus gate's
 * TXT runs.
 */
import type { Page } from '@playwright/test';

import { expect, shownDocId, type CoreHandle } from './core';
import { clickExport } from './exportCheck';

declare const window: { __mfbeTest?: { scripts?: { toXml(): Promise<string> } } };

/** The window's book as FB2 text. */
export const bookXml = (page: Page): Promise<string> =>
  page.evaluate(() => window.__mfbeTest!.scripts!.toXml());

/** File > Export > Export as TXT... to `target` in `encoding` (the dialog's label); resolves the summary or status. */
export async function exportTxtTo(
  core: CoreHandle,
  page: Page,
  target: string,
  { encoding = 'UTF-8 (Unicode)', bom = false, zip = false } = {},
): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: target, encoding, zip, checks: { bom } });
  await clickExport(core, page, 'exportTxt');
  const summary = page.getByTestId('dialog-txt-export-summary');
  const failed = page.getByTestId('dialog-txt-export-failed');
  const written = zip ? target.replace(/\.txt$/i, '.zip') : target;
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) throw new Error(`failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button', { name: 'OK' }).click();
          return true;
        }
        text = (await page.getByTestId('status-message').textContent()) ?? '';
        return text.includes(`Exported to ${written}`);
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  return text;
}

/** File > Import > TXT File... with `file` queued; the unsaved-changes question answered No. */
export async function importTxtViaMenu(
  core: CoreHandle,
  page: Page,
  file: string,
): Promise<string | null> {
  const before = await shownDocId(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importTxt').click();
  const question = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
  if (
    await question.waitFor({ state: 'visible', timeout: 1500 }).then(
      () => true,
      () => false,
    )
  )
    await question.getByRole('button', { name: 'No' }).click();
  return before;
}

/** Waits for the end of the import: the new book, or the failure or summary (closed, their text returned). */
export async function txtImportEnds(
  page: Page,
  before: string | null,
  timeout = 120_000,
): Promise<{ failed?: string; summary?: string }> {
  const failed = page.getByTestId('dialog-txt-import-failed');
  const summary = page.getByTestId('dialog-txt-import-summary');
  await expect
    .poll(
      async () =>
        (await failed.isVisible()) ||
        (await summary.isVisible()) ||
        ((await shownDocId(page)) !== before && !(await page.getByTestId('modal-job').isVisible())),
      { timeout },
    )
    .toBe(true);
  if (await failed.isVisible()) {
    const text = (await failed.textContent()) ?? '';
    await failed.getByRole('button', { name: 'OK' }).click();
    return { failed: text };
  }
  if (await summary.isVisible()) {
    const text = (await summary.textContent()) ?? '';
    await summary.getByRole('button', { name: 'OK' }).click();
    return { summary: text };
  }
  return {};
}
