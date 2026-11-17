/**
 * Feature 016 (D32; tasks T065): the corpus gate's PDF import run, driven by tests/corpus/pdf-import.py against
 * the real core and interface. `MFBE_CORPUS_MODE` is `pdf-import`, `MFBE_CORPUS_LIST` names the PDFs (one path per
 * line), `MFBE_CORPUS_OUT` the folder of the results. Each PDF is imported through File > Import > PDF File...;
 * a refusal is recorded with its message, a password asked for is cancelled (recorded as such), and an imported
 * book's body errors are recorded and the book written beside the results (`<stem>.fb2`) for the script's check
 * of its words. A book still running after the limit has hung.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { shownDocId, test } from './fixtures/core';
import { bodyErrors, bookXml } from './fixtures/epubImport';
import { importPdfViaMenu } from './fixtures/pdfImport';

const MODE = process.env.MFBE_CORPUS_MODE;
const LIST = process.env.MFBE_CORPUS_LIST;
const OUT = process.env.MFBE_CORPUS_OUT;
const BOOK_LIMIT_MS = Number(process.env.MFBE_CORPUS_BOOK_LIMIT_MS ?? 300_000);

interface Result {
  book: string;
  ms: number;
  refused?: string;
  summary?: string;
  bodyErrors?: string[];
  fb2?: string;
  failure?: string;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 600);

test.describe('corpus gate - PDF import (feature 016)', () => {
  test('the library PDFs import or are refused with their message', async ({ core, page }) => {
    test.skip(
      MODE !== 'pdf-import' || !LIST || !OUT || !core.hasCore,
      'run by tests/corpus/pdf-import.py',
    );
    const list = readFileSync(LIST!, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    test.setTimeout(60_000 + list.length * (BOOK_LIMIT_MS + 30_000));
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false } } });
    await core.openApp(page);
    const results: Result[] = [];
    const failed = page.getByTestId('dialog-pdf-import-failed');
    const password = page.getByTestId('dialog-pdf-password');
    const summary = page.getByTestId('dialog-pdf-import-summary');
    const progress = page.getByTestId('modal-job');
    try {
      for (const book of list) {
        const started = Date.now();
        const stem = path.basename(book, path.extname(book));
        try {
          const before = await importPdfViaMenu(core, page, book);
          let outcome: Result | null = null;
          while (!outcome) {
            if (Date.now() - started > BOOK_LIMIT_MS) {
              outcome = {
                book,
                ms: Date.now() - started,
                failure: `no end within ${BOOK_LIMIT_MS / 1000} s`,
              };
              break;
            }
            if (await failed.isVisible()) {
              const text = oneLine((await failed.textContent()) ?? '');
              await failed.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
              outcome = { book, ms: Date.now() - started, refused: text };
            } else if (await password.isVisible()) {
              await password.getByRole('button', { name: 'Cancel' }).click({ timeout: 15_000 });
              outcome = { book, ms: Date.now() - started, refused: 'password' };
            } else if ((await shownDocId(page)) !== before && !(await progress.isVisible())) {
              let said = '';
              if (
                await summary.waitFor({ state: 'visible', timeout: 1000 }).then(
                  () => true,
                  () => false,
                )
              ) {
                said = oneLine((await summary.textContent()) ?? '');
                await summary.getByRole('button', { name: 'OK' }).click({ timeout: 15_000 });
              }
              const fb2 = path.join(OUT!, `${stem}.fb2`);
              writeFileSync(fb2, await bookXml(core, page));
              outcome = {
                book,
                ms: Date.now() - started,
                summary: said,
                bodyErrors: (await bodyErrors(core, page)).slice(0, 5),
                fb2,
              };
            } else {
              await page.waitForTimeout(250);
            }
          }
          results.push(outcome);
          if (outcome.failure) await core.openApp(page);
        } catch (error) {
          results.push({ book, ms: Date.now() - started, failure: oneLine(String(error)) });
          await core.openApp(page);
        }
        writeFileSync(path.join(OUT!, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
      }
    } finally {
      writeFileSync(path.join(OUT!, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    }
  });
});
