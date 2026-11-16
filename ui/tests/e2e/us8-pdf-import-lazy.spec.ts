/**
 * Feature 016 (User Story 8; tasks T063): the PDF import loaded when used, leaving no trace (D3, D29, D30). Before
 * the first import nothing of it loads; its progress shows at once while its part loads; an import adds nothing
 * to Recent files and changes no setting; once it ends, no reader process is left.
 */
import { execFileSync } from 'node:child_process';

import { expect, test } from './fixtures/core';
import { importPdfViaMenu, pdf, pdfImportDone } from './fixtures/pdfImport';

/** The reader processes running now (Linux and macOS; none are counted elsewhere). */
function readers(): number {
  if (process.platform === 'win32') return 0;
  try {
    return Number(
      execFileSync('pgrep', ['-c', '-x', 'mfbe-pdf-reader'], { encoding: 'utf8' }).trim(),
    );
  } catch {
    return 0; // pgrep exits 1 when nothing matches
  }
}

test.describe('US8 (feature 016) - loaded when used, leaving no trace', () => {
  test('nothing loads before the first import; its progress shows at once; no trace after it (1 to 4)', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.setTimeout(120_000);
    const asked: string[] = [];
    page.on('request', (request) => asked.push(request.url()));
    await core.openApp(page);
    // 1 (D29): the menus opened and closed, the import not used - no part of it loaded.
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(asked.filter((url) => /pdf-import-/.test(url))).toEqual([]);
    const recent = await core.rpc<unknown[]>('doc.recent');
    const settings = await core.rpc<unknown>('settings.get');
    // 2 (D29): the part comes slowly; the progress is there before it.
    let held = false;
    await page.route(/pdf-import-[\w-]+\.js$/, async (route) => {
      held = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    const before = await importPdfViaMenu(core, page, pdf('text-untagged.pdf'));
    await expect(page.getByTestId('modal-job')).toBeVisible({ timeout: 1000 });
    await pdfImportDone(page, before);
    expect(held).toBe(true);
    expect(asked.filter((url) => /pdf-import-/.test(url))).toHaveLength(1);
    // 3 (D3): Recent files and the settings as they were.
    expect(await core.rpc<unknown[]>('doc.recent')).toEqual(recent);
    expect(await core.rpc<unknown>('settings.get')).toEqual(settings);
    // 4 (D30): the import's reader has ended with it.
    await expect.poll(() => readers(), { timeout: 20_000 }).toBe(0);
  });
});
