/**
 * Feature 006, User Story 2 - Add, remove, move and duplicate rows and columns (T070; spec
 * FR-006 to FR-009, FR-038, FR-040, FR-043, FR-045; US2 sc.1 to sc.11; the spec's edge cases on
 * spanning cells, on header rows growing with header cells and on a note whose only references
 * are deleted; SC-007, SC-009; U22, U38; C14, C28; quickstart §2 "Manual check" and
 * "Automated", §12).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`); skipped
 * in core-less mode. Each test opens `tests/fixtures/books/tables.fb2` through File → Open and a
 * queued `dialog.openFile`, and works on the user story 2 tables of its "Scenario tables"
 * section (T014), each found by the paragraph that names its scenarios and by its `data-node-id`
 * on `[data-testid=body-table]`:
 *  (1) "US2 sc.1, sc.8, sc.9, sc.11, manual step 12": 3 × 3, row 2 `align="center"`, `r2c1`
 *      with the id `us2-r2c1`;
 *  (2) "US2 sc.2, sc.4": `[a rowspan 2, b] / [c]`;
 *  (3) "US2 sc.3 and its edge cases": `[h1, h2 colspan 2] / [r2c1, r2c2, r2c3 align=right] /
 *      [r3c1, r3c2, r3c3 xml:lang=de]`, the first row header cells;
 *  (4) "US2 sc.5": `[x, y] / [a rowspan 2, b] / [c]`;
 *  (5) "US2 sc.6": 5 × 3, `r3c2` holding the only reference to the note `us2-note`;
 *  (6) "US2 sc.7 (one row)" 1 × 3 and "US2 sc.7 (one column)" 3 × 1;
 *  (7) "US2 sc.10": `[r1c1, r1c2] / [r2c1, r2c2] / [m rowspan 2, r3c2] / [r4c2] / [r5c1, r5c2]`.
 *
 * Every command runs through *Edit → Table structure* (`structure()`, which takes the command id
 * so that `tools/parity-check.mjs` finds each id quoted here) or through the context menu, and is
 * followed by Edit → Undo, after which the whole document's XML equals the XML before the command
 * byte for byte, and by Edit → Redo, after which it equals the command's result (sc.8 in every
 * test; SC-007, U22). A test's next command starts from that result, except where a step says
 * "after Undo": one more Undo first returns to the fixture. After every command the table's grid
 * is regular (`__mfbeTest.tables.grid`).
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

/* ------------------------------------------------------------------------ */
/* The page's hooks and the model JSON                                      */
/* ------------------------------------------------------------------------ */

interface Json {
  type: string;
  attrs?: Record<string, unknown> & { nodeId?: string };
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
const T1 = 'US2 sc.1, sc.8, sc.9, sc.11, manual step 12';
const T2 = 'US2 sc.2, sc.4';
const T3 = 'US2 sc.3 and its edge cases';
const T4 = 'US2 sc.5';
const T5 = 'US2 sc.6';
const T6_ROW = 'US2 sc.7 (one row)';
const T6_COLUMN = 'US2 sc.7 (one column)';
const T7 = 'US2 sc.10';

/** The 24 table commands in FR-039's order (the context menu's submenu entries). */
const FR039 = [
  'insertRowAbove',
  'insertRowBelow',
  'deleteRow',
  'insertColumnLeft',
  'insertColumnRight',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderCell',
  'makeHeaderCells',
  'makeNormalCells',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'repair',
  'select',
  'delete',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'duplicateRow',
  'duplicateColumn',
  'paragraphBefore',
  'paragraphAfter',
];

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

/** The model table right after the paragraph whose text is `label`. */
function tableAfter(doc: DocJson, label: string): Json {
  const search = (parent: Json): Json | null => {
    const children = parent.content ?? [];
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index]!;
      if (node.type === 'p' && textOf(node) === label) {
        const table = children[index + 1];
        if (table?.type === 'table') return table;
      }
      const found = search(node);
      if (found) return found;
    }
    return null;
  };
  for (const body of doc.bodies) {
    const found = search(body);
    if (found) return found;
  }
  throw new Error(`no table after the paragraph "${label}"`);
}

/** The cell of `table` whose text is `text`. */
function cellOf(table: Json, text: string): Json {
  for (const row of table.content ?? []) {
    for (const cell of row.content ?? []) {
      if ((cell.type === 'td' || cell.type === 'th') && textOf(cell) === text) return cell;
    }
  }
  throw new Error(`no cell "${text}"`);
}

