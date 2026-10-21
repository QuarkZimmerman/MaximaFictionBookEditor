/**
 * Feature 004, User Story 6 - A proposed file name that looks right on every computer (T049;
 * spec FR-050 to FR-053, SC-006; research R6).
 *
 * Tagged `@platform`: runs on the Linux, Windows and macOS e2e legs of CI against the
 * hooks-enabled core of that system (none of the runners has a Cyrillic locale), and in the
 * `chromium`, `chromium-ru` and `chromium-uk` projects. Runs against the real core
 * (`MFBE_CORE_BIN`); skipped in core-less mode. The native save dialog is answered through the
 * queue (`test.enqueueDialog`) and what the editor asked it to show is read back
 * (`test.dialogRequests`). The scenarios:
 *
 *  1. a never-saved document whose first author is Толстой Лев Николаевич and whose title is
 *     Война и мир: Save As proposes the bare `Толстой Лев - Война и мир.fb2` in the folder last
 *     used (Linux and macOS; Windows keeps the folder in the dialog); saved under that name,
 *     the operating system lists exactly it, the window title starts with it, Recent Files
 *     shows it and reopens it; the same with windows-1251 as the content encoding (the
 *     declaration changes, the name does not); a typed Cyrillic name (`Новая книга.fb2`)
 *     comes out the same way; a saved document keeps proposing its own file (FR-053);
 *  2. a description with a title and no author proposes the title alone, an author and no
 *     title the author alone, neither the interface language's "Untitled" (FR-050);
 *  3. forbidden characters are replaced by `_`, a 200-letter title is cut to 100 Cyrillic
 *     letters (200 bytes of UTF-8), and the sanitised name saves (FR-052);
 *  4. Export as FBD proposes the proposed name with `.fbd` for a never-saved document and
 *     `<stem>.fbd` in the book's folder for a saved one (FR-053).
 *
 * Nothing here assumes a Linux path, a locale or a shell tool (ui/README.md); names read back
 * from the file system are compared after NFC normalisation on macOS, where the file system
 * may answer a decomposed spelling, and byte for byte elsewhere.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test, waitForBook, type CoreHandle, type RpcCallError } from './fixtures/core';
import { pageLang, uiText } from './fixtures/i18n';

interface DialogRequest {
  method: string;
  mode: string;
  title: string;
  filters?: { name: string; extensions: string[] }[];
  selectedFilter?: number;
  folder?: string;
  defaultPath?: string;
  encodingChoices?: string[];
  selectedEncoding?: string;
}

/** Linux and macOS: the core opens a dialog that names no folder in the folder last used. */
const KEEPS_LAST_FOLDER = process.platform !== 'win32';

const AUTHOR = { last: 'Толстой', first: 'Лев', middle: 'Николаевич' };
const TITLE = 'Война и мир';
const PROPOSED_STEM = 'Толстой Лев - Война и мир';
const TYPED_NAME = 'Новая книга.fb2';

/** A file name as the operating system reports it, comparable with the name that was given. */
function comparable(name: string): string {
  return process.platform === 'darwin' ? name.normalize('NFC') : name;
}

function listing(folder: string): string[] {
  return readdirSync(folder).map(comparable).sort();
}

