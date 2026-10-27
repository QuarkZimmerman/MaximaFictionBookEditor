/**
 * Feature 006, User Story 10 - Tables in the description's annotation and history fields (T154,
 * T155; spec FR-044, FR-045, FR-048, FR-011, FR-015, FR-024, FR-025, FR-042's scope, FR-043,
 * FR-057, FR-059; US10 sc.1 to sc.4; SC-007, SC-009, SC-011; decision 6; C2, C5, C6, C28, C30,
 * C34, C48, C49; U9, U14, U17, U22; data-model §5.5, §6.1 to §6.4, §8.1, §9.3, §9.5, §9.7,
 * §10.1; quickstart §10 manual steps 1 to 7 and "Automated"; research R2 items 3, 5 and 12).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` (T012) through a queued
 * `dialog.openFile` and shows the Description view, whose three rich fields - the book
 * annotation (`description-annotation`), the source book's annotation
 * (`description-sti-annotation`) and the history (`description-history`) - each hold a paragraph,
 * a regular 2 × 3 table `r1c1` … `r2c3` and an irregular vector case. A field's table is found
 * by the `data-node-id` of its `body-table`, read from the model (`__mfbeTest.scripts.document()`,
 * whose description every field change updates at once); where the caret or the block of a field
 * is, and which field is the active table target, the tables' test hook says
 * (`__mfbeTest.tables.target()`). After every step that changes the document, Edit → Undo gives
 * back the field's element of `__mfbeTest.scripts.toXml()` byte for byte and Edit → Redo the
 * step's result, through the Description view's undo (SC-007, U22). Restore position is off, so
 * no reopened book puts a remembered caret back, and the AI panel is hidden for the page load.
 *
 * Tests, each in the three fields unless named:
 *  T154 - sc.1 and C28: the field menu offers *Table…* after Undo, Cut, Copy and Paste; *Table…*
 *         inserts a table after the paragraph; a right-click in a cell moves the caret there and
 *         adds *Inline image…* and *Table structure*, whose *Insert row below* acts on the field's
 *         table; the plain field `description-book-title` keeps its four entries;
 *       - C30: the Add menu follows the field - *Table*, *Table structure* and *Inline image* by
 *         the caret's place, the block-image entries refused in a cell; a plain field gives
 *         `noTarget.insert`;
 *       - sc.2: the Table bar follows the focused field and edits its table, staying bound while
 *         its own input has the focus;
 *       - C6: a chord assigned to *Insert row below* acts in a field's cell, nowhere else;
 *       - sc.3: pictures by paste, drop and *Inline image…* go into a cell, one undo step each; a
 *         picture pasted into the paragraph inserts nothing and uploads nothing.
 *  T155 - sc.4: *Insert row below*, *Merge cells* over a dragged block, *Split cell* and *Toggle
 *         header row* through the field menu, one Undo and one Redo each; typing, a command and
 *         typing are three undo entries (I8);
 *       - Tab and Shift+Tab (FR-005; U14; C34): cell by cell, a new row from the last cell as an
 *         undo step of its own, out of the field from the first cell;
 *       - U17 (the history): the FR-015 question over a linked cell; No records nothing;
 *       - C49 and U9 (the history): Copy and Cut of a block by the field's own selection; the
 *         copied block pasted into the Body view's paste target and into the field's table;
 *       - pastes (the history; decision 6): a table from another program, the copied block,
 *         Edit → Paste and the field menu's *Paste* of `calc.html` - one undo step each;
 *       - C48 (the book annotation): a pasted paragraph brings no language, id or style;
 *       - FR-057 and SC-011: the marks of the three fields; the book annotation's popover,
 *         *Repair table* and Undo, Escape and an outside mousedown, and the run lock.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import {
  ensureAssistantOn,
  expect,
  fixtureBook,
  test,
  waitForBook,
  type CoreHandle,
} from './fixtures/core';
import { pageText, uiText } from './fixtures/i18n';
import { LINE_END } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* The model JSON and the page's hooks                                      */
/* ------------------------------------------------------------------------ */

interface Json {
  type: string;
  attrs?: Record<string, unknown> & { nodeId?: string; id?: string };
  content?: Json[];
  text?: string;
}

interface DocJson {
  docId: string;
  bodies: Json[];
  description: {
    titleInfo: { annotation?: Json };
    srcTitleInfo?: { annotation?: Json };
    documentInfo: { history?: Json };
  };
}

interface GridSummary {
  rows: number;
  columns: number;
  shortRows: number;
  overlaps: number;
  pastEnd: number;
}

/** The active table edit target as the tables' test hook describes it (`tables.target()`). */
interface TargetInfo {
  kind: 'body' | 'description';
  key: string;
  editable: boolean;
  selection: {
    type: 'text' | 'node' | 'cells' | 'all';
    empty: boolean;
    head: string | null;
    headOffset: number;
    anchor: string | null;
    anchorOffset: number;
    cells: string[];
    node: string | null;
  };
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      list(): { id: string }[];
      run(id: string): Promise<{ status: string }>;
    };
    tables?: { grid(tableRef: string): GridSummary | null; target(): TargetInfo | null };
  };
};

/* ------------------------------------------------------------------------ */
/* The fields                                                               */
/* ------------------------------------------------------------------------ */

interface FieldSpec {
  label: string;
  /** The field's ProseMirror DOM (`RichField`'s `view.dom`). */
  testId: string;
  /** The form path and the key of its table edit target (data-model §6.1). */
  key: 'titleInfo.annotation' | 'srcTitleInfo.annotation' | 'documentInfo.history';
  /** The description element that holds the field's element, and that element. */
  parent: 'title-info' | 'src-title-info' | 'document-info';
  element: 'annotation' | 'history';
}

const FIELDS: readonly FieldSpec[] = [
  {
    label: 'the book annotation',
    testId: 'description-annotation',
    key: 'titleInfo.annotation',
    parent: 'title-info',
    element: 'annotation',
  },
  {
    label: 'the source book’s annotation',
    testId: 'description-sti-annotation',
    key: 'srcTitleInfo.annotation',
    parent: 'src-title-info',
    element: 'annotation',
  },
  {
    label: 'the history',
    testId: 'description-history',
    key: 'documentInfo.history',
    parent: 'document-info',
    element: 'history',
  },
];

const ANNOTATION = FIELDS[0]!;
const HISTORY = FIELDS[2]!;

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TABLES = fixtureBook('tables.fb2');
const IMAGES_DIR = path.resolve(path.dirname(fixtureBook('x')), '..', 'images');
const CLIPBOARD_DIR = path.resolve(path.dirname(fixtureBook('x')), '..', 'clipboard');
/** The Body view's user story 4 paste target in `tables.fb2` (T014): a 3 × 3 table after it. */
const PASTE_TARGET = 'US4 sc.6, sc.8 (the paste target)';

/** A chord no command uses anywhere (C6). */
const FREE_CHORD = 'Control+Alt+Shift+F9';

function fieldModel(doc: DocJson, field: FieldSpec): Json {
  const found =
    field.key === 'titleInfo.annotation'
      ? doc.description.titleInfo.annotation
      : field.key === 'srcTitleInfo.annotation'
        ? doc.description.srcTitleInfo?.annotation
        : doc.description.documentInfo.history;
  if (!found) throw new Error(`no ${field.key} in the model`);
  return found;
}

function textOf(node: Json): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'text' ? (child.text ?? '') : textOf(child)))
    .join('');
}

function tablesOf(node: Json): Json[] {
  return (node.content ?? []).filter((child) => child.type === 'table');
}

function cellRows(table: Json): Json[][] {
  return (table.content ?? [])
    .filter((row) => row.type === 'tr')
    .map((row) => (row.content ?? []).filter((cell) => cell.type === 'td' || cell.type === 'th'));
}

