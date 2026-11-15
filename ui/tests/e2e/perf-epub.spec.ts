/**
 * Performance of the EPUB export and import and of the book's styles in the Body view (feature 012,
 * SC-010, SC-017; tagged `@perf`, run on the release core; x `MFBE_PERF_FACTOR` on hosted runners,
 * docs/performance.md):
 * - the 10 MB text book exports within 5 s and its EPUB becomes an editable book within 5 s; the 150 MB
 *   picture book within 20 s and 30 s; the core's and the page's peak memory each under 1.5 GB (Linux);
 * - the progress moves at least once a second, and Cancel takes effect within a second, leaving no file
 *   and the window's book as it was;
 * - on the 10 MB book Show Book Styles takes effect within a second, and with the styles shown a typed
 *   character appears within 100 ms.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { writeBigPictureBook } from './fixtures/bigPictureBook';
import { expect, shownDocId, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { exportEpubTo } from './fixtures/epubExport';
import { importDone, importViaMenu } from './fixtures/epubImport';
import { MEMORY_BUDGET_BYTES, OWN_CORE, peakRssBytes, rendererPeakBytes } from './fixtures/memory';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 1) || 1;
/** The reference EPUBs of feature 012 (`tests/fixtures/epub/make-fixtures.py`). */
const FIXTURE_EPUBS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/epub',
);

/**
 * Records, in the page, each moment the progress window's bar changes and the moment the window goes
 * (a program string: the journeys are typed without the DOM library). Sampled once a frame, so a
 * blocked page shows as the frozen bar the user would see.
 */
const WATCH_PROGRESS = `(() => {
  const w = window;
  performance.clearMarks();
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

/** The longest time the bar stood still while the progress window was shown, in ms. */
const LONGEST_STILL = `(() => {
  const p = window.__mfbeProgress;
  const marks = [...p.changes, p.end || performance.now()];
  let longest = 0;
  for (let i = 1; i < marks.length; i += 1) longest = Math.max(longest, marks[i] - marks[i - 1]);
  return longest;
})()`;

/** The import's phases (its performance marks), each with its ms since the one before. */
const IMPORT_PHASES = `(() => {
  const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('epub-import:'));
  let last = window.__mfbeProgress.changes[0] ?? (marks[0] ? marks[0].startTime : 0);
  return marks
    .map((m) => {
      const ms = m.startTime - last;
      last = m.startTime;
      return m.name.slice('epub-import:'.length) + ' ' + ms.toFixed(0);
    })
    .join(', ');
})()`;

/** Where the bar stood longest: its value then, and the one after (or the window's end). */
const STILL_WHERE = `(() => {
  const p = window.__mfbeProgress;
  const marks = [...p.changes, p.end || performance.now()];
  let at = 1;
  for (let i = 1; i < marks.length; i += 1) if (marks[i] - marks[i - 1] > marks[at] - marks[at - 1]) at = i;
  return (p.values[at - 1] ?? '?') + ' -> ' + (p.values[at] ?? 'the end');
})()`;

/**
 * Arms Cancel in the page before an operation starts: in the frame its progress window first shows
 * a value - the work under way - Cancel is pressed, and the ms until the window is gone are kept in
 * `__mfbeCancel`; -1 when the work ended before it could be cancelled.
 */
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

/** The armed Cancel's ms, once the operation's window is gone. */
async function cancelMs(page: Page): Promise<number> {
  await expect
    .poll(() => page.evaluate<number | null>('window.__mfbeCancel'), { timeout: 300_000 })
    .not.toBeNull();
  return page.evaluate<number>('window.__mfbeCancel');
}

/** Clicks Show Book Styles in the open View menu and returns the ms until the styles are drawn. */
const SWITCH_TIMED = `(async () => {
  const start = performance.now();
  document.querySelector('[data-testid="menu-view-showBookStyles"]').click();
  const drawn = () =>
    document.querySelector('[data-testid="body-view"]')?.classList.contains('mfbe-book-styles') &&
    document.getElementById('mfbe-book-styles');
  while (!drawn()) await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;

/** Inserts a character at the caret and waits for the editor to settle (as perf-large-book). */
const TYPE_AND_MEASURE = `(async () => {
  const start = performance.now();
  document.execCommand('insertText', false, 'x');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return performance.now() - start;
})()`;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const note = (description: string): void => {
  test.info().annotations.push({ type: 'perf', description });
};

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file, 120_000);
}

