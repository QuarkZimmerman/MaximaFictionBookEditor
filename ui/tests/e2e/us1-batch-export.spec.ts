/**
 * Feature 019 (T027, T063; US1): Batch export FB2 books to all 5 supported export formats
 * (EPUB, MOBI / KF8, PDF, TXT, Markdown; FBD excluded) across bare .fb2 and .fb2.zip inputs,
 * mirrored/flat/in-place modes, ZIP output toggle, Export settings... live refresh, 0-match
 * empty source handling, and zero side-effects on the open editor book or Recent files.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, fixtureBook, shownDocId, test, waitForBook } from './fixtures/core';
import { startPrintSeam } from './fixtures/printSeam';

function makeTempDir(prefix: string): string {
  const dir = path.join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function openBatchDialog(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-batchConverter').click();
  await expect(page.getByTestId('dialog-batch-converter')).toBeVisible();
}

test.describe('US1: Batch export FB2 to export formats @platform', () => {
  test('Tools menu placement, control invariants, 0-match folder, and Export settings refresh', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    await core.openApp(page);

    // Verify Tools -> Batch Converter... sits at the bottom after a separator following Check Spelling...
    await page.getByTestId('menu-tools').click();
    const menuItems = page.locator('[data-testid^="menu-tools-"]');
    const ids = await menuItems.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const spellIdx = ids.indexOf('menu-tools-spellcheck');
    const batchIdx = ids.indexOf('menu-tools-batchConverter');
    expect(spellIdx).toBeGreaterThanOrEqual(0);
    expect(batchIdx).toBe(ids.length - 1);
    expect(ids[batchIdx - 1]).toMatch(/^menu-tools-separator-/);

    await page.getByTestId('menu-tools-batchConverter').click();
    await expect(page.getByTestId('dialog-batch-converter')).toBeVisible();

    // Defaults: FB2 -> Export, 5 full-book formats (no FBD), EPUB ZIP disabled, Include subfolders + Keep tree checked, In-place & Overwrite unchecked.
    await expect(page.getByTestId('batch-dir-export')).toBeChecked();
    const formatOptions = await page
      .getByTestId('batch-export-format')
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => o.getAttribute('value')));
    expect(formatOptions).toEqual(['epub', 'mobi', 'pdf', 'txt', 'markdown']);

    await expect(page.getByTestId('batch-zip-output')).toBeDisabled();
    await expect(page.getByTestId('batch-zip-output')).not.toBeChecked();
    await expect(page.getByTestId('batch-include-subfolders')).toBeChecked();
    await expect(page.getByTestId('batch-keep-tree')).toBeEnabled();
    await expect(page.getByTestId('batch-keep-tree')).toBeChecked();
    await expect(page.getByTestId('batch-in-place')).not.toBeChecked();
    await expect(page.getByTestId('batch-overwrite')).not.toBeChecked();

    // Unchecking Include subfolders disables & unchecks Keep tree.
    await page.getByTestId('batch-include-subfolders').uncheck();
    await expect(page.getByTestId('batch-keep-tree')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).not.toBeChecked();

    // Re-checking Include subfolders re-enables Keep tree.
    await page.getByTestId('batch-include-subfolders').check();
    await expect(page.getByTestId('batch-keep-tree')).toBeEnabled();
    await page.getByTestId('batch-keep-tree').check();

    // Checking In-place disables destination input, Browse, and Keep tree while keeping Include subfolders active.
    await page.getByTestId('batch-in-place').check();
    await expect(page.getByTestId('batch-destination-input')).toBeDisabled();
    await expect(page.getByTestId('batch-destination-browse')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).not.toBeChecked();
    await expect(page.getByTestId('batch-include-subfolders')).toBeEnabled();
    await page.getByTestId('batch-in-place').uncheck();

    // Switch to MOBI and click Export settings... -> opens Settings -> Exports on MOBI and refreshes summary.
    await page.getByTestId('batch-export-format').selectOption('mobi');
    await expect(page.getByTestId('batch-zip-output')).toBeEnabled();
    await page.getByTestId('batch-export-settings-btn').click();
    await expect(page.getByTestId('dialog-settings')).toBeVisible();
    await expect(page.getByTestId('settings-exports-format')).toHaveValue('mobi');
    await page.getByTestId('settings-mobi-format').selectOption('kf8');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();
    await expect(page.getByTestId('batch-export-defaults')).toContainText(/KF8/i);

    // 0-matching-files empty source directory completes cleanly without writing anything.
    const emptySrc = makeTempDir('mfbe-us1-empty-src');
    const emptyDst = makeTempDir('mfbe-us1-empty-dst');
    try {
      await page.getByTestId('batch-source-input').fill(emptySrc);
      await page.getByTestId('batch-destination-input').fill(emptyDst);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-empty-notice')).toBeVisible();
    } finally {
      rmSync(emptySrc, { recursive: true, force: true });
      rmSync(emptyDst, { recursive: true, force: true });
    }
  });

  test('exports bare .fb2 and .fb2.zip to EPUB, MOBI, PDF, TXT, and Markdown (bare + ZIP) without affecting open book or Recent files', async ({
    core,
    page,
    context,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(180_000);
    await core.openApp(page);

    // Open a book in the editor first to prove Batch Converter leaves it and Recent files untouched.
    const openBook = fixtureBook('modern-utf8.fb2');
    await core.enqueueDialog('dialog.openFile', { paths: [openBook] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, openBook);
    const activeDocIdBefore = await shownDocId(page);
    const recentsBefore = (await core.rpc('doc.recent')) as unknown[];

    const work = makeTempDir('mfbe-us1-export');
    const srcDir = path.join(work, 'src');
    const subDir = path.join(srcDir, 'nested');
    mkdirSync(subDir, { recursive: true });
    const fb2Sample = fixtureBook('modern-utf8.fb2');
    copyFileSync(fb2Sample, path.join(srcDir, 'root-book.fb2'));
    copyFileSync(fb2Sample, path.join(subDir, 'child-book.fb2'));
    // Also create a real .fb2.zip via core's ephemeral doc.save so we test ZIP input natively!
    const tmpOpen = await core.rpcJob<{ document: { docId: string } }>('doc.open', {
      path: fb2Sample,
      ephemeral: true,
    });
    const zipInputPath = path.join(subDir, 'archived-book.fb2.zip');
    await core.rpcJob('doc.save', {
      docId: tmpOpen.document.docId,
      document: tmpOpen.document,
      path: zipInputPath,
      encoding: 'utf-8',
      force: true,
      archive: { entryName: 'inner-name.fb2' },
      ephemeral: true,
    });
    await core.rpc('doc.close', { docId: tmpOpen.document.docId });

    // Ensure MOBI settings are reset to default 'joint' (.mobi).
    await core.rpc('settings.set', {
      patch: { mobi: { format: 'joint', zip: false }, txt: { zip: false }, pdf: { zip: false } },
    });

    const seam = startPrintSeam(core, context);
    try {
      // 1) FB2 -> EPUB (mirrored tree)
      const epubDst = path.join(work, 'out-epub');
      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').check();
      await page.getByTestId('batch-export-format').selectOption('epub');
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-include-subfolders').check();
      await page.getByTestId('batch-keep-tree').check();
      await page.getByTestId('batch-destination-input').fill(epubDst);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      await expect(page.getByTestId('batch-count-failed')).toContainText('0');
      expect(existsSync(path.join(epubDst, 'root-book.epub'))).toBe(true);
      expect(existsSync(path.join(epubDst, 'nested', 'child-book.epub'))).toBe(true);
      expect(existsSync(path.join(epubDst, 'nested', 'archived-book.epub'))).toBe(true);

      // 2) FB2 -> TXT (flat destination + ZIP output checked)
      const txtDst = path.join(work, 'out-txt-zip');
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-export-format').selectOption('txt');
      await page.getByTestId('batch-keep-tree').uncheck();
      await page.getByTestId('batch-zip-output').check();
      await page.getByTestId('batch-destination-input').fill(txtDst);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      expect(existsSync(path.join(txtDst, 'root-book.zip'))).toBe(true);
      expect(existsSync(path.join(txtDst, 'child-book.zip'))).toBe(true);
      expect(existsSync(path.join(txtDst, 'archived-book.zip'))).toBe(true);

      // 3) FB2 -> MOBI (bare .mobi)
      const mobiDst = path.join(work, 'out-mobi');
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-export-format').selectOption('mobi');
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-destination-input').fill(mobiDst);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      expect(existsSync(path.join(mobiDst, 'root-book.mobi'))).toBe(true);

      // 4) FB2 -> Markdown (.md.zip)
      const mdDst = path.join(work, 'out-md-zip');
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-export-format').selectOption('markdown');
      await page.getByTestId('batch-zip-output').check();
      await page.getByTestId('batch-destination-input').fill(mdDst);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      expect(existsSync(path.join(mdDst, 'root-book.md.zip'))).toBe(true);

      // 5) FB2 -> PDF (in-place beside inputs)
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-export-format').selectOption('pdf');
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-in-place').check();
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      expect(existsSync(path.join(srcDir, 'root-book.pdf'))).toBe(true);
      expect(existsSync(path.join(subDir, 'child-book.pdf'))).toBe(true);
      expect(existsSync(path.join(subDir, 'archived-book.pdf'))).toBe(true);
      // Confirm real PDF header written.
      expect(
        readFileSync(path.join(srcDir, 'root-book.pdf')).subarray(0, 5).toString('ascii'),
      ).toBe('%PDF-');

      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();

      // Open editor book and Recent files list must be completely untouched.
      expect(await shownDocId(page)).toBe(activeDocIdBefore);
      const recentsAfter = (await core.rpc('doc.recent')) as unknown[];
      expect(recentsAfter).toEqual(recentsBefore);
    } finally {
      await seam.stop();
      rmSync(work, { recursive: true, force: true });
    }
  });
});
