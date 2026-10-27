/**
 * The table grid (feature 006; contracts/document-model.md §4, normative; data-model §2): how
 * the cells of a table occupy positions, when a table is irregular, and its summary. One
 * builder behind two accessors, `gridOfNode` (a ProseMirror `table`) and `gridOfModel` (a
 * model `TableNode`), so both give the same grid; the C++ twin is `mfbe::tables::analyse`, and
 * `tests/fixtures/tables/grid-vectors.json` pins both (the parity rule of §4.14).
 *
 * - **Input** (rule 1): the rows are the table's `tr` children, a row's cells its `td`/`th`
 *   children; every other child (raw XML or a stray element of an invalid book) is ignored by
 *   the analysis but counted by `rowChild` and `GridCell.index`.
 * - **Placement** (rule 3, the HTML table model): a cell of row r starts at the first column,
 *   at or after the end of the previous cell of its row, that no earlier cell covers in row r,
 *   and covers `[c, c + colspan)` of the rows `[r, r + rowsIn)`, `rowsIn = min(rowspan, R - r)`.
 * - **Bounds** (rule 10, C22): the analysis never allocates per column or per position - the
 *   columns covered from the rows above are kept as intervals in a segment tree made on demand
 *   (O((cells + R) · log W)) - while the dense owner map behind `owner`, `extend` and `cellsIn`
 *   is built lazily, cached with the grid, and only while R × W ≤ `MAX_GRID_POSITIONS`; above
 *   that `tooLarge` is true and those three throw a `RangeError` (the commands answer
 *   `too-large`, data-model §2.5).
 * - The analysis never throws, whatever the input (§2.8). This module imports only the model
 *   and the editor (plan.md, Structure Decision).
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { TableNode } from '@/model/document';

/* ------------------------------------------------------------------------ */
/* Effective spans and limits (rule 2; I1, C11)                             */
/* ------------------------------------------------------------------------ */

/** The HTML table model's colspan limit (`kMaxColspan` in `core/include/mfbe/table_grid.hpp`). */
export const MAX_COLSPAN = 1000;
/** The HTML table model's rowspan limit (`kMaxRowspan`). */
export const MAX_ROWSPAN = 65534;
/** The largest R × W the dense owner map is built for (2²², 16 MB of 32-bit indices). */
export const MAX_GRID_POSITIONS = 2 ** 22;

/** The range of the reader's `parse_int` (`core/src/xml/fb2_reader.cpp:98-110`). */
const MAX_READ_VALUE = 1_000_000_000;

function effectiveSpan(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 1;
  if (value < 1 || value > MAX_READ_VALUE) return 1;
  return Math.min(value, limit);
}

/**
 * The colspan the grid counts for an attribute value: a finite number whose value is an
 * integer from 1 to 10⁹ gives `min(v, MAX_COLSPAN)`, everything else 1 - absent or `null`, 0,
 * negatives, fractions, values above 10⁹, strings (`"2"` included) and booleans; a value kept
 * in `unknownAttrs` is never read. The value decides, not the JSON type: `2.0` counts 2 and
 * `1e21` counts 1 (vR3:95).
 */
export function effectiveColspan(value: unknown): number {
  return effectiveSpan(value, MAX_COLSPAN);
}

/** As `effectiveColspan`, capped at `MAX_ROWSPAN`. */
export function effectiveRowspan(value: unknown): number {
  return effectiveSpan(value, MAX_ROWSPAN);
}

/* ------------------------------------------------------------------------ */
/* Types (data-model §2.3, §2.4, §3.1)                                      */
/* ------------------------------------------------------------------------ */

