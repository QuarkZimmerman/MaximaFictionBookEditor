/**
 * The table plans of `ops.ts` (feature 006; data-model §4.4 to §4.6), one `describe` block per
 * user story in story order. US7 (T116; FR-020 to FR-022, FR-035, FR-045 to FR-047; C8, C14,
 * C19, C67; I13; data-model §1.5, §2.5, §4.4, §4.7): the attribute plans of `attrs.ts` -
 * `planCellAttrs` on a block's cells, a caret's cell or whole lines and its `id` on the head cell,
 * `planRowAlign`, `planTableAttrs` -, their checks and refusals, attributes only (the same rows
 * and cells otherwise), nothing committed for an equal value, the language setter's shadowed
 * key, and on a too-large table the caret's cell, row and table. US6 (T109; FR-017 to FR-019,
 * FR-035; C14, C21, C67; data-model §2.5, §4.5 `table.toggleHeaderCell`,
 * `table.makeHeaderCells` / `table.makeNormalCells` and `table.toggleHeaderRow` /
 * `table.toggleHeaderColumn`): the header plans change only the kind of the cells they target
 * - the same attributes and the same content fragment -, a block's head cell, the owners of whole
 * rows or columns, a merged cell once, nothing committed when nothing changes, and on a too-large
 * table the caret's cell without the owner map. US5 (T102;
 * FR-013 to FR-016, FR-030, FR-035, FR-046, FR-047; C12, C14, C17, C19, C67; decision 1; U8;
 * data-model §4.5 `table.mergeCells` and `table.splitCell`, open point 4): `planMerge` and
 * `planSplit` on regular, merged and irregular tables. US4 (T091; FR-011, FR-013's joining
 * rule, FR-016's split as the paste uses it; C17, C47; data-model §4.4, §4.6 "Clear block"):
 * `planClearBlock`, `joinInlineParts` and `splitToSingleCells`; the paste-block plan has its
 * own file, `pasteBlock.test.ts`. US1 (T052; FR-003, FR-005; C15, C33; I8): `createTable` -
 * the dialog's table, rectangular and without attributes, its node ids from the host - and
 * `planTabRow`, the row Tab appends in the last cell. US2 (T071; FR-006 to FR-009, FR-030,
 * FR-035, FR-037, FR-038, FR-046, FR-047; C12 to C15, C67; decision 1; data-model §4.4, §4.5):
 * the twelve row and column plans on regular, merged and irregular tables.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { history, undoDepth } from 'prosemirror-history';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2Schema } from '@/editor/schema';
import { planCellAttrs, planRowAlign, planTableAttrs } from '@/editor/table/attrs';
import { planCommand } from '@/editor/table/commands';
import {
  applyTableEdit,
  assertTableValid,
  commitTableEdit,
  isRefusal,
  tableTarget,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
} from '@/editor/table/edit';
import { MAX_GRID_POSITIONS, gridOfNode } from '@/editor/table/grid';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  blockOver,
  caretAt,
  cellAtTopLeft,
  createTable,
  joinInlineParts,
  lineOwners,
  planClearBlock,
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMerge,
  planMoveColumns,
  planMoveRows,
  planSetKind,
  planSplit,
  planTabRow,
  planToggleHeaderCell,
  planToggleHeaderLines,
  splitToSingleCells,
  withKind,
} from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { nodeToModel } from '@/editor/toModel';
import type { AnnotationNode } from '@/model/document';
import { collectBookIds } from '@/model/ids';

import { fakeDocument } from '../../features/testUtils';

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

describe('US4 blocks', () => {
  const ctx = () => ({ nextId: idGenerator('k') });

  describe('planClearBlock (data-model §4.6 "Clear block")', () => {
    const rows: MRow[] = [
      [
        {
          text: 'r1c1',
          id: 'cid',
          style: 'st',
          lang: 'de',
          colspan: 2,
          unknownAttrs: { foo: 'bar' },
        },
        'r1c3',
      ],
      ['r2c1', 'r2c2', { text: '', align: 'right' }],
      ['r3c1', 'r3c2', 'r3c3'],
    ];

    it('empties every cell of the block and keeps its attributes; other cells and rows are reused', () => {
      const where = placed(rows, ['r1c1', 'r2c2']);
      const { edit, after } = acted(where, planClearBlock);
      expect(show(after)).toBe(
        `[<td> colspan=2 lang=de id=cid style=st extra=${JSON.stringify({ unknownAttrs: { foo: 'bar' } })}, r1c3] / ` +
          '[<td>, <td>, <td> align=right] / [r3c1, r3c2, r3c3]',
      );
      const before = childrenOf(where.table);
      const next = childrenOf(after);
      // Row 3 holds no cell of the block: the same object; r1c3 lies outside the block.
      expect(next[2]).toBe(before[2]);
      expect(next[0]!.child(1)).toBe(before[0]!.child(1));
      expect(next[0]!.child(0).attrs).toEqual(before[0]!.child(0).attrs);
      expect(next[0]!.child(0).attrs.nodeId).toBe(before[0]!.child(0).attrs.nodeId);
      // An empty cell of the block (r2c3 lies outside it) and the cells' node ids stay.
      expect(next[1]!.child(2)).toBe(before[1]!.child(2));
      expect(edit.removedIds).toEqual([]);
      expect(edit.focus).toEqual(blockOver(where.address.rect!));
    });

    it('a block of empty cells commits nothing; too-large on a too-large table', () => {
      const empty = placed(
        [
          [{ text: '' }, { text: '' }],
          ['x', 'y'],
        ],
        ['x', 'y'],
      );
      // The block of the first row's empty cells, by node ids of the model.
      const doc = empty.state.doc;
      const cells: number[] = [];
      doc.descendants((node, at) => {
        if (node.type.name === 'td' && node.textContent === '') cells.push(at);
        return true;
      });
      const state = EditorState.create({
        doc,
        selection: CellBlockSelection.create(doc, cells[0]!, cells[1]!),
      });
      const target = tableTarget(state)!;
      const edit = planClearBlock(target.address, planContext()) as TableEdit;
      expect(childrenOf(applyTableEdit(target.address.table, edit))).toEqual(
        childrenOf(target.address.table),
      );
      childrenOf(target.address.table).forEach((row, index) => {
        expect(edit.rows[index]).toBe(row);
      });
      expect(commitTableEdit(state.tr, target.tablePos, edit)).toBeNull();
      const cellsWide = Array.from({ length: 4195 }, (_, index) => ({
        text: `w${index}`,
        colspan: 1000,
      }));
      const big = placed([cellsWide], 'w1');
      expect(
        planClearBlock(
          { ...big.address, rect: { top: 0, left: 0, bottom: 1, right: 2 } },
          planContext(),
        ),
      ).toEqual({
        refused: 'too-large',
      });
    });
  });

  describe('joinInlineParts (C17)', () => {
    const text = (value: string, marks = false) =>
      fb2Schema.text(value, marks ? [fb2Schema.marks.strong!.create()] : undefined);
    const parts = (...values: (string | PMNode)[]) =>
      values.map((value) =>
        typeof value === 'string'
          ? value === ''
            ? Fragment.empty
            : Fragment.from(text(value))
          : Fragment.from(value),
      );
    const nodes = (fragment: Fragment) => {
      const out: string[] = [];
      fragment.forEach((node) =>
        out.push(`${node.marks.map((mark) => mark.type.name).join('+')}:${node.text}`),
      );
      return out;
    };

    it('one unmarked space only between two non-empty parts; empty parts add nothing', () => {
      expect(nodes(joinInlineParts(parts('a', 'b'), fb2Schema))).toEqual([':a b']);
      expect(nodes(joinInlineParts(parts('', 'a', '', 'b', ''), fb2Schema))).toEqual([':a b']);
      expect(joinInlineParts(parts('', ''), fb2Schema).size).toBe(0);
    });

    it('white space at a part’s ends is kept; text of equal marks is joined into one node', () => {
      expect(nodes(joinInlineParts(parts(' a ', 'b '), fb2Schema))).toEqual([': a  b ']);
      expect(nodes(joinInlineParts(parts(text('a', true), text('b', true)), fb2Schema))).toEqual([
        'strong:a',
        ': ',
        'strong:b',
      ]);
    });
  });

  describe('splitToSingleCells (FR-016 as the paste uses it)', () => {
    /** Splits the cell `text` of `rows` and gives the table it leaves. */
    function split(rows: MRow[], text: string): PMNode {
      const node = nodeFromModel(modelTable(rows))!;
      const grid = gridOfNode(node);
      const index = grid.cells.findIndex(
        (cell) => node.child(grid.rowChild[cell.row]!).child(cell.index).textContent === text,
      );
      const after = node.type.create(
        node.attrs,
        splitToSingleCells(childrenOf(node), grid, index, ctx()),
      );
      after.check();
      return after;
    }

    it('the cell keeps its content and every attribute but its spans, a rowspan past the last row included; its other positions get empty cells like it', () => {
      const after = split(
        [
          [
            {
              type: 'th',
              text: 'H',
              colspan: 2,
              rowspan: 3,
              id: 'h',
              style: 'st',
              lang: 'de',
              align: 'right',
              valign: 'top',
              unknownAttrs: { foo: 'bar' },
            },
            'x',
          ],
          ['y'],
        ],
        'H',
      );
      expect(show(after)).toBe(
        `[<th>H align=right valign=top lang=de id=h style=st extra=${JSON.stringify({ unknownAttrs: { foo: 'bar' } })}, ` +
          '<th> align=right valign=top lang=de, x] / ' +
          '[<th> align=right valign=top lang=de, <th> align=right valign=top lang=de, y]',
      );
      expect(gridOfNode(after).regular).toBe(true);
    });

    it('pieces behind a hole come with the hole fill; positions an earlier cell owns get nothing', () => {
      // [a, b, C rowspan 2] / [d]: below b a hole, then C's second position.
      expect(show(split([['a', 'b', { text: 'C', rowspan: 2 }], ['d']], 'C'))).toBe(
        '[a, b, C] / [d, <td>, <td>]',
      );
      // [a, X rowspan 2] / [Y colspan 2]: Y's second position is X's.
      expect(
        show(split([['a', { text: 'X', rowspan: 2 }], [{ text: 'Y', colspan: 2 }]], 'Y')),
      ).toBe('[a, X rowspan=2] / [Y]');
    });
  });
});

/* ------------------------------------------------------------------------ */
/* US5: merge and split (T102)                                              */
/* ------------------------------------------------------------------------ */

