/**
 * Performance of the Markdown exports (feature 011, SC-009; tagged `@perf`): the 10 MB text book
 * exports in either form within 5 s; the 150 MB picture book within 15 s as a ZIP and within 60 s
 * as one file (x `MFBE_PERF_FACTOR` on hosted runners, docs/performance.md), the core's peak memory
 * under 1.5 GB (Linux).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { writeBigPictureBook } from './fixtures/bigPictureBook';
import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';
import { clickExport } from './fixtures/exportCheck';
import { MEMORY_BUDGET_BYTES, OWN_CORE, peakRssBytes } from './fixtures/memory';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 1);

async function open(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file, 60_000);
}

async function exportAs(
  core: CoreHandle,
  page: Page,
  form: 'md' | 'zip',
  target: string,
): Promise<number> {
  await core.enqueueDialog('dialog.saveFile', { path: target, zip: true });
  const started = Date.now();
  await clickExport(core, page, form === 'md' ? 'exportMarkdown' : 'exportMarkdownZip');
  await expect(page.getByTestId('status-message')).toContainText(`Exported to ${target}:`, {
    timeout: 180_000,
  });
  const elapsed = Date.now() - started;
  expect(existsSync(target)).toBe(true);
  return elapsed;
}

// Each test measures a core of its own (fixtures/memory.ts).
test.use(OWN_CORE);

test.describe('performance - the Markdown exports (SC-009)', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-perf-export-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test(
    'the 10 MB text book in either form within 5 s',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.setTimeout(240_000);
      const book = path.join(dir, 'large.fb2');
      const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
        encoding: 'utf8',
      });
      test.skip(made.status !== 0, 'python3 / the generator are not available');
      await open(core, page, book);
      for (const form of ['md', 'zip'] as const) {
        const elapsed = await exportAs(
          core,
          page,
          form,
          path.join(dir, `large.${form === 'md' ? 'md' : 'md.zip'}`),
        );
        test
          .info()
          .annotations.push({ type: 'perf', description: `10 MB as ${form}: ${elapsed} ms` });
        expect(elapsed, `10 MB as ${form}`).toBeLessThan(5_000 * FACTOR);
      }
    },
  );

  test(
    'the 150 MB picture book: ZIP within 15 s, one file within 60 s',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.setTimeout(600_000);
      const book = writeBigPictureBook(dir);
      await open(core, page, book.file);
      const zip = await exportAs(core, page, 'zip', path.join(dir, 'pictures.md.zip'));
      test.info().annotations.push({ type: 'perf', description: `150 MB as ZIP: ${zip} ms` });
      expect(zip, '150 MB as ZIP').toBeLessThan(15_000 * FACTOR);
      const one = await exportAs(core, page, 'md', path.join(dir, 'pictures.md'));
      test.info().annotations.push({ type: 'perf', description: `150 MB as one file: ${one} ms` });
      expect(one, '150 MB as one file').toBeLessThan(60_000 * FACTOR);
      // The core's peak memory over both exports stays within the constitution's budget.
      const peak = peakRssBytes(core.pid);
      if (peak !== null) {
        test.info().annotations.push({
          type: 'perf',
          description: `core peak ${(peak / 2 ** 20).toFixed(0)} MB`,
        });
        expect(peak, 'peak resident memory of the core').toBeLessThan(MEMORY_BUDGET_BYTES);
      }
    },
  );
});
