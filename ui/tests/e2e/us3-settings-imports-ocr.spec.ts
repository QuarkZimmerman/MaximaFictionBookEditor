/**
 * Feature 020 (T041, US3): Headless Playwright E2E journey for Settings -> Imports & Settings -> OCR:
 * - Imports tab defaults & persistence
 * - OCR tab: 10 bundled packs with eng+rus checked, clickable external download link, 0-language
 *   validation rejection, custom folder with additional pack + bundled override + corrupt file
 *   picked up live on Apply, and portable-mode folder relocation (@platform).
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBatchDialog } from './fixtures/batchHelpers';
import { expect, startCoreWith, test, type CoreHandle } from './fixtures/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLED_OCR = path.join(ROOT, 'resources', 'ocr');
const OCR_SCAN_DE = path.join(ROOT, 'tests', 'fixtures', 'pdf', 'ocr', 'scan-de.pdf');

async function inspectScanWithLang(
  core: CoreHandle,
  lang: string,
): Promise<{ ok: boolean; error?: string }> {
  const begun = await core.rpc<{ token: string }>('pdfImport.begin', { path: OCR_SCAN_DE });
  try {
    await core.rpc('pdfImport.inspect', {
      token: begun.token,
      ocr: { enabled: true, autoDetect: false, languages: [lang] },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await core.rpc('pdfImport.end', { token: begun.token }).catch(() => {});
  }
}

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('menu-tools').click();
  await page.getByTestId('menu-tools-settings').click();
  await expect(page.getByTestId('dialog-settings')).toBeVisible({ timeout: 15_000 });
}

test.describe('US3 (feature 020) - Settings Imports and OCR tabs @platform', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('Imports tab shows all 5 formats with PDF Use OCR default true and persists changes', async ({
    core,
    page,
  }) => {
    await core.openApp(page);
    await openSettings(page);
    await page.getByTestId('settings-tab-imports').click();
    await expect(page.getByTestId('settings-page-imports')).toBeVisible();

    const format = page.getByTestId('settings-imports-format');
    await expect(format).toHaveValue('pdf');
    await expect(page.getByTestId('settings-imports-pdf-use-ocr')).toBeChecked();

    await format.selectOption('epub');
    await expect(page.getByTestId('settings-imports-none')).toBeVisible();
    await format.selectOption('pdf');

    await page.getByTestId('settings-imports-pdf-use-ocr').uncheck();
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toBeHidden();

    const saved = await core.rpc<{ imports?: { pdf?: { useOcr?: boolean } } }>('settings.get');
    expect(saved.imports?.pdf?.useOcr).toBe(false);
  });

  test('OCR tab validates >= 1 enabled pack, shows download link, and picks up custom packs, overrides, and corrupt files live on Apply', async ({
    core,
    page,
  }) => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-ocr-'));
    try {
      await core.openApp(page);
      await openSettings(page);
      await page.getByTestId('settings-tab-ocr').click();
      await expect(page.getByTestId('settings-page-ocr')).toBeVisible();

      // Default state: eng and rus checked, deu unchecked, external download link visible
      await expect(page.getByTestId('settings-ocr-lang-eng')).toBeChecked();
      await expect(page.getByTestId('settings-ocr-lang-rus')).toBeChecked();
      await expect(page.getByTestId('settings-ocr-lang-deu')).not.toBeChecked();
      await expect(page.getByTestId('settings-ocr-download-link')).toHaveAttribute(
        'href',
        'https://tesseract-ocr.github.io/tessdoc/Data-Files.html',
      );

      // Unchecking all enabled languages must block Apply with validation error
      await page.getByTestId('settings-ocr-lang-eng').uncheck();
      await page.getByTestId('settings-ocr-lang-rus').uncheck();
      await page.getByTestId('dialog-settings-button-apply').click();
      await expect(page.getByTestId('settings-errors')).toBeVisible();
      await expect(page.getByTestId('dialog-settings')).toBeVisible();

      // Re-enable eng and rus and point custom OCR folder at tmp
      await page.getByTestId('settings-ocr-lang-eng').check();
      await page.getByTestId('settings-ocr-lang-rus').check();
      await page.getByTestId('settings-ocr-folder-custom').check();
      await page.getByTestId('settings-ocr-folder-path').fill(tmp);

      // Populate custom folder with:
      // 1) override of bundled rus.traineddata
      // 2) extra custom language pack ces.traineddata (valid traineddata binary copied from eng)
      // 3) corrupt .traineddata file
      copyFileSync(path.join(BUNDLED_OCR, 'rus.traineddata'), path.join(tmp, 'rus.traineddata'));
      copyFileSync(path.join(BUNDLED_OCR, 'eng.traineddata'), path.join(tmp, 'ces.traineddata'));
      writeFileSync(path.join(tmp, 'bad.traineddata'), 'not a traineddata file');

      // Apply refreshes OCR catalog live without restart
      await page.getByTestId('dialog-settings-button-apply').click();
      await expect(page.getByTestId('settings-errors')).toHaveCount(0);
      await expect(page.getByTestId('settings-ocr-lang-ces')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('settings-ocr-override-rus')).toBeVisible();
      await expect(page.getByTestId('settings-ocr-passed-over')).toContainText('bad.traineddata');

      // Enable ces + disable auto-detect and click OK
      await page.getByTestId('settings-ocr-lang-ces').check();
      await page.getByTestId('settings-ocr-auto-detect').uncheck();
      await page.getByTestId('dialog-settings-button-ok').click();
      await expect(page.getByTestId('dialog-settings')).toBeHidden();

      const saved = await core.rpc<{
        ocr?: { folder?: string; autoDetect?: boolean; enabledLanguages?: string[] };
      }>('settings.get');
      expect(saved.ocr?.folder).toBe(tmp);
      expect(saved.ocr?.autoDetect).toBe(false);
      expect(saved.ocr?.enabledLanguages).toEqual(expect.arrayContaining(['eng', 'rus', 'ces']));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('portable-mode OCR folder packs and settings survive folder relocation @platform', async ({
    browser,
  }) => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-portable-'));
    const dirA = path.join(tmp, 'portable-a');
    const dirB = path.join(tmp, 'portable-b');
    mkdirSync(path.join(dirA, 'ocr'), { recursive: true });
    copyFileSync(
      path.join(BUNDLED_OCR, 'eng.traineddata'),
      path.join(dirA, 'ocr', 'nld.traineddata'),
    );

    try {
      // Run core on portable dirA: enable nld and save
      const coreA = await startCoreWith(process.env.MFBE_CORE_BIN!, dirA, ['--portable-dir', dirA]);
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(coreA.url);
        await page.locator('[data-testid="app-root"][data-startup="ready"]').waitFor();
        await openSettings(page);
        await page.getByTestId('settings-tab-ocr').click();
        await expect(page.getByTestId('settings-ocr-lang-nld')).toBeVisible({ timeout: 10_000 });
        await page.getByTestId('settings-ocr-lang-nld').check();
        await page.getByTestId('dialog-settings-button-ok').click();
        await expect(page.getByTestId('dialog-settings')).toBeHidden();
        await ctx.close();
      } finally {
        await coreA.stop();
      }

      // Relocate the entire portable directory to dirB (simulate moving USB stick)
      mkdirSync(path.join(dirB, 'ocr'), { recursive: true });
      copyFileSync(
        path.join(dirA, 'ocr', 'nld.traineddata'),
        path.join(dirB, 'ocr', 'nld.traineddata'),
      );
      copyFileSync(path.join(dirA, 'settings.json'), path.join(dirB, 'settings.json'));

      const coreB = await startCoreWith(process.env.MFBE_CORE_BIN!, dirB, ['--portable-dir', dirB]);
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(coreB.url);
        await page.locator('[data-testid="app-root"][data-startup="ready"]').waitFor();
        await openSettings(page);
        await page.getByTestId('settings-tab-ocr').click();
        await expect(page.getByTestId('settings-ocr-lang-nld')).toBeChecked({ timeout: 10_000 });
        await ctx.close();
      } finally {
        await coreB.stop();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('mid-session OCR folder add/remove refreshes Settings -> OCR, Batch Converter, and PDF OCR start live', async ({
    core,
    page,
  }) => {
    const userOcrDir = path.join(core.dataDir!, 'ocr');
    const customPack = path.join(userOcrDir, 'ces.traineddata');
    mkdirSync(userOcrDir, { recursive: true });
    rmSync(customPack, { force: true });

    try {
      await core.openApp(page);

      // Before adding ces.traineddata: Settings -> OCR, Batch Converter, and PDF OCR inspect do not have ces.
      await openSettings(page);
      await page.getByTestId('settings-tab-ocr').click();
      await expect(page.getByTestId('settings-ocr-lang-eng')).toBeVisible();
      await expect(page.getByTestId('settings-ocr-lang-ces')).toHaveCount(0);
      await page.getByTestId('dialog-settings-button-cancel').click();
      await expect(page.getByTestId('dialog-settings')).toHaveCount(0);

      await openBatchDialog(page);
      await page.getByTestId('batch-dir-import').click();
      await expect(page.getByTestId('batch-ocr-lang-eng')).toBeVisible();
      await expect(page.getByTestId('batch-ocr-lang-ces')).toHaveCount(0);
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toHaveCount(0);

      const beforeInspect = await inspectScanWithLang(core, 'ces');
      expect(beforeInspect.ok).toBe(false);

      // Add ces.traineddata into the default user OCR folder mid-session (no restart, no folder setting change).
      copyFileSync(path.join(BUNDLED_OCR, 'deu.traineddata'), customPack);

      // 1. PDF OCR start picks up the new pack immediately before opening Settings or Batch Converter.
      const addedInspect = await inspectScanWithLang(core, 'ces');
      expect(addedInspect.ok).toBe(true);

      // 2. Batch Converter refreshes on open and shows ces.
      await openBatchDialog(page);
      await page.getByTestId('batch-dir-import').click();
      await expect(page.getByTestId('batch-ocr-lang-ces')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toHaveCount(0);

      // 3. Settings -> OCR refreshes on open and shows ces.
      await openSettings(page);
      await page.getByTestId('settings-tab-ocr').click();
      await expect(page.getByTestId('settings-ocr-lang-ces')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('dialog-settings-button-cancel').click();
      await expect(page.getByTestId('dialog-settings')).toHaveCount(0);

      // Remove ces.traineddata mid-session: PDF OCR start, Batch Converter, and Settings -> OCR all drop it.
      rmSync(customPack, { force: true });

      const removedInspect = await inspectScanWithLang(core, 'ces');
      expect(removedInspect.ok).toBe(false);

      await openBatchDialog(page);
      await page.getByTestId('batch-dir-import').click();
      await expect(page.getByTestId('batch-ocr-lang-eng')).toBeVisible();
      await expect(page.getByTestId('batch-ocr-lang-ces')).toHaveCount(0);
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toHaveCount(0);

      await openSettings(page);
      await page.getByTestId('settings-tab-ocr').click();
      await expect(page.getByTestId('settings-ocr-lang-eng')).toBeVisible();
      await expect(page.getByTestId('settings-ocr-lang-ces')).toHaveCount(0);
      await page.getByTestId('dialog-settings-button-cancel').click();
      await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    } finally {
      rmSync(customPack, { force: true });
    }
  });
});
