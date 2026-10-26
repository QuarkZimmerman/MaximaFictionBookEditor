/**
 * Feature 006, User Story 5 - Merge and split cells (T100; spec FR-013 to FR-015, FR-030,
 * FR-035, FR-045; US5 sc.1 to sc.4; the spec's edge cases on note links and on blocks that
 * already hold merged cells; C13, C17; decision 1; U22; SC-007, SC-009; quickstart §5 "Manual
 * check" steps 1 to 5 and "Automated"). *Merge cells* runs from *Add → Table structure*
 * (`structure(page, 'table.mergeCells')`, which takes the command id, so that
 * `tools/parity-check.mjs` finds every id quoted here).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile`, and works on the user story 5 tables of its "Scenario tables"
 * section (T014), each found by the paragraph that names its scenarios and by the `data-node-id`
 * of its `[data-testid=body-table]`:
 *  (1) "US5 sc.1, sc.3 and the block that holds a merged cell": 3 × 4, `r1c2` empty, `r1c1` a
 *      `th` with `id="us5-r1c1"`, `style="hd"`, `xml:lang="de"` and `align="right"`;
 *  (2) "US5 sc.1 over the full width": 3 × 3;
 *  (3) "US5 sc.2": 2 × 2 holding bold text, a link, a note link to `us5-note`, a named style and
 *      an inline image (`cell.png`);
 *  (4) "US5 sc.4": 2 × 2, `r1c2` with `id="us5-target"`, linked from the paragraph after it;
 *  (5) "US5 sc.5": `[th m colspan 3 rowspan 2, d] / [e]`, `m` with an `id`, a `style`, an
 *      `xml:lang` and an `align`.
 *
 * The split, reason and picture tests (T101; FR-016, FR-030, FR-043, FR-067, FR-069; US5 sc.5,
 * sc.6; the spec's edge case on preserved inline content; C28; U8, U22, U38; quickstart §5
 * manual steps 6 and 7; research R9's note that FR-030's merge and split with pictures run
 * here): *Split cell* on table (5); the reasons of both commands in a single cell, with a block,
 * in the context menu and for a selection that leaves the table; the pictures of c07, c08 and
 * c22 of `tables-images.fb2` (T016; tables found by their `id`); and a book the test writes
 * into a temporary folder, whose table holds nested named styles, a comment and a note link.
 *
 * Every step is checked by the table's XML in `scripts.toXml()`, the merged cell's `colspan`
 * and `rowspan` in the DOM, the merged text in reading order and a regular grid afterwards
 * (`__mfbeTest.tables.grid`), and is followed by Edit → Undo, after which the whole document XML
 * equals the XML before byte for byte, and Edit → Redo, after which it equals the step's result
 * (`undoRedo`; SC-007, U22).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageText } from './fixtures/i18n';
import { LINE_END } from './fixtures/keys';

/* ------------------------------------------------------------------------ */
/* The page's hooks and the model JSON                                      */
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
      selectRange(anchor: ModelPoint, head: ModelPoint): boolean;
    };
    sourceMapping?: {
      bodySelection(): { anchor: ModelPoint; head: ModelPoint } | null;
    };
    tables?: {
      grid(tableRef: string): TableSummary | null;
    };
  };
};

const TABLES = fixtureBook('tables.fb2');
const IMAGES = fixtureBook('tables-images.fb2');

/** The labels of the scenario tables (the paragraphs before them in `tables.fb2`). */
const T1 = 'US5 sc.1, sc.3 and the block that holds a merged cell';
const T2 = 'US5 sc.1 over the full width';
const T3 = 'US5 sc.2';
const T4 = 'US5 sc.4';
const T5 = 'US5 sc.5';
/** The paragraph after table (4), whose link targets its `r1c2`. */
const LINKER = 'The cell r1c2 of the table above is linked.';
/** The label of the table of the book `u8Book` writes. */
const U8_LABEL = 'U8 table';

/**
 * A valid book whose 2 × 2 table holds nested named styles, a comment (inline raw XML; FR-067),
 * a note link to the note `n1` of a notes body, and plain text (as `book()` of
 * `us7-images.spec.ts` writes its books).
 */