async function recordsDialogs(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('test.dialogRequests')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

/** Runs `action` and returns the first file dialog request it caused, as the core got it. */
async function requestOf(core: CoreHandle, action: () => Promise<void>): Promise<DialogRequest> {
  const before = (await core.rpc<DialogRequest[]>('test.dialogRequests')).length;
  await action();
  let requests: DialogRequest[] = [];
  await expect
    .poll(async () => {
      requests = await core.rpc<DialogRequest[]>('test.dialogRequests');
      return requests.length;
    })
    .toBeGreaterThan(before);
  return requests[before]!;
}

async function openApp(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  const lang = await pageLang(page);
  await expect(page.getByTestId('status-message')).toHaveText(uiText(lang, 'status.ready'));
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

/** Types into a Description field and commits it (the form writes on blur). */
async function fillField(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).blur();
}

async function fillAuthor(page: Page, author: { last?: string; first?: string; middle?: string }) {
  await fillField(page, 'description-author-0-last', author.last ?? '');
  await fillField(page, 'description-author-0-first', author.first ?? '');
  await fillField(page, 'description-author-0-middle', author.middle ?? '');
}

/**
 * The editor takes input again: while a file dialog is open the interface is inert and keys
 * are swallowed (feature 002); the queued answer lifts that a moment after the request is
 * recorded.
 */
async function dialogClosed(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
}

/** File > Save As, cancelled; returns what the dialog was asked to show. */
async function saveAsCancelled(core: CoreHandle, page: Page): Promise<DialogRequest> {
  await core.enqueueDialog('dialog.saveFile', {});
  const request = await requestOf(core, () => menu(page, 'file', 'saveAs'));
  await dialogClosed(page);
  return request;
}

/** File > Export > Export as FBD..., cancelled; returns what the dialog was asked to show. */
async function exportCancelled(core: CoreHandle, page: Page): Promise<DialogRequest> {
  await core.enqueueDialog('dialog.saveFile', {});
  const request = await requestOf(core, async () => {
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-export').hover();
    await page.getByTestId('menu-file-export-exportFbd').click();
  });
  await dialogClosed(page);
  return request;
}

/**
 * File > Save As answered with `file` and `encoding`; the incomplete description of a new
 * document gets the usual "Validation failed ... save anyway?" prompt, answered with Yes.
 * Resolves with the recorded request once the file exists and the window title shows its
 * name (a title alone would not tell a save under the same name in another folder).
 */
async function saveAs(
  core: CoreHandle,
  page: Page,
  file: string,
  encoding: string,
): Promise<DialogRequest> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding });
  const request = await requestOf(core, () => menu(page, 'file', 'saveAs'));
  const prompt = page.getByTestId('dialog-validation-failed');
  await expect.poll(async () => (await prompt.count()) > 0 || existsSync(file)).toBe(true);
  if ((await prompt.count()) > 0) {
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  }
  await expect.poll(() => existsSync(file)).toBe(true);
  await expect(page).toHaveTitle(
    new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `),
  );
  await dialogClosed(page);
  return request;
}

/** Id of the document the Body view shows (null while another view is active). */
function shownDocId(page: Page): Promise<string | null> {
  return page.evaluate<string | null>(
    `document.querySelector('[data-testid="body-view"]')?.getAttribute('data-doc-id') ?? null`,
  );
}

/** The Body view, the one that tells which document is shown. */
async function showBody(page: Page): Promise<void> {
  await page.getByTestId('view-body').click();
  await expect(page.getByTestId('body-view')).toBeVisible();
}

/**
 * File > New from any view, discarding the edits of the current document ("Save changes?"
 * answered with No); resolves once the new document replaced the one shown before.
 */
async function newDocument(page: Page): Promise<void> {
  await showBody(page);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
  const before = await shownDocId(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-new').click();
  const prompt = page.getByTestId('dialog-save-changes');
  await expect
    .poll(async () => (await prompt.count()) > 0 || (await shownDocId(page)) !== before)
    .toBe(true);
  if ((await prompt.count()) > 0) await page.getByTestId('dialog-save-changes-button-no').click();
  await expect.poll(() => shownDocId(page)).not.toBe(before);
  await expect.poll(() => shownDocId(page)).not.toBeNull();
}

/** The first Recent Files entry names `file`; chosen, it opens the file anew. */
async function reopenFromRecent(page: Page, file: string): Promise<void> {
  await showBody(page);
  const before = await shownDocId(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-recent').hover();
  const entry = page.getByTestId('menu-file-recent-recent1');
  await expect(entry).toContainText(`1. ${file}`);
  await entry.click();
  await expect.poll(() => shownDocId(page)).not.toBe(before);
  await waitForBook(page, file);
}

test.describe('US6 (004) - a proposed file name that looks right on every computer @platform', () => {
  let dir: string;
  /** The folder the editor remembers from the last Open or Save As (Linux and macOS). */
  let remembered: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us6-names-'));
    remembered = path.join(dir, 'Последняя папка');
    mkdirSync(remembered);
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await recordsDialogs(core)), 'the core does not record dialog requests');
    await core.rpc('settings.set', {
      patch: { session: { lastFileDialogFolder: remembered }, other: { keepEncoding: false } },
    });
  });

  test('1. the proposed and a typed Cyrillic name come out with the same letters on disk, in the title bar and in Recent Files, with utf-8 and with windows-1251', async ({
    core,
    page,
  }, testInfo) => {
    const books = path.join(dir, `Книги ${testInfo.project.name}`);
    const books1251 = path.join(dir, `Книги 1251 ${testInfo.project.name}`);
    mkdirSync(books, { recursive: true });
    mkdirSync(books1251, { recursive: true });
    const proposed = `${PROPOSED_STEM}.fb2`;

    await openApp(core, page);
    await newDocument(page);
    await showDescription(page);
    await fillAuthor(page, AUTHOR);
    await fillField(page, 'description-book-title', TITLE);

    // Save As of the never-saved document: the bare proposed name, FictionBook files selected,
    // the encoding choice inside the dialog; the folder last used on Linux and macOS, none on
    // Windows (the dialog keeps it itself).
    const saved = path.join(books, proposed);
    const request = await saveAs(core, page, saved, 'utf-8');
    expect(request).toMatchObject({
      method: 'dialog.saveFile',
      mode: 'save',
      selectedFilter: 0,
      defaultPath: proposed,
    });
    expect(request.filters?.[0]?.extensions).toEqual(['fb2']);
    expect(request.encodingChoices).toContain('windows-1251');
    expect(request.folder).toBe(KEEPS_LAST_FOLDER ? remembered : undefined);

    // The operating system lists exactly that name; the content is UTF-8 with the letters.
    expect(listing(books)).toEqual([comparable(proposed)]);
    const utf8 = readFileSync(saved);
    expect(utf8.subarray(0, 38).toString('latin1')).toBe('<?xml version="1.0" encoding="utf-8"?>');
    expect(utf8.toString('utf8')).toContain(`<last-name>${AUTHOR.last}</last-name>`);
    expect(utf8.toString('utf8')).toContain(`<book-title>${TITLE}</book-title>`);
    await expect(page).toHaveTitle(new RegExp(`^${PROPOSED_STEM}\\.fb2 - `));
    await reopenFromRecent(page, saved);

    // The same name with windows-1251 as the content encoding: the declaration and the bytes
    // of the content change, the name does not (scenario 3). A saved document proposes its own
    // file (FR-053), so the dialog is answered with the new folder.
    const saved1251 = path.join(books1251, proposed);
    const again = await saveAs(core, page, saved1251, 'windows-1251');
    expect(again.defaultPath).toBe(saved);
    expect(again.folder).toBeUndefined();
    expect(listing(books1251)).toEqual([comparable(proposed)]);
    const cp1251 = readFileSync(saved1251);
    expect(cp1251.subarray(0, 45).toString('latin1')).toBe(
      '<?xml version="1.0" encoding="windows-1251"?>',
    );
    expect(cp1251.includes(Buffer.from(AUTHOR.last, 'utf8'))).toBe(false);
    expect(new TextDecoder('windows-1251').decode(cp1251)).toContain(
      `<last-name>${AUTHOR.last}</last-name>`,
    );
    await expect(page).toHaveTitle(new RegExp(`^${PROPOSED_STEM}\\.fb2 - `));
    await reopenFromRecent(page, saved1251);

    // A name the user typed: the same letters everywhere.
    const typed = path.join(books, TYPED_NAME);
    const typedRequest = await saveAs(core, page, typed, 'utf-8');
    expect(typedRequest.defaultPath).toBe(saved1251);
    expect(listing(books)).toEqual([comparable(TYPED_NAME), comparable(proposed)].sort());
    expect(readFileSync(typed, 'utf8')).toContain(`<book-title>${TITLE}</book-title>`);
    await expect(page).toHaveTitle(new RegExp(`^${TYPED_NAME.replace('.', '\\.')} - `));
    await reopenFromRecent(page, typed);
    // The next Save As proposes the typed name in its folder.
    const kept = await saveAsCancelled(core, page);
    expect(kept.defaultPath).toBe(typed);
    expect(kept.folder).toBeUndefined();
  });

  test('2. the title alone, the author alone, and the interface language\'s "Untitled" when the description has neither (FR-050)', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    const lang = await pageLang(page);
    const untitled = `${uiText(lang, 'app.untitled')}.fb2`;

    // Neither title nor author (the template's empty author does not count).
    await newDocument(page);
    const neither = await saveAsCancelled(core, page);
    expect(neither.defaultPath).toBe(untitled);
    expect(neither.folder).toBe(KEEPS_LAST_FOLDER ? remembered : undefined);

    // A title and no author: the title alone.
    await showDescription(page);
    await fillField(page, 'description-book-title', TITLE);
    expect((await saveAsCancelled(core, page)).defaultPath).toBe(`${TITLE}.fb2`);

    // An author and no title: last name and first name, the middle name never.
    await newDocument(page);
    await showDescription(page);
    await fillAuthor(page, AUTHOR);
    expect((await saveAsCancelled(core, page)).defaultPath).toBe(
      `${AUTHOR.last} ${AUTHOR.first}.fb2`,
    );

    // Export as FBD of the same never-saved document: the same stem with .fbd.
    expect((await exportCancelled(core, page)).defaultPath).toBe(
      `${AUTHOR.last} ${AUTHOR.first}.fbd`,
    );

    // Whitespace alone is no title: still the author alone; cleared entirely, "Untitled".
    await fillField(page, 'description-book-title', '   ');
    expect((await saveAsCancelled(core, page)).defaultPath).toBe(
      `${AUTHOR.last} ${AUTHOR.first}.fb2`,
    );
    await fillAuthor(page, {});
    expect((await saveAsCancelled(core, page)).defaultPath).toBe(untitled);
  });

  test('3. forbidden characters become "_" and a long title is cut to 100 Cyrillic letters; the sanitised name saves (FR-052)', async ({
    core,
    page,
  }, testInfo) => {
    const books = path.join(dir, `Запрещённые ${testInfo.project.name}`);
    mkdirSync(books, { recursive: true });
    await openApp(core, page);
    await newDocument(page);
    await showDescription(page);

    // `\ / : * ? " < > |` replaced one by one; trailing dots and spaces removed.
    await fillField(page, 'description-book-title', 'Война/мир: что? "Кто" <где> | и *как*\\... ');
    const forbidden = await saveAsCancelled(core, page);
    expect(forbidden.defaultPath).toBe('Война_мир_ что_ _Кто_ _где_ _ и _как__.fb2');
    // The sanitised name is a name every supported platform accepts.
    const sanitised = path.join(books, forbidden.defaultPath!);
    await saveAs(core, page, sanitised, 'utf-8');
    expect(listing(books)).toEqual([comparable(forbidden.defaultPath!)]);
    expect(existsSync(sanitised)).toBe(true);

    // A title of 200 Cyrillic letters: the stem keeps 100 of them (200 bytes of UTF-8), cut
    // at a letter boundary.
    await newDocument(page);
    await showDescription(page);
    const letters = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
    const long = Array.from({ length: 200 }, (_, i) => letters[i % letters.length]).join('');
    await fillField(page, 'description-book-title', long);
    const cut = await saveAsCancelled(core, page);
    expect(cut.defaultPath).toBe(`${long.slice(0, 100)}.fb2`);
    expect(Buffer.byteLength(cut.defaultPath!.slice(0, -4), 'utf8')).toBe(200);
    // With an author in front the 120 code points / 200 bytes apply to the whole stem.
    await fillAuthor(page, AUTHOR);
    const withAuthor = await saveAsCancelled(core, page);
    const stem = withAuthor.defaultPath!.slice(0, -4);
    expect(stem.startsWith(`${AUTHOR.last} ${AUTHOR.first} - `)).toBe(true);
    expect(Array.from(stem).length).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(stem, 'utf8')).toBeLessThanOrEqual(200);
    expect(stem).not.toMatch(/[ .]$/);

    // A title made of forbidden characters only: the interface language's "Untitled".
    await newDocument(page);
    await showDescription(page);
    await fillField(page, 'description-book-title', '???///***');
    const lang = await pageLang(page);
    expect((await saveAsCancelled(core, page)).defaultPath).toBe(
      `${uiText(lang, 'app.untitled')}.fb2`,
    );
  });

  test("4. Export as FBD proposes the proposed name with .fbd for a never-saved document and <stem>.fbd in the book's folder for a saved one (FR-053)", async ({
    core,
    page,
  }, testInfo) => {
    const books = path.join(dir, `Экспорт ${testInfo.project.name}`);
    mkdirSync(books, { recursive: true });
    await openApp(core, page);
    await newDocument(page);
    await showDescription(page);
    await fillAuthor(page, AUTHOR);
    await fillField(page, 'description-book-title', TITLE);

    // Never saved: the bare proposed name with .fbd, the one descriptors type, in the folder
    // last used (Linux and macOS).
    const fresh = await exportCancelled(core, page);
    expect(fresh).toMatchObject({
      method: 'dialog.saveFile',
      selectedFilter: 0,
      defaultPath: `${PROPOSED_STEM}.fbd`,
    });
    expect(fresh.filters?.map((filter) => filter.extensions)).toEqual([['fbd']]);
    expect(fresh.encodingChoices ?? []).toEqual([]);
    expect(fresh.folder).toBe(KEEPS_LAST_FOLDER ? remembered : undefined);

    // Saved under the proposed name: the same stem with .fbd in the book's folder - a full
    // path, so the dialog opens there.
    const saved = path.join(books, `${PROPOSED_STEM}.fb2`);
    await saveAs(core, page, saved, 'utf-8');
    const exported = await exportCancelled(core, page);
    expect(exported.defaultPath).toBe(path.join(books, `${PROPOSED_STEM}.fbd`));
    expect(exported.folder).toBeUndefined();

    // Saved under a typed name with the extension in another case: the stem is the typed
    // name without it.
    const typed = path.join(books, 'Новая книга.FB2');
    await saveAs(core, page, typed, 'utf-8');
    expect((await exportCancelled(core, page)).defaultPath).toBe(
      path.join(books, 'Новая книга.fbd'),
    );
  });
});
