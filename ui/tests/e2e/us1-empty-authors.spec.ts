/**
 * Feature 011, User Story 1 - a book with empty authors still validates (D1-D3, FR-001-FR-006).
 *
 * Runs against the real core (`MFBE_CORE_BIN`); native dialogs are answered from the queue.
 * Scenarios (spec.md US1): 1 a new book's empty author; 2 emptied document author; 3 a first name,
 * a last name or a nickname alone; 4 an empty translator row is not written; 5 `<author/>` read and
 * saved without a description edit stays as read; 6 the warning for an author without a name;
 * 7 a script's description (the assistant writes through the same working copy) follows the same
 * rules. The description import's path is covered by the unit cases of withSchemaPersons.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle } from './fixtures/core';

interface ScriptHooks {
  refresh(): Promise<void>;
  run(id: string): Promise<{ status: string; error?: { message: string } }>;
}
declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

interface ValidationJson {
  errorCount: number;
  issues: { severity: string; code: string; params?: Record<string, unknown> }[];
}

/** The report's errors, for the assertion messages. */
function errorsOf(report: ValidationJson): string {
  return JSON.stringify(report.issues.filter((issue) => issue.severity === 'error'));
}

/** The errors about persons (a new book's template has an empty genre, which is not this story's). */
function personErrors(report: ValidationJson): ValidationJson['issues'] {
  return report.issues.filter(
    (issue) =>
      issue.severity === 'error' &&
      /author|first-name|last-name|nickname/.test(JSON.stringify(issue)),
  );
}

function book(dir: string, name: string, titleAuthors: string, docAuthors: string): string {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
${titleAuthors}
<book-title>Authors</book-title>
<lang>en</lang>
</title-info>
<document-info>
${docAuthors}
<date value="2026-01-01">2026</date>
<id>authors-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section><p>Only text.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-saveAs').click();
  const prompt = page.getByTestId('dialog-validation-failed');
  await expect
    .poll(
      async () =>
        (await prompt.count()) > 0 ||
        /saved|found/i.test(await page.getByTestId('status-message').innerText()),
    )
    .toBe(true);
  if ((await prompt.count()) > 0)
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  await expect(page.getByTestId('status-message')).toContainText(/saved|found/i);
  return readFileSync(file, 'utf8');
}

async function validateFile(core: CoreHandle, file: string): Promise<ValidationJson> {
  const opened = await core.rpcJob<{ document: { docId: string } }>('doc.open', { path: file });
  const report = await core.rpcJob<ValidationJson>('doc.validate', {
    docId: opened.document.docId,
    document: opened.document,
  });
  await core.rpc('doc.close', { docId: opened.document.docId });
  return report;
}

/** The `<author>` elements of an info block, whitespace removed. */
function authorsOf(xml: string, block: string): string[] {
  const inner = new RegExp(`<${block}>([\\s\\S]*?)</${block}>`).exec(xml)?.[1] ?? '';
  return [...inner.matchAll(/<author\/>|<author>([\s\S]*?)<\/author>/g)].map((m) =>
    m[0] === '<author/>' ? '<author/>' : m[1]!.replace(/\s+/g, ''),
  );
}

const EMPTY = '<first-name/><last-name/>';

