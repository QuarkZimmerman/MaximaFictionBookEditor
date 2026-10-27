/**
 * Feature 006, User Story 8 - Irregular tables are repaired on request; spans stay consistent
 * (T122; spec FR-034 to FR-036, FR-045, FR-047; US8 sc.1 to sc.7; U17, U22; C5, C13, C16; SC-007,
 * SC-009; research R1.5, R1.7; quickstart §8 "Automated"). *Repair table* runs from *Add → Table
 * structure* (`structure(page, 'table.repair')`, which takes the command id, so that
 * `tools/parity-check.mjs` finds it) and makes the caret's table regular without deleting any
 * content: a short row is padded with empty cells, a row span past the last row is cut to end
 * there, the later of two overlapping cells loses columns and the cells after it are placed again
 * (C1, C16). On a regular table, a just repaired one included, the command is unavailable with
 * the reason "the table has nothing to repair", and Undo brings the irregular table, its mark and
 * the command back. The Table bar's *colspan* and *rowspan* merge and split as *Merge cells* and
 * *Split cell* would - asking first when a linked cell would go (FR-015) - and refuse a span past
 * the table's edge or a value that is not a whole number. An untouched irregular table is saved
 * as it was read.
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile`. Every vector table of the book follows a paragraph `Case <name>
 * (<spec>)` (T012), by which `caseTable` finds its model and its `body-table`; the expectations -
 * the `repaired` tables - are read in Node from `tests/fixtures/tables/grid-vectors.json` and
 * compared as the unit tests compare them: cell types and attributes, node ids ignored. The user
 * story 8 scenario table (T014) follows the paragraph "US8 sc.5, sc.6": a regular 3 × 4 table
 * whose `r1c2` carries `id="us8-r1c2"`, linked from the paragraph after it. After every command
 * one Edit → Undo gives back the whole document XML byte for byte and one Edit → Redo the
 * command's result (`undoRedo`; SC-007, U22).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageAnyPattern, pageLang, uiText } from './fixtures/i18n';

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

interface ModelPoint {
  nodeId: string;
  offset: number;
}

interface TableSummary {
  rows: number;
  columns: number;
  shortRows: number;
  overlaps: number;
  pastEnd: number;
}

declare const window: {
  __mfbeTest?: {
    scripts?: {
      document(): DocJson;
      toXml(): Promise<string>;
      select(nodeId: string, from?: number, to?: number): boolean;
    };
    sourceMapping?: {
      bodySelection(): { anchor: ModelPoint; head: ModelPoint } | null;
    };
    tables?: {
      grid(tableRef: string): TableSummary | null;
    };
  };
};

/* ------------------------------------------------------------------------ */
/* The shared vectors                                                       */
/* ------------------------------------------------------------------------ */

interface VectorCell {
  type?: 'td' | 'th' | 'raw-xml';
  attrs?: Record<string, unknown>;
}

interface VectorTable {
  attrs?: Record<string, unknown>;
  rows: (VectorCell[] | { type: 'raw-xml' })[];
}

interface VectorCase {
  name: string;
  spec?: string;
  fixture?: string;
  table: VectorTable;
  expect: { regular: boolean; repaired?: VectorTable };
}

const VECTORS = fileURLToPath(
  new URL('../../../tests/fixtures/tables/grid-vectors.json', import.meta.url),
);
const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as { cases: VectorCase[] };

function vector(name: string): VectorCase {
  const found = vectors.cases.find((one) => one.name === name);
  if (!found) throw new Error(`no vector case ${name}`);
  return found;
}

/** A table as the comparison sees it: types other than `td` and set attributes, no node ids. */
interface Shape {
  attrs?: Record<string, unknown>;
  rows: ({ type?: string; attrs?: Record<string, unknown> }[] | 'raw')[];
}

