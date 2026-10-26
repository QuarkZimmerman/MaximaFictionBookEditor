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

import { Fragment, type Attrs, type Node as PMNode, type Schema } from 'prosemirror-model';

import { fb2Schema } from '../schema';

import {
  applyTableEdit,
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
  gridOfNode,
  type GridCell,
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

/**
 * The assistant's whole lines of `axis`, when they are a valid range of the grid (C67); the
 * attribute plans of `attrs.ts` read them too (US7).
 */
export function linesOf(address: TableAddress, axis: LineAxis): [number, number] | null {
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
 * `td` where both are (FR-008). Nothing changes only where FR-046's compaction would remove
 * every new row: the row at L an invalid book's row without cells under the cells crossing L,
 * or a table without cells. Focus: a caret in the first cell of the first new row.
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
    // No cell of its own: the cells crossing L cover the row at L, which a row with a cell never
    // is (its first cell stands in a column they leave free) - an invalid book's row without
    // cells -, or the table has no cell. Every new row is then such a row; FR-046's compaction
    // would remove them all and give the crossing cells back their spans: nothing changes.
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

/** A cell that stands in row b after *Delete row*: a moved cell or an own cell of row b. */
interface RowAfterDelete {
  /** Its index in `grid.cells`: the moved cells, which start above b, come first. */
  index: number;
  left: number;
  right: number;
  /** One past the last row it covers, in the rows of the grid before. */
  end: number;
  /** A moved cell's rowspan in row b; undefined for an own cell of row b. */
  rowspan?: number;
}

/**
 * The positions of the grid before that the cells of row b after *Delete row* give up, by row:
 * the own cells of one row never overlap (document-model §4.3), so when the move puts the two
 * cells of an overlap of an irregular table into row b - the later cell running into the
 * columns of the earlier one (§4.6) - the later cell's colspan is reduced to end before the
 * first such column, as Repair reduces it (§4.11). The columns it gives up are the positions
 * it owned there, in every row it covers from b on, that no later cell of the rows below b
 * covers (that cell becomes their owner). `cut` holds each reduced cell's new right edge.
 */
function deleteOverlaps(
  grid: TableGrid,
  b: number,
  cells: readonly RowAfterDelete[],
): { cut: Map<number, number>; given: Map<number, number[]> } {
  const cut = new Map<number, number>();
  const given = new Map<number, number[]>();
  for (const cell of cells) {
    let right = cell.right;
    // Only a moved cell can be the earlier one: the own cells of row b never overlap.
    for (const earlier of cells) {
      if (earlier.index >= cell.index || earlier.rowspan === undefined) break;
      if (cell.left < earlier.left && earlier.left < right) right = earlier.left;
    }
    if (right === cell.right) continue;
    cut.set(cell.index, right);
    // The later cells of the rows below b that cover a position of the given-up columns.
    const covered = new Set<number>();
    const end = Math.min(cell.end, grid.height);
    const below = grid.rowStart[Math.min(b + 1, end)]!;
    for (let index = below; index < grid.rowStart[end]!; index += 1) {
      const other = grid.cells[index]!;
      const from = Math.max(other.left, right);
      const to = Math.min(other.left + other.colspan, cell.right);
      for (let r = other.row; r < Math.min(other.row + other.rowsIn, end); r += 1) {
        for (let c = from; c < to; c += 1) covered.add(r * grid.width + c);
      }
    }
    for (let r = b; r < end; r += 1) {
      for (let c = right; c < cell.right; c += 1) {
        if (grid.owner(r, c) !== cell.index || covered.has(r * grid.width + c)) continue;
        const list = given.get(r) ?? [];
        list.push(c);
        given.set(r, list);
      }
    }
  }
  return { cut, given };
}

/**
 * *Delete row* (data-model §4.5): the rows D = `[a, b)` go with their non-cell children. A cell
 * wholly in D goes (its `id` into `removedIds`); a cell that starts in D and covers rows below b
 * moves into row b at its column (with the hole fill), its rowspan less its rows in D and its
 * content and attributes kept (FR-007 rule 3); a cell from above loses its rows in D, a span
 * past the last row the same way. When the move puts both cells of an overlap of an irregular
 * table into row b, the later cell's colspan is reduced to end at the earlier cell's first
 * column (`deleteOverlaps`), and every position it gives up gets an empty `td` placed by its
 * column (with the hole fill), so that no other cell of its rows moves (FR-007, FR-035). No
 * confirmation (C13). Focus: row a (a − 1 when D ended the table) at the caret cell's column.
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
  // Row b after the move, in reading order: the moved cells, then the own cells of row b.
  const rowB: RowAfterDelete[] = [];
  grid.cells.forEach((cell, index) => {
    const node = gridCellNode(table, grid, index);
    const right = cell.left + cell.colspan;
    if (cell.row >= a && cell.row < b) {
      if (cell.row + cell.rowsIn <= b) {
        if (typeof node.attrs.id === 'string' && node.attrs.id !== '')
          removedIds.push(node.attrs.id);
      } else {
        const rowspan = cell.rowspan - (b - cell.row);
        rowB.push({ index, left: cell.left, right, end: cell.row + cell.rowsIn, rowspan });
      }
      builder.setCell(index, null);
    } else if (cell.row === b) {
      rowB.push({ index, left: cell.left, right, end: b + cell.rowsIn });
    } else if (cell.row < a && cell.row + cell.rowspan > a) {
      const lost = Math.min(cell.row + cell.rowspan, b) - a;
      builder.setCell(
        index,
        withAttrs(node, withSpans(node.attrs, undefined, cell.rowspan - lost)),
      );
    }
  });
  const { cut, given } = deleteOverlaps(grid, b, rowB);
  const placements = new Map<number, { col: number; node: PMNode }[]>();
  const place = (r: number, col: number, node: PMNode) => {
    const list = placements.get(r) ?? [];
    list.push({ col, node });
    placements.set(r, list);
  };
  for (const cell of rowB) {
    const right = cut.get(cell.index);
    const colspan = right === undefined ? undefined : right - cell.left;
    const node = gridCellNode(table, grid, cell.index);
    if (cell.rowspan !== undefined) {
      place(b, cell.left, withAttrs(node, withSpans(node.attrs, colspan, cell.rowspan)));
    } else if (colspan !== undefined) {
      builder.setCell(cell.index, withAttrs(node, withSpans(node.attrs, colspan)));
    }
  }
  const td = fb2Schema.nodes.td!;
  for (const [r, columns] of given) {
    for (const c of columns) place(r, c, td.create({ nodeId: ctx.nextId() }));
  }
  for (const [r, list] of placements) placeCells(builder, r, list, ctx);
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
 * position in the unit, so the copy is complete also behind a short row (open point 7). A copy
 * row still left without a cell of its own - each of its positions under a grown cell or under
 * a copy from a row above it, as from X to Y in `[X rowspan 2, Y rowspan 2, Q] / [Z rowspan 2] /
 * [P, R]`, where Z crosses line b - goes, and every cell that crosses it (a grown cell, a copy
 * from above) spans one row fewer: FR-046's row compaction, so the table stays valid and a
 * regular one regular. Nothing changes only when no copy row is left: row b is then an invalid
 * book's row without cells under the cells that cross line b (a row with a cell has one in a
 * column they leave free, where the first copy row gets a cell), or the table has no cell at
 * all. Focus kept.
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

  /** A cell of the copy: the copy of grid cell `index` over `rowspan` copy rows, or a new cell. */
  interface Item {
    col: number;
    copy?: { index: number; rowspan: number };
    neighbour?: PMNode | null;
  }
  /** The copy rows' own cells, by copy row; an empty list for a copy row without one. */
  const layout = (cut: boolean): Item[][] => {
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
      items[top]!.push({ col: cell.left, copy: { index, rowspan } });
    });
    for (let j = 0; j < count; j += 1) {
      for (let c = 0; c < width; c += 1) {
        if (covered[j]![c] || taken[j]![c]) continue;
        const owner = grid.owner(a + j, c);
        items[j]!.push({ col: c, neighbour: owner >= 0 ? gridCellNode(table, grid, owner) : null });
      }
      items[j]!.sort((x, y) => x.col - y.col);
    }
    return items;
  };
  let cut = false;
  let items = layout(false);
  if (b === height && items.some((cells) => cells.length === 0)) {
    cut = true;
    items = layout(true);
  }
  // FR-046's row compaction of the copy: `gone[j]` counts the copy rows 0 … j without a cell of
  // their own, which go.
  const gone: number[] = [];
  let removed = 0;
  for (const cells of items) {
    if (cells.length === 0) removed += 1;
    gone.push(removed);
  }
  if (removed === count) return unchanged(table);
  const builder = new TableBuilder(table, grid);
  for (const index of crossing) {
    const cell = grid.cells[index]!;
    const node = gridCellNode(table, grid, index);
    if (b < height) {
      // It covers every copy row: it grows by those that stay.
      builder.setCell(
        index,
        withAttrs(node, withSpans(node.attrs, undefined, cell.rowspan + count - removed)),
      );
    } else if (cut) {
      builder.setCell(index, withAttrs(node, withSpans(node.attrs, undefined, height - cell.row)));
    }
  }
  const rows: PMNode[] = [];
  items.forEach((cells, j) => {
    if (cells.length === 0) return;
    const nodes = cells.map((item) => {
      if (!item.copy) return newCellLike(item.neighbour ?? null, ctx);
      const { index, rowspan } = item.copy;
      // A copy row it reaches into that goes takes one row of its span.
      const lost = gone[j + rowspan - 1]! - gone[j]!;
      const source = gridCellNode(table, grid, index);
      return copyCell(source, grid.cells[index]!.colspan, rowspan - lost, ctx);
    });
    rows.push(newRowLike(table.child(grid.rowChild[a + j]!), nodes, ctx));
  });
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

