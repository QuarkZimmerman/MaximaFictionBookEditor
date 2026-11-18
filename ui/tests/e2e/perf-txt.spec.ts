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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 1);

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
      started = Date.now();
      const before = await importTxtViaMenu(core, page, target);
      expect((await txtImportEnds(page, before, 120_000)).failed).toBeUndefined();
      const imported = Date.now() - started;
      expect(await shownDocId(page)).not.toBe(before);
      test
        .info()
        .annotations.push({ type: 'perf', description: `10 MB TXT imported: ${imported} ms` });
      expect(imported, '10 MB TXT imported').toBeLessThan(5_000 * FACTOR);
    },
  );
});
