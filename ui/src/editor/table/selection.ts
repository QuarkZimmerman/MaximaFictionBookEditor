/**
 * The block of cells (feature 006, FR-010, FR-011; I7; data-model §5): `CellBlockSelection`, a
 * selection of the project's own over a rectangle of cells of one table, extended to whole
 * merged cells, and the position helpers the table plugin and the plans share.
 *
 * - `$anchorCell` and `$headCell` stand just before two different cells of one table; `rect`
 *   is `extend` of the rectangle they span (data-model §2.6).
 * - `ranges` hold one range over the content of each cell of `cellsIn(rect)`, the top-left
 *   cell first, then reading order: ProseMirror types into the first range, and `from`/`to`
 *   (`selectedText`, the Find dialog's pre-fill) read the top-left cell.
 * - `$anchor` and `$head` both stand at the start of the head cell's content, so every reader
 *   of `$head` sees the head cell: the selection context (the Table bar, the Links bar), the
 *   Body-to-Source mapping and the script API's `selection.get`.
 * - `empty` is always false (Copy and Cut work on a block of empty cells, R5.12) and `visible`
 *   false (the highlight is the plugin's decorations, data-model §5.6).
 * - `replace` and `replaceWith` clear the block with the clear-block plan (US4, data-model
 *   §4.6, §5.3: one step over the changed rows, `DISCRETE_STEP`, the block kept selected) and put
 *   inline content at the start of the block's top-left cell, the caret after it - so the generic
 *   paths (`deleteSelection`, `replaceSelection`, `replaceSelectionWith`, `insertText`) never
 *   change a row. This module reaches `ops.ts` and `edit.ts` at call time only: `edit.ts` uses
 *   the class only inside functions, so the module cycle evaluates no import at load.
 */

import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import {
  Selection,
  SelectionRange,
  TextSelection,
  type SelectionBookmark,
  type Transaction,
} from 'prosemirror-state';
import type { Mappable } from 'prosemirror-transform';

import { flattenToParagraphs, isInlineSlice } from '../plugins/clipboard';

import { commitTableEdit, isRefusal, type TableAddress } from './edit';
import { cellIndexAt, cellRect, gridOfNode, type Rect, type TableGrid } from './grid';
import { joinInlineParts, planClearBlock } from './ops';

/* ------------------------------------------------------------------------ */
/* Cells and their positions                                                */
/* ------------------------------------------------------------------------ */

/** A cell of a table in a document: the cell, its row and table, by position and index. */
export interface CellRef {
  /** The position just before the table. */
  tablePos: number;
  table: PMNode;
  /** The position just before the cell. */
  cellPos: number;
  cell: PMNode;
  /** The row's child index in the table. */
  rowChild: number;
  /** The cell's child index in the row. */
  cellChild: number;
}

/** True for a `td` or `th` node. */
export function isCellNode(node: PMNode | null | undefined): boolean {
  return !!node && (node.type.name === 'td' || node.type.name === 'th');
}

/** The cell that stands right after `cellPos`, when it is a cell of a row of a table. */
export function cellRefAt(doc: PMNode, cellPos: number): CellRef | null {
  if (!Number.isInteger(cellPos) || cellPos < 0 || cellPos >= doc.content.size) return null;
  const $pos = doc.resolve(cellPos);
  const cell = $pos.nodeAfter;
  if (!cell || !isCellNode(cell) || $pos.depth < 2 || $pos.parent.type.name !== 'tr') return null;
  const table = $pos.node($pos.depth - 1);
  if (table.type.name !== 'table') return null;
  return {
    tablePos: $pos.before($pos.depth - 1),
    table,
    cellPos,
    cell,
    rowChild: $pos.index($pos.depth - 1),
    cellChild: $pos.index(),
  };
}

/** The cell of a row of a table that holds `$pos` (in its content), or null. */
export function cellRefAround($pos: ResolvedPos): CellRef | null {
  for (let depth = $pos.depth; depth >= 3; depth -= 1) {
    const cell = $pos.node(depth);
    if (!isCellNode(cell)) continue;
    const row = $pos.node(depth - 1);
    const table = $pos.node(depth - 2);
    if (row.type.name !== 'tr' || table.type.name !== 'table') return null;
    return {
      tablePos: $pos.before(depth - 2),
      table,
      cellPos: $pos.before(depth),
      cell,
      rowChild: $pos.index(depth - 2),
      cellChild: $pos.index(depth - 1),
    };
  }
  return null;
}