/** A rectangle of grid positions, half-open: rows `top … bottom − 1`, columns `left … right − 1`. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** One cell of the grid, in reading order. */
export interface GridCell {
  /** The row the cell stands in, which is also its top row. */
  readonly row: number;
  /** Its child index in that row's node (non-cell children counted). */
  readonly index: number;
  /** Its first column. */
  readonly left: number;
  /** The effective colspan. */
  readonly colspan: number;
  /** The effective rowspan, which may reach past the last row. */
  readonly rowspan: number;
  /** `min(rowspan, R − row)`. */
  readonly rowsIn: number;
  readonly kind: 'td' | 'th';
  /** It covers a position that an earlier cell covers. */
  readonly overlaps: boolean;
  /** `rowspan > R − row`. */
  readonly pastEnd: boolean;
}

/** One problem of an irregular table (rule 6); there is no fourth kind. */
export type TableProblem =
  | { kind: 'short-row'; row: number; covered: number }
  | { kind: 'overlap'; cell: number }
  | { kind: 'past-end'; cell: number };

/**
 * The summary of a table (document-model §4.8): the params of the validation warning
 * `table.irregular` and of the shared vectors. `row` (counted from 1) and `covered` only when
 * `shortRows >= 1`; `id` only when the table's `id` is a non-empty string.
 */
export interface TableSummary {
  rows: number;
  columns: number;
  shortRows: number;
  row?: number;
  covered?: number;
  overlaps: number;
  pastEnd: number;
  id?: string;
}

export interface TableGrid {
  /** R, the number of rows. */
  readonly height: number;
  /** W, the largest start column plus colspan; 0 without cells. */
  readonly width: number;
  /** Every cell, in reading order. */
  readonly cells: readonly GridCell[];
  /** For each row, the index in `cells` of its first cell; `rowStart[R] = cells.length`. */
  readonly rowStart: readonly number[];
  /** For each row, its child index in the table node. */
  readonly rowChild: readonly number[];
  /** The positions of `[0, W)` covered at row r, by own cells and cells from the rows above. */
  covered(row: number): number;
  /** The length of the covered prefix of row r: the column of its first hole, or W. */
  reach(row: number): number;
  readonly problems: readonly TableProblem[];
  /** No problem of any kind (rule 7). */
  readonly regular: boolean;
  readonly summary: TableSummary;
  /** `R × W > MAX_GRID_POSITIONS`: `owner`, `extend` and `cellsIn` throw. */
  readonly tooLarge: boolean;
  /** The index in `cells` of the owner of `(row, col)`, −1 for a hole or outside the grid. */
  owner(row: number, col: number): number;
  /** `rect` united with every cell owning one of its positions, until it stops changing (§2.6). */
  extend(rect: Rect): Rect;
  /** The cells owning a position of `rect`, once each, in reading order (§2.6). */
  cellsIn(rect: Rect): number[];
}

/* ------------------------------------------------------------------------ */
/* Accessors                                                                */
/* ------------------------------------------------------------------------ */

interface CellInput {
  index: number;
  kind: 'td' | 'th';
  colspan: unknown;
  rowspan: unknown;
}

interface RowInput {
  child: number;
  cells: CellInput[];
}

interface TableInput {
  rows: RowInput[];
  id: unknown;
}

function isCellType(name: unknown): name is 'td' | 'th' {
  return name === 'td' || name === 'th';
}

function inputOfNode(table: PMNode): TableInput {
  const rows: RowInput[] = [];
  table.forEach((child, _offset, childIndex) => {
    if (child.type.name !== 'tr') return;
    const cells: CellInput[] = [];
    child.forEach((cell, _cellOffset, cellIndex) => {
      const kind = cell.type.name;
      if (!isCellType(kind)) return;
      cells.push({
        index: cellIndex,
        kind,
        colspan: cell.attrs.colspan,
        rowspan: cell.attrs.rowspan,
      });
    });
    rows.push({ child: childIndex, cells });
  });
  return { rows, id: table.attrs.id };
}

type LooseJson = { type?: unknown; attrs?: unknown; content?: unknown } | null | undefined;

function attrsOf(json: LooseJson): Record<string, unknown> {
  const attrs = json?.attrs;
  return attrs !== null && typeof attrs === 'object' ? (attrs as Record<string, unknown>) : {};
}

