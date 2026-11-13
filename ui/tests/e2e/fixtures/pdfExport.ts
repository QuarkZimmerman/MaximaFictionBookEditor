/**
 * Feature 014: opening a book and exporting it to PDF through the menus, shared by the PDF export's
 * journeys and the corpus gate's PDF runs. The export prints through the core's test seam, which
 * startPrintSeam (printSeam.ts) answers with the test browser.
 */
import type { Page } from '@playwright/test';

import { expect, fixtureBook, waitForBook, type CoreHandle } from './core';

/** File > Open for the fixture book `name` (tests/fixtures/books/ or a path). */
export async function openFixtureBook(core: CoreHandle, page: Page, name: string): Promise<string> {
  const book = name.includes('/') ? name : fixtureBook(name);
  await core.enqueueDialog('dialog.openFile', { paths: [book] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, book, 120_000);
  return book;
}

/**
 * File > Export > Export as PDF... to `target` in the page size labelled `sizeLabel` (the Save
 * dialog's list, `pdf.sizes.*` in English), until the status line names the file. A failed export
 * throws with the failure's text.
 */
export async function exportPdfTo(
  core: CoreHandle,
  page: Page,
  target: string,
  sizeLabel: string,
  timeout = 300_000,
): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', { path: target, encoding: sizeLabel });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportPdf').click();
  const status = page.getByTestId('status-message');
  const failed = page.getByTestId('dialog-pdf-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`the export failed: ${await failed.textContent()}`);
        return (await status.textContent())?.includes(`Exported to ${target}`) ?? false;
      },
      { timeout },
    )
    .toBe(true);
}