/** The index in the grid's `cells` of a cell reference (−1 when the grid lacks it). */
export function gridIndexOf(grid: TableGrid, ref: CellRef): number {
  return cellIndexAt(grid, ref.rowChild, ref.cellChild);
}

const childOffsets = new WeakMap<PMNode, number[]>();

/** The offsets of a node's children inside its content, cached by node identity. */
function offsetsOf(node: PMNode): number[] {
  let offsets = childOffsets.get(node);
  if (!offsets) {
    const found: number[] = [];
    node.forEach((_child, offset) => {
      found.push(offset);
    });
    offsets = found;
    childOffsets.set(node, offsets);
  }
  return offsets;
}

/** The position just before the table's child `index`. */
export function childPosition(parent: PMNode, parentPos: number, index: number): number {
  return parentPos + 1 + offsetsOf(parent)[index]!;
}

/** The position just before the grid cell `index` of the table at `tablePos`. */
export function gridCellPos(
  table: PMNode,
  tablePos: number,
  grid: TableGrid,
  index: number,
): number {
  const cell = grid.cells[index]!;
  const rowChild = grid.rowChild[cell.row]!;
  const rowPos = childPosition(table, tablePos, rowChild);
  return childPosition(table.child(rowChild), rowPos, cell.index);
}

/**
 * The position just before a block's top-left cell in `doc`: the owner of `(rect.top,
 * rect.left)`, else - that position a hole - the first cell of `rect` in reading order; null
 * when no table stands at `tablePos`, it is too large, or the rectangle holds no cell.
 */
export function blockTopLeftCellPos(doc: PMNode, tablePos: number, rect: Rect): number | null {
  const table = doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return null;
  const grid = gridOfNode(table);
  if (grid.tooLarge) return null;
  let index = grid.owner(rect.top, rect.left);
  if (index < 0) index = grid.cellsIn(rect)[0] ?? -1;
  return index < 0 ? null : gridCellPos(table, tablePos, grid, index);
}

/**
 * Content as the one inline run a cell takes (data-model §4.6, §8.3): inline content as it is,
 * other content as `joinInlineParts` of the inline content of its text blocks.
 */
function inlineRun(content: Slice): Fragment {
  if (isInlineSlice(content)) return content.content;
  return joinInlineParts(
    flattenToParagraphs(content.content).map((node) =>
      node.isTextblock ? node.content : Fragment.empty,
    ),
  );
}

/** The clear-block plan creates no node: a node-id generator it must never call. */
function noNewNodes(): string {
  throw new Error('the clear-block plan creates no node');
}

