/**
 * The table plans of `ops.ts` (feature 006; data-model §4.4 to §4.6), one `describe` block per
 * user story in story order. US1 (T052; FR-003, FR-005; C15, C33; I8): `createTable` - the
 * dialog's table, rectangular and without attributes, its node ids from the host - and
 * `planTabRow`, the row Tab appends in the last cell. US2 (T071; FR-006 to FR-009, FR-030,
 * FR-035, FR-037, FR-038, FR-046, FR-047; C12 to C15, C67; decision 1; data-model §4.4, §4.5):
 * the twelve row and column plans on regular, merged and irregular tables.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import {
  applyTableEdit,
  assertTableValid,
  isRefusal,
  tableTarget,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
} from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  blockOver,
  caretAt,
  createTable,
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMoveColumns,
  planMoveRows,
  planTabRow,
} from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { nodeToModel } from '@/editor/toModel';

import { childrenOf, docOf, idGenerator, p, table, type RowSpec } from './helpers';

/** The attributes of a node that are set, `nodeId` aside. */
function setAttrs(node: PMNode): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node.attrs).filter(([name, value]) => name !== 'nodeId' && value !== null),
  );
}

/** Every node of a table: the table, its rows and their cells. */
function tableNodes(node: PMNode): PMNode[] {
  return [node, ...childrenOf(node).flatMap((row) => [row, ...childrenOf(row)])];
}

/** The plan of the Tab row on `node`, with the caret in its last grid row. */
function tabRow(node: PMNode, nextId = idGenerator()): TableEdit {
  const grid = gridOfNode(node);
  const at = { row: grid.height - 1, col: 0 };
  const edit = planTabRow({ table: node, grid, caret: at, head: at }, { nextId });
  if (isRefusal(edit)) throw new Error(`refused: ${edit.refused}`);
  return edit;
}

describe('US1: createTable and the Tab row', () => {
  describe('createTable', () => {
    const shapes: [rows: number, columns: number, headerRow: boolean][] = [
      [1, 1, false],
      [4, 3, true],
      [MAX_TABLE_ROWS, 1, false],
      [1, MAX_TABLE_COLUMNS, false],
    ];
    for (const [rows, columns, headerRow] of shapes) {
      for (const headerColumn of [false, true]) {
        it(`${rows} × ${columns}${headerRow ? ', a header row' : ''}${headerColumn ? ', a header column' : ''}: rectangular, no attribute, the host's node ids`, () => {
          const nextId = idGenerator('ui_');
          const node = createTable(rows, columns, headerRow, headerColumn, nextId);
          node.check();
          const all = childrenOf(node);
          expect(all).toHaveLength(rows + (headerRow ? 1 : 0));
          all.forEach((row, r) => {
            expect(row.type.name).toBe('tr');
            const cells = childrenOf(row);
            expect(cells).toHaveLength(columns);
            cells.forEach((cell, c) => {
              const header = (headerRow && r === 0) || (headerColumn && c === 0);
              expect(cell.type.name, `${r}, ${c}`).toBe(header ? 'th' : 'td');
              expect(cell.content.size).toBe(0);
            });
          });
          const grid = gridOfNode(node);
          expect(grid.regular).toBe(true);
          expect(grid.width).toBe(columns);
          const nodes = tableNodes(node);
          for (const each of nodes) expect(setAttrs(each), each.type.name).toEqual({});
          const ids = nodes.map((each) => each.attrs.nodeId as string);
          expect(ids.every((id) => /^ui_\d+$/.test(id))).toBe(true);
          expect(new Set(ids).size).toBe(ids.length);
        });
      }
    }

    it('refuses 0 or 1000 rows and 0 or 65 columns with a RangeError', () => {
      const nextId = idGenerator();
      expect(MAX_TABLE_ROWS).toBe(999);
      expect(MAX_TABLE_COLUMNS).toBe(64);
      expect(() => createTable(0, 2, false, false, nextId)).toThrow(RangeError);
      expect(() => createTable(1000, 2, false, false, nextId)).toThrow(RangeError);
      expect(() => createTable(2, 0, false, false, nextId)).toThrow(RangeError);
      expect(() => createTable(2, 65, false, false, nextId)).toThrow(RangeError);
      expect(() => createTable(2.5, 2, false, false, nextId)).toThrow(RangeError);
    });
  });

  describe('planTabRow', () => {
    it('copies the last row: its align, and per cell the kind, align, valign and lang - no id, no style', () => {
      const before = table('t', [
        [{ kind: 'th', text: 'h' }, {}, {}],
        {
          align: 'center',
          cells: [
            { kind: 'th', lang: 'de', valign: 'top' },
            { align: 'right' },
            { id: 'x9', style: 'wide', valign: 'bottom' },
          ],
        },
      ]);
      const edit = tabRow(before, idGenerator('new'));
      const after = applyTableEdit(before, edit);
      assertTableValid(before, after);
      expect(gridOfNode(after).regular).toBe(true);
      const rows = childrenOf(after);
      expect(rows).toHaveLength(3);
      // The old rows are the same nodes.
      expect(rows[0]).toBe(before.child(0));
      expect(rows[1]).toBe(before.child(1));
      const added = rows[2]!;
      expect(added.attrs.align).toBe('center');
      expect(childrenOf(added).map((cell) => [cell.type.name, setAttrs(cell)])).toEqual([
        ['th', { lang: 'de', valign: 'top' }],
        ['td', { align: 'right' }],
        ['td', { valign: 'bottom' }],
      ]);
      for (const cell of childrenOf(added)) expect(cell.content.size).toBe(0);
      const ids = [added, ...childrenOf(added)].map((node) => node.attrs.nodeId as string);
      expect(ids.every((id) => id.startsWith('new'))).toBe(true);
      expect(new Set(ids).size).toBe(4);
      // The caret in the first new cell.
      expect(edit.focus).toEqual(caretAt(2, 0));
      expect(edit.removedIds).toEqual([]);
    });

    it('copies a cell that reaches into the last row from above once, over its columns', () => {
      const before = table('t', [[{ colspan: 2, rowspan: 2, align: 'center' }, {}], [{}]]);
      const after = applyTableEdit(before, tabRow(before));
      assertTableValid(before, after);
      const added = childrenOf(childrenOf(after)[2]!);
      expect(
        added.map((cell) => [cell.attrs.colspan, cell.attrs.rowspan, cell.attrs.align]),
      ).toEqual([
        [2, null, 'center'],
        [null, null, null],
      ]);
      expect(gridOfNode(after).summary).toEqual({
        rows: 3,
        columns: 3,
        shortRows: 0,
        overlaps: 0,
        pastEnd: 0,
      });
    });

    it('fills the holes of an irregular last row with 1 × 1 cells and keeps the other problems', () => {
      const rows: RowSpec[] = [[{}, {}, {}], [{ kind: 'th' }], [{}, {}, {}]];
      const shortInMiddle = table('t', rows);
      const lastShort = table('u', [[{}, {}, {}], [{ kind: 'th', lang: 'fr' }]]);
      const after = applyTableEdit(lastShort, tabRow(lastShort));
      assertTableValid(lastShort, after);
      expect(
        childrenOf(childrenOf(after)[2]!).map((cell) => [cell.type.name, setAttrs(cell)]),
      ).toEqual([
        ['th', { lang: 'fr' }],
        ['td', {}],
        ['td', {}],
      ]);
      // The short row stays short: only the positions the command fills are filled.
      expect(gridOfNode(after).summary).toMatchObject({ rows: 3, shortRows: 1, row: 2 });
      const middle = applyTableEdit(shortInMiddle, tabRow(shortInMiddle));
      assertTableValid(shortInMiddle, middle);
      expect(gridOfNode(middle).summary).toMatchObject({ rows: 4, shortRows: 1, row: 2 });
      expect(childrenOf(middle).at(-1)!.childCount).toBe(3);
    });

    it('gives no cell in the columns of a rowspan reaching past the last row, whose value stays (C15)', () => {
      const before = table('t', [[{ text: 'a' }, { text: 'b', rowspan: 4 }], [{ text: 'c' }]]);
      const after = applyTableEdit(before, tabRow(before));
      assertTableValid(before, after);
      const rows = childrenOf(after);
      expect(rows).toHaveLength(3);
      expect(childrenOf(rows[2]!)).toHaveLength(1);
      expect(rows[0]!.child(1).attrs.rowspan).toBe(4);
      expect(rows[0]).toBe(before.child(0));
      expect(gridOfNode(after).summary).toEqual({
        rows: 3,
        columns: 2,
        shortRows: 0,
        overlaps: 0,
        pastEnd: 1,
      });
    });

    it('cuts the rowspans that would cover every column to end at the old last row, then fills every column', () => {
      const before = table('t', [
        [
          { text: 'a', rowspan: 3, align: 'left' },
          { text: 'b', rowspan: 5, kind: 'th' },
        ],
      ]);
      const edit = tabRow(before);
      const after = applyTableEdit(before, edit);
      assertTableValid(before, after);
      const rows = childrenOf(after);
      expect(rows).toHaveLength(2);
      expect(childrenOf(rows[0]!).map((cell) => cell.attrs.rowspan)).toEqual([null, null]);
      expect(childrenOf(rows[1]!).map((cell) => [cell.type.name, cell.attrs.align])).toEqual([
        ['td', 'left'],
        ['th', null],
      ]);
      expect(gridOfNode(after).regular).toBe(true);
      expect(edit.focus).toEqual(caretAt(1, 0));
    });

    it('refuses a table too large for the owner map (data-model §2.5)', () => {
      const cells = Array.from({ length: 4195 }, () => ({ colspan: 1000 }));
      const big = table('big', [cells]);
      const grid = gridOfNode(big);
      expect(grid.tooLarge).toBe(true);
      const at = { row: 0, col: 0 };
      expect(
        planTabRow({ table: big, grid, caret: at, head: at }, { nextId: idGenerator() }),
      ).toEqual({ refused: 'too-large' });
    });
  });
});

