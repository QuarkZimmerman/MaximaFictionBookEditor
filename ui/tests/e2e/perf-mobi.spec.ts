/**
 * Feature 018 (T047, SC-007; tagged `@perf`, run on the Release core):
 * - 10 MB text book exports to MOBI 7 within 5 s and imports back within 5 s;
 * - 150 MB image-heavy book exports within 20 s and imports back within 30 s;
 * - peak resident memory of core and renderer each < 1.5 GB (Linux);
 * - progress bar updates at least once per second;
 * - Cancel takes effect within 1 s leaving no output file and leaving the open book unchanged.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { writeBigPictureBook } from './fixtures/bigPictureBook';
import { expect, shownDocId, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { MEMORY_BUDGET_BYTES, OWN_CORE, peakRssBytes, rendererPeakBytes } from './fixtures/memory';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? (process.platform === 'linux' ? 1 : 2)) || 1;

const WATCH_PROGRESS = `(() => {
  const w = window;
  const p = (w.__mfbeProgress = { changes: [], values: [], last: null, seen: false, end: 0 });
  const tick = () => {
    const job = document.querySelector('[data-testid="modal-job"]');
    if (job) {
      const bar = document.querySelector('[data-testid="modal-job-progress"]');
      const value = bar && bar.hasAttribute('value') ? bar.getAttribute('value') : 'busy';
      if (!p.seen || value !== p.last) {
        p.changes.push(performance.now());
        p.values.push(value);
      }
      p.last = value;
      p.seen = true;
    } else if (p.seen) {
      p.end = performance.now();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const LONGEST_STILL = `(() => {
  const p = window.__mfbeProgress;
  const marks = [...p.changes, p.end || performance.now()];
  let longest = 0;
  for (let i = 1; i < marks.length; i += 1) longest = Math.max(longest, marks[i] - marks[i - 1]);
  return longest;
})()`;

const ARM_CANCEL = `(() => {
  const w = window;
  w.__mfbeCancel = null;
  let pressed = 0;
  let seen = false;
  const tick = () => {
    const job = document.querySelector('[data-testid="modal-job"]');
    const bar = document.querySelector('[data-testid="modal-job-progress"]');
    if (!pressed && job && bar && bar.hasAttribute('value')) {
      pressed = performance.now();
      document.querySelector('[data-testid="modal-job-cancel"]').click();
    } else if (!job && (pressed || seen)) {
      w.__mfbeCancel = pressed ? performance.now() - pressed : -1;
      return;
    }
    seen = seen || !!job;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

async function cancelMs(page: Page): Promise<number> {
  await expect
    .poll(() => page.evaluate<number | null>('window.__mfbeCancel'), { timeout: 300_000 })
    .not.toBeNull();
  return page.evaluate<number>('window.__mfbeCancel');
}

const note = (description: string): void => {
  test.info().annotations.push({ type: 'perf', description });
};

async function openFile(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file, 120_000);
}

async function timedMobiExport(core: CoreHandle, page: Page, target: string) {
  await page.evaluate(WATCH_PROGRESS);
  await core.enqueueDialog('dialog.saveFile', {
    path: target,
    zip: false,
    selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
  });
  const started = Date.now();
  await clickExport(core, page, 'exportMobi');
  const summary = page.getByTestId('dialog-mobi-export-summary');
  const failed = page.getByTestId('dialog-mobi-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        return ((await page.getByTestId('status-message').textContent()) ?? '').includes(
          'Exported to',
        );
      },
      { timeout: 300_000, intervals: [25] },
    )
    .toBe(true);
  const ms = Date.now() - started;
  return { ms, still: await page.evaluate<number>(LONGEST_STILL) };
}

async function timedMobiImport(core: CoreHandle, page: Page, file: string) {
  const before = await shownDocId(page);
  await page.evaluate(WATCH_PROGRESS);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  const started = Date.now();
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importMobi').click();
  const summary = page.getByTestId('dialog-mobi-import-summary');
  const failed = page.getByTestId('dialog-mobi-import-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`Import failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button').first().click();
          return true;
        }
        const cur = await shownDocId(page);
        if (cur === before) return false;
        return ((await page.getByTestId('status-message').textContent()) ?? '').includes(
          'Imported from MOBI:',
        );
      },
      { timeout: 300_000, intervals: [25] },
    )
    .toBe(true);
  await expect(page.getByTestId('body-editor')).toBeVisible();
  const ms = Date.now() - started;
  return { ms, still: await page.evaluate<number>(LONGEST_STILL) };
}

function checkMemory(core: CoreHandle): void {
  for (const [who, peak] of [
    ['core', peakRssBytes(core.pid)],
    ['page', rendererPeakBytes()],
  ] as const) {
    if (peak === null) continue;
    note(`${who} peak ${(peak / 2 ** 20).toFixed(0)} MB`);
    expect(peak, `peak resident memory of ${who}`).toBeLessThan(MEMORY_BUDGET_BYTES);
  }
}

test.use(OWN_CORE);

test.describe('performance - MOBI export and import (feature 018, SC-007)', () => {
  test.describe.configure({ mode: 'serial' });
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-018-perf-mobi-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
  });

  test(
    '10 MB text book: MOBI export <= 5 s, import <= 5 s, memory < 1.5 GB',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(300_000);
      const book = path.join(dir, 'large-10mb.fb2');
      const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
        encoding: 'utf8',
      });
      test.skip(made.status !== 0, 'python3 / gen-large-book.py unavailable');

      await core.openApp(page);
      await openFile(core, page, book);

      const mobiPath = path.join(dir, 'large-10mb.mobi');
      const out = await timedMobiExport(core, page, mobiPath);
      expect(existsSync(mobiPath)).toBe(true);
      note(`10 MB MOBI export: ${out.ms} ms (still <= ${out.still.toFixed(0)} ms)`);
      expect(out.ms, '10 MB MOBI export').toBeLessThan(5_000 * FACTOR);
      expect(out.still, '10 MB export progress cadence').toBeLessThan(1_000 * FACTOR);

      const back = await timedMobiImport(core, page, mobiPath);
      note(`10 MB MOBI import: ${back.ms} ms (still <= ${back.still.toFixed(0)} ms)`);
      expect(back.ms, '10 MB MOBI import').toBeLessThan(5_000 * FACTOR);
      expect(back.still, '10 MB import progress cadence').toBeLessThan(1_000 * FACTOR);
      checkMemory(core);
    },
  );

  test(
    '150 MB image-heavy book: MOBI export <= 20 s, import <= 30 s, memory < 1.5 GB',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(900_000);
      const book = writeBigPictureBook(dir);
      await core.openApp(page);
      await openFile(core, page, book.file);

      const mobiPath = path.join(dir, 'pictures-150mb.mobi');
      const out = await timedMobiExport(core, page, mobiPath);
      expect(existsSync(mobiPath)).toBe(true);
      note(`150 MB MOBI export: ${out.ms} ms (still <= ${out.still.toFixed(0)} ms)`);
      expect(out.ms, '150 MB MOBI export').toBeLessThan(20_000 * FACTOR);
      expect(out.still, '150 MB export progress cadence').toBeLessThan(1_000 * FACTOR);

      const back = await timedMobiImport(core, page, mobiPath);
      note(`150 MB MOBI import: ${back.ms} ms (still <= ${back.still.toFixed(0)} ms)`);
      expect(back.ms, '150 MB MOBI import').toBeLessThan(30_000 * FACTOR);
      expect(back.still, '150 MB import progress cadence').toBeLessThan(1_000 * FACTOR);
      checkMemory(core);
    },
  );

  test(
    'Cancel during MOBI export and import takes effect within 1 s, leaving no file and no change',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(900_000);
      const many = path.join(dir, 'many');
      mkdirSync(many, { recursive: true });
      const book = writeBigPictureBook(many, { others: 1500 });
      await core.openApp(page);
      await openFile(core, page, book.file);
      const title = await page.title();

      // Cancel mid-export
      const cancelTarget = path.join(many, 'cancelled.mobi');
      await core.enqueueDialog('dialog.saveFile', {
        path: cancelTarget,
        zip: false,
        selects: { format: 'mobi7', tocPlacement: 'afterTitle' },
      });
      await page.evaluate(ARM_CANCEL);
      await clickExport(core, page, 'exportMobi');
      const expCancel = await cancelMs(page);
      note(`MOBI export Cancel: ${expCancel.toFixed(0)} ms`);
      expect(expCancel, 'export ended before Cancel').toBeGreaterThanOrEqual(0);
      expect(expCancel, 'MOBI export Cancel').toBeLessThan(1_000 * FACTOR);
      await expect(page.getByTestId('status-message')).toContainText(/cancelled/i);
      expect(existsSync(cancelTarget), 'cancelled export leaves no file').toBe(false);
      expect(await page.title()).toBe(title);

      // Export whole book, then Cancel mid-import
      const wholeMobi = path.join(many, 'many.mobi');
      await timedMobiExport(core, page, wholeMobi);
      const shown = await shownDocId(page);
      await core.enqueueDialog('dialog.openFile', { paths: [wholeMobi] });
      await page.evaluate(ARM_CANCEL);
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-import').hover();
      await page.getByTestId('menu-file-import-importMobi').click();
      const impCancel = await cancelMs(page);
      note(`MOBI import Cancel: ${impCancel.toFixed(0)} ms`);
      expect(impCancel, 'import ended before Cancel').toBeGreaterThanOrEqual(0);
      expect(impCancel, 'MOBI import Cancel').toBeLessThan(1_000 * FACTOR);
      await expect(page.getByTestId('status-message')).toContainText(/cancelled/i);
      expect(await shownDocId(page), 'cancelled import leaves window book untouched').toBe(shown);
      expect(await page.title()).toBe(title);
    },
  );
});
