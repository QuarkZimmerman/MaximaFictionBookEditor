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

import { Fragment, type Attrs, type Node as PMNode } from 'prosemirror-model';

import { fb2Schema } from '../schema';

import {
  compactRows,
  gridCellNode,
  indexByLeft,
  isRefusal,
  withSpans,
  type GridPos,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
  type TableFocus,
} from './edit';
import {
  MAX_COLSPAN,
  MAX_ROWSPAN,
  cellRect,
  effectiveColspan,
  type Rect,
  type TableGrid,
} from './grid';

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

/* ------------------------------------------------------------------------ */
/* US2: rows and columns (FR-006 to FR-009, FR-038; data-model §4.5)        */
/* ------------------------------------------------------------------------ */

export type LineAxis = 'row' | 'column';
export type InsertSide = 'above' | 'below' | 'left' | 'right';
export type MoveDirection = 'up' | 'down' | 'left' | 'right';

const OK = { ok: true } as const;
const TOO_LARGE: Refusal = { refused: 'too-large' };

/** A plan's answer that changes nothing: the host then dispatches nothing (data-model §4.3). */
function unchanged(table: PMNode): TableEdit {
  return { rows: childNodes(table), focus: caretAt(0, 0), removedIds: [] };
}

/** The number of rows (`row`) or columns (`column`) of the grid. */
function sizeOf(grid: TableGrid, axis: LineAxis): number {
  return axis === 'row' ? grid.height : grid.width;
}

/** The caret cell's rectangle, or the block's; null without a target. */
function targetRect(address: TableAddress): Rect | null {
  if (address.rect) return address.rect;
  const { grid, caret } = address;
  if (!caret || grid.tooLarge) return null;
  const index = grid.owner(caret.row, caret.col);
  return index < 0 ? null : cellRect(grid.cells[index]!);
}

/** The assistant's whole lines of `axis`, when they are a valid range of the grid (C67). */
function linesOf(address: TableAddress, axis: LineAxis): [number, number] | null {
  const lines = address.lines;
  if (!lines || lines.axis !== axis) return null;
  const size = sizeOf(address.grid, axis);
  const { from, to } = lines;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > size || from >= to) {
    return null;
  }
  return [from, to];
}

export interface InsertionLine {
  /** The new lines go in at this line. */
  line: number;
  /** How many. */
  count: number;
  /** The row (column) whose cells the new ones copy (FR-008). */
  reference: number;
}

/**
 * Where an insertion goes (C14; FR-006's readings, analyze decision 3): at the caret cell's
 * edge - `row` or `row + rowsIn`, `left` or `left + colspan` - with k = 1; at the block's
 * rectangle edge with k its height or width (a block inserts as many lines as it spans, R1.5);
 * or at the assistant's whole `lines`, never extended (C67), with k = `count`. The reference line
 * is L for *above* and *left*, L − 1 for *below* and *right*. Null without a target.
 */
export function insertionLine(
  address: TableAddress,
  axis: LineAxis,
  side: InsertSide,
  count?: number,
): InsertionLine | null {
  const before = side === 'above' || side === 'left';
  let from: number;
  let to: number;
  let k: number;
  const lines = linesOf(address, axis);
  if (lines) {
    [from, to] = lines;
    k = count ?? to - from;
  } else {
    const rect = targetRect(address);
    if (!rect) return null;
    from = axis === 'row' ? rect.top : rect.left;
    to = axis === 'row' ? rect.bottom : rect.right;
    k = count ?? (address.rect ? to - from : 1);
  }
  if (!Number.isInteger(k) || k < 1) return null;
  const line = before ? from : to;
  return { line, count: k, reference: before ? line : line - 1 };
}

/**
 * The rows (columns) `[a, b)` a delete, move or duplicate acts on (C14): the caret cell's top row
 * (left column), the block's rows (columns), or the assistant's `lines`. Null without a target.
 */
export function unitLines(address: TableAddress, axis: LineAxis): [number, number] | null {
  const lines = linesOf(address, axis);
  if (lines) return lines;
  const { rect, caret } = address;
  if (rect) return axis === 'row' ? [rect.top, rect.bottom] : [rect.left, rect.right];
  if (!caret) return null;
  const at = axis === 'row' ? caret.row : caret.col;
  return at < sizeOf(address.grid, axis) ? [at, at + 1] : null;
}

/** For each row line (0 … R) and column line (0 … W): 1 when a cell crosses it (data-model §0). */
export interface CrossedLines {
  rows: Uint8Array;
  columns: Uint8Array;
}

const crossings = new WeakMap<TableGrid, CrossedLines>();

/**
 * The lines the cells cross, cached per grid (C21): row line L when `row < L < row + rowspan`
 * with the rowspan not clipped, so a span past the last row crosses line R (data-model §0, C15);
 * column line L when `left < L < left + colspan`. Built with difference arrays in
 * O(cells + R + W).
 */