describe('US5 merge and split', () => {
  const ctx = () => ({ nextId: idGenerator('u') });

  /** `where` with the assistant's rectangle as its address: no block, no caret (C67). */
  function withRect(where: Placed, rect: TableAddress['rect']): Placed {
    return { ...where, address: { table: where.table, grid: where.address.grid, rect } };
  }

  /** The selection a commit of `edit` leaves on `where`'s state. */
  function committed(where: Placed, edit: TableEdit) {
    const tr = commitTableEdit(where.state.tr, tableTarget(where.state)!.tablePos, edit)!;
    expect(tr).not.toBeNull();
    return tr.selection;
  }

  /** One row of 4195 cells of colspan 1000: above MAX_GRID_POSITIONS. */
  function big(): Placed {
    const cells = Array.from({ length: 4195 }, (_, index) => ({
      text: `w${index}`,
      colspan: 1000,
    }));
    return placed([cells], 'w1');
  }

  /** Inline content of every kind a cell holds (U8; FR-030, FR-067, FR-069). */
  const NOTE = {
    type: 'text',
    text: 'n',
    marks: [{ type: 'link', attrs: { href: '#n1', type: 'note' } }],
  };
  const NESTED = {
    type: 'text',
    text: 's',
    marks: [
      { type: 'style', attrs: { name: 'outer' } },
      { type: 'style', attrs: { name: 'inner' } },
    ],
  };
  const BOLD = { type: 'text', text: 'b', marks: [{ type: 'strong' }] };
  const IMAGE = { type: 'inline-image', attrs: { nodeId: 'img', href: '#pic' } };
  const RAW = { type: 'raw-xml', attrs: { nodeId: 'rx', xml: '<!--kept-->', inline: true } };
  const LINKED = { type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: '#t' } }] };

  describe('Merge cells (data-model §4.5 `table.mergeCells`)', () => {
    /** US5 sc.1's table of `tables.fb2` (T014), `r2c2` with an id. */
    const SC1: MRow[] = [
      [
        {
          type: 'th',
          text: 'r1c1',
          id: 'us5-r1c1',
          style: 'hd',
          lang: 'de',
          align: 'right',
          valign: 'top',
          unknownAttrs: { class: 'k' },
        },
        { text: '' },
        'r1c3',
        'r1c4',
      ],
      ['r2c1', { text: 'r2c2', id: 'us5-r2c2' }, 'r2c3', 'r2c4'],
      ['r3c1', 'r3c2', 'r3c3', 'r3c4'],
    ];

    it('sc.1: the top-left cell covers the 2 × 3 block and keeps its kind, node id and attributes; the texts follow in reading order; row 2 keeps r2c4', () => {
      const where = placed(SC1, ['r1c1', 'r2c3']);
      const before = where.table;
      const { edit, after } = acted(where, planMerge);
      expect(show(after)).toBe(
        `[<th>r1c1 r1c3 r2c1 r2c2 r2c3 colspan=3 rowspan=2 align=right valign=top lang=de id=us5-r1c1 style=hd extra=${JSON.stringify({ unknownAttrs: { class: 'k' } })}, r1c4] / ` +
          '[r2c4] / [r3c1, r3c2, r3c3, r3c4]',
      );
      const keeper = after.child(0).child(0);
      const source = before.child(0).child(0);
      expect(keeper.type.name).toBe('th');
      expect(keeper.attrs.nodeId).toBe(source.attrs.nodeId);
      expect(keeper.attrs.extraAttrs).toEqual(source.attrs.extraAttrs);
      // The removed cells' ids; untouched rows and cells are the same objects.
      expect(edit.removedIds).toEqual(['us5-r2c2']);
      expect(after.child(2)).toBe(before.child(2));
      expect(after.child(0).child(1)).toBe(before.child(0).child(3));
      expect(after.child(1).child(0)).toBe(before.child(1).child(3));
      expect(gridOfNode(after).summary).toMatchObject({
        rows: 3,
        columns: 4,
        shortRows: 0,
        overlaps: 0,
        pastEnd: 0,
      });
      // The focus: a caret at the start of the merged cell.
      expect(edit.focus).toEqual(caretAt(0, 0));
      const selection = committed(where, edit);
      expect(selection.empty).toBe(true);
      expect(selection.$head.parent.attrs.nodeId).toBe(source.attrs.nodeId);
      expect(selection.$head.parentOffset).toBe(0);
    });

    it('over the full width of a 3 × 3 table: one row whose cell spans 3 columns, rowspan null (decision 1; FR-014)', () => {
      const where = placed(PLAIN, ['r1c1', 'r2c3']);
      const { edit, after } = acted(where, planMerge);
      expect(show(after)).toBe('[r1c1 r1c2 r1c3 r2c1 r2c2 r2c3 colspan=3] / [r3c1, r3c2, r3c3]');
      expect(after.child(0).child(0).attrs.colspan).toBe(3);
      expect(after.child(0).child(0).attrs.rowspan).toBeNull();
      expect(after.child(1)).toBe(where.table.child(2));
      expect(gridOfNode(after).regular).toBe(true);
      expect(edit.focus).toEqual(caretAt(0, 0));
    });

    it('a block that holds a merged cell merges over the whole block', () => {
      const rows: MRow[] = [[{ text: 'a', colspan: 2, rowspan: 2 }, 'b'], ['c'], ['d', 'e', 'f']];
      expect(show(acted(placed(rows, ['a', 'e']), planMerge).after)).toBe(
        '[a d e colspan=2 rowspan=3, b] / [c] / [f]',
      );
      // From b to d: the whole table; its emptied rows go and the span shrinks with them.
      expect(show(acted(placed(rows, ['b', 'd']), planMerge).after)).toBe(
        '[a b c d e f colspan=3]',
      );
    });

    it('C17: an empty keeper gives no leading space; white space at a part’s ends stays; only parts with content are separated', () => {
      const empty = acted(
        placed(
          [
            [{ text: '' }, 'b'],
            ['c', 'd'],
          ],
          ['b', 'c'],
        ),
        planMerge,
      ).after;
      expect(empty.child(0).child(0).textContent).toBe('b c d');
      const spaced = acted(
        placed(
          [
            [' a ', 'b '],
            [{ text: '' }, ' c'],
          ],
          [' a ', ' c'],
        ),
        planMerge,
      ).after;
      expect(spaced.child(0).child(0).textContent).toBe(' a  b   c');
      expect(spaced.child(0).child(0).childCount).toBe(1);
    });

    it('U8: inline images, links, note links, nested named styles and inline raw XML move unchanged and in reading order, one space node between the parts', () => {
      const node = nodeFromModel(
        modelTable([
          [{ content: [BOLD, NOTE] }, { content: [NESTED] }],
          [{ content: [IMAGE] }, { content: [RAW, LINKED] }],
        ]),
      )!;
      const cells = [
        node.child(0).child(0),
        node.child(0).child(1),
        node.child(1).child(0),
        node.child(1).child(1),
      ];
      const { after } = acted(placed(node, ['bn', 'a']), planMerge);
      const keeper = after.child(0).child(0);
      const space = fb2Schema.text(' ');
      const expected = Fragment.from([
        ...childrenOf(cells[0]!),
        space,
        ...childrenOf(cells[1]!),
        space,
        ...childrenOf(cells[2]!),
        space,
        ...childrenOf(cells[3]!),
      ]);
      expect(keeper.content.eq(expected)).toBe(true);
      // The atoms are the same nodes, node ids included; the nested styles keep their order.
      expect(childrenOf(keeper)).toContain(cells[2]!.child(0));
      expect(childrenOf(keeper)).toContain(cells[3]!.child(0));
      const styled = childrenOf(keeper).find((child) => child.text === 's')!;
      expect(styled.marks.map((mark) => mark.attrs.name)).toEqual(['outer', 'inner']);
      expect(show(after)).toBe('[bn s  a colspan=2]');
    });

    it('C19: a keeper read from colspan="abc" gets colspan 2 and no unknownAttrs.colspan', () => {
      const where = placed(
        [
          [{ text: 'a', unknownAttrs: { colspan: 'abc' } }, 'b'],
          ['c', 'd'],
        ],
        ['a', 'b'],
      );
      const keeper = acted(where, planMerge).after.child(0).child(0);
      expect(keeper.attrs.colspan).toBe(2);
      expect(keeper.attrs.rowspan).toBeNull();
      expect(keeper.attrs.extraAttrs).toBeNull();
    });

    it('irregular tables (FR-035): a hole inside the rectangle is covered; a hole at its top-left gives the keeper to the first cell in reading order, which moves into the top row after the hole fill', () => {
      // [a, b, c] / [d, e]: the block from c to e holds the hole (1, 2).
      const overHole = acted(
        placed(
          [
            ['a', 'b', 'c'],
            ['d', 'e'],
          ],
          ['c', 'e'],
        ),
        planMerge,
      );
      expect(show(overHole.after)).toBe('[a, b c e colspan=2 rowspan=2] / [d]');
      expect(gridOfNode(overHole.after).owner(1, 2)).toBe(1);
      // The assistant's rectangle over column 3, whose top position is a hole.
      const where = placed([['a'], ['b', 'c', 'x'], ['d', 'e', 'y']], 'a');
      const moved = acted(withRect(where, { top: 0, left: 2, bottom: 3, right: 3 }), planMerge);
      expect(show(moved.after)).toBe('[a, <td>, x y rowspan=3] / [b, c] / [d, e]');
      expect(moved.after.child(0).child(2).attrs.nodeId).toBe(
        where.table.child(1).child(2).attrs.nodeId,
      );
      expect(moved.after.child(0).child(1).attrs.nodeId).toMatch(/^t\d+$/);
      expect(moved.edit.focus).toEqual(caretAt(0, 2));
      expect(gridOfNode(moved.after).regular).toBe(true);
    });

    it('C67: the assistant’s rectangle is extended first', () => {
      const where = placed(
        [
          [{ text: 'a', colspan: 2 }, 'b'],
          ['c', 'd', 'e'],
        ],
        'b',
      );
      const { after } = acted(withRect(where, { top: 0, left: 1, bottom: 2, right: 2 }), planMerge);
      expect(show(after)).toBe('[a c d colspan=2 rowspan=2, b] / [e]');
    });

    it('needs-block for a caret and for a rectangle of one cell; too-large before anything else', () => {
      expect(planMerge(placed(PLAIN, 'r2c2').address, ctx())).toEqual({ refused: 'needs-block' });
      const one = withRect(placed(PLAIN, 'r2c2'), { top: 1, left: 1, bottom: 2, right: 2 });
      expect(planMerge(one.address, ctx())).toEqual({ refused: 'needs-block' });
      const large = big();
      expect(large.address.grid.tooLarge).toBe(true);
      expect(planMerge(large.address, ctx())).toEqual({ refused: 'too-large' });
      expect(
        planMerge(withRect(large, { top: 0, left: 0, bottom: 1, right: 2000 }).address, ctx()),
      ).toEqual({ refused: 'too-large' });
    });
  });

  describe('Split cell (data-model §4.5 `table.splitCell`)', () => {
    /** US5 sc.5's table of `tables.fb2` (T014). */
    const SC5: MRow[] = [
      [
        {
          type: 'th',
          text: 'm',
          colspan: 3,
          rowspan: 2,
          id: 'us5-m',
          style: 'hd',
          lang: 'fr',
          align: 'center',
          valign: 'bottom',
          unknownAttrs: { class: 'k' },
        },
        'd',
      ],
      ['e'],
    ];

    it('sc.5: six single cells - m keeps its content, node id and every attribute but the spans; five new empty th like it with fresh node ids; the caret keeps its offset', () => {
      const where = placed(SC5, 'm', { offset: 1 });
      const source = where.table.child(0).child(0);
      const { edit, after } = acted(where, planSplit);
      const piece = '<th> align=center valign=bottom lang=fr';
      expect(show(after)).toBe(
        `[<th>m align=center valign=bottom lang=fr id=us5-m style=hd extra=${JSON.stringify({ unknownAttrs: { class: 'k' } })}, ${piece}, ${piece}, d] / ` +
          `[${piece}, ${piece}, ${piece}, e]`,
      );
      const kept = after.child(0).child(0);
      expect(kept.content).toBe(source.content);
      expect(kept.attrs.nodeId).toBe(source.attrs.nodeId);
      expect(kept.attrs.colspan).toBeNull();
      expect(kept.attrs.rowspan).toBeNull();
      const pieces = [
        after.child(0).child(1),
        after.child(0).child(2),
        after.child(1).child(0),
        after.child(1).child(1),
        after.child(1).child(2),
      ];
      for (const one of pieces) {
        expect(one.type.name).toBe('th');
        expect(one.content.size).toBe(0);
        expect(one.attrs.id).toBeNull();
        expect(one.attrs.style).toBeNull();
        expect(one.attrs.extraAttrs).toBeNull();
        expect(one.attrs.nodeId).toMatch(/^t\d+$/);
      }
      expect(new Set(pieces.map((one) => one.attrs.nodeId)).size).toBe(5);
      // d and e are the same nodes, in column 4.
      expect(after.child(0).child(3)).toBe(where.table.child(0).child(1));
      expect(after.child(1).child(3)).toBe(where.table.child(1).child(0));
      expect(edit.removedIds).toEqual([]);
      expect(gridOfNode(after).summary).toMatchObject({
        rows: 2,
        columns: 4,
        shortRows: 0,
        overlaps: 0,
        pastEnd: 0,
      });
      expect(edit.focus).toEqual(caretAt(0, 0));
      const selection = committed(where, edit);
      expect(selection.$head.parent.attrs.nodeId).toBe(source.attrs.nodeId);
      expect(selection.$head.parentOffset).toBe(1);
    });

    it('a rowspan past the last row goes with the spans; positions an earlier cell owns get nothing; a split beside a hole fills it first', () => {
      expect(
        show(
          acted(placed([[{ text: 'p', colspan: 2, rowspan: 5 }, 'b'], ['c']], 'p'), planSplit)
            .after,
        ),
      ).toBe('[p, <td>, b] / [<td>, <td>, c]');
      // [a, b, X rowspan 2] / [Y colspan 3]: Y runs into X's position (1, 2), which stays X's.
      expect(
        show(
          acted(
            placed([['a', 'b', { text: 'X', rowspan: 2 }], [{ text: 'Y', colspan: 3 }]], 'Y'),
            planSplit,
          ).after,
        ),
      ).toBe('[a, b, X rowspan=2] / [Y, <td>]');
      expect(
        show(acted(placed([['a', 'b', { text: 'C', rowspan: 2 }], ['d']], 'C'), planSplit).after),
      ).toBe('[a, b, C] / [d, <td>, <td>]');
    });

    it('U8: the kept content is the same fragment, rich inline content included', () => {
      const node = nodeFromModel(
        modelTable([[{ content: [NOTE, NESTED, IMAGE, RAW], colspan: 2 }], ['x', 'y']]),
      )!;
      const where = placed(node, 'ns');
      const { after } = acted(where, planSplit);
      expect(after.child(0).child(0).content).toBe(node.child(0).child(0).content);
      expect(show(after)).toBe('[ns, <td>] / [x, y]');
      expect(after.child(1)).toBe(node.child(1));
    });

    it('spans 0, −1 and "abc" count as 1: not-merged for the cell (FR-047); a block: not-merged for the block (open point 4); too-large first', () => {
      for (const odd of [{ colspan: 0 }, { rowspan: -1 }, { unknownAttrs: { colspan: 'abc' } }]) {
        const where = placed(
          [
            [{ text: 'a', ...odd }, 'b'],
            ['c', 'd'],
          ],
          'a',
        );
        expect(planSplit(where.address, ctx()), JSON.stringify(odd)).toEqual({
          refused: 'not-merged',
          params: { selection: 'cell' },
        });
      }
      expect(planSplit(placed(PLAIN, 'r2c2').address, ctx())).toEqual({
        refused: 'not-merged',
        params: { selection: 'cell' },
      });
      expect(planSplit(placed(SC5, ['m', 'e']).address, ctx())).toEqual({
        refused: 'not-merged',
        params: { selection: 'block' },
      });
      expect(planSplit(big().address, ctx())).toEqual({ refused: 'too-large' });
    });
  });

  it('every irregular case of grid-vectors.json: a caret in every cell and a block, without throwing, a valid edit or a refusal', () => {
    const vectors = JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
      cases: VectorCase[];
    };
    const irregular = vectors.cases.filter((one) => !one.expect.regular);
    expect(irregular.length).toBeGreaterThan(10);
    let edits = 0;
    for (const one of irregular) {
      const node = vectorTable(one.table);
      const doc = docOf(p('before', 'p1'), node, p('after', 'p2'));
      const tablePos = 1 + 1 + doc.child(0).child(0).child(0).nodeSize;
      const cellPositions: number[] = [];
      doc.nodeAt(tablePos)!.descendants((child, at) => {
        if (child.type.name === 'td' || child.type.name === 'th')
          cellPositions.push(tablePos + 1 + at);
        return child.type.name === 'table' || child.type.name === 'tr';
      });
      const selections = [
        ...cellPositions.map((at) => TextSelection.create(doc, at + 1)),
        ...(cellPositions.length > 1
          ? [CellBlockSelection.create(doc, cellPositions[0]!, cellPositions.at(-1)!)]
          : []),
      ];
      for (const selection of selections) {
        const address = tableTarget(EditorState.create({ doc, selection }))!.address;
        for (const [name, plan] of [
          ['mergeCells', planMerge],
          ['splitCell', planSplit],
        ] as const) {
          let result: TableEdit | Refusal | undefined;
          expect(() => {
            result = plan(address, planContext());
          }, `${one.name}: ${name}`).not.toThrow();
          const edit = result;
          if (edit && !isRefusal(edit)) {
            edits += 1;
            const after = applyTableEdit(address.table, edit);
            expect(
              () => assertTableValid(address.table, after, edit.allowedIds),
              `${one.name}: ${name}`,
            ).not.toThrow();
          }
        }
      }
    }
    expect(edits).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------------------ */
/* US6: header cells (T109)                                                 */
/* ------------------------------------------------------------------------ */

describe('US6 header cells', () => {
  const ctx = () => ({ nextId: idGenerator('h') });

  /** The five plans, as their command rows run them. */
  const HEADER_PLANS = {
    toggleHeaderCell: (a, c) => planToggleHeaderCell(a, c),
    makeHeaderCells: (a, c) => planSetKind(a, { kind: 'th' }, c),
    makeNormalCells: (a, c) => planSetKind(a, { kind: 'td' }, c),
    toggleHeaderRow: (a, c) => planToggleHeaderLines(a, { axis: 'row' }, c),
    toggleHeaderColumn: (a, c) => planToggleHeaderLines(a, { axis: 'column' }, c),
  } satisfies Record<string, Plan>;

  /** US6 sc.1's table of `tables.fb2` (T014); `s` also keeps an unknown attribute as read. */
  const SC1: MRow[] = [
    [{ type: 'th', text: 'r1c1' }, 'r1c2', 'r1c3'],
    [
      {
        text: 's',
        colspan: 2,
        id: 'us6-s',
        style: 'wide',
        lang: 'de',
        align: 'center',
        valign: 'middle',
        unknownAttrs: { class: 'k' },
      },
      'r2c3',
    ],
    ['r3c1', 'r3c2', 'r3c3'],
  ];
  const S_SHOWN = `s colspan=2 align=center valign=middle lang=de id=us6-s style=wide extra=${JSON.stringify({ unknownAttrs: { class: 'k' } })}`;
  /** A cell `m` over rows 2 and 3 (C14). */
  const TALL: MRow[] = [
    ['r1c1', 'r1c2', 'r1c3'],
    [{ text: 'm', rowspan: 2 }, 'r2c2', 'r2c3'],
    ['r3c2', 'r3c3'],
  ];
  /** A cell `w` over columns 1 and 2 (C14). */
  const WIDE: MRow[] = [
    [{ text: 'w', colspan: 2 }, 'x'],
    ['y', 'z', 'q'],
  ];

  /** The node ids of the cells of `node` whose texts are `texts`, in that order. */
  function ids(node: PMNode, ...texts: string[]): string[] {
    const byText = new Map<string, string>();
    node.forEach((row) => {
      if (row.type.name !== 'tr') return;
      row.forEach((cell) => {
        if (cell.type.name === 'td' || cell.type.name === 'th') {
          byText.set(cell.textContent, cell.attrs.nodeId as string);
        }
      });
    });
    return texts.map((text) => {
      const id = byText.get(text);
      if (!id) throw new Error(`no cell "${text}"`);
      return id;
    });
  }

  /**
   * Checks that `after` differs from `before` in the kinds of cells only - every child in its
   * place; every cell with equal attributes, the same content fragment (`===`) and its marks;
   * every cell of the same kind and every row without a changed cell reused (`===`); a changed
   * row with its attributes - and returns the node ids of the cells whose kind changed, in
   * reading order.
   */
  function kindChanges(before: PMNode, after: PMNode): string[] {
    expect(after.childCount).toBe(before.childCount);
    const changed: string[] = [];
    before.forEach((child, _offset, index) => {
      const next = after.child(index);
      if (child.type.name !== 'tr') {
        expect(next).toBe(child);
        return;
      }
      expect(next.type).toBe(child.type);
      expect(next.attrs).toEqual(child.attrs);
      expect(next.childCount).toBe(child.childCount);
      let rowChanged = false;
      child.forEach((cell, _at, cellIndex) => {
        const now = next.child(cellIndex);
        if (cell.type.name !== 'td' && cell.type.name !== 'th') {
          expect(now).toBe(cell);
          return;
        }
        expect(now.attrs).toEqual(cell.attrs);
        expect(now.content).toBe(cell.content);
        expect(now.marks).toEqual(cell.marks);
        if (now.type === cell.type) {
          expect(now).toBe(cell);
          return;
        }
        rowChanged = true;
        changed.push(cell.attrs.nodeId as string);
      });
      if (!rowChanged) expect(next).toBe(child);
    });
    return changed;
  }

  /** The selection a commit of `edit` leaves on `where`'s state. */
  function committed(where: Placed, edit: TableEdit) {
    const tr = commitTableEdit(where.state.tr, tableTarget(where.state)!.tablePos, edit);
    expect(tr).not.toBeNull();
    return tr!.selection;
  }

  /** One row of 4195 cells of colspan 1000 - above MAX_GRID_POSITIONS -, the caret in `w1`. */
  function big(offset = 0): Placed {
    const cells = Array.from({ length: 4195 }, (_, index) => ({
      text: `w${index}`,
      colspan: 1000,
    }));
    return placed([cells], 'w1', { offset });
  }

  function gridOfRows(rows: MRow[]) {
    return gridOfNode(nodeFromModel(modelTable(rows))!);
  }

  it('withKind: the other node type over equal attributes, the same content fragment and marks (FR-019 by construction)', () => {
    const where = placed(SC1, 's');
    const source = where.table.child(1).child(0);
    const header = withKind(source, 'th');
    expect(header.type).toBe(fb2Schema.nodes.th);
    expect(header.attrs).toEqual(source.attrs);
    expect(header.attrs.extraAttrs).toBe(source.attrs.extraAttrs);
    expect(header.content).toBe(source.content);
    const normal = withKind(header, 'td');
    expect(normal.type).toBe(fb2Schema.nodes.td);
    expect(normal.eq(source)).toBe(true);
    expect(normal.content).toBe(source.content);
  });

  it('cellAtTopLeft: the cell whose top-left position that is - none for a covered position or a hole -, found without the owner map, also on a too-large table (data-model §2.5)', () => {
    const wide = nodeFromModel(modelTable(WIDE))!;
    const grid = gridOfNode(wide);
    const at = (row: number, col: number) => cellAtTopLeft(grid, wide, { row, col });
    expect(at(0, 0)?.index).toBe(0);
    expect(at(0, 0)?.node).toBe(wide.child(0).child(0));
    expect(at(0, 1)).toBeNull();
    expect(at(0, 2)?.node).toBe(wide.child(0).child(1));
    expect(at(1, 1)?.index).toBe(3);
    expect(at(1, 1)?.node).toBe(wide.child(1).child(1));
    expect(at(2, 0)).toBeNull();
    // (2, 0) of TALL is m's, which starts in row 2.
    const tall = nodeFromModel(modelTable(TALL))!;
    expect(cellAtTopLeft(gridOfNode(tall), tall, { row: 2, col: 0 })).toBeNull();
    expect(cellAtTopLeft(gridOfNode(tall), tall, { row: 2, col: 1 })?.node.textContent).toBe(
      'r3c2',
    );
    const large = big();
    const owner = vi.spyOn(large.address.grid, 'owner');
    try {
      const last = cellAtTopLeft(large.address.grid, large.table, { row: 0, col: 4194 * 1000 });
      expect(last?.node.textContent).toBe('w4194');
      expect(cellAtTopLeft(large.address.grid, large.table, { row: 0, col: 1500 })).toBeNull();
      expect(owner).not.toHaveBeenCalled();
    } finally {
      owner.mockRestore();
    }
  });

  it('lineOwners: the owners of every position of rows or columns [from, to), holes skipped, each cell once, in reading order, the cells of other rows that reach in included', () => {
    const wide = gridOfRows(WIDE);
    // w over columns 1 and 2 counts once for either column, and once for both.
    expect(lineOwners(wide, 'column', 0, 1)).toEqual([0, 2]);
    expect(lineOwners(wide, 'column', 1, 2)).toEqual([0, 3]);
    expect(lineOwners(wide, 'column', 0, 2)).toEqual([0, 2, 3]);
    expect(lineOwners(wide, 'row', 0, 1)).toEqual([0, 1]);
    // [a rowspan 2, b] / [c]: row 2 holds a, which reaches in from row 1, and c.
    const tall = gridOfRows([[{ text: 'a', rowspan: 2 }, 'b'], ['c']]);
    expect(lineOwners(tall, 'row', 1, 2)).toEqual([0, 2]);
    expect(lineOwners(tall, 'row', 0, 2)).toEqual([0, 1, 2]);
    // A short row's holes are skipped.
    const short = gridOfRows([['a', 'b', 'c'], ['d']]);
    expect(lineOwners(short, 'row', 1, 2)).toEqual([3]);
    expect(lineOwners(short, 'column', 1, 3)).toEqual([1, 2]);
    // An overlap: c runs into b's position (2, 2), which is b's, the earlier cell.
    const overlap = gridOfRows([['a', { text: 'b', rowspan: 2 }], [{ text: 'c', colspan: 2 }]]);
    expect(lineOwners(overlap, 'column', 1, 2)).toEqual([1]);
    expect(lineOwners(overlap, 'row', 1, 2)).toEqual([1, 2]);
  });

  describe('Toggle header cell (data-model §4.5 `table.toggleHeaderCell`)', () => {
    it('sc.1: the caret’s cell becomes a th with equal attributes and the same content fragment; its row keeps its node id, every other row and cell is reused; the caret keeps its offset; again, a td equal to the original', () => {
      const where = placed(SC1, 's', { offset: 1 });
      const before = where.table;
      const source = before.child(1).child(0);
      const { edit, after } = acted(where, HEADER_PLANS.toggleHeaderCell);
      expect(kindChanges(before, after)).toEqual(ids(before, 's'));
      expect(show(after)).toBe(
        `[<th>r1c1, r1c2, r1c3] / [<th>${S_SHOWN}, r2c3] / [r3c1, r3c2, r3c3]`,
      );
      const header = after.child(1).child(0);
      expect(header.type.name).toBe('th');
      expect(header.attrs).toEqual(source.attrs);
      expect(header.attrs.extraAttrs).toBe(source.attrs.extraAttrs);
      expect(header.content).toBe(source.content);
      expect(after.child(1).attrs.nodeId).toBe(before.child(1).attrs.nodeId);
      expect(edit.removedIds).toEqual([]);
      expect(gridOfNode(after).summary).toEqual(gridOfNode(before).summary);
      expect(edit.focus).toEqual(caretAt(1, 0));
      const selection = committed(where, edit);
      expect(selection.empty).toBe(true);
      expect(selection.$head.parent.attrs.nodeId).toBe(source.attrs.nodeId);
      expect(selection.$head.parentOffset).toBe(1);
      // Again: a td equal to the original.
      const again = acted(placed(after, 's', { offset: 1 }), HEADER_PLANS.toggleHeaderCell).after;
      expect(again.child(1).child(0).eq(source)).toBe(true);
      expect(nodeToModel(again)).toEqual(nodeToModel(before));
    });

    it('sc.1: with a block, the head cell only - the cell that holds $head -, and the block stays', () => {
      const down = placed(SC1, ['r2c3', 'r3c3']);
      const flipped = acted(down, HEADER_PLANS.toggleHeaderCell);
      expect(kindChanges(down.table, flipped.after)).toEqual(ids(down.table, 'r3c3'));
      expect(flipped.edit.focus).toEqual(blockOver(down.address.rect!));
      const selection = committed(down, flipped.edit);
      expect(selection).toBeInstanceOf(CellBlockSelection);
      const block = selection as CellBlockSelection;
      expect(block.$anchorCell.nodeAfter!.attrs.nodeId).toBe(ids(down.table, 'r2c3')[0]);
      expect(block.$headCell.nodeAfter!.attrs.nodeId).toBe(ids(down.table, 'r3c3')[0]);
      const up = placed(SC1, ['r3c3', 'r2c3']);
      expect(kindChanges(up.table, acted(up, HEADER_PLANS.toggleHeaderCell).after)).toEqual(
        ids(up.table, 'r2c3'),
      );
      // A header head cell becomes a normal cell.
      const toNormal = placed(SC1, ['r1c2', 'r1c1']);
      const normal = acted(toNormal, HEADER_PLANS.toggleHeaderCell).after;
      expect(kindChanges(toNormal.table, normal)).toEqual(ids(toNormal.table, 'r1c1'));
      expect(normal.child(0).child(0).type.name).toBe('td');
    });
  });

  describe('Make header cells and Make normal cells (data-model §4.5)', () => {
    /** [<th>a, b, c] / [d, <th>e, f] / [g, h, i]. */
    const MIXED: MRow[] = [
      [{ type: 'th', text: 'a' }, 'b', 'c'],
      ['d', { type: 'th', text: 'e' }, 'f'],
      ['g', 'h', 'i'],
    ];

    it('sc.2: Make header cells converts the block’s normal cells and keeps its header cells as they are; Make normal cells the reverse; the block stays', () => {
      const where = placed(MIXED, ['a', 'e']);
      const made = acted(where, HEADER_PLANS.makeHeaderCells);
      expect(kindChanges(where.table, made.after)).toEqual(ids(where.table, 'b', 'd'));
      expect(show(made.after)).toBe('[<th>a, <th>b, c] / [<th>d, <th>e, f] / [g, h, i]');
      expect(made.edit.focus).toEqual(blockOver(where.address.rect!));
      expect(made.edit.removedIds).toEqual([]);
      const normal = acted(placed(made.after, ['a', 'e']), HEADER_PLANS.makeNormalCells);
      expect(kindChanges(made.after, normal.after)).toEqual(ids(where.table, 'a', 'b', 'd', 'e'));
      expect(show(normal.after)).toBe('[a, b, c] / [d, e, f] / [g, h, i]');
    });

    it('a block that holds a merged cell converts it once; with a caret, the caret’s cell only, which keeps the caret’s offset', () => {
      const block = placed(WIDE, ['w', 'z']);
      expect(kindChanges(block.table, acted(block, HEADER_PLANS.makeHeaderCells).after)).toEqual(
        ids(block.table, 'w', 'y', 'z'),
      );
      const caret = placed(MIXED, 'f', { offset: 1 });
      const { edit, after } = acted(caret, HEADER_PLANS.makeHeaderCells);
      expect(kindChanges(caret.table, after)).toEqual(ids(caret.table, 'f'));
      expect(edit.focus).toEqual(caretAt(1, 2));
      expect(committed(caret, edit).$head.parentOffset).toBe(1);
      const inE = placed(MIXED, 'e');
      const normal = acted(inE, HEADER_PLANS.makeNormalCells);
      expect(kindChanges(inE.table, normal.after)).toEqual(ids(inE.table, 'e'));
    });

    it('FR-045: with nothing to convert they commit nothing - every row ===, commitTableEdit null, no undo step', () => {
      const HEAD_ROW: MRow[] = [
        [
          { type: 'th', text: 'a' },
          { type: 'th', text: 'b' },
        ],
        ['c', 'd'],
      ];
      const cases: [string | [string, string], Plan][] = [
        [['a', 'b'], HEADER_PLANS.makeHeaderCells],
        ['a', HEADER_PLANS.makeHeaderCells],
        [['c', 'd'], HEADER_PLANS.makeNormalCells],
        ['d', HEADER_PLANS.makeNormalCells],
      ];
      for (const [at, plan] of cases) {
        const where = placed(HEAD_ROW, at);
        const edit = plan(where.address, ctx());
        if (isRefusal(edit)) throw new Error(`refused: ${edit.refused}`);
        expect(edit.rows).toHaveLength(where.table.childCount);
        edit.rows.forEach((row, index) => expect(row).toBe(where.table.child(index)));
        expect(edit.tableAttrs).toBeUndefined();
        expect(
          commitTableEdit(where.state.tr, tableTarget(where.state)!.tablePos, edit),
        ).toBeNull();
        // As the command runs it, in a state with history: false, nothing dispatched.
        const state = EditorState.create({
          doc: where.state.doc,
          selection: where.state.selection,
          plugins: [history()],
        });
        const dispatch = vi.fn();
        expect(planCommand(plan, ctx())(state, dispatch)).toBe(false);
        expect(dispatch).not.toHaveBeenCalled();
      }
      // The command with something to convert records one undo step.
      const where = placed(HEAD_ROW, ['a', 'b']);
      let state = EditorState.create({
        doc: where.state.doc,
        selection: where.state.selection,
        plugins: [history()],
      });
      expect(undoDepth(state)).toBe(0);
      const ran = planCommand(HEADER_PLANS.makeNormalCells, ctx())(state, (tr) => {
        state = state.apply(tr);
      });
      expect(ran).toBe(true);
      expect(undoDepth(state)).toBe(1);
    });
  });

  describe('Toggle header row and Toggle header column (data-model §4.5)', () => {
    it('sc.3: a row that mixes kinds becomes header cells, then all normal cells; the owners of the row’s positions, a cell of another row that reaches in included (FR-018)', () => {
      const where = placed(SC1, 'r1c2');
      const headers = acted(where, HEADER_PLANS.toggleHeaderRow);
      expect(kindChanges(where.table, headers.after)).toEqual(ids(where.table, 'r1c2', 'r1c3'));
      expect(headers.edit.focus).toEqual(caretAt(0, 1));
      const normal = acted(placed(headers.after, 'r1c2'), HEADER_PLANS.toggleHeaderRow);
      expect(kindChanges(headers.after, normal.after)).toEqual(
        ids(where.table, 'r1c1', 'r1c2', 'r1c3'),
      );
      // [a rowspan 2, b] / [c], the caret in c: row 2 converts a and c.
      const tall = placed([[{ text: 'a', rowspan: 2 }, 'b'], ['c']], 'c');
      const rowed = acted(tall, HEADER_PLANS.toggleHeaderRow);
      expect(kindChanges(tall.table, rowed.after)).toEqual(ids(tall.table, 'a', 'c'));
      expect(show(rowed.after)).toBe('[<th>a rowspan=2, b] / [<th>c]');
      // When all of them were header cells, all become normal cells.
      const back = acted(placed(rowed.after, 'c'), HEADER_PLANS.toggleHeaderRow);
      expect(show(back.after)).toBe('[a rowspan=2, b] / [c]');
    });

    it('sc.3: Toggle header column converts a merged cell once, for either of its columns, and skips holes', () => {
      for (const at of ['y', 'z']) {
        const where = placed(WIDE, at);
        const { after } = acted(where, HEADER_PLANS.toggleHeaderColumn);
        expect(kindChanges(where.table, after), at).toEqual(ids(where.table, 'w', at));
      }
      // US6 sc.3, the caret in r1c1: column 1 is r1c1 (a th), s and r3c1 - s, over columns 1
      // and 2, converted once.
      const where = placed(SC1, 'r1c1');
      const { after } = acted(where, HEADER_PLANS.toggleHeaderColumn);
      expect(kindChanges(where.table, after)).toEqual(ids(where.table, 's', 'r3c1'));
      expect(show(after)).toBe(
        `[<th>r1c1, r1c2, r1c3] / [<th>${S_SHOWN}, r2c3] / [<th>r3c1, r3c2, r3c3]`,
      );
      // A short row: column 3 of [a, b, c] / [d] is c alone.
      const short = placed([['a', 'b', 'c'], ['d']], 'c');
      expect(kindChanges(short.table, acted(short, HEADER_PLANS.toggleHeaderColumn).after)).toEqual(
        ids(short.table, 'c'),
      );
    });

    it('C14 (FR-018 as confirmed by analyze decision 3): with the caret in a merged cell, its top row and its left column; with a block, every row or column of it, all of whose cells change together', () => {
      const inM = placed(TALL, 'm');
      expect(kindChanges(inM.table, acted(inM, HEADER_PLANS.toggleHeaderRow).after)).toEqual(
        ids(inM.table, 'm', 'r2c2', 'r2c3'),
      );
      const inW = placed(WIDE, 'w');
      expect(kindChanges(inW.table, acted(inW, HEADER_PLANS.toggleHeaderColumn).after)).toEqual(
        ids(inW.table, 'w', 'y'),
      );
      // A block over rows 2-3 and columns 2-3.
      const block = placed(TALL, ['r2c2', 'r3c3']);
      const rows = acted(block, HEADER_PLANS.toggleHeaderRow);
      expect(kindChanges(block.table, rows.after)).toEqual(
        ids(block.table, 'm', 'r2c2', 'r2c3', 'r3c2', 'r3c3'),
      );
      expect(rows.edit.focus).toEqual(blockOver(block.address.rect!));
      expect(kindChanges(block.table, acted(block, HEADER_PLANS.toggleHeaderColumn).after)).toEqual(
        ids(block.table, 'r1c2', 'r1c3', 'r2c2', 'r2c3', 'r3c2', 'r3c3'),
      );
      // All of the block's rows header cells: all become normal cells.
      const all = placed(rows.after, ['r2c2', 'r3c3']);
      expect(kindChanges(all.table, acted(all, HEADER_PLANS.toggleHeaderRow).after)).toEqual(
        ids(all.table, 'm', 'r2c2', 'r2c3', 'r3c2', 'r3c3'),
      );
      // One header cell among them is not all: the others become header cells.
      const mixed = placed(
        [
          ['r1c1', 'r1c2', 'r1c3'],
          [{ text: 'm', rowspan: 2 }, { type: 'th', text: 'r2c2' }, 'r2c3'],
          ['r3c2', 'r3c3'],
        ],
        ['r2c2', 'r3c3'],
      );
      expect(kindChanges(mixed.table, acted(mixed, HEADER_PLANS.toggleHeaderRow).after)).toEqual(
        ids(mixed.table, 'm', 'r2c3', 'r3c2', 'r3c3'),
      );
    });
  });

  it('C67: planSetKind with the assistant’s lines - whole rows or columns, never extended, each cell once - and with a rectangle, as US11’s setKind calls it', () => {
    const run = (
      node: PMNode,
      address: Omit<TableAddress, 'table' | 'grid'>,
      kind: 'td' | 'th',
    ) => {
      const edit = planSetKind(
        { table: node, grid: gridOfNode(node), ...address },
        { kind },
        ctx(),
      );
      if (isRefusal(edit)) throw new Error(`refused: ${edit.refused}`);
      const after = applyTableEdit(node, edit);
      assertTableValid(node, after);
      return after;
    };
    const wide = nodeFromModel(modelTable(WIDE))!;
    // Column 2: w, which also covers column 1 - the lines are not extended to it, so y stays -,
    // and z.
    const column = run(wide, { lines: { axis: 'column', from: 1, to: 2 } }, 'th');
    expect(kindChanges(wide, column)).toEqual(ids(wide, 'w', 'z'));
    expect(kindChanges(wide, run(wide, { lines: { axis: 'row', from: 1, to: 2 } }, 'th'))).toEqual(
      ids(wide, 'y', 'z', 'q'),
    );
    expect(
      kindChanges(wide, run(wide, { lines: { axis: 'column', from: 0, to: 3 } }, 'th')),
    ).toEqual(ids(wide, 'w', 'x', 'y', 'z', 'q'));
    // Back: the header cells of column 2 become normal cells.
    expect(
      kindChanges(column, run(column, { lines: { axis: 'column', from: 1, to: 2 } }, 'td')),
    ).toEqual(ids(wide, 'w', 'z'));
    // Row 3 of TALL holds m, which starts in row 2.
    const tall = nodeFromModel(modelTable(TALL))!;
    expect(kindChanges(tall, run(tall, { lines: { axis: 'row', from: 2, to: 3 } }, 'th'))).toEqual(
      ids(tall, 'm', 'r3c2', 'r3c3'),
    );
    // A rectangle: the owners of its positions, as given.
    expect(
      kindChanges(wide, run(wide, { rect: { top: 0, left: 1, bottom: 2, right: 2 } }, 'th')),
    ).toEqual(ids(wide, 'w', 'z'));
    // Lines that are no range of the grid address nothing.
    const outside = planSetKind(
      { table: wide, grid: gridOfNode(wide), lines: { axis: 'row', from: 1, to: 5 } },
      { kind: 'th' },
      ctx(),
    );
    if (isRefusal(outside)) throw new Error(`refused: ${outside.refused}`);
    outside.rows.forEach((row, index) => expect(row).toBe(wide.child(index)));
  });

  it('FR-035: on every irregular case of grid-vectors.json - a caret in every cell and a block - only kinds change and the summary stays deep-equal', () => {
    const vectors = JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
      cases: VectorCase[];
    };
    const irregular = vectors.cases.filter((one) => !one.expect.regular);
    expect(irregular.length).toBeGreaterThan(10);
    let edits = 0;
    let changed = 0;
    for (const one of irregular) {
      const node = vectorTable(one.table);
      const doc = docOf(p('before', 'p1'), node, p('after', 'p2'));
      const tablePos = 1 + 1 + doc.child(0).child(0).child(0).nodeSize;
      const cellPositions: number[] = [];
      doc.nodeAt(tablePos)!.descendants((child, at) => {
        if (child.type.name === 'td' || child.type.name === 'th')
          cellPositions.push(tablePos + 1 + at);
        return child.type.name === 'table' || child.type.name === 'tr';
      });
      const selections = [
        ...cellPositions.map((at) => TextSelection.create(doc, at + 1)),
        ...(cellPositions.length > 1
          ? [CellBlockSelection.create(doc, cellPositions[0]!, cellPositions.at(-1)!)]
          : []),
      ];
      for (const selection of selections) {
        const address = tableTarget(EditorState.create({ doc, selection }))!.address;
        const summary = gridOfNode(address.table).summary;
        for (const [name, plan] of Object.entries(HEADER_PLANS)) {
          const edit = plan(address, ctx());
          if (isRefusal(edit)) throw new Error(`${one.name}: ${name} refused ${edit.refused}`);
          edits += 1;
          const after = applyTableEdit(address.table, edit);
          expect(
            () => assertTableValid(address.table, after, edit.allowedIds),
            `${one.name}: ${name}`,
          ).not.toThrow();
          expect(gridOfNode(after).summary, `${one.name}: ${name}`).toEqual(summary);
          changed += kindChanges(address.table, after).length;
        }
      }
    }
    expect(edits).toBeGreaterThan(100);
    expect(changed).toBeGreaterThan(100);
  });

  it('data-model §2.5: above MAX_GRID_POSITIONS the three cell commands act on the caret’s cell without the owner map; the two toggles, and lines or a rectangle, refuse with too-large', () => {
    const where = big(1);
    const { grid } = where.address;
    expect(grid.tooLarge).toBe(true);
    expect(grid.height * grid.width).toBeGreaterThan(MAX_GRID_POSITIONS);
    const owner = vi.spyOn(grid, 'owner');
    const cellsIn = vi.spyOn(grid, 'cellsIn');
    const extend = vi.spyOn(grid, 'extend');
    try {
      const toggled = acted(where, HEADER_PLANS.toggleHeaderCell);
      expect(kindChanges(where.table, toggled.after)).toEqual(ids(where.table, 'w1'));
      expect(toggled.edit.focus).toEqual(caretAt(0, 1000));
      const made = acted(where, HEADER_PLANS.makeHeaderCells);
      expect(kindChanges(where.table, made.after)).toEqual(ids(where.table, 'w1'));
      const normal = HEADER_PLANS.makeNormalCells(where.address, ctx());
      if (isRefusal(normal)) throw new Error(`refused: ${normal.refused}`);
      normal.rows.forEach((row, index) => expect(row).toBe(where.table.child(index)));
      expect(owner).not.toHaveBeenCalled();
      expect(cellsIn).not.toHaveBeenCalled();
      expect(extend).not.toHaveBeenCalled();
      // The commit puts the caret back into w1, at its offset.
      const selection = committed(where, toggled.edit);
      expect(selection.$head.parent.attrs.nodeId).toBe(ids(where.table, 'w1')[0]);
      expect(selection.$head.parentOffset).toBe(1);
    } finally {
      owner.mockRestore();
      cellsIn.mockRestore();
      extend.mockRestore();
    }
    for (const axis of ['row', 'column'] as const) {
      expect(planToggleHeaderLines(where.address, { axis }, ctx())).toEqual({
        refused: 'too-large',
      });
    }
    expect(
      planSetKind(
        { table: where.table, grid, lines: { axis: 'row', from: 0, to: 1 } },
        { kind: 'th' },
        ctx(),
      ),
    ).toEqual({ refused: 'too-large' });
    expect(
      planSetKind(
        { table: where.table, grid, rect: { top: 0, left: 0, bottom: 1, right: 2000 } },
        { kind: 'th' },
        ctx(),
      ),
    ).toEqual({ refused: 'too-large' });
  });
});

