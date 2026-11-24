/**
 * Feature 019 (T051; US4): Strict modal locking during scanning, converting, and cancelling
 * (Escape, title-bar close, non-Cancel controls, and `test.requestClose` all blocked), clean
 * cancellation during scanning (returns to editable configuration with 0 outputs), and clean
 * cancellation mid-conversion in both sequential and parallel modes (<= 3 s wind-down, 0 partial
 * or temp files left in destination or state/batch, intact completed outputs, Cancelled report,
 * and working Save report...).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { expect, fixtureBook, test } from './fixtures/core';
import { makeTempDir, openBatchDialog } from './fixtures/batchHelpers';

function batchStateEntries(dataDir: string | undefined): string[] {
  if (!dataDir) return [];
  const batchDir = path.join(dataDir, 'state', 'batch');
  if (!existsSync(batchDir)) return [];
  return readdirSync(batchDir);
}

test.describe('US4: Strict modal lock and clean cancellation', () => {
  test('enforces strict modal lock during scan and cancels scan cleanly back to editable config', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(90_000);
    await core.openApp(page);

    const work = makeTempDir('mfbe-us4-scan-cancel');
    const srcDir = path.join(work, 'src');
    const dstDir = path.join(work, 'dst');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(dstDir, { recursive: true });
    const sample = fixtureBook('modern-utf8.fb2');
    for (let i = 1; i <= 30; i++) {
      copyFileSync(sample, path.join(srcDir, `book-${String(i).padStart(2, '0')}.fb2`));
    }

    await core.rpc('test.slowJobs', { millisecondsPerStep: 600 });
    try {
      await openBatchDialog(page);
      await page.getByTestId('batch-dir-export').click();
      await page.getByTestId('batch-export-format').selectOption('txt');
      await page.getByTestId('batch-source-input').fill(srcDir);
      await page.getByTestId('batch-in-place').uncheck();
      await page.getByTestId('batch-destination-input').fill(dstDir);
      await page.getByTestId('batch-zip-output').uncheck();
      await page.getByTestId('dialog-batch-converter-button-start').click();

      // Observe active scanning phase.
      await expect(page.getByTestId('batch-progress-view')).toBeVisible();
      await expect(page.getByTestId('dialog-batch-converter-button-cancel')).toBeVisible();
      await expect(page.getByTestId('dialog-batch-converter-button-cancel')).toBeEnabled();

      // Strict modal lock: no titlebar close box, only Cancel button in footer, Escape & requestClose blocked.
      await expect(page.getByTestId('dialog-batch-converter-close')).toHaveCount(0);
      await expect(page.locator('.mfbe-dialog-buttons button')).toHaveCount(1);
      await expect(page.getByTestId('batch-config-view')).toHaveCount(0);

      await page.keyboard.press('Escape');
      await core.rpc('test.requestClose');
      await expect(page.getByTestId('dialog-batch-converter')).toBeVisible();
      await expect(page.getByTestId('batch-progress-view')).toBeVisible();

      // Cancel during scan -> returns cleanly to editable config view within <= 3 s, 0 outputs written.
      const cancelAt = Date.now();
      await page.getByTestId('dialog-batch-converter-button-cancel').click();
      await expect(page.getByTestId('batch-config-view')).toBeVisible({ timeout: 5_000 });
      expect(Date.now() - cancelAt).toBeLessThan(3_000);
      expect(readdirSync(dstDir)).toEqual([]);
      expect(batchStateEntries(core.dataDir)).toEqual([]);

      await page.getByTestId('dialog-batch-converter-button-close').click();
      await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();
    } finally {
      await core.rpc('test.slowJobs', { millisecondsPerStep: 0 });
      rmSync(work, { recursive: true, force: true });
    }
  });

  test('cancels mid-conversion in sequential and parallel modes within 3 s with zero partial files and valid Cancelled report', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(120_000);
    await core.openApp(page);

    const work = makeTempDir('mfbe-us4-convert-cancel');
    const srcDir = path.join(work, 'src');
    mkdirSync(srcDir, { recursive: true });
    const sample = fixtureBook('modern-utf8.fb2');
    for (let i = 1; i <= 14; i++) {
      copyFileSync(sample, path.join(srcDir, `novel-${String(i).padStart(2, '0')}.fb2`));
    }

    await core.rpc('test.setCpuCores', { cores: 4 });
    await core.rpc('test.slowJobs', { millisecondsPerStep: 120 });
    try {
      for (const mode of ['sequential', 'parallel'] as const) {
        const dstDir = path.join(work, `dst-${mode}`);
        mkdirSync(dstDir, { recursive: true });

        await openBatchDialog(page);
        await page.getByTestId('batch-dir-export').click();
        await page.getByTestId('batch-export-format').selectOption('epub');
        await page.getByTestId('batch-source-input').fill(srcDir);
        await page.getByTestId('batch-in-place').uncheck();
        await page.getByTestId('batch-destination-input').fill(dstDir);
        await page.getByTestId('batch-overwrite').uncheck();

        if (mode === 'sequential') {
          await page.getByTestId('batch-parallel').uncheck();
        } else {
          await page.getByTestId('batch-parallel').check();
          await page.getByTestId('batch-worker-count').fill('3');
        }

        await page.getByTestId('dialog-batch-converter-button-start').click();
        await expect(page.getByTestId('batch-workers-list')).toBeVisible({ timeout: 15_000 });

        // Wait until at least 1 file has finished converting so we verify completed files stay intact.
        await expect
          .poll(
            async () => {
              const txt = (await page.getByTestId('batch-live-counts').textContent()) ?? '';
              const m = /Converted:\s*(\d+)/.exec(txt);
              return m ? Number(m[1]) : 0;
            },
            { timeout: 15_000 },
          )
          .toBeGreaterThanOrEqual(1);

        // Verify strict modal lock while converting: no close button, only Cancel, Escape & requestClose blocked.
        await expect(page.getByTestId('dialog-batch-converter-close')).toHaveCount(0);
        await expect(page.locator('.mfbe-dialog-buttons button')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await core.rpc('test.requestClose');
        await expect(page.getByTestId('dialog-batch-converter')).toBeVisible();

        // Click Cancel and measure wind-down latency.
        const cancelAt = Date.now();
        await page.getByTestId('dialog-batch-converter-button-cancel').click();
        await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 10_000 });
        const windDownMs = Date.now() - cancelAt;
        expect(windDownMs, `${mode} cancel wind-down took ${windDownMs}ms`).toBeLessThan(3_000);

        // Report shows Cancelled heading, >= 1 converted, > 0 cancelled, 0 failed.
        await expect(page.getByTestId('batch-report-heading')).toContainText(/cancel/i);
        await expect(page.getByTestId('batch-count-cancelled')).toBeVisible();
        const convertedText = (await page.getByTestId('batch-count-converted').textContent()) ?? '';
        const cancelledText = (await page.getByTestId('batch-count-cancelled').textContent()) ?? '';
        const convertedCount = Number(/(\d+)/.exec(convertedText)?.[1] ?? '0');
        const cancelledCount = Number(/(\d+)/.exec(cancelledText)?.[1] ?? '0');
        expect(convertedCount).toBeGreaterThanOrEqual(1);
        expect(cancelledCount).toBeGreaterThan(0);
        expect(convertedCount + cancelledCount).toBe(14);

        // Check destination directory: exact count of valid .epub outputs, zero .tmp/.part files!
        const written = readdirSync(dstDir);
        expect(written.length).toBe(convertedCount);
        for (const name of written) {
          expect(name.endsWith('.epub')).toBe(true);
          const bytes = readFileSync(path.join(dstDir, name));
          expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
        }

        // Zero leftover batch temp directories in core state/batch!
        expect(batchStateEntries(core.dataDir)).toEqual([]);

        // Save report... works after cancel and records Cancelled status + count.
        const reportPath = path.join(work, `report-${mode}.txt`);
        await core.enqueueDialog('dialog.saveFile', { path: reportPath });
        await page.getByTestId('dialog-batch-converter-button-save-report').click();
        await expect(page.getByTestId('batch-report-save-notice')).toHaveAttribute(
          'role',
          'status',
        );
        const reportBody = readFileSync(reportPath, 'utf8');
        expect(reportBody).toContain('Cancelled');
        expect(reportBody).toMatch(new RegExp(`Cancelled:\\s+${cancelledCount}`));

        await page.getByTestId('dialog-batch-converter-button-close').click();
        await expect(page.getByTestId('dialog-batch-converter')).toBeHidden();
      }
    } finally {
      await core.rpc('test.slowJobs', { millisecondsPerStep: 0 });
      await core.rpc('test.setCpuCores', { cores: null });
      rmSync(work, { recursive: true, force: true });
    }
  });
});
