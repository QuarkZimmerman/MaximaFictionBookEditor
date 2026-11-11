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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, fixtureBook, test } from './fixtures/core';
import { bodyErrors, bookXml, importDone, importViaMenu } from './fixtures/epubImport';
import { exportEpubTo, openBookCopy } from './fixtures/epubExport';
import { scratchDir } from './fixtures/scratch';

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
  /** The book imported again is not valid: always a fault of the conversion. */
  againInvalid?: string[];
  /** Where that book was kept, beside the report, for its diagnosis. */
  againFile?: string;
}

/** Keeps a book imported again that is not valid beside the report; undefined without a report. */
function keepInvalid(book: string, xml: string): string | undefined {
  const report = process.env.MFBE_ROUND_TRIP_REPORT;
  if (!report) return undefined;
  const dir = `${report.replace(/\.json$/, '')}-invalid`;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(book));
  writeFileSync(file, xml);
  return file;
}

// The view settings these journeys change (spelling, the language, the book's styles) go back to their
// defaults after each test: a worker's core keeps its settings from one test to the next.
test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

test.describe('US7 (feature 012) - export and import again', () => {
  test('each book comes back, apart from D34 (SC-013)', async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const list = books();
    test.setTimeout(60_000 + list.length * 180_000);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const results: Result[] = [];
    for (const book of list) {
      const dir = scratchDir('round-trip-');
      try {
        await openBookCopy(core, page, book, dir);
        const invalid = await bodyErrors(core, page);
        const original = await bookXml(core, page);
        const epub = path.join(dir, 'book.epub');
        await exportEpubTo(core, page, epub);
        // importDone waits for the new book to be the shown one.
        await importDone(page, await importViaMenu(core, page, epub), 120_000);
        const againErrors = await bodyErrors(core, page);
        const again = await bookXml(core, page);
        const differences = await page.evaluate<string[]>(
          `(${COMPARE})(${JSON.stringify(original)}, ${JSON.stringify(again)})`,
        );
        results.push({
          book,
          differences,
          ...(invalid.length > 0 ? { invalid: invalid.slice(0, 3) } : {}),
          ...(againErrors.length > 0
            ? { againInvalid: againErrors.slice(0, 3), againFile: keepInvalid(book, again) }
            : {}),
        });
      } catch (error) {
        results.push({ book, differences: [], failure: String(error).split('\n')[0] });
        await page.keyboard.press('Escape');
      }
    }
    if (process.env.MFBE_ROUND_TRIP_REPORT) {
      writeFileSync(process.env.MFBE_ROUND_TRIP_REPORT, `${JSON.stringify(results, null, 2)}\n`);
    }
    // A valid book comes back exactly; an invalid one (reported apart) tests that its conversion still
    // gives a valid book; a book imported again that is not valid is a fault either way (D34).
    expect(
      results.filter(
        (result) =>
          result.failure ||
          result.againInvalid ||
          (!result.invalid && result.differences.length > 0),
      ),
    ).toEqual([]);
  });
});
