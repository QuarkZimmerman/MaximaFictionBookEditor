/**
 * Feature 006, User Story 7 - Every table, row and cell attribute, for one cell or a block (T114;
 * spec FR-020 to FR-023, FR-045; US7 sc.1 to sc.5; U7, U16, U22; C14, C20; SC-007, SC-009;
 * research R2.8, R6.7; quickstart §7 "Manual check" and "Automated"). The Table bar edits the
 * attributes of the caret's cell or of every cell of a dragged block: *Cell align*, *Cell valign*,
 * *Cell style* and *Cell language* reach every cell of the block and *Row align* every row it
 * covers, *Cell ID* the head cell - the cell where the drag ended -; a field whose cells differ is
 * empty with `data-mixed="true"`; ids must be XML names no other element of the book uses and
 * languages language tags, a refusal naming its reason in the status bar and restoring the field.
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile` and works on the user story 7 tables of its "Scenario tables" (T014),
 * each found by the paragraph before it and by the `data-node-id` of its `body-table`:
 *  (1) "US7 sc.1 to sc.4, manual step 7": 4 × 3 normal cells `r1c1` … `r4c3`, `r2c3` holding a
 *      long sentence;
 *  (2) "US7 manual step 7 (a header row)": `[th r1c1, th r1c2, th r1c3] / [r2c1, r2c2, r2c3]`;
 *  (3) "Cell languages (US7 sc.5; FR-020).", in "Cells and formatting": `[th Zelle xml:lang de,
 *      th Colour en-GB] / [Клітинка uk, Cella la]`.
 * The XML is `__mfbeTest.scripts.toXml()`, the Source view's text. After every field change one
 * Edit → Undo gives back the whole document XML byte for byte and one Edit → Redo the change
 * (`undoRedo`; SC-007, U22); the next step starts from that result unless a test says otherwise.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageAnyPattern, pageLang, uiText } from './fixtures/i18n';

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
      grid(tableRef: string): unknown;
    };
  };
};

const TABLES = fixtureBook('tables.fb2');
const MANY_SECTIONS = fixtureBook('many-sections.fb2');

/** The labels of the scenario tables (the paragraphs before them in `tables.fb2`). */
const T1 = 'US7 sc.1 to sc.4, manual step 7';
const T2 = 'US7 manual step 7 (a header row)';
const LANGS = 'Cell languages (US7 sc.5; FR-020).';

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

/** The model cells of a table, row by row. */
function cellRows(table: Json): Json[][] {
  return (table.content ?? [])
    .filter((row) => row.type === 'tr')
    .map((row) => (row.content ?? []).filter((cell) => cell.type === 'td' || cell.type === 'th'));
}