/* ------------------------------------------------------------------------ */
/* US4: blocks of cells (FR-011, FR-012; data-model §4.4, §4.6, §8.4)       */
/* ------------------------------------------------------------------------ */

/**
 * *Clear block* (data-model §4.6; FR-011): every cell of the block - `cellsIn(rect)` - loses
 * its content and keeps its node, kind and attributes (`nodeId`, `id`, `style`, `lang`, spans,
 * `extraAttrs`) as read - a span no plan writes, such as 0, 1, −1 or one past the limit,
 * included, which `assertTableValid` does not judge as written (data-model §4.4, FR-047) -, so
 * the cells stay with their ids (C47); a cell already empty and every row without a changed
 * cell are reused, so a block of empty cells commits nothing. `too-large` on a grid too large
 * for the owner map. Without a block nothing changes. Focus: the same block. `keep` names a
 * grid cell left as it is (a composition over a block keeps the top-left cell, whose content it
 * replaces, U39).
 */
export function planClearBlock(
  address: TableAddress,
  ctx: PlanContext,
  options: { keep?: number } = {},
): TableEdit | Refusal {
  void ctx;
  const { table, grid, rect } = address;
  if (grid.tooLarge) return TOO_LARGE;
  if (!rect) return unchanged(table);
  const builder = new TableBuilder(table, grid);
  for (const index of grid.cellsIn(rect)) {
    if (index === options.keep) continue;
    const node = gridCellNode(table, grid, index);
    if (node.content.size === 0) continue;
    builder.setCell(index, node.type.create(node.attrs, Fragment.empty, node.marks));
  }
  return { rows: builder.build(), focus: blockOver(rect), removedIds: [] };
}

