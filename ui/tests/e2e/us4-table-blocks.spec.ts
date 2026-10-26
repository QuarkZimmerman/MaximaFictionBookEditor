/**
 * Feature 006, User Story 4 - Select a block of cells and work on it (T088; spec FR-010,
 * FR-011; US4 sc.1 to sc.5; U22, U38 (a selection that leaves the table), U39; C51; SC-007,
 * SC-009; quickstart §4 "Manual check" steps 1 to 5 and 9, "Automated" and open point 15;
 * research R1.6, R6.8). T036 tested drag, Shift+click and Shift+Arrow in vitest only; this file
 * drives them in a real page. The clipboard tests (T089; FR-011's Copy and Cut, FR-012, FR-004
 * for pastes, FR-030; US4 sc.6 to sc.8; C28, C47; U8, U30, U38; decision 4; quickstart §4 manual
 * steps 6 to 8; research R5.7, R5.12 and R9's note that FR-030's block copy and row move with
 * pictures run here) use the system clipboard - `${MOD}+c`, `${MOD}+v`, the Edit menu and the
 * context menu - with the clipboard permissions granted, as `us2-body-editing.spec.ts` does.
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile`, and works on the user story 4 tables of its "Scenario tables"
 * section (T014), each found by the paragraph that names its scenarios and by the `data-node-id`
 * of its `[data-testid=body-table]`:
 *  (1) "US4 sc.1, sc.3 to sc.6, sc.8": 4 × 4, `r1c1` with the id `us4-r1c1`;
 *  (2) "US4 sc.2": `[r1c1, r1c2, r1c3, r1c4] / [r2c1, r2c2, m colspan 2 rowspan 2] /
 *      [r3c1, r3c2] / [r4c1, r4c2, r4c3, r4c4]`;
 *  (3) "US4 sc.6, sc.8 (the paste target)": 3 × 3;
 *  then the paragraph "US4 sc.7 and manual step 9: the paragraph after the tables.".
 *
 * After **every** step Edit → Undo gives back the whole document XML byte for byte and Edit →
 * Redo the step's result (`undoRedo`; SC-007, U22). A block is a `CellBlockSelection`: its cells
 * carry `mfbe-cell-selected`, and the Body view restores it from its bookmark on Undo
 * (data-model §5.7).
 *
 * The input method and the dead key (U39) are sent through the DevTools protocol (`compose`,
 * `fixtures/keys.ts`): `Input.imeSetComposition` for each step, `Input.insertText` for the
 * commit - the means quickstart's open point 15 left to the tasks.
 */

