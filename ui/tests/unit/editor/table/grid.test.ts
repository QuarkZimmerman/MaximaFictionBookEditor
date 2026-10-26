/**
 * The table grid (feature 006, T034; contracts/document-model.md §4, normative; data-model
 * §2): effective spans by value, the bounds and `tooLarge`, `extend` and `cellsIn`, `reach`,
 * the child indices of invalid books, the caches, hostile widths, the time on a large table and
 * the worked examples of §4.13.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import {
  cellIndexAt,
  effectiveColspan,
  effectiveRowspan,
  gridCellAt,
  gridOfModel,
  gridOfNode,
  MAX_COLSPAN,
  MAX_GRID_POSITIONS,
  MAX_ROWSPAN,
  rowOfChild,
  type TableGrid,
} from '@/editor/table/grid';
import { fb2Schema } from '@/editor/schema';
import type { TableNode } from '@/model/document';

type CellSpec = { type?: 'td' | 'th'; colspan?: unknown; rowspan?: unknown } | 'raw';
type RowSpec = CellSpec[] | 'raw';

let ids = 0;
const nextId = () => `g${(ids += 1)}`;

/** A model table: rows of cells, `'raw'` for a raw-xml child of the table or of a row. */
function modelTable(rows: RowSpec[], attrs: Record<string, unknown> = {}): TableNode {
  const raw = () => ({ type: 'raw-xml', attrs: { nodeId: nextId(), xml: '<x/>', inline: false } });
  return {
    type: 'table',
    attrs: { nodeId: nextId(), ...attrs },
    content: rows.map((row) =>
      row === 'raw'
        ? raw()
        : {
            type: 'tr',
            attrs: { nodeId: nextId() },
            content: row.map((cell) => {
              if (cell === 'raw') return raw();
              const cellAttrs: Record<string, unknown> = { nodeId: nextId() };
              if (cell.colspan !== undefined) cellAttrs.colspan = cell.colspan;
              if (cell.rowspan !== undefined) cellAttrs.rowspan = cell.rowspan;
              return { type: cell.type ?? 'td', attrs: cellAttrs, content: [] };
            }),
          },
    ),
  } as unknown as TableNode;
}

function pmTable(rows: RowSpec[], attrs: Record<string, unknown> = {}): PMNode {
  return nodeFromModel(modelTable(rows, attrs) as unknown as ModelNodeJson)!;
}

/** Plain cells: `n` cells of colspan 1. */
const cells = (n: number): CellSpec[] => Array.from({ length: n }, () => ({}));

function coveredOf(grid: TableGrid): number[] {
  return Array.from({ length: grid.height }, (_, r) => grid.covered(r));
}

describe('effective spans', () => {
  it('effectiveColspan and effectiveRowspan decide by value: 2 and 2.0 count 2; "2", 2.5, 0, -1, 1e21 and null count 1; 5000 and 70000 are capped', () => {
    for (const span of [effectiveColspan, effectiveRowspan]) {
      expect(span(2)).toBe(2);
      expect(span(2.0)).toBe(2);
      for (const value of ['2', 2.5, 0, -1, 1e21, null, undefined, true, NaN, Infinity, {}]) {
        expect(span(value)).toBe(1);
      }
      // The range of the reader's parse_int: up to 10⁹, a value above it counts 1.
      expect(span(1_000_000_001)).toBe(1);
      expect(span(3_000_000_000)).toBe(1);
    }
    expect(effectiveColspan(5000)).toBe(MAX_COLSPAN);
    expect(effectiveRowspan(5000)).toBe(5000);
    expect(effectiveRowspan(70000)).toBe(MAX_ROWSPAN);
    expect(effectiveColspan(70000)).toBe(MAX_COLSPAN);
    expect(effectiveRowspan(1_000_000_000)).toBe(MAX_ROWSPAN);
  });

  it('never reads a span kept in unknownAttrs', () => {
    const table = {
      type: 'table',
      attrs: { nodeId: 't' },
      content: [
        {
          type: 'tr',
          attrs: { nodeId: 'r' },
          content: [
            { type: 'td', attrs: { nodeId: 'c1', unknownAttrs: { colspan: '3' } }, content: [] },
            { type: 'td', attrs: { nodeId: 'c2' }, content: [] },
          ],
        },
      ],
    } as unknown as TableNode;
    expect(gridOfModel(table).width).toBe(2);
    expect(gridOfNode(nodeFromModel(table as unknown as ModelNodeJson)!).width).toBe(2);
  });
});