function u8Book(dir: string): string {
  const file = path.join(dir, 'us5-inline.fb2');
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Ann</first-name><last-name>Writer</last-name></author>
<book-title>Merge and split</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>maker</nickname></author>
<date value="2026-01-01">2026</date>
<id>us5-inline-0001</id>
<version>1.0</version>
</document-info>
</description>
<body>
<section><p>${U8_LABEL}</p><table><tr><td><style name="a"><style name="b">x</style></style></td><td><!--kept--></td></tr><tr><td>n<a l:href="#n1" type="note">1</a></td><td>plain</td></tr></table><p>After the table.</p></section>
</body>
<body name="notes">
<section id="n1"><p>The note.</p></section>
</body>
</FictionBook>
`,
    'utf8',
  );
  return file;
}

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

/** Every node of the bodies, in document order, with its parent's children. */
function* walk(node: Json): Generator<{ node: Json; siblings: Json[]; index: number }> {
  const children = node.content ?? [];
  for (let index = 0; index < children.length; index += 1) {
    yield { node: children[index]!, siblings: children, index };
    yield* walk(children[index]!);
  }
}

/** The paragraph whose text is `text`. */
function paragraphOf(doc: DocJson, text: string): Json {
  for (const body of doc.bodies) {
    for (const { node } of walk(body)) {
      if (node.type === 'p' && textOf(node) === text) return node;
    }
  }
  throw new Error(`no paragraph "${text}"`);
}

/** The model table right after the paragraph whose text is `label`. */
function tableAfter(doc: DocJson, label: string): Json {
  for (const body of doc.bodies) {
    for (const { node, siblings, index } of walk(body)) {
      if (node.type === 'p' && textOf(node) === label) {
        const next = siblings[index + 1];
        if (next?.type === 'table') return next;
      }
    }
  }
  throw new Error(`no table after the paragraph "${label}"`);
}

/** The model table whose `nodeId` is `ref`. */
function tableByRef(doc: DocJson, ref: string): Json {
  for (const body of doc.bodies) {
    for (const { node } of walk(body))
      if (node.type === 'table' && node.attrs?.nodeId === ref) return node;
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

/** The node ids of the cells at `[row, child]` of a table: the row's own cells, in order. */
function cellIdsAt(model: Json, positions: readonly [number, number][]): string[] {
  const rows = cellRows(model);
  return positions.map(([row, child]) => rows[row]![child]!.attrs!.nodeId!);
}

/** The elements whose white space the writer indents: their tags take none around them. */
const BLOCK_TAG =
  '(?:table|tr|td|th|p|section|title|body|subtitle|epigraph|cite|poem|stanza|v|text-author|annotation|empty-line)';
const AFTER_BLOCK_TAG = new RegExp(`(<\\/?${BLOCK_TAG}\\b[^>]*>)\\s+(?=<)`, 'g');
const BEFORE_BLOCK_TAG = new RegExp(`>\\s+(?=<\\/?${BLOCK_TAG}\\b)`, 'g');

/**
 * The XML with the indentation around block elements removed - the white space inside a
 * cell's inline content, such as the single spaces a merge puts between its parts, stays - and
 * empty cells written one way (`<td/>`).
 */
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

/** The model table whose FB2 id is `id` (the tables of `tables-images.fb2`). */
function tableById(doc: DocJson, id: string): Json {
  for (const body of doc.bodies) {
    for (const { node } of walk(body)) {
      if (node.type === 'table' && node.attrs?.id === id) return node;
    }
  }
  throw new Error(`no table with the id ${id}`);
}

/** The table with the FB2 id `id`, cut out of the flattened XML. */
function tableXmlById(xml: string, id: string): string {
  const flat = flatXml(xml);
  const from = flat.indexOf(`<table id="${id}">`);
  if (from < 0) throw new Error(`no <table id="${id}"> in the XML`);
  return flat.slice(from, flat.indexOf('</table>', from) + '</table>'.length);
}

/** The section with the FB2 id `id`, cut out of the XML as it is (no nested section in it). */
function sectionXml(xml: string, id: string): string {
  const from = xml.indexOf(`<section id="${id}">`);
  if (from < 0) throw new Error(`no <section id="${id}"> in the XML`);
  return xml.slice(from, xml.indexOf('</section>', from) + '</section>'.length);
}

/** The inline XML of each cell of a flattened table, in reading order. */
function cellContents(flatTable: string): string[] {
  return [...flatTable.matchAll(/<(t[dh])(?:\s[^>]*)?>(.*?)<\/\1>|<t[dh](?:\s[^>]*)?\/>/g)].map(
    (match) => match[2] ?? '',
  );
}

/** A row of the expected XML. */
function tr(cells: string): string {
  return `<tr>${cells}</tr>`;
}

function td(text = '', attrs = ''): string {
  return text === '' ? `<td${attrs}/>` : `<td${attrs}>${text}</td>`;
}

function th(text = '', attrs = ''): string {
  return text === '' ? `<th${attrs}/>` : `<th${attrs}>${text}</th>`;
}

function table(...rows: string[]): string {
  return `<table>${rows.join('')}</table>`;
}

/** Cells holding their names. */
function tds(...names: string[]): string {
  return names.map((name) => td(name)).join('');
}

/** Table (1) of the fixture, as the writer gives it. */
const R1C1 = ' id="us5-r1c1" style="hd" align="right" xml:lang="de"';
const T1_ROW2 = tr(tds('r2c1', 'r2c2', 'r2c3', 'r2c4'));
const T1_ROW3 = tr(tds('r3c1', 'r3c2', 'r3c3', 'r3c4'));
const T1_XML = table(tr(th('r1c1', R1C1) + td() + tds('r1c3', 'r1c4')), T1_ROW2, T1_ROW3);

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** The entry of *Add → Table structure* for the command `commandId`, its submenu open. */
async function structureEntry(page: Page, commandId: string): Promise<Locator> {
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-tableStructure').click();
  await expect(page.getByTestId('menu-add-tableStructure-popup')).toBeVisible();
  return page.getByTestId(`menu-add-tableStructure-${commandId.slice(commandId.indexOf('.') + 1)}`);
}

/** Runs `commandId` from *Add → Table structure*: `menu-add-tableStructure-<name>`. */
async function structure(page: Page, commandId: string): Promise<void> {
  const entry = await structureEntry(page, commandId);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** A book through File → Open and the queued native dialog; the hooks ready. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
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
          typeof window.__mfbeTest?.tables?.grid === 'function',
      ),
    )
    .toBe(true);
}

/** One of the scenario tables: its label, its reference, its model and its cells' node ids. */
interface Scenario {
  label: string;
  /** The table's `nodeId`, the `data-node-id` of its `body-table`. */
  ref: string;
  /** The `body-table` element. */
  element: Locator;
  /** The model table when the scenario was read. */
  model: Json;
  cell(text: string): string;
  cells(...texts: string[]): string[];
}

async function scenario(page: Page, label: string): Promise<Scenario> {
  const model = tableAfter(await documentOf(page), label);
  const ref = model.attrs!.nodeId!;
  const element = page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`);
  await expect(element, `the table after "${label}" in the Body view`).toHaveCount(1);
  const cell = (text: string) => cellOf(model, text).attrs!.nodeId!;
  return { label, ref, element, model, cell, cells: (...texts) => texts.map(cell) };
}