function idOf(node: Json): string {
  const id = node.attrs?.nodeId;
  if (typeof id !== 'string') throw new Error(`a ${node.type} without a node id`);
  return id;
}

/** The node id of the cell of `table` whose text is `text`. */
function cellId(table: Json, text: string): string {
  for (const row of cellRows(table)) {
    for (const cell of row) if (textOf(cell) === text) return idOf(cell);
  }
  throw new Error(`no cell "${text}"`);
}

/** The field's element (`<annotation>` or `<history>`) cut out of the document's FB2 text. */
function fieldXmlOf(xml: string, field: FieldSpec): string {
  const parent = xml.indexOf(`<${field.parent}>`);
  expect(parent, `<${field.parent}> in the XML`).toBeGreaterThanOrEqual(0);
  const from = xml.indexOf(`<${field.element}`, parent);
  const end = `</${field.element}>`;
  const to = xml.indexOf(end, from);
  expect(from, `<${field.element}> in <${field.parent}>`).toBeGreaterThan(parent);
  return xml.slice(from, to + end.length);
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

function documentOf(page: Page): Promise<DocJson> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document());
}

function toXml(page: Page): Promise<string> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
}

async function fieldXml(page: Page, field: FieldSpec): Promise<string> {
  return fieldXmlOf(await toXml(page), field);
}

function targetOf(page: Page): Promise<TargetInfo | null> {
  return page.evaluate(() => window.__mfbeTest!.tables!.target());
}

function gridOf(page: Page, ref: string): Promise<GridSummary | null> {
  return page.evaluate((id) => window.__mfbeTest!.tables!.grid(id), ref);
}

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Escape until the popup `popup` is gone (a submenu first, then its menu). */
async function closeMenus(page: Page, popup: string): Promise<void> {
  await expect(async () => {
    if ((await page.getByTestId(popup).count()) > 0) await page.keyboard.press('Escape');
    expect(await page.getByTestId(popup).count()).toBe(0);
  }).toPass({ timeout: 5_000 });
}

/** Two animation frames: the page has painted what the last step changed. */
async function painted(page: Page): Promise<void> {
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

/** `tables.fb2` (or `file`) opened through File → Open, then View → Description. */
async function openBook(core: CoreHandle, page: Page, file = TABLES): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof window.__mfbeTest?.scripts?.document === 'function' &&
          typeof window.__mfbeTest?.tables?.target === 'function',
      ),
    )
    .toBe(true);
  await showDescription(page);
}

async function showDescription(page: Page): Promise<void> {
  await page.getByTestId('view-description').click();
  await expect(page.getByTestId('description-view')).toBeVisible();
  await expect(page.getByTestId(ANNOTATION.testId)).toHaveAttribute('contenteditable', 'true');
}

/** The field's ProseMirror DOM. */
function fieldOf(page: Page, field: FieldSpec): Locator {
  return page.getByTestId(field.testId);
}

/** A cell of the field by its node id. */
function cellOf(page: Page, field: FieldSpec, nodeId: string): Locator {
  return fieldOf(page, field).locator(`:is(td, th)[data-node-id="${nodeId}"]`);
}

/** The `body-table` of the field with this node id. */
function tableOf(page: Page, field: FieldSpec, nodeId: string): Locator {
  return fieldOf(page, field).locator(`[data-testid="body-table"][data-node-id="${nodeId}"]`);
}

/** The field's model, its regular 2 × 3 table and its first paragraph, as they are now. */
async function fieldParts(page: Page, field: FieldSpec) {
  const model = fieldModel(await documentOf(page), field);
  const [regular, irregular] = tablesOf(model);
  const paragraph = (model.content ?? []).find((child) => child.type === 'p')!;
  return { model, regular: regular!, irregular: irregular!, paragraph };
}

/** Waits until the active target is this field with its head in `nodeId` (at `offset`). */
async function expectHead(
  page: Page,
  field: FieldSpec,
  nodeId: string,
  offset?: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const target = await targetOf(page);
      if (!target || target.kind !== 'description' || target.key !== field.key) return null;
      if (offset !== undefined && target.selection.headOffset !== offset) return null;
      return target.selection.head;
    }, `the caret of ${field.key} in ${nodeId}`)
    .toBe(nodeId);
}

/** A click on a cell's text end: the caret there, the field the active target - never repeated. */
async function clickEnd(page: Page, field: FieldSpec, nodeId: string): Promise<void> {
  const element = cellOf(page, field, nodeId);
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await element.click({ position: { x: box.width - 3, y: box.height / 2 } });
  await page.keyboard.press(LINE_END);
  await expectHead(page, field, nodeId);
}

/** The caret at the end of the field's first paragraph (a click on its last line, then End). */
async function paragraphEnd(page: Page, field: FieldSpec): Promise<void> {
  const { paragraph } = await fieldParts(page, field);
  const element = fieldOf(page, field).locator(`p[data-node-id="${idOf(paragraph)}"]`);
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await element.click({ position: { x: box.width - 4, y: box.height - 6 } });
  await page.keyboard.press(LINE_END);
  await expectHead(page, field, idOf(paragraph), textOf(paragraph).length);
}

/**
 * Right-clicks `target` (at `position` in it) once it is in view and the scroll that brought it
 * there has reached the page: the context menu closes on any scroll (`PopupMenu`, U13).
 */
async function rightClick(
  page: Page,
  target: Locator,
  position?: { x: number; y: number },
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await painted(page);
  await target.click({ button: 'right', position });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}

/** Right-clicks a field cell near its right edge: past its text, so a caret goes to its end. */
async function rightClickEnd(page: Page, field: FieldSpec, nodeId: string): Promise<void> {
  const element = cellOf(page, field, nodeId);
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await rightClick(page, element, { x: box.width - 3, y: box.height / 2 });
}

/** Right-clicks just right of the end of the text of the field's first paragraph. */
async function rightClickParagraphEnd(page: Page, field: FieldSpec): Promise<void> {
  const { paragraph } = await fieldParts(page, field);
  const element = fieldOf(page, field).locator(`p[data-node-id="${idOf(paragraph)}"]`);
  await element.scrollIntoViewIfNeeded();
  await painted(page);
  const point = await page.evaluate<{ x: number; y: number } | null>(`(() => {
    const p = document.querySelector('[data-testid="${field.testId}"] p[data-node-id="${idOf(paragraph)}"]');
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.length) last = node;
    if (!last) return null;
    const range = document.createRange();
    range.setStart(last, last.data.length - 1);
    range.setEnd(last, last.data.length);
    const rect = range.getBoundingClientRect();
    const box = p.getBoundingClientRect();
    return { x: rect.right + 2 - box.left, y: rect.top + rect.height / 2 - box.top };
  })()`);
  if (!point) throw new Error(`no text in the paragraph of ${field.key}`);
  await rightClick(page, element, point);
}

/** The context menu's own children: entry test ids, `|` for a separator. */
function topLevel(page: Page): Promise<string[]> {
  return page.evaluate<
    string[]
  >(`[...document.querySelector('[data-testid="context-menu"]').children]
    .map((child) => child.getAttribute('role') === 'separator' ? '|' : (child.getAttribute('data-testid') ?? '?'))`);
}

/** Runs `name` of the context menu's *Table structure* submenu. */
async function contextStructure(page: Page, name: string): Promise<void> {
  const entry = page.getByTestId('context-menu-tableStructure');
  await entry.hover();
  await expect(page.getByTestId('context-menu-tableStructure-popup')).toBeVisible();
  const command = page.getByTestId(`context-menu-tableStructure-${name}`);
  await expect(command).not.toHaveAttribute('aria-disabled', 'true');
  await command.click();
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
}