describe('bounds', () => {
  it('a table above MAX_GRID_POSITIONS is tooLarge and is still analysed', () => {
    // One row of 4195 cells of colspan 1000: W = 4,195,000 > 2²².
    const table = modelTable([Array.from({ length: 4195 }, () => ({ colspan: 1000 }))]);
    const grid = gridOfModel(table);
    expect(grid.width * grid.height).toBeGreaterThan(MAX_GRID_POSITIONS);
    expect(grid.tooLarge).toBe(true);
    expect(grid.regular).toBe(true);
    expect(grid.summary).toEqual({
      rows: 1,
      columns: 4_195_000,
      shortRows: 0,
      overlaps: 0,
      pastEnd: 0,
    });
    expect(grid.cells).toHaveLength(4195);
    expect(grid.cells[4194]!.left).toBe(4_194_000);
    expect(() => grid.owner(0, 0)).toThrow(RangeError);
    expect(() => grid.extend({ top: 0, left: 0, bottom: 1, right: 1 })).toThrow(RangeError);
    expect(() => grid.cellsIn({ top: 0, left: 0, bottom: 1, right: 1 })).toThrow(RangeError);
  });

  it('a table of exactly MAX_GRID_POSITIONS positions is not too large', () => {
    // 4096 rows of 1024 columns (one cell of colspan 1000 and 24 cells each).
    const row: CellSpec[] = [{ colspan: 1000 }, ...cells(24)];
    const grid = gridOfModel(modelTable(Array.from({ length: 4096 }, () => row)));
    expect(grid.height * grid.width).toBe(MAX_GRID_POSITIONS);
    expect(grid.tooLarge).toBe(false);
    expect(grid.owner(4095, 1023)).toBe(grid.cells.length - 1);
  });

  it('one row of 50 cells of colspan 1000 is regular with W = 50,000', () => {
    const grid = gridOfModel(modelTable([Array.from({ length: 50 }, () => ({ colspan: 1000 }))]));
    expect(grid.width).toBe(50_000);
    expect(grid.covered(0)).toBe(50_000);
    expect(grid.regular).toBe(true);
    expect(grid.tooLarge).toBe(false);
    expect(grid.owner(0, 49_999)).toBe(49);
  });

  it('a rowspan above INT_MAX counts 1, a rowspan of 10⁹ is capped and reaches past the end', () => {
    const above = gridOfModel(modelTable([[{ rowspan: 3_000_000_000 }, {}], cells(2)]));
    expect(above.regular).toBe(true);
    expect(above.cells[0]!.rowspan).toBe(1);
    const huge = gridOfModel(modelTable([[{}, { rowspan: 1_000_000_000 }], [{}]]));
    expect(huge.cells[1]!.rowspan).toBe(MAX_ROWSPAN);
    expect(huge.cells[1]!.rowsIn).toBe(2);
    expect(huge.summary.pastEnd).toBe(1);
  });

  it('a regular 1000 × 20 table is analysed, mapped and extended within a coarse time bound', () => {
    const rows = Array.from({ length: 1000 }, () => cells(20));
    const table = pmTable(rows);
    const start = performance.now();
    const grid = gridOfNode(table);
    expect(grid.regular).toBe(true);
    expect(grid.width).toBe(20);
    expect(grid.owner(999, 19)).toBe(19_999);
    expect(grid.extend({ top: 10, left: 3, bottom: 900, right: 17 })).toEqual({
      top: 10,
      left: 3,
      bottom: 900,
      right: 17,
    });
    expect(grid.cellsIn({ top: 0, left: 0, bottom: 1000, right: 20 })).toHaveLength(20_000);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('hostile tall cells stay within the time bound', () => {
    // A first row of 1000 cells of rowspan 65534 over 2000 rows: every later row's cells start
    // after the tall ones.
    const rows: RowSpec[] = [Array.from({ length: 1000 }, () => ({ rowspan: 65534 }))];
    for (let r = 1; r < 2000; r += 1) rows.push([{}]);
    const start = performance.now();
    const grid = gridOfModel(modelTable(rows));
    expect(grid.width).toBe(1001);
    expect(grid.cells[1000]!.left).toBe(1000);
    expect(grid.summary.pastEnd).toBe(1000);
    // The first row ends before the column the later rows reach: the one short row.
    expect(grid.summary).toMatchObject({ shortRows: 1, row: 1, covered: 1000 });
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('extend, cellsIn, owner and reach', () => {
  // US4 sc.2's shape: the corners' rectangle cuts a merged cell; the extension brings in a
  // second merged cell in the next round.
  //   row 0: a  b  c  d
  //   row 1: e  f  g(colspan 2, rowspan 2)
  //   row 2: h(rowspan 2)  i
  //   row 3: k  l  m
  const shape = () =>
    gridOfModel(
      modelTable([cells(4), [{}, {}, { colspan: 2, rowspan: 2 }], [{ rowspan: 2 }, {}], cells(3)]),
    );

  it('extend grows over a merged cell the corners cut, until it stops changing', () => {
    const grid = shape();
    expect(grid.regular).toBe(true);
    // From a (0, 0) to g's corner (1, 2): g reaches row 2 and column 3; h then reaches row 3.
    expect(grid.extend({ top: 0, left: 0, bottom: 2, right: 3 })).toEqual({
      top: 0,
      left: 0,
      bottom: 4,
      right: 4,
    });
    // A rectangle inside g alone stays g's rectangle; one of plain cells stays as it is.
    expect(grid.extend({ top: 2, left: 3, bottom: 3, right: 4 })).toEqual({
      top: 1,
      left: 2,
      bottom: 3,
      right: 4,
    });
    expect(grid.extend({ top: 0, left: 1, bottom: 2, right: 2 })).toEqual({
      top: 0,
      left: 1,
      bottom: 2,
      right: 2,
    });
  });

  it('cellsIn gives each owner once, in reading order', () => {
    const grid = shape();
    // Cells: a0 b1 c2 d3 / e4 f5 g6 / h7 i8 / k9 l10 m11.
    expect(grid.cellsIn({ top: 1, left: 1, bottom: 3, right: 4 })).toEqual([5, 6, 8]);
    expect(grid.cellsIn({ top: 2, left: 0, bottom: 4, right: 1 })).toEqual([7]);
    expect(grid.cellsIn({ top: 0, left: 0, bottom: 0, right: 4 })).toEqual([]);
    expect(grid.owner(2, 3)).toBe(6);
    expect(grid.owner(3, 0)).toBe(7);
    expect(grid.owner(3, 1)).toBe(9);
    expect(grid.owner(-1, 0)).toBe(-1);
    expect(grid.owner(0, 4)).toBe(-1);
  });

  it('reach is the column of the first hole, covered counts the holes out', () => {
    // [a, b, c rowspan 2] / [d]: a hole at column 1 of row 2 (§4.13).
    const grid = gridOfModel(modelTable([[{}, {}, { rowspan: 2 }], [{}]]));
    expect(grid.reach(0)).toBe(3);
    expect(grid.reach(1)).toBe(1);
    expect(grid.covered(1)).toBe(2);
    expect(grid.owner(1, 1)).toBe(-1);
    expect(grid.owner(1, 2)).toBe(2);
    // An empty row reaches nothing; a row covered from above only reaches as far as that.
    const empty = gridOfModel(modelTable([cells(2), []]));
    expect(empty.reach(1)).toBe(0);
    const above = gridOfModel(modelTable([[{ rowspan: 2 }, {}], []]));
    expect(above.reach(1)).toBe(1);
    expect(above.covered(1)).toBe(1);
  });

  it('rowChild, index and the cell lookup count raw children', () => {
    // Children: tr, raw, tr(td, raw, td), raw.
    const table = pmTable([cells(2), 'raw', [{}, 'raw', {}], 'raw']);
    const grid = gridOfNode(table);
    expect(grid.height).toBe(2);
    expect(grid.rowChild).toEqual([0, 2]);
    expect(grid.rowStart).toEqual([0, 2, 4]);
    expect(grid.cells.map((cell) => [cell.row, cell.index, cell.left])).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 0],
      [1, 2, 1],
    ]);
    expect(grid.regular).toBe(true);
    expect(rowOfChild(grid, 2)).toBe(1);
    expect(rowOfChild(grid, 1)).toBe(-1);
    expect(cellIndexAt(grid, 2, 2)).toBe(3);
    expect(cellIndexAt(grid, 2, 1)).toBe(-1);
    expect(cellIndexAt(grid, 1, 0)).toBe(-1);
    expect(gridCellAt(grid, 0, 1)).toBe(grid.cells[1]);
    expect(gridCellAt(grid, 3, 0)).toBeNull();
    // The model grid counts the same children.
    expect(gridOfModel(modelTable([cells(2), 'raw', [{}, 'raw', {}], 'raw'])).rowChild).toEqual([
      0, 2,
    ]);
  });

  it('a too-large check comes first: callers check tooLarge before owner, extend and cellsIn', () => {
    const grid = shape();
    expect(grid.tooLarge).toBe(false);
    expect(() => grid.owner(0, 0)).not.toThrow();
  });
});

describe('caches', () => {
  it('one grid per node, a new grid for the new node of a keystroke', () => {
    const table = pmTable([cells(2), cells(2)]);
    const other = pmTable([cells(1)]);
    const section = fb2Schema.nodes.section!.create(null, [
      table,
      fb2Schema.nodes.p!.create(),
      other,
    ]);
    const doc = fb2Schema.nodes.doc!.create(null, [fb2Schema.nodes.body!.create(null, section)]);
    const state = EditorState.create({ doc });
    const firstTable = state.doc.child(0).child(0).child(0);
    const grid = gridOfNode(firstTable);
    expect(gridOfNode(firstTable)).toBe(grid);
    // A keystroke in the first cell of the first table.
    const cellStart = 1 + 1 + 1 + 1 + 1; // body, section, table, tr, td
    const typed = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, cellStart)).insertText('x'),
    );
    const newTable = typed.doc.child(0).child(0).child(0);
    expect(newTable).not.toBe(firstTable);
    const newGrid = gridOfNode(newTable);
    expect(newGrid).not.toBe(grid);
    expect(newGrid.summary).toEqual(grid.summary);
    // The untouched table keeps its node and its grid.
    const otherAfter = typed.doc.child(0).child(0).child(2);
    expect(otherAfter).toBe(state.doc.child(0).child(0).child(2));
    expect(gridOfNode(otherAfter)).toBe(gridOfNode(state.doc.child(0).child(0).child(2)));
  });

  it('one grid per model object', () => {
    const table = modelTable([cells(3)]);
    expect(gridOfModel(table)).toBe(gridOfModel(table));
    expect(gridOfModel(modelTable([cells(3)]))).not.toBe(gridOfModel(table));
  });

  it('never throws on hostile model input', () => {
    const inputs = [
      { type: 'table', attrs: { nodeId: 'x' } },
      { type: 'table', attrs: null, content: 'rows' },
      { type: 'table', content: [null, 7, { type: 'tr', content: [null, { type: 'td' }] }] },
      { type: 'table', content: [{ type: 'tr', attrs: 5, content: [{ type: 'th', attrs: 'a' }] }] },
    ];
    for (const input of inputs) {
      expect(() => gridOfModel(input as unknown as TableNode)).not.toThrow();
    }
    expect(gridOfModel(inputs[2] as unknown as TableNode).summary).toEqual({
      rows: 1,
      columns: 1,
      shortRows: 0,
      overlaps: 0,
      pastEnd: 0,
    });
  });
});

