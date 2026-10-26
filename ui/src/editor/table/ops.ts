/**
 * The table plans (feature 006; data-model §4.4, §4.5). This module holds the shared rules of
 * §4.4 that every plan builds on; the user stories add their plans here (US1's insertion and
 * Tab row, US2's rows and columns, US4's paste, US5's merge and split, US6's moves, US8's
 * repair, US9's table commands).
 *
 * - **New cells** (FR-008): empty, with the kind, `align`, `valign` and `lang` of the
 *   neighbour - the owner of the reference row's (column's) position at the same column (row),
 *   or the owner on the other side of the line when that position is a hole -, a fresh node id
 *   from the host's generator, and no `id`, `style`, spans or `extraAttrs`; a plain `td`
 *   without a neighbour. A new row takes its reference row's `align`.
 * - **Focus**: a caret in the cell at a grid position, or a block over a rectangle (§4.3).
 */

import type { Node as PMNode } from 'prosemirror-model';

import { fb2Schema } from '../schema';

import {
  gridCellNode,
  withSpans,
  type GridPos,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
  type TableFocus,
} from './edit';
import type { Rect, TableGrid } from './grid';

/**
 * The neighbour a new cell copies (FR-008): the owner of `reference` - the reference row's
 * (column's) position at the new cell's column (row) -; when that position is a hole, the
 * owner of `other`, on the other side of the line; else none. Callers check `tooLarge` first.
 */
export function neighbourAt(
  grid: TableGrid,
  table: PMNode,
  reference: GridPos,
  other: GridPos,
): PMNode | null {
  for (const position of [reference, other]) {
    const owner = grid.owner(position.row, position.col);
    if (owner >= 0) return gridCellNode(table, grid, owner);
  }
  return null;
}

/**
 * A new, empty cell like `neighbour` (FR-008): its kind, `align`, `valign` and `lang`, a fresh
 * `nodeId` from `ctx.nextId()`, no `id`, `style`, spans or `extraAttrs`; a plain `td` without
 * a neighbour.
 */
export function newCellLike(neighbour: PMNode | null, ctx: PlanContext): PMNode {
  const type = neighbour?.type.name === 'th' ? fb2Schema.nodes.th! : fb2Schema.nodes.td!;
  return type.create({
    nodeId: ctx.nextId(),
    align: neighbour?.attrs.align ?? null,
    valign: neighbour?.attrs.valign ?? null,
    lang: neighbour?.attrs.lang ?? null,
  });
}

/** A new row holding `cells`, with the reference row's `align` and a fresh `nodeId`. */
export function newRowLike(reference: PMNode | null, cells: PMNode[], ctx: PlanContext): PMNode {
  return fb2Schema.nodes.tr!.create(
    { nodeId: ctx.nextId(), align: reference?.attrs.align ?? null },
    cells,
  );
}

/** The focus of a caret in the cell that owns (row, col) of the new table. */
export function caretAt(row: number, col: number): TableFocus {
  return { kind: 'caret', rect: { top: row, left: col, bottom: row + 1, right: col + 1 } };
}

/** The focus of a block over `rect` of the new table. */
export function blockOver(rect: Rect): TableFocus {
  return { kind: 'block', rect: { ...rect } };
}

/* ------------------------------------------------------------------------ */
/* US1: the new table (FR-001, FR-003; data-model §7.2)                     */
/* ------------------------------------------------------------------------ */

/** The dialog's ranges (FR-001): the normal rows, a header row coming on top. */
export const MAX_TABLE_ROWS = 999;
export const MAX_TABLE_COLUMNS = 64;

/**
 * The table of the Table properties dialog (FR-003): with `headerRow` a first row of `columns`
 * `th`, then `rows` rows of `columns` cells, the first a `th` with `headerColumn`, every other a
 * `td`; every node empty and without `id`, `style`, spans, alignment or language, its `nodeId`
 * from `nextId()` (the table, then each row and its cells). A `RangeError` outside 1–999 rows or
 * 1–64 columns.
 */
