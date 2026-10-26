/**
 * Feature 006, User Story 6 - Header cells, header rows and header columns (T108; spec FR-017
 * to FR-019; US6 sc.1 to sc.4; C14, C60; U22; SC-007, SC-009; quickstart §6 "Manual check" and
 * "Automated"). The five header commands run from *Add → Table structure*
 * (`structure(page, 'table.toggleHeaderCell')`, which takes the command id, so that
 * `tools/parity-check.mjs` finds every id quoted here).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile`, after `settings.set` put the light theme without Fast Mode (sc.4's
 * colours are that theme's, `ui/src/editor/styles.css`, `ui/src/app/layout.css`; T078 and T185
 * switch Fast Mode on in the worker's shared core), and works on the user story 6 tables of its
 * "Scenario tables" section (T014), each found by the paragraph that names its scenarios and by
 * the `data-node-id` of its `[data-testid=body-table]`:
 *  (1) "US6 sc.1, sc.3": `[th r1c1, r1c2, r1c3] / [s colspan 2, r2c3] / [r3c1, r3c2, r3c3]`, `s`
 *      with an `id`, a `style`, an `align`, a `valign` and an `xml:lang`;
 *  (2) "US6 sc.2": 3 × 3 normal cells;
 *  (3) "US6 sc.4": `[th r1c1, th r1c2 align="left", th r1c3] / {right}[th r2c1, th r2c2, th
 *      r2c3] / [r3c1, r3c2, r3c3]`.
 *
 * A converted cell's model JSON (`__mfbeTest.scripts.document()`, by its `nodeId`) equals the
 * one before apart from its `type` - content, `id`, `style`, `lang`, spans, `align`, `valign` -,
 * its `data-node-id` stays and the grid summary (`__mfbeTest.tables.grid`) stays, since a kind
 * change moves no position (FR-019). After every command that changes the table, Edit → Undo
 * gives back the whole document XML byte for byte and Edit → Redo the command's result
 * (`undoRedo`; SC-007, U22); the next command starts from that result unless a test says
 * otherwise.
 */

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
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

/** The labels of the scenario tables (the paragraphs before them in `tables.fb2`). */
const T1 = 'US6 sc.1, sc.3';
const T2 = 'US6 sc.2';
const T3 = 'US6 sc.4';

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

