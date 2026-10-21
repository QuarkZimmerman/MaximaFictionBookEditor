/**
 * Feature 004, User Story 3 - Illustrators, editors and the other roles in the description
 * (T029, T034; spec FR-020 to FR-025, SC-003).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. The fixtures are the Maxima Library's own role checks copied into
 * `tests/fixtures/books/maxlib-roles*.fbd` (T002, research R3.5). The scenarios:
 *
 *  1. `maxlib-roles.fbd` opens into six entries of `description-role-list` with the role names
 *     of the interface language (the Russian and Ukrainian ones the library's own), and the
 *     Custom info group shows only the record-number rows;
 *  2. saved unedited, every `custom-info` row is written character for character in its place;
 *     one edited name rewrites that entry in the library's format after the plain rows and
 *     leaves the other five verbatim in their relative order; edited back, the file is as read;
 *  3. added persons are written as the Maxima FBD Maker writes them: `_` for a space inside a
 *     name, no `.` after a one-letter name in any part, two spaces for a missing first name, a
 *     hyphen and an apostrophe as typed; an entry without a last name is flagged; an entry with
 *     no name at all is not written;
 *  4. Remove drops the entry from the saved file, the others keep their relative order;
 *  5. `maxlib-roles-edge.fbd`: surname-only entries, `Ю Ю Ю`, two illustrators in order; the
 *     empty, five-part and `MlEditor` rows stay Custom info rows; leading and trailing spaces
 *     are preserved unedited and trimmed once the entry is edited;
 *  6. Find and Replace reach the name fields;
 *  7. a `.fb2` saved with roles reopens with the same list;
 *  8. a new document shows the Other persons list empty - its Add control alone - after
 *     Translators and before Sequences; the Authors and Translators lists keep exactly their
 *     0.0.3 controls and nothing in the Description view reorders persons (requester's
 *     correction of 2026-10-20).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import {
  expect,
  fileNew,
  fixtureBook,
  test,
  waitForBook,
  withUiLang,
  type CoreHandle,
  type RpcCallError,
} from './fixtures/core';
import { pageAnyPattern, pageText, UI_LANGS, type UiLang } from './fixtures/i18n';

interface Row {
  infoType: string;
  text: string;
}

interface Entry {
  role: string;
  lastName: string;
  firstName: string;
  middleName: string;
  row: number;
}

interface Expected {
  rows: Row[];
  entries: Entry[];
  plainRows: Row[];
  edge: { rows: Row[]; entries: Entry[]; plainRows: Row[] };
}

const EXPECTED: Expected = JSON.parse(
  readFileSync(fixtureBook('maxlib-roles.expected.json'), 'utf8'),
) as Expected;

/** The roles in the list's order, with the library's names (spec FR-020). */
const ROLE_KEYS = [
  'illustrator',
  'editor',
  'compiler',
  'designer',
  'commentator',
  'aboutTheAuthor',
] as const;

const ROLE_NAMES: Record<UiLang, readonly string[]> = {
  en: ['Illustrator', 'Editor', 'Compiler', 'Designer', 'Commentator', 'About the author'],
  ru: ['Иллюстратор', 'Редактор', 'Составитель', 'Оформитель', 'Комментатор', 'Написано об авторе'],
  uk: ['Ілюстратор', 'Редактор', 'Упорядник', 'Оформлювач', 'Коментатор', 'Написано про автора'],
};

