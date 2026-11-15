/**
 * Save's question before an export (requester, rc.5): File > Export > Markdown, EPUB and PDF ask
 * "export anyway?" before their Save dialog when the book is invalid. A journey that exports a book
 * as it is goes through File > Export with `clickExport`, which answers Yes when the question comes;
 * export-validity.spec.ts tests the question itself.
 */

import { expect, type Page } from '@playwright/test';

import type { CoreHandle } from './core';

/** The question's dialog (as the FBD export's, feature 004 FR-042). */
export const EXPORT_CHECK = 'dialog-export-validation-failed';

/** How many Save dialogs the editor has asked the core for since it started (test hooks). */
export async function saveDialogRequests(core: CoreHandle): Promise<number> {
  const requests = await core.rpc<Array<{ method: string }>>('test.dialogRequests');
  return requests.filter((request) => request.method === 'dialog.saveFile').length;
}

/**
 * File > Export > `item` (the menu item's test id after `menu-file-export-`, e.g. `exportPdf`) up
 * to its Save dialog, answering Yes to the question an invalid book gets. Resolves once the Save
 * dialog has been asked for: true when the question came.
 */
export async function clickExport(core: CoreHandle, page: Page, item: string): Promise<boolean> {
  const before = await saveDialogRequests(core);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId(`menu-file-export-${item}`).click();
  let asked = false;
  await expect
    .poll(
      async () => {
        if (await page.getByTestId(EXPORT_CHECK).isVisible()) {
          await page.getByTestId(`${EXPORT_CHECK}-button-yes`).click({ timeout: 10_000 });
          asked = true;
        }
        return (await saveDialogRequests(core)) > before;
      },
      { timeout: 60_000, intervals: [100, 250, 500] },
    )
    .toBe(true);
  return asked;
}