/**
 * The parts' inline content as one run (FR-013's and decision 5's joining rule; C17): in order,
 * one text node `' '` without marks only between two non-empty parts - an empty part adds
 * nothing, so an empty first part gives no leading space -, white space at a part's ends kept;
 * `Fragment.append` joins adjacent text of equal marks into one node.
 */
export function joinInlineParts(parts: readonly Fragment[], schema: Schema = fb2Schema): Fragment {
  let out = Fragment.empty;
  for (const part of parts) {
    if (part.size === 0) continue;
    if (out.size > 0) out = out.append(Fragment.from(schema.text(' ')));
    out = out.append(part);
  }
  return out;
}

/**
 * Row `row` (row r of `grid`) with `placements` placed by their columns (data-model §4.4): a cell
 * at a column below `reach(r)` before the row's first own cell whose left column is the cell's
 * or more; behind the row's holes at its end, after one empty `td` for each hole up to the
 * cell's column (the hole fill).
 */
function placeInRow(
  row: PMNode,
  grid: TableGrid,
  r: number,
  placements: readonly { col: number; node: PMNode }[],
  ctx: PlanContext,
): PMNode {
  const reach = grid.reach(r);
  const td = fb2Schema.nodes.td!;
  const before = new Map<number, PMNode[]>();
  const add = (index: number, nodes: PMNode[]) => {
    before.set(index, [...(before.get(index) ?? []), ...nodes]);
  };
  let fillFrom = reach;
  for (const { col, node } of [...placements].sort((x, y) => x.col - y.col)) {
    if (col < reach) {
      add(indexByLeft(row, grid, r, col), [node]);
      continue;
    }
    const nodes: PMNode[] = [];
    for (let c = fillFrom; c < col; c += 1) {
      if (grid.owner(r, c) < 0) nodes.push(td.create({ nodeId: ctx.nextId() }));
    }
    nodes.push(node);
    add(row.childCount, nodes);
    fillFrom = Math.max(fillFrom, col + effectiveColspan(node.attrs.colspan));
  }
  const out: PMNode[] = [];
  for (let index = 0; index <= row.childCount; index += 1) {
    out.push(...(before.get(index) ?? []));
    if (index < row.childCount) out.push(row.child(index));
  }
  return row.type.create(row.attrs, Fragment.from(out), row.marks);
}

/**
 * FR-016's split of one cell (data-model §4.5 `table.splitCell` steps 1 to 3), on the child list
 * `rows` of the table whose grid is `grid`: the cell `index` keeps its content and every
 * attribute but its spans (`withSpans(attrs, 1, 1)`; a rowspan past the last row goes with
 * them); each other position it owns gets `newCellLike(cell)` - empty, its kind, `align`,
 * `valign` and `lang`, a fresh `nodeId`, no `id`, `style`, spans or `extraAttrs` -, placed row by
 * row and left to right with the hole fill; positions of its rectangle an earlier cell owns get
 * nothing, and neither do those a later cell of the row overlaps (it covers them then). Returns
 * the new child list. Callers check `tooLarge` first.
 */
