/**
 * The requester's decision after his smoke test of 0.0.12-rc.1: a person with a first name but no last-name
 * element - no valid FB2 - is said plainly beside the person, and Fix adds the empty last name the schema
 * needs; the Validate list says it plainly too.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, shownDocId, test, waitForBook } from './fixtures/core';
import { bookXml } from './fixtures/epubImport';
import { scratchDir } from './fixtures/scratch';

const BOOK = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>sf</genre><author><first-name>Ann</first-name><last-name>Example</last-name></author><book-title>Last names</book-title><lang>en</lang></title-info>
<document-info><author><first-name>Ground floor</first-name><home-page>https://example.org/</home-page></author><date value="2026-10-30">30 October 2026</date><id>1</id><version>1.0</version></document-info>
</description>
<body><section><p>Text.</p></section></body>
</FictionBook>
`;

test('a first name without a last name: said plainly, fixed (smoke test of rc.1)', async ({
  core,
  page,
}) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  const file = path.join(scratchDir('author-last-name-'), 'last-names.fb2');
  writeFileSync(file, BOOK);
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
  const docId = await shownDocId(page);
  const lastNameErrors = async () =>
    (
      await core.rpcJob<{ issues: Array<{ code: string; params?: { message?: string } }> }>(
        'doc.validate',
        { docId },
      )
    ).issues.filter((issue) => /last-name/.test(issue.params?.message ?? '')).length;
  expect(await lastNameErrors()).toBe(1);
  await page.getByTestId('view-description').click();
  const note = page.getByTestId('description-doc-author-0-nolast');
  await expect(note).toContainText('first name but no last name');
  // The book's own author has both names: no note there.
  await expect(page.getByTestId('description-author-0-nolast')).toHaveCount(0);
  await page.getByTestId('description-doc-author-0-fix').click();
  await expect(note).toHaveCount(0);
  const xml = await bookXml(core, page);
  const documentInfo = /<document-info>[\s\S]*?<\/document-info>/.exec(xml)?.[0] ?? '';
  expect(documentInfo).toMatch(/<first-name>Ground floor<\/first-name>\s*<last-name\/>/);
  // Saved, the core holds the book as the form wrote it: valid.
  expect(await lastNameErrors()).toBe(0);
});

test('another edit leaves a person without a last name as it is: Validate keeps listing it (smoke test of rc.4)', async ({
  core,
  page,
}) => {
  test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  // The requester's case: a date in another form, fixed with its own Fix, and an author without a last name,
  // which that Fix wrote with an empty one behind his back.
  const file = path.join(scratchDir('author-last-name-rc4-'), 'last-names-rc4.fb2');
  writeFileSync(file, BOOK.replace('<date value="2026-10-30">', '<date value="30.10.2026">'));
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
  const docId = await shownDocId(page);
  const lastNameErrors = async () =>
    (
      await core.rpcJob<{ issues: Array<{ code: string; params?: { message?: string } }> }>(
        'doc.validate',
        { docId },
      )
    ).issues.filter((issue) => /last-name/.test(issue.params?.message ?? '')).length;
  await page.getByTestId('view-description').click();
  await page.getByTestId('description-doc-date-fix').click();
  await expect(page.getByTestId('description-doc-date-value')).toHaveValue('2026-10-30');
  const note = page.getByTestId('description-doc-author-0-nolast');
  await expect(note).toContainText('first name but no last name');
  const xml = await bookXml(core, page);
  const documentInfo = /<document-info>[\s\S]*?<\/document-info>/.exec(xml)?.[0] ?? '';
  expect(documentInfo).toContain('<date value="2026-10-30">');
  expect(documentInfo).not.toContain('<last-name');
  expect(await lastNameErrors()).toBe(1);
  // Its own Fix, given on purpose, adds it.
  await page.getByTestId('description-doc-author-0-fix').click();
  await expect(note).toHaveCount(0);
  const fixed =
    /<document-info>[\s\S]*?<\/document-info>/.exec(await bookXml(core, page))?.[0] ?? '';
  expect(fixed).toMatch(/<first-name>Ground floor<\/first-name>\s*<last-name\/>/);
  expect(await lastNameErrors()).toBe(0);
});
