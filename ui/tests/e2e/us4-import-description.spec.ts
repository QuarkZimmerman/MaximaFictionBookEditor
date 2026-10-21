/**
 * Feature 004, User Story 4 - Import a description from an FBD or FB2 file (T038; spec FR-030
 * to FR-036, SC-004).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. File > Import > Description from FictionBook file... is answered
 * through the queued native dialog (`test.enqueueDialog`). The scenarios:
 *
 *  1. into an untouched new document the whole description arrives without a dialog, the
 *     status bar counts the entries, the Description view and the annotation block show the
 *     result, the document is modified and one Undo takes everything back;
 *  2. once the title was edited the confirmation dialog lists the entries with unticked
 *     checkboxes, Import is disabled until one is ticked and replaces only the ticked list;
 *  3. an opened book always gets the dialog; Cancel changes nothing;
 *  4. a file with nothing importable is reported and changes nothing;
 *  5. the cover: its row shows the small picture served from the import session, a cover
 *     without data shows none; ticked, the image data comes along (not twice), the previous
 *     cover stays, listed as unreferenced;
 *  6. "Other persons" replaces the role list;
 *  7. a malformed file, a text file and a missing path are reported, the document untouched;
 *  8. windows-1251 and a body-less descriptor import; the same file twice counts as an edit;
 *  9. the recorded open request (three types, descriptors first, the remembered folder) and
 *     the folder remembered afterwards (FR-053);
 * 10. pending Source edits are committed first, a malformed Source refuses;
 * 11. the active view is the same before and after, from each of the three views (FR-035);
 * 12. the item is disabled while a script runs (FR-036);
 * 13. the dialog in Russian and Ukrainian;
 * 14. `import-full.fbd` lists every FR-032 entry with its label and value;
 * 15. (`@perf`) the 10 MB generated book as the source: read within Open's budget with Open's
 *     progress, only the description arrives, the import session is closed afterwards.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  NodeRpcClient,
  startCoreWith,
  test,
  waitForBook,
  waitForStartupDocument,
  withUiLang,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageAnyPattern, pagePattern, pageText, uiText, type UiLang } from './fixtures/i18n';
import { MOD } from './fixtures/keys';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gen-large-book.py');
const SCRIPT_FIXTURES = path.join(REPO_ROOT, 'tests', 'scripts', 'fixtures');

/** The constitution's opening budget for a 10 MB book, which applies to an import source. */
const OPEN_BUDGET_MS = 3000;
const PERF_FACTOR = Number(process.env.MFBE_PERF_FACTOR ?? 2) || 2;

/** Entries `import-full.fbd` offers, in the FR-032 order (T003: every entry present). */
const FULL_KEYS = [
  'titleInfo.genres',
  'titleInfo.authors',
  'titleInfo.bookTitle',
  'titleInfo.annotation',
  'titleInfo.keywords',
  'titleInfo.date',
  'titleInfo.coverpage',
  'titleInfo.lang',
  'titleInfo.srcLang',
  'titleInfo.translators',
  'titleInfo.sequences',
  'roles',
  'srcTitleInfo',
  'documentInfo.authors',
  'documentInfo.programUsed',
  'documentInfo.date',
  'documentInfo.srcUrls',
  'documentInfo.srcOcr',
  'documentInfo.id',
  'documentInfo.version',
  'documentInfo.history',
  'documentInfo.publishers',
  'publishInfo.bookName',
  'publishInfo.publisher',
  'publishInfo.city',
  'publishInfo.year',
  'publishInfo.isbn',
  'publishInfo.sequences',
  'customInfo.2',
  'customInfo.3',
  'customInfo.4',
];

/**
 * Entries `maxlib-roles-edge.fbd` offers: five title-info entries, the eight role rows as one
 * entry, the version, and the two non-empty plain rows (the five-part and the `MlEditor` row;
 * the empty `mlcommentator` row is not offered).
 */
const EDGE_ENTRY_COUNT = 9;

interface ScriptHooks {
  list(): { id: string }[];
  run(id: string): Promise<unknown>;
}

declare const window: { __mfbeTest?: { scripts?: ScriptHooks } };

interface DialogRequest {
  method: string;
  filters?: { name: string; extensions: string[] }[];
  selectedFilter?: number;
  folder?: string;
}

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function openApp(core: CoreHandle, page: Page, lang?: UiLang): Promise<void> {
  if (lang) {
    await page.goto(withUiLang(core.baseURL, lang));
    await page.getByTestId('app-root').waitFor();
  } else {
    await core.openApp(page);
  }
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
  await waitForStartupDocument(page);
}