/**
 * The table after the paragraph `label`, cut out of the document's XML with the white space
 * between tags removed and an empty element written one way (`<td/>`).
 */
function tableXml(xml: string, label: string): string {
  const flat = xml.replace(/>\s+</g, '><');
  const marker = `<p>${label}</p>`;
  const at = flat.indexOf(`${marker}<table`);
  if (at < 0) throw new Error(`no table after "${label}" in the XML`);
  const from = at + marker.length;
  const to = flat.indexOf('</table>', from) + '</table>'.length;
  return flat.slice(from, to).replace(/<(t[dhr])((?:\s[^>]*)?)><\/\1>/g, '<$1$2/>');
}

/** A row of the expected XML: `<tr>` with its cells. */
function tr(cells: string, align?: string): string {
  return `<tr${align ? ` align="${align}"` : ''}>${cells}</tr>`;
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

/* ------------------------------------------------------------------------ */
/* Page helpers                                                             */
/* ------------------------------------------------------------------------ */

async function menu(page: Page, menuId: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menuId}`).click();
  await page.getByTestId(`menu-${menuId}-${itemId}`).click();
}

/** The entry of *Edit → Table structure* for the command `commandId`, its submenu open. */
async function structureEntry(page: Page, commandId: string) {
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

/** `tables.fb2` through File → Open and the queued native dialog; the hooks ready. */
async function openTables(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await core.enqueueDialog('dialog.openFile', { paths: [TABLES] });
  await menu(page, 'file', 'open');
  await waitForBook(page, TABLES);
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
  cell(text: string): string;
}

async function scenario(page: Page, label: string): Promise<Scenario> {
  const model = tableAfter(await documentOf(page), label);
  const ref = model.attrs!.nodeId!;
  await expect(
    page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`),
    `the table after "${label}" in the Body view`,
  ).toHaveCount(1);
  return {
    label,
    ref,
    cell: (text) => cellOf(model, text).attrs!.nodeId!,
  };
}

/** The caret at `offset` of the cell with the node id `nodeId`. */
async function caretIn(page: Page, nodeId: string, offset = 1): Promise<void> {
  const placed = await page.evaluate(([id, at]) => window.__mfbeTest!.scripts!.select(id, at, at), [
    nodeId,
    offset,
  ] as const);
  expect(placed, `the caret in ${nodeId}`).toBe(true);
}

/** The table's grid is regular: no short row, no overlap, no span past the end. */
async function regular(page: Page, ref: string): Promise<void> {
  const summary = await page.evaluate((id) => window.__mfbeTest!.tables!.grid(id), ref);
  expect(summary, `the grid of ${ref}`).toMatchObject({ shortRows: 0, overlaps: 0, pastEnd: 0 });
}

/**
 * Runs one command (`run`), then checks it as every test does: the document changed, the
 * table after `label` is `expected`, its grid regular, and `check` (the caret, before Undo
 * moves it); Edit → Undo gives back the XML before, byte for byte, and Edit → Redo the result
 * (SC-007, U22). Returns the XML before and after.
 */
async function command(
  page: Page,
  target: Scenario,
  run: () => Promise<void>,
  expected: string,
  check?: () => Promise<void>,
): Promise<{ before: string; after: string }> {
  const before = await toXml(page);
  await run();
  await expect
    .poll(() => toXml(page), { message: 'the command changed the document' })
    .not.toBe(before);
  const after = await toXml(page);
  expect(tableXml(after, target.label)).toBe(expected);
  await regular(page, target.ref);
  if (check) await check();
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page), { message: 'one Undo restores the XML' }).toBe(before);
  await menu(page, 'edit', 'redo');
  await expect.poll(() => toXml(page), { message: 'one Redo applies it again' }).toBe(after);
  return { before, after };
}

/** One more Edit → Undo, back to `xml`. */
async function undoTo(page: Page, xml: string): Promise<void> {
  await menu(page, 'edit', 'undo');
  await expect.poll(() => toXml(page)).toBe(xml);
}

/** The cell element of the Body view with the node id `nodeId` inside the table `ref`. */
function cellElement(page: Page, ref: string, nodeId: string) {
  return page.locator(
    `[data-testid="body-table"][data-node-id="${ref}"] :is(td, th)[data-node-id="${nodeId}"]`,
  );
}