export function crossedLines(grid: TableGrid): CrossedLines {
  const cached = crossings.get(grid);
  if (cached) return cached;
  const height = grid.height;
  const width = grid.width;
  const rowDiff = new Int32Array(height + 2);
  const columnDiff = new Int32Array(width + 2);
  for (const cell of grid.cells) {
    if (cell.rowspan >= 2 && cell.row + 1 <= height) {
      rowDiff[cell.row + 1]! += 1;
      rowDiff[Math.min(cell.row + cell.rowspan, height + 1)]! -= 1;
    }
    if (cell.colspan >= 2) {
      columnDiff[cell.left + 1]! += 1;
      columnDiff[cell.left + cell.colspan]! -= 1;
    }
  }
  const lines = (diff: Int32Array, size: number) => {
    const out = new Uint8Array(size + 1);
    let running = 0;
    for (let line = 0; line <= size; line += 1) {
      running += diff[line]!;
      out[line] = running > 0 ? 1 : 0;
    }
    return out;
  };
  const found = { rows: lines(rowDiff, height), columns: lines(columnDiff, width) };
  crossings.set(grid, found);
  return found;
}

/**
 * *Delete row* (*Delete column*) may act (FR-009): `too-large` first, then `only-row`
 * (`only-column`) on a table of one row (column), `all-rows` (`all-columns`) when the target
 * covers every row (column). Reads the cached grid only (C21).
 */