function shapeAttrs(attrs: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key !== 'nodeId' && value !== null && value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function shapeCell(type: string | undefined, attrs: Record<string, unknown> | undefined) {
  const cell: { type?: string; attrs?: Record<string, unknown> } = {};
  if (type && type !== 'td') cell.type = type;
  const set = shapeAttrs(attrs);
  if (set) cell.attrs = set;
  return cell;
}

/** A vectors table as a shape. */
function vectorShape(table: VectorTable): Shape {
  const attrs = shapeAttrs(table.attrs);
  return {
    ...(attrs ? { attrs } : {}),
    rows: table.rows.map((row) =>
      Array.isArray(row) ? row.map((cell) => shapeCell(cell.type, cell.attrs)) : 'raw',
    ),
  };
}

/** A model table as a shape. */
function modelShape(table: Json): Shape {
  const attrs = shapeAttrs(table.attrs);
  return {
    ...(attrs ? { attrs } : {}),
    rows: (table.content ?? []).map((row) =>
      row.type === 'tr'
        ? (row.content ?? []).map((cell) =>
            cell.type === 'td' || cell.type === 'th'
              ? shapeCell(cell.type, cell.attrs)
              : { type: 'raw-xml' },
          )
        : 'raw',
    ),
  };
}

/* ------------------------------------------------------------------------ */
/* The document                                                             */
/* ------------------------------------------------------------------------ */

const TABLES = fixtureBook('tables.fb2');
/** The label of the user story 8 scenario table and of the paragraph that links its r1c2. */
const US8 = 'US8 sc.5, sc.6';
const LINKED_ID = 'us8-r1c2';

/** The irregular vector cases the Body view shows (`plural-forms` stands in the source book). */
const SHOWN_IRREGULAR = vectors.cases
  .filter((one) => one.fixture === 'tables.fb2' && !one.expect.regular)
  .map((one) => one.name)
  .filter((name) => name !== 'plural-forms');

function documentOf(page: Page): Promise<DocJson> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.document());
}

/** The live document as FB2 text, binaries elided. */
function toXml(page: Page): Promise<string> {
  return page.evaluate(() => window.__mfbeTest!.scripts!.toXml());
}

function textOf(node: Json): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'text' ? (child.text ?? '') : textOf(child)))
    .join('');
}

/** Every node below `node`, in document order, with its parent's children. */
function* walk(node: Json): Generator<{ node: Json; siblings: Json[]; index: number }> {
  const children = node.content ?? [];
  for (let index = 0; index < children.length; index += 1) {
    yield { node: children[index]!, siblings: children, index };
    yield* walk(children[index]!);
  }
}

/** The bodies, both annotations and the history: every tree of the model that holds tables. */
function trees(doc: DocJson): Json[] {
  return [
    ...doc.bodies,
    doc.description.titleInfo.annotation,
    doc.description.srcTitleInfo?.annotation,
    doc.description.documentInfo.history,
  ].filter((tree): tree is Json => !!tree);
}

/** The model table right after the paragraph whose text starts with `prefix`. */
function tableAfterPrefix(doc: DocJson, prefix: string): Json {
  for (const tree of trees(doc)) {
    for (const { node, siblings, index } of walk(tree)) {
      if (node.type === 'p' && textOf(node).startsWith(prefix)) {
        const next = siblings[index + 1];
        if (next?.type === 'table') return next;
      }
    }
  }
  throw new Error(`no table after the paragraph "${prefix}…"`);
}

/** The model table of the vector case `name`: after its paragraph `Case <name> (<spec>)`. */
function caseTable(doc: DocJson, name: string): Json {
  return tableAfterPrefix(doc, `Case ${name} (`);
}

/** The model table whose `nodeId` is `ref`. */
function tableByRef(doc: DocJson, ref: string): Json {
  for (const tree of trees(doc)) {
    for (const { node } of walk(tree)) {
      if (node.type === 'table' && node.attrs?.nodeId === ref) return node;
    }
  }
  throw new Error(`no table ${ref}`);
}

/** The model cells of a table, row by row. */
function cellRows(table: Json): Json[][] {
  return (table.content ?? [])
    .filter((row) => row.type === 'tr')
    .map((row) => (row.content ?? []).filter((cell) => cell.type === 'td' || cell.type === 'th'));
}