/** The export to `target`, timed, its progress watched; resolves the ms and the longest still bar. */
async function timedExport(core: CoreHandle, page: Page, target: string) {
  await page.evaluate(WATCH_PROGRESS);
  const started = Date.now();
  await exportEpubTo(core, page, target, 300_000);
  const ms = Date.now() - started;
  return {
    ms,
    still: await page.evaluate<number>(LONGEST_STILL),
    where: await page.evaluate<string>(STILL_WHERE),
  };
}

/** The import of `epub` until the new book is editable, timed, its progress watched. */
async function timedImport(core: CoreHandle, page: Page, epub: string) {
  // The window's book is unchanged, so no question comes: the clock runs from the command.
  await page.evaluate(WATCH_PROGRESS);
  const started = Date.now();
  const before = await importViaMenu(core, page, epub, { question: false });
  await importDone(page, before, 300_000);
  await expect(page.getByTestId('body-editor')).toBeVisible();
  const ms = Date.now() - started;
  return {
    ms,
    still: await page.evaluate<number>(LONGEST_STILL),
    where: await page.evaluate<string>(STILL_WHERE),
    phases: await page.evaluate<string>(IMPORT_PHASES),
  };
}

function checkMemory(core: CoreHandle): void {
  for (const [who, peak] of [
    ['core', peakRssBytes(core.pid)],
    ['page', rendererPeakBytes()],
  ] as const) {
    if (peak === null) continue;
    note(`${who} peak ${(peak / 2 ** 20).toFixed(0)} MB`);
    expect(peak, `peak resident memory of the ${who}`).toBeLessThan(MEMORY_BUDGET_BYTES);
  }
}

/** The 10 MB text book, with a stylesheet for Show Book Styles to draw (inserted as bytes). */
function writeTextBook(dir: string): string | null {
  const book = path.join(dir, 'large.fb2');
  if (existsSync(book)) return book;
  const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
    encoding: 'utf8',
  });
  if (made.status !== 0) return null;
  const bytes = readFileSync(book);
  const at = bytes.indexOf('<description');
  const sheet = Buffer.from(
    '<stylesheet type="text/css">p { text-indent: 2em; line-height: 1.4; } ' +
      'emphasis { color: #224466; } section > title { text-align: center; }</stylesheet>',
  );
  writeFileSync(book, Buffer.concat([bytes.subarray(0, at), sheet, bytes.subarray(at)]));
  return book;
}

// The view settings these journeys change (spelling, the language, the book's styles) go back to their
// defaults after each test: a worker's core keeps its settings from one test to the next.
test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

// Each test measures a core of its own (fixtures/memory.ts).
test.use(OWN_CORE);

