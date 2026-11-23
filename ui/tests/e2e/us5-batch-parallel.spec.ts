/**
 * Feature 019 (T055; US5): Parallel conversion UI bounds (`test.setCpuCores` 1, 2, 4, 8;
 * default `cores - 1`; user-lowered worker count), sequential 1-row vs parallel multi-row
 * scrollable active-worker progress list, parallel flat-destination Overwrite `targetBusy` skip
 * without write races, and 20-book multi-core speedup (>= 1.5x on 4+ core hosts).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';

import { expect, fixtureBook, test } from './fixtures/core';
import { makeTempDir, openBatchDialog, resetBatchSettings } from './fixtures/batchHelpers';

test.describe('US5: Parallel conversion up to CPU cores minus 1', () => {
  test('enforces CPU-core worker bounds (1, 2, 4, 8 cores), active worker rows, and parallel targetBusy collision skip', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core');
    test.setTimeout(120_000);
    resetBatchSettings(core.dataDir);
    await core.openApp(page);

    try {
      // 1 core -> parallel disabled & unchecked, worker selector disabled, single-core note shown.
      await core.rpc('test.setCpuCores', { cores: 1 });
      await openBatchDialog(page);
      await expect(page.getByTestId('batch-parallel')).toBeDisabled();
      await expect(page.getByTestId('batch-parallel')).not.toBeChecked();
      await expect(page.getByTestId('batch-worker-count')).toBeDisabled();
      await expect(page.getByTestId('batch-single-core-note')).toBeVisible();
      await page.getByTestId('dialog-batch-converter-button-close').click();

      // 2 cores -> cores - 1 = 1 -> still single-thread only, disabled & unchecked.
      await core.rpc('test.setCpuCores', { cores: 2 });
      await openBatchDialog(page);
      await expect(page.getByTestId('batch-parallel')).toBeDisabled();
      await expect(page.getByTestId('batch-parallel')).not.toBeChecked();
      await expect(page.getByTestId('batch-worker-count')).toBeDisabled();
      await expect(page.getByTestId('batch-single-core-note')).toBeVisible();
      await page.getByTestId('dialog-batch-converter-button-close').click();

      // 8 cores (fresh session) -> parallel enabled & checked by default, worker count defaults to 7 (min=2, max=7).
      await core.rpc('test.setCpuCores', { cores: 8 });
      await core.openApp(page);
      await openBatchDialog(page);
      await expect(page.getByTestId('batch-parallel')).toBeEnabled();
      await expect(page.getByTestId('batch-parallel')).toBeChecked();
      await expect(page.getByTestId('batch-worker-count')).toBeEnabled();
      await expect(page.getByTestId('batch-worker-count')).toHaveValue('7');
      await expect(page.getByTestId('batch-worker-count')).toHaveAttribute('min', '2');
      await expect(page.getByTestId('batch-worker-count')).toHaveAttribute('max', '7');
      // Unchecking parallel disables the worker-count input; re-checking re-enables it.
      await page.getByTestId('batch-parallel').uncheck();
      await expect(page.getByTestId('batch-worker-count')).toBeDisabled();
      await page.getByTestId('batch-parallel').check();
      await expect(page.getByTestId('batch-worker-count')).toBeEnabled();
      // User can lower worker count to 2.
      await page.getByTestId('batch-worker-count').fill('2');
      await expect(page.getByTestId('batch-worker-count')).toHaveValue('2');
      await page.getByTestId('dialog-batch-converter-button-close').click();

      // 4 cores -> worker count defaults/clamps to max=3.
      await core.rpc('test.setCpuCores', { cores: 4 });
      await openBatchDialog(page);
      await expect(page.getByTestId('batch-worker-count')).toHaveAttribute('max', '3');
      await page.getByTestId('batch-worker-count').fill('3');

      // Active worker rows observation (sequential 1 row vs parallel >= 2 rows) +
      // parallel flat-destination Overwrite collision -> triggers targetBusy skip without corruption!
      const work = makeTempDir('mfbe-us5-parallel');
      try {
        const collisionSrc = path.join(work, 'collision-src');
        const dstSeq = path.join(work, 'dst-seq');
        const dstPar = path.join(work, 'dst-par');
        const sample = fixtureBook('modern-utf8.fb2');
        mkdirSync(collisionSrc, { recursive: true });
        // Three unique root books keep all 3 parallel slots busy simultaneously on start.
        for (let u = 1; u <= 3; u++) {
          copyFileSync(sample, path.join(collisionSrc, `a-unique-${u}.fb2`));
        }
        for (const sub of ['b', 'c', 'd', 'e', 'f', 'g']) {
          const dir = path.join(collisionSrc, sub);
          mkdirSync(dir, { recursive: true });
          // All 6 subfolders hold `same-name.fb2` -> flat destination collides on `same-name.md`!
          copyFileSync(sample, path.join(dir, 'same-name.fb2'));
        }

        await core.rpc('test.slowJobs', { millisecondsPerStep: 200 });

        // Observe sequential mode: strictly 1 active worker row (`batch-worker-row-0`).
        // Markdown export always runs a multi-step C++ job (`markdown.export`), so `slowJobs`
        // pauses every file reliably for deterministic active-worker and collision observation.
        await page.getByTestId('batch-dir-export').click();
        await page.getByTestId('batch-export-format').selectOption('markdown');
        await page.getByTestId('batch-zip-output').uncheck();
        await page.getByTestId('batch-source-input').fill(collisionSrc);
        await page.getByTestId('batch-in-place').uncheck();
        await page.getByTestId('batch-destination-input').fill(dstSeq);
        await page.getByTestId('batch-include-subfolders').check();
        await page.getByTestId('batch-keep-tree').check();
        await page.getByTestId('batch-parallel').uncheck();
        await page.getByTestId('dialog-batch-converter-button-start').click();

        await expect(page.getByTestId('batch-worker-row-0')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid^="batch-worker-row-"]')).toHaveCount(1);
        await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('batch-count-converted')).toContainText('9');

        // Observe parallel mode (3 workers) with FLAT destination + Overwrite ON:
        // Multiple worker slots run simultaneously; colliding workers on `same-name.md` receive
        // `targetBusy` and are reported as Skipped with zero failed/corrupted files!
        await page.getByTestId('dialog-batch-converter-button-run-again').click();
        await page.getByTestId('batch-keep-tree').uncheck();
        await page.getByTestId('batch-overwrite').check();
        await page.getByTestId('batch-parallel').check();
        await page.getByTestId('batch-worker-count').fill('3');
        await page.getByTestId('batch-destination-input').fill(dstPar);
        await page.getByTestId('dialog-batch-converter-button-start').click();

        await expect(page.getByTestId('batch-workers-list')).toBeVisible({ timeout: 15_000 });
        await expect
          .poll(async () => page.locator('[data-testid^="batch-worker-row-"]').count(), {
            timeout: 15_000,
          })
          .toBeGreaterThanOrEqual(2);

        await expect(page.getByTestId('batch-report-view')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('batch-count-failed')).toContainText('0');
        const skippedText = (await page.getByTestId('batch-count-skipped').textContent()) ?? '';
        const skippedCount = Number(/(\d+)/.exec(skippedText)?.[1] ?? '0');
        expect(skippedCount).toBeGreaterThanOrEqual(1);
        await expect(page.getByTestId('batch-issues-list')).toContainText(/another worker/i);

        // Surviving output must be a valid, uncorrupted Markdown file!
        const outMd = path.join(dstPar, 'same-name.md');
        expect(existsSync(outMd)).toBe(true);
        expect(readFileSync(outMd, 'utf8').length).toBeGreaterThan(50);

        await page.getByTestId('dialog-batch-converter-button-close').click();
      } finally {
        await core.rpc('test.slowJobs', { millisecondsPerStep: 0 });
        rmSync(work, { recursive: true, force: true });
      }
    } finally {
      await core.rpc('test.setCpuCores', { cores: null });
    }
  });

  test(
    'achieves >= 1.5x multi-core speedup on a 20-book CPU-bound batch on 4+ core hosts',
    // Runs under @perf (--workers=1 on Release core) so competing Playwright workers do not saturate runner CPUs.
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core');
      const hostCores = cpus().length;
      test.skip(hostCores < 4, `requires >= 4 logical cores (host has ${hostCores})`);
      test.setTimeout(180_000);
      resetBatchSettings(core.dataDir);
      await core.openApp(page);
      await core.rpc('test.setCpuCores', { cores: null });
      await core.rpc('settings.set', { patch: { mobi: { format: 'joint', zip: false } } });

      const work = makeTempDir('mfbe-us5-speedup');
      const srcDir = path.join(work, 'src-20');
      const dstSeq = path.join(work, 'dst-seq');
      const dstPar = path.join(work, 'dst-par');
      mkdirSync(srcDir, { recursive: true });
      // notes-400.fb2 (584 KB) exercises real JS Web Worker + C++ compression CPU work per book.
      const bigBook = fixtureBook('notes-400.fb2');
      for (let i = 1; i <= 20; i++) {
        copyFileSync(bigBook, path.join(srcDir, `book-${String(i).padStart(2, '0')}.fb2`));
      }

      try {
        // Warm up the batch-converter & mobi-export lazy chunks so both runs measure steady-state conversion.
        await openBatchDialog(page);
        await page.getByTestId('batch-dir-export').click();
        await page.getByTestId('batch-export-format').selectOption('mobi');
        await page.getByTestId('batch-source-input').fill(srcDir);
        await page.getByTestId('batch-in-place').uncheck();
        await page.getByTestId('batch-zip-output').uncheck();
        await page.getByTestId('batch-overwrite').uncheck();

        // 1) Sequential run (1 worker)
        await page.getByTestId('batch-destination-input').fill(dstSeq);
        await page.getByTestId('batch-parallel').uncheck();
        const tSeqStart = Date.now();
        await page.getByTestId('dialog-batch-converter-button-start').click();
        // waitFor uses in-page MutationObserver rather than expect's 500 ms backoff polling.
        await page.getByTestId('batch-report-view').waitFor({ state: 'visible', timeout: 120_000 });
        const seqWallMs = Date.now() - tSeqStart;
        const seqMs =
          Number(await page.getByTestId('batch-report-view').getAttribute('data-duration-ms')) ||
          seqWallMs;
        await expect(page.getByTestId('batch-count-converted')).toContainText('20');
        await expect(page.getByTestId('batch-count-failed')).toContainText('0');

        // 2) Parallel run (cores - 1 workers)
        await page.getByTestId('dialog-batch-converter-button-run-again').click();
        await page.getByTestId('batch-destination-input').fill(dstPar);
        await page.getByTestId('batch-parallel').check();
        await page.getByTestId('batch-worker-count').fill(String(hostCores - 1));
        const tParStart = Date.now();
        await page.getByTestId('dialog-batch-converter-button-start').click();
        await page.getByTestId('batch-report-view').waitFor({ state: 'visible', timeout: 120_000 });
        const parWallMs = Date.now() - tParStart;
        const parMs =
          Number(await page.getByTestId('batch-report-view').getAttribute('data-duration-ms')) ||
          parWallMs;
        await expect(page.getByTestId('batch-count-converted')).toContainText('20');
        await expect(page.getByTestId('batch-count-failed')).toContainText('0');

        const speedup = seqMs / Math.max(1, parMs);
        expect(
          speedup,
          `expected >= 1.5x speedup on ${hostCores} cores (seq=${seqMs}ms, par=${parMs}ms, speedup=${speedup.toFixed(2)}x)`,
        ).toBeGreaterThanOrEqual(1.5);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
  );
});