/** The cell of `table` whose text is `text`. */
function cellOf(table: Json, text: string): Json {
  for (const row of cellRows(table)) {
    for (const cell of row) if (textOf(cell) === text) return cell;
  }
  throw new Error(`no cell "${text}"`);
}

/** The letters of a vector table's cells, in reading order. */
function letters(table: Json): string {
  return cellRows(table)
    .flat()
    .map((cell) => textOf(cell))
    .join('');
}

/**
 * The text range `[start, end)` of the first `<table…</table>` after the paragraph that starts
 * with `marker` (`<p>Case <name> (`), in the XML as it is.
 */
function tableRange(xml: string, marker: string): [number, number] {
  const at = xml.indexOf(marker);
  if (at < 0) throw new Error(`no "${marker}" in the XML`);
  const start = xml.indexOf('<table', at);
  const end = xml.indexOf('</table>', start) + '</table>'.length;
  return [start, end];
}

/** The XML without the table of the case `name`: what a repair of that table leaves alone. */
function withoutCase(xml: string, name: string): string {
  const [start, end] = tableRange(xml, `<p>Case ${name} (`);
  return xml.slice(0, start) + xml.slice(end);
}

/** The elements whose white space the writer indents: their tags take none around them. */
const BLOCK_TAG =
  '(?:table|tr|td|th|p|section|title|body|subtitle|epigraph|cite|poem|stanza|v|text-author|annotation|empty-line)';
const AFTER_BLOCK_TAG = new RegExp(`(<\\/?${BLOCK_TAG}\\b[^>]*>)\\s+(?=<)`, 'g');
const BEFORE_BLOCK_TAG = new RegExp(`>\\s+(?=<\\/?${BLOCK_TAG}\\b)`, 'g');

/** The XML without the writer's indentation around block elements, empty cells as `<td/>`. */
function flatXml(xml: string): string {
  return xml
    .replace(AFTER_BLOCK_TAG, '$1')
    .replace(BEFORE_BLOCK_TAG, '>')
    .replace(/<(t[dhr])((?:\s[^>]*)?)><\/\1>/g, '<$1$2/>');
}

/** The table after the paragraph `label`, cut out of the flattened XML. */
function tableXml(xml: string, label: string): string {
  const flat = flatXml(xml);
  const marker = `<p>${label}</p>`;
  const at = flat.indexOf(`${marker}<table`);
  if (at < 0) throw new Error(`no table after "${label}" in the XML`);
  const from = at + marker.length;
  const to = flat.indexOf('</table>', from) + '</table>'.length;
  return flat.slice(from, to);
}

function td(text = '', attrs = ''): string {
  return text === '' ? `<td${attrs}/>` : `<td${attrs}>${text}</td>`;
}

function tr(...cells: string[]): string {
  return `<tr>${cells.join('')}</tr>`;
}

/** The user story 8 scenario table's rows 2 and 3 as the writer gives them. */
const ROW2 = tr(td('r2c1'), td('r2c2'), td('r2c3'), td('r2c4'));
const ROW3 = tr(td('r3c1'), td('r3c2'), td('r3c3'), td('r3c4'));
const US8_XML = `<table>${tr(
  td('r1c1'),
  td('r1c2', ` id="${LINKED_ID}"`),
  td('r1c3'),
  td('r1c4'),
)}${ROW2}${ROW3}</table>`;

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** The hooks are ready once the core's `app.info` reached the page (it runs with --test-hooks). */
async function hooksReady(page: Page): Promise<void> {
  await expect(page.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof window.__mfbeTest?.scripts?.document === 'function' &&
          typeof window.__mfbeTest?.tables?.grid === 'function',
      ),
    )
    .toBe(true);
}

