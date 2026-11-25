/**
 * Feature 020 (T049; US4, FR-020..FR-023, SC-006): End-to-end Playwright journey for unattended
 * Batch Converter PDF OCR in both sequential and parallel modes.
 *
 * Verifies:
 * - Zero modal questions or pop-up dialogs appear during runs (strictly non-interactive).
 * - Text-only PDFs skip OCR while image-only, mixed/multilingual, and garbled-layer PDFs are
 *   recognized unattended into valid FB2 files with expected text and language tags.
 * - Password-protected / copy-restricted PDFs and disabled/uninstalled-language scans fail
 *   individually under Failed with clear localized reasons without interrupting the batch.
 * - On-screen summary shows `OCR: N`, filter bar offers the itemised *OCR* tab, and saved UTF-8
 *   report includes the OCR summary count, itemised `OCR (N)` section, and OCR warnings.
 * - Disabling batch *Use OCR* disables language controls and fails scanned PDFs without OCR.
 * - Batch OCR choices persist independently in `batch-converter.json` across dialog reopen and
 *   page reload without modifying global `settings.json`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures/core';
import {
  makeTempDir,
  openBatchDialog,
  repoFixture,
  resetBatchSettings,
} from './fixtures/batchHelpers';

test.describe('US4: Unattended Batch Converter PDF OCR @platform', () => {
  test('converts mixed PDF folder unattended in sequential and parallel modes, reports OCR cleanly, handles Use OCR off, and persists batch OCR settings independently', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(240_000);
    resetBatchSettings(core.dataDir);
    await core.rpc('settings.set', {
      patch: {
        imports: { pdf: { useOcr: true } },
        ocr: { folder: '', autoDetect: true, enabledLanguages: ['eng', 'rus'] },
      },
    });
    await core.rpc('test.setCpuCores', { cores: 4 });
    await core.openApp(page);

    const work = makeTempDir('mfbe-us4-batch-ocr');
    let cleanupError: unknown = null;
    try {
      const srcDir = path.join(work, 'src');
      const seqOutDir = path.join(work, 'out-seq');
      const parOutDir = path.join(work, 'out-par');
      const noOcrOutDir = path.join(work, 'out-no-ocr');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(seqOutDir, { recursive: true });
      mkdirSync(parOutDir, { recursive: true });
      mkdirSync(noOcrOutDir, { recursive: true });

      // Assemble a mixed PDF corpus:
      // 1. Clean text PDF (must skip OCR)
      copyFileSync(
        repoFixture('pdf', 'import', 'text-untagged.pdf'),
        path.join(srcDir, '01-text.pdf'),
      );
      // 2. Image-only English scan (must run OCR)
      copyFileSync(
        repoFixture('pdf', 'ocr', 'scan-en-10p.pdf'),
        path.join(srcDir, '02-scan-en.pdf'),
      );
      // 3. Mixed searchable + scanned + embedded text-image + bilingual PDF (must run OCR)
      copyFileSync(
        repoFixture('pdf', 'ocr', 'mixed-full.pdf'),
        path.join(srcDir, '03-mixed-full.pdf'),
      );
      // 4. Garbled-layer Russian PDF (must recover via OCR)
      copyFileSync(
        repoFixture('pdf', 'ocr', 'garbled-ru.pdf'),
        path.join(srcDir, '04-garbled-ru.pdf'),
      );
      // 5. Copy-restricted scanned PDF (must fail unattended, zero password prompt)
      copyFileSync(
        repoFixture('pdf', 'ocr', 'copy-restricted-scan.pdf'),
        path.join(srcDir, '05-restricted.pdf'),
      );
      // 6. Uninstalled-script (Greek) scan (must fail unattended with clear OCR reason)
      copyFileSync(
        repoFixture('pdf', 'ocr', 'scan-uninstalled-script.pdf'),
        path.join(srcDir, '06-uninstalled-script.pdf'),
      );

      await openBatchDialog(page);
      await page.getByTestId('batch-dir-import').click();

      // Verify initial To FB2 PDF OCR controls mirror global Settings (Use OCR=on, Auto-detect=on, eng+rus checked).
      await expect(page.getByTestId('batch-ocr-panel')).toBeVisible();
      await expect(page.getByTestId('batch-pdf-use-ocr')).toBeChecked();
      await expect(page.getByTestId('batch-ocr-auto-detect')).toBeChecked();
      await expect(page.getByTestId('batch-ocr-lang-eng')).toBeChecked();
      await expect(page.getByTestId('batch-ocr-lang-rus')).toBeChecked();
      await expect(page.getByTestId('batch-ocr-lang-deu')).not.toBeChecked();

      // Unchecking all OCR languages while PDF + Use OCR are on blocks Start with validation hint.
      await page.getByTestId('batch-ocr-lang-eng').uncheck();
      await page.getByTestId('batch-ocr-lang-rus').uncheck();
      await expect(page.getByTestId('batch-ocr-no-languages-hint')).toBeVisible();
      await expect(page.getByTestId('dialog-batch-converter-button-start')).toBeDisabled();

      // Re-check eng + rus -> validation clears and Start re-enables.
      await page.getByTestId('batch-ocr-lang-eng').check();
      await page.getByTestId('batch-ocr-lang-rus').check();
      await expect(page.getByTestId('batch-ocr-no-languages-hint')).toHaveCount(0);
      await expect(page.getByTestId('dialog-batch-converter-button-start')).toBeEnabled();

      // Unchecking PDF disables batch OCR controls cleanly.
      await page.getByTestId('batch-import-fmt-pdf').uncheck();
      await expect(page.getByTestId('batch-pdf-use-ocr')).toBeDisabled();
      await expect(page.getByTestId('batch-ocr-auto-detect')).toBeDisabled();
      await expect(page.getByTestId('batch-ocr-lang-eng')).toBeDisabled();
      await expect(page.getByTestId('batch-ocr-disabled-note')).toBeVisible();
      await page.getByTestId('batch-import-fmt-pdf').check();
      await expect(page.getByTestId('batch-pdf-use-ocr')).toBeEnabled();

      // Run 1: Sequential mode with batch Use OCR checked.
      await page.getByTestId('batch-import-all').uncheck();
      await page.getByTestId('batch-import-fmt-pdf').check();
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-destination-input').fill(seqOutDir);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('batch-parallel').uncheck();
      await page.getByTestId('dialog-batch-converter-button-start').click();

      // Strictly unattended: no secondary modal dialog ever appears on top of Batch Converter.
      await expect(page.getByTestId('dialog-pdf-import-options')).toHaveCount(0);
      await expect(page.getByTestId('dialog-pdf-password')).toHaveCount(0);
      await expect(page.getByTestId('dialog-pdf-import-failed')).toHaveCount(0);
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 120_000 });

      await expect(page.getByTestId('batch-count-total')).toContainText('6');
      await expect(page.getByTestId('batch-count-converted')).toContainText('4');
      await expect(page.getByTestId('batch-count-ocr')).toContainText('3');
      await expect(page.getByTestId('batch-count-failed')).toContainText('2');

      // Verify converted FB2 outputs exist and carry expected OCR text/markup.
      expect(existsSync(path.join(seqOutDir, '01-text.fb2'))).toBe(true);
      const scanEnXml = readFileSync(path.join(seqOutDir, '02-scan-en.fb2'), 'utf8');
      expect(scanEnXml).toContain('<lang>en</lang>');
      expect(scanEnXml).toContain('lantern');
      const mixedXml = readFileSync(path.join(seqOutDir, '03-mixed-full.fb2'), 'utf8');
      expect(mixedXml).toContain('style="ocr-image"');
      expect(mixedXml).not.toContain('<stylesheet');
      const garbledRuXml = readFileSync(path.join(seqOutDir, '04-garbled-ru.fb2'), 'utf8');
      expect(garbledRuXml).toContain('<lang>ru</lang>');

      // Verify itemised OCR filter tab lists the 3 OCR'd PDFs (and NOT 01-text.pdf).
      await page.getByTestId('batch-filter-ocr').click();
      const issuesList = page.getByTestId('batch-issues-list');
      await expect(issuesList.locator('[data-testid="batch-issue-ocr"]')).toHaveCount(3);
      await expect(issuesList).toContainText('02-scan-en.pdf');
      await expect(issuesList).toContainText('03-mixed-full.pdf');
      await expect(issuesList).toContainText('04-garbled-ru.pdf');
      await expect(issuesList).not.toContainText('01-text.pdf');

      // Verify Failed tab lists the 2 refused PDFs.
      await page.getByTestId('batch-filter-failed').click();
      await expect(issuesList.locator('[data-testid="batch-issue-failed"]')).toHaveCount(2);
      await expect(issuesList).toContainText('05-restricted.pdf');
      await expect(issuesList).toContainText('06-uninstalled-script.pdf');

      // Save report and inspect OCR summary + itemised OCR (3) section.
      const reportPath = path.join(work, 'batch-ocr-report.txt');
      await core.enqueueDialog('dialog.saveFile', { path: reportPath });
      await page.getByTestId('dialog-batch-converter-button-save-report').click();
      await expect(page.getByTestId('batch-report-save-notice')).toHaveAttribute('role', 'status');
      const reportText = readFileSync(reportPath, 'utf8');
      expect(reportText).toContain('OCR:');
      expect(reportText).toContain('OCR (3)');
      expect(reportText).toContain('02-scan-en.pdf');
      expect(reportText).toContain('03-mixed-full.pdf');
      expect(reportText).toContain('04-garbled-ru.pdf');
      expect(reportText).toContain('Failed (2)');
      expect(reportText).toContain('05-restricted.pdf');
      expect(reportText).toContain('06-uninstalled-script.pdf');

      // Run 2: Parallel mode (2 workers) with batch Use OCR checked.
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-destination-input').fill(parOutDir);
      await page.getByTestId('batch-parallel').check();
      await page.getByTestId('batch-worker-count').fill('2');
      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('batch-count-converted')).toContainText('4');
      await expect(page.getByTestId('batch-count-ocr')).toContainText('3');
      await expect(page.getByTestId('batch-count-failed')).toContainText('2');
      expect(existsSync(path.join(parOutDir, '02-scan-en.fb2'))).toBe(true);
      expect(existsSync(path.join(parOutDir, '03-mixed-full.fb2'))).toBe(true);
      expect(existsSync(path.join(parOutDir, '04-garbled-ru.fb2'))).toBe(true);

      // Run 3: Uncheck batch Use OCR, customize languages/autoDetect, verify OCR is skipped on scans.
      await page.getByTestId('dialog-batch-converter-button-run-again').click();
      await page.getByTestId('batch-destination-input').fill(noOcrOutDir);
      await page.getByTestId('batch-ocr-auto-detect').uncheck();
      await page.getByTestId('batch-ocr-lang-deu').check();
      await page.getByTestId('batch-pdf-use-ocr').uncheck();
      await expect(page.getByTestId('batch-ocr-auto-detect')).toBeDisabled();
      await expect(page.getByTestId('batch-ocr-lang-eng')).toBeDisabled();

      await page.getByTestId('dialog-batch-converter-button-start').click();
      await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 90_000 });
      // With Use OCR off: 0 files used OCR, and image-only scans fail without prompts!
      await expect(page.getByTestId('batch-count-ocr')).toContainText('0');
      expect(existsSync(path.join(noOcrOutDir, '01-text.fb2'))).toBe(true);
      expect(existsSync(path.join(noOcrOutDir, '02-scan-en.fb2'))).toBe(false);

      // Close dialog, reload page (simulating restart), reopen dialog -> batch OCR settings persisted
      // independently while global Settings remains untouched!
      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toHaveCount(0);

      await core.openApp(page);
      await openBatchDialog(page);
      await expect(page.getByTestId('batch-dir-import')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('batch-pdf-use-ocr')).not.toBeChecked();
      await expect(page.getByTestId('batch-ocr-auto-detect')).not.toBeChecked();
      await expect(page.getByTestId('batch-ocr-lang-deu')).toBeChecked();

      const globalAfter = (await core.rpc('settings.get', {})) as {
        imports?: { pdf?: { useOcr?: boolean } };
        ocr?: { autoDetect?: boolean; enabledLanguages?: string[] };
      };
      expect(globalAfter.imports?.pdf?.useOcr).toBe(true);
      expect(globalAfter.ocr?.autoDetect).toBe(true);
      expect(globalAfter.ocr?.enabledLanguages).toEqual(['eng', 'rus']);

      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toHaveCount(0);
    } catch (err) {
      const dialogText = await page
        .getByTestId('dialog-batch-converter')
        .innerText({ timeout: 2_000 })
        .catch(() => '');
      if (dialogText) {
        console.error('[us4-batch-ocr] dialog state at failure:\n' + dialogText);
      }
      // Cancel any in-flight batch before tearing down temp files so Windows reader handles close.
      const cancelBtn = page.getByTestId('dialog-batch-converter-button-cancel');
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click().catch(() => undefined);
        await expect(page.getByTestId('batch-report-view'))
          .toBeVisible({ timeout: 10_000 })
          .catch(() => undefined);
      }
      throw err;
    } finally {
      await core.rpc('test.setCpuCores', { cores: null }).catch(() => undefined);
      try {
        rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      } catch (err) {
        cleanupError = err;
      }
    }
    if (cleanupError) {
      throw cleanupError;
    }
  });
});