export function checkDelete(address: TableAddress, axis: LineAxis): { ok: true } | Refusal {
  const { grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const size = sizeOf(grid, axis);
  if (size === 1) return { refused: axis === 'row' ? 'only-row' : 'only-column' };
  const unit = unitLines(address, axis);
  if (unit && unit[0] <= 0 && unit[1] >= size) {
    return { refused: axis === 'row' ? 'all-rows' : 'all-columns' };
  }
  return OK;
}

/** A move's unit and the band it changes places with (FR-038; data-model §0). */
export interface MoveBands {
  axis: LineAxis;
  unit: readonly [number, number];
  band: readonly [number, number];
}

/**
 * The geometry of a move (data-model §4.5): `too-large` first; `merged-crosses-border` when a
 * cell crosses line a or line b of the unit `[a, b)`; the band before it, `[a', a)` with a' the
 * largest line below a that no cell crosses, or after it, `[b, b')` with b' the smallest such
 * line above b; `no-neighbour` without one, and for rows `merged-crosses-border` when every
 * line in (b, R] is crossed (a span past the end crosses line R). Null without a target.
 */
export function moveBands(
  address: TableAddress,
  direction: MoveDirection,
): MoveBands | Refusal | null {
  const { grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const axis: LineAxis = direction === 'up' || direction === 'down' ? 'row' : 'column';
  const unit = unitLines(address, axis);
  if (!unit) return null;
  const [a, b] = unit;
  const crossed = axis === 'row' ? crossedLines(grid).rows : crossedLines(grid).columns;
  const size = sizeOf(grid, axis);
  if (crossed[a] || crossed[b]) return { refused: 'merged-crosses-border', params: { axis } };
  if (direction === 'up' || direction === 'left') {
    if (a === 0) return { refused: 'no-neighbour', params: { direction } };
    let start = a - 1;
    while (start > 0 && crossed[start]) start -= 1;
    return { axis, unit: [a, b], band: [start, a] };
  }
  if (b >= size) return { refused: 'no-neighbour', params: { direction } };
  let end = b + 1;
  while (end <= size && crossed[end]) end += 1;
  if (end > size) return { refused: 'merged-crosses-border', params: { axis: 'row' } };
  return { axis, unit: [a, b], band: [b, end] };
}

/** A move may act: `moveBands` without its geometry (C21: the cached grid and crossings). */
export function checkMove(address: TableAddress, direction: MoveDirection): { ok: true } | Refusal {
  const bands = moveBands(address, direction);
  return bands && isRefusal(bands) ? bands : OK;
}

/**
 * The span guard of an insertion or a duplication of k lines at `line` (data-model §2.5):
 * `too-large` on a table too large for the owner map, and when a cell crossing the line would
 * pass `MAX_COLSPAN` or `MAX_ROWSPAN` by growing k - hostile tables only, such as a row of
 * colspan-1000 cells; at the line after the last row the spans past the end do not grow (C15).
 */
export function checkSpanRoom(
  address: TableAddress,
  axis: LineAxis,
  line: number,
  k: number,
): { ok: true } | Refusal {
  const { grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  if (axis === 'row') {
    if (line >= grid.height) return OK;
    for (const cell of grid.cells) {
      if (cell.row < line && line < cell.row + cell.rowspan && cell.rowspan + k > MAX_ROWSPAN) {
        return TOO_LARGE;
      }
    }
    return OK;
  }
  for (const cell of grid.cells) {
    if (cell.left < line && line < cell.left + cell.colspan && cell.colspan + k > MAX_COLSPAN) {
      return TOO_LARGE;
    }
  }
  return OK;
}

/* ------------------------------------------------------------------------ */
/* Building the new child list                                              */
/* ------------------------------------------------------------------------ */

interface RowChange {
  /** Original children replaced (a node) or removed (null), by child index. */
  replace: Map<number, PMNode | null>;
  /** New children before an original child index (the row's child count: at its end). */
  before: Map<number, PMNode[]>;
}

/**
 * The new child list of a table: cells replaced, removed or inserted by their original child
 * indices, rows inserted or removed; untouched rows stay the same objects (data-model §4.2).
 */
class TableBuilder {
  private readonly rows = new Map<number, RowChange>();
  private readonly rowsBefore = new Map<number, PMNode[]>();
  private readonly removedRows = new Set<number>();
  private readonly replacedRows = new Map<number, PMNode>();

  constructor(
    readonly table: PMNode,
    readonly grid: TableGrid,
  ) {}

  private change(rowChild: number): RowChange {
    let change = this.rows.get(rowChild);
    if (!change) {
      change = { replace: new Map(), before: new Map() };
      this.rows.set(rowChild, change);
    }
    return change;
  }

  /** The node of grid cell `index` becomes `node`; null removes it. */
  setCell(index: number, node: PMNode | null): void {
    const cell = this.grid.cells[index]!;
    this.change(this.grid.rowChild[cell.row]!).replace.set(cell.index, node);
  }

  /** `nodes` go into the row that is child `rowChild`, before its child `childIndex`. */
  insertCells(rowChild: number, childIndex: number, nodes: readonly PMNode[]): void {
    if (nodes.length === 0) return;
    const before = this.change(rowChild).before;
    before.set(childIndex, [...(before.get(childIndex) ?? []), ...nodes]);
  }

  /** The row that is child `rowChild` becomes `row` as a whole. */
  replaceRow(rowChild: number, row: PMNode): void {
    this.replacedRows.set(rowChild, row);
  }

  /** `rows` go into the table before its child `childIndex` (its child count: at the end). */
  insertRows(childIndex: number, rows: readonly PMNode[]): void {
    this.rowsBefore.set(childIndex, [...(this.rowsBefore.get(childIndex) ?? []), ...rows]);
  }

  /** The row that is child `rowChild` goes, with its non-cell children. */
  removeRow(rowChild: number): void {
    this.removedRows.add(rowChild);
  }

  private buildRow(rowChild: number): PMNode {
    const row = this.table.child(rowChild);
    const replaced = this.replacedRows.get(rowChild);
    if (replaced) return replaced;
    const change = this.rows.get(rowChild);
    if (!change) return row;
    const out: PMNode[] = [];
    for (let index = 0; index <= row.childCount; index += 1) {
      const inserted = change.before.get(index);
      if (inserted) out.push(...inserted);
      if (index === row.childCount) break;
      const node = change.replace.has(index) ? change.replace.get(index)! : row.child(index);
      if (node) out.push(node);
    }
    return row.type.create(row.attrs, Fragment.from(out), row.marks);
  }

  build(): PMNode[] {
    const out: PMNode[] = [];
    for (let index = 0; index <= this.table.childCount; index += 1) {
      const inserted = this.rowsBefore.get(index);
      if (inserted) out.push(...inserted);
      if (index === this.table.childCount) break;
      if (this.removedRows.has(index)) continue;
      const child = this.table.child(index);
      out.push(child.type.name === 'tr' ? this.buildRow(index) : child);
    }
    return out;
  }
}

/** `node` with new attributes, its content and marks kept (its `nodeId` with the attributes). */
function withAttrs(node: PMNode, attrs: Attrs): PMNode {
  return node.type.create(attrs, node.content, node.marks);
}

/** A deep copy with a fresh `nodeId` on every node that has one (FR-030; data-model §1.6). */
function copyNode(node: PMNode, ctx: PlanContext): PMNode {
  if (node.isText) return node;
  const content: PMNode[] = [];
  node.forEach((child) => {
    content.push(copyNode(child, ctx));
  });
  const attrs = 'nodeId' in node.attrs ? { ...node.attrs, nodeId: ctx.nextId() } : node.attrs;
  return node.type.create(attrs, Fragment.from(content), node.marks);
}

/**
 * The copy of a cell (*Duplicate row*, *Duplicate column*): its content, kind, attributes and
 * `extraAttrs`, without `id`, with fresh node ids throughout - inline images and inline raw XML
 * included (FR-030, data-model §1.5) - and its spans written as counted (`withSpans`), so an odd
 * value of the source is never written again.
 */
function copyCell(node: PMNode, colspan: number, rowspan: number, ctx: PlanContext): PMNode {
  const copy = copyNode(node, ctx);
  return withAttrs(copy, withSpans({ ...copy.attrs, id: null }, colspan, rowspan));
}

/**
 * The cells `placements` placed into row r by their columns (data-model §4.4): before the
 * row's first own cell whose left column is the cell's or more, or - behind the row's holes -
 * at its end, after one empty `td` for each hole up to the cell's column (the hole fill).
 */
function placeCells(
  builder: TableBuilder,
  r: number,
  placements: { col: number; node: PMNode }[],
  ctx: PlanContext,
): void {
  const { table, grid } = builder;
  const rowChild = grid.rowChild[r]!;
  const row = table.child(rowChild);
  const reach = grid.reach(r);
  const td = fb2Schema.nodes.td!;
  let fillFrom = reach;
  for (const { col, node } of [...placements].sort((x, y) => x.col - y.col)) {
    if (col < reach) {
      builder.insertCells(rowChild, indexByLeft(row, grid, r, col), [node]);
      continue;
    }
    const nodes: PMNode[] = [];
    for (let c = fillFrom; c < col; c += 1) {
      if (grid.owner(r, c) < 0) nodes.push(td.create({ nodeId: ctx.nextId() }));
    }
    nodes.push(node);
    builder.insertCells(rowChild, row.childCount, nodes);
    fillFrom = Math.max(fillFrom, col + effectiveColspan(node.attrs.colspan));
  }
}

/** The new row's cells over `covered` (1 where a cell from above covers the column). */
function newCells(
  covered: Uint8Array,
  neighbour: (col: number) => PMNode | null,
  ctx: PlanContext,
): { cells: PMNode[]; first: number } {
  const cells: PMNode[] = [];
  let first = -1;
  for (let col = 0; col < covered.length; col += 1) {
    if (covered[col]) continue;
    if (first < 0) first = col;
    cells.push(newCellLike(neighbour(col), ctx));
  }
  return { cells, first };
}

/** The child index a row inserted at line L takes: before row L, or after the last row. */
function rowInsertIndex(grid: TableGrid, line: number): number {
  return line < grid.height ? grid.rowChild[line]! : grid.rowChild[grid.height - 1]! + 1;
}

/* ------------------------------------------------------------------------ */
/* The plans                                                                */
/* ------------------------------------------------------------------------ */

/**
 * *Insert row above / below* (data-model §4.5): k rows at line L, each with the reference row's
 * `align` (`newRowLike`). A cell crossing L inside the table grows by k (`withSpans`); at L = R
 * the spans past the last row keep their written value and cover as many new rows as they
 * reach (C15) - unless the first new row would then hold no cell: those spans are first cut to
 * end at the old last row (step 4). Every column no cell covers in a new row gets a new cell
 * like the owner of (reference row, column) - across the line where that is a hole, a plain
 * `td` where both are (FR-008). Focus: a caret in the first cell of the first new row.
 */
export function planInsertRows(
  address: TableAddress,
  options: { side: 'above' | 'below'; count?: number },
  ctx: PlanContext,
): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const insertion = insertionLine(address, 'row', options.side, options.count);
  if (!insertion || insertion.line > grid.height) return unchanged(table);
  const { line, count, reference } = insertion;
  const room = checkSpanRoom(address, 'row', line, count);
  if (isRefusal(room)) return room;
  const height = grid.height;
  const width = grid.width;
  const crossing: number[] = [];
  grid.cells.forEach((cell, index) => {
    if (cell.row < line && line < cell.row + cell.rowspan) crossing.push(index);
  });
  const coverage = (j: number): Uint8Array => {
    const covered = new Uint8Array(width);
    for (const index of crossing) {
      const cell = grid.cells[index]!;
      if (line < height || cell.row + cell.rowspan > height + j) {
        covered.fill(1, cell.left, Math.min(width, cell.left + cell.colspan));
      }
    }
    return covered;
  };
  const cut = line === height && crossing.length > 0 && coverage(0).every(Boolean);
  const builder = new TableBuilder(table, grid);
  for (const index of crossing) {
    const cell = grid.cells[index]!;
    const node = gridCellNode(table, grid, index);
    if (line < height) {
      builder.setCell(
        index,
        withAttrs(node, withSpans(node.attrs, undefined, cell.rowspan + count)),
      );
    } else if (cut) {
      builder.setCell(index, withAttrs(node, withSpans(node.attrs, undefined, height - cell.row)));
    }
  }
  const other = options.side === 'above' ? line - 1 : line;
  const referenceRow = table.child(grid.rowChild[reference]!);
  const rows: PMNode[] = [];
  let focusColumn = 0;
  for (let j = 0; j < count; j += 1) {
    const covered = cut ? new Uint8Array(width) : coverage(j);
    const { cells, first } = newCells(
      covered,
      (col) => neighbourAt(grid, table, { row: reference, col }, { row: other, col }),
      ctx,
    );
    // Only an invalid book's empty row can leave a new row without a cell: no change then.
    if (cells.length === 0) return unchanged(table);
    if (j === 0) focusColumn = first;
    rows.push(newRowLike(referenceRow, cells, ctx));
  }
  builder.insertRows(rowInsertIndex(grid, line), rows);
  return { rows: builder.build(), focus: caretAt(line, focusColumn), removedIds: [] };
}

/**
 * *Insert column to the left / right* (data-model §4.5): k columns at line L. A cell crossing L
 * grows by k once, in its own row; every row that no crossing cell covers and that reaches L
 * gets k new cells at index by left (r, L), each like the owner of (r, reference column) -
 * across the line where that is a hole (FR-008); a row that does not reach L is left as it is
 * (FR-035). Focus: the first new cell of the caret cell's row (the block's top row), else the
 * caret's own cell, its left column moved by k when it lies right of L.
 */
export function planInsertColumns(
  address: TableAddress,
  options: { side: 'left' | 'right'; count?: number },
  ctx: PlanContext,
): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const insertion = insertionLine(address, 'column', options.side, options.count);
  if (!insertion || insertion.line > grid.width) return unchanged(table);
  const { line, count, reference } = insertion;
  const room = checkSpanRoom(address, 'column', line, count);
  if (isRefusal(room)) return room;
  const builder = new TableBuilder(table, grid);
  const coveredRow = new Uint8Array(grid.height);
  grid.cells.forEach((cell, index) => {
    if (cell.left < line && line < cell.left + cell.colspan) {
      const node = gridCellNode(table, grid, index);
      builder.setCell(index, withAttrs(node, withSpans(node.attrs, cell.colspan + count)));
      coveredRow.fill(1, cell.row, cell.row + cell.rowsIn);
    }
  });
  const other = options.side === 'left' ? line - 1 : line;
  const gotCells = new Uint8Array(grid.height);
  for (let r = 0; r < grid.height; r += 1) {
    if (coveredRow[r] || grid.reach(r) < line) continue;
    const cells: PMNode[] = [];
    for (let j = 0; j < count; j += 1) {
      cells.push(
        newCellLike(
          neighbourAt(grid, table, { row: r, col: reference }, { row: r, col: other }),
          ctx,
        ),
      );
    }
    const rowChild = grid.rowChild[r]!;
    builder.insertCells(rowChild, indexByLeft(table.child(rowChild), grid, r, line), cells);
    gotCells[r] = 1;
  }
  const caret =
    address.caret ?? (address.rect ? { row: address.rect.top, col: address.rect.left } : null);
  const row = address.rect ? address.rect.top : (caret?.row ?? 0);
  let focus: TableFocus;
  if (gotCells[row]) focus = caretAt(row, line);
  else if (caret) focus = caretAt(caret.row, caret.col >= line ? caret.col + count : caret.col);
  else focus = caretAt(0, 0);
  return { rows: builder.build(), focus, removedIds: [] };
}

/**
 * *Delete row* (data-model §4.5): the rows D = `[a, b)` go with their non-cell children. A cell
 * wholly in D goes (its `id` into `removedIds`); a cell that starts in D and covers rows below b
 * moves into row b at its column (with the hole fill), its rowspan less its rows in D and its
 * content and attributes kept (FR-007 rule 3); a cell from above loses its rows in D, a span
 * past the last row the same way; a cell of row b running into a moved cell's first column has
 * its colspan reduced to end there (the overlap of an irregular table). No confirmation (C13).
 * Focus: row a (a − 1 when D ended the table) at the caret cell's column.
 */
export function planDeleteRows(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  const { table, grid } = address;
  const check = checkDelete(address, 'row');
  if (isRefusal(check)) return check;
  const unit = unitLines(address, 'row');
  if (!unit) return unchanged(table);
  const [a, b] = unit;
  const builder = new TableBuilder(table, grid);
  const removedIds: string[] = [];
  const moved: { col: number; node: PMNode }[] = [];
  grid.cells.forEach((cell, index) => {
    const node = gridCellNode(table, grid, index);
    if (cell.row >= a && cell.row < b) {
      if (cell.row + cell.rowsIn <= b) {
        if (typeof node.attrs.id === 'string' && node.attrs.id !== '')
          removedIds.push(node.attrs.id);
      } else {
        const rowspan = cell.rowspan - (b - cell.row);
        moved.push({
          col: cell.left,
          node: withAttrs(node, withSpans(node.attrs, undefined, rowspan)),
        });
      }
      builder.setCell(index, null);
    } else if (cell.row < a && cell.row + cell.rowspan > a) {
      const lost = Math.min(cell.row + cell.rowspan, b) - a;
      builder.setCell(
        index,
        withAttrs(node, withSpans(node.attrs, undefined, cell.rowspan - lost)),
      );
    }
  });
  // An own cell of row b that runs into a moved cell's first column (an overlap of an irregular
  // table) is the later cell of that overlap: its colspan is reduced to end there, as Repair
  // reduces it (document-model §4.11), so the moved cell lands at its column and no other cell
  // of the row moves (FR-035). Only where the overlap lies within the moved cell's columns.
  for (const { col, node } of moved) {
    const end = col + effectiveColspan(node.attrs.colspan);
    for (let index = grid.rowStart[b]!; index < grid.rowStart[b + 1]!; index += 1) {
      const cell = grid.cells[index]!;
      const right = cell.left + cell.colspan;
      if (cell.left < col && col < right && right <= end) {
        const own = gridCellNode(table, grid, index);
        builder.setCell(index, withAttrs(own, withSpans(own.attrs, col - cell.left)));
      }
    }
  }
  if (moved.length > 0) placeCells(builder, b, moved, ctx);
  for (let r = a; r < b; r += 1) builder.removeRow(grid.rowChild[r]!);
  const col = address.rect ? address.rect.left : (address.caret?.col ?? 0);
  return {
    rows: builder.build(),
    focus: caretAt(b < grid.height ? a : a - 1, col),
    removedIds,
  };
}

/**
 * *Delete column* (data-model §4.5): a cell wholly in C = `[a, b)` goes (its `id` into
 * `removedIds`), a cell partly in C loses the overlap from its colspan - a cell starting in C
 * keeps the columns past b that it owns, the positions of an overlap belonging to the earlier
 * cell (document-model §4.5), and goes when it owns none -; then row compaction
 * (decision 1): a row whose only own cells lay in C goes, and the cells that crossed it lose a
 * row. No confirmation (C13). Focus: the caret cell's row (the block's top row), or the row
 * that took its place, at column a (a − 1 when C ended the table).
 */
export function planDeleteColumns(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  const check = checkDelete(address, 'column');
  if (isRefusal(check)) return check;
  const unit = unitLines(address, 'column');
  if (!unit) return unchanged(table);
  const [a, b] = unit;
  const builder = new TableBuilder(table, grid);
  const removedIds: string[] = [];
  const moved = new Map<number, { col: number; node: PMNode }[]>();
  /** The first column of `[b, right)` that cell `index` owns in row r, `right` for none. */
  const firstOwned = (index: number, r: number, right: number) => {
    let col = b;
    while (col < right && grid.owner(r, col) !== index) col += 1;
    return col;
  };
  grid.cells.forEach((cell, index) => {
    const right = cell.left + cell.colspan;
    if (right <= a || cell.left >= b) return;
    const node = gridCellNode(table, grid, index);
    let keep: number;
    if (cell.left < a) {
      keep = cell.colspan - (Math.min(right, b) - a);
    } else {
      // A cell starting in C keeps the columns past b that it owns: the leading ones an earlier
      // cell owns (the overlap of an irregular table) are not its position. When it owns none
      // in its top row, it moves down into the first of its rows where it owns one, as a merged
      // cell whose top row goes does (FR-007 rule 3); it lies wholly in C when it owns none.
      keep = right - firstOwned(index, cell.row, right);
      for (let r = cell.row + 1; keep <= 0 && r < cell.row + cell.rowsIn; r += 1) {
        const col = firstOwned(index, r, right);
        if (col >= right) continue;
        const rowspan = cell.rowspan - (r - cell.row);
        const list = moved.get(r) ?? [];
        list.push({ col, node: withAttrs(node, withSpans(node.attrs, right - col, rowspan)) });
        moved.set(r, list);
        builder.setCell(index, null);
        return;
      }
    }
    if (keep <= 0) {
      if (typeof node.attrs.id === 'string' && node.attrs.id !== '') removedIds.push(node.attrs.id);
      builder.setCell(index, null);
      return;
    }
    builder.setCell(index, withAttrs(node, withSpans(node.attrs, keep)));
  });
  for (const [r, list] of moved) {
    const rowChild = grid.rowChild[r]!;
    const row = table.child(rowChild);
    for (const { col, node } of list.sort((x, y) => x.col - y.col)) {
      const at = col < grid.reach(r) ? indexByLeft(row, grid, r, col) : row.childCount;
      builder.insertCells(rowChild, at, [node]);
    }
  }
  const rows = compactRows(table, builder.build());
  const caretRow = address.rect ? address.rect.top : (address.caret?.row ?? 0);
  // The rows compaction removed above the caret's row move it up.
  const kept = new Set(rows.map((row) => row.attrs.nodeId));
  let removedAbove = 0;
  for (let r = 0; r < caretRow; r += 1) {
    if (!kept.has(table.child(grid.rowChild[r]!).attrs.nodeId)) removedAbove += 1;
  }
  return {
    rows,
    focus: caretAt(caretRow - removedAbove, b < grid.width ? a : a - 1),
    removedIds,
  };
}

/** The child index where the group of row r begins: the row, after the non-row children before it. */
function rowGroupStart(grid: TableGrid, r: number): number {
  return r === 0 ? 0 : grid.rowChild[r - 1]! + 1;
}

/**
 * *Move row up / down* (data-model §4.5): after `moveBands`, the unit's rows and the band's rows
 * change places as nodes, reused with their non-cell children; a non-row child stays before the
 * row that followed it (§4.4). The focus moves with the rows.
 */
export function planMoveRows(
  address: TableAddress,
  options: { direction: 'up' | 'down' },
  ctx: PlanContext,
): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  const bands = moveBands(address, options.direction);
  if (!bands) return unchanged(table);
  if (isRefusal(bands)) return bands;
  const up = options.direction === 'up';
  const [a, b] = bands.unit;
  const [p, q] = bands.band;
  const first = up ? p : a;
  const middle = up ? a : b;
  const last = up ? b : q;
  const children = childNodes(table);
  const start = rowGroupStart(grid, first);
  const split = rowGroupStart(grid, middle);
  const end = grid.rowChild[last - 1]! + 1;
  const rows = [
    ...children.slice(0, start),
    ...children.slice(split, end),
    ...children.slice(start, split),
    ...children.slice(end),
  ];
  const delta = up ? -(a - p) : q - b;
  const { rect, caret } = address;
  const focus = rect
    ? blockOver({ ...rect, top: rect.top + delta, bottom: rect.bottom + delta })
    : caretAt((caret?.row ?? a) + delta, caret?.col ?? 0);
  return { rows, focus, removedIds: [] };
}