/** The field's XML once the document changed from `before`. */
async function changedField(page: Page, field: FieldSpec, before: string): Promise<string> {
  await expect
    .poll(() => fieldXml(page, field), { message: `the step changed ${field.key}` })
    .not.toBe(before);
  return fieldXml(page, field);
}

/**
 * Edit → Undo gives back `before`, the field's XML, byte for byte, and Edit → Redo the step's
 * result `after`, through the Description view's undo (SC-007, U22).
 */
async function undoRedo(page: Page, field: FieldSpec, before: string, after: string) {
  await menu(page, 'edit', 'undo');
  await expect
    .poll(() => fieldXml(page, field), { message: 'one Undo restores the field' })
    .toBe(before);
  await menu(page, 'edit', 'redo');
  await expect
    .poll(() => fieldXml(page, field), { message: 'one Redo applies it again' })
    .toBe(after);
}

/** "<Command>: <reason>" as a disabled entry's title (FR-043; `commands.unavailable.title`). */
async function unavailableTitle(page: Page, tooltipKey: string, reasonKey: string) {
  return pageText(page, 'commands.unavailable.title', {
    command: await pageText(page, tooltipKey),
    reason: await pageText(page, reasonKey),
  });
}

/* ------------------------------------------------------------------------ */
/* Pictures (the patterns of us7-images.spec.ts and us3-table-images.spec.ts) */
/* ------------------------------------------------------------------------ */

/**
 * Dispatches a synthetic `paste`, or `dragover` and `drop` at a point inside the element (the
 * right end of its first line), carrying the files in the given order.
 */
const DISPATCH_FILES = `(args) => {
  const target = document.querySelector(args.selector);
  if (!target) throw new Error('no target ' + args.selector);
  const data = new DataTransfer();
  for (const file of args.files) {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    data.items.add(new File([bytes], file.name, { type: file.type }));
  }
  if (args.kind === 'paste') {
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return;
  }
  const rect = target.getBoundingClientRect();
  const init = {
    dataTransfer: data,
    bubbles: true,
    cancelable: true,
    clientX: rect.right - 8,
    clientY: rect.top + Math.min(rect.height / 2, 10),
  };
  target.dispatchEvent(new DragEvent('dragover', init));
  target.dispatchEvent(new DragEvent('drop', init));
}`;

/**
 * The event on the field's element with the node id `nodeId` (a cell or a paragraph), found by
 * a selector: an attribute put on an element ProseMirror drew would be undone by its redraw.
 */
async function dispatchFiles(
  page: Page,
  kind: 'paste' | 'drop',
  field: FieldSpec,
  nodeId: string,
  files: string[],
): Promise<void> {
  const selector = `[data-testid="${field.testId}"] [data-node-id="${nodeId}"]`;
  await page.locator(selector).scrollIntoViewIfNeeded();
  const args = {
    kind,
    selector,
    files: files.map((file) => ({
      base64: readFileSync(file).toString('base64'),
      name: path.basename(file),
      type: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
    })),
  };
  await page.evaluate(`(${DISPATCH_FILES})(${JSON.stringify(args)})`);
}

function hrefsIn(target: Locator): Promise<(string | null)[]> {
  return target
    .locator('[data-testid="body-inline-image"]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element as unknown as { getAttribute(name: string): string | null }).getAttribute(
          'data-href',
        ),
      ),
    );
}

/* ------------------------------------------------------------------------ */
/* T155: blocks, the clipboard, a book of the test's own and the marks       */
/* ------------------------------------------------------------------------ */

/** The field holds the focus again (after a menu), its selection kept. */
async function focusField(page: Page, field: FieldSpec): Promise<void> {
  await fieldOf(page, field).focus();
  await expect(fieldOf(page, field)).toBeFocused();
}

/** A mouse drag in the field from the centre of one cell to the centre of another. */
async function drag(page: Page, field: FieldSpec, from: string, to: string): Promise<void> {
  const start = cellOf(page, field, from);
  await start.scrollIntoViewIfNeeded();
  const a = (await start.boundingBox())!;
  const b = (await cellOf(page, field, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

/** The block of the field from `from` to `to`: a click on `from`'s end and a Shift+click on `to`. */
async function shiftBlock(page: Page, field: FieldSpec, from: string, to: string): Promise<void> {
  await clickEnd(page, field, from);
  await cellOf(page, field, to).click({ modifiers: ['Shift'] });
  await expect(cellOf(page, field, to)).toHaveClass(/\bmfbe-cell-selected\b/);
}

/** The node ids of the field's cells that carry the block's highlight, sorted. */
async function selectedCells(page: Page, field: FieldSpec): Promise<string[]> {
  const ids = await fieldOf(page, field)
    .locator('.mfbe-cell-selected')
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element as unknown as { getAttribute(name: string): string | null }).getAttribute(
          'data-node-id',
        ),
      ),
    );
  return ids.map((id) => id ?? '?').sort();
}

/** A synthetic paste event on the field carrying these flavours. */
async function pasteInto(
  page: Page,
  field: FieldSpec,
  flavours: { html?: string; text?: string },
): Promise<void> {
  const args = { testId: field.testId, html: flavours.html ?? null, text: flavours.text ?? null };
  await page.evaluate(`((args) => {
    const data = new DataTransfer();
    if (args.html !== null) data.setData('text/html', args.html);
    if (args.text !== null) data.setData('text/plain', args.text);
    const target = document.querySelector('[data-testid="' + args.testId + '"]');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })(${JSON.stringify(args)})`);
}

function clipboardHtml(name: string): string {
  return readFileSync(path.join(CLIPBOARD_DIR, `${name}.html`), 'utf8');
}

function clipboardTsv(name: string): string {
  return (
    JSON.parse(readFileSync(path.join(CLIPBOARD_DIR, `${name}.expected.json`), 'utf8')) as {
      tsv: string;
    }
  ).tsv;
}

/** The table right after the paragraph whose text is `label`, anywhere in `trees`. */
function tableAfter(trees: Json[], label: string): Json {
  const visit = (node: Json): Json | null => {
    const children = node.content ?? [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (child.type === 'p' && textOf(child) === label && children[index + 1]?.type === 'table') {
        return children[index + 1]!;
      }
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const tree of trees) {
    const found = visit(tree);
    if (found) return found;
  }
  throw new Error(`no table after "${label}"`);
}

/** The cell texts of a model table, row by row. */
function texts(table: Json): string[][] {
  return cellRows(table).map((row) => row.map(textOf));
}

/** A valid small book whose history holds a 2 × 2 table; the body links to its cell `r1c2`. */
function linkedBook(dir: string): string {
  const file = path.join(dir, 'us10-linked.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Linked history</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>us10-linked-0001</id>
<version>1.0</version>
<history>
<p>The history holds a linked cell.</p>
<table><tr><td>r1c1</td><td id="u10-target">r1c2</td></tr><tr><td>r2c1</td><td>r2c2</td></tr></table>
</history>
</document-info>
</description>
<body>
<section><p>See <a l:href="#u10-target">the history's cell</a>.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

/* The irregular-table marks' texts, from the shared vectors (us8-table-marks.spec.ts). */

interface Params {
  rows: number;
  columns: number;
  shortRows: number;
  row?: number;
  covered?: number;
  overlaps: number;
  pastEnd: number;
  id?: string;
}

const vectors = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'tables', 'grid-vectors.json'), 'utf8'),
) as { cases: { name: string; expect: { params: Params } }[] };

function params(name: string): Params {
  const found = vectors.cases.find((one) => one.name === name);
  if (!found) throw new Error(`no vector case ${name}`);
  return found.expect.params;
}