function contentOf(json: LooseJson): LooseJson[] {
  return Array.isArray(json?.content) ? (json.content as LooseJson[]) : [];
}

function inputOfModel(table: TableNode): TableInput {
  const rows: RowInput[] = [];
  contentOf(table as LooseJson).forEach((child, childIndex) => {
    if (child?.type !== 'tr') return;
    const cells: CellInput[] = [];
    contentOf(child).forEach((cell, cellIndex) => {
      const kind = cell?.type;
      if (!isCellType(kind)) return;
      const attrs = attrsOf(cell);
      cells.push({ index: cellIndex, kind, colspan: attrs.colspan, rowspan: attrs.rowspan });
    });
    rows.push({ child: childIndex, cells });
  });
  return { rows, id: attrsOf(table as LooseJson).id };
}

/* ------------------------------------------------------------------------ */
/* Column intervals covered from the rows above                             */
/* ------------------------------------------------------------------------ */

/**
 * A segment tree over the columns `[0, size)` with nodes made on demand: cover counts per
 * canonical node (never pushed down) and the covered length below each node, the structure of
 * the union-of-rectangles sweep. Memory grows with the intervals added, not with the columns.
 */
class CoverTree {
  private readonly count: number[] = [0];
  private readonly length: number[] = [0];
  private readonly lower: number[] = [0];
  private readonly upper: number[] = [0];

  constructor(private readonly size: number) {}

  /** The covered length of the whole range. */
  get total(): number {
    return this.length[0]!;
  }

  add(from: number, to: number, delta: number): void {
    if (from < to) this.update(0, 0, this.size, from, to, delta);
  }

  /** The first column at or after `from` that no interval covers. */
  firstFree(from: number): number {
    const found = this.findFree(0, 0, this.size, from);
    return found < 0 ? this.size : found;
  }

  /** The covered length within `[from, to)`. */
  coveredIn(from: number, to: number): number {
    return from < to ? this.coveredBelow(0, 0, this.size, from, to) : 0;
  }

  private child(node: number, upper: boolean): number {
    const links = upper ? this.upper : this.lower;
    let next = links[node]!;
    if (next === 0) {
      next = this.count.length;
      this.count.push(0);
      this.length.push(0);
      this.lower.push(0);
      this.upper.push(0);
      links[node] = next;
    }
    return next;
  }

  private pull(node: number, lo: number, hi: number): void {
    if (this.count[node]! > 0) {
      this.length[node] = hi - lo;
      return;
    }
    const lower = this.lower[node]!;
    const upper = this.upper[node]!;
    this.length[node] = (lower ? this.length[lower]! : 0) + (upper ? this.length[upper]! : 0);
  }

  private update(node: number, lo: number, hi: number, from: number, to: number, delta: number) {
    if (from <= lo && hi <= to) {
      this.count[node] = this.count[node]! + delta;
      this.pull(node, lo, hi);
      return;
    }
    const mid = lo + (hi - lo) / 2;
    if (from < mid) this.update(this.child(node, false), lo, mid, from, to, delta);
    if (to > mid) this.update(this.child(node, true), mid, hi, from, to, delta);
    this.pull(node, lo, hi);
  }

  private findFree(node: number, lo: number, hi: number, from: number): number {
    if (hi <= from) return -1;
    if (this.count[node]! > 0 || this.length[node] === hi - lo) return -1;
    if (this.length[node] === 0) return Math.max(lo, from);
    const mid = lo + (hi - lo) / 2;
    const lower = this.lower[node]!;
    const inLower =
      lower === 0 ? (mid > from ? Math.max(lo, from) : -1) : this.findFree(lower, lo, mid, from);
    if (inLower >= 0) return inLower;
    const upper = this.upper[node]!;
    return upper === 0 ? Math.max(mid, from) : this.findFree(upper, mid, hi, from);
  }

