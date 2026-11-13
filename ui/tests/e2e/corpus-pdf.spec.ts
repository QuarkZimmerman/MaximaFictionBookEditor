/**
 * Feature 014 (DP-16; tasks T059): the corpus gate's PDF export run, driven by
 * tests/corpus/pdf-export.py against the real core and interface. `MFBE_CORPUS_MODE` is `pdf`,
 * `MFBE_CORPUS_LIST` names the books (one path per line), `MFBE_CORPUS_OUT` the folder of the
 * PDFs. Each book is exported in A5 through the print seam; beside each PDF the journey writes the
 * book's own text (`<name>.expected.json`) for tests/pdf/text-compare.mjs. A book's failure is
 * recorded, not thrown: the script reports them all; a book still running after the limit has hung.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test } from './fixtures/core';
import { expectedText, exportPdfTo, openFixtureBook } from './fixtures/pdfExport';
import { startPrintSeam } from './fixtures/printSeam';

const MODE = process.env.MFBE_CORPUS_MODE;
const LIST = process.env.MFBE_CORPUS_LIST;
const OUT = process.env.MFBE_CORPUS_OUT;
const BOOK_LIMIT_MS = 300_000;

interface Result {
  book: string;
  ms: number;
  pdf?: string;
  expected?: string;
  summary?: string;
  failure?: string;
}

const firstLine = (error: unknown): string => String(error).split('\n')[0]!;

test.describe('corpus gate - PDF export (feature 014)', () => {
  test('the FB2 sample exports to PDF', async ({ core, page, context }) => {
    test.skip(
      MODE !== 'pdf' || !LIST || !OUT || !core.hasCore,
      'run by tests/corpus/pdf-export.py',
    );
    const list = readFileSync(LIST!, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    test.setTimeout(60_000 + list.length * BOOK_LIMIT_MS);
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const seam = startPrintSeam(core, context, { readyTimeoutMs: BOOK_LIMIT_MS });
    const results: Result[] = [];
    try {
      for (const book of list) {
        const started = Date.now();
        const name = path.basename(book, path.extname(book));
        const pdf = path.join(OUT!, `${name}.pdf`);
        const expected = path.join(OUT!, `${name}.expected.json`);
        try {
          await openFixtureBook(core, page, book);
          writeFileSync(expected, JSON.stringify(await expectedText(page, book)));
          const summary = await exportPdfTo(core, page, pdf, 'A5 (148 × 210 mm)', BOOK_LIMIT_MS);
          results.push({ book, ms: Date.now() - started, pdf, expected, summary });
        } catch (error) {
          results.push({ book, ms: Date.now() - started, failure: firstLine(error) });
          await core.openApp(page);
        }
      }
    } finally {
      await seam.stop();
      writeFileSync(path.join(OUT!, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    }
  });
});
