/**
 * Feature 012, User Story 7 (T063, T064; D34; FR-055; SC-013): export to EPUB and import again gives the
 * book back, apart from D34's list. For each book: open it, save it as the editor writes it, export it
 * to EPUB, import the EPUB, save the new book, and compare the two saved books with
 * tests/epub/compare-fb2.js in the page.
 *
 * The books: the reference book by default; `MFBE_ROUND_TRIP_BOOKS` names a list file, one path per
 * line (tests/epub/round-trip.mjs runs the corpus sample so). `MFBE_ROUND_TRIP_REPORT` receives the
 * results as JSON.
 */

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { bodyErrors, bookXml, importDone, importViaMenu } from './fixtures/epubImport';

const COMPARE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/epub/compare-fb2.js'),
  'utf8',
);

function books(): string[] {
  const list = process.env.MFBE_ROUND_TRIP_BOOKS;
  if (!list) return [fixtureBook('reference-all-elements.fb2')];
  return readFileSync(list, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

interface Result {
  book: string;
  differences: string[];
  failure?: string;
  /** The original's own body errors: FB2's schema refuses parts of it, which no export can carry. */
  invalid?: string[];
}

async function openCopy(core: CoreHandle, page: Page, book: string, dir: string): Promise<string> {
  const copy = path.join(dir, path.basename(book));
  copyFileSync(book, copy);
  await core.enqueueDialog('dialog.openFile', { paths: [copy] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, copy, 120_000);
  return copy;
}

async function exportEpub(core: CoreHandle, page: Page, target: string): Promise<void> {
  await core.enqueueDialog('dialog.saveFile', { path: target });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-export').hover();
  await page.getByTestId('menu-file-export-exportEpub').click();
  const status = page.getByTestId('status-message');
  const summary = page.getByTestId('dialog-epub-export-summary');
  const failed = page.getByTestId('dialog-epub-export-failed');
  await expect
    .poll(
      async () => {
        if (await failed.isVisible())
          throw new Error(`the export failed: ${await failed.textContent()}`);
        if (await summary.isVisible()) {
          await summary.getByRole('button', { name: 'OK' }).click();
          return true;
        }
        return (await status.textContent())?.includes(`Exported to ${target}`) ?? false;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
}

test.describe('US7 (feature 012) - export and import again', () => {
  test('each book comes back, apart from D34 (SC-013)', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const list = books();
    test.setTimeout(60_000 + list.length * 180_000);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const results: Result[] = [];
    for (const book of list) {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'mfbe-round-trip-'));
      try {
        await openCopy(core, page, book, dir);
        const invalid = await bodyErrors(core, page);
        const original = await bookXml(core, page);
        const epub = path.join(dir, 'book.epub');
        await exportEpub(core, page, epub);
        // importDone waits for the new book to be the shown one.
        await importDone(page, await importViaMenu(core, page, epub), 120_000);
        const again = await bookXml(core, page);
        const differences = await page.evaluate<string[]>(
          `(${COMPARE})(${JSON.stringify(original)}, ${JSON.stringify(again)})`,
        );
        results.push({
          book,
          differences,
          ...(invalid.length > 0 ? { invalid: invalid.slice(0, 3) } : {}),
        });
      } catch (error) {
        results.push({ book, differences: [], failure: String(error).split('\n')[0] });
        await page.keyboard.press('Escape');
      }
    }
    if (process.env.MFBE_ROUND_TRIP_REPORT) {
      writeFileSync(process.env.MFBE_ROUND_TRIP_REPORT, `${JSON.stringify(results, null, 2)}\n`);
    }
    // A book with invalid bodies is reported apart: what FB2 refuses comes back in a valid form.
    expect(
      results.filter(
        (result) => result.failure || (!result.invalid && result.differences.length > 0),
      ),
    ).toEqual([]);
  });
});