  private coveredBelow(node: number, lo: number, hi: number, from: number, to: number): number {
    if (to <= lo || hi <= from) return 0;
    if (this.count[node]! > 0) return Math.min(to, hi) - Math.max(from, lo);
    if (from <= lo && hi <= to) return this.length[node]!;
    const mid = lo + (hi - lo) / 2;
    const lower = this.lower[node]!;
    const upper = this.upper[node]!;
    return (
      (lower ? this.coveredBelow(lower, lo, mid, from, to) : 0) +
      (upper ? this.coveredBelow(upper, mid, hi, from, to) : 0)
    );
  }
}

/* ------------------------------------------------------------------------ */
/* The builder                                                              */
/* ------------------------------------------------------------------------ */

class Grid implements TableGrid {
  readonly problems: readonly TableProblem[];
  readonly regular: boolean;
  readonly summary: TableSummary;
  readonly tooLarge: boolean;
  private owners: Int32Array | null = null;

  constructor(
    readonly height: number,
    readonly width: number,
    readonly cells: readonly GridCell[],
    readonly rowStart: readonly number[],
    readonly rowChild: readonly number[],
    private readonly coveredByRow: readonly number[],
    private readonly reachByRow: readonly number[],
    id: unknown,
  ) {
    const problems: TableProblem[] = [];
    let shortRows = 0;
    let firstShort = -1;
    for (let r = 0; r < height; r += 1) {
      const covered = coveredByRow[r]!;
      if (covered < width) {
        problems.push({ kind: 'short-row', row: r, covered });
        shortRows += 1;
        if (firstShort < 0) firstShort = r;
      }
    }
    let overlaps = 0;
    let pastEnd = 0;
    cells.forEach((cell, index) => {
      if (cell.overlaps) {
        problems.push({ kind: 'overlap', cell: index });
        overlaps += 1;
      }
    });
    cells.forEach((cell, index) => {
      if (cell.pastEnd) {
        problems.push({ kind: 'past-end', cell: index });
        pastEnd += 1;
      }
    });
    this.summary = {
      rows: height,
      columns: width,
      shortRows,
      ...(firstShort >= 0 ? { row: firstShort + 1, covered: coveredByRow[firstShort]! } : {}),
      overlaps,
      pastEnd,
      ...(typeof id === 'string' && id !== '' ? { id } : {}),
    };
    this.problems = problems;
    this.regular = problems.length === 0;
    this.tooLarge = height * width > MAX_GRID_POSITIONS;
  }

  covered(row: number): number {
    return this.coveredByRow[row] ?? 0;
  }

  reach(row: number): number {
    return this.reachByRow[row] ?? 0;
  }