/** The irregular vector case of each field of `tables.fb2` (T012). */
const FIELD_CASES: Record<FieldSpec['key'], string> = {
  'titleInfo.annotation': 'overlap-from-two-rows-above',
  'srcTitleInfo.annotation': 'plural-forms',
  'documentInfo.history': 'three-problems',
};

function problemParts(p: Params): string[] {
  const parts: string[] = [];
  if (p.shortRows === 1) {
    parts.push(
      uiText('en', 'tables.problem.shortRow', {
        row: p.row!,
        covered: p.covered!,
        columns: p.columns,
        count: p.columns,
      }),
    );
  } else if (p.shortRows >= 2) {
    parts.push(
      uiText('en', 'tables.problem.shortRows', { count: p.shortRows, columns: p.columns }),
    );
  }
  if (p.overlaps >= 1) parts.push(uiText('en', 'tables.problem.overlaps', { count: p.overlaps }));
  if (p.pastEnd >= 1) parts.push(uiText('en', 'tables.problem.pastEnd', { count: p.pastEnd }));
  return parts;
}

/** The mark's tooltip: the problems with a capital first letter, then the repair hint. */
function markTooltip(p: Params): string {
  const problems = problemParts(p).join(uiText('en', 'tables.problem.separator'));
  return `${problems.charAt(0).toLocaleUpperCase('en')}${problems.slice(1)}. ${uiText('en', 'tables.mark.repairHint')}`;
}

/** The active target's selection, for comparisons. */
async function selectionOf(page: Page): Promise<TargetInfo['selection'] | null> {
  return (await targetOf(page))?.selection ?? null;
}

/* ------------------------------------------------------------------------ */
/* T154: menus, the Table bar, a scoped hotkey and pictures                  */
/* ------------------------------------------------------------------------ */

