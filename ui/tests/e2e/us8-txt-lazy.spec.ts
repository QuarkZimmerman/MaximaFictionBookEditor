/**
 * Feature 017, User Story 8 (tasks T058): the TXT parts load when used and hostile text files are harmless -
 * no TXT chunk at start-up, each loaded once at its first use (D15, D38, SC-012); the hostile set of
 * tests/fixtures/txt/make-fixtures.py --hostile ends in a book of valid data or a message, never a crash or a
 * hang (D26, D27, D30, SC-013).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, shownDocId, test } from './fixtures/core';
import { openFixtureBook } from './fixtures/pdfExport';
import { scratchDir } from './fixtures/scratch';
import { exportTxtTo, importTxtViaMenu, txtImportEnds } from './fixtures/txt';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TXT_CHUNKS = /\/(txt-export|txt-import|txt-shared|text-shared|import-shared)-[\w-]+\.js$/;

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

test('no TXT part loads at start-up; each loads once at its first use (D15, D38)', async ({
  core,
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (request) => asked.push(request.url()));
  await core.openApp(page);
  await openFixtureBook(core, page, 'reference-all-elements.fb2');
  expect(asked.filter((url) => TXT_CHUNKS.test(url))).toEqual([]);
  const dir = scratchDir('txt-lazy-');
  await exportTxtTo(core, page, path.join(dir, 'one.txt'));
  await exportTxtTo(core, page, path.join(dir, 'two.txt'));
  expect(asked.filter((url) => /\/txt-export-[\w-]+\.js$/.test(url))).toHaveLength(1);
  expect(asked.filter((url) => /\/txt-import-[\w-]+\.js$/.test(url))).toEqual([]);
  const before = await importTxtViaMenu(core, page, path.join(dir, 'one.txt'));
  expect((await txtImportEnds(page, before)).failed).toBeUndefined();
  expect(asked.filter((url) => /\/txt-import-[\w-]+\.js$/.test(url))).toHaveLength(1);
});

test('hostile text files end in valid data or a message (SC-013)', async ({ core, page }) => {
  test.setTimeout(300_000);
  const dir = scratchDir('txt-hostile-');
  // The generator runs on Python: python3 on Linux and macOS, python on the Windows runners.
  const python = ['python3', 'python'].find(
    (command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0,
  );
  test.skip(!python, 'Python is not available');
  const made = spawnSync(
    python!,
    [path.join(ROOT, 'tests/fixtures/txt/make-fixtures.py'), '--hostile', dir],
    { encoding: 'utf8' },
  );
  expect(made.status, made.stderr).toBe(0);
  await core.openApp(page);
  for (const name of readdirSync(dir).sort()) {
    const before = await importTxtViaMenu(core, page, path.join(dir, name));
    // A file whose encoding cannot be told is asked about (D26): its first candidate taken.
    const question = page.getByTestId('dialog-txt-import-encoding-question');
    if (
      await question.waitFor({ state: 'visible', timeout: 3000 }).then(
        () => true,
        () => false,
      )
    )
      await question.getByRole('button', { name: 'OK' }).click();
    const ended = await txtImportEnds(page, before, 120_000);
    // A refusal names its reason; otherwise a new book is in the window.
    if (ended.failed !== undefined) expect(ended.failed, name).toMatch(/was not imported/);
    else expect(await shownDocId(page), name).not.toBe(before);
  }
});