test.describe('performance - the EPUB export and import, the book styles (SC-010, SC-017)', () => {
  test.describe.configure({ mode: 'serial' });
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-012-perf-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.rpc('settings.set', {
      patch: { view: { spellEnabled: false, showBookStyles: false } },
    });
  });

  test(
    'the 10 MB text book: export within 5 s, import within 5 s',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(300_000);
      const book = writeTextBook(dir);
      test.skip(book === null, 'python3 / the generator are not available');
      await core.openApp(page);
      await open(core, page, book!);
      const out = await timedExport(core, page, path.join(dir, 'large.epub'));
      note(
        `10 MB export: ${out.ms} ms, the bar still at most ${out.still.toFixed(0)} ms (${out.where})`,
      );
      expect(out.ms, '10 MB export').toBeLessThan(5_000 * FACTOR);
      expect(out.still, 'the export progress stands still').toBeLessThan(1_000 * FACTOR);
      const back = await timedImport(core, page, path.join(dir, 'large.epub'));
      note(
        `10 MB import: ${back.ms} ms, the bar still at most ${back.still.toFixed(0)} ms (${back.where})`,
      );
      note(`10 MB import phases (ms): ${back.phases}`);
      expect(back.ms, '10 MB import').toBeLessThan(5_000 * FACTOR);
      expect(back.still, 'the import progress stands still').toBeLessThan(1_000 * FACTOR);
      checkMemory(core);
    },
  );

  test(
    'an EPUB with a MathML formula: the first formula import after start within 5 s (013, SC-005)',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(300_000);
      // A core and a page of their own: the formula part and MathJax 4's font are not loaded yet.
      await core.openApp(page);
      const back = await timedImport(core, page, path.join(FIXTURE_EPUBS, 'everything.epub'));
      note(`first formula import (everything.epub): ${back.ms} ms`);
      note(`first formula import phases (ms): ${back.phases}`);
      expect(back.ms, 'the first formula import').toBeLessThan(5_000 * FACTOR);
    },
  );

  test(
    'the 150 MB picture book: export within 20 s, import within 30 s',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(900_000);
      const book = writeBigPictureBook(dir);
      await core.openApp(page);
      await open(core, page, book.file);
      const out = await timedExport(core, page, path.join(dir, 'pictures.epub'));
      note(
        `150 MB export: ${out.ms} ms, the bar still at most ${out.still.toFixed(0)} ms (${out.where})`,
      );
      expect(out.ms, '150 MB export').toBeLessThan(20_000 * FACTOR);
      expect(out.still, 'the export progress stands still').toBeLessThan(1_000 * FACTOR);
      const back = await timedImport(core, page, path.join(dir, 'pictures.epub'));
      note(
        `150 MB import: ${back.ms} ms, the bar still at most ${back.still.toFixed(0)} ms (${back.where})`,
      );
      note(`150 MB import phases (ms): ${back.phases}`);
      expect(back.ms, '150 MB import').toBeLessThan(30_000 * FACTOR);
      expect(back.still, 'the import progress stands still').toBeLessThan(1_000 * FACTOR);
      checkMemory(core);
    },
  );

  test(
    'Cancel takes effect within a second, leaving no file and no change',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(900_000);
      // As big a book in 1500 pictures: both operations take many steps, so Cancel lands mid-way.
      const many = path.join(dir, 'many');
      mkdirSync(many, { recursive: true });
      const book = writeBigPictureBook(many, { others: 1500 });
      await core.openApp(page);
      await open(core, page, book.file);
      const title = await page.title();
      // The export, cancelled in the frame its progress begins.
      const target = path.join(many, 'cancelled.epub');
      await core.enqueueDialog('dialog.saveFile', { path: target });
      await page.evaluate(ARM_CANCEL);
      await clickExport(core, page, 'exportEpub');
      const exportCancel = await cancelMs(page);
      note(`export Cancel: ${exportCancel.toFixed(0)} ms`);
      expect(exportCancel, 'the export ended before Cancel').toBeGreaterThanOrEqual(0);
      expect(exportCancel, 'the export Cancel').toBeLessThan(1_000 * FACTOR);
      await expect(page.getByTestId('status-message')).toContainText('cancelled');
      expect(existsSync(target), 'a cancelled export leaves no file').toBe(false);
      expect(await page.title()).toBe(title);
      // The import of the book's EPUB, cancelled in the frame its progress begins.
      const epub = path.join(many, 'many.epub');
      await exportEpubTo(core, page, epub, 300_000);
      const shown = await shownDocId(page);
      await page.evaluate(ARM_CANCEL);
      await importViaMenu(core, page, epub, { question: false });
      const importCancel = await cancelMs(page);
      note(`import Cancel: ${importCancel.toFixed(0)} ms`);
      expect(importCancel, 'the import ended before Cancel').toBeGreaterThanOrEqual(0);
      expect(importCancel, 'the import Cancel').toBeLessThan(1_000 * FACTOR);
      await expect(page.getByTestId('status-message')).toContainText('cancelled');
      expect(await shownDocId(page), 'a cancelled import leaves the window its book').toBe(shown);
      expect(await page.title()).toBe(title);
    },
  );

  test(
    'the 10 MB book: the styles shown within 1 s, typing within 100 ms',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.setTimeout(300_000);
      const book = writeTextBook(dir);
      test.skip(book === null, 'python3 / the generator are not available');
      await core.openApp(page);
      await open(core, page, book!);
      await page.getByTestId('menu-view').click();
      const shown = await page.evaluate<number>(SWITCH_TIMED);
      note(`Show Book Styles on the 10 MB book: ${shown.toFixed(0)} ms`);
      expect(shown, 'the switch').toBeLessThan(1_000 * FACTOR);
      const paragraph = page.getByTestId('body-editor').locator('.fb-section p.fb-p').nth(3);
      await paragraph.click({ position: { x: 8, y: 8 } });
      await expect(page.getByTestId('status-path')).toContainText('/p[');
      await page.evaluate(TYPE_AND_MEASURE);
      const samples: number[] = [];
      for (let i = 0; i < 10; i += 1) samples.push(await page.evaluate<number>(TYPE_AND_MEASURE));
      note(`typing with the styles shown: median ${median(samples).toFixed(1)} ms`);
      expect(
        median(samples),
        `keystroke latencies ${samples.map((s) => s.toFixed(0)).join(', ')} ms`,
      ).toBeLessThan(100 * FACTOR);
    },
  );
});
