/**
 * The table plans of `ops.ts` (feature 006; data-model §4.4 to §4.6), one `describe` block per
 * user story in story order. US1 (T052; FR-003, FR-005; C15, C33; I8): `createTable` - the
 * dialog's table, rectangular and without attributes, its node ids from the host - and
 * `planTabRow`, the row Tab appends in the last cell.
 */

import type { Node as PMNode } from 'prosemirror-model';

import { applyTableEdit, assertTableValid, isRefusal, type TableEdit } from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  caretAt,
  createTable,
  planTabRow,
} from '@/editor/table/ops';

import { childrenOf, idGenerator, table, type RowSpec } from './helpers';

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