/**
 * *Move column left / right* (data-model §4.5): in every row that reaches the right edge of both
 * bands, the run of own cells that start in the first band and the run that start in the second
 * change places (each cell with the non-cell children before it); the rows of an irregular
 * table that do not reach both bands are left as they are (FR-035; R1 open point 6). The focus
 * moves with the columns.
 */
export function planMoveColumns(
  address: TableAddress,
  options: { direction: 'left' | 'right' },
  ctx: PlanContext,
): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  const bands = moveBands(address, options.direction);
  if (!bands) return unchanged(table);
  if (isRefusal(bands)) return bands;
  const left = options.direction === 'left';
  const [a, b] = bands.unit;
  const [p, q] = bands.band;
  const x0 = left ? p : a;
  const x1 = left ? a : b;
  const x2 = left ? b : q;
  const builder = new TableBuilder(table, grid);
  for (let r = 0; r < grid.height; r += 1) {
    if (grid.reach(r) < x2) continue;
    const firstRun: number[] = [];
    const secondRun: number[] = [];
    for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
      const cell = grid.cells[index]!;
      if (cell.left >= x0 && cell.left < x1) firstRun.push(index);
      else if (cell.left >= x1 && cell.left < x2) secondRun.push(index);
    }
    if (firstRun.length === 0 || secondRun.length === 0) continue;
    const rowChild = grid.rowChild[r]!;
    const row = table.child(rowChild);
    const children = childNodes(row);
    const groupStart = (index: number) =>
      index === grid.rowStart[r]! ? 0 : grid.cells[index - 1]!.index + 1;
    const start = groupStart(firstRun[0]!);
    const split = groupStart(secondRun[0]!);
    const end = grid.cells[secondRun[secondRun.length - 1]!]!.index + 1;
    const cells = [
      ...children.slice(0, start),
      ...children.slice(split, end),
      ...children.slice(start, split),
      ...children.slice(end),
    ];
    builder.replaceRow(rowChild, row.type.create(row.attrs, Fragment.from(cells), row.marks));
  }
  const delta = left ? -(a - p) : q - b;
  const { rect, caret } = address;
  const focusRow = rect ? rect.top : (caret?.row ?? 0);
  const moves = grid.reach(focusRow) >= x2;
  const shift = moves ? delta : 0;
  const focus = rect
    ? blockOver({ ...rect, left: rect.left + shift, right: rect.right + shift })
    : caretAt(caret?.row ?? 0, (caret?.col ?? a) + shift);
  return { rows: builder.build(), focus, removedIds: [] };
}