export function splitToSingleCells(
  rows: readonly PMNode[],
  grid: TableGrid,
  index: number,
  ctx: PlanContext,
): PMNode[] {
  const cell = grid.cells[index]!;
  const out = [...rows];
  const topChild = grid.rowChild[cell.row]!;
  const keeper = out[topChild]!.child(cell.index);
  const kept = keeper.type.create(withSpans(keeper.attrs, 1, 1), keeper.content, keeper.marks);
  for (let r = cell.row; r < cell.row + cell.rowsIn; r += 1) {
    // A later cell of the row that overlaps the cell (an irregular table) covers its positions
    // once the cell is gone: they get no piece, so no cell of the row moves (FR-035).
    const spans: [number, number][] = [];
    for (let other = grid.rowStart[r]!; other < grid.rowStart[r + 1]!; other += 1) {
      if (other === index) continue;
      const own = grid.cells[other]!;
      spans.push([own.left, own.left + own.colspan]);
    }
    const placements: { col: number; node: PMNode }[] = [];
    for (let c = cell.left; c < cell.left + cell.colspan; c += 1) {
      if (r === cell.row && c === cell.left) continue;
      if (grid.owner(r, c) !== index) continue;
      if (spans.some(([from, to]) => c >= from && c < to)) continue;
      placements.push({ col: c, node: newCellLike(keeper, ctx) });
    }
    const rowChild = grid.rowChild[r]!;
    let row = out[rowChild]!;
    if (r === cell.row) {
      const children = childNodes(row);
      children[cell.index] = kept;
      row = row.type.create(row.attrs, Fragment.from(children), row.marks);
    }
    if (placements.length > 0) row = placeInRow(row, grid, r, placements, ctx);
    out[rowChild] = row;
  }
  return out;
}

/** The cell's rectangle lies wholly inside `rect`. */
function cellInside(cell: GridCell, rect: Rect): boolean {
  return (
    cell.row >= rect.top &&
    cell.row + cell.rowsIn <= rect.bottom &&
    cell.left >= rect.left &&
    cell.left + cell.colspan <= rect.right
  );
}

/** The cell's rectangle shares a position with `rect`. */
function cellMeets(cell: GridCell, rect: Rect): boolean {
  return (
    cell.row < rect.bottom &&
    cell.row + cell.rowsIn > rect.top &&
    cell.left < rect.right &&
    cell.left + cell.colspan > rect.left
  );
}

/** The FB2 ids of a table and its cells. */
function tableIds(table: PMNode): Set<string> {
  const ids = new Set<string>();
  const add = (node: PMNode) => {
    const id = node.attrs.id;
    if (typeof id === 'string' && id !== '') ids.add(id);
  };
  add(table);
  table.forEach((row) => {
    if (row.type.name === 'tr') row.forEach(add);
  });
  return ids;
}

/**
 * The editor's own copied block or table as it is pasted (analyze decision 4; data-model §8.4,
 * §8.6): it keeps its grid - its kinds, attributes and spans, its overlaps and holes - until
 * *Repair table*. With `keepRows` (the paste-block plan, whose step 4 decides about a rowspan past
 * the block's last row) nothing changes. Without it (a new table) the rows in which no cell
 * starts - `content()` makes them under a cell that spans the block's rows, and FB2 forbids them
 * in a document - are removed and every span that crossed one shrinks by a row; nothing else
 * changes, so a block of a regular table comes back as it is.
 */
export function normalisePastedBlock(
  table: PMNode,
  { keepRows }: { keepRows: boolean },
  ctx: PlanContext,
): PMNode {
  void ctx;
  if (keepRows) return table;
  const grid = gridOfNode(table);
  const empty: number[] = [];
  for (let r = 0; r < grid.height; r += 1) {
    if (grid.rowStart[r] === grid.rowStart[r + 1]) empty.push(r);
  }
  if (empty.length === 0) return table;
  const children = childNodes(table);
  for (let r = 0; r < grid.height; r += 1) {
    const rowChild = grid.rowChild[r]!;
    let cells: PMNode[] | null = null;
    for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
      const cell = grid.cells[index]!;
      const lost = empty.filter((rr) => rr > cell.row && rr < cell.row + cell.rowsIn).length;
      if (lost === 0) continue;
      cells ??= childNodes(children[rowChild]!);
      const node = cells[cell.index]!;
      cells[cell.index] = withAttrs(node, withSpans(node.attrs, undefined, cell.rowspan - lost));
    }
    if (cells) {
      const row = children[rowChild]!;
      children[rowChild] = row.type.create(row.attrs, Fragment.from(cells), row.marks);
    }
  }
  const drop = new Set(empty.map((r) => grid.rowChild[r]!));
  return table.type.create(
    table.attrs,
    Fragment.from(children.filter((_child, index) => !drop.has(index))),
    table.marks,
  );
}

/**
 * The paste-block plan (FR-012; data-model §8.4; R5.7): the copied block B (h × w), as
 * `normalisePastedBlock` keeps it, overwrites the target T = `[r0, r0 + h) × [c0, c0 + w)` from
 * the anchor - the top-left position of the selected block, else of the caret's cell (a larger
 * block is not tiled):
 * 1. **grow**: the missing rows as *Insert row below* on the last row appends them, then the
 *    missing columns as *Insert column to the right* on the last column (FR-008; C15);
 * 2. **split** every target cell that crosses T's edge (`splitToSingleCells`), its content
 *    staying in its top-left piece, so every cell lies wholly inside or outside T;
 * 3. **remove** the target cells inside T, a removed cell's `id` passing to the B cell that
 *    starts at its position when that one has none (U31);
 * 4. **place** B's cells row by row at their columns, with their kind, spans (as counted),
 *    attributes and content, fresh node ids on them and their inline atoms, their own `id` only
 *    when the book does not use it (C47); holes before T get the hole fill, a hole of B stays a
 *    hole unless a target cell follows it in its row (then an empty `td`, so that cell keeps its
 *    column; analyze decision 4); a rowspan of B past its last row is written as the rows it
 *    covers in B when the table has rows below T (FR-035) and keeps its value otherwise;
 * 5. **compact** the rows of T left without own cells (decision 1).
 *
 * `too-large` is the only refusal. Focus: a block over T, or a caret when T is one position.
 * `removedIds`: the removed cells' ids not handed over; `allowedIds`: the ids pasted cells keep;
 * `pastedIrregular` when B is irregular (the target may then become irregular; FR-046).
 */