  owner(row: number, col: number): number {
    const owners = this.ownerMap();
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) return -1;
    return owners[row * this.width + col]!;
  }

  cellsIn(rect: Rect): number[] {
    const owners = this.ownerMap();
    const { top, left, bottom, right } = this.clamp(rect);
    const found = new Set<number>();
    for (let r = top; r < bottom; r += 1) {
      const base = r * this.width;
      for (let c = left; c < right; c += 1) {
        const owner = owners[base + c]!;
        if (owner >= 0) found.add(owner);
      }
    }
    return [...found].sort((a, b) => a - b);
  }

  extend(rect: Rect): Rect {
    const owners = this.ownerMap();
    const current = this.clamp(rect);
    if (current.top >= current.bottom || current.left >= current.right) return current;
    const seen = new Uint8Array(this.cells.length);
    // The part already scanned: empty at first, then the rectangle of the previous round.
    let scanned: Rect = {
      top: current.top,
      left: current.left,
      bottom: current.top,
      right: current.left,
    };
    for (;;) {
      const next = { ...current };
      for (let r = current.top; r < current.bottom; r += 1) {
        const base = r * this.width;
        const inScannedRows = r >= scanned.top && r < scanned.bottom;
        for (let c = current.left; c < current.right; c += 1) {
          if (inScannedRows && c >= scanned.left && c < scanned.right) {
            c = scanned.right - 1;
            continue;
          }
          const owner = owners[base + c]!;
          if (owner < 0 || seen[owner]) continue;
          seen[owner] = 1;
          const cell = this.cells[owner]!;
          next.top = Math.min(next.top, cell.row);
          next.bottom = Math.max(next.bottom, cell.row + cell.rowsIn);
          next.left = Math.min(next.left, cell.left);
          next.right = Math.max(next.right, cell.left + cell.colspan);
        }
      }
      if (
        next.top === current.top &&
        next.bottom === current.bottom &&
        next.left === current.left &&
        next.right === current.right
      ) {
        return current;
      }
      scanned = { ...current };
      Object.assign(current, next);
    }
  }

  private clamp(rect: Rect): Rect {
    const top = Math.max(0, Math.min(rect.top, this.height));
    const left = Math.max(0, Math.min(rect.left, this.width));
    return {
      top,
      left,
      bottom: Math.max(top, Math.min(rect.bottom, this.height)),
      right: Math.max(left, Math.min(rect.right, this.width)),
    };
  }

  /**
   * The dense owner map, R × W, −1 for a hole: built at the first use, row by row - the cells
   * covering a row, from above and its own, in reading order, each filling the positions still
   * free through a per-row skip list - so every position is written once.
   */
  private ownerMap(): Int32Array {
    if (this.owners) return this.owners;
    if (this.tooLarge) {
      throw new RangeError(
        `table grid of ${this.height} × ${this.width} positions is too large for an owner map`,
      );
    }
    const width = this.width;
    const owners = new Int32Array(this.height * width).fill(-1);
    const next = new Int32Array(width + 1);
    const find = (start: number): number => {
      let root = start;
      while (next[root] !== root) root = next[root]!;
      let at = start;
      while (next[at] !== root) {
        const following = next[at]!;
        next[at] = root;
        at = following;
      }
      return root;
    };
    let active: number[] = [];
    for (let r = 0; r < this.height; r += 1) {
      active = active.filter((index) => {
        const cell = this.cells[index]!;
        return cell.row + cell.rowsIn > r;
      });
      for (let c = 0; c <= width; c += 1) next[c] = c;
      const base = r * width;
      const fill = (index: number) => {
        const cell = this.cells[index]!;
        const end = cell.left + cell.colspan;
        for (let c = find(cell.left); c < end; c = find(c + 1)) {
          owners[base + c] = index;
          next[c] = c + 1;
        }
      };
      for (const index of active) fill(index);
      for (let index = this.rowStart[r]!; index < this.rowStart[r + 1]!; index += 1) {
        fill(index);
        if (this.cells[index]!.rowsIn > 1) active.push(index);
      }
    }
    this.owners = owners;
    return owners;
  }
}

function analyse(input: TableInput): TableGrid {
  const height = input.rows.length;
  // The tree's range: every start column lies below the sum of the colspans.
  let colspanSum = 1;
  for (const row of input.rows) {
    for (const cell of row.cells) colspanSum += effectiveColspan(cell.colspan);
  }
  let size = 1;
  while (size < colspanSum) size *= 2;
  const tree = new CoverTree(size);
  const expiring = new Map<number, { left: number; right: number }[]>();
  const cells: GridCell[] = [];
  const rowStart: number[] = [];
  const rowChild: number[] = [];
  const coveredByRow: number[] = [];
  const reachByRow: number[] = [];
  let width = 0;
  for (let r = 0; r < height; r += 1) {
    const row = input.rows[r]!;
    for (const span of expiring.get(r) ?? []) tree.add(span.left, span.right, -1);
    expiring.delete(r);
    rowStart.push(cells.length);
    rowChild.push(row.child);
    const fromAbove = tree.total > 0;
    const tall: { left: number; right: number; until: number }[] = [];
    let end = 0;
    for (const input of row.cells) {
      const colspan = effectiveColspan(input.colspan);
      const rowspan = effectiveRowspan(input.rowspan);
      const left = fromAbove ? tree.firstFree(end) : end;
      const right = left + colspan;
      const rowsIn = Math.min(rowspan, height - r);
      cells.push({
        row: r,
        index: input.index,
        left,
        colspan,
        rowspan,
        rowsIn,
        kind: input.kind,
        overlaps: fromAbove && tree.coveredIn(left, right) > 0,
        pastEnd: rowspan > height - r,
      });
      if (rowsIn > 1) tall.push({ left, right, until: r + rowsIn });
      end = right;
      width = Math.max(width, right);
    }
    // The own cells and the cells from above cover [0, end) without a gap: every cell starts
    // at the first position from above that is free at or after the previous cell's end.
    if (fromAbove) {
      coveredByRow.push(end + tree.total - tree.coveredIn(0, end));
      reachByRow.push(tree.firstFree(end));
    } else {
      coveredByRow.push(end);
      reachByRow.push(end);
    }
    for (const span of tall) {
      tree.add(span.left, span.right, 1);
      if (span.until < height) {
        let list = expiring.get(span.until);
        if (!list) {
          list = [];
          expiring.set(span.until, list);
        }
        list.push(span);
      }
    }
  }
  rowStart.push(cells.length);
  return new Grid(height, width, cells, rowStart, rowChild, coveredByRow, reachByRow, input.id);
}

