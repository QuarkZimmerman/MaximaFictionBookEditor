/**
 * Performance journey of the picture view (feature 007, T100; FR-055; constitution budgets;
 * tagged `@perf`, so CI runs it apart from the journeys): in a book of about 150 MB whose
 * pictures include one 20 MB JPEG of 4000 x 6000 pixels - generated at run time by
 * `fixtures/bigPictureBook.ts` into the test's temporary folder, never committed - the
 * picture view of that picture:
 *   - appears within 1 s of the click on its thumbnail;
 *   - keeps the editor responsive while the picture loads: no frame gap above 100 ms
 *     (x `MFBE_PERF_FACTOR` on hosted runners, docs/performance.md);
 *   - keeps the peak resident memory of the core and of the page's renderer each under the
 *     constitution's 1.5 GB (Linux: VmHWM from /proc, as tests/bench/bench.mjs reads it;
 *     elsewhere the memory check is skipped).
 * Run it against the Release core: MFBE_CORE_BIN=../build/linux-core-release/bin/mfbe-core.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeBigPictureBook } from './fixtures/bigPictureBook';
import { expect, test, waitForBook } from './fixtures/core';
import { MEMORY_BUDGET_BYTES, peakRssBytes, rendererPids } from './fixtures/memory';

const VIEW_BUDGET_MS = 1000;
const FRAME_BUDGET_MS = 100;
/** Hosted CI runners against a 2020-era laptop (docs/performance.md). */
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;

/**
 * In-page timing (a program string: the journeys are typed without the DOM library): the click
 * on the thumbnail of binary `id`, the moment the view is shown, the moment the picture is
 * decoded, and the longest gap between two frames until then.
 */
const openTimed = (id: string) => `(async () => {
  const thumbnail = document.querySelector('[data-testid="binary-objects-view-${id}"]');
  const start = performance.now();
  thumbnail.click();
  let shown = -1;
  let decoded = -1;
  let maxGap = 0;
  let last = performance.now();
  let decodeStarted = false;
  while (decoded < 0 && performance.now() - start < 60000) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    const picture = document.querySelector('[data-testid="picture-view-picture"]');
    if (picture && shown < 0) shown = now - start;
    if (picture && !decodeStarted) {
      decodeStarted = true;
      picture.decode().then(
        () => (decoded = performance.now() - start),
        () => (decoded = performance.now() - start),
      );
    }
  }
  const picture = document.querySelector('[data-testid="picture-view-picture"]');
  return { shown, decoded, maxGap, naturalWidth: picture ? picture.naturalWidth : 0 };
})()`;

/** In-page: Escape on the focused element, until the view has gone. */
const ESCAPE_TIMED = `(async () => {
  const start = performance.now();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  while (document.querySelector('[data-testid="picture-view"]')) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
  return performance.now() - start;
})()`;

const mb = (bytes: number | null) =>
  bytes === null ? 'n/a' : `${(bytes / 1048576).toFixed(0)} MB`;

test.describe(
  'performance - the picture view of a 20 MB picture in a 150 MB book (FR-055)',
  {
    tag: '@perf',
  },
  () => {
    let dir = '';
    test.beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'mfbe-perf-picture-view-'));
    });
    test.afterAll(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    test('the view appears within 1 s, the editor stays responsive, memory stays in budget', async ({
      core,
      page,
    }) => {
      test.skip(!core.hasCore, 'needs the real core (MFBE_CORE_BIN)');
      test.setTimeout(300_000);
      const book = writeBigPictureBook(dir);
      expect(book.bytes).toBeGreaterThan(140 * 1024 * 1024);
      expect(book.bigBytes).toBeGreaterThanOrEqual(20 * 1024 * 1024);

      await core.openApp(page);
      await core.enqueueDialog('dialog.openFile', { paths: [book.file] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, path.basename(book.file), 120_000);
      await page.getByTestId('view-description').click();
      const button = page.getByTestId(`binary-objects-view-${book.bigId}`);
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();

      // In the page: the click, the view shown, the picture decoded, and the longest gap between
      // two frames while it loads.
      const timing = (await page.evaluate(openTimed(book.bigId))) as {
        shown: number;
        decoded: number;
        maxGap: number;
        naturalWidth: number;
      };
      const coreMemory = peakRssBytes(core.pid);
      const rendererMemory = rendererPids()
        .map((pid) => peakRssBytes(pid) ?? 0)
        .reduce<number | null>((max, bytes) => Math.max(max ?? 0, bytes), null);
      console.log(
        `picture view: book ${mb(book.bytes)}, picture ${mb(book.bigBytes)} ` +
          `${book.bigWidth}x${book.bigHeight}; shown ${timing.shown.toFixed(0)} ms, decoded ` +
          `${timing.decoded.toFixed(0)} ms, longest frame gap ${timing.maxGap.toFixed(0)} ms; ` +
          `peak memory: core ${mb(coreMemory)}, renderer ${mb(rendererMemory)}`,
      );

      expect(timing.naturalWidth).toBe(book.bigWidth);
      expect(timing.shown).toBeGreaterThanOrEqual(0);
      expect(timing.shown).toBeLessThan(VIEW_BUDGET_MS);
      expect(timing.decoded).toBeGreaterThanOrEqual(0);
      expect(timing.maxGap).toBeLessThan(FRAME_BUDGET_MS * PERF_FACTOR);
      // The view opened fitted: the picture exceeds the window.
      await expect(page.getByTestId('picture-view')).toHaveAttribute('data-mode', 'fitted');
      if (coreMemory !== null) expect(coreMemory).toBeLessThan(MEMORY_BUDGET_BYTES);
      if (rendererMemory !== null) expect(rendererMemory).toBeLessThan(MEMORY_BUDGET_BYTES);

      // An interaction while the view is open answers at once: Escape closes it.
      const closed = (await page.evaluate(ESCAPE_TIMED)) as number;
      expect(closed).toBeLessThan(FRAME_BUDGET_MS * PERF_FACTOR);
    });

    test('a second 150 MB book opened over the first: two documents held a moment, memory in budget (feature 010, T030)', async ({
      core,
      page,
    }) => {
      test.skip(!core.hasCore, 'needs the real core (MFBE_CORE_BIN)');
      test.setTimeout(300_000);
      const book = writeBigPictureBook(dir);
      // Feature 010 (US10, DP-8): the new book is read before the open one is closed, so the
      // core holds both while the second loads.
      const second = path.join(dir, `second-${path.basename(book.file)}`);
      copyFileSync(book.file, second);
      await core.openApp(page);
      for (const file of [book.file, second]) {
        await core.enqueueDialog('dialog.openFile', { paths: [file] });
        await page.getByTestId('menu-file').click();
        await page.getByTestId('menu-file-open').click();
        await waitForBook(page, path.basename(file), 120_000);
      }
      const coreMemory = peakRssBytes(core.pid);
      const rendererMemory = rendererPids()
        .map((pid) => peakRssBytes(pid) ?? 0)
        .reduce<number | null>((max, bytes) => Math.max(max ?? 0, bytes), null);
      console.log(
        `two 150 MB books: book ${mb(book.bytes)}; peak memory: core ${mb(coreMemory)}, ` +
          `renderer ${mb(rendererMemory)}`,
      );
      if (coreMemory !== null) expect(coreMemory).toBeLessThan(MEMORY_BUDGET_BYTES);
      if (rendererMemory !== null) expect(rendererMemory).toBeLessThan(MEMORY_BUDGET_BYTES);
    });
  },
);
