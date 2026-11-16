/**
 * Feature 016 (SC-010; tasks T066; tagged `@perf`): the PDF import's time and memory, on the Release core and
 * reader (MFBE_CORE_BIN):
 * - the reference book's PDF (the editor's own, a fixture) within 10 s;
 * - a 300-page scan with a text layer within 1 min, the library's longest and largest PDFs within 3 min each -
 *   the library's books named by the local list tests/corpus/sample-perf-pdf.txt (or MFBE_PERF_PDF_LIST; lines
 *   `scan300 <path>`, `longest <path>`, `largest <path>`), skipped where the library is not;
 * - the editor's processes together - the core, its reader, the page's renderer - within 1.5 GB (Linux);
 * - the progress moves at least once a second, and Cancel ends the import within a second with the window's
 *   book unchanged.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, shownDocId, test, type CoreHandle } from './fixtures/core';
import { MEMORY_BUDGET_BYTES, OWN_CORE, peakRssBytes, rendererPids } from './fixtures/memory';
import { importPdfViaMenu, pdf, pdfImportDone, PdfImportFailed } from './fixtures/pdfImport';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 1);
const LIST =
  process.env.MFBE_PERF_PDF_LIST ?? path.join(REPO_ROOT, 'tests', 'corpus', 'sample-perf-pdf.txt');

/** The library's book of `role` from the local list, or null. */
function libraryBook(role: string): string | null {
  if (!existsSync(LIST)) return null;
  for (const line of readFileSync(LIST, 'utf8').split('\n')) {
    const [name, ...rest] = line.trim().split(' ');
    const file = rest.join(' ');
    if (name === role && file && existsSync(file)) return file;
  }
  return null;
}

/** The peak memory of the core's reader processes alive now (Linux VmHWM), by process. */
function readerPeaks(corePid: number | undefined, peaks: Map<number, number>): void {
  if (!corePid || !existsSync('/proc')) return;
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = readFileSync(`/proc/${entry}/status`, 'utf8');
      if (
        !/^Name:\s+mfbe-pdf-reader/m.test(status) ||
        !new RegExp(`^PPid:\\s+${corePid}$`, 'm').test(status)
      )
        continue;
      const match = /VmHWM:\s+(\d+)\s+kB/.exec(status);
      if (match)
        peaks.set(Number(entry), Math.max(peaks.get(Number(entry)) ?? 0, Number(match[1]) * 1024));
    } catch {
      // the process has ended
    }
  }
}

/** Imports `file`, watching the progress and the reader's memory; the time it took and what was seen. */
async function timedImport(core: CoreHandle, page: Page, file: string, limitMs: number) {
  // From the menu's click: the window holds a new book, so no "Save changes" question comes, and waiting
  // for one would take its two seconds out of the time measured.
  const started = Date.now();
  const before = await importPdfViaMenu(core, page, file, { question: false });
  let running = true;
  // A PDF the import refuses (a scan without text) ends with its message: that is its end too (SC-010).
  let refused = '';
  let summary = '';
  const done = pdfImportDone(page, before, limitMs)
    .then((text) => {
      summary = text;
    })
    .catch((error: unknown) => {
      if (!(error instanceof PdfImportFailed)) throw error;
      refused = error.message;
    })
    .finally(() => {
      running = false;
    });
  const peaks = new Map<number, number>();
  let last = '';
  let since = Date.now();
  let longest = 0;
  // What the progress said when it stood still longest, to tell the step.
  let stillAt = '';
  let label = '';
  while (running) {
    readerPeaks(core.pid, peaks);
    const [value, text] = (await page
      .evaluate(
        `[document.querySelector('[data-testid="modal-job-progress"]')?.getAttribute('value') ?? null, (document.querySelector('[data-testid="modal-job"]')?.textContent ?? '') + ' /' + (document.querySelector('[data-testid="modal-job-progress"]')?.getAttribute('max') ?? '')]`,
      )
      .catch(() => [null, ''])) as [string | null, string];
    // A bar without a value is indeterminate: it moves by itself.
    if (value === null || value !== last) {
      last = value ?? '';
      since = Date.now();
      label = text;
    }
    if (Date.now() - since > longest) {
      longest = Date.now() - since;
      stillAt = `${label} ${last}`;
    }
    await page.waitForTimeout(100);
  }
  await done;
  const elapsed = Date.now() - started;
  const reader = Math.max(0, ...peaks.values());
  return {
    elapsed,
    longest,
    reader,
    stillAt: stillAt.replace(/\s+/g, ' ').trim(),
    refused,
    summary: summary || (await page.getByTestId('status-message').textContent()) || '',
  };
}

