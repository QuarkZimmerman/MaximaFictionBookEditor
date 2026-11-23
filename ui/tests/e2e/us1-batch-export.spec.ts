/**
 * Feature 019 (T027, T063; US1): Batch export FB2 books to all 5 supported export formats
 * (EPUB, MOBI / KF8, PDF, TXT, Markdown; FBD excluded) across bare .fb2 and .fb2.zip inputs,
 * mirrored/flat/in-place modes, ZIP output toggle, Export settings... live refresh, 0-match
 * empty source handling, and zero side-effects on the open editor book or Recent files.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  expect,
  fixtureBook,
  shownDocId,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
} from './fixtures/core';
import { resetBatchSettings } from './fixtures/batchHelpers';
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
    resetBatchSettings(core.dataDir);
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

    // Defaults: From FB2 tab active, 5 full-book formats (no FBD), EPUB ZIP & Export settings disabled,
    // Include subfolders & In-place checked by default, Destination & Keep tree disabled, Overwrite unchecked.
    await expect(page.getByTestId('batch-dir-export')).toHaveAttribute('role', 'tab');
    await expect(page.getByTestId('batch-dir-export')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('batch-dir-import')).toHaveAttribute('aria-selected', 'false');
    const formatOptions = await page
      .getByTestId('batch-export-format')
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => o.getAttribute('value')));
    expect(formatOptions).toEqual(['epub', 'mobi', 'pdf', 'txt', 'markdown']);

    await expect(page.getByTestId('batch-zip-output')).toBeDisabled();
    await expect(page.getByTestId('batch-zip-output')).not.toBeChecked();
    await expect(page.getByTestId('batch-fix-broken')).toBeChecked();
    await expect(page.getByTestId('batch-export-settings-btn')).toBeDisabled();
    await expect(page.getByTestId('batch-include-subfolders')).toBeChecked();
    await expect(page.getByTestId('batch-in-place')).toBeChecked();
    await expect(page.getByTestId('batch-destination-input')).toBeDisabled();
    await expect(page.getByTestId('batch-destination-browse')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).not.toBeChecked();
    await expect(page.getByTestId('batch-overwrite')).not.toBeChecked();

    // Switching to To FB2 tab shows import formats with Save output in ZIP archive inside the same tab panel.
    await page.getByTestId('batch-dir-import').click();
    await expect(page.getByTestId('batch-dir-import')).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByTestId('batch-import-formats-panel').getByTestId('batch-zip-output'),
    ).toBeVisible();
    await page.getByTestId('batch-dir-export').click();
    await expect(page.getByTestId('batch-dir-export')).toHaveAttribute('aria-selected', 'true');

    // Unchecking In-place enables destination input, Browse, and enables + checks Keep tree.
    await page.getByTestId('batch-in-place').uncheck();
    await expect(page.getByTestId('batch-destination-input')).toBeEnabled();
    await expect(page.getByTestId('batch-destination-browse')).toBeEnabled();
    await expect(page.getByTestId('batch-keep-tree')).toBeEnabled();
    await expect(page.getByTestId('batch-keep-tree')).toBeChecked();

    // Unchecking Include subfolders disables & unchecks Keep tree.
    await page.getByTestId('batch-include-subfolders').uncheck();
    await expect(page.getByTestId('batch-keep-tree')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).not.toBeChecked();

    // Re-checking Include subfolders re-enables Keep tree.
    await page.getByTestId('batch-include-subfolders').check();
    await expect(page.getByTestId('batch-keep-tree')).toBeEnabled();
    await page.getByTestId('batch-keep-tree').check();

    // Re-checking In-place disables destination input, Browse, and Keep tree while keeping Include subfolders active.
    await page.getByTestId('batch-in-place').check();
    await expect(page.getByTestId('batch-destination-input')).toBeDisabled();
    await expect(page.getByTestId('batch-destination-browse')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).toBeDisabled();
    await expect(page.getByTestId('batch-keep-tree')).not.toBeChecked();
    await expect(page.getByTestId('batch-include-subfolders')).toBeEnabled();
    await page.getByTestId('batch-in-place').uncheck();

    // Switch to MOBI and click Export settings... -> opens batch-only options modal (NOT global Settings),
    // hides duplicate ZIP checkbox, refreshes summary, and leaves global Settings -> Exports untouched!
    await core.rpc('settings.set', { patch: { mobi: { format: 'joint', zip: false } } });
    await page.getByTestId('batch-export-format').selectOption('mobi');
    await expect(page.getByTestId('batch-zip-output')).toBeEnabled();
    await expect(page.getByTestId('batch-export-settings-btn')).toBeEnabled();
    await page.getByTestId('batch-export-settings-btn').click();
    await expect(page.getByTestId('dialog-batch-export-settings')).toBeVisible();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await expect(page.getByTestId('batch-export-settings-scope-note')).toBeVisible();
    await expect(page.getByTestId('settings-mobi-zip')).toHaveCount(0);
    await page.getByTestId('settings-mobi-format').selectOption('kf8');
    await page.getByTestId('dialog-batch-export-settings-button-apply').click();
    await expect(page.getByTestId('dialog-batch-export-settings')).toBeVisible();
    await page.getByTestId('settings-mobi-tocPlacement').selectOption('end');
    await page.getByTestId('dialog-batch-export-settings-button-ok').click();
    await expect(page.getByTestId('dialog-batch-export-settings')).toBeHidden();
    await expect(page.getByTestId('batch-export-defaults')).toContainText(/KF8/i);

    // Confirm global settings.json was NOT altered by batch-only Export settings!
    const globalSettingsAfter = (await core.rpc('settings.get')) as {
      mobi?: { format?: string };
    };
    expect(globalSettingsAfter.mobi?.format).toBe('joint');

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
    resetBatchSettings(core.dataDir);
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
      await page.getByTestId('batch-dir-export').click();
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

      // 3) FB2 -> MOBI with batch-only KF8 override (.azw3) while global Settings -> Exports stays 'joint'
      const mobiDst = path.join(work, 'out-mobi');
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-export-format').selectOption('mobi');
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-export-settings-btn').click();
      await expect(page.getByTestId('dialog-batch-export-settings')).toBeVisible();
      await page.getByTestId('settings-mobi-format').selectOption('kf8');
      await page.getByTestId('dialog-batch-export-settings-button-ok').click();
      await expect(page.getByTestId('dialog-batch-export-settings')).toBeHidden();
      await page.getByTestId('batch-destination-input').fill(mobiDst);
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('3');
      expect(existsSync(path.join(mobiDst, 'root-book.azw3'))).toBe(true);
      const settingsCheck = (await core.rpc('settings.get')) as { mobi?: { format?: string } };
      expect(settingsCheck.mobi?.format).toBe('joint');

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

  test('persists all Batch Converter settings and format copies across restart with last-to-close wins', async ({
    core,
    page,
    context,
  }) => {
    const coreBin = process.env.MFBE_CORE_BIN;
    test.skip(!core.hasCore || !coreBin, 'needs MFBE_CORE_BIN');
    test.setTimeout(90_000);

    const work = makeTempDir('mfbe-us1-persist');
    const dedicatedDataDir = path.join(work, 'core-data');
    mkdirSync(dedicatedDataDir, { recursive: true });
    const srcA = path.join(work, 'src-a');
    const dstA = path.join(work, 'dst-a');
    const srcB = path.join(work, 'src-b');

    let instance1: { url: string; stop: () => Promise<void> } | null = null;
    let instance2: { url: string; stop: () => Promise<void> } | null = null;
    try {
      // 1) Start core #1, customize all controls + batch-only MOBI export settings (Apply + OK), close, and stop core #1.
      instance1 = await startCoreWith(coreBin!, dedicatedDataDir, []);
      await page.goto(instance1.url);
      await waitForStartupDocument(page);

      await openBatchDialog(page);
      await page.getByTestId('batch-export-format').selectOption('mobi');
      await page.getByTestId('batch-zip-output').check();
      await page.getByTestId('batch-fix-broken').uncheck();
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-source-input').fill(srcA);
      await page.getByTestId('batch-destination-input').fill(dstA);
      await page.getByTestId('batch-overwrite').check();
      await page.getByTestId('batch-export-settings-btn').click();
      await expect(page.getByTestId('dialog-batch-export-settings')).toBeVisible();
      await page.getByTestId('settings-mobi-format').selectOption('kf8');
      await page.getByTestId('dialog-batch-export-settings-button-apply').click();
      await page.getByTestId('settings-mobi-tocPlacement').selectOption('end');
      await page.getByTestId('dialog-batch-export-settings-button-ok').click();
      await expect(page.getByTestId('dialog-batch-export-settings')).toBeHidden();
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();
      await instance1.stop();
      instance1 = null;

      // 2) Start core #2 on the same data directory -> ALL batch settings & format copy restored across restart!
      instance2 = await startCoreWith(coreBin!, dedicatedDataDir, []);
      await page.goto(instance2.url);
      await waitForStartupDocument(page);

      await openBatchDialog(page);
      await expect(page.getByTestId('batch-export-format')).toHaveValue('mobi');
      await expect(page.getByTestId('batch-zip-output')).toBeChecked();
      await expect(page.getByTestId('batch-fix-broken')).not.toBeChecked();
      await expect(page.getByTestId('batch-in-place')).not.toBeChecked();
      await expect(page.getByTestId('batch-source-input')).toHaveValue(srcA);
      await expect(page.getByTestId('batch-destination-input')).toHaveValue(dstA);
      await expect(page.getByTestId('batch-overwrite')).toBeChecked();
      await expect(page.getByTestId('batch-export-defaults')).toContainText(/KF8/i);
      await page.getByTestId('batch-export-settings-btn').click();
      await expect(page.getByTestId('settings-mobi-format')).toHaveValue('kf8');
      await expect(page.getByTestId('settings-mobi-tocPlacement')).toHaveValue('end');
      await page.getByTestId('dialog-batch-export-settings-button-cancel').click();
      await page.getByTestId('dialog-batch-converter-button-close').click();

      // 3) Last-to-close wins across two simultaneously open Batch Converter dialogs!
      const page2 = await context.newPage();
      try {
        await page2.goto(instance2.url);
        await waitForStartupDocument(page2);

        await openBatchDialog(page);
        await openBatchDialog(page2);
        await page.getByTestId('batch-source-input').fill(path.join(work, 'first-closed'));
        await page2.getByTestId('batch-source-input').fill(srcB);
        await page2.getByTestId('batch-fix-broken').check();

        // Close dialog 1 first, then dialog 2 last -> dialog 2's settings win!
        await page.getByTestId('dialog-batch-converter-button-close').click();
        await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();
        await page2.getByTestId('dialog-batch-converter-button-close').click();
        await expect(page2.getByTestId('dialog-batch-converter')).toBeHidden();

        await openBatchDialog(page);
        await expect(page.getByTestId('batch-source-input')).toHaveValue(srcB);
        await expect(page.getByTestId('batch-fix-broken')).toBeChecked();
        await page.getByTestId('dialog-batch-converter-button-close').click();
      } finally {
        await page2.close();
      }
    } finally {
      await instance1?.stop().catch(() => undefined);
      await instance2?.stop().catch(() => undefined);
      rmSync(work, { recursive: true, force: true });
    }
  });
});