/* ------------------------------------------------------------------------ */
/* US2: rows and columns (T071)                                             */
/* ------------------------------------------------------------------------ */

/** A child of a row or of a table that is not a cell or a row (raw XML of an invalid book). */
const RAW = '<raw>';

/** A cell in the notation of data-model §16.1: its text, or its text with its model attributes. */
type MCell =
  string | ({ text?: string; type?: 'td' | 'th'; content?: unknown[] } & Record<string, unknown>);
type MRow = MCell[] | { align: string; cells: MCell[] } | typeof RAW;

/** A model table (`ui/src/model/document.ts`): node ids `m1`, `m2`, …; a string cell holds its text. */
function modelTable(rows: MRow[], attrs: Record<string, unknown> = {}): ModelNodeJson {
  let next = 0;
  const nodeId = () => `m${(next += 1)}`;
  const raw = () => ({ type: 'raw-xml', attrs: { nodeId: nodeId(), xml: '<x/>', inline: false } });
  const cell = (spec: MCell) => {
    if (spec === RAW) return raw();
    if (typeof spec === 'string') {
      return { type: 'td', attrs: { nodeId: nodeId() }, content: [{ type: 'text', text: spec }] };
    }
    const { text, type, content, ...rest } = spec;
    return {
      type: type ?? 'td',
      attrs: { nodeId: nodeId(), ...rest },
      content: content ?? (text ? [{ type: 'text', text }] : []),
    };
  };
  return {
    type: 'table',
    attrs: { nodeId: nodeId(), ...attrs },
    content: rows.map((row) => {
      if (row === RAW) return raw();
      const cells = Array.isArray(row) ? row : row.cells;
      const align = Array.isArray(row) ? {} : { align: row.align };
      return { type: 'tr', attrs: { nodeId: nodeId(), ...align }, content: cells.map(cell) };
    }),
  } as unknown as ModelNodeJson;
}

/** A table, in a document between two paragraphs, with a caret or a block selected. */
interface Placed {
  state: EditorState;
  table: PMNode;
  address: TableAddress;
}

/** The position just before the cell whose text is `text`. */
function cellPos(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, position) => {
    if (found >= 0) return false;
    if ((node.type.name === 'td' || node.type.name === 'th') && node.textContent === text) {
      found = position;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`no cell "${text}"`);
  return found;
}

/**
 * The table of `rows` with the caret at `offset` of the cell `at`, or the block from the cell
 * `at[0]` to the cell `at[1]`; `lines` adds the assistant's whole lines to the address.
 */
function placed(
  rows: MRow[] | PMNode,
  at: string | [string, string],
  { offset = 0, lines }: { offset?: number; lines?: TableAddress['lines'] } = {},
): Placed {
  const node = Array.isArray(rows) ? nodeFromModel(modelTable(rows))! : rows;
  const doc = docOf(p('before', 'p1'), node, p('after', 'p2'));
  const selection =
    typeof at === 'string'
      ? TextSelection.create(doc, cellPos(doc, at) + 1 + offset)
      : CellBlockSelection.create(doc, cellPos(doc, at[0]), cellPos(doc, at[1]));
  const state = EditorState.create({ doc, selection });
  const target = tableTarget(state)!;
  expect(target.selection).toBe(typeof at === 'string' ? 'cell' : 'block');
  return {
    state,
    table: target.address.table,
    address: lines ? { ...target.address, lines } : target.address,
  };
}

type Plan = (address: TableAddress, ctx: PlanContext) => TableEdit | Refusal;

/** The twelve plans by command name, as their command rows run them. */
const PLANS = {
  insertRowAbove: (a, c) => planInsertRows(a, { side: 'above' }, c),
  insertRowBelow: (a, c) => planInsertRows(a, { side: 'below' }, c),
  deleteRow: (a, c) => planDeleteRows(a, c),
  insertColumnLeft: (a, c) => planInsertColumns(a, { side: 'left' }, c),
  insertColumnRight: (a, c) => planInsertColumns(a, { side: 'right' }, c),
  deleteColumn: (a, c) => planDeleteColumns(a, c),
  moveRowUp: (a, c) => planMoveRows(a, { direction: 'up' }, c),
  moveRowDown: (a, c) => planMoveRows(a, { direction: 'down' }, c),
  moveColumnLeft: (a, c) => planMoveColumns(a, { direction: 'left' }, c),
  moveColumnRight: (a, c) => planMoveColumns(a, { direction: 'right' }, c),
  duplicateRow: (a, c) => planDuplicateRows(a, c),
  duplicateColumn: (a, c) => planDuplicateColumns(a, c),
} satisfies Record<string, Plan>;

type PlanName = keyof typeof PLANS;

/** A plan context whose node ids count `t1`, `t2`, … */
function planContext(): PlanContext {
  return { nextId: idGenerator('t') };
}