function unionRect(a: Rect, b: Rect): Rect {
  return {
    top: Math.min(a.top, b.top),
    left: Math.min(a.left, b.left),
    bottom: Math.max(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
  };
}

/* ------------------------------------------------------------------------ */
/* The selection                                                            */
/* ------------------------------------------------------------------------ */

export interface CellBlockJSON {
  type: 'mfbe-cell-block';
  anchor: number;
  head: number;
}

export class CellBlockSelection extends Selection {
  /** The position just before the table. */
  readonly tablePos: number;
  /** The position just before the anchor cell. */
  readonly $anchorCell: ResolvedPos;
  /** The position just before the head cell. */
  readonly $headCell: ResolvedPos;
  /** The block: the extended rectangle of the two cells. */
  readonly rect: Rect;

  private constructor(
    $anchorCell: ResolvedPos,
    $headCell: ResolvedPos,
    tablePos: number,
    rect: Rect,
    ranges: readonly SelectionRange[],
  ) {
    const $inHead = $headCell.doc.resolve($headCell.pos + 1);
    super($inHead, $inHead, ranges);
    this.tablePos = tablePos;
    this.$anchorCell = $anchorCell;
    this.$headCell = $headCell;
    this.rect = rect;
  }

  /**
   * The block from the cell after `anchorCellPos` to the cell after `headCellPos`: two
   * different cells of one table. Throws a `RangeError` otherwise, and on a table that is too
   * large (callers check `gridOfNode(table).tooLarge` first; data-model §2.5).
   */
  static create(doc: PMNode, anchorCellPos: number, headCellPos: number): CellBlockSelection {
    const anchor = cellRefAt(doc, anchorCellPos);
    const head = cellRefAt(doc, headCellPos);
    if (!anchor || !head) {
      throw new RangeError('CellBlockSelection: both positions must stand before cells of a table');
    }
    if (anchor.tablePos !== head.tablePos) {
      throw new RangeError('CellBlockSelection: the two cells must lie in one table');
    }
    if (anchorCellPos === headCellPos) {
      throw new RangeError('CellBlockSelection: a block needs two different cells');
    }
    const grid = gridOfNode(anchor.table);
    const anchorIndex = gridIndexOf(grid, anchor);
    const headIndex = gridIndexOf(grid, head);
    const rect = grid.extend(
      unionRect(cellRect(grid.cells[anchorIndex]!), cellRect(grid.cells[headIndex]!)),
    );
    const ranges = grid.cellsIn(rect).map((index) => {
      const cellPos = gridCellPos(anchor.table, anchor.tablePos, grid, index);
      const cell = doc.nodeAt(cellPos)!;
      return new SelectionRange(
        doc.resolve(cellPos + 1),
        doc.resolve(cellPos + 1 + cell.content.size),
      );
    });
    return new CellBlockSelection(
      doc.resolve(anchorCellPos),
      doc.resolve(headCellPos),
      anchor.tablePos,
      rect,
      ranges,
    );
  }

  /** Always false, also for a block of empty cells, so Copy and Cut work (R5.12). */
  override get empty(): boolean {
    return false;
  }

  /** The table node the block lies in. */
  get table(): PMNode {
    return this.$anchorCell.node(this.$anchorCell.depth - 1);
  }

  /** The positions just before the block's cells, in the order of `ranges`. */
  cellPositions(): number[] {
    return this.ranges.map((range) => range.$from.pos - 1);
  }

  /**
   * Clears the block in `tr` (data-model §4.6 "Clear block"): the clear-block plan committed by
   * `commitTableEdit` - one step over the changed rows, `DISCRETE_STEP`, the block kept
   * selected; nothing when every cell is empty. Gives the position before the block's top-left
   * cell afterwards, null when the table is not there or too large for a block.
   */
  private clear(tr: Transaction): number | null {
    const table = tr.doc.nodeAt(this.tablePos);
    if (!table || table.type.name !== 'table') return null;
    const grid = gridOfNode(table);
    if (grid.tooLarge) return null;
    const head = cellRefAt(tr.doc, this.$headCell.pos);
    const index = head ? gridIndexOf(grid, head) : -1;
    const at =
      index >= 0 ? { row: grid.cells[index]!.row, col: grid.cells[index]!.left } : undefined;
    const address: TableAddress = { table, grid, rect: { ...this.rect }, caret: at, head: at };
    const edit = planClearBlock(address, { nextId: noNewNodes });
    if (!isRefusal(edit)) commitTableEdit(tr, this.tablePos, edit);
    return blockTopLeftCellPos(tr.doc, this.tablePos, this.rect);
  }

  /**
   * The block cleared, then non-empty `content` at the start of its top-left cell as one inline
   * run - inline content as it is, other content joined (`joinInlineParts`) - with the caret
   * after it (data-model §5.3); the rows never change.
   */
  override replace(tr: Transaction, content: Slice = Slice.empty): void {
    const cellPos = this.clear(tr);
    if (cellPos === null) {
      super.replace(tr, content);
      return;
    }
    if (content.size === 0) return;
    const run = inlineRun(content);
    if (run.size === 0) return;
    tr.insert(cellPos + 1, run);
    tr.setSelection(TextSelection.create(tr.doc, cellPos + 1 + run.size));
  }

  /**
   * The block cleared, then an inline `node` at the start of its top-left cell with the caret
   * after it; a block node goes nowhere (a cell holds one inline run).
   */
  override replaceWith(tr: Transaction, node: PMNode): void {
    const cellPos = this.clear(tr);
    if (cellPos === null) {
      super.replaceWith(tr, node);
      return;
    }
    if (!node.isInline) return;
    tr.insert(cellPos + 1, node);
    tr.setSelection(TextSelection.create(tr.doc, cellPos + 1 + node.nodeSize));
  }

  /**
   * The block as a closed table slice (R1.6): a table without attributes holding the rows
   * `rect.top … rect.bottom − 1` with their `align`, each with its own cells whose left column
   * lies in the block, as they are (attributes, ids and content); positions no such cell
   * covers stay holes, and a row where none starts is an empty `tr`, which exists only in this
   * slice. One shape for a copied block and a copied table.
   */
  override content(): Slice {
    const table = this.table;
    const grid = gridOfNode(table);
    const { top, bottom, left, right } = this.rect;
    const rows: PMNode[] = [];
    for (let r = top; r < bottom; r += 1) {
      const row = table.child(grid.rowChild[r]!);
      const cells: PMNode[] = [];
      for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
        const cell = grid.cells[index]!;
        if (cell.left >= left && cell.left < right) cells.push(row.child(cell.index));
      }
      rows.push(row.type.create({ align: row.attrs.align ?? null }, cells));
    }
    return new Slice(Fragment.from(table.type.create(null, rows)), 0, 0);
  }

  /**
   * Maps the two cell positions: while both still stand before cells of one table (and
   * neither cell was replaced), a new block, extended again; otherwise a selection near the
   * mapped head.
   */
  map(doc: PMNode, mapping: Mappable): Selection {
    const anchor = mapping.mapResult(this.$anchorCell.pos, 1);
    const head = mapping.mapResult(this.$headCell.pos, 1);
    if (!anchor.deleted && !head.deleted) {
      const block = cellBlockOrNull(doc, anchor.pos, head.pos);
      if (block) return block;
    }
    return Selection.near(doc.resolve(Math.min(head.pos, doc.content.size)), 1);
  }

  /** The same class and the same two cells. */
  eq(other: Selection): boolean {
    return (
      other instanceof CellBlockSelection &&
      other.$anchorCell.pos === this.$anchorCell.pos &&
      other.$headCell.pos === this.$headCell.pos
    );
  }

  /** Keeps the two cell positions, so Undo and Redo restore the block (Body view). */
  override getBookmark(): SelectionBookmark {
    return new CellBlockBookmark(this.$anchorCell.pos, this.$headCell.pos);
  }

  toJSON(): CellBlockJSON {
    return { type: 'mfbe-cell-block', anchor: this.$anchorCell.pos, head: this.$headCell.pos };
  }

  static fromJSON(doc: PMNode, json: unknown): CellBlockSelection {
    const value = json as Partial<CellBlockJSON> | null;
    if (!value || typeof value.anchor !== 'number' || typeof value.head !== 'number') {
      throw new RangeError('Invalid input for CellBlockSelection.fromJSON');
    }
    return CellBlockSelection.create(doc, value.anchor, value.head);
  }
}

