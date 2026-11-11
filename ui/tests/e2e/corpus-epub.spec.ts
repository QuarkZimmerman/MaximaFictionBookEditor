/**
 * Feature 012 (T065; DP-19; SC-022): the corpus gate's EPUB runs, started by tests/corpus/epub-export.py
 * and tests/corpus/epub-import.py against the real core and interface. `MFBE_CORPUS_MODE` is `export` or
 * `import`, `MFBE_CORPUS_LIST` names the books (one path per line), `MFBE_CORPUS_OUT` the folder of the
 * results. Without them both tests are skipped, so the journeys' own runs never start them.
 * - export: each FB2 book of the list is opened and exported to `<out>/<name>.epub`; the script then runs
 *   EPUBCheck on every file;
 * - import: each EPUB is imported within its time limit, and the new book's bodies are validated.
 * `<out>/results.json` holds one record per book; the scripts judge them.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { test } from './fixtures/core';
import { exportEpubTo, openBookCopy } from './fixtures/epubExport';
import {
  bodyErrors,
  bookXml,
  importDone,
  importViaMenu,
  ImportRefused,
} from './fixtures/epubImport';

const MODE = process.env.MFBE_CORPUS_MODE;
const LIST = process.env.MFBE_CORPUS_LIST;
const OUT = process.env.MFBE_CORPUS_OUT;
/** Longer than any book takes on the debug core; a book still running then has hung. */
const BOOK_LIMIT_MS = 180_000;

interface Result {
  book: string;
  ms: number;
  epub?: string;
  bodyErrors?: string[];
  /** The core refused the file, with its message (DRM, not a readable EPUB): no fault. */
  refused?: string;
  failure?: string;
  /** Where a new book with invalid bodies was kept. */
  kept?: string;
}

function books(): string[] {
  return readFileSync(LIST!, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

const firstLine = (error: unknown): string => String(error).split('\n')[0]!;

test.describe('corpus gate - EPUB (feature 012)', () => {
  test('the FB2 sample exports to EPUB', async ({ core, page }) => {
    test.skip(
      MODE !== 'export' || !LIST || !OUT || !core.hasCore,
      'run by tests/corpus/epub-export.py',
    );
    const list = books();
    test.setTimeout(60_000 + list.length * BOOK_LIMIT_MS);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const results: Result[] = [];
    for (const book of list) {
      const started = Date.now();
      const epub = path.join(OUT!, `${path.basename(book, path.extname(book))}.epub`);
      try {
        await openBookCopy(core, page, book, mkdtempSync(path.join(os.tmpdir(), 'mfbe-corpus-')));
        await exportEpubTo(core, page, epub, BOOK_LIMIT_MS);
        results.push({ book, ms: Date.now() - started, epub });
      } catch (error) {
        results.push({ book, ms: Date.now() - started, failure: firstLine(error) });
        // A fresh window for the next book, whatever this one left open.
        await core.openApp(page);
      }
    }
    writeFileSync(path.join(OUT!, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  });

  test('the EPUB sample imports', async ({ core, page }) => {
    test.skip(
      MODE !== 'import' || !LIST || !OUT || !core.hasCore,
      'run by tests/corpus/epub-import.py',
    );
    const list = books();
    test.setTimeout(60_000 + list.length * BOOK_LIMIT_MS);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const results: Result[] = [];
    for (const book of list) {
      const started = Date.now();
      try {
        await importDone(page, await importViaMenu(core, page, book), BOOK_LIMIT_MS);
        const errors = await bodyErrors(core, page);
        // A new book whose bodies are not valid is kept in <out>/invalid/ for its diagnosis.
        let kept: string | undefined;
        if (errors.length > 0) {
          kept = path.join(OUT!, 'invalid', `${path.basename(book, path.extname(book))}.fb2`);
          mkdirSync(path.dirname(kept), { recursive: true });
          writeFileSync(kept, await bookXml(core, page));
        }
        results.push({
          book,
          ms: Date.now() - started,
          bodyErrors: errors,
          ...(kept ? { kept } : {}),
        });
      } catch (error) {
        if (error instanceof ImportRefused) {
          results.push({ book, ms: Date.now() - started, refused: firstLine(error.message) });
        } else {
          results.push({ book, ms: Date.now() - started, failure: firstLine(error) });
          await core.openApp(page);
        }
      }
    }
    writeFileSync(path.join(OUT!, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  });
});