async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, file);
}

/** File > Import > Description from FictionBook file... (the menu item alone). */
async function clickImport(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-import').hover();
  await page.getByTestId('menu-file-import-importDescription').click();
}

/** File > Import > Description from FictionBook file..., answered with `file`. */
async function startImport(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await clickImport(page);
}

const importDialog = (page: Page): Locator => page.getByTestId('dialog-import-description');
const importButton = (page: Page): Locator =>
  page.getByTestId('dialog-import-description-button-import');
const entryCheck = (page: Page, key: string): Locator =>
  page.getByTestId(`import-entry-${key}-check`);
const entryValue = (page: Page, key: string): Locator =>
  page.getByTestId(`import-entry-${key}-value`);

/** The status bar's "N entries imported" in the page's language. */
async function expectImported(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('status-message')).toHaveText(
    await pageText(page, 'transfer.import.done', { count }),
  );
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

async function showBody(page: Page): Promise<void> {
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-editor')).toBeVisible();
}

async function showSource(page: Page): Promise<void> {
  await page.getByTestId('view-source').click();
  await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
}

/** Replaces the whole Source text (select all + insert). */
async function replaceSourceText(page: Page, text: string): Promise<void> {
  await showSource(page);
  await page.getByTestId('source-editor').click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.insertText(text);
}

/** The Source text of `file` as the core serialises it (elided binaries). */
async function serialisedText(core: CoreHandle, file: string): Promise<string> {
  const opened = await core.rpcJob<{ document: { docId: string } }>('doc.open', { path: file });
  try {
    const { text } = await core.rpc<{ text: string }>('doc.toXml', {
      docId: opened.document.docId,
      document: opened.document,
      elideBinaries: true,
    });
    return text;
  } finally {
    await core.rpc('doc.close', { docId: opened.document.docId });
  }
}

async function docId(page: Page): Promise<string> {
  const id = await page.getByTestId('body-view').getAttribute('data-doc-id');
  if (!id) throw new Error('no document shown');
  return id;
}

async function binaryIds(core: CoreHandle, id: string): Promise<string[]> {
  const list = await core.rpc<{ id: string }[]>('binary.list', { docId: id });
  return list.map((meta) => meta.id);
}

/** The sessions the core holds (the worker's core keeps those of pages earlier tests left). */
async function openDocuments(core: CoreHandle): Promise<number> {
  return (await core.rpc<{ openDocuments: number }>('test.metrics')).openDocuments;
}

/** The import session is closed whatever the outcome: no session beyond those before. */
async function expectNoImportSession(core: CoreHandle, before: number): Promise<void> {
  await expect.poll(() => openDocuments(core)).toBe(before);
}

async function undo(page: Page): Promise<void> {
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('menu-edit-undo').click();
}

/** File > New from any view; a modified document's "Save changes?" is answered with No. */
async function newDocumentDiscarding(page: Page): Promise<void> {
  await showBody(page);
  const before = await docId(page);
  const shown = () => page.getByTestId('body-view').getAttribute('data-doc-id');
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  const prompt = page.getByTestId('dialog-save-changes');
  await expect
    .poll(async () => (await prompt.count()) > 0 || (await shown()) !== before)
    .toBe(true);
  if ((await prompt.count()) > 0) await page.getByTestId('dialog-save-changes-button-no').click();
  await expect.poll(shown).not.toBe(before);
  await expect.poll(shown).not.toBeNull();
}

const dialogTitle = (page: Page): Locator =>
  page.getByTestId('dialog-import-description-title').locator('.mfbe-dialog-title-text');

/** A FictionBook whose description offers nothing importable. */
function emptyDescriptionBook(dir: string): string {
  const file = path.join(dir, 'empty-description.fb2');
  writeFileSync(
    file,
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" ' +
      'xmlns:l="http://www.w3.org/1999/xlink">\n' +
      '<description><title-info/><document-info/></description>\n' +
      '<body><section><p>Only a body.</p></section></body>\n</FictionBook>\n',
    'utf8',
  );
  return file;
}

/** A descriptor whose cover page refers to an image the file lacks. */
function coverWithoutDataBook(dir: string): string {
  const file = path.join(dir, 'cover-without-data.fbd');
  writeFileSync(
    file,
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" ' +
      'xmlns:l="http://www.w3.org/1999/xlink">\n' +
      '<description><title-info><genre>sf</genre><author><nickname>nodata</nickname></author>' +
      '<book-title>Без данных</book-title><coverpage><image l:href="#missing.jpg"/></coverpage>' +
      '<lang>ru</lang></title-info>' +
      '<document-info><author><nickname>nodata</nickname></author><date>2026</date>' +
      '<id>nodata</id><version>1.0</version></document-info></description>\n</FictionBook>\n',
    'utf8',
  );
  return file;
}

