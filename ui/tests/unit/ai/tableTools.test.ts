/**
 * Feature 006 T171 (contracts/ai-catalogue.md §3.9, Δ§1.4, Δ§3.5, Δ§3.7, Δ§9.2; data-model §15.1,
 * §15.2; FR-049 to FR-052, FR-035, FR-036, FR-067; US11 sc.1 to sc.3; C13, C62 to C64, C67, C68;
 * U36) - the assistant's table tools over the harness's `tablesBook()`:
 *
 * - `read_table`: the grid with every position named (the earlier cell of an overlap, `null`
 *   for a hole), every cell with its row, column, effective spans above 1, schema attributes,
 *   `overlaps` / `pastEnd` and text (U+FFFC per picture); `problems` only when irregular; `fb2xml`
 *   one `fragmentToXml` per non-empty cell, the linked picture with its mark; the window; parts of
 *   whole rows with a cursor that round-trips, `above` and `tooLarge`; the references; no hook;
 * - `edit_table` against the user's own commands (`planCommand` on a Body editor state), new
 *   nodes' ids ignored (U36); kept rows the same objects; FR-035 on irregular tables; every
 *   refusal with its envelope and `reason`; the strikes of the real hook (C68); the results;
 *   `confirmationRequired` (FR-052) with the shared link count (FR-067); FR-049; the annotation's
 *   table; the size guard of SC-010.
 */

import { TextSelection, type EditorState } from 'prosemirror-state';

import { ToolError, type ToolErrorEnvelope } from '@/ai/catalogue';
import {
  applyChange,
  rejectedEnvelope,
  rejectionFromEnvelope,
  type ChangeOutcome,
} from '@/ai/hook';
import { startRequestSession } from '@/ai/session';
import { docFromModel } from '@/editor/fromModel';
import { findNodeById } from '@/editor/schema';
import { planCellAttrs, planRowAlign, planSpan, planTableAttrs } from '@/editor/table/attrs';
import { planCommand, type TablePlan } from '@/editor/table/commands';
import {
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMerge,
  planMoveColumns,
  planMoveRows,
  planRepair,
  planSetKind,
  planSplit,
  planToggleHeaderLines,
} from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { nodeToModel } from '@/editor/toModel';
import type { Document } from '@/model/document';
import { collectBookIds } from '@/model/ids';
import { createBodyEditorState } from '@/views/body/bodyEditor';

import { harness, tableNode, tablesBook, type Harness } from './catalogueHarness';
import { harness as sessionHarness } from './sessionUtils';

type Json = Record<string, unknown>;
type Loose = { type?: string; text?: string; attrs?: Json; content?: Loose[]; marks?: unknown[] };

let h: Harness;

beforeEach(async () => {
  h = await harness({ document: tablesBook() });
});

afterEach(async () => {
  await h.catalogue.close();
});

const call = (name: string, args: Json | string) => h.catalogue.call(name, args);

/** The table with the node id `id` in the bodies or the annotation of `doc`. */
function findTable(doc: Document, id: string): Loose {
  let found: Loose | null = null;
  const visit = (node: Loose | undefined) => {
    if (!node || found) return;
    if (node.type === 'table' && node.attrs?.nodeId === id) found = node;
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body as unknown as Loose);
  visit(doc.description.titleInfo.annotation as unknown as Loose);
  if (!found) throw new Error(`no table ${id}`);
  return found;
}

/** Every node id below a JSON node. */
function idsOf(node: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const item of node) idsOf(item, into);
  else if (node && typeof node === 'object') {
    const value = node as Loose;
    if (typeof value.attrs?.nodeId === 'string') into.add(value.attrs.nodeId);
    idsOf(value.content, into);
  }
  return into;
}

/** The JSON with every node id `known` lacks replaced by `new` (U36). */
function normalised(node: unknown, known: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => normalised(item, known));
  if (node && typeof node === 'object') {
    const out: Json = {};
    for (const [key, value] of Object.entries(node as Json)) {
      out[key] =
        key === 'nodeId' && typeof value === 'string' && !known.has(value)
          ? 'new'
          : normalised(value, known);
    }
    return out;
  }
  return node;
}

