/**
 * Performance of the PDF export (feature 014, SC-010; tagged `@perf`), printed through the print
 * seam (x `MFBE_PERF_FACTOR` on hosted runners, docs/performance.md):
 * - the 1 MB novel in A5 within 10 s;
 * - the 10 MB test book (tests/fixtures/gen-large-book.py) in A6 within 5 minutes, its progress
 *   moving at least once a second;
 * - the 150 MB picture book in A4 within 2 minutes;
 * - Cancel ends the export within a second;
 * - the core's peak memory within the constitution's 1.5 GB (Linux).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { writeBigPictureBook } from './fixtures/bigPictureBook';
import { expect, test, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { MEMORY_BUDGET_BYTES, OWN_CORE, peakRssBytes } from './fixtures/memory';
import { exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 1);

function generate(dir: string, name: string, megabytes: number): string | null {
  const book = path.join(dir, name);
  const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', String(megabytes)], {
    encoding: 'utf8',
  });
  return made.status === 0 ? book : null;
}

/** The longest time the progress bar's value stood still while `running` held, in ms. */
async function longestStill(
  page: Page,
  running: () => boolean,
): Promise<{ longest: number; at: string; slow: string[] }> {
  let last = '';
  let since = Date.now();
  let longest = 0;
  let at = '';
  // Every still period over 0.7 s, with where it stood: the steps that hold the bar.
  const slow: string[] = [];
  let reported = false;
  while (running()) {
    // Read without waiting: a locator would wait for the bar once the window has closed.
    const value = await page
      .evaluate(
        `document.querySelector('[data-testid="modal-job-progress"]')?.getAttribute('value') ?? null`,
      )
      .catch(() => null);
    // A bar without a value is indeterminate (the core's writing step): it moves by itself.
    if (value === null || value !== last) {
      if (reported) slow[slow.length - 1] += ` ${Date.now() - since} ms`;
      reported = false;
      last = (value as string | null) ?? '';
      since = Date.now();
    }
    if (!reported && Date.now() - since > 700) {
      slow.push(`at ${last}%:`);
      reported = true;
    }
    if (Date.now() - since > longest) {
      longest = Date.now() - since;
      // Where it stood: the bar's value and the window's text (the step).
      at = `${last} ${await page
        .evaluate(`document.querySelector('[data-testid="modal-job"]')?.textContent ?? ''`)
        .catch(() => '')}`;
    }
    await page.waitForTimeout(100);
  }
  return { longest, at, slow };
}

function checkMemory(core: CoreHandle, what: string): void {
  const peak = peakRssBytes(core.pid);
  if (peak !== null) {
    test.info().annotations.push({ type: 'perf', description: `${what}: core peak ${peak} bytes` });
    expect(peak, `${what}: the core's peak memory`).toBeLessThanOrEqual(MEMORY_BUDGET_BYTES);
  }
}

// Each test measures a core of its own (fixtures/memory.ts).
test.use(OWN_CORE);