/** The field name of an entry label: the Description view's caption without its colon. */
function fieldName(lang: UiLang, key: string): string {
  return uiText(lang, key).replace(/:$/, '');
}

function entryLabelText(lang: UiLang, groupKey: string, fieldKey: string): string {
  return uiText(lang, 'transfer.import.entryLabel', {
    group: uiText(lang, groupKey),
    field: fieldName(lang, fieldKey),
  });
}

test.describe('US4 (004) - import a description from an FBD or FB2 file', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-import-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test('1. an untouched new document takes the whole description silently; the status bar counts; one Undo takes it back', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const sessions = await openDocuments(core);
    const id = await docId(page);
    await startImport(core, page, fixtureBook('import-full.fbd'));
    await expectImported(page, FULL_KEYS.length);
    await expect(importDialog(page)).toHaveCount(0);
    // The document is modified; the Body view's annotation block shows the imported text.
    await expect(page).toHaveTitle(/\*/);
    await expect(page.getByTestId('body-block-annotation')).toContainText(
      'Аннотация полного описания.',
    );
    await expect(page.getByTestId('body-block-annotation')).toContainText(
      'Второй абзац аннотации.',
    );
    await expect(page.getByTestId('body-block-history')).toContainText('v1.5 — вычитка');
    expect(await binaryIds(core, id)).toEqual(['cover.jpg']);
    // The import session was closed: no session beyond the document's own.
    await expectNoImportSession(core, sessions);

    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue('Полное описание');
    await expect(page.getByTestId('description-author-0-last')).toHaveValue('Полнова');
    await expect(page.getByTestId('description-keywords')).toHaveValue(
      'импорт, описание, проверка',
    );
    await expect(page.getByTestId('description-cover-0-href')).toHaveValue('#cover.jpg');
    await expect(page.getByTestId('description-role-1-last')).toHaveValue('Редакторов');
    await expect(page.getByTestId('description-version')).toHaveValue('1.5');
    await expect(page.getByTestId('description-id')).toHaveValue('import-full-0001');
    // The program used carries this editor's name: the fill-in of 002 FR-005 applied.
    await expect(page.getByTestId('description-program-used')).toHaveValue(
      /^Maxima FBD Maker, Maxima Fiction Book Editor /,
    );
    await expect(page.getByTestId('description-publish-isbn')).toHaveValue('978-5-00000-000-1');
    await expect(page.getByTestId('description-sti-book-title')).toHaveValue(
      'The Full Description',
    );

    // One Undo restores the template's description, the block included; as every undo, it
    // brings back the view the change was made in - the Body view here.
    await undo(page);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'body');
    await expect(page.getByTestId('body-block-annotation')).not.toContainText('Аннотация');
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue('');
    await expect(page.getByTestId('description-role-0-last')).toHaveCount(0);
    // The template's cover row is the empty reference it carries (`<image l:href=""/>`).
    await expect(page.getByTestId('description-cover-0-href-text')).toHaveValue('');
    await expect(page.getByTestId('description-cover-1-href')).toHaveCount(0);
    await showBody(page);
    // Redo brings it back.
    await page.getByTestId('menu-edit').click();
    await page.getByTestId('menu-edit-redo').click();
    await expect(page.getByTestId('body-block-annotation')).toContainText(
      'Аннотация полного описания.',
    );
  });

  test('2. a touched new document gets the dialog: unticked rows, Import disabled until a tick, only the ticked list replaced', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await fileNew(page);
    await showDescription(page);
    await page.getByTestId('description-book-title').fill('Моя книга');
    await page.getByTestId('description-book-title').blur();

    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialogTitle(page)).toHaveText(await pageText(page, 'transfer.import.title'));
    await expect(page.locator('[data-testid^="import-entry-"][data-testid$="-check"]')).toHaveCount(
      EDGE_ENTRY_COUNT,
    );
    for (const key of ['titleInfo.authors', 'titleInfo.bookTitle', 'roles', 'customInfo.10']) {
      await expect(entryCheck(page, key)).not.toBeChecked();
    }
    await expect(page.getByTestId('import-entry-titleInfo.authors-label')).toHaveText(
      'Title info: Authors',
    );
    await expect(entryValue(page, 'titleInfo.authors')).toHaveText('Обычнов Олег Олегович');
    await expect(entryValue(page, 'titleInfo.bookTitle')).toHaveText(
      'Проверочная книга (крайние случаи)',
    );
    await expect(importButton(page)).toBeDisabled();
    await entryCheck(page, 'titleInfo.authors').check();
    await expect(importButton(page)).toBeEnabled();
    await entryCheck(page, 'titleInfo.authors').uncheck();
    await expect(importButton(page)).toBeDisabled();
    await entryCheck(page, 'titleInfo.authors').check();
    await importButton(page).click();
    await expect(dialog).toHaveCount(0);
    await expectImported(page, 1);

    // The authors are the file's; the title typed before and the empty role list stay.
    await expect(page.getByTestId('description-author-0-last')).toHaveValue('Обычнов');
    await expect(page.getByTestId('description-author-0-first')).toHaveValue('Олег');
    await expect(page.getByTestId('description-author-1-last')).toHaveCount(0);
    await expect(page.getByTestId('description-book-title')).toHaveValue('Моя книга');
    await expect(page.getByTestId('description-role-0-role')).toHaveCount(0);
    await expect(page.getByTestId('description-cover-0-href')).toHaveCount(0);
  });

  test('3. an opened book always gets the dialog; Cancel changes nothing', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const sessions = await openDocuments(core);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(importButton(page)).toBeDisabled();
    await entryCheck(page, 'titleInfo.bookTitle').check();
    await page.getByTestId('dialog-import-description-button-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveTitle(/^modern-utf8\.fb2 - /);
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).not.toHaveValue(
      'Проверочная книга (крайние случаи)',
    );
    // Escape cancels too.
    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveTitle(/^modern-utf8\.fb2 - /);
    await expectNoImportSession(core, sessions);
  });

  test('4. a file with nothing importable is reported and changes nothing', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await startImport(core, page, emptyDescriptionBook(dir));
    const message = page.getByTestId('dialog-import-nothing');
    await expect(message).toBeVisible();
    await expect(page.getByTestId('dialog-import-nothing-text')).toHaveText(
      await pagePattern(page, 'transfer.import.nothing'),
    );
    await page.getByTestId('dialog-import-nothing-button-ok').click();
    await expect(importDialog(page)).toHaveCount(0);
    await expect(page).not.toHaveTitle(/\*/);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
  });

  test('5. the cover row shows the picture from the import session; the data comes along once; the previous cover stays unreferenced', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const sessions = await openDocuments(core);
    const id = await docId(page);
    // Silently: the cover and its data arrive.
    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    await expectImported(page, EDGE_ENTRY_COUNT);
    expect(await binaryIds(core, id)).toEqual(['cover.jpg']);
    await showDescription(page);
    await expect(page.getByTestId('description-cover-0-href')).toHaveValue('#cover.jpg');

    // The same file again (the document is touched now): the cover row with its picture.
    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    await expect(importDialog(page)).toBeVisible();
    const picture = page.getByTestId('import-entry-titleInfo.coverpage-picture');
    await expect(picture).toBeVisible();
    expect(await picture.getAttribute('src')).toMatch(/\/binary\/d\d+\/cover\.jpg\/preview\?/);
    await expect
      .poll(() =>
        picture.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(entryValue(page, 'titleInfo.coverpage')).toContainText('cover.jpg');
    await expect(entryValue(page, 'titleInfo.coverpage')).toContainText('image/jpeg');
    await entryCheck(page, 'titleInfo.coverpage').check();
    await importButton(page).click();
    await expectImported(page, 1);
    // Identical image data is not added twice.
    expect(await binaryIds(core, id)).toEqual(['cover.jpg']);
    await expect(page.getByTestId('description-cover-0-href')).toHaveValue('#cover.jpg');
    await expect(page.getByTestId('binary-objects-badge-unreferenced-cover.jpg')).toHaveCount(0);

    // A cover whose data the file lacks: offered without a picture, imported without data;
    // the previous cover's image stays in the document, listed as unreferenced.
    await startImport(core, page, coverWithoutDataBook(dir));
    await expect(importDialog(page)).toBeVisible();
    await expect(page.getByTestId('import-entry-titleInfo.coverpage-picture')).toHaveCount(0);
    await expect(entryValue(page, 'titleInfo.coverpage')).toHaveText(
      await pageText(page, 'transfer.import.coverNoData', { id: 'missing.jpg' }),
    );
    await entryCheck(page, 'titleInfo.coverpage').check();
    await importButton(page).click();
    await expectImported(page, 1);
    await expect(page.getByTestId('description-cover-0-href-text')).toHaveValue('#missing.jpg');
    expect(await binaryIds(core, id)).toEqual(['cover.jpg']);
    await expect(page.getByTestId('binary-objects-badge-unreferenced-cover.jpg')).toBeVisible();
    await expectNoImportSession(core, sessions);
  });

  test('6. "Other persons" ticked replaces the role list', async ({ core, page }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('maxlib-roles.fbd'));
    await showDescription(page);
    await expect(page.getByTestId('description-role-5-role')).toBeVisible();
    await expect(page.getByTestId('description-role-6-role')).toHaveCount(0);

    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    await expect(importDialog(page)).toBeVisible();
    await expect(page.getByTestId('import-entry-roles-label')).toHaveText(
      'Title info: Other persons',
    );
    await expect(entryValue(page, 'roles')).toContainText('Де Голль Шарль');
    await entryCheck(page, 'roles').check();
    await importButton(page).click();
    await expectImported(page, 1);
    // The eight role rows of the edge fixture, in its order.
    await expect(page.getByTestId('description-role-7-role')).toBeVisible();
    await expect(page.getByTestId('description-role-8-role')).toHaveCount(0);
    await expect(page.getByTestId('description-role-0-role')).toHaveValue('illustrator');
    await expect(page.getByTestId('description-role-0-last')).toHaveValue('Однофамильцев');
    await expect(page.getByTestId('description-role-5-last')).toHaveValue('Де Голль');
    await expect(page.getByTestId('description-role-5-first')).toHaveValue('Шарль');
    // The plain rows of the opened book are untouched (first now: the role rows follow them).
    await expect(page.getByTestId('description-custom-0-type')).toHaveValue('mlillustratorid');
    await expect(page.getByTestId('description-custom-2-type')).toHaveValue('mlseriesid');
    await expect(page.getByTestId('description-custom-3-type')).toHaveCount(0);
  });

  test('7. a malformed file, a text file and a missing path are reported; the document is untouched', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const sessions = await openDocuments(core);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    const notes = path.join(dir, 'notes.txt');
    writeFileSync(notes, 'Just a text file.\n', 'utf8');
    const cases: [string, string][] = [
      [fixtureBook('malformed.fb2'), 'msg.xmlParseError'],
      [notes, 'msg.notFictionBook'],
      [path.join(dir, 'nope.fbd'), 'msg.openFailed'],
    ];
    for (const [file, key] of cases) {
      await startImport(core, page, file);
      const message = page.getByTestId('dialog-import-failed');
      await expect(message).toBeVisible();
      await expect(page.getByTestId('dialog-import-failed-text')).toHaveText(
        await pagePattern(page, key),
      );
      await page.getByTestId('dialog-import-failed-button-ok').click();
      await expect(message).toHaveCount(0);
      await expect(importDialog(page)).toHaveCount(0);
      await expect(page).toHaveTitle(/^modern-utf8\.fb2 - /);
    }
    await expectNoImportSession(core, sessions);
  });

  test('8. windows-1251 and a body-less descriptor import; the same file twice still counts as an edit', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await startImport(core, page, fixtureBook('legacy-cp1251.fb2'));
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageAnyPattern(page, 'transfer.import.done'),
    );
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue('Старая книга');

    await newDocumentDiscarding(page);
    await showDescription(page);
    await startImport(core, page, fixtureBook('descriptor.fbd'));
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageAnyPattern(page, 'transfer.import.done'),
    );
    await expect(page.getByTestId('description-book-title')).toHaveValue('Только описание');
    await showBody(page);
    await expect(page.getByTestId('body-block-annotation')).toContainText(
      'Файл-описание без тела.',
    );

    // The same file again: the dialog shows the entries equal to the current ones; importing
    // one changes nothing but counts as an edit (two undo steps).
    await startImport(core, page, fixtureBook('descriptor.fbd'));
    await expect(importDialog(page)).toBeVisible();
    await expect(entryValue(page, 'titleInfo.bookTitle')).toHaveText('Только описание');
    await entryCheck(page, 'titleInfo.bookTitle').check();
    await importButton(page).click();
    await expectImported(page, 1);
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue('Только описание');
    // The second import was made in the Body view: its undo brings that view back, as every
    // undo does; the first one was made in the Description view and its undo stays there.
    await undo(page);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'body');
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue('Только описание');
    await undo(page);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'description');
    await expect(page.getByTestId('description-book-title')).toHaveValue('');
  });

  test('9. the open request carries the three types with descriptors first and the remembered folder; the chosen folder is remembered (FR-053)', async ({
    core,
    page,
  }) => {
    const remembered = path.join(dir, 'remembered');
    const chosen = path.join(dir, 'chosen');
    mkdirSync(remembered, { recursive: true });
    mkdirSync(chosen, { recursive: true });
    const file = path.join(chosen, 'roles.fbd');
    copyFileSync(fixtureBook('maxlib-roles-edge.fbd'), file);
    await core.rpc('settings.set', { patch: { session: { lastFileDialogFolder: remembered } } });

    await openApp(core, page);
    const before = (await core.rpc<DialogRequest[]>('test.dialogRequests')).length;
    await startImport(core, page, file);
    await expectImported(page, EDGE_ENTRY_COUNT);
    const requests = await core.rpc<DialogRequest[]>('test.dialogRequests');
    const request = requests[before]!;
    expect(request.method).toBe('dialog.openFile');
    expect(request.selectedFilter).toBe(0);
    expect(request.filters).toEqual([
      { name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] },
      { name: 'FictionBook files (*.fb2)', extensions: ['fb2'] },
      { name: 'All files (*.*)', extensions: ['*'] },
    ]);
    if (process.platform !== 'win32') expect(request.folder).toBe(remembered);
    const settings = await core.rpc<{ session: { lastFileDialogFolder: string } }>('settings.get');
    expect(settings.session.lastFileDialogFolder).toBe(chosen);
  });

  test('10. pending Source edits are committed first; a malformed Source refuses with the usual message', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const book = fixtureBook('modern-utf8.fb2');
    await openBook(core, page, book);
    const original = await serialisedText(core, book);
    expect(original).toContain('</book-title>');
    await replaceSourceText(page, original.replace('</book-title>', ' (edited)</book-title>'));
    await expect(page).toHaveTitle(/^modern-utf8\.fb2\* - /);

    await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    await expect(importDialog(page)).toBeVisible();
    await entryCheck(page, 'titleInfo.authors').check();
    await importButton(page).click();
    await expectImported(page, 1);
    // The Source view still shows (its text reloaded from the model): the typed edit and the
    // imported authors are both there.
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'source');
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    const content = page.locator('.mfbe-source-editor .cm-content');
    await expect(content).toContainText('(edited)</book-title>');
    await expect(content).toContainText('<last-name>Обычнов</last-name>');
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).toHaveValue(/ \(edited\)$/);
    await expect(page.getByTestId('description-author-0-last')).toHaveValue('Обычнов');

    // Malformed Source text: the import is refused before anything is read - no file dialog
    // is even asked for (so no answer is queued here: it would wait for the next dialog).
    await replaceSourceText(
      page,
      original.replace('</book-title>', ' (edited)</book-title>').replace('</p>', ''),
    );
    const requestsBefore = (await core.rpc<DialogRequest[]>('test.dialogRequests')).length;
    await clickImport(page);
    const badXml = page.getByTestId('dialog-bad-xml');
    await expect(badXml).toBeVisible();
    await page.getByTestId('dialog-bad-xml-button-ok').click();
    await expect(importDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', 'source');
    await expect(page.getByTestId('source-parse-error')).toBeVisible();
    expect((await core.rpc<DialogRequest[]>('test.dialogRequests')).length).toBe(requestsBefore);
  });

  test('11. the active view stays as it was, from each of the three views (FR-035)', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    for (const view of ['body', 'description', 'source'] as const) {
      await newDocumentDiscarding(page);
      await page.getByTestId(`view-${view}`).click();
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', view);
      if (view === 'source') {
        await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
      }
      await startImport(core, page, fixtureBook('descriptor.fbd'));
      await expect(page.getByTestId('status-message')).toHaveText(
        await pageAnyPattern(page, 'transfer.import.done'),
      );
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-active-view', view);
      if (view === 'source') {
        await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
        await expect(page.locator('.mfbe-source-editor .cm-content')).toContainText(
          '<book-title>Только описание</book-title>',
        );
      } else if (view === 'description') {
        await expect(page.getByTestId('description-book-title')).toHaveValue('Только описание');
      } else {
        await expect(page.getByTestId('body-block-annotation')).toContainText(
          'Файл-описание без тела.',
        );
      }
    }
  });

  test('13. the dialog is in the interface language', async ({ core, page }) => {
    for (const lang of ['ru', 'uk'] as const) {
      await openApp(core, page, lang);
      await openBook(core, page, fixtureBook('modern-utf8.fb2'));
      await startImport(core, page, fixtureBook('maxlib-roles-edge.fbd'));
      await expect(importDialog(page)).toBeVisible();
      await expect(dialogTitle(page)).toHaveText(uiText(lang, 'transfer.import.title'));
      await expect(page.getByTestId('import-entry-titleInfo.authors-label')).toHaveText(
        entryLabelText(lang, 'description.titleInfo', 'descriptionForm.authors'),
      );
      await expect(page.getByTestId('import-entry-roles-label')).toHaveText(
        entryLabelText(lang, 'description.titleInfo', 'descriptionForm.roles.title'),
      );
      await expect(page.getByTestId('import-entry-customInfo.10-label')).toHaveText(
        uiText(lang, 'transfer.import.entryLabel', {
          group: uiText(lang, 'description.customInfo'),
          field: 'MlEditor',
        }),
      );
      await expect(importButton(page)).toHaveText(uiText(lang, 'transfer.import.importButton'));
      await expect(page.getByTestId('dialog-import-description-button-cancel')).toHaveText(
        uiText(lang, 'dialog.buttons.cancel'),
      );
      await page.getByTestId('dialog-import-description-button-cancel').click();
      await expect(importDialog(page)).toHaveCount(0);
    }
  });

  test('14. import-full.fbd lists every FR-032 entry with its label and value', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openBook(core, page, fixtureBook('modern-utf8.fb2'));
    await startImport(core, page, fixtureBook('import-full.fbd'));
    await expect(importDialog(page)).toBeVisible();
    const checks = page.locator('[data-testid^="import-entry-"][data-testid$="-check"]');
    await expect(checks).toHaveCount(FULL_KEYS.length);
    const keys = await checks.evaluateAll((nodes) =>
      nodes.map((node) =>
        (node.getAttribute('data-testid') ?? '')
          .replace(/^import-entry-/, '')
          .replace(/-check$/, ''),
      ),
    );
    expect(keys).toEqual(FULL_KEYS);
    for (const check of await checks.all()) await expect(check).not.toBeChecked();

    const labels: Record<string, string> = {
      'titleInfo.genres': 'Title info: Genres',
      'titleInfo.annotation': 'Title info: Annotation',
      'titleInfo.coverpage': 'Title info: Cover page',
      roles: 'Title info: Other persons',
      srcTitleInfo: 'Source Title Info',
      'documentInfo.history': 'Document Info: History',
      'publishInfo.sequences': 'Publish Info: Sequences',
      'customInfo.2': 'Custom Info: mlseriesid',
    };
    for (const [key, label] of Object.entries(labels)) {
      await expect(page.getByTestId(`import-entry-${key}-label`)).toHaveText(label);
    }
    const values: Record<string, string> = {
      'titleInfo.genres': 'sf; adventure',
      'titleInfo.authors': 'Полнова Полина Петровна',
      'titleInfo.bookTitle': 'Полное описание',
      'titleInfo.annotation': 'Аннотация полного описания.; Второй абзац аннотации.',
      'titleInfo.keywords': 'импорт, описание, проверка',
      'titleInfo.date': '17 мая 2020',
      'titleInfo.lang': 'ru',
      'titleInfo.srcLang': 'en',
      'titleInfo.translators': 'Переводов Тимофей',
      'titleInfo.sequences': 'Полные серии 3; Подсерия 1',
      roles: 'Илюстраторов Илья Ильич; Редакторов Роман Романович',
      srcTitleInfo: 'The Full Description',
      'documentInfo.authors': 'maker',
      'documentInfo.programUsed': 'Maxima FBD Maker',
      'documentInfo.date': '2026-10-20',
      'documentInfo.srcUrls': 'https://example.org/source; https://example.org/mirror',
      'documentInfo.srcOcr': 'OCR by hand',
      'documentInfo.id': 'import-full-0001',
      'documentInfo.version': '1.5',
      'documentInfo.history': 'v1.0 — создание файла; v1.5 — вычитка',
      'documentInfo.publishers': 'Publisher Nick',
      'publishInfo.bookName': 'Полное описание (бумажное издание)',
      'publishInfo.publisher': 'Издательство «Полнота»',
      'publishInfo.city': 'Москва',
      'publishInfo.year': '2021',
      'publishInfo.isbn': '978-5-00000-000-1',
      'publishInfo.sequences': 'Бумажная серия 7',
      'customInfo.2': '99 Какая-то серия',
      'customInfo.3': 'last position 12%',
      'customInfo.4': 'bookmark: chapter 2',
    };
    for (const [key, value] of Object.entries(values)) {
      await expect(entryValue(page, key)).toHaveText(value);
    }
    await expect(entryValue(page, 'titleInfo.coverpage')).toContainText('cover.jpg');
    await expect(page.getByTestId('import-entry-titleInfo.coverpage-picture')).toBeVisible();
    await page.getByTestId('dialog-import-description-button-cancel').click();
    await expect(importDialog(page)).toHaveCount(0);
  });
});