export function createTable(
  rows: number,
  columns: number,
  headerRow: boolean,
  headerColumn: boolean,
  nextId: () => string,
): PMNode {
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_TABLE_ROWS) {
    throw new RangeError(`createTable: ${rows} rows, not 1 to ${MAX_TABLE_ROWS}`);
  }
  if (!Number.isInteger(columns) || columns < 1 || columns > MAX_TABLE_COLUMNS) {
    throw new RangeError(`createTable: ${columns} columns, not 1 to ${MAX_TABLE_COLUMNS}`);
  }
  const { table, tr, td, th } = fb2Schema.nodes;
  const tableId = nextId();
  const row = (header: boolean) => {
    const rowId = nextId();
    const cells = Array.from({ length: columns }, (_, column) =>
      (header || (headerColumn && column === 0) ? th! : td!).create({ nodeId: nextId() }),
    );
    return tr!.create({ nodeId: rowId }, cells);
  };
  const children: PMNode[] = [];
  if (headerRow) children.push(row(true));
  for (let index = 0; index < rows; index += 1) children.push(row(false));
  return table!.create({ nodeId: tableId }, children);
}

/* ------------------------------------------------------------------------ */
/* US1: the Tab row (FR-005; C15, C33; data-model §4.6)                     */
/* ------------------------------------------------------------------------ */

function childNodes(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => {
    out.push(child);
  });
  return out;
}

/**
 * The row Tab appends in the table's last cell (data-model §4.6 "The Tab row"): one new row
 * after the last row, with its `align`; for each distinct owner of the last grid row, in column
 * order, an empty cell over the owner's columns (its colspan through `withSpans`) with the
 * owner's kind, `align`, `valign` and `lang` (`newCellLike`); a 1 × 1 empty `td` in each hole
 * of the last row; no cell in the columns of a cell whose rowspan reaches past the last row -
 * it crosses the new line and keeps its written value (C15) - unless that leaves the new row
 * without a cell: then those rowspans are first cut to end at the old last row and the new row
 * gets a cell in every column (*Insert row* step 4). `too-large` on a grid too large for the
 * owner map (§2.5). The focus: a caret in the first new cell. Node ids from `ctx.nextId()`.
 */
export function planTabRow(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return { refused: 'too-large' };
  const rows = childNodes(table);
  const unchanged: TableEdit = { rows, focus: caretAt(0, 0), removedIds: [] };
  const height = grid.height;
  const width = grid.width;
  if (height === 0 || width === 0) return unchanged;
  const last = height - 1;
  // The cells that cross the new line, and the columns they cover in the new row.
  const crossing: number[] = [];
  const covered = new Array<boolean>(width).fill(false);
  grid.cells.forEach((cell, index) => {
    if (!cell.pastEnd) return;
    crossing.push(index);
    for (let col = cell.left; col < Math.min(width, cell.left + cell.colspan); col += 1) {
      covered[col] = true;
    }
  });
  const cut = covered.every(Boolean);
  if (cut) covered.fill(false);
  const td = fb2Schema.nodes.td!;
  const cells: PMNode[] = [];
  let firstColumn = -1;
  for (let col = 0; col < width;) {
    if (covered[col]) {
      col += 1;
      continue;
    }
    if (firstColumn < 0) firstColumn = col;
    const owner = grid.owner(last, col);
    if (owner < 0) {
      cells.push(td.create({ nodeId: ctx.nextId() }));
      col += 1;
      continue;
    }
    const cell = grid.cells[owner]!;
    let end = Math.min(width, cell.left + cell.colspan);
    for (let next = col + 1; next < end; next += 1) {
      if (covered[next] || grid.owner(last, next) !== owner) {
        end = next;
        break;
      }
    }
    const fresh = newCellLike(gridCellNode(table, grid, owner), ctx);
    cells.push(end - col >= 2 ? fresh.type.create(withSpans(fresh.attrs, end - col)) : fresh);
    col = end;
  }
  if (cells.length === 0) return unchanged;
  if (cut) {
    // *Insert row* step 4: the rowspans reaching past the last row end at the old last row.
    const changed = new Map<number, PMNode[]>();
    for (const index of crossing) {
      const cell = grid.cells[index]!;
      const rowChild = grid.rowChild[cell.row]!;
      const children = changed.get(rowChild) ?? childNodes(rows[rowChild]!);
      const node = children[cell.index]!;
      children[cell.index] = node.type.create(
        withSpans(node.attrs, undefined, height - cell.row),
        node.content,
        node.marks,
      );
      changed.set(rowChild, children);
    }
    for (const [rowChild, children] of changed) {
      const row = rows[rowChild]!;
      rows[rowChild] = row.type.create(row.attrs, children, row.marks);
    }
  }
  const lastRow = table.child(grid.rowChild[last]!);
  rows.splice(grid.rowChild[last]! + 1, 0, newRowLike(lastRow, cells, ctx));
  return { rows, focus: caretAt(height, firstColumn), removedIds: [] };
}