/** The application, then `file` through File → Open and the queued native dialog. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
  await hooksReady(page);
}

/** Save As to `file` through the queued native dialog; returns the written text. */
async function saveAs(core: CoreHandle, page: Page, file: string): Promise<string> {
  await core.enqueueDialog('dialog.saveFile', { path: file, encoding: 'utf-8' });
  await menu(page, 'file', 'saveAs');
  const saved = await pageAnyPattern(page, 'status.savedNoErrors', 'msg.errorsFound');
  await expect(page.getByTestId('status-message')).toContainText(saved);
  await expect(page).toHaveTitle(
    new RegExp(`^${path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - `),
  );
  return readFileSync(file, 'utf8');
}

/** The entry of *Edit → Table structure* for the command `commandId`, its submenu open. */
async function structureEntry(page: Page, commandId: string): Promise<Locator> {
  await page.getByTestId('menu-edit').click();
  await page.getByTestId('menu-edit-tableStructure').click();
  await expect(page.getByTestId('menu-edit-tableStructure-popup')).toBeVisible();
  return page.getByTestId(
    `menu-edit-tableStructure-${commandId.slice(commandId.indexOf('.') + 1)}`,
  );
}

/** Runs `commandId` from *Edit → Table structure*: `menu-edit-tableStructure-<name>`. */
async function structure(page: Page, commandId: string): Promise<void> {
  const entry = await structureEntry(page, commandId);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** Closes the open menu whose popup is `popup` (and its submenus) with Escape. */
async function closeMenus(page: Page, popup: string): Promise<void> {
  await expect(async () => {
    if ((await page.getByTestId(popup).count()) > 0) await page.keyboard.press('Escape');
    expect(await page.getByTestId(popup).count()).toBe(0);
  }).toPass({ timeout: 5_000 });
}

/** A disabled entry whose title and description give `title` (FR-043; U40). */
async function unavailable(entry: Locator, title: string): Promise<void> {
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await expect(entry).toHaveAttribute('title', title);
  await expect(entry).toHaveAttribute('aria-description', title);
}

/** The caret at `offset` of the text block with the node id `nodeId`. */
async function caretIn(page: Page, nodeId: string, offset = 0): Promise<void> {
  const placed = await page.evaluate(([id, at]) => window.__mfbeTest!.scripts!.select(id, at, at), [
    nodeId,
    offset,
  ] as const);
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

/** The table's grid summary. */
async function gridOf(page: Page, ref: string): Promise<TableSummary | null> {
  return page.evaluate((id) => window.__mfbeTest!.tables!.grid(id), ref);
}

/**
 * Edit → Undo gives back `before`, the whole document XML, byte for byte, and Edit → Redo the
 * step's result `after` (SC-007, U22).
 */
async function undoRedo(page: Page, before: string, after: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page), { message: 'one Undo restores the XML' }).toBe(before);
  await menu(page, 'edit', 'redo');
  await expect.poll(() => toXml(page), { message: 'one Redo applies it again' }).toBe(after);
}

/** The XML once the document changed from `before`. */
async function changedFrom(page: Page, before: string): Promise<string> {
  await expect
    .poll(() => toXml(page), { message: 'the step changed the document' })
    .not.toBe(before);
  return toXml(page);
}

/** `aria-disabled` of Edit → Undo: `'true'` while the document has no undo step. */
async function undoState(page: Page): Promise<string | null> {
  await page.getByTestId('menu-edit').click();
  const entry = page.getByTestId('menu-edit-undo');
  await expect(entry).toBeVisible();
  const state = await entry.getAttribute('aria-disabled');
  await closeMenus(page, 'menu-edit-popup');
  return state;
}

/** Types `value` into the Table bar's text field `testId` and presses Enter. */
async function enter(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId);
  await expect(field).toBeEnabled();
  await field.fill(value);
  await field.press('Enter');
}

/**
 * A right-click on a cell, once it is scrolled into view and painted (the pattern of
 * `us1-table-create.spec.ts`): the context menu opens where the pointer is.
 */
async function rightClick(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await target.click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}

/** A vector table of the open book: its model, its reference and its `body-table`. */
interface CaseTable {
  name: string;
  ref: string;
  element: Locator;
  model: Json;
}