export function pasteBlockPlan(
  address: TableAddress,
  block: PMNode,
  ctx: PlanContext,
): TableEdit | Refusal {
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const anchor = address.rect
    ? { row: address.rect.top, col: address.rect.left }
    : (address.caret ?? null);
  if (!anchor || grid.height === 0) return unchanged(table);
  const pasted = normalisePastedBlock(block, { keepRows: true }, ctx);
  const gB = gridOfNode(pasted);
  if (gB.tooLarge) return TOO_LARGE;
  const h = gB.height;
  const w = gB.width;
  if (h === 0 || w === 0) return unchanged(table);
  const r0 = anchor.row;
  const c0 = anchor.col;

  // (1) Grow.
  let current = table;
  let g = grid;
  if (r0 + h > g.height) {
    const grown = planInsertRows(
      { table: current, grid: g, lines: { axis: 'row', from: g.height - 1, to: g.height } },
      { side: 'below', count: r0 + h - g.height },
      ctx,
    );
    if (isRefusal(grown)) return grown;
    current = applyTableEdit(current, grown);
    g = gridOfNode(current);
    if (g.tooLarge) return TOO_LARGE;
  }
  if (c0 + w > g.width) {
    const grown = planInsertColumns(
      { table: current, grid: g, lines: { axis: 'column', from: g.width - 1, to: g.width } },
      { side: 'right', count: c0 + w - g.width },
      ctx,
    );
    if (isRefusal(grown)) return grown;
    current = applyTableEdit(current, grown);
    g = gridOfNode(current);
    if (g.tooLarge) return TOO_LARGE;
  }
  const target: Rect = { top: r0, left: c0, bottom: r0 + h, right: c0 + w };

  // (2) Split the cells that cross T's edge, one at a time on the grid each split leaves.
  let rows = childNodes(current);
  for (let guard = g.cells.length; guard >= 0; guard -= 1) {
    const crossing = g.cells.findIndex(
      (cell) => cellMeets(cell, target) && !cellInside(cell, target),
    );
    if (crossing < 0) break;
    rows = splitToSingleCells(rows, g, crossing, ctx);
    current = current.type.create(current.attrs, Fragment.from(rows), current.marks);
    g = gridOfNode(current);
    if (g.tooLarge) return TOO_LARGE;
  }

  // (3) The target cells inside T go; their ids wait for the B cells that start where they did.
  const removed = new Set<number>();
  const handOver = new Map<string, string>();
  const ids = new Map<number, string>();
  g.cells.forEach((cell, index) => {
    if (!cellMeets(cell, target)) return;
    removed.add(index);
    const id = gridCellNode(current, g, index).attrs.id;
    if (typeof id === 'string' && id !== '') {
      ids.set(index, id);
      handOver.set(`${cell.row - r0}:${cell.left - c0}`, id);
    }
  });

  // (4) B's cells, by row of B.
  const used = ctx.bookIds ?? tableIds(current);
  const below = r0 + h < g.height;
  const kept: string[] = [];
  const handed = new Set<string>();
  const placed: PMNode[][] = Array.from({ length: h }, () => []);
  gB.cells.forEach((cell, index) => {
    const source = gridCellNode(pasted, gB, index);
    const copy = copyNode(source, ctx);
    const own = source.attrs.id;
    let id: string | null = typeof own === 'string' && own !== '' && !used.has(own) ? own : null;
    if (id === null) {
      const from = handOver.get(`${cell.row}:${cell.left}`);
      if (from !== undefined) {
        id = from;
        handed.add(from);
      }
    }
    if (id !== null) kept.push(id);
    const rowspan = below && cell.row + cell.rowspan > h ? cell.rowsIn : cell.rowspan;
    placed[cell.row]!.push(
      withAttrs(copy, withSpans({ ...copy.attrs, id }, cell.colspan, rowspan)),
    );
  });
  const td = fb2Schema.nodes.td!;
  const next = [...rows];
  for (let i = 0; i < h; i += 1) {
    const r = r0 + i;
    const rowChild = g.rowChild[r]!;
    const row = current.child(rowChild);
    const own = new Map<number, number>();
    let follows = false;
    for (let index = g.rowStart[r]!; index < g.rowStart[r + 1]!; index += 1) {
      const cell = g.cells[index]!;
      own.set(cell.index, index);
      if (cell.left >= c0 + w) follows = true;
    }
    const middle = (): PMNode[] => {
      const nodes: PMNode[] = [];
      // The hole fill before T, so B's first cell lands in its column.
      for (let c = g.reach(r); c < c0; c += 1) {
        if (g.owner(r, c) < 0) nodes.push(td.create({ nodeId: ctx.nextId() }));
      }
      nodes.push(...placed[i]!);
      // B's holes in this row: empty cells only where a target cell follows them.
      if (follows) {
        for (let j = gB.reach(i); j < w; j += 1) {
          if (gB.owner(i, j) < 0) nodes.push(td.create({ nodeId: ctx.nextId() }));
        }
      }
      return nodes;
    };
    const out: PMNode[] = [];
    let inserted = false;
    row.forEach((child, _offset, childIndex) => {
      const index = own.get(childIndex);
      if (index !== undefined) {
        if (!inserted && g.cells[index]!.left >= c0) {
          out.push(...middle());
          inserted = true;
        }
        if (removed.has(index)) return;
      }
      out.push(child);
    });
    if (!inserted) out.push(...middle());
    next[rowChild] = row.type.create(row.attrs, Fragment.from(out), row.marks);
  }

  // (5) Row compaction over the rows of T.
  const compacted = compactRows(current, next);
  const keptRows = new Set(compacted.map((child) => child.attrs.nodeId));
  let lost = 0;
  for (let i = 0; i < h; i += 1) {
    if (!keptRows.has(current.child(g.rowChild[r0 + i]!).attrs.nodeId)) lost += 1;
  }
  const height = h - lost;
  const removedIds: string[] = [];
  for (const id of ids.values()) if (!handed.has(id)) removedIds.push(id);
  return {
    rows: compacted,
    focus:
      height === 1 && w === 1
        ? caretAt(r0, c0)
        : blockOver({ top: r0, left: c0, bottom: r0 + height, right: c0 + w }),
    removedIds,
    allowedIds: kept,
    ...(gB.regular ? {} : { pastedIrregular: true as const }),
  };
}