test.describe('US4 (004) - the import while a script runs', () => {
  let dataDir: string;
  let own: { url: string; stop: () => Promise<void> } | null = null;
  let rpc: NodeRpcClient | null = null;

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test.afterEach(async () => {
    rpc?.close();
    rpc = null;
    if (own) await own.stop();
    own = null;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  test('12. the item is disabled while a script runs (FR-036)', async ({ page }) => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-import-run-'));
    cpSync(path.join(SCRIPT_FIXTURES, '06_Runs'), path.join(dataDir, 'scripts', '06_Runs'), {
      recursive: true,
    });
    own = await startCoreWith(process.env.MFBE_CORE_BIN!, dataDir, []);
    const url = new URL(own.url);
    rpc = new NodeRpcClient(
      `ws://127.0.0.1:${url.port}/rpc?token=${url.searchParams.get('token') ?? ''}`,
    );
    await page.goto(own.url);
    await waitForStartupDocument(page);
    await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
    // Available before the run.
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await expect(page.getByTestId('menu-file-import-importDescription')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window.__mfbeTest?.scripts?.list() ?? []).some((s) => s.id === 'runs.longSilent'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(() => {
      void window.__mfbeTest!.scripts!.run('runs.longSilent');
    });
    const banner = page.getByTestId('script-run-banner');
    await expect(banner).toBeVisible();
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await expect(page.getByTestId('menu-file-import-importDescription')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await banner.getByTestId('script-run-cancel').click();
    await expect(banner).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    await expect(page.getByTestId('menu-file-import-importDescription')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});

test.describe('US4 (004) - the 10 MB book as the import source', { tag: '@perf' }, () => {
  let dir: string;
  let book: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us4-import-perf-'));
    book = path.join(dir, 'large.fb2');
    const result = spawnSync('python3', [GENERATOR, '--out', book, '--size-mb', '10'], {
      encoding: 'utf8',
    });
    if (result.status !== 0) book = '';
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("15. the whole file is read as Open reads it, within the opening budget and with Open's progress; only the description arrives", async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!book || !existsSync(book), 'python3 / the generator are not available');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
    await openApp(core, page);
    const sessions = await openDocuments(core);
    const id = await docId(page);
    const paragraphsBefore = await page.getByTestId('body-editor').locator('p.fb-p').count();
    // Every text the status bar shows during the import, to prove the progress was visible.
    await page.evaluate(`(() => {
      const w = window;
      w.__mfbeStatusTexts = [];
      const target = document.querySelector('[data-testid="status-message"]');
      const observer = new MutationObserver(() => {
        const node = document.querySelector('[data-testid="status-message"]');
        if (node) w.__mfbeStatusTexts.push(node.textContent || '');
      });
      observer.observe(target ? target.parentElement : document.body, {
        childList: true, subtree: true, characterData: true,
      });
    })()`);

    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-import').hover();
    const started = Date.now();
    await page.getByTestId('menu-file-import-importDescription').click();
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageAnyPattern(page, 'transfer.import.done'),
      { timeout: OPEN_BUDGET_MS * PERF_FACTOR * 4 },
    );
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: 'perf', description: `imported after ${elapsed} ms` });
    expect(elapsed, 'time until the import is reported').toBeLessThan(OPEN_BUDGET_MS * PERF_FACTOR);
    const texts = await page.evaluate<string[]>(`window.__mfbeStatusTexts`);
    const progress = await pageAnyPattern(page, 'status.progressPercent', 'status.progress');
    expect(
      texts.some((text) => progress.test(text)),
      `status texts: ${texts.join(' | ')}`,
    ).toBe(true);

    // Only the description arrived: the body is the template's, nothing of the book's text.
    await expect(page.getByTestId('body-editor').locator('p.fb-p')).toHaveCount(paragraphsBefore);
    await expect(page.getByTestId('body-editor')).not.toContainText('Section 1');
    await showDescription(page);
    await expect(page.getByTestId('description-book-title')).not.toHaveValue('');
    expect(await binaryIds(core, id)).toEqual([]);
    // The import session is closed.
    await expectNoImportSession(core, sessions);
  });
});