/**
 * *Duplicate row* (data-model §4.5): k = b − a rows at line b, each with the `align` of the row
 * it copies. A cell crossing line b grows by k and its columns get no copy (at b = R a span past
 * the end keeps its written value and covers the copy rows it reaches, C15; when that would
 * leave a copy row without a cell, those spans are first cut to end at the old last row, as
 * *Insert row* step 4 does). A cell wholly in the unit (`row + rowspan ≤ b`, the rowspan not
 * clipped) is copied to the same relative position (`copyCell`) where no crossing cell covers
 * its copy; every other position of the copy gets a new cell like the owner of the same
 * position in the unit, so the copy is complete also behind a short row (open point 7). Focus
 * kept.
 */
export function planDuplicateRows(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const unit = unitLines(address, 'row');
  if (!unit) return unchanged(table);
  const [a, b] = unit;
  const count = b - a;
  const room = checkSpanRoom(address, 'row', b, count);
  if (isRefusal(room)) return room;
  const height = grid.height;
  const width = grid.width;
  const crossing = new Set<number>();
  grid.cells.forEach((cell, index) => {
    if (cell.row < b && b < cell.row + cell.rowspan) crossing.add(index);
  });

  interface Item {
    col: number;
    node: () => PMNode;
  }
  /** The copy rows' cells, by copy row; null when a copy row would hold no cell. */
  const layout = (cut: boolean): Item[][] | null => {
    const covered = Array.from({ length: count }, () => new Uint8Array(width));
    if (!cut) {
      for (const index of crossing) {
        const cell = grid.cells[index]!;
        for (let j = 0; j < count; j += 1) {
          if (b < height || cell.row + cell.rowspan > height + j) {
            covered[j]!.fill(1, cell.left, Math.min(width, cell.left + cell.colspan));
          }
        }
      }
    }
    const items: Item[][] = Array.from({ length: count }, () => []);
    const taken = Array.from({ length: count }, () => new Uint8Array(width));
    grid.cells.forEach((cell, index) => {
      if (!cut && crossing.has(index)) return;
      const rowspan = cut && crossing.has(index) ? height - cell.row : cell.rowspan;
      if (cell.row < a || cell.row + rowspan > b) return;
      const top = cell.row - a;
      const right = Math.min(width, cell.left + cell.colspan);
      for (let j = top; j < top + rowspan; j += 1) {
        for (let c = cell.left; c < right; c += 1) if (covered[j]![c]) return;
      }
      for (let j = top; j < top + rowspan; j += 1) taken[j]!.fill(1, cell.left, right);
      const node = gridCellNode(table, grid, index);
      items[top]!.push({
        col: cell.left,
        node: () => copyCell(node, cell.colspan, rowspan, ctx),
      });
    });
    for (let j = 0; j < count; j += 1) {
      for (let c = 0; c < width; c += 1) {
        if (covered[j]![c] || taken[j]![c]) continue;
        const owner = grid.owner(a + j, c);
        const neighbour = owner >= 0 ? gridCellNode(table, grid, owner) : null;
        items[j]!.push({ col: c, node: () => newCellLike(neighbour, ctx) });
      }
      if (items[j]!.length === 0) return null;
      items[j]!.sort((x, y) => x.col - y.col);
    }
    return items;
  };
  let cut = false;
  let items = layout(false);
  if (!items && b === height) {
    cut = true;
    items = layout(true);
  }
  // Only an invalid book's empty rows can leave a copy row without a cell: no change then.
  if (!items) return unchanged(table);
  const builder = new TableBuilder(table, grid);
  for (const index of crossing) {
    const cell = grid.cells[index]!;
    const node = gridCellNode(table, grid, index);
    if (b < height) {
      builder.setCell(
        index,
        withAttrs(node, withSpans(node.attrs, undefined, cell.rowspan + count)),
      );
    } else if (cut) {
      builder.setCell(index, withAttrs(node, withSpans(node.attrs, undefined, height - cell.row)));
    }
  }
  const rows = items.map((cells, j) =>
    newRowLike(
      table.child(grid.rowChild[a + j]!),
      cells.map((item) => item.node()),
      ctx,
    ),
  );
  builder.insertRows(rowInsertIndex(grid, b), rows);
  const { rect, caret } = address;
  return {
    rows: builder.build(),
    focus: rect ? blockOver(rect) : caretAt(caret?.row ?? a, caret?.col ?? 0),
    removedIds: [],
  };
}