async function supportsDocuments(core: CoreHandle): Promise<boolean> {
  if (!core.hasCore) return false;
  return core
    .rpc('doc.recent')
    .then(() => true)
    .catch((error: RpcCallError) => error.code !== -32601);
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

async function openApp(core: CoreHandle, page: Page, lang?: UiLang): Promise<void> {
  if (lang) {
    await page.goto(withUiLang(core.baseURL, lang));
    await page.getByTestId('app-root').waitFor();
  } else {
    await core.openApp(page);
  }
  await expect(page.getByTestId('status-message')).toHaveText(await pageText(page, 'status.ready'));
}

/** Opens `file` through the queued native dialog and shows the Description view. */
async function openDescription(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
}

/**
 * Save As to `file` through the queued native dialog; returns the written text. A description
 * file has no body, so Save asks before writing an invalid document ("Yes" writes it). The
 * saved file heads the window title - the sign the write is done (a test saves several files,
 * so the status message of the previous save would not do).
 */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await menu(page, 'file', 'saveAs');
  const prompt = page.getByTestId('dialog-validation-failed');
  const title = new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `);
  await expect
    .poll(async () => (await prompt.count()) > 0 || title.test(await page.title()))
    .toBe(true);
  if ((await prompt.count()) > 0)
    await page.getByTestId('dialog-validation-failed-button-yes').click();
  await expect(page).toHaveTitle(title);
  await expect(page.getByTestId('status-message')).toContainText(
    await pageAnyPattern(page, 'status.savedNoErrors', 'msg.errorsFound'),
  );
  return readFileSync(file, 'utf8');
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The `custom-info` elements of a saved file, in file order, with their text as written. */
function customInfoRows(xml: string): Row[] {
  const description = /<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/.exec(xml)?.[1] ?? '';
  const rows: Row[] = [];
  for (const match of description.matchAll(
    /<custom-info\b([^>]*?)(?:\/>|>([\s\S]*?)<\/custom-info>)/g,
  )) {
    const infoType = /info-type="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '';
    rows.push({ infoType: unescapeXml(infoType), text: unescapeXml(match[2] ?? '') });
  }
  return rows;
}

// In-page snippets touching the DOM are string expressions: the e2e tsconfig has no DOM lib.

/** Test ids of the person / role / sequence lists of the Title info form, in document order. */
const TITLE_INFO_LISTS = `Array.from(
  document.querySelectorAll('[data-testid="description-title-info-form"] fieldset[data-testid$="-list"]'),
  (node) => node.getAttribute('data-testid'),
)`;

/** Every test id of the Description view starting with `prefix`, sorted. */
const testIdsUnder = (prefix: string) => `Array.from(
  document.querySelectorAll('[data-testid="description-view"] [data-testid^=${JSON.stringify(prefix)}]'),
  (node) => node.getAttribute('data-testid'),
).sort()`;

/** One role entry as the list shows it. */
async function readEntry(page: Page, k: number) {
  const id = (part: string) => page.getByTestId(`description-role-${k}-${part}`);
  return {
    role: await id('role').inputValue(),
    lastName: await id('last').inputValue(),
    firstName: await id('first').inputValue(),
    middleName: await id('middle').inputValue(),
  };
}

/** Every entry of the Other persons list, in order. */
async function readEntries(page: Page) {
  const count = await page
    .locator('[data-testid^="description-role-"][data-testid$="-role"]')
    .count();
  const entries = [];
  for (let k = 0; k < count; k += 1) entries.push(await readEntry(page, k));
  return entries;
}

const withoutRow = (entries: Entry[]) =>
  entries.map(({ role, lastName, firstName, middleName }) => ({
    role,
    lastName,
    firstName,
    middleName,
  }));

/** The `(type, text)` pairs of the Custom info group, in its order. */
async function customInfoGroup(page: Page): Promise<Row[]> {
  const group = page.getByTestId('description-custom-info');
  const types = group.locator('[data-testid^="description-custom-"][data-testid$="-type"]');
  const texts = group.locator('[data-testid^="description-custom-"][data-testid$="-text"]');
  const count = await types.count();
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ infoType: await types.nth(i).inputValue(), text: await texts.nth(i).inputValue() });
  }
  return rows;
}

/** Adds an entry with `role` and the three names; returns its index. */
async function addEntry(
  page: Page,
  role: (typeof ROLE_KEYS)[number],
  names: { last?: string; first?: string; middle?: string },
): Promise<number> {
  const before = await page
    .locator('[data-testid^="description-role-"][data-testid$="-role"]')
    .count();
  await page.getByTestId('description-role-add').click();
  const k = before;
  await expect(page.getByTestId(`description-role-${k}-role`)).toBeVisible();
  await page.getByTestId(`description-role-${k}-role`).selectOption(role);
  if (names.last !== undefined)
    await page.getByTestId(`description-role-${k}-last`).fill(names.last);
  if (names.first !== undefined) {
    await page.getByTestId(`description-role-${k}-first`).fill(names.first);
  }
  if (names.middle !== undefined) {
    await page.getByTestId(`description-role-${k}-middle`).fill(names.middle);
  }
  return k;
}

test.describe('US3 (004) - illustrators, editors and the other roles', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us3-roles-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    test.skip(!(await supportsDocuments(core)), 'the core does not implement doc.* yet');
  });

  test('1. the six-role description opens into six entries named in the interface language; the record numbers stay Custom info rows', async ({
    core,
    page,
  }) => {
    for (const lang of UI_LANGS) {
      await openApp(core, page, lang);
      await openDescription(core, page, fixtureBook('maxlib-roles.fbd'));
      const list = page.getByTestId('description-role-list');
      await expect(list).toBeVisible();
      await expect(page.getByTestId('description-role-5-role')).toBeVisible();
      await expect(page.getByTestId('description-role-6-role')).toHaveCount(0);
      expect(await readEntries(page)).toEqual(withoutRow(EXPECTED.entries));
      // The role names: English in their idiomatic form, Russian and Ukrainian the library's.
      for (let k = 0; k < ROLE_KEYS.length; k += 1) {
        const select = page.getByTestId(`description-role-${k}-role`);
        await expect(select).toHaveValue(ROLE_KEYS[k]!);
        await expect(select.locator('option:checked')).toHaveText(ROLE_NAMES[lang][k]!);
        await expect(select.locator('option')).toHaveText(ROLE_NAMES[lang] as string[]);
      }
      // The Custom info group shows the record-number rows only (FR-022, FR-025).
      expect(await customInfoGroup(page)).toEqual(EXPECTED.plainRows);
      await expect(page.getByTestId('description-custom-add')).toBeVisible();
      // No incomplete marker: every entry has its last name.
      await expect(page.locator('[data-testid$="-incomplete"]')).toHaveCount(0);
    }
  });

  test('2. unedited rows are written verbatim in place; one edited name rewrites the list in the library format after the plain rows (SC-003)', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openDescription(core, page, fixtureBook('maxlib-roles.fbd'));
    const unedited = await saveAs(core, page, path.join(dir, 'roles-unedited.fbd'));
    expect(customInfoRows(unedited)).toEqual(EXPECTED.rows);

    // A trivial edit of one name: the role entries move after the plain rows, the edited one
    // in the library's format, the other five character for character in the same order.
    await page.getByTestId('description-role-1-first').fill('Ромен');
    await page.getByTestId('description-role-1-first').blur();
    const edited = await saveAs(core, page, path.join(dir, 'roles-edited.fbd'));
    const roleRows = EXPECTED.entries.map((e) => EXPECTED.rows[e.row]!);
    expect(customInfoRows(edited)).toEqual([
      ...EXPECTED.plainRows,
      roleRows[0],
      { infoType: 'mleditor', text: 'Редакторов Ромен Романович' },
      ...roleRows.slice(2),
    ]);
    expect(edited).toContain(
      '<custom-info info-type="mleditor">Редакторов Ромен Романович</custom-info>',
    );

    // Edited back to the value read, the list counts as unedited again: rows in their place.
    await page.getByTestId('description-role-1-first').fill('Роман');
    await page.getByTestId('description-role-1-first').blur();
    const restored = await saveAs(core, page, path.join(dir, 'roles-restored.fbd'));
    expect(customInfoRows(restored)).toEqual(EXPECTED.rows);
  });

  test('3. added persons are written as the Maxima FBD Maker writes them; a missing last name is flagged (FR-021)', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openDescription(core, page, fixtureBook('maxlib-roles.fbd'));
    const add = page.getByTestId('description-role-add');
    await expect(add).toBeVisible();

    // A space inside a name becomes `_` (acceptance scenario 3).
    await addEntry(page, 'editor', { last: 'Де Голль', first: 'Шарль' });
    // One-letter names are written as typed, no `.` added - a first name (scenario 4) and a
    // last and a middle name alike (edge cases).
    await addEntry(page, 'compiler', { last: 'Азбукин', first: 'А', middle: 'Б' });
    await addEntry(page, 'commentator', { last: 'Я', first: 'Ярослав', middle: 'Я' });
    // No first name: two spaces in a row, as the library writes it (scenario 4).
    await addEntry(page, 'designer', { last: 'Дизайнеров', middle: 'Данилович' });
    // A hyphen and an apostrophe are written as typed (edge cases).
    await addEntry(page, 'aboutTheAuthor', { last: "Д'Артаньян-Петров", first: 'Шарль' });
    // No last name: flagged on the entry, written as the format allows.
    const incomplete = await addEntry(page, 'illustrator', { first: 'Безфамильный' });
    await expect(page.getByTestId(`description-role-${incomplete}-incomplete`)).toBeVisible();
    await expect(page.getByTestId(`description-role-${incomplete}-incomplete`)).toHaveText(
      await pageText(page, 'descriptionForm.roles.incomplete'),
    );
    // Every other entry is complete.
    await expect(page.locator('[data-testid$="-incomplete"]')).toHaveCount(1);
    // An entry left empty is not written (the library writes none).
    const empty = await addEntry(page, 'editor', {});
    await expect(page.getByTestId(`description-role-${empty}-role`)).toHaveValue('editor');

    const xml = await saveAs(core, page, path.join(dir, 'roles-added.fbd'));
    const roleRows = EXPECTED.entries.map((e) => EXPECTED.rows[e.row]!);
    expect(customInfoRows(xml)).toEqual([
      ...EXPECTED.plainRows,
      ...roleRows,
      { infoType: 'mleditor', text: 'Де_Голль Шарль' },
      { infoType: 'mlcompiler', text: 'Азбукин А Б' },
      { infoType: 'mlcommentator', text: 'Я Ярослав Я' },
      { infoType: 'mldesigner', text: 'Дизайнеров  Данилович' },
      { infoType: 'mlabouttheauthor', text: "Д'Артаньян-Петров Шарль" },
      { infoType: 'mlillustrator', text: 'Безфамильный' },
    ]);
    expect(xml).toContain('<custom-info info-type="mleditor">Де_Голль Шарль</custom-info>');
    expect(xml).not.toContain('А.');
    expect(xml).not.toContain('Я.');
    // A record number is never written: the three rows read are the only `*id` rows.
    expect(customInfoRows(xml).filter((row) => /id$/.test(row.infoType))).toEqual(
      EXPECTED.plainRows,
    );

    // The incomplete entry reloads with the name in the last-name field, as the library reads
    // it; the typed `_`-free names come back as typed.
    await openDescription(core, page, path.join(dir, 'roles-added.fbd'));
    const entries = await readEntries(page);
    expect(entries).toHaveLength(12);
    expect(entries[6]).toEqual({
      role: 'editor',
      lastName: 'Де Голль',
      firstName: 'Шарль',
      middleName: '',
    });
    expect(entries[7]).toEqual({
      role: 'compiler',
      lastName: 'Азбукин',
      firstName: 'А',
      middleName: 'Б',
    });
    expect(entries[9]).toEqual({
      role: 'designer',
      lastName: 'Дизайнеров',
      firstName: '',
      middleName: 'Данилович',
    });
    expect(entries[11]).toEqual({
      role: 'illustrator',
      lastName: 'Безфамильный',
      firstName: '',
      middleName: '',
    });
    await expect(page.locator('[data-testid$="-incomplete"]')).toHaveCount(0);
  });

  test('4. Remove drops the entry from the saved file; the remaining entries keep their order', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openDescription(core, page, fixtureBook('maxlib-roles.fbd'));
    await page.getByTestId('description-role-2-remove').click();
    await expect(page.getByTestId('description-role-5-role')).toHaveCount(0);
    await expect(page.getByTestId('description-role-2-role')).toHaveValue('designer');
    expect(await readEntries(page)).toEqual(
      withoutRow(EXPECTED.entries.filter((e) => e.role !== 'compiler')),
    );
    const xml = await saveAs(core, page, path.join(dir, 'roles-removed.fbd'));
    const roleRows = EXPECTED.entries
      .filter((e) => e.role !== 'compiler')
      .map((e) => EXPECTED.rows[e.row]!);
    expect(customInfoRows(xml)).toEqual([...EXPECTED.plainRows, ...roleRows]);
    expect(xml).not.toContain('mlcompiler');
  });

  test('5. the library edge cases: surname only, Ю Ю Ю, two illustrators; the empty, five-part and MlEditor rows stay Custom info rows; spaces kept unedited, trimmed once edited', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await openDescription(core, page, fixtureBook('maxlib-roles-edge.fbd'));
    const edge = EXPECTED.edge;
    expect(await readEntries(page)).toEqual(withoutRow(edge.entries));
    // Surname only, one-letter names and the leading / trailing spaces of the file: read as the
    // library reads them, no `.` added.
    expect(await readEntry(page, 0)).toEqual({
      role: 'illustrator',
      lastName: 'Однофамильцев',
      firstName: '',
      middleName: '',
    });
    expect(await readEntry(page, 2)).toEqual({
      role: 'compiler',
      lastName: 'Ю',
      firstName: 'Ю',
      middleName: 'Ю',
    });
    expect(await readEntry(page, 7)).toEqual({
      role: 'editor',
      lastName: 'Пробелов',
      firstName: 'Пётр',
      middleName: 'Петрович',
    });
    // Two illustrators in the file's order.
    expect((await readEntries(page)).filter((e) => e.role === 'illustrator')).toEqual([
      { role: 'illustrator', lastName: 'Однофамильцев', firstName: '', middleName: '' },
      { role: 'illustrator', lastName: 'Первов', firstName: 'Пётр', middleName: 'Петрович' },
      { role: 'illustrator', lastName: 'Второв', firstName: 'Вадим', middleName: 'Вадимович' },
    ]);
    // The rows that do not fit the format stay plain Custom info rows (FR-022).
    expect(await customInfoGroup(page)).toEqual(edge.plainRows);
    // A surname-only entry is complete for the format: nothing is flagged.
    await expect(page.locator('[data-testid$="-incomplete"]')).toHaveCount(0);

    // Unedited: every row verbatim, in its place - the leading spaces of `  Пробелов ...`
    // included (acceptance scenario 5).
    const unedited = await saveAs(core, page, path.join(dir, 'edge-unedited.fbd'));
    expect(customInfoRows(unedited)).toEqual(edge.rows);
    expect(unedited).toContain(
      '<custom-info info-type="mleditor">  Пробелов Пётр Петрович </custom-info>',
    );

    // Edited: that entry trimmed and in the library's format; the plain rows first, then the
    // role entries in the list's order, the untouched ones still verbatim.
    await page.getByTestId('description-role-7-middle').fill('Павлович');
    await page.getByTestId('description-role-7-middle').blur();
    const edited = await saveAs(core, page, path.join(dir, 'edge-edited.fbd'));
    expect(customInfoRows(edited)).toEqual([
      ...edge.plainRows,
      ...edge.entries.map((e) =>
        e.row === 9 ? { infoType: 'mleditor', text: 'Пробелов Пётр Павлович' } : edge.rows[e.row]!,
      ),
    ]);
    expect(edited).toContain('<custom-info info-type="mleditor">Де_Голль Шарль</custom-info>');
    expect(edited).toContain(
      '<custom-info info-type="mldesigner">Дизайнеров  Данилович</custom-info>',
    );
    expect(edited).toContain('<custom-info info-type="MlEditor">Регистров Р Р</custom-info>');
    expect(edited).toContain('Первый Второй Третий Четвёртый Пятый');
  });

  test('6. Find and Replace reach the name fields', async ({ core, page }) => {
    await openApp(core, page);
    await openDescription(core, page, fixtureBook('maxlib-roles.fbd'));
    // Find: the match is selected in the entry's field.
    await menu(page, 'edit', 'find');
    const find = page.getByTestId('dialog-find');
    await expect(find).toBeVisible();
    await find.getByTestId('dialog-find-query').fill('Артём');
    await find.getByTestId('dialog-find-button-findNext').click();
    await expect(page.getByTestId('description-role-5-first')).toBeFocused();
    await find.getByTestId('dialog-find-button-cancel').click();
    await expect(find).toHaveCount(0);
    // Replace All: "Кузьма" occurs in a role entry only (the record-number rows name others).
    await menu(page, 'edit', 'replace');
    const replace = page.getByTestId('dialog-replace');
    await expect(replace).toBeVisible();
    await replace.getByTestId('dialog-replace-query').fill('Кузьма');
    await replace.getByTestId('dialog-replace-with').fill('Казимир');
    await replace.getByTestId('dialog-replace-button-replaceAll').click();
    await expect(page.getByTestId('dialog-replace-all-done')).toContainText('1');
    await page.getByTestId('dialog-replace-all-done-button-ok').click();
    await expect(page.getByTestId('description-role-4-first')).toHaveValue('Казимир');
    const xml = await saveAs(core, page, path.join(dir, 'roles-replaced.fbd'));
    expect(customInfoRows(xml)).toContainEqual({
      infoType: 'mlcommentator',
      text: 'Комментаторов Казимир Кузьмич',
    });
  });

  test('7. a .fb2 saved with roles reopens with the same list', async ({ core, page }) => {
    await openApp(core, page);
    await openDescription(core, page, fixtureBook('maxlib-roles.fbd'));
    await addEntry(page, 'editor', { last: 'Де Голль', first: 'Шарль' });
    const file = path.join(dir, 'roles.fb2');
    const xml = await saveAs(core, page, file);
    expect(customInfoRows(xml)).toHaveLength(10);
    const before = await readEntries(page);
    expect(before).toHaveLength(7);
    await openDescription(core, page, file);
    expect(await readEntries(page)).toEqual(before);
    expect(await customInfoGroup(page)).toEqual(EXPECTED.plainRows);
  });

  test('8. a new document: the Other persons list is empty after Translators; the Authors and Translators lists are as on 0.0.3; nothing reorders (T034)', async ({
    core,
    page,
  }) => {
    await openApp(core, page);
    await fileNew(page);
    await page.getByTestId('view-description').click();
    const view = page.getByTestId('description-view');
    await expect(view).toBeVisible();

    // The list is empty and offers its Add control only (US3 scenario 10).
    const list = page.getByTestId('description-role-list');
    await expect(list).toBeVisible();
    await expect(page.getByTestId('description-role-add')).toBeVisible();
    await expect(page.getByTestId('description-role-0')).toHaveCount(0);
    await expect(list.locator('[data-testid]')).toHaveCount(1);
    await expect(list.locator('button, input, select, textarea')).toHaveCount(1);
    await expect(list.locator('legend')).toHaveText(
      await pageText(page, 'descriptionForm.roles.title'),
    );

    // After Translators, before Sequences, in the Title info group only (the sub-sections of
    // the Title info form in document order).
    expect(await page.evaluate<string[]>(TITLE_INFO_LISTS)).toEqual([
      'description-author-list',
      'description-cover-list',
      'description-translator-list',
      'description-role-list',
      'description-sequence-list',
    ]);
    await page.getByTestId('description-src-title-info-add').click();
    await expect(page.getByTestId('description-sti-book-title')).toBeVisible();
    await expect(page.getByTestId('description-sti-role-list')).toHaveCount(0);
    await expect(page.locator('[data-testid="description-role-list"]')).toHaveCount(1);

    // The Authors list: exactly the 0.0.3 controls (the template's one empty author row).
    const idsUnder = (prefix: string) => page.evaluate<string[]>(testIdsUnder(prefix));
    const personRowIds = (prefix: string) =>
      [
        '',
        '-remove',
        '-first',
        '-first-row',
        '-middle',
        '-middle-row',
        '-last',
        '-last-row',
        '-nickname',
        '-nickname-row',
        '-id',
        '-id-row',
        '-homepage-list',
        '-homepage-add',
        '-email-list',
        '-email-add',
      ]
        .map((suffix) => `${prefix}${suffix}`)
        .sort();
    await expect(page.getByTestId('description-author-add')).toBeVisible();
    expect(await idsUnder('description-author-0')).toEqual(personRowIds('description-author-0'));
    await page.getByTestId('description-author-0-first').fill('Solo');
    await expect(page.getByTestId('description-author-0-incomplete')).toBeVisible();
    expect(await idsUnder('description-author-0')).toEqual(
      [...personRowIds('description-author-0'), 'description-author-0-incomplete'].sort(),
    );
    await page.getByTestId('description-author-0-homepage-add').click();
    await expect(page.getByTestId('description-author-0-homepage-0')).toBeVisible();
    await expect(page.getByTestId('description-author-0-homepage-0-remove')).toBeVisible();
    await page.getByTestId('description-author-0-email-add').click();
    await expect(page.getByTestId('description-author-0-email-0')).toBeVisible();
    // The Translators list: its twin.
    await expect(page.getByTestId('description-translator-0')).toHaveCount(0);
    await page.getByTestId('description-translator-add').click();
    expect(await idsUnder('description-translator-0')).toEqual(
      personRowIds('description-translator-0'),
    );
    await page.getByTestId('description-translator-0-first').fill('Solo');
    await expect(page.getByTestId('description-translator-0-incomplete')).toBeVisible();
    await page.getByTestId('description-translator-0-remove').click();
    await expect(page.getByTestId('description-translator-0')).toHaveCount(0);

    // No control of the Description view moves a person up or down.
    await page.getByTestId('description-role-add').click();
    await expect(page.getByTestId('description-role-0-role')).toBeVisible();
    await expect(view.locator('[data-testid$="-up"], [data-testid$="-down"]')).toHaveCount(0);
    expect(await idsUnder('description-role-0')).toEqual(
      [
        'description-role-0',
        'description-role-0-role',
        'description-role-0-role-row',
        'description-role-0-last',
        'description-role-0-last-row',
        'description-role-0-first',
        'description-role-0-first-row',
        'description-role-0-middle',
        'description-role-0-middle-row',
        'description-role-0-remove',
      ].sort(),
    );
    await page.getByTestId('description-role-0-remove').click();
    await expect(page.getByTestId('description-role-0')).toHaveCount(0);
  });
});