/**
 * Runs the plan `name` on `where` and checks what every result must hold: it is a `TableEdit`
 * whose table passes `assertTableValid` against the table before (C13: no question is asked -
 * the plan answers an edit at once).
 */
function acted(where: Placed, name: PlanName | Plan): { edit: TableEdit; after: PMNode } {
  const plan = typeof name === 'function' ? name : PLANS[name];
  const result = plan(where.address, planContext());
  if (isRefusal(result)) throw new Error(`refused: ${JSON.stringify(result)}`);
  const after = applyTableEdit(where.table, result);
  assertTableValid(where.table, after, result.allowedIds, result.pastedIrregular);
  return { edit: result, after };
}

function refusal(where: Placed, name: PlanName): Refusal | TableEdit {
  return PLANS[name](where.address, planContext());
}

/**
 * The notation of data-model §16.1 for a table: rows separated by `/`, a row's own cells in
 * brackets (`{align}` before a row's bracket); a cell is its text - `<td>` or `<th>` when empty,
 * `<th>` before the text of a header cell - followed by its set attributes; `raw` for a child
 * that is neither a row nor a cell.
 */
function show(node: PMNode): string {
  const names = ['colspan', 'rowspan', 'align', 'valign', 'lang', 'id', 'style'];
  return childrenOf(node)
    .map((row) => {
      if (row.type.name !== 'tr') return 'raw';
      const cells = childrenOf(row).map((cell) => {
        if (cell.type.name !== 'td' && cell.type.name !== 'th') return 'raw';
        const text = cell.textContent;
        const head = cell.type.name === 'th' ? `<th>${text}` : text === '' ? '<td>' : text;
        const attrs = names
          .filter((name) => cell.attrs[name] !== null && cell.attrs[name] !== undefined)
          .map((name) => `${name}=${String(cell.attrs[name])}`);
        if (cell.attrs.extraAttrs) attrs.push(`extra=${JSON.stringify(cell.attrs.extraAttrs)}`);
        return [head, ...attrs].join(' ');
      });
      return `${row.attrs.align ? `{${row.attrs.align}}` : ''}[${cells.join(', ')}]`;
    })
    .join(' / ');
}

/** Every node of a table below it that carries a node id. */
function nodeIds(node: PMNode): string[] {
  const ids: string[] = [];
  node.descendants((child) => {
    if (typeof child.attrs.nodeId === 'string') ids.push(child.attrs.nodeId);
    return true;
  });
  return ids;
}

/** The model JSON of a node without its node ids. */
function withoutIds(node: PMNode): unknown {
  return JSON.parse(
    JSON.stringify(nodeToModel(node), (key, value: unknown) =>
      key === 'nodeId' ? undefined : value,
    ),
  );
}

/** US2's scenario tables of `tables.fb2` (T014). */
const T1: MRow[] = [
  ['r1c1', 'r1c2', 'r1c3'],
  { align: 'center', cells: [{ text: 'r2c1', id: 'us2-r2c1' }, 'r2c2', 'r2c3'] },
  ['r3c1', 'r3c2', 'r3c3'],
];
const T1_SHOWN = '[r1c1, r1c2, r1c3] / {center}[r2c1 id=us2-r2c1, r2c2, r2c3] / [r3c1, r3c2, r3c3]';
const T2: MRow[] = [[{ text: 'a', rowspan: 2 }, 'b'], ['c']];
const T3: MRow[] = [
  [
    { type: 'th', text: 'h1' },
    { type: 'th', text: 'h2', colspan: 2 },
  ],
  ['r2c1', 'r2c2', { text: 'r2c3', align: 'right' }],
  ['r3c1', 'r3c2', { text: 'r3c3', lang: 'de' }],
];
const T4: MRow[] = [['x', 'y'], [{ text: 'a', rowspan: 2 }, 'b'], ['c']];
const T5: MRow[] = Array.from({ length: 5 }, (_, r) =>
  Array.from({ length: 3 }, (_, c) => `r${r + 1}c${c + 1}`),
);
const T7: MRow[] = [
  ['r1c1', 'r1c2'],
  ['r2c1', 'r2c2'],
  [{ text: 'm', rowspan: 2 }, 'r3c2'],
  ['r4c2'],
  ['r5c1', 'r5c2'],
];

/** The plain 3 × 3 table `r1c1` … `r3c3`. */
const PLAIN: MRow[] = Array.from({ length: 3 }, (_, r) =>
  Array.from({ length: 3 }, (_, c) => `r${r + 1}c${c + 1}`),
);

const VECTORS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/tables',
);

interface VectorCase {
  name: string;
  table: {
    attrs?: Record<string, unknown>;
    rows: (Record<string, unknown>[] | { type: string })[];
  };
  expect: { regular: boolean };
}

/** A case of the shared vectors as a ProseMirror table (node ids `v1`, `v2`, …). */
function vectorTable(table: VectorCase['table']): PMNode {
  let next = 0;
  const nodeId = () => `v${(next += 1)}`;
  const raw = () => ({ type: 'raw-xml', attrs: { nodeId: nodeId(), xml: '<x/>', inline: false } });
  return nodeFromModel({
    type: 'table',
    attrs: { nodeId: nodeId(), ...(table.attrs ?? {}) },
    content: table.rows.map((row) =>
      Array.isArray(row)
        ? {
            type: 'tr',
            attrs: { nodeId: nodeId() },
            content: row.map((cell) =>
              cell.type === 'raw-xml'
                ? raw()
                : {
                    type: (cell.type as string | undefined) ?? 'td',
                    attrs: { nodeId: nodeId(), ...((cell.attrs as object | undefined) ?? {}) },
                    content: [],
                  },
            ),
          }
        : raw(),
    ),
  } as unknown as ModelNodeJson)!;
}