test.describe('performance - the PDF export (SC-010)', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-014-perf-pdf-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('the 1 MB novel in A5 within 10 s', { tag: '@perf' }, async ({ core, page, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.setTimeout(240_000);
    const book = generate(dir, 'novel.fb2', 1);
    test.skip(!book, 'python3 / the generator are not available');
    await core.openApp(page);
    const seam = startPrintSeam(core, context);
    try {
      await openFixtureBook(core, page, book!);
      const started = Date.now();
      await exportPdfTo(core, page, path.join(dir, 'novel.pdf'), 'A5 (148 × 210 mm)', 120_000);
      const elapsed = Date.now() - started;
      test.info().annotations.push({ type: 'perf', description: `1 MB in A5: ${elapsed} ms` });
      expect(elapsed).toBeLessThan(10_000 * FACTOR);
      checkMemory(core, '1 MB');
    } finally {
      await seam.stop();
    }
  });

  test(
    'the 10 MB book in A6 within 5 minutes, its progress moving every second',
    { tag: '@perf' },
    async ({ core, page, context }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.setTimeout(900_000 * FACTOR);
      const book = generate(dir, 'large.fb2', 10);
      test.skip(!book, 'python3 / the generator are not available');
      await core.openApp(page);
      const seam = startPrintSeam(core, context, { readyTimeoutMs: 600_000 * FACTOR });
      // MFBE_PERF_CPU_THROTTLE=<n> slows the page n times (CDP), to stand for a slow runner here.
      const throttle = Number(process.env.MFBE_PERF_CPU_THROTTLE ?? 1);
      if (throttle > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      }
      try {
        await openFixtureBook(core, page, book!);
        let running = true;
        const still = page
          .getByTestId('modal-job')
          .waitFor({ timeout: 30_000 })
          .then(() => longestStill(page, () => running));
        const started = Date.now();
        await exportPdfTo(
          core,
          page,
          path.join(dir, 'large.pdf'),
          'A6 (105 × 148 mm)',
          600_000 * FACTOR,
        );
        const elapsed = Date.now() - started;
        running = false;
        const { longest, at, slow } = await still;
        console.log(`still over 0.7 s: ${slow.join(', ') || 'none'}`);
        const measured = `10 MB in A6: ${elapsed} ms; the progress stood still ${longest} ms at most (at ${at})`;
        console.log(measured);
        test.info().annotations.push({ type: 'perf', description: measured });
        expect(elapsed).toBeLessThan(300_000 * FACTOR);
        expect(longest).toBeLessThanOrEqual(1_000 * FACTOR);
        checkMemory(core, '10 MB');
      } finally {
        await seam.stop();
      }
    },
  );

  test(
    'the 150 MB picture book in A4 within 2 minutes',
    { tag: '@perf' },
    async ({ core, page, context }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.setTimeout(600_000 * FACTOR);
      const { file } = writeBigPictureBook(dir);
      await core.openApp(page);
      const seam = startPrintSeam(core, context, { readyTimeoutMs: 300_000 * FACTOR });
      try {
        await openFixtureBook(core, page, file);
        const started = Date.now();
        await exportPdfTo(
          core,
          page,
          path.join(dir, 'pictures.pdf'),
          'A4 (210 × 297 mm)',
          300_000 * FACTOR,
        );
        const elapsed = Date.now() - started;
        test
          .info()
          .annotations.push({ type: 'perf', description: `150 MB pictures in A4: ${elapsed} ms` });
        expect(elapsed).toBeLessThan(120_000 * FACTOR);
        checkMemory(core, '150 MB pictures');
      } finally {
        await seam.stop();
      }
    },
  );

  test(
    'Cancel ends the export within a second',
    { tag: '@perf' },
    async ({ core, page, context }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.setTimeout(240_000);
      const book = generate(dir, 'cancel.fb2', 5);
      test.skip(!book, 'python3 / the generator are not available');
      await core.openApp(page);
      const seam = startPrintSeam(core, context);
      try {
        await openFixtureBook(core, page, book!);
        const target = path.join(dir, 'cancelled.pdf');
        await core.enqueueDialog('dialog.saveFile', {
          path: target,
          encoding: 'A6 (105 × 148 mm)',
        });
        await clickExport(core, page, 'exportPdf');
        await page.getByTestId('modal-job').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(2_000);
        const clicked = Date.now();
        await page.getByTestId('modal-job-cancel').click();
        await expect(page.getByTestId('modal-job')).toBeHidden({ timeout: 10_000 });
        const elapsed = Date.now() - clicked;
        test.info().annotations.push({ type: 'perf', description: `Cancel: ${elapsed} ms` });
        expect(elapsed).toBeLessThan(1_000 * FACTOR);
        expect(existsSync(target)).toBe(false);
      } finally {
        await seam.stop();
      }
    },
  );
});
