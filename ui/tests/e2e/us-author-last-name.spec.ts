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
