/**
 * Feature 017, User Story 6 (tasks T052): TXT files from ZIP archives and beside FBD files - the FBD gives the
 * description, without a question: one TXT and one FBD are a pair; else the FBD with the TXT's name, letter
 * case ignored; else the list of the archive's FBDs with None. An FBD beside a TXT outside an archive is
 * taken; an FBD beside an archive is never read (D31 to D34, clarify).
 */
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, fixtureBook, test } from './fixtures/core';
import { scratchDir } from './fixtures/scratch';
import { bookXml, importTxtViaMenu, txtImportEnds } from './fixtures/txt';

const ZIPS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/txt/zips',
);
const FBD_TITLE = '<book-title>Только описание</book-title>';

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

test('one TXT and one FBD in an archive are a pair (D32)', async ({ core, page }) => {
  await core.openApp(page);
  const before = await importTxtViaMenu(core, page, path.join(ZIPS, 'pair.zip'));
  const ended = await txtImportEnds(page, before);
  expect(ended.failed).toBeUndefined();
  expect(ended.summary ?? '').toContain('description.fbd');
  expect(await bookXml(page)).toContain(FBD_TITLE);
});

test("the FBD with the chosen TXT's name, letter case ignored (D31, D32)", async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const before = await importTxtViaMenu(core, page, path.join(ZIPS, 'named.zip'));
  // Two TXT files: the archive's chooser asks which.
  const chooser = page.getByRole('dialog').filter({ hasText: 'second.txt' });
  await expect(chooser).toBeVisible();
  await chooser.getByText('second.txt').click();
  await chooser.getByRole('button', { name: 'OK' }).click();
  expect((await txtImportEnds(page, before)).failed).toBeUndefined();
  expect(await bookXml(page)).toContain(FBD_TITLE);
});

test('no FBD with its name: the list with None, and None keeps the TXT description (D32)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const before = await importTxtViaMenu(core, page, path.join(ZIPS, 'unmatched.zip'));
  const chooser = page.getByRole('dialog').filter({ hasText: 'first.txt' });
  await chooser.getByText('first.txt').click();
  await chooser.getByRole('button', { name: 'OK' }).click();
  const list = page.getByRole('dialog').filter({ hasText: 'other.fbd' });
  await expect(list).toBeVisible();
  await list.getByText('None').click();
  await list.getByRole('button', { name: 'OK' }).click();
  expect((await txtImportEnds(page, before)).failed).toBeUndefined();
  const xml = await bookXml(page);
  expect(xml).not.toContain(FBD_TITLE);
  expect(xml).toContain('<book-title>first</book-title>');
});

test('an FBD beside a TXT is taken; one beside an archive is not (D33, clarify)', async ({
  core,
  page,
}) => {
  await core.openApp(page);
  const dir = scratchDir('txt-fbd-beside-');
  copyFileSync(
    path.join(ZIPS, '..', 'layouts', 'german-book.per-line.txt'),
    path.join(dir, 'Book.txt'),
  );
  copyFileSync(fixtureBook('descriptor.fbd'), path.join(dir, 'Book.fbd'));
  let before = await importTxtViaMenu(core, page, path.join(dir, 'Book.txt'));
  expect((await txtImportEnds(page, before)).failed).toBeUndefined();
  expect(await bookXml(page)).toContain(FBD_TITLE);
  // An archive without an FBD lying beside <archive>.fbd: the FBD beside it is not read.
  const zipDir = scratchDir('txt-fbd-zip-');
  copyFileSync(path.join(ZIPS, 'unmatched.zip'), path.join(zipDir, 'books.zip'));
  copyFileSync(fixtureBook('descriptor.fbd'), path.join(zipDir, 'books.fbd'));
  before = await importTxtViaMenu(core, page, path.join(zipDir, 'books.zip'));
  const chooser = page.getByRole('dialog').filter({ hasText: 'first.txt' });
  await chooser.getByText('first.txt').click();
  await chooser.getByRole('button', { name: 'OK' }).click();
  const list = page.getByRole('dialog').filter({ hasText: 'other.fbd' });
  await list.getByText('None').click();
  await list.getByRole('button', { name: 'OK' }).click();
  expect((await txtImportEnds(page, before)).failed).toBeUndefined();
  expect(await bookXml(page)).not.toContain(FBD_TITLE);
});
