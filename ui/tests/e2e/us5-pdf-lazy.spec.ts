/**
 * Feature 014, User Story 5 (tasks T046, T047): the PDF export is loaded when used, and the page size
 * chosen is kept for the open book.
 * - Before the first export, the page asks for neither the `pdf-export` chunk nor any font of the
 *   export (D24).
 * - The next export of the same book proposes the size the last one started with; another book
 *   proposes the default, A4, again (D25). Nothing of it is stored.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures/core';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'build', 'pdf-export');

async function proposals(core: { rpc<T>(method: string): Promise<T> }): Promise<string[]> {
  const requests =
    await core.rpc<{ method: string; selectedEncoding?: string }[]>('test.dialogRequests');
  return requests
    .filter((request) => request.method === 'dialog.saveFile' && request.selectedEncoding)
    .map((request) => request.selectedEncoding!);
}

test.describe('US5: loaded when used, the page size kept for the open book (feature 014)', () => {
  test('nothing of the export loads before it is used; Letter is kept for the book only', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs the core');
    test.setTimeout(600_000);
    const asked: string[] = [];
    page.on('request', (request) => asked.push(request.url()));
    await core.openApp(page);
    await openFixtureBook(core, page, 'reference-all-elements.fb2');
    // D24: opened, edited and previewed, the book has not loaded the export.
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(asked.filter((url) => /pdf-export-|\/pdf\/fonts\//.test(url))).toEqual([]);

    const seam = startPrintSeam(core, context);
    // The core's record holds the dialogs of the earlier tests of this worker too.
    const earlier = (await proposals(core)).length;
    try {
      await exportPdfTo(core, page, path.join(OUT, 'kept-1.pdf'), 'Letter (8.5 × 11 in)');
      // The chunk came with the first export, once.
      expect(asked.filter((url) => /\/pdf-export-[\w-]+\.js$/.test(url))).toHaveLength(1);
      // D25: the same book proposes Letter next time.
      await exportPdfTo(core, page, path.join(OUT, 'kept-2.pdf'), 'Letter (8.5 × 11 in)');
      // Another book proposes the default again.
      await openFixtureBook(core, page, 'pictures-alt.fb2');
      await exportPdfTo(core, page, path.join(OUT, 'kept-3.pdf'), 'A5 (148 × 210 mm)');
      expect((await proposals(core)).slice(earlier)).toEqual([
        'A4 (210 × 297 mm)',
        'Letter (8.5 × 11 in)',
        'A4 (210 × 297 mm)',
      ]);
      // Never stored: the settings still hold the default.
      const settings = await core.rpc<{ pdf?: { defaultPageSize?: string } }>('settings.get');
      expect(settings.pdf?.defaultPageSize ?? 'a4').toBe('a4');
    } finally {
      await seam.stop();
    }
  });
});