/* ------------------------------------------------------------------------ */
/* US5: merge and split (FR-013 to FR-016; data-model §4.5)                 */
/* ------------------------------------------------------------------------ */

const NEEDS_BLOCK: Refusal = { refused: 'needs-block' };

/**
 * *Merge cells* may act (data-model §4.5 `table.mergeCells`; C21): `too-large` first; a block,
 * or the assistant's rectangle, is ok - a block holds two cells or more by construction
 * (data-model §5.2) -; a caret gives `needs-block` (US5 sc.6). Reads the cached grid only; the
 * plan runs it first, so availability and plan cannot disagree.
 */
export function checkMerge(address: TableAddress): { ok: true } | Refusal {
  if (address.grid.tooLarge) return TOO_LARGE;
  return address.rect ? OK : NEEDS_BLOCK;
}

/**
 * The grid index of the caret's cell when it owns a second position - found from its spans and
 * the cached owner map, stopping at the first such position, so no node is built (C21) -, else
 * −1. Spans of 0, negative or not a number count as 1 in the grid (FR-047).
 */
function splitCellIndex(address: TableAddress): number {
  const { grid, caret } = address;
  if (!caret) return -1;
  const index = grid.owner(caret.row, caret.col);
  if (index < 0) return -1;
  const cell = grid.cells[index]!;
  for (let r = cell.row; r < cell.row + cell.rowsIn; r += 1) {
    for (let c = cell.left; c < cell.left + cell.colspan; c += 1) {
      if ((r !== cell.row || c !== cell.left) && grid.owner(r, c) === index) return index;
    }
  }
  return -1;
}

/**
 * *Split cell* may act (data-model §4.5 `table.splitCell`, open point 4; C21): `too-large`
 * first; with a block `not-merged` `{selection: 'block'}`, since FR-016 asks for a single cell
 * (*Select td* and *Select th* select the cell's content, so the single selected cell is the
 * caret's cell); the caret's cell is ok when it owns a second position, otherwise `not-merged`
 * `{selection: 'cell'}`. Reads the cached grid only; the plan runs it first.
 */
export function checkSplit(address: TableAddress): { ok: true } | Refusal {
  if (address.grid.tooLarge) return TOO_LARGE;
  if (address.rect) return { refused: 'not-merged', params: { selection: 'block' } };
  return splitCellIndex(address) >= 0
    ? OK
    : { refused: 'not-merged', params: { selection: 'cell' } };
}

/**
 * *Merge cells* (data-model §4.5 `table.mergeCells`; FR-013, FR-014, FR-030, FR-035; R1.5):
 * `too-large` first; the rectangle is `extend(address.rect)` - a block's is extended already,
 * the assistant's is extended here (C67) -; `needs-block` for a caret and for a rectangle of
 * fewer than two cells. The keeper is the owner of the rectangle's top-left position, or the
 * first of its cells in reading order when that position is a hole (R1 open point 4) - in both
 * cases the first of `cellsIn(rect)` -; its content becomes `joinInlineParts` of its own and
 * then each other cell's content in reading order (one unmarked space only between two
 * non-empty parts, white space at a part's ends kept; C17), so marks, links, note links, named
 * styles, inline images and inline raw XML move unchanged; the other cells go, their ids into
 * `removedIds`; the keeper keeps its kind, node id and every attribute and takes the
 * rectangle's spans through `withSpans` (a span of 1 is never written, FR-014; a span kept as
 * read in `extraAttrs.unknownAttrs` goes, C19), and when it stood in another row it moves into
 * the rectangle's top row at its left column, after the hole fill, so the positions of the
 * rectangle no cell covered become its (FR-035); then row compaction (decision 1). Focus: a
 * caret at the start of the merged cell. The plan asks nothing: the host asks before link
 * targets are lost (C13; data-model §6.4).
 */