/* ------------------------------------------------------------------------ */
/* US7: attribute plans (T116)                                              */
/* ------------------------------------------------------------------------ */

describe('US7 attribute plans', () => {
  const XML_LANG = '{http://www.w3.org/XML/1998/namespace}lang';
  const ctx = (bookIds: Iterable<string> = []): PlanContext => ({
    nextId: idGenerator('a'),
    bookIds: new Set(bookIds),
  });

  /** The 4 × 3 table of the user story 7 subsection of `tables.fb2` (T014). */
  const FOUR: MRow[] = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => `r${r + 1}c${c + 1}`),
  );
  /** The six cells of the block from r1c1 to r3c2 (US7 sc.1). */
  const SIX = ['r1c1', 'r1c2', 'r2c1', 'r2c2', 'r3c1', 'r3c2'];
  /** `[w colspan 2, x] / [y, z, q] / [a, b, c]`. */
  const WIDE3: MRow[] = [
    [{ text: 'w', colspan: 2 }, 'x'],
    ['y', 'z', 'q'],
    ['a', 'b', 'c'],
  ];
  /** A cell `m` over rows 2 and 3. */
  const TALL: MRow[] = [
    ['r1c1', 'r1c2', 'r1c3'],
    [{ text: 'm', rowspan: 2 }, 'r2c2', 'r2c3'],
    ['r3c2', 'r3c3'],
  ];

  /** The plan's edit (a refusal throws) and its table, which passes `assertTableValid`. */
  function edited(where: Placed, result: TableEdit | Refusal): { edit: TableEdit; after: PMNode } {
    if (isRefusal(result)) throw new Error(`refused: ${JSON.stringify(result)}`);
    const after = applyTableEdit(where.table, result);
    assertTableValid(where.table, after, result.allowedIds, result.pastedIrregular);
    return { edit: result, after };
  }

  /**
   * Checks that `after` differs from `before` in attributes only - every child in its place;
   * a changed cell of the same kind, with its node id, the same content fragment (`===`) and
   * its marks; a changed row with its node id and, when only its `align` changed, the same
   * content fragment (its cells reused); every other row and cell reused (`===`) - and returns
   * the texts of the cells whose attributes changed, in reading order, and the indices of the
   * rows whose own attributes changed.
   */
  function attrChanges(before: PMNode, after: PMNode): { cells: string[]; rows: number[] } {
    expect(after.childCount).toBe(before.childCount);
    const cells: string[] = [];
    const rows: number[] = [];
    before.forEach((row, _offset, index) => {
      const next = after.child(index);
      if (row.type.name !== 'tr') {
        expect(next).toBe(row);
        return;
      }
      expect(next.type).toBe(row.type);
      expect(next.attrs.nodeId).toBe(row.attrs.nodeId);
      expect(next.childCount).toBe(row.childCount);
      const rowAttrsChanged = JSON.stringify(next.attrs) !== JSON.stringify(row.attrs);
      if (rowAttrsChanged) {
        rows.push(index);
        expect(next.content).toBe(row.content);
        return;
      }
      let changed = false;
      row.forEach((cell, _at, cellIndex) => {
        const now = next.child(cellIndex);
        if (now === cell) return;
        expect(cell.type.name === 'td' || cell.type.name === 'th').toBe(true);
        expect(now.type).toBe(cell.type);
        expect(now.attrs.nodeId).toBe(cell.attrs.nodeId);
        expect(now.content).toBe(cell.content);
        expect(now.marks).toEqual(cell.marks);
        expect(JSON.stringify(now.attrs)).not.toBe(JSON.stringify(cell.attrs));
        changed = true;
        cells.push(cell.textContent);
      });
      if (!changed) expect(next).toBe(row);
    });
    return { cells, rows };
  }

  /** The set attributes of the cell whose text is `text`, `nodeId` aside. */
  function cellAttrs(node: PMNode, text: string): Record<string, unknown> {
    for (const row of childrenOf(node)) {
      for (const cell of childrenOf(row)) {
        if (cell.textContent === text) return setAttrs(cell);
      }
    }
    throw new Error(`no cell "${text}"`);
  }

  /** The selection a commit of `edit` leaves on `where`'s state. */
  function committed(where: Placed, edit: TableEdit) {
    const tr = commitTableEdit(where.state.tr, tableTarget(where.state)!.tablePos, edit);
    expect(tr).not.toBeNull();
    return tr!.selection;
  }

  /** `where`'s table addressed by the assistant's whole `lines` only. */
  function byLines(node: PMNode, lines: TableAddress['lines']): Placed {
    const where = placed(node, childrenOf(childrenOf(node)[0]!)[0]!.textContent);
    return { ...where, address: { table: node, grid: gridOfNode(node), lines } };
  }

  /** One row of 4195 cells of colspan 1000 - above MAX_GRID_POSITIONS -, the caret in `w1`. */
  function big(offset = 0): Placed {
    const cells = Array.from({ length: 4195 }, (_, index) => ({
      text: `w${index}`,
      colspan: 1000,
    }));
    return placed([cells], 'w1', { offset });
  }

  it('sc.1: Cell align, Cell valign, Cell style and Cell language reach every cell of a block, each cell once; the rows and the other cells stay', () => {
    const where = placed(FOUR, ['r1c1', 'r3c2']);
    for (const values of [
      { align: 'center' },
      { valign: 'middle' },
      { style: 'wide' },
      { lang: 'de' },
    ] as const) {
      const { edit, after } = edited(where, planCellAttrs(where.address, values, ctx()));
      const [[name, value]] = Object.entries(values) as [[string, string]];
      expect(attrChanges(where.table, after), name).toEqual({ cells: SIX, rows: [] });
      for (const text of SIX) expect(cellAttrs(after, text)[name], text).toBe(value);
      expect(cellAttrs(after, 'r1c3')).toEqual({});
      expect(edit.tableAttrs).toBeUndefined();
      expect(edit.removedIds).toEqual([]);
      expect(edit.allowedIds ?? []).toEqual([]);
      // The block stays selected.
      expect(edit.focus).toEqual(blockOver(where.address.rect!));
      expect(committed(where, edit)).toBeInstanceOf(CellBlockSelection);
    }
    // All four in one plan.
    const { after } = edited(
      where,
      planCellAttrs(
        where.address,
        { align: 'center', valign: 'middle', style: 'wide', lang: 'de' },
        ctx(),
      ),
    );
    const set = 'align=center valign=middle lang=de style=wide';
    expect(show(after)).toBe(
      `[r1c1 ${set}, r1c2 ${set}, r1c3] / [r2c1 ${set}, r2c2 ${set}, r2c3] / ` +
        `[r3c1 ${set}, r3c2 ${set}, r3c3] / [r4c1, r4c2, r4c3]`,
    );
  });

  it('C14, C67: a block’s rectangle is extended already, a merged cell counts once; a caret’s cell alone; the assistant’s whole rows or columns, never extended', () => {
    // A block from x to z covers w's second column: extended to w, so rows 1-2 entirely.
    const block = placed(WIDE3, ['x', 'z']);
    const extended = edited(block, planCellAttrs(block.address, { align: 'right' }, ctx()));
    expect(attrChanges(block.table, extended.after).cells).toEqual(['w', 'x', 'y', 'z', 'q']);
    // A caret: its cell alone, which keeps the caret's offset (the same content fragment).
    const caret = placed(FOUR, 'r2c2', { offset: 2 });
    const one = edited(caret, planCellAttrs(caret.address, { valign: 'bottom' }, ctx()));
    expect(attrChanges(caret.table, one.after).cells).toEqual(['r2c2']);
    expect(one.edit.focus).toEqual(caretAt(1, 1));
    const selection = committed(caret, one.edit);
    expect(selection.empty).toBe(true);
    expect(selection.$head.parent.attrs.nodeId).toBe(
      cellAtTopLeft(caret.address.grid, caret.table, { row: 1, col: 1 })!.node.attrs.nodeId,
    );
    expect(selection.$head.parentOffset).toBe(2);
    // Lines: the owners of column 2 are w and z - w is not extended to column 1, so y stays -;
    // of row 2, y, z and q; of rows 2-3 of TALL, m once with its rows' cells.
    const wide = nodeFromModel(modelTable(WIDE3))!;
    const column = byLines(wide, { axis: 'column', from: 1, to: 2 });
    expect(
      attrChanges(wide, edited(column, planCellAttrs(column.address, { lang: 'uk' }, ctx())).after)
        .cells,
    ).toEqual(['w', 'z', 'b']);
    const row = byLines(wide, { axis: 'row', from: 1, to: 2 });
    expect(
      attrChanges(wide, edited(row, planCellAttrs(row.address, { style: 's' }, ctx())).after).cells,
    ).toEqual(['y', 'z', 'q']);
    const tall = nodeFromModel(modelTable(TALL))!;
    const rows = byLines(tall, { axis: 'row', from: 2, to: 3 });
    expect(
      attrChanges(tall, edited(rows, planCellAttrs(rows.address, { align: 'left' }, ctx())).after)
        .cells,
    ).toEqual(['m', 'r3c2', 'r3c3']);
    // Lines that are no range of the grid address nothing.
    const outside = byLines(wide, { axis: 'row', from: 2, to: 9 });
    const none = planCellAttrs(outside.address, { align: 'left' }, ctx());
    if (isRefusal(none)) throw new Error(`refused: ${none.refused}`);
    none.rows.forEach((child, index) => expect(child).toBe(wide.child(index)));
  });

  it('sc.2: Cell ID goes to the head cell only - the cell that holds $head -, beside the block-wide values; the edit allows that id', () => {
    const down = placed(FOUR, ['r1c1', 'r3c2']);
    const named = edited(down, planCellAttrs(down.address, { id: 'c32' }, ctx()));
    expect(attrChanges(down.table, named.after).cells).toEqual(['r3c2']);
    expect(cellAttrs(named.after, 'r3c2')).toEqual({ id: 'c32' });
    expect(named.edit.allowedIds).toEqual(['c32']);
    expect(() => assertTableValid(down.table, named.after)).toThrow(/c32 is new/);
    // Dragged upwards, the head is r1c1.
    const up = placed(FOUR, ['r3c2', 'r1c1']);
    const upNamed = edited(up, planCellAttrs(up.address, { id: 'c11' }, ctx()));
    expect(attrChanges(up.table, upNamed.after).cells).toEqual(['r1c1']);
    // A caret: its cell.
    const caret = placed(FOUR, 'r4c3');
    expect(
      attrChanges(
        caret.table,
        edited(caret, planCellAttrs(caret.address, { id: 'x' }, ctx())).after,
      ).cells,
    ).toEqual(['r4c3']);
    // An id with a block-wide value: the id on the head cell, the value on the block.
    const both = edited(down, planCellAttrs(down.address, { id: 'h', align: 'left' }, ctx()));
    expect(attrChanges(down.table, both.after).cells).toEqual(SIX);
    expect(cellAttrs(both.after, 'r3c2')).toEqual({ id: 'h', align: 'left' });
    expect(cellAttrs(both.after, 'r1c1')).toEqual({ align: 'left' });
  });

  it('values are trimmed and an empty value removes the attribute from every target; a target without it stays the same node', () => {
    const rows: MRow[] = [
      [
        { text: 'a', id: 'i1', style: 's', align: 'left', valign: 'top', lang: 'de' },
        { text: 'b', align: 'left' },
      ],
      ['c', 'd'],
    ];
    const block = placed(rows, ['a', 'b']);
    const right = edited(block, planCellAttrs(block.address, { align: '  right ' }, ctx()));
    expect(cellAttrs(right.after, 'a').align).toBe('right');
    expect(cellAttrs(right.after, 'b')).toEqual({ align: 'right' });
    const unstyled = edited(block, planCellAttrs(block.address, { style: '   ' }, ctx()));
    expect(attrChanges(block.table, unstyled.after).cells).toEqual(['a']);
    expect(cellAttrs(unstyled.after, 'a').style).toBeUndefined();
    const unaligned = edited(block, planCellAttrs(block.address, { align: '' }, ctx()));
    expect(attrChanges(block.table, unaligned.after).cells).toEqual(['a', 'b']);
    expect(cellAttrs(unaligned.after, 'b')).toEqual({});
    const caret = placed(rows, 'a');
    const french = edited(caret, planCellAttrs(caret.address, { lang: ' fr ' }, ctx()));
    expect(cellAttrs(french.after, 'a').lang).toBe('fr');
    const unnamed = edited(caret, planCellAttrs(caret.address, { id: '' }, ctx()));
    expect(cellAttrs(unnamed.after, 'a')).toEqual({
      style: 's',
      align: 'left',
      valign: 'top',
      lang: 'de',
    });
    expect(unnamed.edit.allowedIds ?? []).toEqual([]);
    const valigned = edited(caret, planCellAttrs(caret.address, { valign: null }, ctx()));
    expect(cellAttrs(valigned.after, 'a').valign).toBeUndefined();
    // Only the enumerations: anything else is a caller's error.
    expect(() => planCellAttrs(caret.address, { align: 'middle' }, ctx())).toThrow(RangeError);
    expect(() => planCellAttrs(caret.address, { valign: 'center' }, ctx())).toThrow(RangeError);
  });

  it('refusals: invalid-lang, invalid-id and duplicate-id - also for an id that only the whole book’s annotation or history holds -, while the target’s own id is accepted; a refusal changes nothing', () => {
    const rows: MRow[] = [
      [{ text: 'a', id: 'own' }, { text: 'b', id: 'other' }, 'c'],
      ['d', 'e', 'f'],
    ];
    const node = nodeFromModel(modelTable(rows, { id: 'tid' }))!;
    const before = JSON.stringify(nodeToModel(node));
    const caret = placed(node, 'a');
    expect(planCellAttrs(caret.address, { lang: 'de_DE' }, ctx())).toEqual({
      refused: 'invalid-lang',
      params: { value: 'de_DE' },
    });
    expect(planCellAttrs(caret.address, { lang: ' de_DE ' }, ctx())).toEqual({
      refused: 'invalid-lang',
      params: { value: 'de_DE' },
    });
    for (const id of ['1t', 'a b', 'a:b', ' -x ']) {
      expect(planCellAttrs(caret.address, { id }, ctx()), id).toEqual({ refused: 'invalid-id' });
      expect(planTableAttrs(caret.address, { id }, ctx()), id).toEqual({ refused: 'invalid-id' });
    }
    // An id of the book (here the context's), or of another element of the same table.
    expect(planCellAttrs(caret.address, { id: 'elsewhere' }, ctx(['elsewhere']))).toEqual({
      refused: 'duplicate-id',
      params: { id: 'elsewhere' },
    });
    expect(planCellAttrs(caret.address, { id: 'other' }, ctx())).toEqual({
      refused: 'duplicate-id',
      params: { id: 'other' },
    });
    expect(planCellAttrs(caret.address, { id: 'tid' }, ctx())).toEqual({
      refused: 'duplicate-id',
      params: { id: 'tid' },
    });
    expect(planTableAttrs(caret.address, { id: 'own' }, ctx(['own']))).toEqual({
      refused: 'duplicate-id',
      params: { id: 'own' },
    });
    // The whole book's ids (collectBookIds): its annotation's and its history's.
    const annotation = (nodeId: string, id: string) =>
      ({
        type: 'annotation',
        attrs: { nodeId },
        content: [
          {
            type: 'p',
            attrs: { nodeId: `${nodeId}-p`, id },
            content: [{ type: 'text', text: 'x' }],
          },
        ],
      }) as AnnotationNode;
    const book = fakeDocument();
    book.description.titleInfo.annotation = annotation('ann', 'in-annotation');
    book.description.documentInfo.history = annotation('hist', 'in-history');
    const bookIds = collectBookIds(book);
    for (const id of ['in-annotation', 'in-history']) {
      expect(planCellAttrs(caret.address, { id }, { nextId: idGenerator(), bookIds }), id).toEqual({
        refused: 'duplicate-id',
        params: { id },
      });
    }
    // The target's own id, even where the book lists it, is no duplicate: nothing changes.
    for (const result of [
      planCellAttrs(caret.address, { id: 'own' }, ctx(['own', 'other', 'tid'])),
      planCellAttrs(caret.address, { id: ' own ' }, ctx(['own'])),
      planTableAttrs(caret.address, { id: 'tid' }, ctx(['own', 'other', 'tid'])),
    ]) {
      if (isRefusal(result)) throw new Error(`refused: ${result.refused}`);
      result.rows.forEach((child, index) => expect(child).toBe(node.child(index)));
      expect(result.tableAttrs).toBeUndefined();
    }
    // A free id is accepted.
    const free = edited(caret, planCellAttrs(caret.address, { id: 'free' }, ctx(['own'])));
    expect(cellAttrs(free.after, 'a').id).toBe('free');
    expect(free.edit.allowedIds).toEqual(['free']);
    // Every refusal left the table as it was.
    expect(JSON.stringify(nodeToModel(node))).toBe(before);
  });

  it('FR-045: a value equal to the current one in every target - rows all ===, no tableAttrs, commitTableEdit null, no undo step', () => {
    const rows: MRow[] = [
      {
        align: 'right',
        cells: [
          { text: 'a', align: 'center', lang: 'de' },
          { text: 'b', align: 'center' },
        ],
      },
      ['c', 'd'],
    ];
    const node = nodeFromModel(modelTable(rows, { id: 't', style: 'grid' }))!;
    const block = placed(node, ['a', 'b']);
    const caret = placed(node, 'a');
    const cases: [Placed, Plan][] = [
      [block, (a, c) => planCellAttrs(a, { align: 'center' }, c)],
      [block, (a, c) => planCellAttrs(a, { style: '' }, c)],
      [caret, (a, c) => planCellAttrs(a, { lang: 'de' }, c)],
      [caret, (a, c) => planCellAttrs(a, { id: '' }, c)],
      [block, (a, c) => planRowAlign(a, { align: 'right' }, c)],
      [caret, (a, c) => planRowAlign(a, { align: ' right ' }, c)],
      [caret, (a, c) => planTableAttrs(a, { id: 't', style: 'grid' }, c)],
    ];
    for (const [where, plan] of cases) {
      const edit = plan(where.address, ctx(['t']));
      if (isRefusal(edit)) throw new Error(`refused: ${edit.refused}`);
      expect(edit.rows).toHaveLength(node.childCount);
      edit.rows.forEach((child, index) => expect(child).toBe(node.child(index)));
      expect(edit.tableAttrs).toBeUndefined();
      expect(commitTableEdit(where.state.tr, tableTarget(where.state)!.tablePos, edit)).toBeNull();
      const state = EditorState.create({
        doc: where.state.doc,
        selection: where.state.selection,
        plugins: [history()],
      });
      const dispatch = vi.fn();
      expect(planCommand(plan, ctx(['t']))(state, dispatch)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    }
    // A change records one undo step.
    let state = EditorState.create({
      doc: block.state.doc,
      selection: block.state.selection,
      plugins: [history()],
    });
    const ran = planCommand((a, c) => planCellAttrs(a, { align: 'left' }, c), ctx())(
      state,
      (tr) => {
        state = state.apply(tr);
      },
    );
    expect(ran).toBe(true);
    expect(undoDepth(state)).toBe(1);
  });

  it('planRowAlign: every row of the block, the caret cell’s row, or the assistant’s rows; each row keeps its cells by identity', () => {
    const block = placed(FOUR, ['r1c1', 'r3c2']);
    const right = edited(block, planRowAlign(block.address, { align: 'right' }, ctx()));
    expect(attrChanges(block.table, right.after)).toEqual({ cells: [], rows: [0, 1, 2] });
    expect(show(right.after)).toBe(
      '{right}[r1c1, r1c2, r1c3] / {right}[r2c1, r2c2, r2c3] / {right}[r3c1, r3c2, r3c3] / ' +
        '[r4c1, r4c2, r4c3]',
    );
    expect(right.edit.focus).toEqual(blockOver(block.address.rect!));
    expect(right.edit.tableAttrs).toBeUndefined();
    // The caret in m, over rows 2 and 3: m's own row.
    const inM = placed(TALL, 'm');
    expect(
      attrChanges(
        inM.table,
        edited(inM, planRowAlign(inM.address, { align: 'center' }, ctx())).after,
      ),
    ).toEqual({ cells: [], rows: [1] });
    // The assistant's rows 2-3; column lines address no row.
    const tall = nodeFromModel(modelTable(TALL))!;
    const rows = byLines(tall, { axis: 'row', from: 1, to: 3 });
    expect(
      attrChanges(tall, edited(rows, planRowAlign(rows.address, { align: 'left' }, ctx())).after),
    ).toEqual({ cells: [], rows: [1, 2] });
    const columns = byLines(tall, { axis: 'column', from: 0, to: 1 });
    const none = planRowAlign(columns.address, { align: 'left' }, ctx());
    if (isRefusal(none)) throw new Error(`refused: ${none.refused}`);
    none.rows.forEach((child, index) => expect(child).toBe(tall.child(index)));
    // An empty value removes it; a row without it stays the same node.
    const aligned = nodeFromModel(modelTable([{ align: 'right', cells: ['a'] }, ['b']] as MRow[]))!;
    const both = placed(aligned, ['a', 'b']);
    const cleared = edited(both, planRowAlign(both.address, { align: '' }, ctx()));
    expect(attrChanges(aligned, cleared.after)).toEqual({ cells: [], rows: [0] });
    expect(cleared.after.child(0).attrs.align).toBeNull();
    expect(() => planRowAlign(both.address, { align: 'top' }, ctx())).toThrow(RangeError);
  });

  it('planTableAttrs: id and style through tableAttrs only - every row the same node -, the id checked as for cells against the table’s own id', () => {
    const node = nodeFromModel(modelTable(FOUR))!;
    const caret = placed(node, 'r2c2');
    const { edit, after } = edited(
      caret,
      planTableAttrs(caret.address, { id: ' tab ', style: 'wide' }, ctx(['other'])),
    );
    edit.rows.forEach((child, index) => expect(child).toBe(node.child(index)));
    expect(edit.tableAttrs).toEqual({ ...node.attrs, id: 'tab', style: 'wide' });
    expect(edit.allowedIds).toEqual(['tab']);
    expect(after.attrs.id).toBe('tab');
    expect(edit.focus).toEqual(caretAt(1, 1));
    expect(() => assertTableValid(node, after)).toThrow(/tab is new/);
    // An empty value removes it.
    const named = nodeFromModel(modelTable(FOUR, { id: 'tab', style: 'wide' }))!;
    const inNamed = placed(named, 'r1c1');
    const cleared = edited(inNamed, planTableAttrs(inNamed.address, { style: '' }, ctx(['tab'])));
    expect(cleared.edit.tableAttrs).toEqual({ ...named.attrs, style: null });
    expect(cleared.after.attrs.id).toBe('tab');
    const unnamed = edited(inNamed, planTableAttrs(inNamed.address, { id: '' }, ctx(['tab'])));
    expect(unnamed.after.attrs.id).toBeNull();
    // The table and its block: the block stays.
    const block = placed(named, ['r1c1', 'r2c2']);
    expect(edited(block, planTableAttrs(block.address, { style: 'x' }, ctx())).edit.focus).toEqual(
      blockOver(block.address.rect!),
    );
  });

  it('data-model §2.5: above MAX_GRID_POSITIONS the three plans act on the caret’s cell, its row and the table without the owner map; a block or lines refuse with too-large', () => {
    const where = big(1);
    const { grid } = where.address;
    expect(grid.tooLarge).toBe(true);
    const owner = vi.spyOn(grid, 'owner');
    const cellsIn = vi.spyOn(grid, 'cellsIn');
    const extend = vi.spyOn(grid, 'extend');
    try {
      const cell = edited(
        where,
        planCellAttrs(where.address, { align: 'center', lang: 'de', id: 'w-one' }, ctx()),
      );
      expect(attrChanges(where.table, cell.after).cells).toEqual(['w1']);
      expect(cell.edit.focus).toEqual(caretAt(0, 1000));
      const row = edited(where, planRowAlign(where.address, { align: 'right' }, ctx()));
      expect(attrChanges(where.table, row.after)).toEqual({ cells: [], rows: [0] });
      const tableAttrs = edited(where, planTableAttrs(where.address, { style: 'big' }, ctx()));
      expect(tableAttrs.after.attrs.style).toBe('big');
      expect(owner).not.toHaveBeenCalled();
      expect(cellsIn).not.toHaveBeenCalled();
      expect(extend).not.toHaveBeenCalled();
      // The commit puts the caret back into w1, at its offset.
      const selection = committed(where, cell.edit);
      expect(selection.$head.parent.textContent).toBe('w1');
      expect(selection.$head.parentOffset).toBe(1);
    } finally {
      owner.mockRestore();
      cellsIn.mockRestore();
      extend.mockRestore();
    }
    const lines = { ...where.address, lines: { axis: 'row' as const, from: 0, to: 1 } };
    const rect = { ...where.address, rect: { top: 0, left: 0, bottom: 1, right: 2000 } };
    for (const address of [lines, rect]) {
      expect(planCellAttrs(address, { align: 'left' }, ctx())).toEqual({ refused: 'too-large' });
      expect(planRowAlign(address, { align: 'left' }, ctx())).toEqual({ refused: 'too-large' });
    }
  });

  it('FR-035: on every irregular case of grid-vectors.json - a caret in every cell and a block - only the attributes change and the summary stays deep-equal', () => {
    const vectors = JSON.parse(readFileSync(path.join(VECTORS, 'grid-vectors.json'), 'utf8')) as {
      cases: VectorCase[];
    };
    const irregular = vectors.cases.filter((one) => !one.expect.regular);
    expect(irregular.length).toBeGreaterThan(10);
    const plans: [string, Plan][] = [
      [
        'cells',
        (a, c) =>
          planCellAttrs(a, { align: 'center', valign: 'bottom', style: 's', lang: 'de' }, c),
      ],
      ['id', (a, c) => planCellAttrs(a, { id: 'fresh' }, c)],
      ['row', (a, c) => planRowAlign(a, { align: 'right' }, c)],
      ['table', (a, c) => planTableAttrs(a, { id: 'tfresh', style: 't' }, c)],
    ];
    let edits = 0;
    let changed = 0;
    for (const one of irregular) {
      const node = vectorTable(one.table);
      const doc = docOf(p('before', 'p1'), node, p('after', 'p2'));
      const tablePos = 1 + 1 + doc.child(0).child(0).child(0).nodeSize;
      const cellPositions: number[] = [];
      doc.nodeAt(tablePos)!.descendants((child, at) => {
        if (child.type.name === 'td' || child.type.name === 'th')
          cellPositions.push(tablePos + 1 + at);
        return child.type.name === 'table' || child.type.name === 'tr';
      });
      const selections = [
        ...cellPositions.map((at) => TextSelection.create(doc, at + 1)),
        ...(cellPositions.length > 1
          ? [CellBlockSelection.create(doc, cellPositions[0]!, cellPositions.at(-1)!)]
          : []),
      ];
      for (const selection of selections) {
        const address = tableTarget(EditorState.create({ doc, selection }))!.address;
        const summary = gridOfNode(address.table).summary;
        for (const [name, plan] of plans) {
          const edit = plan(address, ctx());
          if (isRefusal(edit)) throw new Error(`${one.name}: ${name} refused ${edit.refused}`);
          edits += 1;
          const after = applyTableEdit(address.table, edit);
          expect(
            () => assertTableValid(address.table, after, edit.allowedIds),
            `${one.name}: ${name}`,
          ).not.toThrow();
          expect(gridOfNode(after).summary, `${one.name}: ${name}`).toEqual({
            ...summary,
            ...(name === 'table' ? { id: 'tfresh' } : {}),
          });
          const { cells, rows } = attrChanges(address.table, after);
          changed += cells.length + rows.length;
        }
      }
    }
    expect(edits).toBeGreaterThan(100);
    expect(changed).toBeGreaterThan(100);
  });

  it('the language setter: a cell read with xml:lang among its unknown attributes, given fr, keeps no such key; given an empty value, neither lang nor the key', () => {
    const rows: MRow[] = [
      [
        { text: 'a', unknownAttrs: { [XML_LANG]: 'de' } },
        { text: 'b', unknownAttrs: { [XML_LANG]: 'la', class: 'k' } },
      ],
    ];
    const node = nodeFromModel(modelTable(rows))!;
    expect(node.child(0).child(0).attrs.extraAttrs).toEqual({ unknownAttrs: { [XML_LANG]: 'de' } });
    const inA = placed(node, 'a');
    const french = edited(inA, planCellAttrs(inA.address, { lang: 'fr' }, ctx()));
    const a = french.after.child(0).child(0);
    expect(a.attrs.lang).toBe('fr');
    expect(a.attrs.extraAttrs).toBeNull();
    expect(nodeToModel(a)).toMatchObject({ attrs: { lang: 'fr' } });
    expect(JSON.stringify(nodeToModel(a))).not.toContain(XML_LANG);
    // An empty value: lang was null already, but the kept key goes - a change of its own.
    const removed = edited(inA, planCellAttrs(inA.address, { lang: '' }, ctx()));
    expect(attrChanges(node, removed.after).cells).toEqual(['a']);
    const bare = removed.after.child(0).child(0);
    expect(bare.attrs.lang).toBeNull();
    expect(bare.attrs.extraAttrs).toBeNull();
    expect(JSON.stringify(nodeToModel(bare))).not.toContain(XML_LANG);
    // Other unknown attributes stay.
    const inB = placed(node, 'b');
    const english = edited(inB, planCellAttrs(inB.address, { lang: 'en' }, ctx()));
    expect(english.after.child(0).child(1).attrs.extraAttrs).toEqual({
      unknownAttrs: { class: 'k' },
    });
  });
});