/* ------------------------------------------------------------------------ */
/* Cached accessors (§2.7)                                                  */
/* ------------------------------------------------------------------------ */

const nodeGrids = new WeakMap<PMNode, TableGrid>();
const modelGrids = new WeakMap<object, TableGrid>();

/** The grid of a ProseMirror `table` node, cached by node identity. */
export function gridOfNode(table: PMNode): TableGrid {
  let grid = nodeGrids.get(table);
  if (!grid) {
    grid = analyse(inputOfNode(table));
    nodeGrids.set(table, grid);
  }
  return grid;
}

/** The grid of a model `TableNode`, cached by object identity. */
export function gridOfModel(table: TableNode): TableGrid {
  const key = table as object;
  let grid = modelGrids.get(key);
  if (!grid) {
    let input: TableInput;
    try {
      input = inputOfModel(table);
    } catch {
      // A hostile object (a getter that throws): analysed as a table without rows.
      input = { rows: [], id: undefined };
    }
    grid = analyse(input);
    modelGrids.set(key, grid);
  }
  return grid;
}

/* ------------------------------------------------------------------------ */
/* Lookups                                                                  */
/* ------------------------------------------------------------------------ */

/** The row r whose node is child `rowChildIndex` of the table, or −1 when it is no row. */
export function rowOfChild(grid: TableGrid, rowChildIndex: number): number {
  let lo = 0;
  let hi = grid.rowChild.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const child = grid.rowChild[mid]!;
    if (child === rowChildIndex) return mid;
    if (child < rowChildIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * The index in `grid.cells` of the cell that is child `cellChildIndex` of the row that is
 * child `rowChildIndex` of the table (through `rowChild`, `rowStart` and `index`); −1 when
 * there is no such cell.
 */
export function cellIndexAt(
  grid: TableGrid,
  rowChildIndex: number,
  cellChildIndex: number,
): number {
  const row = rowOfChild(grid, rowChildIndex);
  if (row < 0) return -1;
  let lo = grid.rowStart[row]!;
  let hi = grid.rowStart[row + 1]! - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const index = grid.cells[mid]!.index;
    if (index === cellChildIndex) return mid;
    if (index < cellChildIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** The `GridCell` of the cell node at those child indices, or null. */
export function gridCellAt(
  grid: TableGrid,
  rowChildIndex: number,
  cellChildIndex: number,
): GridCell | null {
  const index = cellIndexAt(grid, rowChildIndex, cellChildIndex);
  return index < 0 ? null : grid.cells[index]!;
}

/** The rectangle a grid cell covers: `[row, row + rowsIn) × [left, left + colspan)`. */
export function cellRect(cell: GridCell): Rect {
  return {
    top: cell.row,
    left: cell.left,
    bottom: cell.row + cell.rowsIn,
    right: cell.left + cell.colspan,
  };
}