function ids(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}${next++}`;
}

type Selector = { caret: string } | { block: [string, string] };

/** The table after the user's command: the plan through `planCommand` on a Body editor state. */
function userCommand(tableId: string, plan: TablePlan, select: Selector): unknown {
  const document = tablesBook();
  let state: EditorState = createBodyEditorState(docFromModel(document).node, {
    getNbspChar: () => '\u00b7',
    nextNodeId: ids('ui_'),
  });
  const at = (id: string) => findNodeById(state.doc, id)!.pos;
  const selection =
    'caret' in select
      ? TextSelection.create(state.doc, at(select.caret) + 1)
      : CellBlockSelection.create(state.doc, at(select.block[0]), at(select.block[1]));
  state = state.apply(state.tr.setSelection(selection));
  let next: EditorState | null = null;
  const ran = planCommand(plan, { nextId: ids('ui_'), bookIds: collectBookIds(document) })(
    state,
    (tr) => {
      next = state.apply(tr);
    },
  );
  expect(ran, 'the user command ran').toBe(true);
  return nodeToModel(findNodeById(next!.doc, tableId)!.node);
}

/* ------------------------------------------------------------------------ */
/* read_table                                                               */
/* ------------------------------------------------------------------------ */

describe('read_table', () => {
  it('gives a regular table with a header row, merged cells and mixed kinds as a grid; reading changes nothing and calls no hook', async () => {
    const before = h.copy.document;
    const out = await call('read_table', { table: 'tB' });
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({
      table: { id: 'tB', path: 'body[1]/section[1]/table[2]', type: 'table' },
      rowCount: 3,
      columnCount: 3,
      regular: true,
      format: 'text',
      fromRow: 1,
      toRow: 3,
    });
    expect(out.result).not.toHaveProperty('problems');
    expect(out.result).not.toHaveProperty('above');
    expect(out.result).not.toHaveProperty('more');
    const rows = out.result.rows as Json[];
    expect(rows.map((row) => row.grid)).toEqual([
      ['tBr1c1', 'tBr1c1', 'tBr1c2'],
      ['tBr2c1', 'tBr2c2', 'tBr2c3'],
      ['tBr3c1', 'tBr3c2', 'tBr2c3'],
    ]);
    expect(rows.map((row) => row.id)).toEqual(['tBr1', 'tBr2', 'tBr3']);
    expect(rows[0]!.cells).toEqual([
      { id: 'tBr1c1', kind: 'th', row: 1, column: 1, colspan: 2, text: 'H1' },
      { id: 'tBr1c2', kind: 'th', row: 1, column: 3, text: 'H3' },
    ]);
    expect(rows[1]!.cells).toEqual([
      { id: 'tBr2c1', kind: 'td', row: 2, column: 1, text: 'x' },
      { id: 'tBr2c2', kind: 'td', row: 2, column: 2, text: 'y' },
      { id: 'tBr2c3', kind: 'td', row: 2, column: 3, rowspan: 2, text: 'M' },
    ]);
    expect(rows[2]!.cells).toHaveLength(2);
    expect(h.copy.document).toBe(before);
    expect(h.hookCalls).toEqual([]);
  });

  it('pictures are U+FFFC in text; attrs hold the schema attributes only; fb2xml asks fragmentToXml once per non-empty cell, the linked picture with its mark', async () => {
    const text = await call('read_table', { table: 'tC' });
    const cells = (text.result.rows as { cells: Json[] }[]).flatMap((row) => row.cells);
    expect(cells.slice(0, 3).map((cell) => cell.text)).toEqual(['\uFFFC', '\uFFFC', '\uFFFC']);
    expect(cells[3]).toMatchObject({ attrs: { lang: 'de' }, text: 'deutsch' });
    expect(cells[4]).toMatchObject({ attrs: { id: 'c12' }, text: 'target' });
    expect(cells[5]).not.toHaveProperty('attrs');
    await h.catalogue.close();
    const calls: Loose[][] = [];
    h = await harness({
      document: tablesBook(),
      fragmentToXml: (nodes) => {
        calls.push(nodes as unknown as Loose[]);
        return Promise.resolve(`<xml n="${calls.length}"/>`);
      },
    });
    const xml = await call('read_table', { table: 'tA', format: 'fb2xml' });
    const xmlCells = (xml.result.rows as { cells: Json[] }[]).flatMap((row) => row.cells);
    expect(calls).toHaveLength(3); // `a`, `c`, `d` - never the empty cell
    expect(xmlCells.map((cell) => cell.xml)).toEqual([
      expect.any(String),
      '',
      expect.any(String),
      expect.any(String),
    ]);
    for (const cell of xmlCells) expect(cell).not.toHaveProperty('text');
    calls.length = 0;
    await call('read_table', { table: 'tC', format: 'fb2xml' });
    const linked = calls.find((nodes) => nodes[0]?.attrs?.nodeId === 'img2')!;
    expect(linked[0]!.marks).toEqual([{ type: 'link', attrs: { href: '#c1' } }]);
  });

  it('irregular tables: a hole is null, an overlap names the earlier cell and marks the later, a span past the end; problems in English', async () => {
    const short = await call('read_table', { table: 'tShort' });
    expect(short.result).toMatchObject({ regular: false, problems: 'row 2 covers 2 of 3 columns' });
    expect((short.result.rows as Json[])[1]!.grid).toEqual(['tShortr2c1', 'tShortr2c2', null]);
    const overlap = await call('read_table', { table: 'tOverlap' });
    expect(overlap.result).toMatchObject({ regular: false, problems: '1 overlapping span' });
    const overlapRows = overlap.result.rows as { grid: unknown[]; cells: Json[] }[];
    expect(overlapRows[1]!.grid).toEqual(['tOverlapr2c1', 'tOverlapr1c2']);
    expect(overlapRows[1]!.cells[0]).toMatchObject({ colspan: 2, overlaps: true });
    const past = await call('read_table', { table: 'tPast' });
    expect(past.result).toMatchObject({
      regular: false,
      problems: '1 span reaches past the last row',
    });
    const pastRows = past.result.rows as { grid: unknown[]; cells: Json[] }[];
    expect(pastRows[0]!.cells[0]).toMatchObject({ rowspan: 3, pastEnd: true });
    expect(pastRows[1]!.grid).toEqual(['tPastr1c1', 'tPastr2c1']);
  });

  it('the window: toRow past the end reads to the last row; fromRow past it or toRow below fromRow is invalidArguments with expected; a window inside a band lists it in above', async () => {
    const tail = await call('read_table', { table: 'tB', fromRow: '3', toRow: 99 });
    expect(tail.result).toMatchObject({ fromRow: 3, toRow: 3 });
    expect(tail.result.above).toEqual([
      { id: 'tBr2c3', kind: 'td', row: 2, column: 3, rowspan: 2, text: 'M' },
    ]);
    for (const args of [
      { table: 'tB', fromRow: 4 },
      { table: 'tB', fromRow: 2, toRow: 1 },
    ]) {
      const out = await call('read_table', args);
      expect(out.error).toMatchObject({
        code: 'invalidArguments',
        expected: { rowCount: 3, columnCount: 3 },
      });
    }
    expect(h.hookCalls).toEqual([]);
  });

  it('parts of whole rows under a budget: the cursor round-trips with the same arguments, above in a part that starts inside a band, remaining rows and characters; one row larger than a part is tooLarge', async () => {
    await h.catalogue.close();
    const long = 'x'.repeat(200);
    const book = tablesBook();
    const section = book.bodies[0]!.content[0] as unknown as Loose;
    section.content!.push(
      tableNode('tBand', [
        [{ text: long, attrs: { rowspan: 2 } }, long],
        [long],
        [long, long],
      ]) as never,
    );
    let budget = 1000;
    h = await harness({ document: book, resultBudget: () => budget });
    const first = await call('read_table', { table: 'tBand' });
    expect((first.result.rows as Json[]).map((row) => row.row)).toEqual([1]);
    expect(first.result.more).toMatchObject({
      cursor: 'after:tBandr1',
      remaining: { rows: 2, characters: 600 },
    });
    const second = await call('read_table', {
      table: 'tBand',
      cursor: (first.result.more as Json).cursor as string,
    });
    expect((second.result.rows as Json[]).map((row) => row.row)).toEqual([2]);
    expect(second.result.above).toEqual([
      { id: 'tBandr1c1', kind: 'td', row: 1, column: 1, rowspan: 2, text: long },
    ]);
    const third = await call('read_table', {
      table: 'tBand',
      cursor: (second.result.more as Json).cursor as string,
    });
    expect((third.result.rows as Json[]).map((row) => row.row)).toEqual([3]);
    expect(third.result).not.toHaveProperty('more');
    const unknown = await call('read_table', { table: 'tBand', cursor: 'after:nope' });
    expect(unknown.error?.code).toBe('invalidArguments');
    budget = 500;
    const tooLarge = await call('read_table', { table: 'tBand' });
    expect(tooLarge.error).toMatchObject({
      code: 'tooLarge',
      node: { id: 'tBandr1', type: 'tr' },
      hint: 'read its cells with read_part',
    });
    expect(tooLarge.error!.characters).toBe(400);
  });

  it('references: a td id and a tr path lead to their table; a section is invalidArguments with the hint; an unknown id unknownNode', async () => {
    for (const table of ['tBr2c1', 'body[1]/section[1]/table[2]/tr[3]']) {
      const out = await call('read_table', { table });
      expect((out.result.table as Json).id, table).toBe('tB');
    }
    const section = await call('read_table', { table: 's1t' });
    expect(section.error).toMatchObject({
      code: 'invalidArguments',
      hint: 'pass a table, or a row or cell of it; read_part lists cells with their ids',
    });
    const unknown = await call('read_table', { table: 'n999' });
    expect(unknown.error?.code).toBe('unknownNode');
  });
});

/* ------------------------------------------------------------------------ */
/* edit_table: parity with the user's commands                              */
/* ------------------------------------------------------------------------ */

interface ParityCase {
  name: string;
  table: string;
  args: Json;
  plan: TablePlan;
  select: Selector;
}

const PARITY: ParityCase[] = [
  {
    name: 'insertRows after row 2 = Insert row below',
    table: 'tB',
    args: { op: 'insertRows', row: 2, where: 'after' },
    plan: (a, c) => planInsertRows(a, { side: 'below' }, c),
    select: { caret: 'tBr2c1' },
  },
  {
    name: 'insertRows after row 3, count 2 = Insert row below on a block of two rows',
    table: 'tB',
    args: { op: 'insertRows', row: 3, where: 'after', count: 2 },
    plan: (a, c) => planInsertRows(a, { side: 'below' }, c),
    select: { block: ['tBr2c1', 'tBr3c1'] },
  },
  {
    name: 'insertColumns before column 2 = Insert column to the left',
    table: 'tB',
    args: { op: 'insertColumns', column: 2, where: 'before' },
    plan: (a, c) => planInsertColumns(a, { side: 'left' }, c),
    select: { caret: 'tBr2c2' },
  },
  {
    name: 'deleteRows = Delete row',
    table: 'tB',
    args: { op: 'deleteRows', row: 3 },
    plan: planDeleteRows,
    select: { caret: 'tBr3c1' },
  },
  {
    name: 'deleteColumns of two columns = Delete column on a block',
    table: 'tB',
    args: { op: 'deleteColumns', column: 1, columns: 2 },
    plan: planDeleteColumns,
    select: { block: ['tBr2c1', 'tBr2c2'] },
  },
  {
    name: 'moveRows down = Move row down',
    table: 'tA',
    args: { op: 'moveRows', row: 1, direction: 'down' },
    plan: (a, c) => planMoveRows(a, { direction: 'down' }, c),
    select: { caret: 'tAr1c1' },
  },
  {
    name: 'moveColumns left = Move column left',
    table: 'tA',
    args: { op: 'moveColumns', column: 2, direction: 'left' },
    plan: (a, c) => planMoveColumns(a, { direction: 'left' }, c),
    select: { caret: 'tAr1c2' },
  },
  {
    name: 'duplicateRows = Duplicate row',
    table: 'tB',
    args: { op: 'duplicateRows', row: 1 },
    plan: planDuplicateRows,
    select: { caret: 'tBr1c2' },
  },
  {
    name: 'duplicateColumns = Duplicate column',
    table: 'tB',
    args: { op: 'duplicateColumns', column: 3 },
    plan: planDuplicateColumns,
    select: { caret: 'tBr1c2' },
  },
  {
    name: 'merge = Merge cells on the block',
    table: 'tB',
    args: { op: 'merge', row: 2, column: 1, rows: 2, columns: 2 },
    plan: planMerge,
    select: { block: ['tBr2c1', 'tBr3c2'] },
  },
  {
    name: 'split through any position of the merged cell = Split cell',
    table: 'tB',
    args: { op: 'split', row: 1, column: 2 },
    plan: planSplit,
    select: { caret: 'tBr1c1' },
  },
  {
    name: 'setKind th of a row of normal cells = Toggle header row',
    table: 'tB',
    args: { op: 'setKind', kind: 'th', row: 3 },
    plan: (a, c) => planToggleHeaderLines(a, { axis: 'row' }, c),
    select: { caret: 'tBr3c1' },
  },
  {
    name: 'setKind td of a block = Make normal cells',
    table: 'tB',
    args: { op: 'setKind', kind: 'td', row: 1, column: 1, columns: 3 },
    plan: (a, c) => planSetKind(a, { kind: 'td' }, c),
    select: { block: ['tBr1c1', 'tBr1c2'] },
  },
  {
    name: 'setAttributes align of a block = the Table bar on the block',
    table: 'tB',
    args: {
      op: 'setAttributes',
      row: 2,
      column: 1,
      rows: 2,
      columns: 2,
      attrs: { align: 'center' },
    },
    plan: (a, c) => planCellAttrs(a, { align: 'center' }, c),
    select: { block: ['tBr2c1', 'tBr3c2'] },
  },
  {
    name: 'setAttributes of rows = Row align',
    table: 'tB',
    args: { op: 'setAttributes', of: 'rows', row: 2, attrs: { align: 'right' } },
    plan: (a, c) => planRowAlign(a, { align: 'right' }, c),
    select: { caret: 'tBr2c1' },
  },
  {
    name: 'setAttributes of the table = Table ID and Table Style',
    table: 'tB',
    args: { op: 'setAttributes', of: 'table', attrs: { id: 'tbl', style: 'grid' } },
    plan: (a, c) => planTableAttrs(a, { id: 'tbl', style: 'grid' }, c),
    select: { caret: 'tBr2c1' },
  },
  {
    name: 'setAttributes colspan growth = the colspan field',
    table: 'tA',
    args: { op: 'setAttributes', row: 2, column: 1, attrs: { colspan: 2 } },
    plan: (a, c) => planSpan(a, { axis: 'colspan', value: 2 }, c),
    select: { caret: 'tAr2c1' },
  },
  {
    name: 'repair = Repair table',
    table: 'tShort',
    args: { op: 'repair' },
    plan: planRepair,
    select: { caret: 'tShortr1c1' },
  },
  {
    name: 'insertColumns beside a short row leaves the short row (FR-035)',
    table: 'tShort',
    args: { op: 'insertColumns', column: 3, where: 'after' },
    plan: (a, c) => planInsertColumns(a, { side: 'right' }, c),
    select: { caret: 'tShortr1c3' },
  },
  {
    name: 'deleteRows on an overlap (FR-035)',
    table: 'tOverlap',
    args: { op: 'deleteRows', row: 1 },
    plan: planDeleteRows,
    select: { caret: 'tOverlapr1c1' },
  },
];

describe('edit_table parity with the user commands (new nodes ids ignored, U36)', () => {
  it.each(PARITY.map((entry) => [entry.name, entry] as const))('%s', async (_name, entry) => {
    const known = idsOf(findTable(h.copy.document, entry.table));
    const out = await call('edit_table', { table: entry.table, ...entry.args });
    expect(out.isError, JSON.stringify(out.result)).toBe(false);
    expect(out.result).toMatchObject({ op: entry.args.op });
    const assistant = findTable(h.copy.document, entry.table);
    expect(assistant.attrs?.nodeId).toBe(entry.table);
    const user = userCommand(entry.table, entry.plan, entry.select);
    expect(normalised(assistant, known)).toEqual(normalised(user, known));
  });

  it('kept rows stay the same objects; only the addressed row changes', async () => {
    const before = findTable(h.copy.document, 'tB');
    await call('edit_table', {
      table: 'tB',
      op: 'setAttributes',
      of: 'rows',
      row: 2,
      attrs: { align: 'right' },
    });
    const after = findTable(h.copy.document, 'tB');
    expect(after.content![0]).toBe(before.content![0]);
    expect(after.content![2]).toBe(before.content![2]);
    expect(after.content![1]).not.toBe(before.content![1]);
  });

  it('whole rows and columns are never extended; a block of setKind is extended to whole merged cells (C67)', async () => {
    const column = await call('edit_table', { table: 'tB', op: 'setKind', kind: 'th', column: 3 });
    expect(column.isError).toBe(false);
    const kinds = (findTable(h.copy.document, 'tB').content ?? []).map((row) =>
      (row.content ?? []).map((cell) => cell.type),
    );
    // Column 3: H3 and M, a merged cell counting once; x, y, z, w stay td.
    expect(kinds).toEqual([
      ['th', 'th'],
      ['td', 'td', 'th'],
      ['td', 'td'],
    ]);
    const block = await call('edit_table', {
      table: 'tB',
      op: 'setKind',
      kind: 'th',
      row: 2,
      column: 2,
    });
    expect(block.isError).toBe(false);
    // The block of y alone; extended over nothing - y becomes th.
    expect(findTable(h.copy.document, 'tB').content![1]!.content![1]!.type).toBe('th');
    const extended = await call('edit_table', {
      table: 'tB',
      op: 'setAttributes',
      row: 1,
      column: 2,
      attrs: { valign: 'top' },
    });
    expect(extended.isError).toBe(false);
    // Position (1, 2) lies in H1: the block is extended to H1 (columns 1-2).
    expect(findTable(h.copy.document, 'tB').content![0]!.content![0]!.attrs).toMatchObject({
      valign: 'top',
    });
  });
});

/* ------------------------------------------------------------------------ */
/* edit_table: refusals                                                     */
/* ------------------------------------------------------------------------ */

describe('edit_table refusals (the engine codes as reason)', () => {
  const cases: [string, Json, 'notAllowed' | 'invalidArguments', string, RegExp?][] = [
    [
      'only-row',
      { table: 'tOne', op: 'deleteRows', row: 1 },
      'notAllowed',
      'only-row',
      /remove_node/,
    ],
    [
      'all-rows',
      { table: 'tA', op: 'deleteRows', row: 1, rows: 2 },
      'notAllowed',
      'all-rows',
      /remove_node/,
    ],
    ['only-column', { table: 'tOne', op: 'deleteColumns', column: 1 }, 'notAllowed', 'only-column'],
    [
      'all-columns',
      { table: 'tA', op: 'deleteColumns', column: 1, columns: 2 },
      'notAllowed',
      'all-columns',
    ],
    [
      'merged-crosses-border',
      { table: 'tB', op: 'moveRows', row: 2, direction: 'down' },
      'notAllowed',
      'merged-crosses-border',
      /rows/,
    ],
    [
      'no-neighbour',
      { table: 'tA', op: 'moveRows', row: 1, direction: 'up' },
      'notAllowed',
      'no-neighbour',
      /above/,
    ],
    [
      'no-neighbour (right)',
      { table: 'tA', op: 'moveColumns', column: 2, direction: 'right' },
      'notAllowed',
      'no-neighbour',
      /right/,
    ],
    [
      'not-merged',
      { table: 'tA', op: 'split', row: 1, column: 1 },
      'notAllowed',
      'not-merged',
      /row 1, column 1/,
    ],
    ['needs-block', { table: 'tA', op: 'merge', row: 1, column: 1 }, 'notAllowed', 'needs-block'],
    [
      'regular',
      { table: 'tA', op: 'repair' },
      'notAllowed',
      'regular',
      /^The table is regular; there is nothing to repair\.$/,
    ],
    [
      'span-past-edge',
      { table: 'tA', op: 'setAttributes', row: 1, column: 2, attrs: { colspan: 2 } },
      'notAllowed',
      'span-past-edge',
      /column/,
    ],
    [
      'merge-needs-block',
      { table: 'tB', op: 'setAttributes', row: 3, column: 1, attrs: { colspan: 3 } },
      'notAllowed',
      'merge-needs-block',
    ],
    [
      'invalid-id',
      { table: 'tA', op: 'setAttributes', row: 1, column: 1, attrs: { id: '1bad' } },
      'invalidArguments',
      'invalid-id',
      /"1bad"/,
    ],
    [
      'duplicate-id',
      { table: 'tA', op: 'setAttributes', row: 1, column: 1, attrs: { id: 'c12' } },
      'invalidArguments',
      'duplicate-id',
      /"c12"/,
    ],
    [
      'invalid-lang',
      { table: 'tA', op: 'setAttributes', row: 1, column: 1, attrs: { lang: 'not a tag' } },
      'invalidArguments',
      'invalid-lang',
      /"not a tag"/,
    ],
  ];

  it.each(cases)('%s', async (_name, args, code, reason, message) => {
    const before = h.copy.document;
    const out = await call('edit_table', args);
    expect(out.error).toMatchObject({ code, reason });
    if (message)
      expect([out.error!.message, out.error!.hint].filter(Boolean).join(' ')).toMatch(message);
    expect(h.copy.document).toBe(before);
  });

  it('a table too large for the owner map refuses every op with too-large but the table attributes; read_table still answers', async () => {
    await h.catalogue.close();
    const book = tablesBook();
    const huge = tableNode(
      'tHuge',
      Array.from({ length: 4200 }, () => [{ text: 'x', attrs: { colspan: 1000 } }]),
    );
    (book.bodies[0]!.content[1] as unknown as Loose).content!.push(huge as never);
    h = await harness({ document: book, resultBudget: () => 40_000 });
    for (const args of [
      { op: 'insertRows', row: 1, where: 'after' },
      { op: 'setKind', kind: 'th', row: 1 },
      { op: 'setAttributes', row: 1, column: 1, attrs: { align: 'left' } },
      { op: 'repair' },
    ]) {
      const out = await call('edit_table', { table: 'tHuge', ...args });
      expect(out.error, String(args.op)).toMatchObject({ code: 'notAllowed', reason: 'too-large' });
    }
    const table = await call('edit_table', {
      table: 'tHuge',
      op: 'setAttributes',
      of: 'table',
      attrs: { style: 'wide' },
    });
    expect(table.isError).toBe(false);
    const read = await call('read_table', { table: 'tHuge' });
    expect(read.result).toMatchObject({ rowCount: 4200, columnCount: 1000 });
    expect((read.result.rows as unknown[]).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ */
/* edit_table: strikes with the real hook (C68)                              */
/* ------------------------------------------------------------------------ */

/** The catalogue bound to a real `RequestSession` behind `applyChange` (as `changeHook`). */
async function boundToSession() {
  const s = sessionHarness({ document: tablesBook() });
  const started = await startRequestSession(s.deps, {
    origin: 'panel',
    kind: 'general',
    instruction: 'Change the tables',
    label: 'Stand-in · standin-chat',
  });
  if (!started.ok) throw new Error(started.reason);
  const session = started.session;
  const keys: string[] = [];
  const hook = async <T extends object>(key: string, change: () => Promise<T>) => {
    keys.push(key);
    const colon = key.indexOf(':');
    let thrown: ToolError | null = null;
    let outcome: ChangeOutcome<T>;
    try {
      outcome = await applyChange<T>(session, {
        tool: key.slice(0, colon),
        target: key.slice(colon + 1),
        apply: async () => {
          try {
            return await change();
          } catch (error) {
            if (error instanceof ToolError) {
              thrown = error;
              throw rejectionFromEnvelope(error.body) ?? error;
            }
            throw error;
          }
        },
      });
    } catch (error) {
      if (thrown && error === thrown) return (thrown as ToolError).envelope() as ToolErrorEnvelope;
      throw error;
    }
    if (outcome.accepted) return outcome.result;
    const refused = thrown as ToolError | null;
    if (refused) return { error: { ...refused.body, strike: outcome.strike } } as ToolErrorEnvelope;
    return rejectedEnvelope(outcome) as unknown as ToolErrorEnvelope;
  };
  await h.catalogue.close();
  h = await harness({ document: tablesBook(), copy: session.copy, applyChange: hook });
  return { session, keys };
}

describe('edit_table strikes (C68)', () => {
  it('every handler invalidArguments carries expected and counts one strike for edit_table:<op>@<table>; schema failures count none', async () => {
    const { session, keys } = await boundToSession();
    const invalid: Json[] = [
      { op: 'deleteRows', row: 0 },
      { op: 'deleteRows', row: 4 },
      { op: 'deleteColumns', column: 2, columns: 3 },
      { op: 'moveRows', row: 1, rows: 0, direction: 'down' },
      { op: 'merge', row: 1, column: 1, columns: 0 },
      { op: 'insertRows', row: 1, where: 'after', count: 0 },
      { op: 'insertRows', row: 1, where: 'after', count: 1000 },
      { op: 'insertColumns', column: 1, where: 'after', count: 65 },
      { op: 'duplicateRows', row: 1, count: 1, rows: 4 },
      { op: 'insertColumns', column: 1 },
      { op: 'moveColumns', column: 1, direction: 'up' },
      { op: 'split' },
      { op: 'setKind', row: 1 },
      { op: 'setAttributes', of: 'rows', row: 1, attrs: { style: 'x' } },
      { op: 'setAttributes', of: 'table', attrs: { align: 'left' } },
      { op: 'setAttributes', row: 1, column: 1, columns: 3, attrs: { id: 'q' } },
      { op: 'setAttributes', row: 2, column: 1, attrs: { colspan: 2, align: 'left' } },
      { op: 'setAttributes', row: 2, column: 1, attrs: { colspan: 0 } },
      { op: 'setAttributes', row: 2, column: 1, attrs: { rowspan: -2 } },
    ];
    for (const args of invalid) {
      const key = `edit_table:${String(args.op)}@tB`;
      const count = session.strikes.count(key);
      const out = await call('edit_table', { table: 'tB', ...args });
      expect(out.error?.code, JSON.stringify(args)).toBe('invalidArguments');
      expect(out.error?.expected, JSON.stringify(args)).toBeDefined();
      expect(out.error?.strike, JSON.stringify(args)).toBeDefined();
      expect(session.strikes.count(key), JSON.stringify(args)).toBe(count + 1);
    }
    const range = await call('edit_table', { table: 'tA', op: 'deleteRows', row: 9 });
    expect(range.error?.expected).toEqual({ rowCount: 2, columnCount: 2 });
    const before = keys.length;
    for (const args of [
      { table: 'tB', op: 'deleteRows', row: 'abc' },
      { table: 'tB', op: 'explode', row: 1 },
    ]) {
      const out = await call('edit_table', args);
      expect(out.error?.code).toBe('invalidArguments');
      expect(out.error?.strike).toBeUndefined();
    }
    expect(keys).toHaveLength(before);
    session.discard();
  });

  it('a refused split counts under its own key; a reference that resolves to no table stays as given; a refusal enters the hook', async () => {
    const { session, keys } = await boundToSession();
    await call('edit_table', { table: 'tA', op: 'merge', row: 1, column: 1 });
    const split = await call('edit_table', { table: 'tA', op: 'split', row: 1, column: 1 });
    expect(split.error).toMatchObject({
      code: 'notAllowed',
      reason: 'not-merged',
      strike: { count: 1, of: 3 },
    });
    expect(session.strikes.count('edit_table:merge@tA')).toBe(1);
    expect(session.strikes.count('edit_table:split@tA')).toBe(1);
    const nowhere = await call('edit_table', { table: 'nowhere', op: 'merge', row: 1, column: 1 });
    expect(nowhere.error?.code).toBe('unknownNode');
    const section = await call('edit_table', { table: 's1t', op: 'repair' });
    expect(section.error?.code).toBe('invalidArguments');
    expect(keys).toEqual([
      'edit_table:merge@tA',
      'edit_table:split@tA',
      'edit_table:merge@nowhere',
      'edit_table:repair@s1t',
    ]);
    // A cell reference names its table in the key.
    await call('edit_table', { table: 'tAr1c1', op: 'repair' });
    expect(keys.at(-1)).toBe('edit_table:repair@tA');
    session.discard();
  });

  it('confirmationRequired: a merge or a span growth over a linked cell changes nothing and counts no strike; with the linked cell top-left the merge is accepted and keeps its id (FR-014, FR-052)', async () => {
    const { session } = await boundToSession();
    const before = session.copy.document;
    const merge = await call('edit_table', {
      table: 'tC',
      op: 'merge',
      row: 2,
      column: 1,
      columns: 2,
    });
    expect(merge.error).toEqual({
      code: 'confirmationRequired',
      message:
        'The change removes cells whose ids are link targets: c12 (1 link would lose its target).',
      links: 1,
      ids: ['c12'],
      hint: 'Nothing was changed. Tell the user: the user can merge these cells in the editor, which asks for confirmation; a block whose top-left cell is the linked cell keeps its id.',
    });
    const span = await call('edit_table', {
      table: 'tC',
      op: 'setAttributes',
      row: 2,
      column: 1,
      attrs: { colspan: 2 },
    });
    expect(span.error).toMatchObject({ code: 'confirmationRequired', links: 1, ids: ['c12'] });
    // A link on a picture alone counts; a link over text and a picture counts once (FR-067).
    const pictures = await call('edit_table', {
      table: 'tC',
      op: 'merge',
      row: 2,
      column: 1,
      rows: 2,
    });
    expect(pictures.error).toMatchObject({ code: 'confirmationRequired', links: 2, ids: ['c1'] });
    expect(pictures.error!.message).toContain('2 links would lose their target');
    expect(session.copy.document).toBe(before);
    expect(session.strikes.count('edit_table:merge@tC')).toBe(0);
    expect(session.strikes.count('edit_table:setAttributes@tC')).toBe(0);
    const kept = await call('edit_table', {
      table: 'tC',
      op: 'merge',
      row: 2,
      column: 2,
      columns: 2,
    });
    expect(kept.isError).toBe(false);
    const cell = findTable(session.copy.document, 'tC').content![1]!.content![1]!;
    expect(cell.attrs).toMatchObject({ id: 'c12', colspan: 2 });
    session.discard();
  });

  it('after an edit_table, a later change below a reused row leaves the checkpoint document and run.before untouched (vR7:114)', async () => {
    const { session } = await boundToSession();
    const before = JSON.stringify(session.before);
    await call('edit_table', {
      table: 'tB',
      op: 'setAttributes',
      of: 'rows',
      row: 2,
      attrs: { align: 'right' },
    });
    const checkpoint = session.copy.document;
    const frozen = JSON.stringify(checkpoint);
    const text = await call('set_text', { node: 'tBr1c2', text: 'changed' });
    expect(text.isError).toBe(false);
    expect(JSON.stringify(checkpoint)).toBe(frozen);
    expect(JSON.stringify(session.before)).toBe(before);
    session.discard();
  });
});

/* ------------------------------------------------------------------------ */
/* edit_table: results                                                      */
/* ------------------------------------------------------------------------ */

describe('edit_table results', () => {
  it('a command that changes nothing answers changed: false without the hook', async () => {
    const kind = await call('edit_table', { table: 'tB', op: 'setKind', kind: 'th', row: 1 });
    expect(kind.result).toMatchObject({ op: 'setKind', changed: false });
    const same = await call('edit_table', {
      table: 'tC',
      op: 'setAttributes',
      row: 2,
      column: 1,
      attrs: { lang: 'de' },
    });
    expect(same.result).toMatchObject({ changed: false });
    expect(h.hookCalls).toEqual([]);
  });

  it('newCells at most 20 in reading order with an exact newCellCount; removedCells; focus 1-based', async () => {
    const rows = await call('edit_table', {
      table: 'tBig',
      op: 'insertRows',
      row: 1,
      where: 'after',
      count: 3,
    });
    expect(rows.result).toMatchObject({ rowCount: 303, newCellCount: 30 });
    const cells = rows.result.newCells as Json[];
    expect(cells).toHaveLength(20);
    expect(cells.slice(0, 11).map((c) => [c.row, c.column])).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [2, 9],
      [2, 10],
      [3, 1],
    ]);
    const deleted = await call('edit_table', { table: 'tB', op: 'deleteRows', row: 3 });
    expect(deleted.result).toMatchObject({ removedCells: 2, rowCount: 2 });
    expect(deleted.result).not.toHaveProperty('newCells');
    const columns = await call('edit_table', {
      table: 'tA',
      op: 'insertColumns',
      column: 2,
      where: 'before',
    });
    expect(columns.result.focus).toEqual({
      row: 1,
      column: 2,
      id: (columns.result.newCells as Json[])[0]!.id,
    });
  });

  it('spans merge and split as FR-036 says: "" means 1 and never 0; "" removes align, style or lang', async () => {
    const split = await call('edit_table', {
      table: 'tB',
      op: 'setAttributes',
      row: 1,
      column: 1,
      attrs: { colspan: '' },
    });
    expect(split.result).toMatchObject({ regular: true, newCellCount: 1 });
    const h1 = findTable(h.copy.document, 'tB').content![0]!.content![0]!;
    expect(h1.attrs).not.toHaveProperty('colspan');
    const lang = await call('edit_table', {
      table: 'tC',
      op: 'setAttributes',
      row: 2,
      column: 1,
      attrs: { lang: '' },
    });
    expect(lang.isError).toBe(false);
    expect(findTable(h.copy.document, 'tC').content![1]!.content![0]!.attrs).not.toHaveProperty(
      'lang',
    );
  });

  it('a merge keeps the marks of a linked and of a bold picture (FR-067)', async () => {
    const out = await call('edit_table', {
      table: 'tC',
      op: 'merge',
      row: 1,
      column: 1,
      columns: 3,
    });
    expect(out.isError).toBe(false);
    const content = findTable(h.copy.document, 'tC').content![0]!.content![0]!.content!;
    const images = content.filter((node) => node.type === 'inline-image');
    expect(images.map((node) => node.marks ?? [])).toEqual([
      [],
      [{ type: 'link', attrs: { href: '#c1' } }],
      [{ type: 'strong' }],
    ]);
  });

  it('FR-049: read_part and find see the changed table as ordinary rows and cells; the annotation table changes through the description', async () => {
    await call('edit_table', { table: 'tB', op: 'insertColumns', column: 3, where: 'after' });
    const part = await call('read_part', { node: 'tB' });
    const types = new Set((part.result.blocks as Json[]).map((block) => block.type));
    expect(types).toEqual(new Set(['th', 'td']));
    const found = await call('find', { text: 'H3' });
    expect((found.result.matches as { node: Json }[])[0]!.node.type).toBe('th');
    const annotation = await call('edit_table', {
      table: 'title-info/annotation[1]/table[1]',
      op: 'insertRows',
      row: 2,
      where: 'after',
    });
    expect(annotation.result).toMatchObject({ rowCount: 3, table: { id: 'tAnn' } });
    const table = h.copy.document.description.titleInfo.annotation!.content![1] as unknown as Loose;
    expect(table.attrs?.nodeId).toBe('tAnn');
    expect(table.content).toHaveLength(3);
  });

  it('the result of insertColumns on the 300 × 10 table is under 2,000 characters and holds no XML (SC-010)', async () => {
    const out = await call('edit_table', {
      table: 'tBig',
      op: 'insertColumns',
      column: 2,
      where: 'after',
    });
    expect(out.isError).toBe(false);
    expect(out.text.length).toBeLessThan(2000);
    expect(out.text).not.toContain('<');
    expect(out.result).toMatchObject({ columnCount: 11, newCellCount: 300 });
  });
});
