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
 * dialog's list, `pdf.sizes.*` in English), until the export ends: the status line naming the file,
 * or the summary window (D23), which is closed and whose text is returned. A failed export throws
 * with the failure's text.
 */
export async function exportPdfTo(
  core: CoreHandle,
  page: Page,
  target: string,
  sizeLabel: string,
  timeout = 300_000,
): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: target, encoding: sizeLabel });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportPdf').click();
  const status = page.getByTestId('status-message');
  const failed = page.getByTestId('dialog-pdf-export-failed');
  const summary = page.getByTestId('dialog-pdf-export-summary');
  let text = '';
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`the export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          text = (await summary.textContent()) ?? '';
          await summary.getByRole('button', { name: 'OK' }).click({ timeout: 10_000 });
          return true;
        }
        text = (await status.textContent()) ?? '';
        return text.includes(`Exported to ${target}`);
      },
      { timeout },
    )
    .toBe(true);
  return text;
}