import type { Locator, Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';
import { pageText } from './fixtures/i18n';
import { LINE_END, MOD, compose } from './fixtures/keys';

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

interface ComputedStyle {
  backgroundImage: string;
  backgroundColor: string;
  boxShadow: string;
  caretColor: string;
  outlineStyle: string;
  outlineWidth: string;
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

declare function getComputedStyle(element: unknown, pseudo?: string): ComputedStyle;

const TABLES = fixtureBook('tables.fb2');
const IMAGES = fixtureBook('tables-images.fb2');

/** The labels of the scenario tables (the paragraphs before them in `tables.fb2`). */
const T1 = 'US4 sc.1, sc.3 to sc.6, sc.8';
const T2 = 'US4 sc.2';
const T3 = 'US4 sc.6, sc.8 (the paste target)';
/** The paragraph after the user story 4 tables. */
const AFTER = 'US4 sc.7 and manual step 9: the paragraph after the tables.';

/** A colour the native selection paints with: none. */
const TRANSPARENT = ['transparent', 'rgba(0, 0, 0, 0)'];

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

/**
 * The table after the paragraph `label`, cut out of the document's XML with the white space
 * between tags removed and an empty element written one way (`<td/>`).
 */
function tableXml(xml: string, label: string): string {
  const flat = flatXml(xml);
  const marker = `<p>${label}</p>`;
  const at = flat.indexOf(`${marker}<table`);
  if (at < 0) throw new Error(`no table after "${label}" in the XML`);
  const from = at + marker.length;
  const to = flat.indexOf('</table>', from) + '</table>'.length;
  return flat.slice(from, to);
}

/** The XML with the white space between tags removed and empty cells written `<td/>`. */
function flatXml(xml: string): string {
  return xml.replace(/>\s+</g, '><').replace(/<(t[dhr])((?:\s[^>]*)?)><\/\1>/g, '<$1$2/>');
}

/** A row of the expected XML. */
function tr(cells: string): string {
  return `<tr>${cells}</tr>`;
}

function td(text = '', attrs = ''): string {
  return text === '' ? `<td${attrs}/>` : `<td${attrs}>${text}</td>`;
}

function table(...rows: string[]): string {
  return `<table>${rows.join('')}</table>`;
}

/** Cells holding their names; `''` an empty cell. */
function tds(...names: string[]): string {
  return names.map((name) => td(name)).join('');
}

/** Table (1) of the fixture, as the writer gives it. */
const T1_ROWS = [1, 2, 3, 4].map((r) =>
  [1, 2, 3, 4].map((c) => `r${r}c${c}`).map((name) => (name === 'r1c1' ? 'us4-r1c1' : name)),
);

/** Table (1) with the named cells emptied (`r1c1` keeps its id). */
function t1Xml(emptied: readonly string[] = [], typed: Record<string, string> = {}): string {
  return table(
    ...T1_ROWS.map((row) =>
      tr(
        row
          .map((name) => {
            const plain = name === 'us4-r1c1' ? 'r1c1' : name;
            const attrs = name === 'us4-r1c1' ? ' id="us4-r1c1"' : '';
            const text = typed[plain] ?? (emptied.includes(plain) ? '' : plain);
            return td(text, attrs);
          })
          .join(''),
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

/** The entry of *Add → Table structure* for the command `commandId`, its submenu open. */
async function structureEntry(page: Page, commandId: string): Promise<Locator> {
  await page.getByTestId('menu-add').click();
  await page.getByTestId('menu-add-tableStructure').click();
  await expect(page.getByTestId('menu-add-tableStructure-popup')).toBeVisible();
  return page.getByTestId(`menu-add-tableStructure-${commandId.slice(commandId.indexOf('.') + 1)}`);
}

/** `tables.fb2` through File → Open and the queued native dialog; the hooks ready. */
async function openTables(core: CoreHandle, page: Page): Promise<void> {
  await openBook(core, page, TABLES);
}

/** A fixture book through File → Open and the queued native dialog; the hooks ready. */
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

/** The cell element of the table whose text is `name` (`td.fb-td` or `th.fb-th`). */
function cell(target: Scenario, name: string): Locator {
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
}

/** The editor holds the focus again (after a menu), its selection kept. */
async function focusEditor(page: Page): Promise<void> {
  await page.getByTestId('body-editor').focus();
  await expect(page.getByTestId('body-editor')).toBeFocused();
}

/** The table's grid is regular: no short row, no overlap, no span past the end. */
async function regular(page: Page, ref: string): Promise<void> {
  const summary = await page.evaluate((id) => window.__mfbeTest!.tables!.grid(id), ref);
  expect(summary, `the grid of ${ref}`).toMatchObject({ shortRows: 0, overlaps: 0, pastEnd: 0 });
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

/** One more Edit → Undo, back to `xml`. */
async function undoTo(page: Page, xml: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page)).toBe(xml);
}

/** The XML once the document changed from `before`. */
async function changedFrom(page: Page, before: string): Promise<string> {
  await expect
    .poll(() => toXml(page), { message: 'the step changed the document' })
    .not.toBe(before);
  return toXml(page);
}

/** A mouse drag over the cells `names`, from the first cell's centre to the last's. */
async function drag(page: Page, target: Scenario, names: string[]): Promise<void> {
  await target.element.scrollIntoViewIfNeeded();
  const centres: { x: number; y: number }[] = [];
  for (const name of names) {
    const box = (await cell(target, name).boundingBox())!;
    centres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const [first, ...rest] = centres;
  await page.mouse.move(first!.x, first!.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
}

/** A click on a cell's text end: the caret there. */
async function clickEnd(page: Page, target: Scenario, name: string): Promise<void> {
  const element = cell(target, name);
  await element.scrollIntoViewIfNeeded();
  const box = (await element.boundingBox())!;
  await element.click({ position: { x: box.width - 3, y: box.height / 2 } });
  await page.keyboard.press(LINE_END);
  await expect(page.getByTestId('status-path')).toHaveText(/\/t[dh]\[\d+\]$/);
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

/** A block from `from` to `to` by a click and a Shift+click. */
async function shiftBlock(page: Page, target: Scenario, from: string, to: string): Promise<void> {
  await clickEnd(page, target, from);
  await cell(target, to).click({ modifiers: ['Shift'] });
  await expect.poll(() => highlighted(page)).toContain(target.cell(to));
}

/** Runs `commandId` from *Add → Table structure*: `menu-add-tableStructure-<name>`. */
async function structure(page: Page, commandId: string): Promise<void> {
  const entry = await structureEntry(page, commandId);
  await expect(entry).not.toHaveAttribute('aria-disabled');
  await entry.click();
}

/** The node id of the cell the Body selection's head stands in. */
async function headNodeId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection()?.head.nodeId);
}

/** The node ids of the cells at `[row, column]` of a table whose rows hold no spans there. */
function cellIdsAt(model: Json, positions: readonly [number, number][]): string[] {
  const rows = cellRows(model);
  return positions.map(([row, col]) => rows[row]![col]!.attrs!.nodeId!);
}

/** The model table whose FB2 id is `id` (the tables of `tables-images.fb2`). */
function tableById(doc: DocJson, id: string): Json {
  for (const body of doc.bodies) {
    for (const { node } of walk(body))
      if (node.type === 'table' && node.attrs?.id === id) return node;
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

/** The 2 × 2 block `r1c1`-`r2c2` of table (1) as a new table: no attributes, no used id. */
const BLOCK_TABLE = table(tr(tds('r1c1', 'r1c2')), tr(tds('r2c1', 'r2c2')));

/* ------------------------------------------------------------------------ */
/* The journeys                                                             */
/* ------------------------------------------------------------------------ */

test.describe('US4 (feature 006) - blocks of cells', () => {
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

  test('sc.1: a mouse drag highlights the 3 × 2 block as one; the native selection paints nothing; Select table outlines the table', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    await drag(page, t1, ['r1c2', 'r2c2', 'r3c3']);
    // Exactly the block's six cells, and no other cell of the page.
    await expect
      .poll(() => highlighted(page))
      .toEqual(t1.cells('r1c2', 'r1c3', 'r2c2', 'r2c3', 'r3c2', 'r3c3'));
    // The tint as a background image over the cell's own background, the 1 px accent line as
    // an inset shadow (T037).
    const inside = await cell(t1, 'r2c3').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        image: style.backgroundImage,
        shadow: style.boxShadow,
        selection: getComputedStyle(element, '::selection').backgroundColor,
      };
    });
    expect(inside.image).toContain('linear-gradient');
    expect(inside.shadow).toContain('inset');
    expect(inside.shadow).toMatch(/\b1px\b/);
    // The native selection is hidden inside the table, caret included (C51).
    await expect(page.getByTestId('body-editor')).toHaveClass(/\bProseMirror-hideselection\b/);
    expect(TRANSPARENT).toContain(inside.selection);
    const outside = await cell(t1, 'r4c4').evaluate((element) => ({
      image: getComputedStyle(element).backgroundImage,
      selection: getComputedStyle(element, '::selection').backgroundColor,
    }));
    expect(outside.image).toBe('none');
    expect(TRANSPARENT).toContain(outside.selection);
    const caret = await t1.element.evaluate((element) => getComputedStyle(element).caretColor);
    expect(TRANSPARENT).toContain(caret);

    // With the same rules, the context menu's "Select table" outlines the table (R6.8).
    await rightClick(page, cell(t1, 'r2c2'));
    const contextMenu = page.getByTestId('context-menu');
    await contextMenu
      .getByText(await pageText(page, 'editing.contextMenu.select', { element: 'table' }), {
        exact: true,
      })
      .click();
    await expect(t1.element).toHaveClass(/\bfb-selected\b/);
    const outline = await t1.element.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(outline).toEqual({ style: 'solid', width: '2px' });
    await expect(page.getByTestId('body-editor')).toHaveClass(/\bProseMirror-hideselection\b/);
    expect(await highlighted(page)).toEqual([]);
  });

  test('sc.2: a block whose edge cuts a merged cell grows over the whole cell, by the mouse and by Shift+ArrowRight', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t2 = await scenario(page, T2);
    // From r1c1 to m (row 2, column 3): rows 1-3 and columns 1-4.
    await drag(page, t2, ['r1c1', 'r2c2', 'm']);
    await expect
      .poll(() => highlighted(page))
      .toEqual(t2.cells('r1c1', 'r1c2', 'r1c3', 'r1c4', 'r2c1', 'r2c2', 'm', 'r3c1', 'r3c2'));
    // The caret at the end of r2c2 and Shift+ArrowRight: r2c2, m and r3c2 (rows 2-3, columns
    // 2-4).
    await caretIn(page, t2.cell('r2c2'), 'r2c2'.length);
    await expect.poll(() => highlighted(page)).toEqual([]);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => highlighted(page)).toEqual(t2.cells('r2c2', 'm', 'r3c2'));
  });

  test('sc.3: Shift+ArrowDown crosses the cell boundary; a Shift+click selects the block between two cells', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    await clickEnd(page, t1, 'r1c1');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => highlighted(page)).toEqual(t1.cells('r1c1', 'r2c1'));
    // A click on r1c1 and a Shift+click on r3c3: rows 1-3 and columns 1-3, nine cells.
    await clickEnd(page, t1, 'r1c1');
    await expect.poll(() => highlighted(page)).toEqual([]);
    await cell(t1, 'r3c3').click({ modifiers: ['Shift'] });
    await expect
      .poll(() => highlighted(page))
      .toEqual(t1.cells('r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2', 'r2c3', 'r3c1', 'r3c2', 'r3c3'));
  });

  test('sc.4: Delete and Backspace clear the block; its cells stay with their ids; Undo gives back the texts and the block', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const block = t1.cells('r1c1', 'r1c2', 'r2c1', 'r2c2');
    const cleared = t1Xml(['r1c1', 'r1c2', 'r2c1', 'r2c2']);
    const before = await toXml(page);
    expect(tableXml(before, T1)).toBe(t1Xml());

    for (const key of ['Delete', 'Backspace']) {
      await shiftBlock(page, t1, 'r1c1', 'r2c2');
      await expect.poll(() => highlighted(page)).toEqual(block);
      await page.keyboard.press(key);
      const after = await changedFrom(page, before);
      // The four cells are empty and still there, each with its node id; r1c1 keeps its id.
      expect(tableXml(after, T1), key).toBe(cleared);
      const cells = t1.element.locator('td.fb-td, th.fb-th');
      await expect(cells).toHaveCount(16);
      for (const nodeId of block) {
        await expect(t1.element.locator(`td[data-node-id="${nodeId}"]`)).toHaveText('');
      }
      await expect(cell(t1, 'r1c1')).toHaveAttribute('data-id', 'us4-r1c1');
      // The block stays selected.
      expect(await highlighted(page)).toEqual(block);
      await regular(page, t1.ref);
      // Undo gives back the texts and the block itself; Redo the cleared block.
      await undoRedo(page, before, after);
      await undoTo(page, before);
      await expect.poll(() => highlighted(page)).toEqual(block);
      await expect(cell(t1, 'r1c1')).toHaveText('r1c1');
    }
  });

  test('sc.5: typing over a block clears it and types into its top-left cell; the clear and the first character are one undo step', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const before = await toXml(page);
    await shiftBlock(page, t1, 'r1c1', 'r2c2');
    await page.keyboard.type('x');
    const typed = await changedFrom(page, before);
    expect(tableXml(typed, T1)).toBe(t1Xml(['r1c1', 'r1c2', 'r2c1', 'r2c2'], { r1c1: 'x' }));
    // The caret after the x, in the first cell of the first row.
    await expect(page.getByTestId('status-path')).toHaveText(/\/tr\[1\]\/td\[1\]$/);
    expect(await highlighted(page)).toEqual([]);
    await undoRedo(page, before, typed);
    // The following characters group as typing: one Undo takes them, not the x.
    await caretIn(page, t1.cell('r1c1'), 1);
    await page.keyboard.type('yz');
    const more = await changedFrom(page, typed);
    expect(tableXml(more, T1)).toBe(t1Xml(['r1c1', 'r1c2', 'r2c1', 'r2c2'], { r1c1: 'xyz' }));
    await undoTo(page, typed);
  });

  test('U39: an input method and a dead key over a block compose in its top-left cell and clear the block; the clear is a step of its own', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const cases = [
      // An input method spells にほん and commits 日本; nothing lands in the head cell r4c4.
      {
        from: 'r3c3',
        to: 'r4c4',
        block: ['r3c3', 'r3c4', 'r4c3', 'r4c4'],
        steps: ['に', 'にほ', 'にほん'],
        commit: '日本',
      },
      // The composition Chromium makes for a dead key: ´, then é.
      {
        from: 'r3c1',
        to: 'r4c2',
        block: ['r3c1', 'r3c2', 'r4c1', 'r4c2'],
        steps: ['´'],
        commit: 'é',
      },
    ];
    // What the earlier cases left in table (1).
    const emptied: string[] = [];
    const typed: Record<string, string> = {};
    for (const { from, to, block, steps, commit } of cases) {
      const before = await toXml(page);
      const earlier = { emptied: [...emptied], typed: { ...typed } };
      await shiftBlock(page, t1, from, to);
      await expect.poll(() => highlighted(page)).toEqual(t1.cells(...block));
      await page.getByTestId('body-editor').focus();
      await compose(page, steps, commit);
      emptied.push(...block);
      typed[from] = commit;
      // The composition replaces the top-left cell's text; when it ends, the other cells of the
      // block are cleared.
      await expect
        .poll(async () => tableXml(await toXml(page), T1), { message: commit })
        .toBe(t1Xml(emptied, typed));
      const composed = await toXml(page);
      for (const name of block) {
        await expect(cell(t1, name)).toHaveText(name === from ? commit : '');
      }
      // The clear of the other cells is a step of its own: the first Undo gives back their
      // contents, the second the top-left cell's text the composition replaced; two Redos apply
      // both again.
      await menu(page, 'edit', 'undo');
      const clearedOnly = await changedFrom(page, composed);
      expect(tableXml(clearedOnly, T1), `${commit}: the composition alone`).toBe(
        t1Xml(earlier.emptied, { ...earlier.typed, [from]: commit }),
      );
      await undoTo(page, before);
      await menu(page, 'edit', 'redo');
      await expect.poll(() => toXml(page)).toBe(clearedOnly);
      await menu(page, 'edit', 'redo');
      await expect.poll(() => toXml(page)).toBe(composed);
      await regular(page, t1.ref);
    }
  });

  test('U38: a selection from a cell to the paragraph after the table is an ordinary text selection; the block commands refuse it', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t3 = await scenario(page, T3);
    const doc = await documentOf(page);
    const after = paragraphOf(doc, AFTER).attrs!.nodeId!;
    const placed = await page.evaluate(
      ([anchor, head]) => window.__mfbeTest!.scripts!.selectRange(anchor, head),
      [
        { nodeId: t3.cell('r3c3'), offset: 2 },
        { nodeId: after, offset: 3 },
      ] as const,
    );
    expect(placed).toBe(true);
    // No block: no element carries the block's class.
    await expect(page.locator('.mfbe-cell-selected')).toHaveCount(0);
    // A block command (Delete row, live since US2) is unavailable with the reason
    // `mixedSelection` (data-model §9.6).
    const entry = await structureEntry(page, 'table.deleteRow');
    const title = 'Delete row: the selection reaches outside the table';
    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(entry).toHaveAttribute('title', title);
    await expect(entry).toHaveAttribute('aria-description', title);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-add-popup')).toHaveCount(0);
  });

  test('sc.6: a copied block overwrites the cells from the caret by position, from r3c3 it grows the table; a used id is dropped', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const t3 = await scenario(page, T3);
    const fixture = await toXml(page);
    await shiftBlock(page, t1, 'r1c1', 'r2c2');
    await page.keyboard.press(`${MOD}+c`);

    // The caret in r2c2 of table (3), Edit → Paste: rows 2-3 × columns 2-3 hold the copies;
    // the copy of r1c1 has no id - the book still uses us4-r1c1 (the spec's edge case "Ids").
    await caretIn(page, t3.cell('r2c2'));
    await menu(page, 'edit', 'paste');
    const pasted = await changedFrom(page, fixture);
    expect(tableXml(pasted, T3)).toBe(
      table(
        tr(tds('r1c1', 'r1c2', 'r1c3')),
        tr(tds('r2c1', 'r1c1', 'r1c2')),
        tr(tds('r3c1', 'r2c1', 'r2c2')),
      ),
    );
    expect(tableXml(pasted, T1)).toBe(t1Xml());
    const model = tableAfter(await documentOf(page), T3);
    await expect
      .poll(() => highlighted(page))
      .toEqual(
        cellIdsAt(model, [
          [1, 1],
          [1, 2],
          [2, 1],
          [2, 2],
        ]),
      );
    await regular(page, t3.ref);
    await undoRedo(page, fixture, pasted);

    // After Undo, the caret in r3c3 and the keyboard's paste: the table grows by a row and a
    // column, whose other cells are empty tds like their neighbours (FR-008).
    await undoTo(page, fixture);
    await caretIn(page, t3.cell('r3c3'));
    await page.keyboard.press(`${MOD}+v`);
    const grown = await changedFrom(page, fixture);
    expect(tableXml(grown, T3)).toBe(
      table(
        tr(tds('r1c1', 'r1c2', 'r1c3') + td()),
        tr(tds('r2c1', 'r2c2', 'r2c3') + td()),
        tr(tds('r3c1', 'r3c2', 'r1c1', 'r1c2')),
        tr(td() + td() + tds('r2c1', 'r2c2')),
      ),
    );
    expect(tableXml(grown, T1)).toBe(t1Xml());
    const growth = tableAfter(await documentOf(page), T3);
    await expect
      .poll(() => highlighted(page))
      .toEqual(
        cellIdsAt(growth, [
          [2, 2],
          [2, 3],
          [3, 2],
          [3, 3],
        ]),
      );
    await regular(page, t3.ref);
    await undoRedo(page, fixture, grown);
  });

  test('sc.7: outside a table a copied block becomes a new table at the FR-004 point; where no table may stand the paste is refused; a selection is replaced first', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    const after = paragraphOf(doc, AFTER).attrs!.nodeId!;
    await shiftBlock(page, t1, 'r1c1', 'r2c2');
    await page.keyboard.press(`${MOD}+c`);

    // The caret at the end of the paragraph: a new 2 × 2 table right after it (FR-004 (a)),
    // without table attributes and without the used id, the caret in its first cell.
    await caretIn(page, after, AFTER.length);
    await page.keyboard.press(`${MOD}+v`);
    const placed = await changedFrom(page, fixture);
    expect(flatXml(placed)).toContain(`<p>${AFTER}</p>${BLOCK_TABLE}`);
    expect(tableXml(placed, T1)).toBe(t1Xml());
    const created = tableAfter(await documentOf(page), AFTER);
    const first = cellIdsAt(created, [[0, 0]])[0]!;
    await expect.poll(() => headNodeId(page)).toBe(first);
    await expect(page.getByTestId('status-path')).toHaveText(/\/tr\[1\]\/td\[1\]$/);
    await regular(page, created.attrs!.nodeId!);
    await undoRedo(page, fixture, placed);

    // The caret in the title of "Scenario tables", which holds subsections (FR-004 (c)): the
    // paste is refused with the status-bar message; no undo step comes with it.
    const title = paragraphOf(doc, 'Scenario tables').attrs!.nodeId!;
    await caretIn(page, title, 3);
    await page.keyboard.press(`${MOD}+v`);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'tables.msg.pasteNoPlace'),
    );
    expect(await toXml(page)).toBe(placed);
    // Undo takes the step before: the table pasted after the paragraph.
    await undoTo(page, fixture);

    // Decision 4: the paragraph's first two characters selected; the paste replaces them and
    // the table stands at the FR-004 point of the resulting caret - offset 0 of a non-empty
    // paragraph: before it. One Undo takes both.
    const selected = await page.evaluate(
      (id) => window.__mfbeTest!.scripts!.select(id, 0, 2),
      after,
    );
    expect(selected).toBe(true);
    await page.keyboard.press(`${MOD}+v`);
    const replaced = await changedFrom(page, fixture);
    expect(flatXml(replaced)).toContain(`</table>${BLOCK_TABLE}<p>${AFTER.slice(2)}</p>`);
    expect(flatXml(replaced)).not.toContain(`<p>${AFTER}</p>`);
    await undoRedo(page, fixture, replaced);
  });

  test('U30: a table selected as a whole is replaced at its place by a pasted table', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const t3 = await scenario(page, T3);
    const fixture = await toXml(page);
    await shiftBlock(page, t1, 'r1c1', 'r2c2');
    await page.keyboard.press(`${MOD}+c`);
    // Table (3) selected through the context menu's "Select table", from a caret in its cell.
    await clickEnd(page, t3, 'r2c2');
    await rightClick(page, cell(t3, 'r2c2'));
    const contextMenu = page.getByTestId('context-menu');
    await contextMenu
      .getByText(await pageText(page, 'editing.contextMenu.select', { element: 'table' }), {
        exact: true,
      })
      .click();
    await expect(t3.element).toHaveClass(/\bfb-selected\b/);
    await focusEditor(page);
    await page.keyboard.press(`${MOD}+v`);
    const replaced = await changedFrom(page, fixture);
    // In its place, between its label and the paragraph after it.
    expect(flatXml(replaced)).toContain(`<p>${T3}</p>${BLOCK_TABLE}<p>${AFTER}</p>`);
    expect(tableXml(replaced, T1)).toBe(t1Xml());
    await undoRedo(page, fixture, replaced);
  });

  test('sc.8: a cut block leaves its cells empty with their ids; pasted into another table its texts come back there', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const t3 = await scenario(page, T3);
    const fixture = await toXml(page);
    const block = t1.cells('r1c1', 'r1c2', 'r2c1', 'r2c2');
    await shiftBlock(page, t1, 'r1c1', 'r2c2');
    // A right-click inside the block keeps it (C28); the context menu's Cut cuts it.
    await rightClick(page, cell(t1, 'r2c2'));
    expect(await highlighted(page)).toEqual(block);
    await page.getByTestId('context-menu-edit.cut').click();
    const cut = await changedFrom(page, fixture);
    const cleared = t1Xml(['r1c1', 'r1c2', 'r2c1', 'r2c2']);
    expect(tableXml(cut, T1)).toBe(cleared);
    for (const nodeId of block) {
      await expect(t1.element.locator(`td[data-node-id="${nodeId}"]`)).toHaveText('');
    }
    await expect(cell(t1, 'r1c1')).toHaveAttribute('data-id', 'us4-r1c1');
    await undoRedo(page, fixture, cut);

    // The caret in r1c1 of table (3), Edit → Paste: the four texts come back there - the same
    // texts as table (3)'s own, so the XML stays, but the cells are the pasted ones - and the
    // copy of r1c1 has no id, since a block cut leaves its cells and ids in the book (C47).
    const own = t3.cells('r1c1', 'r1c2', 'r2c1', 'r2c2');
    const corner = (doc: DocJson) =>
      cellIdsAt(tableAfter(doc, T3), [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]);
    await caretIn(page, t3.cell('r1c1'));
    await menu(page, 'edit', 'paste');
    await expect.poll(async () => corner(await documentOf(page))).not.toEqual(own);
    const pasted = await toXml(page);
    const pastedIds = corner(await documentOf(page));
    expect(tableXml(pasted, T3)).toBe(tableXml(fixture, T3));
    expect(tableXml(pasted, T1)).toBe(cleared);
    await expect.poll(() => highlighted(page)).toEqual(pastedIds);
    for (const [index, nodeId] of pastedIds.entries()) {
      await expect(t3.element.locator(`td[data-node-id="${nodeId}"]`)).toHaveText(
        ['r1c1', 'r1c2', 'r2c1', 'r2c2'][index]!,
      );
      await expect(t3.element.locator(`td[data-node-id="${nodeId}"]`)).not.toHaveAttribute(
        'data-id',
      );
    }
    await regular(page, t3.ref);
    // Undo gives back table (3)'s own cells, Redo the pasted ones.
    await menu(page, 'edit', 'undo');
    await expect.poll(async () => corner(await documentOf(page))).toEqual(own);
    expect(await toXml(page)).toBe(cut);
    await menu(page, 'edit', 'redo');
    await expect.poll(async () => corner(await documentOf(page))).toEqual(pastedIds);
    expect(await toXml(page)).toBe(pasted);
  });

  test('FR-030 and U8: pictures travel with a copied block (c22, c07) and with a moved row (c22); no picture data crosses the clipboard', async ({
    core,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openBook(core, page, IMAGES);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/binary\b/.test(request.url()))
        posts.push(request.url());
    });
    const fixture = await toXml(page);
    const doc = await documentOf(page);
    const c22 = tableById(doc, 'c22');
    const c22Ctl = tableById(doc, 'c22-ctl');
    const pictureOf = (id: string) =>
      page.locator(
        `[data-testid="body-table"][data-node-id="${id}"] [data-testid="body-inline-image"]`,
      );

    // c22, the 3 × 3 gallery: its block of rows 1-2 × columns 1-2 copied and pasted at the first
    // cell of its control.
    const corner: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ];
    const sources = cellIdsAt(c22, corner);
    await selectBlock(page, sources[0]!, sources[3]!);
    await expect.poll(() => highlighted(page)).toEqual(sources);
    await page.keyboard.press(`${MOD}+c`);
    await caretIn(page, cellIdsAt(c22Ctl, [[0, 0]])[0]!);
    await page.keyboard.press(`${MOD}+v`);
    const pasted = await changedFrom(page, fixture);
    const hrefs = [
      '#pic-400x300.png',
      '#pic-200x200-alpha.png',
      '#pic-120x90.png',
      '#pic-4000x3000.png',
    ];
    const image = (href: string) => td(`<image l:href="${href}"/>`);
    expect(tableXmlById(pasted, 'c22-ctl')).toBe(
      `<table id="c22-ctl">${tr(image(hrefs[0]!) + image(hrefs[1]!) + td())}${tr(
        image(hrefs[2]!) + image(hrefs[3]!) + td(),
      )}${tr(td() + td() + td())}</table>`,
    );
    const ctl = tableById(await documentOf(page), 'c22-ctl');
    const targets = cellIdsAt(ctl, corner);
    for (const [index, nodeId] of targets.entries()) {
      await expect(
        page.locator(`td[data-node-id="${nodeId}"] [data-testid="body-inline-image"]`),
      ).toHaveAttribute('data-href', hrefs[index]!);
    }
    await expect(pictureOf(ctl.attrs!.nodeId!)).toHaveCount(4);
    expect(tableXmlById(pasted, 'c22')).toBe(tableXmlById(fixture, 'c22'));
    await undoRedo(page, fixture, pasted);

    // c07: a block holding its picture cell under colspan, pasted into its control - the merged
    // cell arrives with its colspan and its picture.
    const c07 = tableById(doc, 'c07');
    const c07Ctl = tableById(doc, 'c07-ctl');
    const c07Rows = cellRows(c07);
    await selectBlock(page, c07Rows[0]![0]!.attrs!.nodeId!, c07Rows[1]![1]!.attrs!.nodeId!);
    await page.keyboard.press(`${MOD}+c`);
    await caretIn(page, cellRows(c07Ctl)[0]![0]!.attrs!.nodeId!);
    await page.keyboard.press(`${MOD}+v`);
    const merged = await changedFrom(page, pasted);
    expect(tableXmlById(merged, 'c07-ctl')).toBe(
      tableXmlById(fixture, 'c07').replace('<table id="c07">', '<table id="c07-ctl">'),
    );
    await undoRedo(page, pasted, merged);

    // Move row down on c22's first row: its pictures move with the row.
    await caretIn(page, sources[0]!);
    await structure(page, 'table.moveRowDown');
    const moved = await changedFrom(page, merged);
    const row = (...names: string[]) => tr(names.map((name) => image(`#${name}`)).join(''));
    expect(tableXmlById(moved, 'c22')).toBe(
      `<table id="c22">${row('pic-120x90.png', 'pic-4000x3000.png', 'pic-48x48.png')}${row(
        'pic-400x300.png',
        'pic-200x200-alpha.png',
        'pic-2000x2000.png',
      )}${row('pic-800x600.png', 'pic-8x6.jpg', 'pic-1600x1200.png')}</table>`,
    );
    await undoRedo(page, merged, moved);
    // The clipboard carried references only (resource-formats.md §20).
    expect(posts).toEqual([]);
  });
});