/** The cell element of the table with the node id `nodeId` (`td.fb-td` or `th.fb-th`). */
function cellById(target: Scenario, nodeId: string): Locator {
  return target.element.locator(`:is(td.fb-td, th.fb-th)[data-node-id="${nodeId}"]`);
}

/** The cell element of the table whose text was `name` when the scenario was read. */
function cell(target: Scenario, name: string): Locator {
  return cellById(target, target.cell(name));
}

/** The node ids of every element of the page that carries `mfbe-cell-selected`, in order. */
function highlighted(page: Page): Promise<(string | null)[]> {
  return page
    .locator('.mfbe-cell-selected')
    .evaluateAll((elements) =>
      elements.map((element) =>
        (element as unknown as { getAttribute(name: string): string | null }).getAttribute(
          'data-node-id',
        ),
      ),
    );
}

/** The caret at `offset` of the text block with the node id `nodeId`. */
async function caretIn(page: Page, nodeId: string, offset = 0): Promise<void> {
  const placed = await page.evaluate(([id, at]) => window.__mfbeTest!.scripts!.select(id, at, at), [
    nodeId,
    offset,
  ] as const);
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

/** The editor holds the focus again (after a menu), its selection kept. */
async function focusEditor(page: Page): Promise<void> {
  await page.getByTestId('body-editor').focus();
  await expect(page.getByTestId('body-editor')).toBeFocused();
}

/** The Body selection's head, as a model point. */
async function headPoint(page: Page): Promise<ModelPoint | undefined> {
  return page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection()?.head);
}

/** The table's grid summary. */
async function gridOf(page: Page, ref: string): Promise<TableSummary | null> {
  return page.evaluate((id) => window.__mfbeTest!.tables!.grid(id), ref);
}

