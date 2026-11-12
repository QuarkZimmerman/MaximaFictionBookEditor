/**
 * Feature 010, US8 (T061, SC-010): a 10 MB Markdown file with 200 local pictures becomes an
 * editable book within 5 seconds with the release build. Tagged `@perf`, so CI runs it apart from
 * the functional journeys, on the Release core; `MFBE_PERF_FACTOR` (default 2) allows for a
 * loaded machine, as the other timed journeys do. Feature 013 (SC-005): a book with formulas, the
 * first formula import after start, within the same budget - the formula part and the parts of
 * MathJax 4's font load on that first use.
 */

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, test, type CoreHandle } from './fixtures/core';

const BUDGET_MS = 5000;
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
const PICTURES = 200;
const TARGET_BYTES = 10 * 1024 * 1024;
const FORMULA_CHAPTERS = 40;
/** The book's formula pictures, counted in the page (the journeys' config has no DOM types). */
const FORMULA_PICTURES = `(window.__mfbeTest?.scripts?.document()?.binaries ?? [])
  .filter((binary) => binary.id.startsWith('formula-')).length`;
const RED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/markdown/pictures/red.png',
);

/** Chapters of plain prose with some styles, links and a picture every few sections. */
function writeBook(dir: string): string {
  mkdirSync(path.join(dir, 'img'));
  for (let n = 0; n < PICTURES; n += 1) copyFileSync(RED, path.join(dir, 'img', `p${n}.png`));
  const paragraph =
    'The quick brown fox jumps over the lazy dog, and *the dog* does not mind at all; ' +
    '**nobody** minds, in fact, as the `fox` is quick and the day is long. ';
  const parts: string[] = ['# A Large Book\n\n'];
  let size = 0;
  for (let chapter = 0; size < TARGET_BYTES; chapter += 1) {
    const text = `## Chapter ${chapter}\n\n${`${paragraph.repeat(6)}\n\n`.repeat(8)}`;
    const picture = chapter < PICTURES ? `![Picture ${chapter}](img/p${chapter}.png)\n\n` : '';
    parts.push(text, picture);
    size += text.length + picture.length;
  }
  const file = path.join(dir, 'large.md');
  writeFileSync(file, parts.join(''));
  return file;
}

/** Feature 013: chapters of prose, each with an in-line and a block formula (Greek letters, sums, roots). */
function writeFormulaBook(dir: string): string {
  const prose = 'The quick brown fox jumps over the lazy dog, and the day is long. '.repeat(8);
  const parts: string[] = ['# Formulas\n\n'];
  for (let chapter = 0; chapter < FORMULA_CHAPTERS; chapter += 1) {
    parts.push(
      `## Chapter ${chapter}\n\n${prose}with $\\alpha_${chapter} + \\beta = \\gamma$ in a line.\n\n`,
      `$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} + \\sqrt{${chapter}}\n$$\n\n`,
    );
  }
  const file = path.join(dir, 'formulas.md');
  writeFileSync(file, parts.join(''));
  return file;
}

/** Imports `file` through File > Import > Markdown and returns the ms until a typed key shows. */
async function timedMarkdownImport(core: CoreHandle, page: Page, file: string): Promise<number> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  const started = Date.now();
  await page.getByTestId('menu-file-import-importMarkdown').click();
  await expect(page.getByTestId('status-message')).toContainText('(utf-8)', { timeout: 60_000 });
  const paragraph = page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();
  await paragraph.click({ position: { x: 4, y: 6 } });
  await page.keyboard.type('Z');
  await expect(paragraph).toContainText('Z');
  return Date.now() - started;
}

test.describe('SC-010 (010) - a large Markdown file imports quickly', { tag: '@perf' }, () => {
  test('10 MB with 200 pictures is an editable book within 5 s', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.setTimeout(120_000);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mfbe-md-perf-'));
    try {
      const elapsed = await timedMarkdownImport(core, page, writeBook(dir));
      test.info().annotations.push({ type: 'import-ms', description: String(elapsed) });
      expect(elapsed, `import took ${elapsed} ms`).toBeLessThan(BUDGET_MS * PERF_FACTOR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a book with 80 formulas, the first formula import after start, within 5 s (013, SC-005)', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.setTimeout(120_000);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mfbe-md-perf-formulas-'));
    try {
      const elapsed = await timedMarkdownImport(core, page, writeFormulaBook(dir));
      test.info().annotations.push({ type: 'import-ms', description: String(elapsed) });
      // Every formula became a picture (a `formula-N` binary): none fell back to its text.
      expect(await page.evaluate<number>(FORMULA_PICTURES), 'formula pictures').toBe(
        FORMULA_CHAPTERS * 2,
      );
      expect(elapsed, `import took ${elapsed} ms`).toBeLessThan(BUDGET_MS * PERF_FACTOR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