/** The model node whose `nodeId` is `nodeId`. */
function nodeById(doc: DocJson, nodeId: string): Json {
  for (const body of doc.bodies) {
    for (const { node } of walk(body)) if (node.attrs?.nodeId === nodeId) return node;
  }
  throw new Error(`no node ${nodeId}`);
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

/** The elements whose white space the writer indents: their tags take none around them. */
const BLOCK_TAG =
  '(?:table|tr|td|th|p|section|title|body|subtitle|epigraph|cite|poem|stanza|v|text-author|annotation|empty-line)';
const AFTER_BLOCK_TAG = new RegExp(`(<\\/?${BLOCK_TAG}\\b[^>]*>)\\s+(?=<)`, 'g');
const BEFORE_BLOCK_TAG = new RegExp(`>\\s+(?=<\\/?${BLOCK_TAG}\\b)`, 'g');

/** The XML with the indentation around block elements removed. */
function flatXml(xml: string): string {
  return xml.replace(AFTER_BLOCK_TAG, '$1').replace(BEFORE_BLOCK_TAG, '>');
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

/** A row of the expected XML. */
function tr(cells: string, attrs = ''): string {
  return `<tr${attrs}>${cells}</tr>`;
}

function td(text: string, attrs = ''): string {
  return `<td${attrs}>${text}</td>`;
}

function th(text: string, attrs = ''): string {
  return `<th${attrs}>${text}</th>`;
}

function table(...rows: string[]): string {
  return `<table>${rows.join('')}</table>`;
}

/** Cells holding their names, `td` unless the name is in `headers`. */
function cells(names: readonly string[], headers: readonly string[] = []): string {
  return names.map((name) => (headers.includes(name) ? th(name) : td(name))).join('');
}

/** Table (1) of the fixture, as the writer gives it; `headers` names its header cells. */
const S_ATTRS = ' id="us6-s" style="wide" colspan="2" align="center" valign="middle" xml:lang="de"';
function t1Xml(headers: readonly string[]): string {
  return table(
    tr(cells(['r1c1', 'r1c2', 'r1c3'], headers)),
    tr((headers.includes('s') ? th('s', S_ATTRS) : td('s', S_ATTRS)) + cells(['r2c3'], headers)),
    tr(cells(['r3c1', 'r3c2', 'r3c3'], headers)),
  );
}

/** Table (2) of the fixture, `headers` naming its header cells. */
function t2Xml(headers: readonly string[]): string {
  return table(
    ...[1, 2, 3].map((r) =>
      tr(
        cells(
          [1, 2, 3].map((c) => `r${r}c${c}`),
          headers,
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** Runs `commandId` from *Add → Table structure*: `menu-add-tableStructure-<name>`. */
async function structure(page: Page, commandId: string): Promise<void> {
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-tableStructure').click();
  await expect(page.getByTestId('menu-add-tableStructure-popup')).toBeVisible();
  const entry = page.getByTestId(
    `menu-add-tableStructure-${commandId.slice(commandId.indexOf('.') + 1)}`,
  );
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

/** The cell element of the table whose text was `name` when the scenario was read. */
function cell(target: Scenario, name: string): Locator {
  return target.element.locator(`:is(td.fb-td, th.fb-th)[data-node-id="${target.cell(name)}"]`);
}

/** The cell elements of a kind: `th.fb-th` or `td.fb-td` with the cells' node ids. */
async function expectKinds(target: Scenario, headers: readonly string[]): Promise<void> {
  for (const row of cellRows(target.model)) {
    for (const one of row) {
      const name = textOf(one);
      const kind = headers.includes(name) ? 'th' : 'td';
      const element = target.element.locator(
        `${kind}.fb-${kind}[data-node-id="${one.attrs!.nodeId!}"]`,
      );
      await expect(element, `${name} is a ${kind}`).toHaveCount(1);
    }
  }
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

/** The Body selection's head, as a model point. */
async function headPoint(page: Page): Promise<ModelPoint | undefined> {
  return page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection()?.head);
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

/**
 * A click on a cell's text end: the caret there. The first click after File → Open can come
 * while the Body view still settles, so the click is repeated until the selection's head stands
 * in the cell (as `us4-table-blocks.spec.ts` does).
 */
async function clickEnd(page: Page, element: Locator): Promise<void> {
  const nodeId = await element.getAttribute('data-node-id');
  await expect(async () => {
    await element.scrollIntoViewIfNeeded();
    const box = (await element.boundingBox())!;
    await element.click({ position: { x: box.width - 3, y: box.height / 2 } });
    await page.keyboard.press(LINE_END);
    expect((await headPoint(page))?.nodeId).toBe(nodeId);
  }).toPass({ timeout: 15_000 });
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
 * The model cells with these node ids in the live document; each converted one (`converted`)
 * equals its model in `before` apart from its `type`, which is now `kind`, and every other one
 * equals its model in `before` (FR-019).
 */
async function expectKindOnly(
  page: Page,
  before: DocJson,
  converted: readonly string[],
  kept: readonly string[],
  kind: 'td' | 'th',
): Promise<void> {
  const now = await documentOf(page);
  for (const nodeId of converted) {
    const was = nodeById(before, nodeId);
    const is = nodeById(now, nodeId);
    expect(is.type, `${textOf(was)} becomes a ${kind}`).toBe(kind);
    expect({ ...is, type: was.type }, `${textOf(was)} keeps its content and attributes`).toEqual(
      was,
    );
  }
  for (const nodeId of kept) {
    const was = nodeById(before, nodeId);
    expect(nodeById(now, nodeId), `${textOf(was)} is unchanged`).toEqual(was);
  }
}

/** What sc.4 reads of a cell: its kind, weight, background and alignment, and its text's place. */
interface CellLook {
  tag: string;
  fontWeight: string;
  background: string;
  textAlign: string;
  /** The content box's left and right edges. */
  contentLeft: number;
  contentRight: number;
  /** The left and right edges of the cell's text. */
  textLeft: number;
  textRight: number;
}

/** The page code that measures the cells (the e2e project has no DOM library). */
const CELL_LOOK = `((ids) => ids.map((id) => {
  const cell = document.querySelector(
    '[data-testid="body-editor"] :is(td, th)[data-node-id="' + id + '"]');
  if (!cell) return null;
  const style = getComputedStyle(cell);
  const box = cell.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(cell);
  const text = range.getBoundingClientRect();
  return {
    tag: cell.tagName.toLowerCase(),
    fontWeight: style.fontWeight,
    background: style.backgroundColor,
    textAlign: style.textAlign,
    contentLeft: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
    contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    textLeft: text.left,
    textRight: text.right,
  };
}))`;

async function looksOf(page: Page, ids: readonly string[]): Promise<CellLook[]> {
  const looks = await page.evaluate<(CellLook | null)[]>(`${CELL_LOOK}(${JSON.stringify(ids)})`);
  looks.forEach((look, index) => expect(look, `the cell ${ids[index]}`).not.toBeNull());
  return looks as CellLook[];
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US6 (feature 006) - header cells, header rows and header columns', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // Before the page loads: the light theme without Fast Mode, whose colours sc.4 reads, and
    // the AI panel hidden, so the views have their full width.
    await core.rpc('settings.set', {
      patch: { view: { theme: 'light', fastMode: false }, session: { aiPanelVisible: false } },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    // A `null` member returns to its default (`core/src/settings/settings.cpp`, merge_patch).
    await core
      .rpc('settings.set', {
        patch: { view: { theme: null, fastMode: null }, session: { aiPanelVisible: null } },
      })
      .catch(() => {});
  });

  test('sc.1: Toggle header cell makes the caret’s cell a header cell with the same content and attributes, and back; with a block, the head cell only', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    expect(tableXml(fixture, T1)).toBe(t1Xml(['r1c1']));
    const original = await documentOf(page);
    const summary = await gridOf(page, t1.ref);
    expect(summary).toMatchObject({ rows: 3, columns: 3, shortRows: 0, overlaps: 0, pastEnd: 0 });
    const s = t1.cell('s');
    const others = t1.cells('r1c1', 'r1c2', 'r1c3', 'r2c3', 'r3c1', 'r3c2', 'r3c3');

    // The caret in s, after its text: s becomes a th.fb-th with its node id, its content and
    // every attribute - id, style, xml:lang, colspan 2, align, valign -; the caret keeps its
    // place; no other cell changes.
    await caretIn(page, s, 1);
    await structure(page, 'table.toggleHeaderCell');
    const header = await changedFrom(page, fixture);
    expect(tableXml(header, T1)).toBe(t1Xml(['r1c1', 's']));
    await expectKindOnly(page, original, [s], others, 'th');
    await expectKinds(t1, ['r1c1', 's']);
    await expect(cell(t1, 's')).toHaveAttribute('colspan', '2');
    await expect(cell(t1, 's')).toHaveAttribute('data-id', 'us6-s');
    await expect(cell(t1, 's')).toHaveAttribute('lang', 'de');
    await expect(cell(t1, 's')).toHaveAttribute('align', 'center');
    await expect(cell(t1, 's')).toHaveAttribute('valign', 'middle');
    expect(await gridOf(page, t1.ref)).toEqual(summary);
    expect(await headPoint(page)).toEqual({ nodeId: s, offset: 1 });
    await undoRedo(page, fixture, header);

    // Again: s is a td equal to the original - the book as it was read.
    await caretIn(page, s, 1);
    await structure(page, 'table.toggleHeaderCell');
    const back = await changedFrom(page, header);
    expect(back).toBe(fixture);
    expect(nodeById(await documentOf(page), s)).toEqual(nodeById(original, s));
    await expectKinds(t1, ['r1c1']);
    expect(await gridOf(page, t1.ref)).toEqual(summary);
    await undoRedo(page, header, back);

    // A block from r2c3 to r3c3 (a click on r2c3, a Shift+click on r3c3): the head cell r3c3
    // alone becomes a header cell (data-model §4.5).
    await shiftBlock(page, cell(t1, 'r2c3'), cell(t1, 'r3c3'));
    await expect.poll(() => highlighted(page)).toEqual(t1.cells('r2c3', 'r3c3'));
    await structure(page, 'table.toggleHeaderCell');
    const head = await changedFrom(page, back);
    expect(tableXml(head, T1)).toBe(t1Xml(['r1c1', 'r3c3']));
    await expectKindOnly(
      page,
      original,
      [t1.cell('r3c3')],
      t1.cells('r1c1', 'r1c2', 'r1c3', 's', 'r2c3', 'r3c1', 'r3c2'),
      'th',
    );
    await expectKinds(t1, ['r1c1', 'r3c3']);
    expect(await gridOf(page, t1.ref)).toEqual(summary);
    await undoRedo(page, back, head);
  });

  test('sc.2: Make header cells converts every cell of a block, a second time commits nothing; Make normal cells converts them back', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t2 = await scenario(page, T2);
    const fixture = await toXml(page);
    expect(tableXml(fixture, T2)).toBe(t2Xml([]));
    const original = await documentOf(page);
    const summary = await gridOf(page, t2.ref);
    const block = t2.cells('r1c1', 'r1c2', 'r2c1', 'r2c2');
    const outside = t2.cells('r1c3', 'r2c3', 'r3c1', 'r3c2', 'r3c3');

    // A click on r1c1 and a Shift+click on r2c2: four cells carry mfbe-cell-selected.
    await shiftBlock(page, cell(t2, 'r1c1'), cell(t2, 'r2c2'));
    await expect.poll(() => highlighted(page)).toEqual(block);
    await structure(page, 'table.makeHeaderCells');
    const made = await changedFrom(page, fixture);
    const four = ['r1c1', 'r1c2', 'r2c1', 'r2c2'];
    expect(tableXml(made, T2)).toBe(t2Xml(four));
    await expectKindOnly(page, original, block, outside, 'th');
    await expectKinds(t2, four);
    expect(await gridOf(page, t2.ref)).toEqual(summary);
    // The block stays selected.
    await expect.poll(() => highlighted(page)).toEqual(block);

    // Make header cells again: nothing to convert, nothing committed - the XML is unchanged,
    // and one Undo restores the original table, one Redo the four header cells (FR-045).
    await structure(page, 'table.makeHeaderCells');
    expect(await toXml(page)).toBe(made);
    await undoRedo(page, fixture, made);

    // Make normal cells on the block: the four cells are td again, equal to the original.
    await shiftBlock(page, cell(t2, 'r1c1'), cell(t2, 'r2c2'));
    await expect.poll(() => highlighted(page)).toEqual(block);
    await structure(page, 'table.makeNormalCells');
    const normal = await changedFrom(page, made);
    expect(normal).toBe(fixture);
    await expectKindOnly(page, original, [], [...block, ...outside], 'td');
    await expectKinds(t2, []);
    expect(await gridOf(page, t2.ref)).toEqual(summary);
    await undoRedo(page, made, normal);
  });

  test('sc.3: Toggle header row makes a mixed row header cells and then normal cells; Toggle header column converts the merged cell once', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    const original = await documentOf(page);
    const summary = await gridOf(page, t1.ref);
    const row1 = t1.cells('r1c1', 'r1c2', 'r1c3');
    const rest = t1.cells('s', 'r2c3', 'r3c1', 'r3c2', 'r3c3');

    // The caret in r1c2: row 1 mixes kinds (r1c1 is a th), so all three become header cells.
    await caretIn(page, t1.cell('r1c2'));
    await structure(page, 'table.toggleHeaderRow');
    const headers = await changedFrom(page, fixture);
    expect(tableXml(headers, T1)).toBe(t1Xml(['r1c1', 'r1c2', 'r1c3']));
    await expectKindOnly(
      page,
      original,
      t1.cells('r1c2', 'r1c3'),
      [t1.cell('r1c1'), ...rest],
      'th',
    );
    await expectKinds(t1, ['r1c1', 'r1c2', 'r1c3']);
    expect(await gridOf(page, t1.ref)).toEqual(summary);
    await undoRedo(page, fixture, headers);

    // Again: all of them were header cells, so all three become normal cells, r1c1 too.
    await caretIn(page, t1.cell('r1c2'));
    await structure(page, 'table.toggleHeaderRow');
    const normal = await changedFrom(page, headers);
    expect(tableXml(normal, T1)).toBe(t1Xml([]));
    await expectKindOnly(page, original, [t1.cell('r1c1')], [...row1.slice(1), ...rest], 'td');
    await expectKinds(t1, []);
    expect(await gridOf(page, t1.ref)).toEqual(summary);
    await undoRedo(page, headers, normal);

    // Two Undos give back the fixture's XML.
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(headers);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(fixture);

    // The caret in r1c1: Toggle header column takes column 1 - r1c1, s and r3c1 -, s, which
    // also covers column 2, converted once; r1c2, r2c3 and r3c2 keep their kind.
    await caretIn(page, t1.cell('r1c1'));
    await structure(page, 'table.toggleHeaderColumn');
    const column = await changedFrom(page, fixture);
    expect(tableXml(column, T1)).toBe(t1Xml(['r1c1', 's', 'r3c1']));
    await expectKindOnly(
      page,
      original,
      t1.cells('s', 'r3c1'),
      t1.cells('r1c1', 'r1c2', 'r1c3', 'r2c3', 'r3c2', 'r3c3'),
      'th',
    );
    await expectKinds(t1, ['r1c1', 's', 'r3c1']);
    expect(await gridOf(page, t1.ref)).toEqual(summary);
    await undoRedo(page, fixture, column);
  });

  test('sc.4: header cells are bold and shaded, centred unless the cell or its row sets an alignment, which is shown as written', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const t3 = await scenario(page, T3);
    const centred = t3.cells('r1c1', 'r1c3');
    const left = t3.cell('r1c2');
    const right = t3.cells('r2c1', 'r2c2', 'r2c3');
    const ids = [...centred, left, ...right];
    const looks = await looksOf(page, ids);
    looks.forEach((look, index) => {
      const id = ids[index]!;
      expect(look.tag, id).toBe('th');
      // Bold and shaded: `--mfbe-fb-th-bg` of the light theme (`ui/src/app/layout.css`).
      expect(look.fontWeight, id).toBe('700');
      expect(look.background, id).toBe('rgb(117, 255, 255)');
    });
    const [r1c1, r1c3, r1c2, ...row2] = looks;
    expect(r1c1!.textAlign).toBe('center');
    expect(r1c3!.textAlign).toBe('center');
    expect(r1c2!.textAlign, 'the th with align="left"').toBe('left');
    // The row's align="right" reaches its header cells through inheritance: Chromium maps the
    // presentational hint of a table row's `align` to its -webkit- keyword.
    for (const look of row2)
      expect(look.textAlign, 'a th of the row with align="right"').toMatch(/^(-webkit-)?right$/);

    // The text's place, as research R6.7's probe P12 measured it. The fixture's cells are as
    // wide as their bold text, which leaves no room to align in; a style of the test's own
    // widens the table, so every cell has room on both sides of its text.
    await page.addStyleTag({
      content: `[data-testid="body-table"][data-node-id="${t3.ref}"] { width: 36em; }`,
    });
    const placed = await looksOf(page, ids);
    const [p11, p13, p12, ...p2] = placed;
    const gaps = (look: CellLook) => ({
      left: look.textLeft - look.contentLeft,
      right: look.contentRight - look.textRight,
    });
    // The left-aligned text starts at its cell's content-box left.
    expect(Math.abs(gaps(p12!).left), 'the align="left" text at the left').toBeLessThanOrEqual(1);
    expect(gaps(p12!).right, 'room on the right of it').toBeGreaterThan(10);
    // The right row's text ends at its content-box right.
    for (const look of p2) {
      expect(Math.abs(gaps(look).right), 'the right row’s text at the right').toBeLessThanOrEqual(
        1,
      );
      expect(gaps(look).left, 'room on the left of it').toBeGreaterThan(10);
    }
    // A centred cell's gaps on the left and on the right are equal.
    for (const look of [p11!, p13!]) {
      const { left: before, right: after } = gaps(look);
      expect(Math.abs(before - after), 'a centred text').toBeLessThanOrEqual(1);
      expect(before, 'room on both sides').toBeGreaterThan(10);
    }
  });
});