/** A mouse drag over the cells `nodeIds`, from the first cell's centre to the last's. */
async function drag(page: Page, ref: string, nodeIds: string[]): Promise<void> {
  await page.locator(`[data-testid="body-table"][data-node-id="${ref}"]`).scrollIntoViewIfNeeded();
  const centres: { x: number; y: number }[] = [];
  for (const nodeId of nodeIds) {
    const box = (await cellElement(page, ref, nodeId).boundingBox())!;
    centres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const [first, ...rest] = centres;
  await page.mouse.move(first!.x, first!.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
}

/** The unavailable title of a command: "<command>: <reason>" (FR-043; data-model §9.6). */
async function expectDisabled(page: Page, commandId: string, title: string): Promise<void> {
  const entry = await structureEntry(page, commandId);
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await expect(entry).toHaveAttribute('title', title);
  await expect(entry).toHaveAttribute('aria-description', title);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-edit-popup')).toHaveCount(0);
}

/* ------------------------------------------------------------------------ */
/* The tables of the fixture, as the writer gives them                      */
/* ------------------------------------------------------------------------ */

const T1_ROW1 = tr(tds('r1c1', 'r1c2', 'r1c3'));
const T1_ROW2 = tr(td('r2c1', ' id="us2-r2c1"') + tds('r2c2', 'r2c3'), 'center');
const T1_ROW3 = tr(tds('r3c1', 'r3c2', 'r3c3'));
const T3_ROW1 = tr(th('h1') + th('h2', ' colspan="2"'));

test.describe('US2 (feature 006) - rows and columns', () => {
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

  test('sc.1: Insert row below and above - an empty row with the reference row’s align, the caret in its first cell', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    await caretIn(page, t1.cell('r2c2'));
    const status = page.getByTestId('status-path');
    const below = await command(
      page,
      t1,
      () => structure(page, 'table.insertRowBelow'),
      table(T1_ROW1, T1_ROW2, tr(td() + td() + td(), 'center'), T1_ROW3),
      // The caret in the new row's first cell.
      () => expect(status).toHaveText(/tr\[3\]\/td\[1\]$/),
    );
    // After Undo, Insert row above from r2c2: the reference row is the caret's own (§4.1).
    await undoTo(page, below.before);
    await caretIn(page, t1.cell('r2c2'));
    await command(
      page,
      t1,
      () => structure(page, 'table.insertRowAbove'),
      table(T1_ROW1, tr(td() + td() + td(), 'center'), T1_ROW2, T1_ROW3),
      () => expect(status).toHaveText(/tr\[2\]\/td\[1\]$/),
    );
  });

  test('sc.2: Insert row below next to a cell spanning two rows - the span grows over the new row', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t2 = await scenario(page, T2);
    await caretIn(page, t2.cell('b'));
    await command(
      page,
      t2,
      () => structure(page, 'table.insertRowBelow'),
      table(tr(td('a', ' rowspan="3"') + td('b')), tr(td()), tr(td('c'))),
    );
  });

  test('sc.3: Insert column to the right beside a header cell over two columns - its colspan grows', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t3 = await scenario(page, T3);
    await caretIn(page, t3.cell('r2c2'));
    await command(
      page,
      t3,
      () => structure(page, 'table.insertColumnRight'),
      table(
        tr(th('h1') + th('h2', ' colspan="3"')),
        tr(tds('r2c1', 'r2c2') + td() + td('r2c3', ' align="right"')),
        tr(tds('r3c1', 'r3c2') + td() + td('r3c3', ' xml:lang="de"')),
      ),
    );
  });

  test('edge cases: a column at the spanning cell’s left or right edge, new cells copy their neighbours, header rows grow with header cells', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t3 = await scenario(page, T3);
    // Insert column to the left at h2's left edge: a th in the header row, plain tds below.
    await caretIn(page, t3.cell('h2'));
    const left = await command(
      page,
      t3,
      () => structure(page, 'table.insertColumnLeft'),
      table(
        tr(th('h1') + th() + th('h2', ' colspan="2"')),
        tr(td('r2c1') + td() + td('r2c2') + td('r2c3', ' align="right"')),
        tr(td('r3c1') + td() + td('r3c2') + td('r3c3', ' xml:lang="de"')),
      ),
    );
    // After Undo, to the right: at h2's right edge, each new cell copying its neighbour (FR-008).
    await undoTo(page, left.before);
    await caretIn(page, t3.cell('h2'));
    const right = await command(
      page,
      t3,
      () => structure(page, 'table.insertColumnRight'),
      table(
        tr(th('h1') + th('h2', ' colspan="2"') + th()),
        tr(tds('r2c1', 'r2c2') + td('r2c3', ' align="right"') + td('', ' align="right"')),
        tr(tds('r3c1', 'r3c2') + td('r3c3', ' xml:lang="de"') + td('', ' xml:lang="de"')),
      ),
    );
    // After Undo, Insert row below from the header row: a row of three header cells.
    await undoTo(page, right.before);
    await caretIn(page, t3.cell('h2'));
    await command(
      page,
      t3,
      () => structure(page, 'table.insertRowBelow'),
      table(
        T3_ROW1,
        tr(th() + th() + th()),
        tr(tds('r2c1', 'r2c2') + td('r2c3', ' align="right"')),
        tr(tds('r3c1', 'r3c2') + td('r3c3', ' xml:lang="de"')),
      ),
    );
  });

  test('sc.4: Delete row under a cell spanning two rows - the span shrinks, the cells keep their columns', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t2 = await scenario(page, T2);
    await caretIn(page, t2.cell('c'));
    await command(page, t2, () => structure(page, 'table.deleteRow'), table(tr(tds('a', 'b'))));
  });

  test('sc.5: Delete row of a merged cell’s top row - the cell moves down with its content', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t4 = await scenario(page, T4);
    await caretIn(page, t4.cell('a'));
    await command(
      page,
      t4,
      () => structure(page, 'table.deleteRow'),
      table(tr(tds('x', 'y')), tr(tds('a', 'c'))),
    );
  });

  test('sc.6: Delete row and Delete column on a block made by a mouse drag - one undo step; the note stays', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t5 = await scenario(page, T5);
    const note = (xml: string) => /<section id="us2-note">[\s\S]*?<\/section>/.exec(xml)?.[0];
    const fixture = await toXml(page);
    const noteBefore = note(fixture);
    expect(noteBefore, 'the note us2-note').toContain('it stays when its only reference goes');
    const ids = (texts: string[]) => texts.map((text) => t5.cell(text));
    const selected = page.locator(
      `[data-testid="body-table"][data-node-id="${t5.ref}"] .mfbe-cell-selected`,
    );

    // Rows 2 to 4 by a drag down the first column.
    await drag(page, t5.ref, ids(['r2c1', 'r3c1', 'r4c1']));
    await expect(selected).toHaveCount(3);
    const rows = await command(
      page,
      t5,
      () => structure(page, 'table.deleteRow'),
      table(tr(tds('r1c1', 'r1c2', 'r1c3')), tr(tds('r5c1', 'r5c2', 'r5c3'))),
    );
    // The note is kept, although its only reference stood in r3c2 (U38: Validate has no
    // unused-note report, so only the note's presence is checked).
    expect(note(rows.after)).toBe(noteBefore);

    // After Undo, columns 1 and 2 by a drag along the first row, from a caret (the Undo gave the
    // block back).
    await undoTo(page, rows.before);
    await cellElement(page, t5.ref, t5.cell('r1c1')).click();
    await drag(page, t5.ref, ids(['r1c1', 'r1c2']));
    await expect(selected).toHaveCount(2);
    await command(
      page,
      t5,
      () => structure(page, 'table.deleteColumn'),
      table(tr(td('r1c3')), tr(td('r2c3')), tr(td('r3c3')), tr(td('r4c3')), tr(td('r5c3'))),
    );
  });

  test('sc.7: Delete row in a table of one row and Delete column in a table of one column are unavailable, with their reasons', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const before = await toXml(page);
    const oneRow = await scenario(page, T6_ROW);
    await caretIn(page, oneRow.cell('r1c2'));
    await expectDisabled(
      page,
      'table.deleteRow',
      'Delete row: the table has only one row; use Delete table',
    );
    const oneColumn = await scenario(page, T6_COLUMN);
    await caretIn(page, oneColumn.cell('r2c1'));
    await expectDisabled(
      page,
      'table.deleteColumn',
      'Delete column: the table has only one column; use Delete table',
    );
    expect(await toXml(page)).toBe(before);
  });

  test('sc.9: Move row up and Move column right and left - rows and columns exchange with their contents and attributes', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    await caretIn(page, t1.cell('r3c1'));
    // Rows 2 and 3 exchange; align="center" and id="us2-r2c1" travel with row 2.
    const up = await command(
      page,
      t1,
      () => structure(page, 'table.moveRowUp'),
      table(T1_ROW1, T1_ROW3, T1_ROW2),
    );
    // After Undo, columns 2 and 3 exchange, and Move column left from the moved cell undoes it.
    await undoTo(page, up.before);
    await caretIn(page, t1.cell('r1c2'));
    const right = await command(
      page,
      t1,
      () => structure(page, 'table.moveColumnRight'),
      table(
        tr(tds('r1c1', 'r1c3', 'r1c2')),
        tr(td('r2c1', ' id="us2-r2c1"') + tds('r2c3', 'r2c2'), 'center'),
        tr(tds('r3c1', 'r3c3', 'r3c2')),
      ),
    );
    await caretIn(page, t1.cell('r1c2'));
    const back = await command(
      page,
      t1,
      () => structure(page, 'table.moveColumnLeft'),
      table(T1_ROW1, T1_ROW2, T1_ROW3),
    );
    expect(back.after).toBe(right.before);
  });

  test('sc.10: Move row down past a band of two rows; Move row up refused where a merged cell crosses the row’s border', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t7 = await scenario(page, T7);
    await caretIn(page, t7.cell('r2c1'));
    const down = await command(
      page,
      t7,
      () => structure(page, 'table.moveRowDown'),
      table(
        tr(tds('r1c1', 'r1c2')),
        tr(td('m', ' rowspan="2"') + td('r3c2')),
        tr(td('r4c2')),
        tr(tds('r2c1', 'r2c2')),
        tr(tds('r5c1', 'r5c2')),
      ),
    );
    await undoTo(page, down.before);
    await caretIn(page, t7.cell('r3c2'));
    await expectDisabled(
      page,
      'table.moveRowUp',
      'Move row up: a merged cell crosses the border of the row',
    );
    expect(await toXml(page)).toBe(down.before);
  });

  test('sc.11: Duplicate row and Duplicate column - copies with contents, kinds and attributes, without the id', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    await caretIn(page, t1.cell('r2c1'));
    const row = await command(
      page,
      t1,
      () => structure(page, 'table.duplicateRow'),
      table(T1_ROW1, T1_ROW2, tr(tds('r2c1', 'r2c2', 'r2c3'), 'center'), T1_ROW3),
    );
    await undoTo(page, row.before);
    await caretIn(page, t1.cell('r2c1'));
    await command(
      page,
      t1,
      () => structure(page, 'table.duplicateColumn'),
      table(
        tr(tds('r1c1', 'r1c1', 'r1c2', 'r1c3')),
        tr(td('r2c1', ' id="us2-r2c1"') + tds('r2c1', 'r2c2', 'r2c3'), 'center'),
        tr(tds('r3c1', 'r3c1', 'r3c2', 'r3c3')),
      ),
    );
  });

  test('context menu table section: a right-click moves the caret into the clicked cell; Table structure acts on that table', async ({
    core,
    page,
  }) => {
    await openTables(core, page);
    const t1 = await scenario(page, T1);
    const t2 = await scenario(page, T2);
    // The caret in table (2) by a click, so the editor holds the focus for the right-click.
    await cellElement(page, t2.ref, t2.cell('b')).click();
    await expect
      .poll(async () =>
        page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection()?.head.nodeId),
      )
      .toBe(t2.cell('b'));
    const fixture = await toXml(page);
    // The right-click rule (C28): the caret into the clicked cell of the other table.
    await cellElement(page, t1.ref, t1.cell('r2c2')).click({ button: 'right' });
    const contextMenu = page.getByTestId('context-menu');
    await expect(contextMenu).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => window.__mfbeTest!.sourceMapping!.bodySelection()?.head.nodeId),
      )
      .toBe(t1.cell('r2c2'));
    // The table section: the submenu only (issue #8: no Table…), no table command directly
    // (decision 2).
    await expect(page.getByTestId('context-menu-insert.table')).toHaveCount(0);
    await expect(page.getByTestId('context-menu-tableStructure')).toBeVisible();
    await expect(contextMenu.locator('[data-testid^="context-menu-table."]')).toHaveCount(0);
    await page.getByTestId('context-menu-tableStructure').click();
    const popup = page.getByTestId('context-menu-tableStructure-popup');
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('menuitem')).toHaveCount(FR039.length);
    const entries = await popup
      .getByRole('menuitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
    expect(entries).toEqual(FR039.map((name) => `context-menu-tableStructure-${name}`));
    const insertRowBelow = page.getByTestId('context-menu-tableStructure-insertRowBelow');
    await expect(insertRowBelow).not.toHaveAttribute('aria-disabled');
    // Insert row below acts on the clicked table, as one undo step; table (2) is unchanged.
    const { after } = await command(
      page,
      t1,
      () => insertRowBelow.click(),
      table(T1_ROW1, T1_ROW2, tr(td() + td() + td(), 'center'), T1_ROW3),
    );
    expect(tableXml(after, T2)).toBe(tableXml(fixture, T2));
    await regular(page, t2.ref);
  });
});