test.describe('US1 (feature 011) - empty authors keep the book valid', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-011-us1-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
  });

  test('1. a new book with a title typed in: the empty author is written and validates', async ({
    core,
    page,
  }) => {
    await showDescription(page);
    await page.getByTestId('description-book-title').fill('A New Book');
    const file = path.join(dir, 'new.fb2');
    const xml = await saveAs(core, page, file);
    expect(authorsOf(xml, 'title-info')).toEqual([EMPTY]);
    const report = await validateFile(core, file);
    expect(personErrors(report), errorsOf(report)).toEqual([]);
    expect(report.issues.map((issue) => issue.code)).toContain('description.emptyAuthor');
  });

  test('2. a document author emptied: written with empty names and valid', async ({
    core,
    page,
  }) => {
    await openBook(
      core,
      page,
      book(
        dir,
        'your-name.fb2',
        '<author><first-name>Ann</first-name><last-name>Writer</last-name></author>',
        '<author><first-name>Your</first-name><last-name>Name</last-name></author>',
      ),
    );
    await showDescription(page);
    await page.getByTestId('description-doc-author-0-first').fill('');
    await page.getByTestId('description-doc-author-0-last').fill('');
    const file = path.join(dir, 'your-name-out.fb2');
    const xml = await saveAs(core, page, file);
    expect(authorsOf(xml, 'document-info')).toEqual([EMPTY]);
    expect((await validateFile(core, file)).errorCount).toBe(0);
  });

  test('3. a first name, a last name or a nickname alone take the schema forms', async ({
    core,
    page,
  }) => {
    await openBook(
      core,
      page,
      book(
        dir,
        'forms.fb2',
        '<author><first-name>Ann</first-name><last-name>Writer</last-name></author>',
        '<author><nickname>maker</nickname></author>',
      ),
    );
    await showDescription(page);
    await page.getByTestId('description-author-0-last').fill('');
    await page.getByTestId('description-author-add').click();
    await page.getByTestId('description-author-1-last').fill('Lee');
    await page.getByTestId('description-author-add').click();
    await page.getByTestId('description-author-2-nickname').fill('solo');
    await expect(page.getByTestId('description-author-0-incomplete')).toHaveText(
      'Enter a first and a last name, or a nickname alone.',
    );
    const file = path.join(dir, 'forms-out.fb2');
    const xml = await saveAs(core, page, file);
    expect(authorsOf(xml, 'title-info')).toEqual([
      '<first-name>Ann</first-name><last-name/>',
      '<first-name/><last-name>Lee</last-name>',
      '<nickname>solo</nickname>',
    ]);
    expect((await validateFile(core, file)).errorCount).toBe(0);
  });

  test('4. an author row left empty beside a filled one is not written', async ({ core, page }) => {
    await openBook(
      core,
      page,
      book(
        dir,
        'empty-row.fb2',
        '<author><first-name>Ann</first-name><last-name>Writer</last-name></author>',
        '<author><nickname>maker</nickname></author>',
      ),
    );
    await showDescription(page);
    await page.getByTestId('description-author-add').click();
    await expect(page.getByTestId('description-author-1-first')).toBeVisible();
    await page.getByTestId('description-book-title').fill('Empty row');
    const xml = await saveAs(core, page, path.join(dir, 'empty-row-out.fb2'));
    expect(authorsOf(xml, 'title-info')).toEqual([
      '<first-name>Ann</first-name><last-name>Writer</last-name>',
    ]);
  });

  test('5. <author/> read and saved without a description edit stays as read @enters-invalid', async ({
    core,
    page,
  }) => {
    await openBook(
      core,
      page,
      book(dir, 'as-read.fb2', '<author/>', '<author><nickname>maker</nickname></author>'),
    );
    const xml = await saveAs(core, page, path.join(dir, 'as-read-out.fb2'));
    expect(authorsOf(xml, 'title-info')).toEqual(['<author/>']);
  });

  test('6. no author with a name: a warning, not an error', async ({ core, page }) => {
    await openBook(
      core,
      page,
      book(
        dir,
        'nameless.fb2',
        '<author><first-name/><last-name/></author>',
        '<author><nickname>maker</nickname></author>',
      ),
    );
    const report = await validateFile(core, path.join(dir, 'nameless.fb2'));
    expect(report.errorCount).toBe(0);
    const issue = report.issues.find((i) => i.code === 'description.emptyAuthor');
    expect(issue?.severity).toBe('warning');
    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-file-open')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test("7. a script's description: the same rules", async ({ core, page }) => {
    const scriptDir = path.join(core.dataDir!, 'scripts', '90_US1Persons', '01_ClearAuthors');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(
      path.join(scriptDir, 'script.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'mfbe.011.clearAuthors',
        name: { en: 'Clear authors (011 US1)' },
        kind: 'menu',
      }),
    );
    writeFileSync(
      path.join(scriptDir, 'index.js'),
      [
        'export default async function run() {',
        '  const document = await mfbe.doc.get();',
        '  const description = document.description;',
        '  description.titleInfo.authors = [{ firstName: "Mia", homePages: [], emails: [] }];',
        '  description.documentInfo.authors = [];',
        '  await mfbe.doc.setDescription(description);',
        '}',
        '',
      ].join('\n'),
    );
    await page.evaluate(() => window.__mfbeTest!.scripts!.refresh());
    const result = await page.evaluate(() =>
      window.__mfbeTest!.scripts!.run('mfbe.011.clearAuthors'),
    );
    expect(result.status, result.error?.message).toBe('done');
    const file = path.join(dir, 'script-out.fb2');
    const xml = await saveAs(core, page, file);
    expect(authorsOf(xml, 'title-info')).toEqual(['<first-name>Mia</first-name><last-name/>']);
    expect(authorsOf(xml, 'document-info')).toEqual([EMPTY]);
    const report = await validateFile(core, file);
    expect(personErrors(report), errorsOf(report)).toEqual([]);
  });
});