async function caseScenario(page: Page, name: string): Promise<CaseTable> {
  const model = caseTable(await documentOf(page), name);
  const ref = model.attrs!.nodeId!;
  const element = page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`);
  await expect(element, `the table of the case ${name} in the Body view`).toHaveCount(1);
  return { name, ref, element, model };
}

/** The node id of the first cell of a model table. */
function firstCell(table: Json): string {
  return cellRows(table)[0]![0]!.attrs!.nodeId!;
}

/**
 * *Repair table* with the caret in the first cell of the case `name`: the table equals the
 * vector's `repaired`, no letter is lost, the grid is regular, and the rest of the document is
 * byte for byte as it was; then one Undo and one Redo. Returns the XML after the repair.
 */
async function repairCase(page: Page, name: string): Promise<string> {
  const target = await caseScenario(page, name);
  const before = await toXml(page);
  await caretIn(page, firstCell(target.model));
  await structure(page, 'table.repair');
  const after = await changedFrom(page, before);
  const repaired = tableByRef(await documentOf(page), target.ref);
  expect(modelShape(repaired), `${name}: the repaired table`).toEqual(
    vectorShape(vector(name).expect.repaired!),
  );
  // No content is deleted: every letter, in reading order (FR-034).
  expect(letters(repaired), `${name}: the letters`).toBe(letters(target.model));
  expect(await gridOf(page, target.ref), `${name}: the grid`).toMatchObject({
    shortRows: 0,
    overlaps: 0,
    pastEnd: 0,
  });
  // FR-034: the repair acts on this table alone.
  expect(withoutCase(after, name), `${name}: the rest of the document`).toBe(
    withoutCase(before, name),
  );
  await undoRedo(page, before, after);
  return after;
}

/** The unavailable title of *Repair table* on a regular table (data-model §9.6; U40). */
function regularTitle(lang: 'en' | 'ru' | 'uk'): string {
  return uiText(lang, 'commands.unavailable.title', {
    command: uiText(lang, 'tables.cmd.repair.tooltip'),
    reason: uiText(lang, 'tables.reason.regular'),
  });
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US8 (feature 006) - Repair table and the span fields', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us8-repair-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // Before the page loads: the AI panel hidden, so the views have their full width, and
    // Restore position off - every save and every open records the caret of the book that
    // leaves (feature 004 US8), and an open puts the remembered caret back once the core has
    // answered, after the journey placed its own (sc.7 saves; every test reopens tables.fb2).
    await core.rpc('settings.set', {
      patch: { session: { aiPanelVisible: false }, other: { restorePosition: false } },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    // A `null` member returns to its default (`core/src/settings/settings.cpp`, merge_patch).
    await core
      .rpc('settings.set', {
        patch: { session: { aiPanelVisible: null }, other: { restorePosition: null } },
      })
      .catch(() => {});
  });

  test('sc.1 and sc.4: a short row gets one empty cell and nothing else changes; then Repair table is unavailable on that table and on any regular one, and Undo brings the irregular table, its mark and the command back', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const title = regularTitle(lang);
    const shortRow = await caseScenario(page, 'short-row');
    expect(shortRow.model.attrs?.id).toBe('t2');
    expect(await gridOf(page, shortRow.ref)).toMatchObject({ shortRows: 1, row: 2, covered: 2 });

    // sc.1: one empty td appended to row 2; the table keeps its id.
    const repaired = await repairCase(page, 'short-row');
    const rows = cellRows(tableByRef(await documentOf(page), shortRow.ref));
    expect(rows.map((row) => row.map(textOf))).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', ''],
      ['f', 'g', 'h'],
    ]);
    expect(rows[1]![2]!.type).toBe('td');
    expect(shapeAttrs(rows[1]![2]!.attrs)).toBeNull();

    // sc.4: the caret still in the repaired table - the entry is unavailable with its reason.
    await caretIn(page, firstCell(shortRow.model));
    await unavailable(await structureEntry(page, 'table.repair'), title);
    await closeMenus(page, 'menu-edit-popup');
    // So it is on any regular table, here the 1 × 1 one.
    const regular = await caseScenario(page, 'one-by-one');
    await caretIn(page, firstCell(regular.model));
    await unavailable(await structureEntry(page, 'table.repair'), title);
    await closeMenus(page, 'menu-edit-popup');
    // And in the repaired table's context menu.
    const cell = shortRow.element.locator(
      `:is(td.fb-td, th.fb-th)[data-node-id="${firstCell(shortRow.model)}"]`,
    );
    await rightClick(page, cell);
    await page.getByTestId('context-menu-tableStructure').click();
    await expect(page.getByTestId('context-menu-tableStructure-popup')).toBeVisible();
    await unavailable(page.getByTestId('context-menu-tableStructure-repair'), title);
    await closeMenus(page, 'context-menu');
    expect(await toXml(page)).toBe(repaired);

    // Edit → Undo: irregular again, with its mark, and the command is back.
    await expect(shortRow.element).not.toHaveAttribute('data-irregular');
    await expect(shortRow.element.getByTestId('body-table-mark')).toHaveCount(0);
    await menu(page, 'edit', 'undo');
    await expect(shortRow.element).toHaveAttribute('data-irregular', 'true');
    await expect(shortRow.element.getByTestId('body-table-mark')).toHaveCount(1);
    await caretIn(page, firstCell(shortRow.model));
    const entry = await structureEntry(page, 'table.repair');
    await expect(entry).not.toHaveAttribute('aria-disabled');
    await closeMenus(page, 'menu-edit-popup');
  });

  test('sc.2 and sc.3: a row span past the last row ends there, an overlapping span loses columns without losing content, and every other irregular table of the Body view gives its repaired vector', async ({
    core,
    page,
  }) => {
    test.setTimeout(240_000);
    await openBook(core, page, TABLES);
    // sc.2: `[a, b rowspan 4] / [c]` (document-model §4.13) and quickstart §8's left variant.
    for (const name of ['rowspan-past-end', 'rowspan-past-end-left']) {
      await repairCase(page, name);
      const spanned = cellRows(
        tableByRef(await documentOf(page), (await caseScenario(page, name)).ref),
      )
        .flat()
        .find((cell) => cell.attrs?.rowspan !== undefined);
      expect(spanned?.attrs?.rowspan, name).toBe(2);
    }
    // sc.3: `[a, b rowspan 2] / [c colspan 2]` - c loses its colspan, every letter stays.
    await repairCase(page, 'one-overlap');
    const overlap = tableByRef(
      await documentOf(page),
      (await caseScenario(page, 'one-overlap')).ref,
    );
    expect(cellOf(overlap, 'c').attrs?.colspan).toBeUndefined();
    expect(letters(overlap)).toBe('abc');
    // Every other irregular vector case the Body view shows - C1's and C16's cascades, the
    // tooltip example, a rowspan of 10⁹, the history block's, the annotation block's, a cite's
    // and a section annotation's tables - gives its repaired table.
    const done = new Set(['short-row', 'rowspan-past-end', 'rowspan-past-end-left', 'one-overlap']);
    const others = SHOWN_IRREGULAR.filter((name) => !done.has(name));
    expect(others.sort()).toEqual(
      [
        'repair-shift',
        'repair-shift-cascade',
        'tooltip-example',
        'rowspan-huge',
        'three-problems',
        'overlap-from-two-rows-above',
        'short-rows-several',
        'short-row-hole',
      ].sort(),
    );
    for (const name of others) await repairCase(page, name);
    // C1's example: M moved from column 3 to column 2, W from 4 to 3, row 1 padded.
    const shift = tableByRef(
      await documentOf(page),
      (await caseScenario(page, 'repair-shift')).ref,
    );
    expect(cellRows(shift).map((row) => row.map(textOf))).toEqual([
      ['a', 'b', ''],
      ['c', 'd'],
    ]);
  });

  test('sc.5: colspan 3 merges the cells it covers - asking first for the linked one, No changing nothing -, colspan 1 or an empty field splits, rowspan 2 merges the cell below; each one undo step', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const doc = await documentOf(page);
    const model = tableAfterPrefix(doc, US8);
    const ref = model.attrs!.nodeId!;
    const r1c1 = cellOf(model, 'r1c1').attrs!.nodeId!;
    const r1c4 = cellOf(model, 'r1c4').attrs!.nodeId!;
    const fixture = await toXml(page);
    expect(tableXml(fixture, US8)).toBe(US8_XML);
    const undoBefore = await undoState(page);

    // colspan 3 in r1c1: r1c2, which a link of the book targets, would go - the question first.
    await caretIn(page, r1c1);
    await expect(page.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true');
    await enter(page, 'table-bar-colspan', '3');
    const question = page.getByTestId('dialog-table-link-targets');
    await expect(question).toBeVisible();
    await expect(page.getByTestId('dialog-table-link-targets-text')).toHaveText(
      uiText(lang, 'tables.msg.linkTargets', { count: 1 }),
    );
    // No: nothing changes, the field shows its value again and no undo step is recorded (U17).
    await page.getByTestId('dialog-table-link-targets-button-no').click();
    await expect(question).toHaveCount(0);
    await expect(page.getByTestId('table-bar-colspan')).toHaveValue('');
    expect(await toXml(page)).toBe(fixture);
    expect(await undoState(page)).toBe(undoBefore);

    // Yes: r1c1 covers three columns and holds the three texts; r1c2, r1c3 and the id are gone.
    await caretIn(page, r1c1);
    await enter(page, 'table-bar-colspan', '3');
    await expect(question).toBeVisible();
    await page.getByTestId('dialog-table-link-targets-button-yes').click();
    const merged = await changedFrom(page, fixture);
    const mergedRow1 = tr(td('r1c1 r1c2 r1c3', ' colspan="3"'), td('r1c4'));
    expect(tableXml(merged, US8)).toBe(`<table>${mergedRow1}${ROW2}${ROW3}</table>`);
    expect(merged).not.toContain(`id="${LINKED_ID}"`);
    await expect(page.getByTestId('table-bar-colspan')).toHaveValue('3');
    expect(await gridOf(page, ref)).toMatchObject({ rows: 3, columns: 4, shortRows: 0 });
    await undoRedo(page, fixture, merged);

    // colspan 1 splits it: r1c1 keeps the joined text, two empty cells of its kind follow.
    await caretIn(page, r1c1);
    await enter(page, 'table-bar-colspan', '1');
    const split = await changedFrom(page, merged);
    const splitRow1 = tr(td('r1c1 r1c2 r1c3'), td(), td(), td('r1c4'));
    expect(tableXml(split, US8)).toBe(`<table>${splitRow1}${ROW2}${ROW3}</table>`);
    await undoRedo(page, merged, split);
    // After Undo, an emptied field splits the same way.
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(merged);
    await caretIn(page, r1c1);
    await expect(page.getByTestId('table-bar-colspan')).toHaveValue('3');
    await enter(page, 'table-bar-colspan', '');
    await expect.poll(() => toXml(page)).toBe(split);
    await undoRedo(page, merged, split);

    // rowspan 2 in r1c4 merges r1c4 and r2c4 - no linked id, no question.
    await caretIn(page, r1c4);
    await enter(page, 'table-bar-rowspan', '2');
    const tall = await changedFrom(page, split);
    await expect(question).toHaveCount(0);
    expect(tableXml(tall, US8)).toBe(
      `<table>${tr(td('r1c1 r1c2 r1c3'), td(), td(), td('r1c4 r2c4', ' rowspan="2"'))}${tr(
        td('r2c1'),
        td('r2c2'),
        td('r2c3'),
      )}${ROW3}</table>`,
    );
    await expect(page.getByTestId('table-bar-rowspan')).toHaveValue('2');
    expect(await gridOf(page, ref)).toMatchObject({ rows: 3, columns: 4, shortRows: 0 });
    await undoRedo(page, split, tall);
  });

  test('sc.6: a span past the last column or row, or one that is no whole number, is refused with a message; the field shows its value again and nothing changes', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const model = tableAfterPrefix(await documentOf(page), US8);
    const fixture = await toXml(page);
    const undoBefore = await undoState(page);
    const refused = async (testId: string, value: string, key: string) => {
      await enter(page, testId, value);
      await expect(page.getByTestId('status-message'), `${value} refused`).toHaveText(
        uiText(lang, key),
      );
      await expect(page.getByTestId(testId), `${testId} restored`).toHaveValue('');
      expect(await toXml(page), `${value} changes nothing`).toBe(fixture);
      expect(await undoState(page), `${value} records no undo step`).toBe(undoBefore);
    };
    // Four columns from column 2 reach past the fourth.
    await caretIn(page, cellOf(model, 'r1c2').attrs!.nodeId!);
    await expect(page.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true');
    await refused('table-bar-colspan', '4', 'tables.msg.spanPastEnd');
    // Not a whole number of 1 or more.
    await caretIn(page, cellOf(model, 'r1c2').attrs!.nodeId!);
    await refused('table-bar-colspan', 'abc', 'tables.msg.spanInvalid');
    // Three rows from row 2 reach past the third.
    await caretIn(page, cellOf(model, 'r2c1').attrs!.nodeId!);
    await refused('table-bar-rowspan', '3', 'tables.msg.spanPastEnd');
    await caretIn(page, cellOf(model, 'r2c1').attrs!.nodeId!);
    await refused('table-bar-rowspan', '0', 'tables.msg.spanInvalid');
  });

  test('sc.7: an irregular table that is only typed in is saved as it was read with the word added, and a book saved without edits keeps every table as written; no caption reaches the file', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    await openBook(core, page, TABLES);
    const original = readFileSync(TABLES, 'utf8');
    const WORD = 'Zq';
    // A word at the end of the first cell (`a`) of every irregular table the Body view shows.
    for (const name of SHOWN_IRREGULAR) {
      const target = await caseScenario(page, name);
      const first = firstCell(target.model);
      expect(textOf(cellRows(target.model)[0]![0]!), name).toBe('a');
      // The editor holds the focus first, so the caret placed next is drawn into the page.
      await page.getByTestId('body-editor').focus();
      await caretIn(page, first, 1);
      await page.keyboard.type(WORD);
      await expect
        .poll(async () =>
          textOf(cellOf(tableByRef(await documentOf(page), target.ref), `a${WORD}`)),
        )
        .toBe(`a${WORD}`);
    }
    const typed = await saveAs(core, page, path.join(dir, 'typed.fb2'));
    expect(typed).not.toContain('<caption');
    for (const name of SHOWN_IRREGULAR) {
      const marker = `<p>Case ${name} (`;
      const [start, end] = tableRange(original, marker);
      const expected = original.slice(start, end).replace('>a</td>', `>a${WORD}</td>`);
      const [from, to] = tableRange(typed, marker);
      expect(typed.slice(from, to), name).toBe(expected);
    }

    // A book saved without edits: every table's text as tables.fb2 holds it, apart from the
    // plain decimal form of span numbers (FR-047: `colspan=" 2 "` is written `colspan="2"`).
    await core.enqueueDialog('dialog.openFile', { paths: [TABLES] });
    await menu(page, 'file', 'open');
    await waitForBook(page, TABLES);
    await hooksReady(page);
    const untouched = await saveAs(core, page, path.join(dir, 'untouched.fb2'));
    expect(untouched).not.toContain('<caption');
    const tablesOf = (xml: string) => xml.match(/<table\b[\s\S]*?<\/table>/g) ?? [];
    const decimal = (xml: string) =>
      xml.replace(/\b(colspan|rowspan)="\s*\+?0*(\d+)\s*"/g, '$1="$2"');
    const expected = tablesOf(original).map(decimal);
    expect(expected.length).toBeGreaterThan(30);
    expect(tablesOf(untouched)).toEqual(expected);
  });
});