test.describe('US10 (feature 006) - tables in the annotation and history fields', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us10-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core, context }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // Before the page loads: the AI panel hidden, so the Description view has its full width;
    // Restore position off - an open would put a remembered caret back after the journey placed
    // its own -; the Table dialog's defaults (2 × 2, no header row or column).
    await core.rpc('settings.set', {
      patch: {
        session: { aiPanelVisible: false, tableDialog: null },
        other: { restorePosition: false },
      },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', {
        patch: {
          session: { aiPanelVisible: null, tableDialog: null },
          other: { restorePosition: null },
          ai: null,
        },
      })
      .catch(() => {});
  });

  for (const field of FIELDS) {
    test(`sc.1 and C28 in ${field.label}: Table… after Undo, Cut, Copy and Paste inserts a table after the paragraph; a right-click in a cell takes the caret there and adds Inline image… and Table structure, whose Insert row below acts on the field’s table; one undo step each`, async ({
      core,
      page,
    }) => {
      test.setTimeout(120_000);
      await openBook(core, page);
      const { regular, paragraph } = await fieldParts(page, field);
      const regularRef = idOf(regular);

      // The menu at the end of the paragraph: today's four entries, then Table… alone.
      await paragraphEnd(page, field);
      await rightClickParagraphEnd(page, field);
      expect(await topLevel(page)).toEqual([
        'context-menu-edit.undo',
        '|',
        'context-menu-edit.cut',
        'context-menu-edit.copy',
        'context-menu-edit.paste',
      ]);
      await expect(page.getByTestId('context-menu-insert.inlineImage')).toHaveCount(0);
      await expect(page.getByTestId('context-menu-tableStructure')).toHaveCount(0);
      // Issue #8: no Table… in the field's context menu; the table comes from Add → Table.
      await expect(page.getByTestId('context-menu-insert.table')).toHaveCount(0);
      await page.keyboard.press('Escape');

      // Table… → the dialog → OK: a 2 × 2 table right after the paragraph (FR-004 (a)), the
      // caret in its first cell, one undo step.
      const before = await fieldXml(page, field);
      await page.getByTestId('menu-add').click();
      await page.getByTestId('menu-add-table').click();
      await expect(page.getByTestId('dialog-table')).toBeVisible();
      await page.getByTestId('dialog-table-button-ok').click();
      await expect(page.getByTestId('dialog-table')).toHaveCount(0);
      const after = await changedField(page, field, before);
      const model = fieldModel(await documentOf(page), field);
      const index = (model.content ?? []).findIndex(
        (child) => child.attrs?.nodeId === idOf(paragraph),
      );
      const inserted = model.content![index + 1]!;
      expect(inserted.type).toBe('table');
      expect(cellRows(inserted).map((row) => row.length)).toEqual([2, 2]);
      expect(model.content![index + 2]!.attrs?.nodeId).toBe(regularRef);
      await expectHead(page, field, idOf(cellRows(inserted)[0]![0]!));
      await undoRedo(page, field, before, after);

      // With the caret in the paragraph, a right-click in a cell of the 2 × 3 table puts the
      // caret into that cell (C28); the menu adds Inline image… and Table structure.
      await paragraphEnd(page, field);
      const r1c2 = cellId(regular, 'r1c2');
      await rightClickEnd(page, field, r1c2);
      await expectHead(page, field, r1c2);
      expect(await topLevel(page)).toEqual([
        'context-menu-edit.undo',
        '|',
        'context-menu-edit.cut',
        'context-menu-edit.copy',
        'context-menu-edit.paste',
        '|',
        'context-menu-insert.inlineImage',
        '|',
        'context-menu-tableStructure',
      ]);
      await expect(page.getByTestId('context-menu-insert.inlineImage')).toHaveText(
        await pageText(page, 'tables.contextMenu.inlineImage'),
      );
      // Table structure → Insert row below: the field's table gains a third row, one step.
      const beforeRow = await fieldXml(page, field);
      await contextStructure(page, 'insertRowBelow');
      const afterRow = await changedField(page, field, beforeRow);
      expect(await gridOf(page, regularRef)).toMatchObject({ rows: 3, columns: 3, shortRows: 0 });
      await expect(tableOf(page, field, regularRef).locator('tr')).toHaveCount(3);
      await undoRedo(page, field, beforeRow, afterRow);

      // The plain field keeps exactly its four entries (feature 002 FR-064).
      await rightClick(page, page.getByTestId('description-book-title'));
      expect(await topLevel(page)).toEqual([
        'context-menu-edit.undo',
        '|',
        'context-menu-edit.cut',
        'context-menu-edit.copy',
        'context-menu-edit.paste',
      ]);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('context-menu')).toHaveCount(0);
    });

    test(`C30 in ${field.label}: the Add menu follows the field - Table, Table structure and Inline image by the caret’s place; a plain field leaves no target`, async ({
      core,
      page,
    }) => {
      test.setTimeout(120_000);
      await openBook(core, page);
      const { regular } = await fieldParts(page, field);
      const regularRef = idOf(regular);

      // The caret in the field's paragraph: Table on, the table commands off with notInTable,
      // Inline image off.
      await paragraphEnd(page, field);
      await page.getByTestId('menu-add').click();
      await expect(page.getByTestId('menu-add-table')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('menu-add-inlineImage')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      // Table structure lives in the Edit menu (issue #6).
      await page.keyboard.press('Escape');
      await page.getByTestId('menu-edit').click();
      // No table command acts in a paragraph: the submenu is disabled with the reason and opens
      // nothing.
      const structure = page.getByTestId('menu-edit-tableStructure');
      await expect(structure).toHaveAttribute('aria-disabled', 'true');
      await expect(structure).toHaveAttribute(
        'title',
        await pageText(page, 'tables.reason.notInTable'),
      );
      await structure.hover();
      await expect(page.getByTestId('menu-edit-tableStructure-popup')).toHaveCount(0);
      await closeMenus(page, 'menu-edit-popup');

      // The caret in a cell: the table commands and Inline image act on the field's table; the
      // block pictures say why a cell refuses them.
      await clickEnd(page, field, cellId(regular, 'r2c2'));
      await page.getByTestId('menu-add').click();
      await expect(page.getByTestId('menu-add-inlineImage')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
      for (const [item, tooltip] of [
        ['image', 'cmd.insert.image.tooltip'],
        ['sectionImage', 'cmd.insert.sectionImage.tooltip'],
      ] as const) {
        const entry = page.getByTestId(`menu-add-${item}`);
        await expect(entry, item).toHaveAttribute('aria-disabled', 'true');
        await expect(entry, item).toHaveAttribute(
          'title',
          await unavailableTitle(page, tooltip, 'tables.reason.cellInlineOnly'),
        );
      }
      // Table structure lives in the Edit menu (issue #6).
      await page.keyboard.press('Escape');
      await page.getByTestId('menu-edit').click();
      await page.getByTestId('menu-edit-tableStructure').hover();
      await expect(page.getByTestId('menu-edit-tableStructure-popup')).toBeVisible();
      const insertRow = page.getByTestId('menu-edit-tableStructure-insertRowBelow');
      await expect(insertRow).not.toHaveAttribute('aria-disabled', 'true');
      const before = await fieldXml(page, field);
      await insertRow.click();
      const after = await changedField(page, field, before);
      expect(await gridOf(page, regularRef)).toMatchObject({ rows: 3, columns: 3, shortRows: 0 });
      await undoRedo(page, field, before, after);

      // The focus in a plain field: no target, Table says where to put the caret.
      await page.getByTestId('description-book-title').click();
      await expect.poll(() => targetOf(page)).toBeNull();
      await page.getByTestId('menu-add').click();
      const table = page.getByTestId('menu-add-table');
      await expect(table).toHaveAttribute('aria-disabled', 'true');
      await expect(table).toHaveAttribute(
        'title',
        await unavailableTitle(page, 'cmd.insert.table.tooltip', 'tables.reason.noTarget.insert'),
      );
      await closeMenus(page, 'menu-add-popup');
    });

    test(`sc.2 in ${field.label}: the Table bar shows and edits the field’s table, bound while its own input has the focus`, async ({
      core,
      page,
    }) => {
      test.setTimeout(120_000);
      await openBook(core, page);
      const { regular } = await fieldParts(page, field);
      const regularRef = idOf(regular);
      const r1c1 = cellId(regular, 'r1c1');
      const bar = page.getByTestId('tablebar');

      await clickEnd(page, field, r1c1);
      await expect(bar).toHaveAttribute('data-in-table', 'true');
      // td align: right on that cell, one step.
      let before = await fieldXml(page, field);
      await page.getByTestId('table-bar-td-align').selectOption('right');
      await expect(cellOf(page, field, r1c1)).toHaveAttribute('align', 'right');
      let after = await changedField(page, field, before);
      expect(after).toContain('<td align="right">r1c1</td>');
      await undoRedo(page, field, before, after);

      // Table ID: t9 + Enter, the bar bound while its input has the focus.
      await clickEnd(page, field, r1c1);
      await page.getByTestId('table-bar-table-id').click();
      await expect(bar).toHaveAttribute('data-in-table', 'true');
      await expect.poll(async () => (await targetOf(page))?.key).toBe(field.key);
      before = await fieldXml(page, field);
      await page.getByTestId('table-bar-table-id').fill('t9');
      await page.getByTestId('table-bar-table-id').press('Enter');
      await expect(tableOf(page, field, regularRef)).toHaveAttribute('data-id', 't9');
      after = await changedField(page, field, before);
      expect(after).toContain('<table id="t9">');
      await undoRedo(page, field, before, after);

      // The focus in a plain field: the bar has nothing to show.
      await clickEnd(page, field, r1c1);
      await expect(bar).toHaveAttribute('data-in-table', 'true');
      await page.getByTestId('description-book-title').click();
      await expect(bar).toHaveAttribute('data-in-table', 'false');
    });

    test(`C6 in ${field.label}: a chord assigned to Insert row below adds a row in a field cell, and nothing in the paragraph or a plain field`, async ({
      core,
      page,
    }) => {
      test.setTimeout(120_000);
      // hotkeys.json lives in the worker's shared core: given back in `finally`.
      const bindings = await core.rpc<unknown[]>('hotkeys.get');
      try {
        await openBook(core, page);
        await menu(page, 'tools', 'settings');
        await expect(page.getByTestId('dialog-settings')).toBeVisible();
        await page.getByTestId('settings-tab-hotkeys').click();
        await expect(page.getByTestId('settings-page-hotkeys')).toBeVisible();
        await page.getByTestId('settings-hotkeys-group-table').click();
        await page.getByTestId('settings-hotkeys-command-table.insertRowBelow').click();
        const capture = page.getByTestId('settings-hotkeys-capture');
        await capture.focus();
        await page.keyboard.press(FREE_CHORD);
        await expect(page.getByTestId('settings-hotkeys-assign')).toBeEnabled();
        await page.getByTestId('settings-hotkeys-assign').click();
        await page.getByTestId('dialog-settings-button-ok').click();
        await expect(page.getByTestId('dialog-settings')).toHaveCount(0);

        const { regular } = await fieldParts(page, field);
        const regularRef = idOf(regular);
        // In a field cell: a row below, one undo step.
        await clickEnd(page, field, cellId(regular, 'r1c3'));
        const before = await fieldXml(page, field);
        await page.keyboard.press(FREE_CHORD);
        const after = await changedField(page, field, before);
        expect(await gridOf(page, regularRef)).toMatchObject({ rows: 3, columns: 3 });
        await undoRedo(page, field, before, after);

        // In the field's paragraph and in a plain field: nothing changes.
        await paragraphEnd(page, field);
        const unchanged = await toXml(page);
        await page.keyboard.press(FREE_CHORD);
        await page.getByTestId('description-book-title').click();
        await page.keyboard.press(FREE_CHORD);
        await painted(page);
        expect(await toXml(page)).toBe(unchanged);
        expect(await gridOf(page, regularRef)).toMatchObject({ rows: 3 });
      } finally {
        await core.rpc('hotkeys.set', { bindings });
      }
    });

    test(`sc.3 in ${field.label}: a pasted picture, two dropped ones and Inline image… go into the cells, one undo step each; a picture pasted into the paragraph inserts nothing`, async ({
      core,
      page,
    }) => {
      test.setTimeout(180_000);
      // The prompt on, answered No (the worker's shared core may have it off).
      await core.rpc('settings.set', {
        patch: { other: { askOnNonClearImage: true, insertClearImages: false } },
      });
      await openBook(core, page);
      const { regular } = await fieldParts(page, field);
      const uploads: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().includes('/binary/')) {
          uploads.push(request.url());
        }
      });

      // A PNG pasted with the caret in a cell: an inline image at the caret.
      const r1c1 = cellId(regular, 'r1c1');
      await clickEnd(page, field, r1c1);
      let before = await fieldXml(page, field);
      await dispatchFiles(page, 'paste', field, r1c1, [path.join(IMAGES_DIR, 'tiny.png')]);
      await expect(cellOf(page, field, r1c1).getByTestId('body-inline-image')).toHaveCount(1);
      let after = await changedField(page, field, before);
      expect(after).toContain('<td>r1c1<image l:href="#tiny.png"/></td>');
      await undoRedo(page, field, before, after);

      // Two PNGs dropped on a cell: both, in their order, each one undo step.
      const r1c2 = cellId(regular, 'r1c2');
      before = await fieldXml(page, field);
      await dispatchFiles(page, 'drop', field, r1c2, [
        path.join(IMAGES_DIR, 'opaque-rgb.png'),
        path.join(IMAGES_DIR, 'alpha.png'),
      ]);
      await expect(cellOf(page, field, r1c2).getByTestId('body-inline-image')).toHaveCount(2);
      expect(await hrefsIn(cellOf(page, field, r1c2))).toEqual(['#opaque-rgb.png', '#alpha.png']);
      await expect.poll(() => fieldXml(page, field)).toContain('#alpha.png');
      after = await fieldXml(page, field);
      expect(after).toContain(
        '<td>r1c2<image l:href="#opaque-rgb.png"/><image l:href="#alpha.png"/></td>',
      );
      // Two insertions, two undo steps: the second picture goes first.
      await menu(page, 'edit', 'undo');
      await expect.poll(() => fieldXml(page, field)).not.toContain('#alpha.png');
      expect(await fieldXml(page, field)).toContain('#opaque-rgb.png');
      await menu(page, 'edit', 'undo');
      await expect.poll(() => fieldXml(page, field)).toBe(before);
      await menu(page, 'edit', 'redo');
      await menu(page, 'edit', 'redo');
      await expect.poll(() => fieldXml(page, field)).toBe(after);

      // Inline image… from the field's menu: the prompt, the file, the picture in the cell.
      const r2c1 = cellId(regular, 'r2c1');
      await rightClickEnd(page, field, r2c1);
      await expectHead(page, field, r2c1);
      before = await fieldXml(page, field);
      await core.enqueueDialog('dialog.openFile', { paths: [path.join(IMAGES_DIR, 'tiny.jpg')] });
      await page.getByTestId('context-menu-insert.inlineImage').click();
      await expect(page.getByTestId('dialog-insert-clear-image')).toBeVisible();
      await page.getByTestId('dialog-insert-clear-image-button-no').click();
      await expect(cellOf(page, field, r2c1).getByTestId('body-inline-image')).toHaveCount(1);
      after = await changedField(page, field, before);
      expect(after).toContain('<td>r2c1<image l:href="#tiny.jpg"/></td>');
      await undoRedo(page, field, before, after);

      // A PNG pasted with the caret in the field's paragraph: nothing inserted, nothing uploaded.
      await paragraphEnd(page, field);
      const count = uploads.length;
      const unchanged = await toXml(page);
      const { paragraph } = await fieldParts(page, field);
      await dispatchFiles(page, 'paste', field, idOf(paragraph), [
        path.join(IMAGES_DIR, 'tiny.png'),
      ]);
      await page.waitForTimeout(500);
      expect(await toXml(page)).toBe(unchanged);
      expect(uploads).toHaveLength(count);
      await expect(
        fieldOf(page, field).locator(
          `p[data-node-id="${idOf(paragraph)}"] [data-testid="body-inline-image"]`,
        ),
      ).toHaveCount(0);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* T155: undo, keyboard, the FR-015 question, the clipboard and the mark   */
  /* ---------------------------------------------------------------------- */

  for (const field of FIELDS) {
    test(`sc.4 in ${field.label}: Insert row below, Merge cells over a dragged block, Split cell and Toggle header row through the field menu, one Undo and one Redo each; typing, a command and typing are three undo entries`, async ({
      core,
      page,
    }) => {
      test.setTimeout(180_000);
      await openBook(core, page);
      const initial = await fieldXml(page, field);
      let { regular } = await fieldParts(page, field);
      const ref = idOf(regular);
      const r1c1 = cellId(regular, 'r1c1');

      // Insert row below.
      await rightClickEnd(page, field, r1c1);
      let before = await fieldXml(page, field);
      await contextStructure(page, 'insertRowBelow');
      let after = await changedField(page, field, before);
      expect(await gridOf(page, ref)).toMatchObject({ rows: 3, columns: 3, shortRows: 0 });
      await undoRedo(page, field, before, after);
      await menu(page, 'edit', 'undo');
      await expect.poll(() => fieldXml(page, field)).toBe(initial);

      // Merge cells over a block dragged from r1c1 to r2c2: exactly those four cells.
      await drag(page, field, r1c1, cellId(regular, 'r2c2'));
      expect(await selectedCells(page, field)).toEqual(
        ['r1c1', 'r1c2', 'r2c1', 'r2c2'].map((text) => cellId(regular, text)).sort(),
      );
      await expect(page.locator('.mfbe-cell-selected')).toHaveCount(4);
      await rightClickEnd(page, field, cellId(regular, 'r2c2'));
      expect(await selectedCells(page, field)).toHaveLength(4);
      before = await fieldXml(page, field);
      await contextStructure(page, 'mergeCells');
      after = await changedField(page, field, before);
      ({ regular } = await fieldParts(page, field));
      const merged = cellRows(regular)[0]![0]!;
      expect(merged.attrs).toMatchObject({ nodeId: r1c1, colspan: 2, rowspan: 2 });
      expect(await gridOf(page, ref)).toMatchObject({ shortRows: 0, overlaps: 0, pastEnd: 0 });
      await undoRedo(page, field, before, after);

      // Split cell on the merged cell.
      await rightClickEnd(page, field, r1c1);
      before = await fieldXml(page, field);
      await contextStructure(page, 'splitCell');
      after = await changedField(page, field, before);
      ({ regular } = await fieldParts(page, field));
      expect(cellRows(regular).map((row) => row.length)).toEqual([3, 3]);
      await undoRedo(page, field, before, after);

      // Toggle header row on the first row.
      await rightClickEnd(page, field, r1c1);
      before = await fieldXml(page, field);
      await contextStructure(page, 'toggleHeaderRow');
      after = await changedField(page, field, before);
      ({ regular } = await fieldParts(page, field));
      expect(cellRows(regular)[0]!.every((cell) => cell.type === 'th')).toBe(true);
      expect(cellRows(regular)[1]!.every((cell) => cell.type === 'td')).toBe(true);
      await undoRedo(page, field, before, after);

      // A word, Insert row above at once, a word again: three undo entries (I8). First back to
      // the field as opened: the merge, the split and the header row, three steps.
      for (let step = 0; step < 3; step += 1) await menu(page, 'edit', 'undo');
      await expect.poll(() => fieldXml(page, field)).toBe(initial);
      ({ regular } = await fieldParts(page, field));
      const r2c3 = cellId(regular, 'r2c3');
      await clickEnd(page, field, r2c3);
      await page.keyboard.type('x');
      await expect.poll(() => fieldXml(page, field)).toContain('<td>r2c3x</td>');
      await rightClickEnd(page, field, r2c3);
      await contextStructure(page, 'insertRowAbove');
      await expect.poll(async () => (await gridOf(page, ref))?.rows).toBe(3);
      // The command left the caret in the new row's cell of that column (as in the Body view).
      await focusField(page, field);
      await page.keyboard.type('y');
      await expect.poll(() => fieldXml(page, field)).toContain('<td>y</td>');
      expect(await fieldXml(page, field)).toContain('<td>r2c3x</td>');
      await menu(page, 'edit', 'undo');
      await expect.poll(() => fieldXml(page, field)).not.toContain('<td>y</td>');
      expect(await fieldXml(page, field)).toContain('<td>r2c3x</td>');
      expect((await gridOf(page, ref))?.rows).toBe(3);
      await menu(page, 'edit', 'undo');
      await expect.poll(async () => (await gridOf(page, ref))?.rows).toBe(2);
      expect(await fieldXml(page, field)).toContain('<td>r2c3x</td>');
      await menu(page, 'edit', 'undo');
      await expect.poll(() => fieldXml(page, field)).toBe(initial);
    });

    test(`Tab and Shift+Tab in ${field.label}: cell by cell, a new row from the last cell as its own undo step, out of the field from the first cell`, async ({
      core,
      page,
    }) => {
      test.setTimeout(120_000);
      await openBook(core, page);
      const { regular } = await fieldParts(page, field);
      const ref = idOf(regular);
      const order = ['r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2', 'r2c3'].map((text) =>
        cellId(regular, text),
      );

      // Tab: the next cell, its content selected.
      await clickEnd(page, field, order[0]!);
      for (const next of order.slice(1)) {
        await page.keyboard.press('Tab');
        await expectHead(page, field, next, 4);
        expect((await selectionOf(page))?.anchorOffset).toBe(0);
      }
      // Tab in the last cell: a row is appended, an undo step of its own.
      const before = await fieldXml(page, field);
      await page.keyboard.press('Tab');
      const after = await changedField(page, field, before);
      expect(await gridOf(page, ref)).toMatchObject({ rows: 3, columns: 3, shortRows: 0 });
      await undoRedo(page, field, before, after);

      // Shift+Tab: back cell by cell; in the table's first cell the focus leaves the field.
      await clickEnd(page, field, order[4]!);
      await page.keyboard.press('Shift+Tab');
      await expectHead(page, field, order[3]!);
      await page.keyboard.press('Shift+Tab');
      await expectHead(page, field, order[2]!);
      await clickEnd(page, field, order[0]!);
      await page.keyboard.press('Shift+Tab');
      await expect(fieldOf(page, field)).not.toBeFocused();
      expect(
        await page.evaluate<boolean>(
          `document.activeElement !== null && document.activeElement.closest('[data-testid="${field.testId}"]') === null`,
        ),
      ).toBe(true);
      expect(await fieldXml(page, field)).toBe(after);
    });
  }

  test('U17 in the history: Merge cells over a linked cell asks the FR-015 question; No changes nothing and records no undo entry', async ({
    core,
    page,
  }) => {
    await openBook(core, page, linkedBook(dir));
    const { regular } = await fieldParts(page, HISTORY);
    const before = await toXml(page);
    await shiftBlock(page, HISTORY, cellId(regular, 'r1c1'), cellId(regular, 'r1c2'));
    await rightClickEnd(page, HISTORY, cellId(regular, 'r1c2'));
    await contextStructure(page, 'mergeCells');
    await expect(page.getByTestId('dialog-table-link-targets')).toBeVisible();
    await page.getByTestId('dialog-table-link-targets-button-no').click();
    await expect(page.getByTestId('dialog-table-link-targets')).toHaveCount(0);
    expect(await toXml(page)).toBe(before);
    await page.getByTestId('menu-edit').click();
    await expect(page.getByTestId('menu-edit-undo')).toHaveAttribute('aria-disabled', 'true');
    await closeMenus(page, 'menu-edit-popup');
  });

  test('C49 and U9 in the history: a block enables Copy and Cut by the field’s own selection; the copied block overwrites the Body view’s paste target by position; Cut empties the four cells, one undo step', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page);
    let { regular } = await fieldParts(page, HISTORY);
    const block = ['r1c1', 'r1c2', 'r2c1', 'r2c2'].map((text) => cellId(regular, text));
    await shiftBlock(page, HISTORY, block[0]!, block[3]!);
    expect(await selectedCells(page, HISTORY)).toEqual([...block].sort());
    expect((await selectionOf(page))?.type).toBe('cells');
    expect(await page.evaluate<boolean>('window.getSelection().isCollapsed')).toBe(true);
    await page.getByTestId('menu-edit').click();
    await expect(page.getByTestId('menu-edit-copy')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('menu-edit-cut')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('menu-edit-copy').click();
    await expect
      .poll(() => page.evaluate<string>('navigator.clipboard.readText()'))
      .toBe('r1c1\tr1c2\nr2c1\tr2c2');

    // Pasted with the caret in r2c2 of the Body view's 3 × 3 paste target: by position.
    await page.getByTestId('view-body').click();
    await expect(page.getByTestId('body-editor')).toBeVisible();
    const doc = await documentOf(page);
    const target = tableAfter(doc.bodies, PASTE_TARGET);
    const targetRef = idOf(target);
    const r2c2 = cellId(target, 'r2c2');
    const placed = await page.evaluate(
      ([id]) =>
        (
          window.__mfbeTest!.scripts as unknown as {
            select(nodeId: string, from?: number, to?: number): boolean;
          }
        ).select(id!, 4, 4),
      [r2c2],
    );
    expect(placed).toBe(true);
    const beforePaste = await toXml(page);
    await menu(page, 'edit', 'paste');
    await expect.poll(() => toXml(page)).not.toBe(beforePaste);
    const pasted = tableAfter((await documentOf(page)).bodies, PASTE_TARGET);
    expect(idOf(pasted)).toBe(targetRef);
    expect(texts(pasted)).toEqual([
      ['r1c1', 'r1c2', 'r1c3'],
      ['r2c1', 'r1c1', 'r1c2'],
      ['r3c1', 'r2c1', 'r2c2'],
    ]);

    // Edit → Cut of the block in the field: the four cells emptied, the table kept, one step.
    await showDescription(page);
    ({ regular } = await fieldParts(page, HISTORY));
    await shiftBlock(page, HISTORY, block[0]!, block[3]!);
    const before = await fieldXml(page, HISTORY);
    await menu(page, 'edit', 'cut');
    const after = await changedField(page, HISTORY, before);
    ({ regular } = await fieldParts(page, HISTORY));
    expect(texts(regular)).toEqual([
      ['', '', 'r1c3'],
      ['', '', 'r2c3'],
    ]);
    await undoRedo(page, HISTORY, before, after);
  });

  test('pastes in the history (decision 6): a table from another program, the copied block, Edit → Paste and the field menu’s Paste of calc.html - each one undo step', async ({
    core,
    page,
  }) => {
    test.setTimeout(150_000);
    await openBook(core, page);
    let parts = await fieldParts(page, HISTORY);
    const ref = idOf(parts.regular);

    // firefox-web.html at the end of the paragraph: its caption, then a regular FB2 table.
    await paragraphEnd(page, HISTORY);
    let before = await fieldXml(page, HISTORY);
    await pasteInto(page, HISTORY, {
      html: clipboardHtml('firefox-web'),
      text: clipboardTsv('firefox-web'),
    });
    let after = await changedField(page, HISTORY, before);
    parts = await fieldParts(page, HISTORY);
    const content = parts.model.content!;
    expect(content.map((node) => node.type).slice(0, 4)).toEqual(['p', 'p', 'table', 'table']);
    expect(textOf(content[1]!)).toBe('Inner planets');
    const foreign = content[2]!;
    expect(cellRows(foreign)).toHaveLength(5);
    expect(await gridOf(page, idOf(foreign))).toMatchObject({
      shortRows: 0,
      overlaps: 0,
      pastEnd: 0,
    });
    expect(content[3]!.attrs?.nodeId).toBe(ref);
    await undoRedo(page, HISTORY, before, after);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => fieldXml(page, HISTORY)).toBe(before);

    // A copied block pasted with the caret in r1c2 of the field's table: by position.
    parts = await fieldParts(page, HISTORY);
    await shiftBlock(page, HISTORY, cellId(parts.regular, 'r1c1'), cellId(parts.regular, 'r2c2'));
    await menu(page, 'edit', 'copy');
    await expect
      .poll(() => page.evaluate<string>('navigator.clipboard.readText()'))
      .toBe('r1c1\tr1c2\nr2c1\tr2c2');
    await clickEnd(page, HISTORY, cellId(parts.regular, 'r1c2'));
    before = await fieldXml(page, HISTORY);
    await menu(page, 'edit', 'paste');
    after = await changedField(page, HISTORY, before);
    parts = await fieldParts(page, HISTORY);
    expect(texts(parts.regular)).toEqual([
      ['r1c1', 'r1c1', 'r1c2'],
      ['r2c1', 'r2c1', 'r2c2'],
    ]);
    await undoRedo(page, HISTORY, before, after);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => fieldXml(page, HISTORY)).toBe(before);

    // calc.html on the asynchronous clipboard: Edit → Paste and the field menu's Paste give the
    // same table after the paragraph.
    await page.evaluate(
      `((args) => navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([args.html], { type: 'text/html' }),
        'text/plain': new Blob([args.text], { type: 'text/plain' }),
      })]))(${JSON.stringify({ html: clipboardHtml('calc'), text: clipboardTsv('calc') })})`,
    );
    await paragraphEnd(page, HISTORY);
    const fixture = await fieldXml(page, HISTORY);
    await menu(page, 'edit', 'paste');
    const byMenu = await changedField(page, HISTORY, fixture);
    parts = await fieldParts(page, HISTORY);
    const calc = parts.model.content![1]!;
    expect(calc.type).toBe('table');
    expect(await gridOf(page, idOf(calc))).toMatchObject({
      rows: 4,
      columns: 3,
      shortRows: 0,
      overlaps: 0,
      pastEnd: 0,
    });
    await menu(page, 'edit', 'undo');
    await expect.poll(() => fieldXml(page, HISTORY)).toBe(fixture);
    await paragraphEnd(page, HISTORY);
    await rightClickParagraphEnd(page, HISTORY);
    await page.getByTestId('context-menu-edit.paste').click();
    const byContextMenu = await changedField(page, HISTORY, fixture);
    expect(byContextMenu).toBe(byMenu);
    await undoRedo(page, HISTORY, fixture, byContextMenu);
  });

  test('C48 in the book annotation: a pasted paragraph brings its text, without a language, an id or a style', async ({
    core,
    page,
  }) => {
    await openBook(core, page);
    await paragraphEnd(page, ANNOTATION);
    const before = await fieldXml(page, ANNOTATION);
    await pasteInto(page, ANNOTATION, {
      html: '<p lang="de" data-id="u10-pasted" data-style="lead">Pasted</p>',
      text: 'Pasted',
    });
    const after = await changedField(page, ANNOTATION, before);
    expect(after).toContain('an irregular one.Pasted</p>');
    expect(after).not.toContain('xml:lang="de"');
    expect(after).not.toContain('u10-pasted');
    expect(after).not.toContain('style="lead"');
  });

  test('FR-057 and SC-011: the irregular tables of the three fields carry the mark; the book annotation’s popover repairs its table in one step; Escape and an outside mousedown close it, the caret kept; under the run lock Repair table is disabled', async ({
    core,
    page,
    standin,
  }) => {
    test.setTimeout(150_000);
    // The run lock of the last leg comes from a request to the assistant's loopback stand-in,
    // which a request in the Description view holds: a script run switches to the Body view.
    await standin.reset();
    await core.resetAiRequests();
    await core.setAiResolve([]);
    await core.rpc('settings.set', {
      patch: {
        session: { aiPanelVisible: true },
        ai: {
          mode: 'custom',
          custom: { address: `${standin.url}/v1`, key: '', model: 'standin-chat' },
        },
      },
    });
    await openBook(core, page);
    await ensureAssistantOn(page);
    for (const field of FIELDS) {
      const { regular, irregular } = await fieldParts(page, field);
      const irregularTable = tableOf(page, field, idOf(irregular));
      await expect(irregularTable, field.key).toHaveAttribute('data-irregular', 'true');
      await expect(irregularTable.getByTestId('body-table-mark'), field.key).toHaveCount(1);
      await expect(irregularTable.getByTestId('body-table-mark'), field.key).toHaveAttribute(
        'title',
        markTooltip(params(FIELD_CASES[field.key])),
      );
      const regularTable = tableOf(page, field, idOf(regular));
      await expect(regularTable, field.key).not.toHaveAttribute('data-irregular');
      await expect(regularTable.getByTestId('body-table-mark'), field.key).toHaveCount(0);
    }
    await expect(fieldOf(page, ANNOTATION).getByTestId('body-table-mark')).toHaveCount(1);
    await expect(fieldOf(page, HISTORY).getByTestId('body-table-mark')).toHaveCount(1);

    // The book annotation's mark: its popover lists the problems; Repair table, one step.
    const { irregular } = await fieldParts(page, ANNOTATION);
    const ref = idOf(irregular);
    const table = tableOf(page, ANNOTATION, ref);
    const mark = table.getByTestId('body-table-mark');
    await paragraphEnd(page, ANNOTATION);
    const caret = await selectionOf(page);
    await page.evaluate(
      `document.querySelector('[data-testid="${ANNOTATION.testId}"] [data-node-id="${ref}"]').scrollIntoView({ block: 'center' })`,
    );
    await painted(page);
    await mark.click();
    const popover = page.getByTestId('dialog-table-mark');
    await expect(popover).toBeVisible();
    await expect(page.getByTestId('dialog-table-mark-problems').locator('li')).toHaveText(
      problemParts(params(FIELD_CASES[ANNOTATION.key])),
    );
    const before = await fieldXml(page, ANNOTATION);
    await page.getByTestId('dialog-table-mark-button-repair').click();
    await expect(popover).toHaveCount(0);
    await expect(mark).toHaveCount(0);
    await expect(table).not.toHaveAttribute('data-irregular');
    expect(await gridOf(page, ref)).toMatchObject({ shortRows: 0, overlaps: 0, pastEnd: 0 });
    const after = await changedField(page, ANNOTATION, before);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => fieldXml(page, ANNOTATION)).toBe(before);
    await expect(table).toHaveAttribute('data-irregular', 'true');
    await expect(mark).toHaveCount(1);
    await menu(page, 'edit', 'redo');
    await expect.poll(() => fieldXml(page, ANNOTATION)).toBe(after);
    await menu(page, 'edit', 'undo');
    await expect(mark).toHaveCount(1);

    // A reopened popover closes on Escape and on a mousedown outside it, the caret kept.
    await paragraphEnd(page, ANNOTATION);
    const kept = await selectionOf(page);
    expect(kept).toEqual(caret);
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    expect(await selectionOf(page)).toEqual(kept);
    await mark.click();
    await expect(popover).toBeVisible();
    const status = (await page.getByTestId('statusbar').boundingBox())!;
    await page.mouse.move(status.x + status.width / 2, status.y + status.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(popover).toHaveCount(0);
    expect(await selectionOf(page)).toEqual(kept);

    // While a request to the assistant waits (the run lock, FR-048), the mark still opens the
    // popover; Repair table is disabled with the lock's reason, the focus on Close.
    await standin.reset();
    await standin.scenarios([{ text: 'Later.', delayMs: 6000 }] as never);
    await page.getByTestId('ai-input').fill('wait a little');
    await page.getByTestId('ai-input').press('Enter');
    await expect(page.getByTestId('script-run-banner')).toBeVisible();
    await expect(fieldOf(page, ANNOTATION)).toHaveAttribute('contenteditable', 'false');
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    await expect(popover).toBeVisible();
    const repair = page.getByTestId('dialog-table-mark-button-repair');
    await expect(repair).toBeDisabled();
    await expect(repair).toHaveAttribute(
      'title',
      await pageText(page, 'commands.unavailable.runLock.ai'),
    );
    await expect(page.getByTestId('dialog-table-mark-button-close')).toBeFocused();
    await page.getByTestId('dialog-table-mark-button-close').click();
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId('script-run-banner')).toHaveCount(0, { timeout: 30_000 });
    expect(await fieldXml(page, ANNOTATION)).toBe(before);
  });
});
