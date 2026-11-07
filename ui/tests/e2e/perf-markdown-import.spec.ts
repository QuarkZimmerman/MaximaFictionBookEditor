/**
 * Feature 010, US8 (T061, SC-010): a 10 MB Markdown file with 200 local pictures becomes an
 * editable book within 5 seconds with the release build. Tagged `@perf`, so CI runs it apart from
 * the functional journeys, on the Release core; `MFBE_PERF_FACTOR` (default 2) allows for a
 * loaded machine, as the other timed journeys do.
 */

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures/core';

const BUDGET_MS = 5000;
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;
const PICTURES = 200;
const TARGET_BYTES = 10 * 1024 * 1024;
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

test.describe('SC-010 (010) - a large Markdown file imports quickly', { tag: '@perf' }, () => {
  test('10 MB with 200 pictures is an editable book within 5 s', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.setTimeout(120_000);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mfbe-md-perf-'));
    try {
      const file = writeBook(dir);
      await core.openApp(page);
      await core.enqueueDialog('dialog.openFile', { paths: [file] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-import').hover();
      const started = Date.now();
      await page.getByTestId('menu-file-import-importMarkdown').click();
      await expect(page.getByTestId('status-message')).toContainText('(utf-8)', {
        timeout: 60_000,
      });
      const paragraph = page.getByTestId('body-editor').locator('.fb-section > p.fb-p').first();
      await paragraph.click({ position: { x: 4, y: 6 } });
      await page.keyboard.type('Z');
      await expect(paragraph).toContainText('Z');
      const elapsed = Date.now() - started;
      test.info().annotations.push({ type: 'import-ms', description: String(elapsed) });
      expect(elapsed, `import took ${elapsed} ms`).toBeLessThan(BUDGET_MS * PERF_FACTOR);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