function checkMemory(core: CoreHandle, what: string, reader: number): void {
  const coreBytes = peakRssBytes(core.pid);
  if (coreBytes === null) return;
  const renderer = rendererPids().reduce((sum, pid) => sum + (peakRssBytes(pid) ?? 0), 0);
  const all = coreBytes + reader + renderer;
  test.info().annotations.push({
    type: 'perf',
    description: `${what}: peak memory core ${coreBytes}, reader ${reader}, renderer ${renderer} bytes`,
  });
  expect(all, `${what}: the editor's processes' peak memory together`).toBeLessThanOrEqual(
    MEMORY_BUDGET_BYTES,
  );
}

// Each test measures a core of its own (fixtures/memory.ts).
test.use(OWN_CORE);

test.describe('performance - the PDF import (SC-010)', () => {
  const cases: Array<[string, () => string | null, number]> = [
    ['the reference book’s PDF within 10 s', () => pdf('reference-0.0.11-a5.pdf'), 10_000],
    ['a 300-page scan with a text layer within 1 min', () => libraryBook('scan300'), 60_000],
    ['the library’s longest PDF within 3 min', () => libraryBook('longest'), 180_000],
    ['the library’s largest PDF within 3 min', () => libraryBook('largest'), 180_000],
  ];
  for (const [title, book, limit] of cases) {
    test(title, { tag: '@perf' }, async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      const file = book();
      test.skip(!file, 'the library is not here (tests/corpus/sample-perf-pdf.txt)');
      test.setTimeout(limit * FACTOR + 120_000);
      await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
      await core.openApp(page);
      const { elapsed, longest, reader, stillAt, refused, summary } = await timedImport(
        core,
        page,
        file!,
        limit * FACTOR + 60_000,
      );
      test.info().annotations.push({
        type: 'perf',
        description: `${path.basename(file!)}: ${elapsed} ms${refused ? ` (refused: ${refused.slice(0, 120)})` : ` (${summary.replace(/\s+/g, ' ').slice(0, 120)})`}, the progress still at most ${longest} ms (at "${stillAt.slice(0, 80)}")`,
      });
      expect(elapsed).toBeLessThanOrEqual(limit * FACTOR);
      expect(longest, 'the progress moves at least once a second').toBeLessThanOrEqual(
        1_000 * FACTOR,
      );
      checkMemory(core, path.basename(file!), reader);
    });
  }

  test(
    'Cancel ends the import within a second, the book unchanged',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      const file = libraryBook('longest') ?? pdf('reference-0.0.11-a5.pdf');
      test.setTimeout(120_000);
      await core.openApp(page);
      const before = await importPdfViaMenu(core, page, file);
      await page.getByTestId('modal-job').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2_000);
      const clicked = Date.now();
      await page.getByTestId('modal-job-cancel').click();
      await expect(page.getByTestId('modal-job')).toBeHidden({ timeout: 10_000 });
      const elapsed = Date.now() - clicked;
      test.info().annotations.push({ type: 'perf', description: `Cancel: ${elapsed} ms` });
      expect(elapsed).toBeLessThan(1_000 * FACTOR);
      expect(await shownDocId(page)).toBe(before);
    },
  );
});
