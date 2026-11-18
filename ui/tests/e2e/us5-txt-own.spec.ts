/**
 * Feature 017, User Story 5 (tasks T049): the editor's own TXT comes back with its description and notes -
 * the reference book exported as TXT and imported again: its record's fields, its annotation and its notes,
 * linked from their references; no marker line left in the text (D28, D29).
 */
import path from 'node:path';

import { expect, test } from './fixtures/core';
import { openFixtureBook } from './fixtures/pdfExport';
import { scratchDir } from './fixtures/scratch';
import { bookXml, exportTxtTo, importTxtViaMenu, txtImportEnds } from './fixtures/txt';

test.beforeEach(({ core }) => {
  test.skip(!core.hasCore, 'needs the core');
});

test('the reference book exported and imported again (D28, D29)', async ({ core, page }) => {
  await core.openApp(page);
  await openFixtureBook(core, page, 'reference-all-elements.fb2');
  const file = path.join(scratchDir('txt-own-'), 'reference.txt');
  await exportTxtTo(core, page, file, { encoding: 'windows-1252 (Western European)' });
  const before = await importTxtViaMenu(core, page, file);
  const ended = await txtImportEnds(page, before);
  expect(ended.failed).toBeUndefined();
  const xml = await bookXml(page);
  expect(xml).toContain('<book-title>The Reference Book</book-title>');
  expect(xml).toMatch(/<sequence name="The Series" number="3"\s*\/>/);
  expect(xml).toContain('<first-name>Anna</first-name>');
  expect(xml).toContain('<lang>en</lang>');
  expect(xml).toContain('<p>The annotation of the reference book.</p>');
  expect(xml).toMatch(/<body name="notes">/);
  expect(xml).toMatch(/<a [^>]*type="note"[^>]*>\[1\]<\/a>/);
  expect(xml).not.toContain('---------------- Note 1');
  expect(xml).toContain('<p>The first note.</p>');
});