export function planMerge(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  const check = checkMerge(address);
  if (isRefusal(check)) return check;
  const { table, grid } = address;
  const rect = grid.extend(address.rect!);
  const cells = grid.cellsIn(rect);
  if (cells.length < 2) return NEEDS_BLOCK;
  const owner = grid.owner(rect.top, rect.left);
  const keeper = owner >= 0 ? owner : cells[0]!;
  const node = gridCellNode(table, grid, keeper);
  const parts: Fragment[] = [node.content];
  const removedIds: string[] = [];
  const builder = new TableBuilder(table, grid);
  for (const index of cells) {
    if (index === keeper) continue;
    const other = gridCellNode(table, grid, index);
    parts.push(other.content);
    const id = other.attrs.id;
    if (typeof id === 'string' && id !== '') removedIds.push(id);
    builder.setCell(index, null);
  }
  const merged = node.type.create(
    withSpans(node.attrs, rect.right - rect.left, rect.bottom - rect.top),
    joinInlineParts(parts, node.type.schema),
    node.marks,
  );
  if (grid.cells[keeper]!.row === rect.top) {
    builder.setCell(keeper, merged);
  } else {
    builder.setCell(keeper, null);
    placeCells(builder, rect.top, [{ col: rect.left, node: merged }], ctx);
  }
  return {
    rows: compactRows(table, builder.build()),
    focus: caretAt(rect.top, rect.left),
    removedIds,
  };
}

/**
 * *Split cell* (data-model §4.5 `table.splitCell`; FR-016, FR-047): after `checkSplit`,
 * `splitToSingleCells` on the caret's cell - it keeps its content and every attribute but its
 * spans, a rowspan past the last row going with them; each other position it owns gets an empty
 * cell of its kind, `align`, `valign` and `lang`, without `id`, `style` or `extraAttrs`, placed
 * with the hole fill; positions of its rectangle an earlier cell owns get nothing. Focus: a
 * caret in the cell, which keeps its offset there - its content is the same fragment
 * (data-model §4.3). `removedIds` empty.
 */
export function planSplit(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  const check = checkSplit(address);
  if (isRefusal(check)) return check;
  const { table, grid } = address;
  const index = splitCellIndex(address);
  const cell = grid.cells[index]!;
  return {
    rows: splitToSingleCells(childNodes(table), grid, index, ctx),
    focus: caretAt(cell.row, cell.left),
    removedIds: [],
  };
}

/* ------------------------------------------------------------------------ */
/* US6: header cells (FR-017 to FR-019; data-model §4.5)                    */
/* ------------------------------------------------------------------------ */

/** The kind of a cell: a normal cell or a header cell. */
export type CellKind = 'td' | 'th';

/**
 * `cell` as a `kind` cell (FR-019): `cell.type.schema.nodes[kind].create(cell.attrs,
 * cell.content, cell.marks)` - every attribute as it was (`nodeId`, `id`, `style`, `lang`,
 * spans, `align`, `valign`, `extraAttrs`) and the same content `Fragment`, so a caret in it keeps
 * its offset (data-model §4.3).
 */
export function withKind(cell: PMNode, kind: CellKind): PMNode {
  return cell.type.schema.nodes[kind]!.create(cell.attrs, cell.content, cell.marks);
}

/**
 * The grid cell whose top-left position is `at`, and its node: found through `rowStart`, `left`,
 * `rowChild` and `index`, never through `owner`, so it works on a table too large for the owner
 * map (data-model §2.5). Null when no cell starts there: a position a cell from the left or from
 * above covers, a hole, or a position outside the grid.
 */
