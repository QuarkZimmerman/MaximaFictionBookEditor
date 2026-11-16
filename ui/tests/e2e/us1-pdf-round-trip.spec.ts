/**
 * Feature 016, User Story 1 (T027; D6; SC-001, SC-002): export to PDF and import again gives the book back,
 * apart from D6's list. For each book: open it, save it as the editor writes it, export it to PDF through
 * the print seam, import the PDF, save the new book, and compare the two saved books with
 * tests/epub/compare-fb2.js in the page; the differences D6 names are left out.
 *
 * The books: the reference book by default; `MFBE_ROUND_TRIP_BOOKS` names a list file, one path per line
 * (tests/pdf/round-trip.mjs runs it so); `MFBE_ROUND_TRIP_SIZE` the page size (A5 by default);
 * `MFBE_ROUND_TRIP_REPORT` receives the results as JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, fixtureBook, test } from './fixtures/core';
import { bodyErrors, bookXml } from './fixtures/epubImport';
import { openBookCopy } from './fixtures/epubExport';
import { exportPdfTo } from './fixtures/pdfExport';
import { importPdfViaMenu, pdfImportDone } from './fixtures/pdfImport';
import { startPrintSeam } from './fixtures/printSeam';
import { scratchDir } from './fixtures/scratch';

const COMPARE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/epub/compare-fb2.js'),
  'utf8',
);

/**
 * D6's differences (Q1: C, what the PDF does not hold), as compare-fb2.js words them: a group of lines (its
 * heading, then "-" lines of the original and "+" lines of the book imported again) is allowed when, with the
 * normalisations below, its two sides are the same; single lines are allowed by the patterns.
 */
const NORMALISE: [RegExp, string][] = [
  // C9: a PNG comes back with the same pixels in a new file, so its bytes - and the picture's identity - differ.
  [/a picture the original does not have/g, 'picture'],
  [/picture \d+/g, 'picture'],
  // C6: a poem date's value, a cell's vertical alignment.
  [/(\/date) value="[^"]*"/g, '$1'],
  [/ valign="[^"]*"/g, ''],
];
const ALLOWED_LINES: RegExp[] = [
  /did not come back byte for byte$/,
  /^a picture the original does not have came in$/,
  // C1: the notes' title when no note was printed after the text.
  /^\s*- body name="(notes|comments)"\/title\/p:/,
];

/** The differences D6 does not allow. */
export function outsideD6(differences: readonly string[]): string[] {
  const out: string[] = [];
  let group: string[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const [heading, ...lines] = group;
    const norm = (line: string): string =>
      NORMALISE.reduce((text, [re, by]) => text.replace(re, by), line.slice(4));
    const kept = lines.filter((line) => !ALLOWED_LINES.some((re) => re.test(line)));
    const minus = kept
      .filter((l) => l.startsWith('  - '))
      .map(norm)
      .sort();
    const plus = kept
      .filter((l) => l.startsWith('  + '))
      .map(norm)
      .sort();
    if (kept.length > 0 && JSON.stringify(minus) !== JSON.stringify(plus))
      out.push(heading, ...kept);
    group = [];
  };
  for (const line of differences) {
    if (line.startsWith('  - ') || line.startsWith('  + ')) {
      group.push(line);
      continue;
    }
    flush();
    if (/^(description|bodies|stylesheets|notes):/.test(line)) group = [line];
    else if (!ALLOWED_LINES.some((re) => re.test(line))) out.push(line);
  }
  flush();
  return out;
}

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
  allowed?: string[];
  failure?: string;
  invalid?: string[];
  againInvalid?: string[];
}

test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

test.describe('US1 (feature 016) - export to PDF and import again', () => {
  test('each book comes back, apart from D6 (SC-001, SC-002)', async ({ core, page, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    const list = books();
    test.setTimeout(60_000 + list.length * 300_000);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const seam = startPrintSeam(core, context, { readyTimeoutMs: 300_000 });
    const size = process.env.MFBE_ROUND_TRIP_SIZE ?? 'A5 (148 × 210 mm)';
    const results: Result[] = [];
    try {
      for (const book of list) {
        const dir = scratchDir('pdf-round-trip-');
        try {
          await openBookCopy(core, page, book, dir);
          const invalid = await bodyErrors(core, page);
          const original = await bookXml(core, page);
          const pdf = path.join(dir, 'book.pdf');
          await exportPdfTo(core, page, pdf, size);
          await pdfImportDone(page, await importPdfViaMenu(core, page, pdf), 300_000);
          const againErrors = await bodyErrors(core, page);
          const again = await bookXml(core, page);
          const all = await page.evaluate<string[]>(
            `(${COMPARE})(${JSON.stringify(original)}, ${JSON.stringify(again)})`,
          );
          const differences = outsideD6(all);
          results.push({
            book,
            differences,
            ...(all.length > differences.length
              ? { allowed: all.filter((d) => !differences.includes(d)) }
              : {}),
            ...(invalid.length > 0 ? { invalid: invalid.slice(0, 3) } : {}),
            ...(againErrors.length > 0 ? { againInvalid: againErrors.slice(0, 3) } : {}),
          });
        } catch (error) {
          results.push({ book, differences: [], failure: String(error).split('\n')[0] });
          await page.keyboard.press('Escape');
        }
      }
    } finally {
      await seam.stop();
    }
    if (process.env.MFBE_ROUND_TRIP_REPORT) {
      writeFileSync(process.env.MFBE_ROUND_TRIP_REPORT, `${JSON.stringify(results, null, 2)}\n`);
    }
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