/** The cell of `table` whose text starts with `text`. */
function cellOf(table: Json, text: string): Json {
  for (const row of cellRows(table)) {
    for (const cell of row) if (textOf(cell).startsWith(text)) return cell;
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

/** The attributes of a cell as the writer orders them: id, style, align, valign, xml:lang. */
interface CellAttrs {
  id?: string;
  style?: string;
  align?: string;
  valign?: string;
  lang?: string;
}

function cellAttrs(attrs: CellAttrs): string {
  return (
    (attrs.id ? ` id="${attrs.id}"` : '') +
    (attrs.style ? ` style="${attrs.style}"` : '') +
    (attrs.align ? ` align="${attrs.align}"` : '') +
    (attrs.valign ? ` valign="${attrs.valign}"` : '') +
    (attrs.lang ? ` xml:lang="${attrs.lang}"` : '')
  );
}

const LONG =
  'r2c3 holds a long sentence that wraps over several lines in a narrow window, so that the cells beside it are taller than their text and show where their vertical alignment puts it.';

/**
 * Table (1) as the writer gives it: `cell(name)` gives a cell's attributes (`r2c3` stands for
 * the long sentence), `row(r)` the `align` of row r (from 1).
 */
function t1Xml(
  cell: (name: string) => CellAttrs = () => ({}),
  row: (r: number) => string | undefined = () => undefined,
): string {
  const rows = [1, 2, 3, 4].map((r) => {
    const align = row(r);
    const cells = [1, 2, 3]
      .map((c) => {
        const name = `r${r}c${c}`;
        return `<td${cellAttrs(cell(name))}>${name === 'r2c3' ? LONG : name}</td>`;
      })
      .join('');
    return `<tr${align ? ` align="${align}"` : ''}>${cells}</tr>`;
  });
  return `<table>${rows.join('')}</table>`;
}

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

/** `file` through File → Open and the queued native dialog. */
async function openFile(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await menu(page, 'file', 'open');
  await waitForBook(page, file);
  await hooksReady(page);
}

/** The application, then `file`. */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.openApp(page);
  await openFile(core, page, file);
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

/** One of the scenario tables: its label, its reference and its cells' node ids by text. */
interface Scenario {
  label: string;
  /** The table's `nodeId`, the `data-node-id` of its `body-table`. */
  ref: string;
  /** The `body-table` element. */
  element: Locator;
  cell(text: string): string;
  cells(...texts: string[]): string[];
}

async function scenario(page: Page, label: string): Promise<Scenario> {
  const model = tableAfter(await documentOf(page), label);
  const ref = model.attrs!.nodeId!;
  const element = page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`);
  await expect(element, `the table after "${label}" in the Body view`).toHaveCount(1);
  const cell = (text: string) => cellOf(model, text).attrs!.nodeId!;
  return { label, ref, element, cell, cells: (...texts) => texts.map(cell) };
}

/** The cell element of the table whose text starts with `name`. */
function cellElement(target: Scenario, name: string): Locator {
  return target.element.locator(`:is(td.fb-td, th.fb-th)[data-node-id="${target.cell(name)}"]`);
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
  await expect(page.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true');
}

/** The text `[from, to)` of the text block `nodeId` selected. */
async function selectText(page: Page, nodeId: string, from: number, to: number): Promise<void> {
  const placed = await page.evaluate(([id, a, b]) => window.__mfbeTest!.scripts!.select(id, a, b), [
    nodeId,
    from,
    to,
  ] as const);
  expect(placed, `the text ${from}-${to} of ${nodeId} selected`).toBe(true);
}

/**
 * A mouse drag over the cells `names` of `target`, from the first cell's centre over the others
 * to the last one's (as `us2-table-rows-columns` drags); the block's cells `expected` then carry
 * `mfbe-cell-selected`.
 */
async function drag(
  page: Page,
  target: Scenario,
  names: string[],
  expected: readonly string[],
): Promise<void> {
  await target.element.scrollIntoViewIfNeeded();
  const centres: { x: number; y: number }[] = [];
  for (const name of names) {
    const box = (await cellElement(target, name).boundingBox())!;
    centres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const [first, ...rest] = centres;
  await page.mouse.move(first!.x, first!.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => highlighted(page)).toEqual(target.cells(...expected));
}

/** Types `value` into the Table bar's text field `testId` and presses Enter. */
async function enter(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId);
  await expect(field).toBeEnabled();
  await field.fill(value);
  await field.press('Enter');
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
    .poll(() => toXml(page), { message: 'the field changed the document' })
    .not.toBe(before);
  return toXml(page);
}

/**
 * A refused value: the status bar names the reason (`message`), the field shows `shown` again,
 * and the document is still `xml`.
 */
async function refused(
  page: Page,
  testId: string,
  value: string,
  message: string,
  shown: string,
  xml: string,
): Promise<void> {
  await enter(page, testId, value);
  await expect(page.getByTestId('status-message'), `${value} refused`).toHaveText(message);
  await expect(page.getByTestId(testId), `${testId} restored`).toHaveValue(shown);
  expect(await toXml(page), `${value} changes nothing`).toBe(xml);
}

/** Edit → Undo is unavailable: the document has no undo step. */
async function noUndoStep(page: Page): Promise<void> {
  await page.getByTestId('menu-edit').click();
  await expect(page.getByTestId('menu-edit-undo')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-edit-popup')).toHaveCount(0);
}

/** A field that shows `value`, with `data-mixed="true"` exactly when `mixed`. */
async function shows(page: Page, testId: string, value: string, mixed = false): Promise<void> {
  const field = page.getByTestId(testId);
  await expect(field, testId).toHaveValue(value);
  if (mixed) await expect(field, `${testId} is mixed`).toHaveAttribute('data-mixed', 'true');
  else await expect(field, `${testId} is not mixed`).not.toHaveAttribute('data-mixed');
}

/** What R6.7 reads of a cell: its content box and the place of its text. */
interface CellBox {
  contentLeft: number;
  contentRight: number;
  contentTop: number;
  contentBottom: number;
  textLeft: number;
  textRight: number;
  textTop: number;
  textBottom: number;
  /** The computed line height in pixels. */
  lineHeight: number;
}

/** The page code that measures the cells (the e2e project has no DOM library). */
const CELL_BOX = `((ids) => ids.map((id) => {
  const cell = document.querySelector(
    '[data-testid="body-editor"] :is(td, th)[data-node-id="' + id + '"]');
  if (!cell) return null;
  const style = getComputedStyle(cell);
  const box = cell.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(cell);
  const text = range.getBoundingClientRect();
  return {
    contentLeft: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
    contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    contentTop: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
    contentBottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
    textLeft: text.left,
    textRight: text.right,
    textTop: text.top,
    textBottom: text.bottom,
    lineHeight: parseFloat(style.lineHeight),
  };
}))`;

async function boxesOf(page: Page, ids: readonly string[]): Promise<CellBox[]> {
  const boxes = await page.evaluate<(CellBox | null)[]>(`${CELL_BOX}(${JSON.stringify(ids)})`);
  boxes.forEach((box, index) => expect(box, `the cell ${ids[index]}`).not.toBeNull());
  return boxes as CellBox[];
}

/**
 * The half-leading of a one-line cell: a Range's rectangle holds the glyphs' height, the line box
 * `line-height`, which adds half the difference above and half below them.
 */
function halfLeading(box: CellBox): number {
  return (box.lineHeight - (box.textBottom - box.textTop)) / 2;
}

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US7 (feature 006) - every table, row and cell attribute in the Table bar', () => {
  let dir: string;

  test.beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mfbe-us7-tables-'));
  });

  test.afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // Before the page loads: the light theme without Fast Mode (R6.7 measures the cells as the
    // default rules lay them out; T078 and T185 switch Fast Mode on in the worker's shared core),
    // the AI panel hidden, so the views have their full width, and Restore position off: every
    // save and every open records the caret of the book that leaves (feature 004 US8), and an
    // open puts the remembered caret back once the core has answered - after the journey placed
    // its own (sc.5 reopens its saved copy; the worker's other tests reopen tables.fb2).
    await core.rpc('settings.set', {
      patch: {
        view: { theme: 'light', fastMode: false },
        session: { aiPanelVisible: false },
        other: { restorePosition: false },
      },
    });
  });

  test.afterEach(async ({ core }) => {
    if (!core.hasCore) return;
    // A `null` member returns to its default (`core/src/settings/settings.cpp`, merge_patch).
    await core
      .rpc('settings.set', {
        patch: {
          view: { theme: null, fastMode: null },
          session: { aiPanelVisible: null },
          other: { restorePosition: null },
        },
      })
      .catch(() => {});
  });

  test('sc.1, sc.2: a dragged block - the block-wide fields reach its six cells and three rows, Cell ID its head cell; a mixed field is empty; an equal value commits nothing', async ({
    core,
    page,
  }) => {
    test.setTimeout(180_000);
    await openBook(core, page, TABLES);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    expect(tableXml(fixture, T1)).toBe(t1Xml());
    const six = ['r1c1', 'r1c2', 'r2c1', 'r2c2', 'r3c1', 'r3c2'];
    const inBlock = (name: string) => six.includes(name);
    const bar = page.getByTestId('tablebar');

    // sc.1: a drag from r1c1 over r2c1 to r3c2 - six cells highlighted.
    await drag(page, t1, ['r1c1', 'r2c1', 'r3c2'], six);
    await expect(bar).toHaveAttribute('data-in-table', 'true');

    // Each field, one step: the block's cells (rows) and no other carry the value; the block
    // stays selected; one Undo and one Redo.
    const values: CellAttrs = {};
    let rowAlign: string | undefined;
    const steps: { run: () => Promise<void>; set: () => void }[] = [
      {
        run: () =>
          page
            .getByTestId('table-bar-td-align')
            .selectOption('center')
            .then(() => {}),
        set: () => (values.align = 'center'),
      },
      {
        run: () =>
          page
            .getByTestId('table-bar-td-valign')
            .selectOption('middle')
            .then(() => {}),
        set: () => (values.valign = 'middle'),
      },
      { run: () => enter(page, 'table-bar-style', 'wide'), set: () => (values.style = 'wide') },
      { run: () => enter(page, 'table-bar-lang', 'de'), set: () => (values.lang = 'de') },
      {
        run: () =>
          page
            .getByTestId('table-bar-tr-align')
            .selectOption('right')
            .then(() => {}),
        set: () => (rowAlign = 'right'),
      },
    ];
    let xml = fixture;
    for (const step of steps) {
      await step.run();
      step.set();
      const after = await changedFrom(page, xml);
      expect(tableXml(after, T1)).toBe(
        t1Xml(
          (name) => (inBlock(name) ? { ...values } : {}),
          (r) => (r <= 3 ? rowAlign : undefined),
        ),
      );
      await expect(bar).toHaveAttribute('data-in-table', 'true');
      await expect.poll(() => highlighted(page)).toEqual(t1.cells(...six));
      await undoRedo(page, xml, after);
      await expect.poll(() => highlighted(page), 'the block after Redo').toEqual(t1.cells(...six));
      xml = after;
    }
    const sc1 = xml;
    // The fields show the values the six cells and the three rows share.
    await shows(page, 'table-bar-td-align', 'center');
    await shows(page, 'table-bar-td-valign', 'middle');
    await shows(page, 'table-bar-style', 'wide');
    await shows(page, 'table-bar-lang', 'de');
    await shows(page, 'table-bar-tr-align', 'right');

    // sc.2: the head-cell fields show r3c2's values - the cell where the drag ended -, and c32
    // goes to r3c2 only.
    await shows(page, 'table-bar-cell-id', '');
    await shows(page, 'table-bar-colspan', '');
    await shows(page, 'table-bar-rowspan', '');
    await enter(page, 'table-bar-cell-id', 'c32');
    const named = await changedFrom(page, sc1);
    expect(tableXml(named, T1)).toBe(
      t1Xml(
        (name) => (inBlock(name) ? { ...values, ...(name === 'r3c2' ? { id: 'c32' } : {}) } : {}),
        (r) => (r <= 3 ? 'right' : undefined),
      ),
    );
    await expect.poll(() => highlighted(page)).toEqual(t1.cells(...six));
    await shows(page, 'table-bar-cell-id', 'c32');
    await undoRedo(page, sc1, named);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(sc1);

    // r1c1 alone left-aligned (caret in r1c1) ...
    await caretIn(page, t1.cell('r1c1'), 1);
    await shows(page, 'table-bar-td-align', 'center');
    await page.getByTestId('table-bar-td-align').selectOption('left');
    const left = await changedFrom(page, sc1);
    const leftCells = (name: string): CellAttrs =>
      inBlock(name) ? { ...values, ...(name === 'r1c1' ? { align: 'left' } : {}) } : {};
    expect(tableXml(left, T1)).toBe(t1Xml(leftCells, (r) => (r <= 3 ? 'right' : undefined)));
    await undoRedo(page, sc1, left);

    // ... then the block again: Cell align differs among its cells - empty and mixed -, the
    // other block-wide fields show the value all share.
    await drag(page, t1, ['r1c1', 'r2c1', 'r3c2'], six);
    await shows(page, 'table-bar-td-align', '', true);
    await shows(page, 'table-bar-td-valign', 'middle');
    await shows(page, 'table-bar-style', 'wide');
    await shows(page, 'table-bar-lang', 'de');
    await shows(page, 'table-bar-tr-align', 'right');

    // With the caret in r1c1, left again records no undo step: the next Undo undoes the step
    // before, r1c1's left (data-model §4.7: a value equal to the current one commits nothing).
    await caretIn(page, t1.cell('r1c1'), 1);
    await shows(page, 'table-bar-td-align', 'left');
    await page.getByTestId('table-bar-td-align').selectOption('left');
    expect(await toXml(page)).toBe(left);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page)).toBe(sc1);
  });

  test('sc.3: Cell language offers the editor’s languages, writes xml:lang and draws lang on the cell; a value that is no language tag is refused', async ({
    core,
    page,
  }) => {
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    await caretIn(page, t1.cell('r4c1'), 1);

    // The suggestions: a <datalist> of the language codes of resources.languages, the list of
    // the description's language picker.
    const field = page.getByTestId('table-bar-lang');
    const listId = await field.getAttribute('list');
    expect(listId, 'Cell language names a datalist').toBeTruthy();
    const catalogue = await core.rpc<{ groups: { languages: { code: string }[] }[] }>(
      'resources.languages',
    );
    const codes = [
      ...new Set(catalogue.groups.flatMap((group) => group.languages.map((one) => one.code))),
    ];
    expect(codes.length).toBeGreaterThan(100);
    const options = page.locator(`datalist[id="${listId}"] > option`);
    await expect(options).toHaveCount(codes.length);
    expect(
      await options.evaluateAll((elements) =>
        elements.map((element) => (element as unknown as { value: string }).value),
      ),
    ).toEqual(codes);

    // de: xml:lang="de" on r4c1, and its td.fb-td carries lang="de" (C20).
    await enter(page, 'table-bar-lang', 'de');
    const german = await changedFrom(page, fixture);
    expect(tableXml(german, T1)).toBe(t1Xml((name) => (name === 'r4c1' ? { lang: 'de' } : {})));
    await expect(cellElement(t1, 'r4c1')).toHaveAttribute('lang', 'de');
    await undoRedo(page, fixture, german);

    // de_DE: refused with its reason, the field shows de again, no change and no undo step.
    await caretIn(page, t1.cell('r4c1'), 1);
    await shows(page, 'table-bar-lang', 'de');
    await refused(
      page,
      'table-bar-lang',
      'de_DE',
      uiText(lang, 'tables.msg.langInvalid', { value: 'de_DE' }),
      'de',
      german,
    );
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page), 'the next Undo undoes de').toBe(fixture);
  });

  test('sc.4: an id that is no XML name or that another element of the book uses is refused in Table ID and Cell ID, also an unmounted section’s', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const lang = await pageLang(page);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    const invalid = uiText(lang, 'tables.msg.idInvalid');
    const inUse = (id: string) => uiText(lang, 'tables.msg.idInUse', { id });
    // t-linked is the id of the table the links of tables.fb2 target (T012).
    expect(fixture).toContain('<table id="t-linked">');
    for (const testId of ['table-bar-table-id', 'table-bar-cell-id']) {
      await caretIn(page, t1.cell('r2c2'), 1);
      await refused(page, testId, '1t', invalid, '', fixture);
      await refused(page, testId, 'a b', invalid, '', fixture);
      await refused(page, testId, 't-linked', inUse('t-linked'), '', fixture);
    }
    await noUndoStep(page);

    // many-sections.fb2: 48 sections, more than whole-book mode allows - the Body view mounts a
    // window of them. A table in section 1 may not take s48, the last section's id, although no
    // element of the page carries it (data-model §10.2: the check covers the whole book).
    await openFile(core, page, MANY_SECTIONS);
    const doc = await documentOf(page);
    const section1 = doc.bodies[0]!.content!.find((node) => node.type === 'section')!;
    expect(section1.attrs!.id).toBe('s1');
    const paragraph = section1.content!.find((node) => node.type === 'p')!;
    // The caret at the end of the section's first paragraph: the table follows it.
    await selectText(
      page,
      paragraph.attrs!.nodeId!,
      textOf(paragraph).length,
      textOf(paragraph).length,
    );
    const before = await toXml(page);
    await page.getByTestId('menu-add').click();
    await page.getByTestId('menu-add-table').click();
    await expect(page.getByTestId('dialog-table')).toBeVisible();
    await page.getByTestId('dialog-table-rows').fill('2');
    await page.getByTestId('dialog-table-columns').fill('3');
    await page.getByTestId('dialog-table-header').setChecked(true);
    await page.getByTestId('dialog-table-header-column').setChecked(false);
    await page.getByTestId('dialog-table-button-ok').click();
    await expect(page.getByTestId('dialog-table')).toBeHidden();
    const inserted = await changedFrom(page, before);
    await expect(page.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true');
    await expect(page.locator('[data-id="s48"]')).toHaveCount(0);
    expect(inserted).toContain('<section id="s48">');
    await refused(page, 'table-bar-table-id', 's48', inUse('s48'), '', inserted);
    await menu(page, 'edit', 'undo');
    await expect.poll(() => toXml(page), 'the next Undo undoes the insertion').toBe(before);
  });

  test('sc.5: the cells’ xml:lang survive Save As and reopening, and Cell language shows them', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const target = await scenario(page, LANGS);
    const expected: [string, string][] = [
      ['Zelle', 'de'],
      ['Colour', 'en-GB'],
      ['Клітинка', 'uk'],
      ['Cella', 'la'],
    ];
    for (const [name, value] of expected) {
      await caretIn(page, target.cell(name), 1);
      await shows(page, 'table-bar-lang', value);
    }
    const written = await saveAs(core, page, path.join(dir, 'us7-languages.fb2'));
    const original = readFileSync(TABLES, 'utf8');
    expect(tableXml(written, LANGS)).toBe(tableXml(original, LANGS));
    expect(tableXml(written, LANGS)).toBe(
      '<table><tr><th xml:lang="de">Zelle</th><th xml:lang="en-GB">Colour</th></tr>' +
        '<tr><td xml:lang="uk">Клітинка</td><td xml:lang="la">Cella</td></tr></table>',
    );
    await openFile(core, page, path.join(dir, 'us7-languages.fb2'));
    const reopened = await scenario(page, LANGS);
    for (const [name, value] of expected) {
      await caretIn(page, reopened.cell(name), 1);
      await shows(page, 'table-bar-lang', value);
    }
  });

  test('FR-023: bold, a link and a footnote inside a cell, each one undo step', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t1 = await scenario(page, T1);
    const r2c3 = t1.cell('r2c3');
    const fixture = await toXml(page);
    const cellXml = (xml: string) => {
      const table = tableXml(xml, T1);
      const at = table.indexOf('<td>r2c3');
      return table.slice(at, table.indexOf('</td>', at) + '</td>'.length);
    };

    // "holds" (5-10) in bold from the toolbar.
    await selectText(page, r2c3, 5, 10);
    await page.getByTestId('toolbar-style.strong').click();
    const bold = await changedFrom(page, fixture);
    expect(cellXml(bold)).toContain('r2c3 <strong>holds</strong> a long sentence');
    await undoRedo(page, fixture, bold);

    // "long" (13-17) a link through Style → Link...
    await selectText(page, r2c3, 13, 17);
    await menu(page, 'style', 'link');
    await expect(page.getByTestId('dialog-link')).toBeVisible();
    await page.getByTestId('dialog-link-href').fill('#t-linked');
    await page.getByTestId('dialog-link-button-ok').click();
    const linked = await changedFrom(page, bold);
    expect(cellXml(linked)).toMatch(/ a <a l:href="#t-linked">long<\/a> sentence/);
    await undoRedo(page, bold, linked);

    // The caret after "sentence" (26): Style → Footnote... puts a note link there and its note
    // into the notes body.
    await caretIn(page, r2c3, 26);
    await menu(page, 'style', 'footnote');
    const noted = await changedFrom(page, linked);
    const reference =
      /sentence<a [^>]*href="#(n_\d+)"[^>]*type="note"[^>]*>\[\d+\]<\/a> that wraps/.exec(
        cellXml(noted),
      );
    expect(reference, cellXml(noted)).not.toBeNull();
    expect(flatXml(noted)).toMatch(
      new RegExp(`<body name="notes">.*<section id="${reference![1]}">`, 's'),
    );
    await undoRedo(page, linked, noted);
  });

  test('research R6.7: valign bottom puts a cell’s text at its bottom; a header cell’s align left and its row’s align right are shown as written', async ({
    core,
    page,
  }) => {
    test.setTimeout(120_000);
    await openBook(core, page, TABLES);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);

    // r2c2, beside r2c3's long sentence: taller than its one line of text, and at the top by
    // default (C60).
    const r2c2 = t1.cell('r2c2');
    const [top] = await boxesOf(page, [r2c2]);
    const lead = halfLeading(top!);
    expect(
      top!.contentBottom - top!.contentTop,
      'the premise: r2c3 wraps, so r2c2 is taller than its one line',
    ).toBeGreaterThan(1.5 * top!.lineHeight);
    expect(Math.abs(top!.textTop - lead - top!.contentTop), 'the text at the top').toBeLessThan(1);
    await caretIn(page, r2c2, 1);
    await page.getByTestId('table-bar-td-valign').selectOption('bottom');
    const bottom = await changedFrom(page, fixture);
    expect(tableXml(bottom, T1)).toBe(
      t1Xml((name) => (name === 'r2c2' ? { valign: 'bottom' } : {})),
    );
    const [low] = await boxesOf(page, [r2c2]);
    expect(
      Math.abs(low!.textBottom + halfLeading(low!) - low!.contentBottom),
      'the text at the bottom of the content box',
    ).toBeLessThanOrEqual(1);
    await undoRedo(page, fixture, bottom);

    // The header-row table. Its cells are as wide as their bold text, which leaves no room to
    // align in; a style of the test's own widens the table (as us6-table-headers does).
    const t2 = await scenario(page, T2);
    await page.addStyleTag({
      content: `[data-testid="body-table"][data-node-id="${t2.ref}"] { width: 36em; }`,
    });
    const [h1, h2, h3] = t2.cells('r1c1', 'r1c2', 'r1c3');
    const gaps = (box: CellBox) => ({
      left: box.textLeft - box.contentLeft,
      right: box.contentRight - box.textRight,
    });
    // The second header cell left-aligned: its text starts at its content-box left.
    await caretIn(page, h2!, 1);
    await page.getByTestId('table-bar-td-align').selectOption('left');
    const left = await changedFrom(page, bottom);
    await undoRedo(page, bottom, left);
    const [leftBox] = await boxesOf(page, [h2!]);
    expect(Math.abs(gaps(leftBox!).left), 'the align="left" text at the left').toBeLessThanOrEqual(
      1,
    );
    expect(gaps(leftBox!).right, 'room on the right of it').toBeGreaterThan(10);
    // The header row right-aligned: the other header cells' text ends at their content-box
    // right; the left-aligned cell keeps its own alignment.
    await caretIn(page, h1!, 1);
    await page.getByTestId('table-bar-tr-align').selectOption('right');
    const right = await changedFrom(page, left);
    expect(tableXml(right, T2)).toBe(
      '<table><tr align="right"><th>r1c1</th><th align="left">r1c2</th><th>r1c3</th></tr>' +
        '<tr><td>r2c1</td><td>r2c2</td><td>r2c3</td></tr></table>',
    );
    await undoRedo(page, left, right);
    const boxes = await boxesOf(page, [h1!, h3!, h2!]);
    for (const box of boxes.slice(0, 2)) {
      expect(Math.abs(gaps(box).right), 'a header cell of the right row').toBeLessThanOrEqual(1);
      expect(gaps(box).left, 'room on the left of it').toBeGreaterThan(10);
    }
    expect(Math.abs(gaps(boxes[2]!).left), 'the align="left" cell stays left').toBeLessThanOrEqual(
      1,
    );
  });
});