export function cellAtTopLeft(
  grid: TableGrid,
  table: PMNode,
  at: GridPos,
): { index: number; node: PMNode } | null {
  if (!Number.isInteger(at.row) || at.row < 0 || at.row >= grid.height) return null;
  // The own cells of a row stand left to right: each starts at or after the previous one's end.
  let lo = grid.rowStart[at.row]!;
  let hi = grid.rowStart[at.row + 1]! - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const left = grid.cells[mid]!.left;
    if (left === at.col) return { index: mid, node: gridCellNode(table, grid, mid) };
    if (left < at.col) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * The owners of every position of the rows (`row`) or columns (`column`) `[from, to)`, as their
 * indices in `grid.cells`: holes skipped, each cell once - "a merged cell counting once"
 * (FR-018) -, in reading order, the cells of other rows that reach into those rows included
 * (data-model §4.5 `table.toggleHeaderRow`); the lines are never extended (C67). Callers check
 * `tooLarge` first.
 */
export function lineOwners(grid: TableGrid, axis: LineAxis, from: number, to: number): number[] {
  return grid.cellsIn(
    axis === 'row'
      ? { top: from, left: 0, bottom: to, right: grid.width }
      : { top: 0, left: from, bottom: grid.height, right: to },
  );
}

/**
 * The focus a header plan keeps: the block over the same rectangle, or the caret; the attribute
 * plans of `attrs.ts` keep it too (US7).
 */
export function keptFocus(address: TableAddress): TableFocus {
  if (address.rect) return blockOver(address.rect);
  const at = address.caret ?? address.head;
  return at ? caretAt(at.row, at.col) : caretAt(0, 0);
}

/**
 * The table's new child list with every cell of `cells` (indices in `grid.cells`) that is not of
 * the kind `kind` made of that kind (`withKind`); `'flip'` turns each cell to the other kind.
 * Every other cell, and every row without a changed cell, stays the same object; a changed row
 * keeps its `nodeId` and attributes (data-model §4.4). Reads no position.
 */
function convertKinds(
  table: PMNode,
  grid: TableGrid,
  cells: readonly number[],
  kind: CellKind | 'flip',
): PMNode[] {
  const builder = new TableBuilder(table, grid);
  for (const index of cells) {
    const node = gridCellNode(table, grid, index);
    const wanted: CellKind = kind !== 'flip' ? kind : node.type.name === 'th' ? 'td' : 'th';
    if (node.type.name !== wanted) builder.setCell(index, withKind(node, wanted));
  }
  return builder.build();
}

/**
 * *Toggle header cell* (data-model §4.5 `table.toggleHeaderCell`; FR-017, FR-019): the head cell
 * (`address.head`, the cell that holds `$head`) when a block is selected, the caret's cell
 * otherwise, becomes `th` when it is `td` and `td` when it is `th` (`withKind`): its content,
 * `nodeId` and every attribute stay. The cell is found through `cellAtTopLeft`, so the plan reads
 * no position and a too-large table is no obstacle (§2.5). Focus kept: the caret, at its offset,
 * or the block.
 */
export function planToggleHeaderCell(address: TableAddress, ctx: PlanContext): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  const at = address.rect ? address.head : address.caret;
  const found = at ? cellAtTopLeft(grid, table, at) : null;
  return {
    rows: convertKinds(table, grid, found ? [found.index] : [], 'flip'),
    focus: keptFocus(address),
    removedIds: [],
  };
}

/**
 * *Make header cells* (`kind: 'th'`) and *Make normal cells* (`kind: 'td'`) (data-model §4.5;
 * FR-017, FR-019), and US11's `setKind`: the target is the owners of the assistant's whole
 * `lines` (`lineOwners`, never extended; C67), else the cells of the rectangle (`cellsIn`; a
 * block's rectangle is extended already), else the caret's cell (`cellAtTopLeft`); every target
 * cell of the other kind changes kind (`withKind`), the others stay. When nothing changes every
 * row is the same object, which `commitTableEdit` answers with null: nothing is dispatched and no
 * undo step recorded (FR-045). `too-large` for `lines` or a rectangle on a table too large for
 * the owner map; with a caret the plan reads no position (§2.5). Focus kept.
 */
export function planSetKind(
  address: TableAddress,
  options: { kind: CellKind },
  ctx: PlanContext,
): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  let cells: number[];
  if (address.lines) {
    if (grid.tooLarge) return TOO_LARGE;
    const lines = linesOf(address, address.lines.axis);
    cells = lines ? lineOwners(grid, address.lines.axis, lines[0], lines[1]) : [];
  } else if (address.rect) {
    if (grid.tooLarge) return TOO_LARGE;
    cells = grid.cellsIn(address.rect);
  } else {
    const found = address.caret ? cellAtTopLeft(grid, table, address.caret) : null;
    cells = found ? [found.index] : [];
  }
  return {
    rows: convertKinds(table, grid, cells, options.kind),
    focus: keptFocus(address),
    removedIds: [],
  };
}

/**
 * *Toggle header row* (`axis: 'row'`) and *Toggle header column* (`axis: 'column'`) (data-model
 * §4.5; FR-018, FR-019): `too-large` first; the cells are the owners (`lineOwners`) of the caret
 * cell's top row or left column - a merged cell's top row and left column (C14; FR-018 as
 * confirmed by analyze decision 3) -, of the block's rows or columns, or of the assistant's
 * `lines` (`unitLines`): holes skipped, each cell once, the cells of other rows that reach in
 * included. When all of them are `th` they all become `td`, otherwise all `th`. Focus kept.
 */
export function planToggleHeaderLines(
  address: TableAddress,
  options: { axis: LineAxis },
  ctx: PlanContext,
): TableEdit | Refusal {
  void ctx;
  const { table, grid } = address;
  if (grid.tooLarge) return TOO_LARGE;
  const unit = unitLines(address, options.axis);
  const cells = unit ? lineOwners(grid, options.axis, unit[0], unit[1]) : [];
  const allHeaders =
    cells.length > 0 && cells.every((index) => gridCellNode(table, grid, index).type.name === 'th');
  return {
    rows: convertKinds(table, grid, cells, allHeaders ? 'td' : 'th'),
    focus: keptFocus(address),
    removedIds: [],
  };
}
