/**
 * Feature 017 (T061, SC-011; tagged `@perf`): the 10 MB text book exported to TXT within 5 s, and a 10 MB TXT
 * imported into an editable book within 5 s, on the Release core (MFBE_PERF_FACTOR scales the limits on slow
 * runners, as the other timed journeys do).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, shownDocId, test, waitForBook } from './fixtures/core';
import { OWN_CORE } from './fixtures/memory';
import { exportTxtTo, importTxtViaMenu, txtImportEnds } from './fixtures/txt';

// The page's document, as the function given to waitForFunction sees it (the journeys' tsconfig has no DOM).
declare const document: {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
// SC-011 sets its budgets on the CI's Linux runner; the slower hosted macOS and Windows runners of the docs
// replay get twice the time, unless MFBE_PERF_FACTOR says otherwise.
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? (process.platform === 'linux' ? 1 : 2)) || 1;

test.use(OWN_CORE);

test.describe('performance - the TXT export and import (SC-011)', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-017-perf-txt-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test(
    'the 10 MB text book exported and imported, each within 5 s',
    { tag: '@perf' },
    async ({ core, page }) => {
      test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
      test.setTimeout(300_000);
      const book = path.join(dir, 'large.fb2');
      const made = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
        encoding: 'utf8',
      });
      test.skip(made.status !== 0, 'python3 / the generator are not available');
      await core.openApp(page);
      await core.enqueueDialog('dialog.openFile', { paths: [book] });
      await page.getByTestId('menu-file').click();
      await page.getByTestId('menu-file-open').click();
      await waitForBook(page, book, 60_000);
      const target = path.join(dir, 'large.txt');
      let started = Date.now();
      await exportTxtTo(core, page, target);
      const exported = Date.now() - started;
      expect(existsSync(target)).toBe(true);
      test.info().annotations.push({ type: 'perf', description: `10 MB to TXT: ${exported} ms` });
      expect(exported, '10 MB to TXT').toBeLessThan(5_000 * FACTOR);
      // Timed from the command to the new book in the window, its progress gone: the window's book is
      // unchanged since its export, so no unsaved-changes question is waited for, and the page itself watches
      // for the end (a poll from here would add its own interval).
      const before = await shownDocId(page);
      started = Date.now();
      await importTxtViaMenu(core, page, target, { question: false });
      await page.waitForFunction(
        (previous) =>
          document.querySelector('[data-testid="body-view"]')?.getAttribute('data-doc-id') !==
            previous && !document.querySelector('[data-testid="modal-job"]'),
        before,
        { timeout: 120_000, polling: 50 },
      );
      const imported = Date.now() - started;
      expect((await txtImportEnds(page, before, 10_000)).failed).toBeUndefined();
      test
        .info()
        .annotations.push({ type: 'perf', description: `10 MB TXT imported: ${imported} ms` });
      expect(imported, '10 MB TXT imported').toBeLessThan(5_000 * FACTOR);
    },
  );
});