describe('the worked examples of document-model §4.13', () => {
  const examples: {
    name: string;
    rows: RowSpec[];
    width: number;
    covered: number[];
    summary: Record<string, number>;
  }[] = [
    {
      name: '[a, b, c] / [d, e] / [f, g, h] (US8 sc.1)',
      rows: [cells(3), cells(2), cells(3)],
      width: 3,
      covered: [3, 2, 3],
      summary: { rows: 3, columns: 3, shortRows: 1, row: 2, covered: 2, overlaps: 0, pastEnd: 0 },
    },
    {
      name: '[a, b rowspan 4] / [c] (US8 sc.2)',
      rows: [[{}, { rowspan: 4 }], [{}]],
      width: 2,
      covered: [2, 2],
      summary: { rows: 2, columns: 2, shortRows: 0, overlaps: 0, pastEnd: 1 },
    },
    {
      name: '[a, b rowspan 2] / [c colspan 2] (US8 sc.3)',
      rows: [[{}, { rowspan: 2 }], [{ colspan: 2 }]],
      width: 2,
      covered: [2, 2],
      summary: { rows: 2, columns: 2, shortRows: 0, overlaps: 1, pastEnd: 0 },
    },
    {
      name: '[a, b rowspan 2, c] / [d colspan 2] / [e, f, g] (US8 sc.9)',
      rows: [[{}, { rowspan: 2 }, {}], [{ colspan: 2 }], cells(3)],
      width: 3,
      covered: [3, 2, 3],
      summary: { rows: 3, columns: 3, shortRows: 1, row: 2, covered: 2, overlaps: 1, pastEnd: 0 },
    },
    {
      name: '[a rowspan 2, b] / [c]',
      rows: [[{ rowspan: 2 }, {}], [{}]],
      width: 2,
      covered: [2, 2],
      summary: { rows: 2, columns: 2, shortRows: 0, overlaps: 0, pastEnd: 0 },
    },
    {
      name: '[a, b, c rowspan 2] / [d]',
      rows: [[{}, {}, { rowspan: 2 }], [{}]],
      width: 3,
      covered: [3, 2],
      summary: { rows: 2, columns: 3, shortRows: 1, row: 2, covered: 2, overlaps: 0, pastEnd: 0 },
    },
    {
      name: '[a rowspan 0, b] / [c, d]',
      rows: [[{ rowspan: 0 }, {}], cells(2)],
      width: 2,
      covered: [2, 2],
      summary: { rows: 2, columns: 2, shortRows: 0, overlaps: 0, pastEnd: 0 },
    },
    {
      name: '[a, b] / [] (an empty tr)',
      rows: [cells(2), []],
      width: 2,
      covered: [2, 0],
      summary: { rows: 2, columns: 2, shortRows: 1, row: 2, covered: 0, overlaps: 0, pastEnd: 0 },
    },
    {
      name: 'one row of 50 cells of colspan 1000',
      rows: [Array.from({ length: 50 }, () => ({ colspan: 1000 }))],
      width: 50_000,
      covered: [50_000],
      summary: { rows: 1, columns: 50_000, shortRows: 0, overlaps: 0, pastEnd: 0 },
    },
  ];

  it.each(examples)('$name', ({ rows, width, covered, summary }) => {
    for (const grid of [gridOfModel(modelTable(rows)), gridOfNode(pmTable(rows))]) {
      expect(grid.width).toBe(width);
      expect(coveredOf(grid)).toEqual(covered);
      expect(grid.summary).toEqual(summary);
      expect(grid.regular).toBe(
        summary.shortRows === 0 && summary.overlaps === 0 && summary.pastEnd === 0,
      );
    }
  });

  it('names the problems of US8 sc.9: row 2 short, d overlapping b', () => {
    const grid = gridOfModel(modelTable([[{}, { rowspan: 2 }, {}], [{ colspan: 2 }], cells(3)]));
    expect(grid.problems).toEqual([
      { kind: 'short-row', row: 1, covered: 2 },
      { kind: 'overlap', cell: 3 },
    ]);
    expect(grid.cells[3]).toMatchObject({ row: 1, left: 0, colspan: 2, overlaps: true });
    const past = gridOfModel(modelTable([[{}, { rowspan: 4 }], [{}]]));
    expect(past.problems).toEqual([{ kind: 'past-end', cell: 1 }]);
    expect(past.cells[1]).toMatchObject({ rowspan: 4, rowsIn: 2, pastEnd: true });
  });

  it('a table without rows is regular with W = 0, and its id joins the summary', () => {
    const grid = gridOfModel(modelTable([], { id: 't1' }));
    expect(grid.regular).toBe(true);
    expect(grid.summary).toEqual({
      rows: 0,
      columns: 0,
      shortRows: 0,
      overlaps: 0,
      pastEnd: 0,
      id: 't1',
    });
    expect(gridOfModel(modelTable([cells(1)], { id: '' })).summary.id).toBeUndefined();
  });
});