CellBlockSelection.prototype.visible = false;

Selection.jsonID('mfbe-cell-block', CellBlockSelection);

/**
 * The block between two cell positions, or null when they are not two different cells of one
 * table or the table is too large for a block.
 */
export function cellBlockOrNull(
  doc: PMNode,
  anchorCellPos: number,
  headCellPos: number,
): CellBlockSelection | null {
  if (anchorCellPos === headCellPos) return null;
  const anchor = cellRefAt(doc, anchorCellPos);
  const head = cellRefAt(doc, headCellPos);
  if (!anchor || !head || anchor.tablePos !== head.tablePos) return null;
  if (gridOfNode(anchor.table).tooLarge) return null;
  return CellBlockSelection.create(doc, anchorCellPos, headCellPos);
}

class CellBlockBookmark implements SelectionBookmark {
  constructor(
    private readonly anchor: number,
    private readonly head: number,
  ) {}

  map(mapping: Mappable): SelectionBookmark {
    const anchor = mapping.mapResult(this.anchor, 1);
    const head = mapping.mapResult(this.head, 1);
    if (anchor.deleted || head.deleted) return new NearBookmark(head.pos);
    return new CellBlockBookmark(anchor.pos, head.pos);
  }

  resolve(doc: PMNode): Selection {
    return (
      cellBlockOrNull(doc, this.anchor, this.head) ??
      Selection.near(doc.resolve(Math.min(this.head, doc.content.size)), 1)
    );
  }
}

/** A bookmark of a block whose cell went away: the selection near where its head was. */
class NearBookmark implements SelectionBookmark {
  constructor(private readonly pos: number) {}

  map(mapping: Mappable): SelectionBookmark {
    return new NearBookmark(mapping.map(this.pos));
  }

  resolve(doc: PMNode): Selection {
    return Selection.near(doc.resolve(Math.min(this.pos, doc.content.size)), 1);
  }
}