/**
 * *Duplicate column* (data-model §4.5): a cell crossing column line b grows by k = b − a once, in
 * its own row, and the rows it covers get no copy (the grown cell covers the copy's positions
 * there). In every other row that reaches b, the cells wholly in the unit's columns are copied
 * (`copyCell`; not one whose rows a crossing cell covers) and the copy's other positions get new
 * cells like the owners in the unit, placed at index by left (r, b); rows that do not reach b
 * are left as they are (FR-035; open point 7). Focus kept.
 */
export function planDuplicateColumns(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const unit = unitLines(address, 'column');
  if (!unit) return unchanged(table);
  const [a, b] = unit;
  const count = b - a;
  const room = checkSpanRoom(address, 'column', b, count);
  if (isRefusal(room)) return room;
  const height = grid.height;
  const builder = new TableBuilder(table, grid);
  const coveredRow = new Uint8Array(height);
  grid.cells.forEach((cell, index) => {
    if (cell.left < b && b < cell.left + cell.colspan) {
      const node = gridCellNode(table, grid, index);
      builder.setCell(index, withAttrs(node, withSpans(node.attrs, cell.colspan + count)));
      coveredRow.fill(1, cell.row, cell.row + cell.rowsIn);
    }
  });
  // The copy's positions taken by copies from the rows above: (row, column − a).
  const taken = new Uint8Array(height * count);
  for (let r = 0; r < height; r += 1) {
    if (coveredRow[r] || grid.reach(r) < b) continue;
    const items: { col: number; node: PMNode }[] = [];
    for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
      const cell = grid.cells[index]!;
      if (cell.left < a || cell.left + cell.colspan > b) continue;
      let free = true;
      for (let rr = r; rr < r + cell.rowsIn && free; rr += 1) if (coveredRow[rr]) free = false;
      if (!free) continue;
      for (let rr = r; rr < r + cell.rowsIn; rr += 1) {
        taken.fill(1, rr * count + cell.left - a, rr * count + cell.left - a + cell.colspan);
      }
      items.push({
        col: cell.left - a,
        node: copyCell(gridCellNode(table, grid, index), cell.colspan, cell.rowspan, ctx),
      });
    }
    for (let j = 0; j < count; j += 1) {
      if (taken[r * count + j]) continue;
      taken[r * count + j] = 1;
      const owner = grid.owner(r, a + j);
      items.push({
        col: j,
        node: newCellLike(owner >= 0 ? gridCellNode(table, grid, owner) : null, ctx),
      });
    }
    items.sort((x, y) => x.col - y.col);
    const rowChild = grid.rowChild[r]!;
    builder.insertCells(
      rowChild,
      indexByLeft(table.child(rowChild), grid, r, b),
      items.map((item) => item.node),
    );
  }
  const { rect, caret } = address;
  return {
    rows: builder.build(),
    focus: rect ? blockOver(rect) : caretAt(caret?.row ?? 0, caret?.col ?? a),
    removedIds: [],
  };
}