/** The table's grid is regular: no short row, no overlap, no span past the end. */
async function regular(page: Page, ref: string): Promise<void> {
  expect(await gridOf(page, ref), `the grid of ${ref}`).toMatchObject({
    shortRows: 0,
    overlaps: 0,
    pastEnd: 0,
  });
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

/** A click on a cell's text end: the caret there, once - never repeated. */
async function clickEnd(page: Page, element: Locator): Promise<void> {
  const nodeId = await element.getAttribute('data-node-id');
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await element.click({ position: { x: box.width - 3, y: box.height / 2 } });
  await page.keyboard.press(LINE_END);
  await expect
    .poll(async () => (await headPoint(page))?.nodeId, 'the caret in the cell')
    .toBe(nodeId);
  await expect(page.getByTestId('status-path')).toHaveText(/\/t[dh]\[\d+\]$/);
}

/** A block from the cell `from` to the cell `to` by a click and a Shift+click. */
async function shiftBlock(page: Page, from: Locator, to: Locator): Promise<void> {
  await clickEnd(page, from);
  await to.click({ modifiers: ['Shift'] });
  const head = await to.getAttribute('data-node-id');
  await expect.poll(() => highlighted(page)).toContain(head);
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

/** The pictures (`body-inline-image`) of the cell with the node id `nodeId`. */
function picturesIn(page: Page, nodeId: string): Locator {
  return page.locator(`:is(td, th)[data-node-id="${nodeId}"] [data-testid="body-inline-image"]`);
}

/** The `data-href`s of the pictures of a cell, in document order. */
function hrefsIn(page: Page, nodeId: string): Promise<(string | null)[]> {
  return picturesIn(page, nodeId).evaluateAll((elements) =>
    elements.map((element) =>
      (element as unknown as { getAttribute(name: string): string | null }).getAttribute(
        'data-href',
      ),
    ),
  );
}

/** A disabled entry whose title and description give `title` (FR-043; U40). */
async function unavailable(entry: Locator, title: string): Promise<void> {
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await expect(entry).toHaveAttribute('title', title);
  await expect(entry).toHaveAttribute('aria-description', title);
}

/** Closes the open menu whose popup is `popup` (and its submenus) with Escape. */
async function closeMenus(page: Page, popup: string): Promise<void> {
  await expect(async () => {
    if ((await page.getByTestId(popup).count()) > 0) await page.keyboard.press('Escape');
    expect(await page.getByTestId(popup).count()).toBe(0);
  }).toPass({ timeout: 5_000 });
}

/** A block between two cells: a selection from one to the other, which the plugin makes a block. */
async function selectBlock(page: Page, anchor: string, head: string): Promise<void> {
  const placed = await page.evaluate(
    ([a, h]) =>
      window.__mfbeTest!.scripts!.selectRange({ nodeId: a, offset: 0 }, { nodeId: h, offset: 0 }),
    [anchor, head] as const,
  );
  expect(placed, `a block from ${anchor} to ${head}`).toBe(true);
  await expect.poll(() => highlighted(page)).toContain(head);
  await focusEditor(page);
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US5 (feature 006) - merge and split cells', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The AI panel hidden for the page load, so the views have their full width.
    await core.rpc('settings.set', { patch: { session: { aiPanelVisible: false } } });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    await core
      .rpc('settings.set', { patch: { session: { aiPanelVisible: true } } })
      .catch(() => {});
  });

  test('sc.1 and sc.3: a 2 × 3 block becomes its top-left cell, which keeps its kind and attributes; a block holding that merged cell merges again', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    expect(tableXml(fixture, T1)).toBe(T1_XML);
    const [empty] = cellIdsAt(t1.model, [[0, 1]]);
    const removed = [empty!, ...t1.cells('r1c3', 'r2c1', 'r2c2', 'r2c3')];

    // A click on r1c1 and a Shift+click on r2c3: the six cells of rows 1-2 × columns 1-3.
    await shiftBlock(page, cell(t1, 'r1c1'), cell(t1, 'r2c3'));
    await expect
      .poll(() => highlighted(page))
      .toEqual([t1.cell('r1c1'), empty, ...t1.cells('r1c3', 'r2c1', 'r2c2', 'r2c3')]);
    await structure(page, 'table.mergeCells');
    const merged = await changedFrom(page, fixture);
    // r1c1 covers the block; the other five cells are gone, their texts in reading order after
    // its own with single spaces, nothing for the empty r1c2 (C17); row 2 keeps r2c4 alone.
    const text = 'r1c1 r1c3 r2c1 r2c2 r2c3';
    expect(tableXml(merged, T1)).toBe(
      table(
        tr(
          th(
            text,
            ' id="us5-r1c1" style="hd" colspan="3" rowspan="2" align="right" xml:lang="de"',
          ) + td('r1c4'),
        ),
        tr(td('r2c4')),
        T1_ROW3,
      ),
    );
    const keeper = cell(t1, 'r1c1');
    await expect(keeper).toHaveAttribute('colspan', '3');
    await expect(keeper).toHaveAttribute('rowspan', '2');
    await expect(keeper).toHaveText(text);
    for (const nodeId of removed) await expect(cellById(t1, nodeId)).toHaveCount(0);
    const rows = cellRows(tableByRef(await documentOf(page), t1.ref));
    expect(rows.map((row) => row.map(textOf))).toEqual([
      [text, 'r1c4'],
      ['r2c4'],
      ['r3c1', 'r3c2', 'r3c3', 'r3c4'],
    ]);
    expect(await gridOf(page, t1.ref)).toMatchObject({ rows: 3, columns: 4 });
    await regular(page, t1.ref);
    // The caret at the start of the merged cell.
    await expect(page.getByTestId('status-path')).toHaveText(/\/tr\[1\]\/th\[1\]$/);
    expect(await headPoint(page)).toEqual({ nodeId: t1.cell('r1c1'), offset: 0 });

    // sc.3: still a header cell with its id, language and alignment - the XML above keeps its
    // style too -, and the Table bar shows them (Cell language since US7).
    await expect(keeper).toHaveClass(/\bfb-th\b/);
    await expect(keeper).toHaveAttribute('data-id', 'us5-r1c1');
    await expect(keeper).toHaveAttribute('lang', 'de');
    await expect(keeper).toHaveAttribute('align', 'right');
    await expect(page.getByTestId('table-bar-cell-id')).toHaveValue('us5-r1c1');
    await expect(page.getByTestId('table-bar-style')).toHaveValue('hd');
    await expect(page.getByTestId('table-bar-lang')).toHaveValue('de');
    await expect(page.getByTestId('table-bar-td-align')).toHaveValue('right');
    await expect(page.getByTestId('table-bar-colspan')).toHaveValue('3');
    await expect(page.getByTestId('table-bar-rowspan')).toHaveValue('2');
    await undoRedo(page, fixture, merged);

    // The edge case (manual step 3): a block from the merged cell to r3c3 merges into one cell
    // over rows 1-3 and columns 1-3; column 4 keeps r1c4, r2c4 and r3c4.
    await shiftBlock(page, keeper, cell(t1, 'r3c3'));
    await expect.poll(() => highlighted(page)).toEqual(t1.cells('r1c1', 'r3c1', 'r3c2', 'r3c3'));
    await structure(page, 'table.mergeCells');
    const again = await changedFrom(page, merged);
    const all = `${text} r3c1 r3c2 r3c3`;
    expect(tableXml(again, T1)).toBe(
      table(
        tr(
          th(all, ' id="us5-r1c1" style="hd" colspan="3" rowspan="3" align="right" xml:lang="de"') +
            td('r1c4'),
        ),
        tr(td('r2c4')),
        tr(td('r3c4')),
      ),
    );
    await expect(keeper).toHaveAttribute('colspan', '3');
    await expect(keeper).toHaveAttribute('rowspan', '3');
    await expect(keeper).toHaveText(all);
    expect(await gridOf(page, t1.ref)).toMatchObject({ rows: 3, columns: 4 });
    await regular(page, t1.ref);
    await undoRedo(page, merged, again);
  });

  test('sc.1 over the full width: the row the merge empties is removed, and no rowspan is written', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    const t2 = await scenario(page, T2);
    const fixture = await toXml(page);
    await shiftBlock(page, cell(t2, 'r1c1'), cell(t2, 'r2c3'));
    await expect
      .poll(() => highlighted(page))
      .toEqual(t2.cells('r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2', 'r2c3'));
    await structure(page, 'table.mergeCells');
    const merged = await changedFrom(page, fixture);
    const text = 'r1c1 r1c2 r1c3 r2c1 r2c2 r2c3';
    // Decision 1: the second row is left without cells and removed; FR-014: a span of 1 is
    // never written.
    expect(tableXml(merged, T2)).toBe(
      table(tr(td(text, ' colspan="3"')), tr(tds('r3c1', 'r3c2', 'r3c3'))),
    );
    const keeper = cell(t2, 'r1c1');
    await expect(keeper).toHaveAttribute('colspan', '3');
    await expect(keeper).not.toHaveAttribute('rowspan');
    await expect(keeper).toHaveText(text);
    expect(cellRows(tableByRef(await documentOf(page), t2.ref))).toHaveLength(2);
    expect(await gridOf(page, t2.ref)).toMatchObject({ rows: 2, columns: 3 });
    await regular(page, t2.ref);
    await expect(page.getByTestId('status-path')).toHaveText(/\/tr\[1\]\/td\[1\]$/);
    await undoRedo(page, fixture, merged);
  });

  test('sc.2: formatting, a link, a note link, a named style and a picture are kept in reading order; the note body is untouched', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    const t3 = await scenario(page, T3);
    const fixture = await toXml(page);
    const contents = cellContents(tableXml(fixture, T3));
    expect(contents).toEqual([
      '<strong>r1c1</strong>',
      '<a l:href="#t-linked">r1c2</a>',
      'r2c1<a l:href="#us5-note" type="note">[5]</a>',
      '<style name="mark">r2c2</style> <image l:href="#cell.png"/>',
    ]);
    const [first, last] = cellIdsAt(t3.model, [
      [0, 0],
      [1, 1],
    ]);
    await selectBlock(page, first!, last!);
    await expect.poll(() => highlighted(page)).toHaveLength(4);
    await structure(page, 'table.mergeCells');
    const merged = await changedFrom(page, fixture);
    // One cell over the two columns (the second row, emptied, is removed), holding every part
    // unchanged, in reading order, with single spaces between the parts (FR-030; C17).
    expect(tableXml(merged, T3)).toBe(table(tr(td(contents.join(' '), ' colspan="2"'))));
    const keeper = cellById(t3, first!);
    await expect(keeper).toHaveAttribute('colspan', '2');
    await expect(keeper.locator('strong')).toHaveText('r1c1');
    await expect(keeper.locator('[data-testid="body-inline-image"]')).toHaveAttribute(
      'data-href',
      '#cell.png',
    );
    await regular(page, t3.ref);
    // The note links stay in order and the note body is untouched (the spec's edge case).
    expect(sectionXml(merged, 'us5-note')).toBe(sectionXml(fixture, 'us5-note'));
    await undoRedo(page, fixture, merged);
  });

  test('sc.4: a merge that removes a link target asks first; No changes nothing and records no step; Yes merges and Validate lists the broken link', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t4 = await scenario(page, T4);
    const doc = await documentOf(page);
    const label = paragraphOf(doc, T4).attrs!.nodeId!;
    const linker = paragraphOf(doc, LINKER).attrs!.nodeId!;
    const fixture = await toXml(page);
    const typedLabel = `${T4}z`;

    // A step to compare with: z typed at the end of the paragraph before the table.
    await caretIn(page, label, T4.length);
    await focusEditor(page);
    await page.keyboard.type('z');
    const typed = await changedFrom(page, fixture);
    expect(tableXml(typed, typedLabel)).toBe(tableXml(fixture, T4));

    // The four cells and Merge cells: the question names the one link (FR-015).
    const dialog = page.getByTestId('dialog-table-link-targets');
    await selectBlock(page, t4.cell('r1c1'), t4.cell('r2c2'));
    await structure(page, 'table.mergeCells');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('dialog-table-link-targets-text')).toHaveText(
      await pageText(page, 'tables.msg.linkTargets', { count: 1 }),
    );
    // No: nothing changes, and the declined merge recorded no step - Undo takes the z.
    await page.getByTestId('dialog-table-link-targets-button-no').click();
    await expect(dialog).toHaveCount(0);
    expect(await toXml(page)).toBe(typed);
    await undoRedo(page, fixture, typed);

    // Merge cells again and Yes: merged, the target's cell gone.
    await selectBlock(page, t4.cell('r1c1'), t4.cell('r2c2'));
    await structure(page, 'table.mergeCells');
    await expect(dialog).toBeVisible();
    await page.getByTestId('dialog-table-link-targets-button-yes').click();
    await expect(dialog).toHaveCount(0);
    const merged = await changedFrom(page, typed);
    expect(tableXml(merged, typedLabel)).toBe(table(tr(td('r1c1 r1c2 r2c1 r2c2', ' colspan="2"'))));
    expect(merged).not.toContain('id="us5-target"');
    // F8: the paragraph's link is listed as a broken internal link (US5 sc.4).
    const dangling = page.locator(
      `[data-testid^="validation-issue-"][data-code="link.dangling"][data-node-id="${linker}"]`,
    );
    await focusEditor(page);
    await page.keyboard.press('F8');
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    await expect(dangling).toHaveCount(1);

    // Undo: the table and its target back, and F8 lists no such issue.
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(typed);
    await focusEditor(page);
    await page.keyboard.press('F8');
    await expect(dangling).toHaveCount(0);
    // Redo: merged again, without a question.
    await menu(page, 'edit', 'redo');
    await expect.poll(() => toXml(page)).toBe(merged);
    await expect(dialog).toHaveCount(0);
  });

  /* ---------------------------------------------------------------------- */
  /* Split, reasons and pictures (T101)                                     */
  /* ---------------------------------------------------------------------- */

  test('sc.5: Split cell turns a header cell over 3 columns and 2 rows into six single cells; the top-left one keeps the content and attributes', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    const t5 = await scenario(page, T5);
    const fixture = await toXml(page);
    expect(tableXml(fixture, T5)).toBe(
      table(
        tr(
          th('m', ' id="us5-m" style="hd" colspan="3" rowspan="2" align="center" xml:lang="fr"') +
            td('d'),
        ),
        tr(td('e')),
      ),
    );
    // The caret in m, after its text.
    await caretIn(page, t5.cell('m'), 1);
    await structure(page, 'table.splitCell');
    const split = await changedFrom(page, fixture);
    // m keeps its content and every attribute but the spans; the five new cells are empty
    // header cells with its alignment and language, without id or style (FR-016).
    const piece = th('', ' align="center" xml:lang="fr"');
    expect(tableXml(split, T5)).toBe(
      table(
        tr(
          th('m', ' id="us5-m" style="hd" align="center" xml:lang="fr"') + piece + piece + td('d'),
        ),
        tr(piece + piece + piece + td('e')),
      ),
    );
    const m = cell(t5, 'm');
    await expect(m).not.toHaveAttribute('colspan');
    await expect(m).not.toHaveAttribute('rowspan');
    await expect(m).toHaveAttribute('data-id', 'us5-m');
    await expect(m).toHaveText('m');
    const rows = cellRows(tableByRef(await documentOf(page), t5.ref));
    expect(rows.map((row) => row.map((one) => `${one.type}:${textOf(one)}`))).toEqual([
      ['th:m', 'th:', 'th:', 'td:d'],
      ['th:', 'th:', 'th:', 'td:e'],
    ]);
    for (const one of [rows[0]![1]!, rows[0]![2]!, rows[1]![0]!, rows[1]![1]!, rows[1]![2]!]) {
      const element = cellById(t5, one.attrs!.nodeId!);
      await expect(element).toHaveClass(/\bfb-th\b/);
      await expect(element).toHaveText('');
      await expect(element).toHaveAttribute('align', 'center');
      await expect(element).toHaveAttribute('lang', 'fr');
      await expect(element).not.toHaveAttribute('data-id');
      await expect(element).not.toHaveAttribute('data-style');
    }
    // d and e still in column 4 of a regular 2 × 4 grid; the caret still in m at its offset.
    expect(await gridOf(page, t5.ref)).toMatchObject({ rows: 2, columns: 4 });
    await regular(page, t5.ref);
    expect(await headPoint(page)).toEqual({ nodeId: t5.cell('m'), offset: 1 });
    await undoRedo(page, fixture, split);
  });

  test('sc.6 and U38: in a single cell, with a block and for a selection that leaves the table, Split cell and Merge cells are unavailable with their reasons', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    const t4 = await scenario(page, T4);
    const t5 = await scenario(page, T5);
    const fixture = await toXml(page);
    // The caret in the single cell d.
    await caretIn(page, t5.cell('d'));
    const split = await structureEntry(page, 'table.splitCell');
    await unavailable(split, 'Split cell: the cell is not merged');
    await unavailable(
      page.getByTestId('menu-add-tableStructure-mergeCells'),
      'Merge cells: select a block of at least two cells',
    );
    await closeMenus(page, 'menu-add-popup');

    // A block selected: Split cell asks for a single merged cell; Merge cells is available.
    await selectBlock(page, t5.cell('d'), t5.cell('e'));
    await unavailable(
      await structureEntry(page, 'table.splitCell'),
      'Split cell: select a single merged cell',
    );
    await expect(page.getByTestId('menu-add-tableStructure-mergeCells')).not.toHaveAttribute(
      'aria-disabled',
    );
    await closeMenus(page, 'menu-add-popup');

    // A right-click in a single cell: the context menu's entry carries the same title.
    await caretIn(page, t5.cell('e'));
    await rightClick(page, cell(t5, 'd'));
    await page.getByTestId('context-menu-tableStructure').click();
    await expect(page.getByTestId('context-menu-tableStructure-popup')).toBeVisible();
    await unavailable(
      page.getByTestId('context-menu-tableStructure-splitCell'),
      'Split cell: the cell is not merged',
    );
    await closeMenus(page, 'context-menu');

    // U38 (completing T088's edge step): a selection from a cell's text into the paragraph
    // after the table is no block, and Merge cells refuses it (`mixedSelection`).
    const linker = paragraphOf(await documentOf(page), LINKER).attrs!.nodeId!;
    const placed = await page.evaluate(
      ([anchor, head]) => window.__mfbeTest!.scripts!.selectRange(anchor, head),
      [
        { nodeId: t4.cell('r2c2'), offset: 2 },
        { nodeId: linker, offset: 3 },
      ] as const,
    );
    expect(placed).toBe(true);
    await expect(page.locator('.mfbe-cell-selected')).toHaveCount(0);
    await unavailable(
      await structureEntry(page, 'table.mergeCells'),
      'Merge cells: the selection reaches outside the table',
    );
    await closeMenus(page, 'menu-add-popup');
    // Nothing of it changed the book.
    expect(await toXml(page)).toBe(fixture);
  });

  test('FR-030: a picture stays in the top-left piece of a split and comes back by a merge (c07, c08); four merged pictures keep their order (c22)', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, IMAGES);
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    const image = (href: string) => `<image l:href="${href}"/>`;

    // c07, a picture under colspan: split, its picture in the top-left piece, the new cell
    // empty; then the two pieces merged give the table as it was read.
    const c07Picture = cellIdsAt(tableById(doc, 'c07'), [[0, 0]])[0]!;
    await caretIn(page, c07Picture);
    await structure(page, 'table.splitCell');
    const c07Split = await changedFrom(page, fixture);
    expect(tableXmlById(c07Split, 'c07')).toBe(
      `<table id="c07">${tr(td(image('#pic-400x300.png')) + td() + td('r1c3'))}${tr(
        tds('r2c1', 'r2c2', 'r2c3'),
      )}</table>`,
    );
    const c07Piece = cellIdsAt(tableById(await documentOf(page), 'c07'), [[0, 1]])[0]!;
    expect(await hrefsIn(page, c07Picture)).toEqual(['#pic-400x300.png']);
    await expect(picturesIn(page, c07Piece)).toHaveCount(0);
    await expect(page.locator(`td[data-node-id="${c07Piece}"]`)).toHaveText('');
    await undoRedo(page, fixture, c07Split);
    await selectBlock(page, c07Picture, c07Piece);
    await structure(page, 'table.mergeCells');
    const c07Merged = await changedFrom(page, c07Split);
    expect(tableXmlById(c07Merged, 'c07')).toBe(tableXmlById(fixture, 'c07'));
    expect(await hrefsIn(page, c07Picture)).toEqual(['#pic-400x300.png']);
    await undoRedo(page, c07Split, c07Merged);

    // c08, a picture under rowspan: the same, down the column.
    const c08Picture = cellIdsAt(tableById(doc, 'c08'), [[0, 0]])[0]!;
    await caretIn(page, c08Picture);
    await structure(page, 'table.splitCell');
    const c08Split = await changedFrom(page, c07Merged);
    expect(tableXmlById(c08Split, 'c08')).toBe(
      `<table id="c08">${tr(td(image('#pic-120x90.png')) + td('r1c2'))}${tr(td() + td('r2c2'))}</table>`,
    );
    const c08Piece = cellIdsAt(tableById(await documentOf(page), 'c08'), [[1, 0]])[0]!;
    expect(await hrefsIn(page, c08Picture)).toEqual(['#pic-120x90.png']);
    await expect(picturesIn(page, c08Piece)).toHaveCount(0);
    await undoRedo(page, c07Merged, c08Split);
    await selectBlock(page, c08Picture, c08Piece);
    await structure(page, 'table.mergeCells');
    const c08Merged = await changedFrom(page, c08Split);
    expect(tableXmlById(c08Merged, 'c08')).toBe(tableXmlById(fixture, 'c08'));
    expect(await hrefsIn(page, c08Picture)).toEqual(['#pic-120x90.png']);
    await undoRedo(page, c08Split, c08Merged);

    // c22, the 3 × 3 gallery: its 2 × 2 block merged - one cell holding the four pictures in
    // reading order, with single spaces between them.
    const c22 = tableById(doc, 'c22');
    const [first, , , last] = cellIdsAt(c22, [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    await selectBlock(page, first!, last!);
    await structure(page, 'table.mergeCells');
    const c22Merged = await changedFrom(page, c08Merged);
    const hrefs = [
      '#pic-400x300.png',
      '#pic-200x200-alpha.png',
      '#pic-120x90.png',
      '#pic-4000x3000.png',
    ];
    expect(tableXmlById(c22Merged, 'c22')).toBe(
      `<table id="c22">${tr(
        td(hrefs.map(image).join(' '), ' colspan="2" rowspan="2"') +
          td(image('#pic-2000x2000.png')),
      )}${tr(td(image('#pic-48x48.png')))}${tr(
        td(image('#pic-800x600.png')) + td(image('#pic-8x6.jpg')) + td(image('#pic-1600x1200.png')),
      )}</table>`,
    );
    expect(await hrefsIn(page, first!)).toEqual(hrefs);
    await regular(page, c22.attrs!.nodeId!);
    await undoRedo(page, c08Merged, c22Merged);
  });

  test('U8: nested named styles, a comment and a note link survive a merge in reading order and stay in the top-left cell through a split (FR-067, FR-069)', async ({
    core,
    page,
  }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us5-'));
    try {
      await openBook(core, page, u8Book(dir));
      const target = await scenario(page, U8_LABEL);
      const fixture = await toXml(page);
      const contents = [
        '<style name="a"><style name="b">x</style></style>',
        '<!--kept-->',
        'n<a l:href="#n1" type="note">1</a>',
        'plain',
      ];
      expect(cellContents(tableXml(fixture, U8_LABEL))).toEqual(contents);
      const [first, last] = cellIdsAt(target.model, [
        [0, 0],
        [1, 1],
      ]);
      await selectBlock(page, first!, last!);
      await structure(page, 'table.mergeCells');
      const merged = await changedFrom(page, fixture);
      // The nested styles outer first, the comment and the note link, in reading order.
      expect(tableXml(merged, U8_LABEL)).toBe(table(tr(td(contents.join(' '), ' colspan="2"'))));
      await regular(page, target.ref);
      await undoRedo(page, fixture, merged);

      // Split again: everything stays in the top-left cell, the new cell is empty.
      await caretIn(page, first!);
      await structure(page, 'table.splitCell');
      const split = await changedFrom(page, merged);
      expect(tableXml(split, U8_LABEL)).toBe(table(tr(td(contents.join(' ')) + td())));
      await regular(page, target.ref);
      await undoRedo(page, merged, split);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
