/**
 * User Story 3 - Edit the book description (metadata) (T072).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. Native dialogs are answered from the queue (`test.enqueueDialog`).
 *
 * Scenarios (spec.md US3):
 *  1. genres come from the effective list in the interface language (a user `*.genres.tsv` in
 *     the data folder is picked up), with an optional match percentage; validation accepts them
 *  2. author block: empty fields are omitted on save, name or nickname is required
 *  3. "new" ID warns about library submission and replaces the id with a UUID on Yes
 *  4. nested sequences are saved as nested <sequence> elements
 *  5. Binary Objects: id, content type, preview, remove (with the reference check)
 *  6. annotation / history are edited as paragraphs with inline styles
 *  7. independent test: every section of a sparse book is completed, the file is saved and the
 *     Source text / validator show the elements in schema order with no errors
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import type { Page } from '@playwright/test';
import { MOD } from './fixtures/keys';

interface ValidationJson {
  errorCount: number;
  warningCount: number;
  issues: { severity: string; code: string; params: Record<string, unknown> }[];
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** A valid but sparse FB2 2.1 book: only the required description elements. */
function sparseBook(dir: string, name = 'sparse.fb2'): string {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Sparse</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>sparse-0001</id>
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

async function openViaDialog(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

/** Save As to `file` through the queued native dialog; returns the written text. */
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

/** Validates the saved file through the core and returns the report. */
async function validateFile(core: CoreHandle, file: string): Promise<ValidationJson> {
  const opened = await core.rpcJob<{ document: { docId: string } }>('doc.open', { path: file });
  const report = await core.rpcJob<ValidationJson>('doc.validate', {
    docId: opened.document.docId,
    document: opened.document,
  });
  await core.rpc('doc.close', { docId: opened.document.docId });
  return report;
}

/** Inner XML of the first `<name>` element. */
function elementXml(xml: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? match[1]! : '';
}

/** Names of the direct child elements of an element's inner XML. */
function childTags(inner: string): string[] {
  const tags: string[] = [];
  let depth = 0;
  for (const match of inner.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (closing) depth -= 1;
    else {
      if (depth === 0) tags.push(name!);
      if (!selfClosing) depth += 1;
    }
  }
  return tags;
}

async function pickGenre(page: Page, code: string): Promise<void> {
  const picker = page.getByTestId('genre-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByTestId(`genre-picker-option-${code}`)).toBeAttached();
  await page.getByTestId('genre-picker-list').selectOption(code);
  await page.getByTestId('genre-picker-button-ok').click();
  await expect(picker).toBeHidden();
}

test.describe('US3 - edit the book description', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, page }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText('Ready');
  });

  test('1. genres come from the effective list (incl. a user genre file) with a match %', async ({
    core,
    page,
  }) => {
    // A user genre file in the data folder's genres layer (resource-formats.md §3).
    const genresDir = path.join(core.dataDir!, 'genres');
    mkdirSync(genresDir, { recursive: true });
    writeFileSync(
      path.join(genresDir, 'custom.genres.tsv'),
      '# code\tcategory\tname_en\tname_ru\nsf_litrpg\tsf\tLitRPG\tЛитРПГ\n',
      'utf8',
    );
    await openViaDialog(core, page, sparseBook(dir, 'genres.fb2'));
    await showDescription(page);
    await expect(page.getByTestId('description-genres')).toBeVisible();
    await expect(page.getByTestId('description-genre-0-code')).toContainText('sf');
    // Names in the interface language come from the effective list.
    await expect(page.getByTestId('description-genre-0-code')).toContainText('Science Fiction');

    await page.getByTestId('description-genre-add').click();
    const picker = page.getByTestId('genre-picker');
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('genre-picker-group-sf')).toHaveAttribute('label', 'SF, Fantasy');
    await expect(page.getByTestId('genre-picker-option-sf_history')).toHaveText(
      'Alternative history (sf_history)',
    );
    const user = page.getByTestId('genre-picker-option-sf_litrpg');
    await expect(user).toBeAttached();
    await expect(user).toHaveText(/LitRPG \(sf_litrpg\) \[user\]/);
    await page.getByTestId('genre-picker-filter').fill('litrpg');
    await expect(page.getByTestId('genre-picker-option-sf_history')).toHaveCount(0);
    await page.getByTestId('genre-picker-list').selectOption('sf_litrpg');
    await page.getByTestId('genre-picker-button-ok').click();
    await expect(picker).toBeHidden();
    await expect(page.getByTestId('description-genre-1-code')).toContainText('LitRPG');
    await page.getByTestId('description-genre-1-match').fill('50');
    await page.getByTestId('description-genre-1-match').blur();
    // A match of 100 is the default and omitted.
    await page.getByTestId('description-genre-add').click();
    await pickGenre(page, 'det_classic');
    await page.getByTestId('description-genre-2-match').fill('100');
    await page.getByTestId('description-genre-2-match').blur();
    await expect(page.getByTestId('description-genre-2-match')).toHaveValue('');

    const file = path.join(dir, 'genres-out.fb2');
    const xml = await saveAs(core, page, file);
    expect(elementXml(xml, 'title-info')).toMatch(
      /<genre>sf<\/genre>\s*<genre match="50">sf_litrpg<\/genre>\s*<genre>det_classic<\/genre>/,
    );
    const report = await validateFile(core, file);
    expect(report.issues.filter((i) => /genre/.test(i.code))).toEqual([]);
    expect(report.errorCount).toBe(0);
  });

  test('2. author fields: empty ones are omitted, name or nickname is required', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, sparseBook(dir, 'authors.fb2'));
    await showDescription(page);
    await expect(page.getByTestId('description-author-0-first')).toHaveValue('Ann');
    await page.getByTestId('description-author-0-middle').fill('  ');
    await page.getByTestId('description-author-0-nickname').fill('annw');
    await page.getByTestId('description-author-0-homepage-add').click();
    await page.getByTestId('description-author-0-homepage-0').fill('https://ann.example');
    await page.getByTestId('description-author-0-email-add').click();
    await page.getByTestId('description-author-0-email-0').fill('ann@example.org');
    // A second author with a first name only is incomplete (flagged) until the last name is set.
    await page.getByTestId('description-author-add').click();
    await page.getByTestId('description-author-1-first').fill('Solo');
    await expect(page.getByTestId('description-author-1-incomplete')).toBeVisible();
    await page.getByTestId('description-author-1-last').fill('Act');
    await expect(page.getByTestId('description-author-1-incomplete')).toHaveCount(0);
    // A nickname alone is enough; a completely empty row is dropped on save.
    await page.getByTestId('description-author-add').click();
    await page.getByTestId('description-author-2-nickname').fill('onlynick');
    await page.getByTestId('description-author-add').click();
    await expect(page.getByTestId('description-author-3-first')).toBeVisible();

    const file = path.join(dir, 'authors-out.fb2');
    const xml = await saveAs(core, page, file);
    const authors = [
      ...elementXml(xml, 'title-info').matchAll(/<author>([\s\S]*?)<\/author>/g),
    ].map((m) => m[1]!.replace(/\s+/g, ''));
    expect(authors).toHaveLength(3);
    expect(authors[0]).toBe(
      '<first-name>Ann</first-name><last-name>Writer</last-name><nickname>annw</nickname><home-page>https://ann.example</home-page><email>ann@example.org</email>',
    );
    expect(authors[1]).toBe('<first-name>Solo</first-name><last-name>Act</last-name>');
    expect(authors[2]).toBe('<nickname>onlynick</nickname>');
    expect(xml).not.toContain('<middle-name>');
    expect((await validateFile(core, file)).errorCount).toBe(0);
  });

  test('3. "new" ID warns about library submission and replaces the id on confirmation', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, sparseBook(dir, 'id.fb2'));
    await showDescription(page);
    const id = page.getByTestId('description-id');
    await expect(id).toHaveValue('sparse-0001');
    await page.getByTestId('description-id-new').click();
    const prompt = page.getByTestId('dialog-new-id');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Are you sure you want to generate a new ID?');
    await expect(prompt).toContainText('library submission');
    await page.getByTestId('dialog-new-id-button-no').click();
    await expect(id).toHaveValue('sparse-0001');
    await page.getByTestId('description-id-new').click();
    await page.getByTestId('dialog-new-id-button-yes').click();
    await expect(id).toHaveValue(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const newId = await id.inputValue();
    // Edit > Undo restores the previous id (the description takes part in the global undo).
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-undo').click();
    await expect(id).toHaveValue('sparse-0001');
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-redo').click();
    await expect(id).toHaveValue(newId);
    const xml = await saveAs(core, page, path.join(dir, 'id-out.fb2'));
    expect(elementXml(xml, 'document-info')).toContain(`<id>${newId}</id>`);
  });

  test('4. nested sequences are saved as nested <sequence> elements', async ({ core, page }) => {
    await openViaDialog(core, page, sparseBook(dir, 'sequences.fb2'));
    await showDescription(page);
    await page.getByTestId('description-sequence-add').click();
    await page.getByTestId('description-sequence-0-name').fill('Saga');
    await page.getByTestId('description-sequence-0-number').fill('3');
    await page.getByTestId('description-sequence-0-add-nested').click();
    await page.getByTestId('description-sequence-0-0-name').fill('Sub');
    await page.getByTestId('description-sequence-0-0-number').fill('1');
    await page.getByTestId('description-sequence-0-0-add-nested').click();
    await page.getByTestId('description-sequence-0-0-0-name').fill('Deep');
    await page.getByTestId('description-sequence-add').click();
    await page.getByTestId('description-sequence-1-name').fill('Standalone');
    // Publish-info sequences too.
    await page.getByTestId('description-publish-sequence-add').click();
    await page.getByTestId('description-publish-sequence-0-name').fill('Paper series');
    await page.getByTestId('description-publish-sequence-0-number').fill('7');

    const file = path.join(dir, 'sequences-out.fb2');
    const xml = await saveAs(core, page, file);
    const title = elementXml(xml, 'title-info');
    expect(title).toMatch(
      /<sequence name="Saga" number="3">\s*<sequence name="Sub" number="1">\s*<sequence name="Deep"\/>\s*<\/sequence>\s*<\/sequence>\s*<sequence name="Standalone"\/>/,
    );
    expect(elementXml(xml, 'publish-info')).toMatch(/<sequence name="Paper series" number="7"\/>/);
    expect((await validateFile(core, file)).errorCount).toBe(0);
  });

  test('5. Binary Objects: id, content type, preview and removal with the reference check', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, fixtureBook('modern-utf8.fb2'));
    const docId = await page.getByTestId('body-view').getAttribute('data-doc-id');
    await showDescription(page);
    const cover = page.getByTestId('binary-objects-row-cover.png');
    const gif = page.getByTestId('binary-objects-row-dot.gif');
    await expect(cover).toContainText('image/png');
    await expect(gif).toContainText('image/gif');
    await expect(page.getByTestId('binary-objects-badge-convert-dot.gif')).toBeVisible();
    await expect(cover).toContainText('8×6');
    // The preview thumbnail is served by the core.
    const preview = page.getByTestId('binary-objects-preview-cover.png');
    await expect
      .poll(() =>
        preview.evaluate((img) => {
          const image = img as unknown as { complete: boolean; naturalWidth: number };
          return image.complete && image.naturalWidth > 0;
        }),
      )
      .toBe(true);
    // The cover page row shows the same binary and the picker lists the images.
    await expect(page.getByTestId('description-cover-0-href')).toHaveValue('#cover.png');
    await page.getByTestId('description-cover-add').click();
    const picker = page.getByTestId('cover-picker');
    await expect(picker).toBeVisible();
    await expect(page.getByTestId('cover-picker-item-dot.gif')).toBeVisible();
    await page.getByTestId('cover-picker-item-dot.gif').click();
    await page.getByTestId('cover-picker-button-ok').click();
    await expect(page.getByTestId('description-cover-1-href')).toHaveValue('#dot.gif');
    await page.getByTestId('description-cover-1-remove').click();
    await expect(page.getByTestId('description-cover-1-href')).toHaveCount(0);

    // Removing a referenced binary asks first; "No" keeps it.
    await page.getByTestId('binary-objects-remove-dot.gif').click();
    const confirm = page.getByTestId('dialog-binary-remove-referenced');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('still referenced');
    await page.getByTestId('dialog-binary-remove-referenced-button-no').click();
    await expect(gif).toBeVisible();
    await page.getByTestId('binary-objects-remove-dot.gif').click();
    await page.getByTestId('dialog-binary-remove-referenced-button-yes').click();
    await expect(gif).toHaveCount(0);
    const list = await core.rpc<{ id: string }[]>('binary.list', { docId });
    expect(list.map((b) => b.id)).toEqual(['cover.png']);
    // The dangling references left behind are reported in the list.
    await expect(page.getByTestId('binary-objects-dangling')).toContainText('#dot.gif');
  });

  test('6. annotation and history are edited as paragraphs with inline styles', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, sparseBook(dir, 'annotation.fb2'));
    await showDescription(page);
    const annotation = page.getByTestId('description-annotation');
    await annotation.click();
    await page.keyboard.type('First paragraph of the annotation.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second with ');
    await page.getByTestId('description-annotation-mark-emphasis').click();
    await page.keyboard.type('emphasis');
    await page.getByTestId('description-annotation-mark-emphasis').click();
    await page.keyboard.type(' inside.');
    await expect(annotation.locator('p')).toHaveCount(2);
    const history = page.getByTestId('description-history');
    await history.click();
    await page.keyboard.type('v1.0 - created');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // an empty paragraph becomes an empty line
    await page.keyboard.type('v1.1 - ');
    await page.keyboard.press(`${MOD}+b`);
    await page.keyboard.type('proofread');
    // p, <empty-line/> (rendered as an empty paragraph), p
    await expect(history.locator('p')).toHaveCount(3);

    const file = path.join(dir, 'annotation-out.fb2');
    const xml = await saveAs(core, page, file);
    const title = elementXml(xml, 'title-info');
    expect(title).toMatch(
      /<annotation>\s*<p>First paragraph of the annotation.<\/p>\s*<p>Second with <emphasis>emphasis<\/emphasis> inside.<\/p>\s*<\/annotation>/,
    );
    expect(childTags(title)).toEqual(['genre', 'author', 'book-title', 'annotation', 'lang']);
    expect(elementXml(xml, 'document-info')).toMatch(
      /<history>\s*<p>v1.0 - created<\/p>\s*<empty-line\/>\s*<p>v1.1 - <strong>proofread<\/strong><\/p>\s*<\/history>/,
    );
    expect((await validateFile(core, file)).errorCount).toBe(0);
  });

  test('7. completes every section of a sparse book; the saved elements are in schema order and valid', async ({
    core,
    page,
  }) => {
    await openViaDialog(core, page, sparseBook(dir, 'full.fb2'));
    await showDescription(page);
    // Title info
    await page.getByTestId('description-book-title').fill('The Complete Book');
    await page.getByTestId('description-keywords').fill('space, opera');
    await page.getByTestId('description-date-text').fill('May 2020');
    await page.getByTestId('description-date-value').fill('2020-05-17');
    await page.getByTestId('description-lang').selectOption('ru');
    await expect(page.getByTestId('description-lang-code')).toHaveValue('ru');
    await page.getByTestId('description-src-lang').selectOption('en');
    await page.getByTestId('description-translator-add').click();
    await page.getByTestId('description-translator-0-first').fill('Petr');
    await page.getByTestId('description-translator-0-last').fill('Sidorov');
    await page.getByTestId('description-sequence-add').click();
    await page.getByTestId('description-sequence-0-name').fill('Series');
    await page.getByTestId('description-sequence-0-number').fill('2');
    // Source title info
    await page.getByTestId('description-src-title-info-add').click();
    await page.getByTestId('description-sti-book-title').fill('A Modern Book');
    await page.getByTestId('description-sti-author-add').click();
    await page.getByTestId('description-sti-author-0-first').fill('Anna');
    await page.getByTestId('description-sti-author-0-last').fill('Ivanova');
    await page.getByTestId('description-sti-genre-add').click();
    await pickGenre(page, 'sf');
    await page.getByTestId('description-sti-lang').selectOption('en');
    // Document info
    await page.getByTestId('description-version').fill('1.1');
    await page.getByTestId('description-program-used').fill('Maxima Fiction Book Editor');
    await page.getByTestId('description-doc-date-text').fill('13 October 2026');
    await page.getByTestId('description-doc-date-value').fill('2026-10-13');
    await page.getByTestId('description-src-ocr').fill('OCR by hand');
    await page.getByTestId('description-src-url-add').click();
    await page.getByTestId('description-src-url-0').fill('https://example.org/source');
    await page.getByTestId('description-publisher-add').click();
    await page.getByTestId('description-publisher-0-nickname').fill('Publisher Nick');
    // Publish info
    await page.getByTestId('description-publish-book-name').fill('Paper edition');
    await page.getByTestId('description-publish-publisher').fill('Press');
    await page.getByTestId('description-publish-city').fill('Saint Petersburg');
    await page.getByTestId('description-publish-year').fill('2021');
    await page.getByTestId('description-publish-isbn').fill('978-5-00000-000-0');
    // Custom info
    await page.getByTestId('description-custom-add').click();
    await page.getByTestId('description-custom-0-type').fill('source');
    await page.getByTestId('description-custom-0-text').fill('corpus fixture');
    // No required field is missing any more.
    await expect(page.locator('.mfbe-desc-required-missing')).toHaveCount(0);

    const file = path.join(dir, 'full-out.fb2');
    const xml = await saveAs(core, page, file);
    expect(childTags(elementXml(xml, 'description'))).toEqual([
      'title-info',
      'src-title-info',
      'document-info',
      'publish-info',
      'custom-info',
    ]);
    expect(childTags(elementXml(xml, 'title-info'))).toEqual([
      'genre',
      'author',
      'book-title',
      'keywords',
      'date',
      'lang',
      'src-lang',
      'translator',
      'sequence',
    ]);
    expect(childTags(elementXml(xml, 'src-title-info'))).toEqual([
      'genre',
      'author',
      'book-title',
      'lang',
    ]);
    expect(childTags(elementXml(xml, 'document-info'))).toEqual([
      'author',
      'program-used',
      'date',
      'src-url',
      'src-ocr',
      'id',
      'version',
      'publisher',
    ]);
    expect(childTags(elementXml(xml, 'publish-info'))).toEqual([
      'book-name',
      'publisher',
      'city',
      'year',
      'isbn',
    ]);
    expect(xml).toContain('<date value="2020-05-17">May 2020</date>');
    expect(xml).toContain('<custom-info info-type="source">corpus fixture</custom-info>');
    expect(xml).toContain('<src-lang>en</src-lang>');
    const report = await validateFile(core, file);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // The Source view shows the same text.
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('source-editor')).toContainText(
      '<book-title>The Complete Book</book-title>',
    );
  });

  test('Find / Replace works in the Description text fields', async ({ core, page }) => {
    await openViaDialog(core, page, sparseBook(dir, 'search.fb2'));
    await showDescription(page);
    await page.getByTestId('description-keywords').fill('alpha beta alpha');
    await page.getByTestId('description-keywords').blur();
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-replace').click();
    const dialog = page.getByTestId('dialog-replace');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('dialog-replace-query').fill('alpha');
    await dialog.getByTestId('dialog-replace-with').fill('gamma');
    await dialog.getByTestId('dialog-replace-button-replaceAll').click();
    await expect(page.getByTestId('dialog-replace-all-done')).toContainText('2');
    await page.getByTestId('dialog-replace-all-done-button-ok').click();
    await expect(page.getByTestId('description-keywords')).toHaveValue('gamma beta gamma');
  });
});