describe('US2 rows and columns', () => {
  describe('the scenarios (US2 sc.1 to sc.11)', () => {
    it('sc.1: Insert row below and above - an empty row of three cells with row 2’s align, the caret in its first cell', () => {
      const where = placed(T1, 'r2c2');
      expect(show(where.table)).toBe(T1_SHOWN);
      const below = acted(where, 'insertRowBelow');
      expect(show(below.after)).toBe(
        '[r1c1, r1c2, r1c3] / {center}[r2c1 id=us2-r2c1, r2c2, r2c3] / {center}[<td>, <td>, <td>] / [r3c1, r3c2, r3c3]',
      );
      expect(below.edit.focus).toEqual(caretAt(2, 0));
      expect(below.edit.removedIds).toEqual([]);
      // Untouched rows are the same nodes; the new ones carry fresh node ids.
      expect(below.after.child(0)).toBe(where.table.child(0));
      expect(below.after.child(1)).toBe(where.table.child(1));
      expect(below.after.child(3)).toBe(where.table.child(2));
      const added = nodeIds(below.after).filter((id) => !id.startsWith('m'));
      expect(added).toHaveLength(4);
      expect(added.every((id) => /^t\d+$/.test(id))).toBe(true);
      expect(new Set(added).size).toBe(4);
      // Above: the reference row is the caret's own (data-model §4.1).
      const above = acted(where, 'insertRowAbove');
      expect(show(above.after)).toBe(
        '[r1c1, r1c2, r1c3] / {center}[<td>, <td>, <td>] / {center}[r2c1 id=us2-r2c1, r2c2, r2c3] / [r3c1, r3c2, r3c3]',
      );
      expect(above.edit.focus).toEqual(caretAt(1, 0));
    });

    it('sc.2: Insert row below beside a cell spanning two rows - the span grows, the new row has one cell', () => {
      const where = placed(T2, 'b');
      const { edit, after } = acted(where, 'insertRowBelow');
      expect(show(after)).toBe('[a rowspan=3, b] / [<td>] / [c]');
      expect(edit.focus).toEqual(caretAt(1, 1));
      expect(after.child(2)).toBe(where.table.child(1));
      // The grown cell keeps its node id and its content.
      const a = where.table.child(0).child(0);
      expect(after.child(0).child(0).attrs.nodeId).toBe(a.attrs.nodeId);
      expect(after.child(0).child(0).content).toBe(a.content);
      expect(after.child(0).child(1)).toBe(where.table.child(0).child(1));
    });

    it('sc.3: Insert column to the right beside a header cell over two columns - its colspan grows', () => {
      const { edit, after } = acted(placed(T3, 'r2c2'), 'insertColumnRight');
      expect(show(after)).toBe(
        '[<th>h1, <th>h2 colspan=3] / [r2c1, r2c2, <td>, r2c3 align=right] / [r3c1, r3c2, <td>, r3c3 lang=de]',
      );
      expect(edit.focus).toEqual(caretAt(1, 2));
    });

    it('sc.3’s edge cases: a column at the spanning cell’s left or right edge, cells copying their neighbours, a header row growing with header cells', () => {
      const where = placed(T3, 'h2');
      const left = acted(where, 'insertColumnLeft');
      expect(show(left.after)).toBe(
        '[<th>h1, <th>, <th>h2 colspan=2] / [r2c1, <td>, r2c2, r2c3 align=right] / [r3c1, <td>, r3c2, r3c3 lang=de]',
      );
      expect(left.edit.focus).toEqual(caretAt(0, 1));
      const right = acted(where, 'insertColumnRight');
      expect(show(right.after)).toBe(
        '[<th>h1, <th>h2 colspan=2, <th>] / [r2c1, r2c2, r2c3 align=right, <td> align=right] / [r3c1, r3c2, r3c3 lang=de, <td> lang=de]',
      );
      expect(right.edit.focus).toEqual(caretAt(0, 3));
      const header = acted(where, 'insertRowBelow');
      expect(show(header.after)).toBe(
        '[<th>h1, <th>h2 colspan=2] / [<th>, <th>, <th>] / [r2c1, r2c2, r2c3 align=right] / [r3c1, r3c2, r3c3 lang=de]',
      );
    });

    it('sc.4: Delete row below a cell spanning two rows - the span shrinks, b stays in column 2', () => {
      const where = placed(T2, 'c');
      const { edit, after } = acted(where, 'deleteRow');
      expect(show(after)).toBe('[a, b]');
      // b, untouched, is the same node.
      expect(after.child(0).child(1)).toBe(where.table.child(0).child(1));
      expect(edit.focus).toEqual(caretAt(0, 1));
      expect(edit.removedIds).toEqual([]);
    });

    it('sc.5: Delete row of a merged cell’s top row - the cell moves into the last row with its content', () => {
      const where = placed(T4, 'a');
      const { edit, after } = acted(where, 'deleteRow');
      expect(show(after)).toBe('[x, y] / [a, c]');
      expect(after.child(0)).toBe(where.table.child(0));
      const a = where.table.child(1).child(0);
      const moved = after.child(1).child(0);
      expect(moved.attrs.nodeId).toBe(a.attrs.nodeId);
      expect(moved.content).toBe(a.content);
      expect(after.child(1).child(1)).toBe(where.table.child(2).child(0));
      expect(edit.focus).toEqual(caretAt(1, 0));
    });

    it('sc.6: a block deletes its rows, and its columns, in one plan', () => {
      const rows = acted(placed(T5, ['r2c1', 'r4c1']), 'deleteRow');
      expect(show(rows.after)).toBe('[r1c1, r1c2, r1c3] / [r5c1, r5c2, r5c3]');
      expect(rows.edit.focus).toEqual(caretAt(1, 0));
      const columns = acted(placed(T5, ['r1c1', 'r1c2']), 'deleteColumn');
      expect(show(columns.after)).toBe('[r1c3] / [r2c3] / [r3c3] / [r4c3] / [r5c3]');
      expect(columns.edit.focus).toEqual(caretAt(0, 0));
    });

    it('sc.7: Delete row in a table of one row and Delete column in a table of one column refuse', () => {
      expect(refusal(placed([['r1c1', 'r1c2', 'r1c3']], 'r1c2'), 'deleteRow')).toEqual({
        refused: 'only-row',
      });
      expect(refusal(placed([['r1c1'], ['r2c1'], ['r3c1']], 'r2c1'), 'deleteColumn')).toEqual({
        refused: 'only-column',
      });
    });

    it('sc.9: Move row up and Move column right and left - the rows and the cells are the same nodes', () => {
      const where = placed(T1, 'r3c1');
      const up = acted(where, 'moveRowUp');
      expect(show(up.after)).toBe(
        '[r1c1, r1c2, r1c3] / [r3c1, r3c2, r3c3] / {center}[r2c1 id=us2-r2c1, r2c2, r2c3]',
      );
      expect(up.after.child(0)).toBe(where.table.child(0));
      expect(up.after.child(1)).toBe(where.table.child(2));
      expect(up.after.child(2)).toBe(where.table.child(1));
      expect(up.edit.focus).toEqual(caretAt(1, 0));
      const right = acted(placed(T1, 'r1c2'), 'moveColumnRight');
      expect(show(right.after)).toBe(
        '[r1c1, r1c3, r1c2] / {center}[r2c1 id=us2-r2c1, r2c3, r2c2] / [r3c1, r3c3, r3c2]',
      );
      expect(right.edit.focus).toEqual(caretAt(0, 2));
      const before = placed(T1, 'r1c2').table;
      // The cells are reused, each in its own row.
      expect(right.after.child(1).child(1).attrs.nodeId).toBe(
        before.child(1).child(2).attrs.nodeId,
      );
      // Move column left from the moved cell exchanges them back.
      const back = acted(placed(right.after, 'r1c2'), 'moveColumnLeft');
      expect(show(back.after)).toBe(T1_SHOWN);
      expect(back.edit.focus).toEqual(caretAt(0, 1));
    });

    it('sc.10: Move row down past a band of two rows; Move row up refused where a merged cell crosses the border', () => {
      const where = placed(T7, 'r2c1');
      const down = acted(where, 'moveRowDown');
      expect(show(down.after)).toBe(
        '[r1c1, r1c2] / [m rowspan=2, r3c2] / [r4c2] / [r2c1, r2c2] / [r5c1, r5c2]',
      );
      expect(childrenOf(down.after)).toEqual(
        [0, 2, 3, 1, 4].map((index) => where.table.child(index)),
      );
      expect(down.edit.focus).toEqual(caretAt(3, 0));
      expect(refusal(placed(T7, 'r3c2'), 'moveRowUp')).toEqual({
        refused: 'merged-crosses-border',
        params: { axis: 'row' },
      });
      expect(refusal(placed(T7, 'r3c2'), 'moveRowDown')).toEqual({
        refused: 'merged-crosses-border',
        params: { axis: 'row' },
      });
    });

    it('sc.11: Duplicate row and Duplicate column - copies with content, kind and align, without the id', () => {
      const where = placed(T1, 'r2c1');
      const row = acted(where, 'duplicateRow');
      expect(show(row.after)).toBe(
        '[r1c1, r1c2, r1c3] / {center}[r2c1 id=us2-r2c1, r2c2, r2c3] / {center}[r2c1, r2c2, r2c3] / [r3c1, r3c2, r3c3]',
      );
      expect(row.edit.focus).toEqual(caretAt(1, 0));
      const copies = childrenOf(row.after.child(2));
      expect(copies.every((cell) => /^t\d+$/.test(cell.attrs.nodeId as string))).toBe(true);
      copies.forEach((cell, c) =>
        expect(cell.content.eq(where.table.child(1).child(c).content)).toBe(true),
      );
      const column = acted(where, 'duplicateColumn');
      expect(show(column.after)).toBe(
        '[r1c1, r1c1, r1c2, r1c3] / {center}[r2c1 id=us2-r2c1, r2c1, r2c2, r2c3] / [r3c1, r3c1, r3c2, r3c3]',
      );
      expect(column.edit.focus).toEqual(caretAt(1, 0));
    });

    it('removedIds names the ids of the cells a plan removes (us2-r2c1 when its row goes)', () => {
      expect(acted(placed(T1, 'r2c3'), 'deleteRow').edit.removedIds).toEqual(['us2-r2c1']);
      expect(acted(placed(T1, 'r3c1'), 'deleteColumn').edit.removedIds).toEqual(['us2-r2c1']);
      expect(acted(placed(T1, 'r1c2'), 'deleteColumn').edit.removedIds).toEqual([]);
    });
  });

  describe('spans that grow and shrink (FR-007)', () => {
    it('a cell across the inserted line grows once by k, in rows and in columns', () => {
      const rows = acted(
        placed([[{ text: 'a', rowspan: 3 }, 'b'], ['c'], ['d']], ['b', 'c']),
        'insertRowBelow',
      );
      expect(show(rows.after)).toBe('[a rowspan=5, b] / [c] / [<td>] / [<td>] / [d]');
      expect(rows.edit.focus).toEqual(caretAt(2, 1));
      const columns = acted(
        placed([[{ text: 'a', colspan: 3 }], ['b', 'c', 'd']], 'c'),
        'insertColumnLeft',
      );
      expect(show(columns.after)).toBe('[a colspan=4] / [b, <td>, c, d]');
      expect(columns.edit.focus).toEqual(caretAt(1, 1));
    });

    it('a cell partly in deleted rows or columns loses that part', () => {
      const rows = acted(
        placed([[{ text: 'a', rowspan: 3 }, 'b'], ['c'], ['d'], ['e', 'f']], ['c', 'd']),
        'deleteRow',
      );
      expect(show(rows.after)).toBe('[a, b] / [e, f]');
      expect(rows.edit.focus).toEqual(caretAt(1, 1));
      const columns = acted(
        placed(
          [
            [{ text: 'a', colspan: 3 }, 'b'],
            ['c', 'd', 'e', 'f'],
          ],
          ['d', 'e'],
        ),
        'deleteColumn',
      );
      expect(show(columns.after)).toBe('[a, b] / [c, f]');
      expect(columns.edit.focus).toEqual(caretAt(1, 1));
    });

    it('a merged cell whose top row is deleted moves into the next row it covers, with its content and attributes', () => {
      const where = placed(
        [['x', 'y'], [{ text: 'a', rowspan: 3, align: 'right', id: 'keep' }, 'b'], ['c'], ['d']],
        'a',
      );
      const { edit, after } = acted(where, 'deleteRow');
      expect(show(after)).toBe('[x, y] / [a rowspan=2 align=right id=keep, c] / [d]');
      expect(edit.removedIds).toEqual([]);
      expect(after.child(1).child(0).attrs.nodeId).toBe(where.table.child(1).child(0).attrs.nodeId);
      expect(after.child(2)).toBe(where.table.child(3));
    });

    it('behind a hole the plan first fills it: Delete row on short-row-hole gives [d, <td>, c]', () => {
      const where = placed([['a', 'b', { text: 'c', rowspan: 2 }], ['d']], 'a');
      const { edit, after } = acted(where, 'deleteRow');
      expect(show(after)).toBe('[d, <td>, c]');
      expect(after.child(0).child(2).attrs.nodeId).toBe(where.table.child(0).child(2).attrs.nodeId);
      expect(gridOfNode(after).regular).toBe(true);
      expect(edit.focus).toEqual(caretAt(0, 0));
    });

    it('row compaction (decision 1, C12): Delete column removes a row that lost its only cell, with its non-cell children', () => {
      const where = placed(
        [
          [{ text: 'a', rowspan: 2 }, 'b'],
          ['c', RAW],
        ],
        'b',
      );
      const { edit, after } = acted(where, 'deleteColumn');
      expect(show(after)).toBe('[a]');
      expect(edit.focus).toEqual(caretAt(0, 0));
      expect(edit.removedIds).toEqual([]);
    });
  });

  describe('the targets of C14 (FR-006’s readings, analyze decision 3)', () => {
    const COLSPAN: MRow[] = [
      [{ text: 'a', colspan: 2 }, 'b'],
      ['c', 'd', 'e'],
    ];
    const ROWSPAN: MRow[] = [[{ text: 'a', rowspan: 2 }, 'b'], ['c'], ['d', 'e']];

    it('in a cell with colspan 2: inserts at its left or right edge; delete, move and duplicate use its left column', () => {
      const where = placed(COLSPAN, 'a');
      expect(show(acted(where, 'insertColumnLeft').after)).toBe(
        '[<td>, a colspan=2, b] / [<td>, c, d, e]',
      );
      const right = acted(where, 'insertColumnRight');
      expect(show(right.after)).toBe('[a colspan=2, <td>, b] / [c, d, <td>, e]');
      expect(right.edit.focus).toEqual(caretAt(0, 2));
      expect(show(acted(where, 'deleteColumn').after)).toBe('[a, b] / [d, e]');
      expect(refusal(where, 'moveColumnRight')).toEqual({
        refused: 'merged-crosses-border',
        params: { axis: 'column' },
      });
      expect(show(acted(where, 'duplicateColumn').after)).toBe('[a colspan=3, b] / [c, c, d, e]');
    });

    it('in a cell with rowspan 2: inserts at its top or bottom edge; delete, move and duplicate use its top row', () => {
      const where = placed(ROWSPAN, 'a');
      expect(show(acted(where, 'insertRowAbove').after)).toBe(
        '[<td>, <td>] / [a rowspan=2, b] / [c] / [d, e]',
      );
      const below = acted(where, 'insertRowBelow');
      expect(show(below.after)).toBe('[a rowspan=2, b] / [c] / [<td>, <td>] / [d, e]');
      expect(below.edit.focus).toEqual(caretAt(2, 0));
      expect(show(acted(where, 'deleteRow').after)).toBe('[a, c] / [d, e]');
      expect(refusal(where, 'moveRowDown')).toEqual({
        refused: 'merged-crosses-border',
        params: { axis: 'row' },
      });
      expect(show(acted(where, 'duplicateRow').after)).toBe(
        '[a rowspan=3, b] / [b] / [c] / [d, e]',
      );
    });

    it('a block inserts as many rows or columns as it spans, and deletes, moves and duplicates its rows or columns', () => {
      const where = placed(PLAIN, ['r1c1', 'r2c2']);
      expect(show(acted(where, 'insertRowAbove').after)).toBe(
        '[<td>, <td>, <td>] / [<td>, <td>, <td>] / [r1c1, r1c2, r1c3] / [r2c1, r2c2, r2c3] / [r3c1, r3c2, r3c3]',
      );
      expect(show(acted(where, 'insertColumnRight').after)).toBe(
        '[r1c1, r1c2, <td>, <td>, r1c3] / [r2c1, r2c2, <td>, <td>, r2c3] / [r3c1, r3c2, <td>, <td>, r3c3]',
      );
      expect(show(acted(where, 'deleteRow').after)).toBe('[r3c1, r3c2, r3c3]');
      expect(show(acted(where, 'deleteColumn').after)).toBe('[r1c3] / [r2c3] / [r3c3]');
      const down = acted(where, 'moveRowDown');
      expect(show(down.after)).toBe('[r3c1, r3c2, r3c3] / [r1c1, r1c2, r1c3] / [r2c1, r2c2, r2c3]');
      expect(down.edit.focus).toEqual(blockOver({ top: 1, left: 0, bottom: 3, right: 2 }));
      const right = acted(where, 'moveColumnRight');
      expect(show(right.after)).toBe(
        '[r1c3, r1c1, r1c2] / [r2c3, r2c1, r2c2] / [r3c3, r3c1, r3c2]',
      );
      expect(right.edit.focus).toEqual(blockOver({ top: 0, left: 1, bottom: 2, right: 3 }));
      expect(show(acted(where, 'duplicateRow').after)).toBe(
        '[r1c1, r1c2, r1c3] / [r2c1, r2c2, r2c3] / [r1c1, r1c2, r1c3] / [r2c1, r2c2, r2c3] / [r3c1, r3c2, r3c3]',
      );
      expect(show(acted(where, 'duplicateColumn').after)).toBe(
        '[r1c1, r1c2, r1c1, r1c2, r1c3] / [r2c1, r2c2, r2c1, r2c2, r2c3] / [r3c1, r3c2, r3c1, r3c2, r3c3]',
      );
    });

    it('the assistant’s whole lines are taken as given, never extended (C67), with their count', () => {
      const rows = placed(T2, 'a', { lines: { axis: 'row', from: 1, to: 2 } });
      expect(show(acted(rows, 'deleteRow').after)).toBe('[a, b]');
      const inserted = acted(rows, (address, ctx) =>
        planInsertRows(address, { side: 'above', count: 3 }, ctx),
      );
      expect(show(inserted.after)).toBe('[a rowspan=5, b] / [<td>] / [<td>] / [<td>] / [c]');
      const columns = placed(COLSPAN, 'c', { lines: { axis: 'column', from: 1, to: 2 } });
      expect(show(acted(columns, 'deleteColumn').after)).toBe('[a, b] / [c, e]');
    });
  });

  describe('new cells (FR-008)', () => {
    /** Row 2 is short: `d` alone, a hole in columns 2 and 3. */
    const NEIGHBOURS: MRow[] = [
      [
        'a',
        {
          text: 'b',
          type: 'th',
          align: 'center',
          valign: 'middle',
          lang: 'fr',
          id: 'bid',
          style: 'bs',
        },
        'c',
      ],
      [
        {
          text: 'd',
          type: 'th',
          align: 'right',
          lang: 'de',
          id: 'did',
          style: 'ds',
          unknownAttrs: { class: 'k' },
        },
      ],
    ];

    it('are empty and copy their neighbour cell by cell: the owner across the line where the reference position is a hole, a plain td where both are', () => {
      const where = placed(NEIGHBOURS, 'd');
      const above = acted(where, 'insertRowAbove');
      expect(show(above.after)).toBe(
        '[a, <th>b align=center valign=middle lang=fr id=bid style=bs, c] / [<th> align=right lang=de, <th> align=center valign=middle lang=fr, <td>] / [<th>d align=right lang=de id=did style=ds extra={"unknownAttrs":{"class":"k"}}]',
      );
      const below = acted(where, 'insertRowBelow');
      expect(show(below.after)).toBe(
        '[a, <th>b align=center valign=middle lang=fr id=bid style=bs, c] / [<th>d align=right lang=de id=did style=ds extra={"unknownAttrs":{"class":"k"}}] / [<th> align=right lang=de, <td>, <td>]',
      );
      // Never an id, a style, spans or extraAttrs; fresh node ids, each once.
      for (const after of [above.after, below.after]) {
        const fresh = nodeIds(after).filter((id) => !id.startsWith('m'));
        expect(fresh.every((id) => /^t\d+$/.test(id))).toBe(true);
        expect(new Set(fresh).size).toBe(fresh.length);
      }
      const spanned = acted(
        placed([[{ text: 'a', colspan: 2, style: 's' }], ['b', 'c']], 'a'),
        'insertRowBelow',
      );
      expect(show(spanned.after)).toBe('[a colspan=2 style=s] / [<td>, <td>] / [b, c]');
    });
  });

  describe('spans past the last row (C15)', () => {
    it('at an appended row such a cell crosses the new line: its value stays and its columns get no cell', () => {
      const where = placed([['a', { text: 'b', rowspan: 3 }], ['c']], 'c');
      const { edit, after } = acted(where, 'insertRowBelow');
      expect(show(after)).toBe('[a, b rowspan=3] / [c] / [<td>]');
      expect(after.child(0)).toBe(where.table.child(0));
      expect(edit.focus).toEqual(caretAt(2, 0));
    });

    it('when the new row would hold no cell, those spans are first cut to end at the old last row (step 4)', () => {
      const { edit, after } = acted(
        placed(
          [
            [
              { text: 'a', rowspan: 3 },
              { text: 'b', rowspan: 2 },
            ],
          ],
          'a',
        ),
        'insertRowBelow',
      );
      expect(show(after)).toBe('[a, b] / [<td>, <td>]');
      expect(gridOfNode(after).regular).toBe(true);
      expect(edit.focus).toEqual(caretAt(1, 0));
      // Duplicate row at the last row does the same (data-model open point 6).
      expect(
        show(
          acted(
            placed(
              [
                [
                  { text: 'a', rowspan: 3 },
                  { text: 'b', rowspan: 2 },
                ],
              ],
              'b',
            ),
            'duplicateRow',
          ).after,
        ),
      ).toBe('[a, b] / [a, b]');
    });
  });

  describe('irregular tables change only where a command acts (FR-035, FR-037)', () => {
    it('Insert column to the right of c leaves a row that does not reach the line as it is', () => {
      const where = placed([['a', 'b', 'c'], ['d']], 'c');
      const { edit, after } = acted(where, 'insertColumnRight');
      expect(show(after)).toBe('[a, b, c, <td>] / [d]');
      expect(after.child(1)).toBe(where.table.child(1));
      expect(edit.focus).toEqual(caretAt(0, 3));
    });

    it('Move column right exchanges only in the rows that reach both bands', () => {
      const where = placed(
        [
          ['a', 'b', 'c'],
          ['d', 'e'],
        ],
        'b',
      );
      const { edit, after } = acted(where, 'moveColumnRight');
      expect(show(after)).toBe('[a, c, b] / [d, e]');
      expect(after.child(1)).toBe(where.table.child(1));
      expect(edit.focus).toEqual(caretAt(0, 2));
    });

    it('Duplicate row fills the copy completely; Duplicate column leaves a row that does not reach the line (open point 7)', () => {
      const row = placed(
        [
          ['a', 'b', 'c'],
          ['d', 'e'],
        ],
        'd',
      );
      const duplicated = acted(row, 'duplicateRow');
      expect(show(duplicated.after)).toBe('[a, b, c] / [d, e] / [d, e, <td>]');
      expect(duplicated.after.child(0)).toBe(row.table.child(0));
      expect(duplicated.after.child(1)).toBe(row.table.child(1));
      const column = placed([['a', 'b', 'c'], ['d']], 'c');
      const copied = acted(column, 'duplicateColumn');
      expect(show(copied.after)).toBe('[a, b, c, c] / [d]');
      expect(copied.after.child(1)).toBe(column.table.child(1));
    });

    it('Delete row that moves the earlier cell of an overlap into row b: the later cell gives up its columns from there, empty cells take its positions below, no other cell moves', () => {
      // c (colspan 2, rows 2-3) runs into b (rows 1-2) at column 2 and spans one row more than
      // b keeps; d stands right of c in row 3 (the shape of exploratory seeds 222 and 302).
      const spanning = acted(
        placed(
          [['a', { text: 'b', rowspan: 2 }], [{ text: 'c', colspan: 2, rowspan: 2 }], ['d']],
          'a',
        ),
        'deleteRow',
      );
      expect(show(spanning.after)).toBe('[c rowspan=2, b] / [<td>, d]');
      expect(gridOfNode(spanning.after).owner(1, 2)).toBe(3);
      // c reaches past b's columns: it gives up those too, in row b.
      const past = acted(
        placed([['a', { text: 'b', rowspan: 2 }, 'x'], [{ text: 'c', colspan: 3 }]], 'a'),
        'deleteRow',
      );
      expect(show(past.after)).toBe('[c, b, <td>]');
      // Both cells of the overlap move into row b (the assistant's whole lines 1 and 2).
      const both = acted(
        placed(
          [['a', { text: 'b', rowspan: 3 }], [{ text: 'c', colspan: 2, rowspan: 2 }], ['d']],
          'a',
          { lines: { axis: 'row', from: 0, to: 2 } },
        ),
        'deleteRow',
      );
      expect(show(both.after)).toBe('[c, b, d]');
      // A later cell of a row below that covers a given-up position becomes its owner: no cell
      // is put there.
      const later = acted(
        placed(
          [
            ['a', 'x', { text: 'b', rowspan: 2 }],
            ['y', { text: 'c', colspan: 2, rowspan: 2 }],
            [{ text: 'q', colspan: 3 }],
          ],
          'a',
        ),
        'deleteRow',
      );
      expect(show(later.after)).toBe('[y, c rowspan=2, b] / [q colspan=3]');
      expect(gridOfNode(later.after).width).toBe(3);
    });

    it('every plan on every irregular case of grid-vectors.json returns without throwing, a valid edit or a refusal', () => {
      const vectors = JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
        cases: VectorCase[];
      };
      const irregular = vectors.cases.filter((one) => !one.expect.regular);
      expect(irregular.length).toBeGreaterThan(10);
      for (const one of irregular) {
        const node = vectorTable(one.table);
        const doc = docOf(p('before', 'p1'), node, p('after', 'p2'));
        const tablePos = 1 + 1 + doc.child(0).child(0).child(0).nodeSize;
        const grid = gridOfNode(doc.nodeAt(tablePos)!);
        const cellPositions: number[] = [];
        doc.nodeAt(tablePos)!.descendants((child, at) => {
          if (child.type.name === 'td' || child.type.name === 'th') {
            cellPositions.push(tablePos + 1 + at);
          }
          return child.type.name === 'table' || child.type.name === 'tr';
        });
        expect(cellPositions.length, one.name).toBe(grid.cells.length);
        const selections = [
          ...cellPositions.map((at) => TextSelection.create(doc, at + 1)),
          ...(cellPositions.length > 1
            ? [CellBlockSelection.create(doc, cellPositions[0]!, cellPositions.at(-1)!)]
            : []),
        ];
        for (const selection of selections) {
          const state = EditorState.create({ doc, selection });
          const address = tableTarget(state)!.address;
          for (const [name, plan] of Object.entries(PLANS)) {
            let result: TableEdit | Refusal | undefined;
            expect(() => {
              result = plan(address, planContext());
            }, `${one.name}: ${name}`).not.toThrow();
            const edit = result;
            if (edit && !isRefusal(edit)) {
              const after = applyTableEdit(address.table, edit);
              expect(
                () => assertTableValid(address.table, after, edit.allowedIds),
                `${one.name}: ${name}`,
              ).not.toThrow();
            }
          }
        }
      }
    });
  });

  describe('duplicates (FR-030, FR-038)', () => {
    it('Duplicate row grows a cell across line b and copies the unit’s other cells', () => {
      expect(show(acted(placed(T2, 'b'), 'duplicateRow').after)).toBe(
        '[a rowspan=3, b] / [b] / [c]',
      );
      expect(
        show(
          acted(
            placed(
              [
                [{ text: 'a', colspan: 2 }, 'b'],
                ['c', 'd', 'e'],
              ],
              'c',
            ),
            'duplicateColumn',
          ).after,
        ),
      ).toBe('[a colspan=3, b] / [c, c, d, e]');
    });

    it('a copy keeps content, kind, spans, attributes and extraAttrs, has no id and fresh node ids throughout, also on an inline image', () => {
      const rich = {
        type: 'th' as const,
        colspan: 2,
        align: 'center',
        valign: 'bottom',
        lang: 'de',
        style: 'st',
        id: 'cid',
        unknownAttrs: { class: 'k' },
        content: [
          { type: 'text', text: 'x', marks: [{ type: 'strong' }] },
          { type: 'inline-image', attrs: { nodeId: 'img1', href: '#pic' } },
        ],
      };
      const where = placed([[rich], ['p', 'q']], 'x');
      const { after } = acted(where, 'duplicateRow');
      const source = where.table.child(0).child(0);
      const copy = after.child(1).child(0);
      expect(copy.type.name).toBe('th');
      expect(show(after).split(' / ')[1]).toBe(
        '[<th>x colspan=2 align=center valign=bottom lang=de style=st extra={"unknownAttrs":{"class":"k"}}]',
      );
      expect(copy.attrs.id).toBeNull();
      expect(withoutIds(copy)).toEqual({
        ...(withoutIds(source) as object),
        attrs: expect.anything(),
      });
      expect(copy.child(1).attrs.href).toBe('#pic');
      expect(copy.child(1).attrs.nodeId).toMatch(/^t\d+$/);
      expect(copy.attrs.nodeId).toMatch(/^t\d+$/);
      expect(copy.child(0).marks.map((mark) => mark.type.name)).toEqual(['strong']);
    });

    it('inline images, note links, nested named styles and inline raw XML come through moves and duplicates unchanged', () => {
      const content = [
        {
          type: 'text',
          text: 'n',
          marks: [{ type: 'link', attrs: { href: '#n1', type: 'note' } }],
        },
        {
          type: 'text',
          text: 's',
          marks: [
            { type: 'style', attrs: { name: 'outer' } },
            { type: 'style', attrs: { name: 'inner' } },
          ],
        },
        { type: 'inline-image', attrs: { nodeId: 'img', href: '#pic' } },
        { type: 'raw-xml', attrs: { nodeId: 'rx', xml: '<x:y/>', inline: true } },
      ];
      const node = nodeFromModel(
        modelTable([
          ['a', 'b'],
          [{ content }, 'd'],
        ]),
      )!;
      const cell = node.child(1).child(0);
      expect(cell.childCount).toBe(4);
      const up = acted(placed(node, 'd'), 'moveRowUp');
      expect(up.after.child(0).child(0)).toBe(cell);
      const right = acted(placed(node, 'a'), 'moveColumnRight');
      expect(right.after.child(1).child(1)).toBe(cell);
      const copied = acted(placed(node, 'd'), 'duplicateRow');
      expect(withoutIds(copied.after.child(2).child(0))).toEqual(withoutIds(cell));
      const column = acted(placed(node, 'a'), 'duplicateColumn');
      expect(withoutIds(column.after.child(1).child(1))).toEqual(withoutIds(cell));
    });
  });

  describe('moves (FR-038)', () => {
    it('reuse the row nodes and keep a non-row child before the row that followed it', () => {
      const where = placed([['a'], RAW, ['b'], ['c']], 'b');
      const { after } = acted(where, 'moveRowUp');
      expect(show(after)).toBe('raw / [b] / [a] / [c]');
      expect(childrenOf(after)).toEqual([1, 2, 0, 3].map((index) => where.table.child(index)));
      const down = acted(placed(where.table, 'a'), 'moveRowDown');
      expect(childrenOf(down.after)).toEqual([1, 2, 0, 3].map((index) => where.table.child(index)));
    });
  });

  describe('odd spans (spec Edge Cases, FR-047)', () => {
    const CASES: [string, MRow[]][] = [
      [
        'span-zero',
        [
          [{ text: 'a', colspan: 0 }, 'b'],
          ['c', 'd'],
        ],
      ],
      [
        'span-negative',
        [
          [{ text: 'a', rowspan: -1 }, 'b'],
          ['c', 'd'],
        ],
      ],
      [
        'span-abc',
        [
          [{ text: 'a', unknownAttrs: { colspan: 'abc' } }, 'b'],
          ['c', 'd'],
        ],
      ],
    ];

    for (const [name, rows] of CASES) {
      it(`${name}: counts as 1, and the cell, untouched, keeps its attribute object`, () => {
        const node = nodeFromModel(modelTable(rows))!;
        const a = node.child(0).child(0);
        expect(gridOfNode(node).regular).toBe(true);
        const below = acted(placed(node, 'a'), 'insertRowBelow');
        expect(show(below.after).split(' / ')[1]).toBe('[<td>, <td>]');
        expect(below.after.child(0)).toBe(node.child(0));
        expect(below.after.child(0).child(0).attrs).toBe(a.attrs);
        const right = acted(placed(node, 'a'), 'insertColumnRight');
        expect(show(right.after).split(' / ')[1]).toBe('[c, <td>, d]');
        expect(right.after.child(0).child(0)).toBe(a);
        const deleted = acted(placed(node, 'b'), 'deleteColumn');
        expect(deleted.after.child(0).child(0)).toBe(a);
        const moved = acted(placed(node, 'c'), 'moveRowUp');
        expect(moved.after.child(1).child(0)).toBe(a);
        // A copy is a new cell: its spans are written (as none), never the odd value.
        const copy = acted(placed(node, 'a'), 'duplicateRow').after.child(1).child(0);
        expect(copy.attrs.colspan).toBeNull();
        expect(copy.attrs.rowspan).toBeNull();
        expect(copy.attrs.extraAttrs).toBeNull();
      });
    }
  });

  describe('refusals (data-model §4.2, §4.5)', () => {
    const SQUARE: MRow[] = [
      ['a', 'b'],
      ['c', 'd'],
    ];

    it('only-row, all-rows, only-column and all-columns (FR-009)', () => {
      expect(refusal(placed([['a', 'b', 'c']], 'b'), 'deleteRow')).toEqual({ refused: 'only-row' });
      expect(refusal(placed(SQUARE, ['a', 'c']), 'deleteRow')).toEqual({ refused: 'all-rows' });
      expect(refusal(placed([['a'], ['b'], ['c']], 'b'), 'deleteColumn')).toEqual({
        refused: 'only-column',
      });
      expect(refusal(placed(SQUARE, ['a', 'b']), 'deleteColumn')).toEqual({
        refused: 'all-columns',
      });
    });

    it('merged-crosses-border for the row and the column axis, and for a span past the end', () => {
      const columns = placed(
        [
          [{ text: 'a', colspan: 2 }, 'b'],
          ['c', 'd', 'e'],
        ],
        'd',
      );
      for (const name of ['moveColumnLeft', 'moveColumnRight'] as const) {
        expect(refusal(columns, name)).toEqual({
          refused: 'merged-crosses-border',
          params: { axis: 'column' },
        });
      }
      // Line R is crossed by c's span past the end: no band below the first row.
      expect(
        refusal(
          placed(
            [
              ['a', 'b'],
              [{ text: 'c', rowspan: 3 }, 'd'],
            ],
            'a',
          ),
          'moveRowDown',
        ),
      ).toEqual({ refused: 'merged-crosses-border', params: { axis: 'row' } });
    });

    it('no-neighbour at each edge', () => {
      expect(refusal(placed(SQUARE, 'a'), 'moveRowUp')).toEqual({
        refused: 'no-neighbour',
        params: { direction: 'up' },
      });
      expect(refusal(placed(SQUARE, 'c'), 'moveRowDown')).toEqual({
        refused: 'no-neighbour',
        params: { direction: 'down' },
      });
      expect(refusal(placed(SQUARE, 'c'), 'moveColumnLeft')).toEqual({
        refused: 'no-neighbour',
        params: { direction: 'left' },
      });
      expect(refusal(placed(SQUARE, 'b'), 'moveColumnRight')).toEqual({
        refused: 'no-neighbour',
        params: { direction: 'right' },
      });
    });

    it('too-large before any other code on a table above MAX_GRID_POSITIONS', () => {
      const cells = Array.from({ length: 4195 }, (_, index) => ({
        text: `w${index}`,
        colspan: 1000,
      }));
      const big = placed([cells], 'w1');
      expect(big.address.grid.tooLarge).toBe(true);
      for (const name of Object.keys(PLANS) as PlanName[]) {
        expect(refusal(big, name), name).toEqual({ refused: 'too-large' });
      }
    });

    it('too-large where a crossing cell would grow past MAX_COLSPAN or MAX_ROWSPAN (the span guard)', () => {
      const wide = placed(
        [[{ text: 'a', colspan: 1000 }], ['b', { text: 'c', colspan: 999 }]],
        'b',
      );
      expect(wide.address.grid.tooLarge).toBe(false);
      expect(refusal(wide, 'insertColumnRight')).toEqual({ refused: 'too-large' });
      expect(refusal(wide, 'duplicateColumn')).toEqual({ refused: 'too-large' });
      // Not crossed at the left edge of the table: nothing grows.
      expect(isRefusal(refusal(wide, 'insertColumnLeft'))).toBe(false);
      const tall = placed([['a', { text: 'b', rowspan: 1e9 }], ['c']], 'c');
      expect(refusal(tall, 'insertRowAbove')).toEqual({ refused: 'too-large' });
    });
  });
});
