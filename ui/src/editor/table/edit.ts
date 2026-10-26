/**
 * Table edit plans and their commit (feature 006; I4, I5; data-model §1.5, §1.6, §4.1-§4.4;
 * contracts/document-model.md §1.4, §4.12; research R1.4). Every table command runs in two
 * phases: a **plan**, a pure function of the table node, its grid and a target, which returns a
 * `TableEdit` or a `Refusal` and builds nothing outside the table; and a **commit**: one
 * transaction that replaces only the changed rows (one `ReplaceStep`), sets the selection from
 * the plan's focus and marks the step as discrete (`DISCRETE_STEP`, one undo step).
 *
 * - `withSpans` is the only way a plan writes spans: 1 is never written (FR-014), and a span
 *   kept as read in `extraAttrs.unknownAttrs` goes, so no attribute is written twice (C19).
 * - `compactRows`: a row left without a cell is removed, and every cell over it spans one row
 *   fewer (decision 1, FR-007).
 * - `assertTableValid` checks every rule of data-model §4.4 on every commit in development and
 *   in the tests: valid FB2 out of a valid table, spans within the limits, no node id twice, no
 *   new FB2 id beyond the allowed ones, and a regular table stays regular (FR-046).
 * - `tableTarget` reads what a command acts on from the selection and the cached grid.
 * - No automatic repair: nothing here changes a table on its own (R1.7).
 */

import { Fragment, Slice, type Attrs, type Node as PMNode } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Selection,
  type Transaction,
} from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';

import { DISCRETE_STEP } from '../commands/util';

import { MAX_COLSPAN, MAX_ROWSPAN, gridOfNode, type Rect, type TableGrid } from './grid';
import {
  CellBlockSelection,
  cellRefAround,
  gridCellPos,
  gridIndexOf,
  isCellNode,
  type CellRef,
} from './selection';

/* ------------------------------------------------------------------------ */
/* Types (data-model §4.1, §4.2)                                            */
/* ------------------------------------------------------------------------ */

/** A grid position: row and column, from 0. */
export interface GridPos {
  row: number;
  col: number;
}

/** What a command addresses in a table (C14's target rules read it). */
export interface TableAddress {
  table: PMNode;
  grid: TableGrid;
  /** The top-left position of the caret's cell: the cell that holds `$head`. */
  caret?: GridPos;
  /** The block's extended rectangle. */
  rect?: Rect;
  /** The top-left position of the head cell. */
  head?: GridPos;
  /** Whole rows or columns `[from, to)` the assistant names; never extended (C67). */
  lines?: { axis: 'row' | 'column'; from: number; to: number };
}

export type TableSelectionKind = 'cell' | 'block' | 'table' | 'mixed' | 'none';

export interface TableTarget {
  /** The table's position in the host's document. */
  tablePos: number;
  selection: TableSelectionKind;
  address: TableAddress;
}

export interface PlanContext {
  /** The host's node-id generator (the Body controller's `nextNodeId`, data-model §1.6). */
  nextId(): string;
  /** The book's ids, for id checks and pasted ids (data-model §10.2). */
  bookIds?: ReadonlySet<string>;
}

export interface TableFocus {
  kind: 'caret' | 'block';
  /** In grid positions of the new table. */
  rect: Rect;
}

export interface TableEdit {
  /** The table's new child list; unchanged children are the same objects, non-row ones kept. */
  rows: PMNode[];
  /** The table's new attributes, when they change. */
  tableAttrs?: Attrs;
  /** The selection after the commit (§4.3). */
  focus: TableFocus;
  /** The FB2 ids of the cells the plan removes. */
  removedIds: string[];
  /** The FB2 ids the plan may bring into the table (an attribute plan's id, pasted ids). */
  allowedIds?: readonly string[];
  /** The paste of an irregular copy made in the editor, which keeps its grid (analyze decision 4). */
  pastedIrregular?: true;
}

/** A plan's refusal: every code of I4 with its parameters (data-model §4.2). */
export type Refusal =
  | { refused: 'only-row' }
  | { refused: 'all-rows' }
  | { refused: 'only-column' }
  | { refused: 'all-columns' }
  | { refused: 'merged-crosses-border'; params: { axis: 'row' | 'column' } }
  | { refused: 'no-neighbour'; params: { direction: 'up' | 'down' | 'left' | 'right' } }
  | { refused: 'not-merged'; params: { selection: 'cell' | 'block' } }
  | { refused: 'needs-block' }
  | { refused: 'regular' }
  | { refused: 'span-past-edge'; params: { axis: 'column' | 'row' } }
  | { refused: 'merge-needs-block' }
  | { refused: 'too-large' }
  | { refused: 'invalid-id' }
  | { refused: 'duplicate-id'; params: { id: string } }
  | { refused: 'invalid-lang'; params: { value: string } };

export type RefusalCode = Refusal['refused'];

/** The codes of I4, in data-model §4.2's order. */
export const REFUSAL_CODES: readonly RefusalCode[] = [
  'only-row',
  'all-rows',
  'only-column',
  'all-columns',
  'merged-crosses-border',
  'no-neighbour',
  'not-merged',
  'needs-block',
  'regular',
  'span-past-edge',
  'merge-needs-block',
  'too-large',
  'invalid-id',
  'duplicate-id',
  'invalid-lang',
];

const REFUSAL_CODE_SET: ReadonlySet<string> = new Set(REFUSAL_CODES);

/** True for a plan's `Refusal` (a known code under `refused`). */
export function isRefusal(value: unknown): value is Refusal {
  if (value === null || typeof value !== 'object') return false;
  const code = (value as { refused?: unknown }).refused;
  return typeof code === 'string' && REFUSAL_CODE_SET.has(code);
}

/* ------------------------------------------------------------------------ */
/* Nodes and attributes                                                     */
/* ------------------------------------------------------------------------ */

/** The table a plan produced, as a node: pure (the assistant applies it to a detached copy). */
export function applyTableEdit(table: PMNode, edit: TableEdit): PMNode {
  return table.type.create(edit.tableAttrs ?? table.attrs, Fragment.from(edit.rows), table.marks);
}

/** The cell node of grid cell `index`. */
export function gridCellNode(table: PMNode, grid: TableGrid, index: number): PMNode {
  const cell = grid.cells[index]!;
  return table.child(grid.rowChild[cell.row]!).child(cell.index);
}

/**
 * Attributes with spans written the one way a plan may write them (C19; document-model §1.4):
 * on a copy, for each axis given, 1 becomes `null` and 2 or more a number; then the span kept
 * as read in `extraAttrs.unknownAttrs` under that name is deleted, then an emptied
 * `unknownAttrs`, then an emptied `extraAttrs`. The input object is never changed.
 */
export function withSpans(attrs: Attrs, colspan?: number, rowspan?: number): Attrs {
  const out: Record<string, unknown> = { ...attrs };
  const names: string[] = [];
  if (colspan !== undefined) {
    out.colspan = colspan >= 2 ? colspan : null;
    names.push('colspan');
  }
  if (rowspan !== undefined) {
    out.rowspan = rowspan >= 2 ? rowspan : null;
    names.push('rowspan');
  }
  const extra = attrs.extraAttrs as Record<string, unknown> | null | undefined;
  const unknown = extra?.unknownAttrs as Record<string, unknown> | null | undefined;
  if (extra && unknown && typeof unknown === 'object' && names.some((name) => name in unknown)) {
    const nextUnknown = { ...unknown };
    for (const name of names) delete nextUnknown[name];
    const nextExtra: Record<string, unknown> = { ...extra };
    if (Object.keys(nextUnknown).length > 0) nextExtra.unknownAttrs = nextUnknown;
    else delete nextExtra.unknownAttrs;
    out.extraAttrs = Object.keys(nextExtra).length > 0 ? nextExtra : null;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Placing cells (data-model §4.4)                                          */
/* ------------------------------------------------------------------------ */

/**
 * Index by left (r, c): the child index in row r just before its first own cell whose left
 * column is c or more; the end of the row when there is none (R1.5).
 */
export function indexByLeft(row: PMNode, grid: TableGrid, r: number, c: number): number {
  for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
    const cell = grid.cells[index]!;
    if (cell.left >= c) return cell.index;
  }
  return row.childCount;
}

/**
 * Row r with `cell` placed at column c: when `reach(r) < c`, the holes of `[reach(r), c)`
 * first get one empty `td` each, appended at the end of the row (the hole fill: positions the
 * command fills, which FR-035 and FR-046 allow; without it the cell would land in the row's
 * first hole); then the cell goes in at index by left (r, c). Callers check `tooLarge` first.
 */
export function placeCell(
  row: PMNode,
  grid: TableGrid,
  r: number,
  c: number,
  cell: PMNode,
  ctx: PlanContext,
): PMNode {
  const children: PMNode[] = [];
  row.forEach((child) => {
    children.push(child);
  });
  let index = indexByLeft(row, grid, r, c);
  const reach = grid.reach(r);
  if (reach < c) {
    const td = row.type.schema.nodes.td!;
    for (let col = reach; col < c; col += 1) {
      if (grid.owner(r, col) < 0) children.push(td.create({ nodeId: ctx.nextId() }));
    }
    index = children.length;
  }
  children.splice(index, 0, cell);
  return row.type.create(row.attrs, Fragment.from(children), row.marks);
}

/* ------------------------------------------------------------------------ */
/* Row compaction (decision 1, C12; document-model §4.12)                   */
/* ------------------------------------------------------------------------ */

function hasCell(row: PMNode): boolean {
  let found = false;
  row.forEach((child) => {
    if (isCellNode(child)) found = true;
  });
  return found;
}

/**
 * The child list `rows` with every row removed that held at least one cell before the plan
 * (matched by `nodeId` in `before`) and holds none after it - together with its non-cell
 * children -, and every cell over a removed row given one row fewer of rowspan per removed row
 * (`withSpans`). A row that had no cell before (invalid books only) stays as read (FR-035).
 */
export function compactRows(before: PMNode, rows: readonly PMNode[]): PMNode[] {
  const hadCells = new Set<string>();
  before.forEach((child) => {
    const id = child.attrs.nodeId;
    if (child.type.name === 'tr' && typeof id === 'string' && hasCell(child)) hadCells.add(id);
  });
  const remove = rows.map((child) => {
    const id = child.attrs.nodeId;
    return (
      child.type.name === 'tr' && typeof id === 'string' && hadCells.has(id) && !hasCell(child)
    );
  });
  if (!remove.some(Boolean)) return [...rows];
  const grid = gridOfNode(before.type.create(before.attrs, Fragment.from(rows), before.marks));
  const removedRows: number[] = [];
  grid.rowChild.forEach((child, r) => {
    if (remove[child]) removedRows.push(r);
  });
  const next = [...rows];
  for (let r = 0; r < grid.height; r += 1) {
    const childIndex = grid.rowChild[r]!;
    if (remove[childIndex]) continue;
    let changed = false;
    const row = next[childIndex]!;
    const children: PMNode[] = [];
    row.forEach((child) => {
      children.push(child);
    });
    for (let index = grid.rowStart[r]!; index < grid.rowStart[r + 1]!; index += 1) {
      const cell = grid.cells[index]!;
      if (cell.rowsIn < 2) continue;
      const lost = removedRows.filter((rr) => rr > cell.row && rr < cell.row + cell.rowsIn).length;
      if (lost === 0) continue;
      const node = children[cell.index]!;
      children[cell.index] = node.type.create(
        withSpans(node.attrs, undefined, cell.rowspan - lost),
        node.content,
        node.marks,
      );
      changed = true;
    }
    if (changed) next[childIndex] = row.type.create(row.attrs, Fragment.from(children), row.marks);
  }
  return next.filter((_child, index) => !remove[index]);
}

/* ------------------------------------------------------------------------ */
/* assertTableValid (R1.11; data-model §4.4)                                */
/* ------------------------------------------------------------------------ */

function passesCheck(node: PMNode): boolean {
  try {
    node.check();
    return true;
  } catch {
    return false;
  }
}

function children(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => {
    out.push(child);
  });
  return out;
}

function cellsOf(table: PMNode): PMNode[] {
  const out: PMNode[] = [];
  table.forEach((row) => {
    if (row.type.name !== 'tr') return;
    row.forEach((cell) => {
      if (isCellNode(cell)) out.push(cell);
    });
  });
  return out;
}

function fb2Ids(table: PMNode): Set<string> {
  const ids = new Set<string>();
  const add = (node: PMNode) => {
    const id = node.attrs.id;
    if (typeof id === 'string' && id !== '') ids.add(id);
  };
  add(table);
  table.descendants((node) => {
    if (!node.isText) add(node);
    return true;
  });
  return ids;
}

function validSpan(value: unknown, limit: number): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= limit)
  );
}

/**
 * Throws an `Error` naming the rule when `after`, a plan's table, breaks a rule of data-model
 * §4.4 against `before`: a valid table gives a valid one whose every row holds a cell; an
 * invalid one keeps its non-row children and the non-cell children of its kept rows, and every
 * row the plan created or changed holds a cell; new cells write spans of 2 up to the limits or
 * none, and so does every span a plan writes on a changed cell - a span value a changed cell
 * keeps exactly as the cell of `before` with its `nodeId` had it is not written by the plan
 * (a kind change keeps every attribute, FR-019; a value as read stays as written, FR-047); no
 * node id twice; no FB2 id `before` lacks beyond `allowed`; a regular table stays regular
 * unless the edit pasted an irregular editor copy.
 */
export function assertTableValid(
  before: PMNode,
  after: PMNode,
  allowed?: Iterable<string>,
  pastedIrregular?: boolean,
): void {
  const fail = (rule: string) => {
    throw new Error(`assertTableValid: ${rule}`);
  };
  if (passesCheck(before)) {
    if (!passesCheck(after)) fail('the table of a valid table is not valid FB2');
    after.forEach((child) => {
      if (child.type.name === 'tr' && !hasCell(child)) fail('a row holds no cell');
    });
  } else {
    const beforeChildren = new Set(children(before));
    const afterChildren = new Set(children(after));
    for (const child of afterChildren) {
      if (child.type.name === 'tr' && !beforeChildren.has(child) && !hasCell(child)) {
        fail('a row the plan created or changed holds no cell');
      }
    }
    const afterRows = new Map<string, PMNode>();
    for (const child of afterChildren) {
      const id = child.attrs.nodeId;
      if (child.type.name === 'tr' && typeof id === 'string') afterRows.set(id, child);
    }
    for (const child of beforeChildren) {
      if (child.type.name !== 'tr') {
        if (!afterChildren.has(child)) fail('a non-row child of the table was lost');
        continue;
      }
      const kept =
        typeof child.attrs.nodeId === 'string' ? afterRows.get(child.attrs.nodeId) : null;
      if (!kept) continue;
      const keptChildren = new Set(children(kept));
      child.forEach((inner) => {
        if (!isCellNode(inner) && !keptChildren.has(inner)) {
          fail('a non-cell child of a kept row was lost');
        }
      });
    }
  }
  const oldCells = new Set(cellsOf(before));
  const attrsBefore = new Map<string, Attrs>();
  for (const cell of oldCells) {
    const id = cell.attrs.nodeId;
    if (typeof id === 'string') attrsBefore.set(id, cell.attrs);
  }
  for (const cell of cellsOf(after)) {
    if (oldCells.has(cell)) continue;
    const id = cell.attrs.nodeId;
    const was = typeof id === 'string' ? attrsBefore.get(id) : undefined;
    // A span the cell keeps as it was is not written by the plan.
    const writes = (name: 'colspan' | 'rowspan') => !was || was[name] !== cell.attrs[name];
    if (
      (writes('colspan') && !validSpan(cell.attrs.colspan, MAX_COLSPAN)) ||
      (writes('rowspan') && !validSpan(cell.attrs.rowspan, MAX_ROWSPAN))
    ) {
      fail('a new or changed cell writes a span that is not a whole number from 2 to the limit');
    }
  }
  const nodeIds = new Set<string>();
  const visit = (node: PMNode) => {
    const id = node.attrs.nodeId;
    if (typeof id === 'string' && id !== '') {
      if (nodeIds.has(id)) fail(`the node id ${id} occurs twice in the table`);
      nodeIds.add(id);
    }
  };
  visit(after);
  after.descendants((node) => {
    if (!node.isText) visit(node);
    return true;
  });
  const allowedIds = new Set(allowed ?? []);
  const oldIds = fb2Ids(before);
  for (const id of fb2Ids(after)) {
    if (!oldIds.has(id) && !allowedIds.has(id)) fail(`the FB2 id ${id} is new in the table`);
  }
  if (!pastedIrregular && gridOfNode(before).regular && !gridOfNode(after).regular) {
    fail('a regular table became irregular');
  }
}

/* ------------------------------------------------------------------------ */
/* Targets (data-model §4.1)                                                */
/* ------------------------------------------------------------------------ */

/** The table around `$pos` (the table node itself not included), or null. */
function tableAround($pos: Selection['$head']): { table: PMNode; tablePos: number } | null {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'table') return { table: node, tablePos: $pos.before(depth) };
  }
  return null;
}

function positionOf(grid: TableGrid, ref: CellRef): GridPos | undefined {
  const index = gridIndexOf(grid, ref);
  if (index < 0) return undefined;
  const cell = grid.cells[index]!;
  return { row: cell.row, col: cell.left };
}

/**
 * What the selection addresses (data-model §4.1): null when no end of it lies in a table;
 * `block` for a block of cells, `table` for the table selected as a node, `cell` for a caret
 * or a selection inside one cell, `mixed` for a selection with an end outside the table (or
 * one whose ends lie in two cells of a table, which a host's plugin makes a block before a
 * command sees it). `caret` and `head` are the top-left position of the cell holding `$head`,
 * read from the cached grid without building a node.
 */
export function tableTarget(state: EditorState): TableTarget | null {
  const { selection } = state;
  if (selection instanceof CellBlockSelection) {
    const table = selection.table;
    const grid = gridOfNode(table);
    const head = cellRefAround(selection.$head);
    const at = head ? positionOf(grid, head) : undefined;
    return {
      tablePos: selection.tablePos,
      selection: 'block',
      address: { table, grid, caret: at, head: at, rect: { ...selection.rect } },
    };
  }
  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    const table = selection.node;
    return {
      tablePos: selection.from,
      selection: 'table',
      address: { table, grid: gridOfNode(table) },
    };
  }
  const headCell = cellRefAround(selection.$head);
  const anchorCell = cellRefAround(selection.$anchor);
  if (headCell && anchorCell && headCell.cellPos === anchorCell.cellPos) {
    const grid = gridOfNode(headCell.table);
    const at = positionOf(grid, headCell);
    return {
      tablePos: headCell.tablePos,
      selection: 'cell',
      address: { table: headCell.table, grid, caret: at, head: at },
    };
  }
  const around = tableAround(selection.$head) ?? tableAround(selection.$anchor);
  if (!around) return null;
  const grid = gridOfNode(around.table);
  const address: TableAddress = { table: around.table, grid };
  if (headCell && headCell.tablePos === around.tablePos) {
    const at = positionOf(grid, headCell);
    address.caret = at;
    address.head = at;
  }
  return { tablePos: around.tablePos, selection: 'mixed', address };
}

/**
 * The target of the table at `tablePos` (the mark's popover, US8): the selection's target when
 * the selection addresses that table, otherwise `selection: 'none'`. Null when no table stands
 * there.
 */
export function tableTargetAt(state: EditorState, tablePos: number): TableTarget | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return null;
  const target = tableTarget(state);
  if (target && target.tablePos === tablePos) return target;
  return { tablePos, selection: 'none', address: { table, grid: gridOfNode(table) } };
}

/* ------------------------------------------------------------------------ */
/* The commit (data-model §4.3)                                             */
/* ------------------------------------------------------------------------ */

function offsetOfChild(node: PMNode, index: number): number {
  let offset = 0;
  for (let i = 0; i < index && i < node.childCount; i += 1) offset += node.child(i).nodeSize;
  return offset;
}

function changedAttrKeys(old: Attrs, next: Attrs): string[] {
  const keys = new Set([...Object.keys(old), ...Object.keys(next)]);
  return [...keys].filter((key) => (old[key] ?? null) !== (next[key] ?? null));
}

/** The owner of (row, col), also on a grid too large for the owner map (a scan of the cells). */
function ownerAt(grid: TableGrid, row: number, col: number): number {
  if (!grid.tooLarge) return grid.owner(row, col);
  const end = grid.rowStart[Math.min(row + 1, grid.height)] ?? grid.cells.length;
  for (let index = 0; index < end; index += 1) {
    const cell = grid.cells[index]!;
    if (cell.row <= row && row < cell.row + cell.rowsIn && cell.left <= col) {
      if (col < cell.left + cell.colspan) return index;
    }
  }
  return -1;
}

/** The cell a caret focus goes into: the owner of (row, col), else a cell of that row. */
function caretCell(grid: TableGrid, row: number, col: number): number {
  if (grid.height === 0) return -1;
  const r = Math.max(0, Math.min(row, grid.height - 1));
  const owner = ownerAt(grid, r, col);
  if (owner >= 0) return owner;
  // A hole of an irregular table: the row's last own cell before it, or its first own cell.
  const start = grid.rowStart[r]!;
  const end = grid.rowStart[r + 1]!;
  let found = -1;
  for (let index = start; index < end; index += 1) {
    if (grid.cells[index]!.left < col) found = index;
  }
  if (found >= 0) return found;
  if (end > start) return start;
  return grid.cells.length > 0 ? 0 : -1;
}

function selectionInside(selection: Selection, tablePos: number, table: PMNode): boolean {
  if (selection instanceof NodeSelection && selection.from === tablePos) return false;
  const head = selection.head;
  return head > tablePos && head < tablePos + table.nodeSize;
}

function focusSelection(
  tr: Transaction,
  tablePos: number,
  focus: TableFocus,
  old: Selection,
  oldCell: CellRef | null,
): Selection | null {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return null;
  const grid = gridOfNode(table);
  const caretTo = (index: number): Selection | null => {
    if (index < 0) return null;
    const cellPos = gridCellPos(table, tablePos, grid, index);
    const cell = tr.doc.nodeAt(cellPos)!;
    const offset =
      oldCell && oldCell.cell.content === cell.content
        ? Math.min(old.$head.parentOffset, cell.content.size)
        : 0;
    return TextSelection.create(tr.doc, cellPos + 1 + offset);
  };
  const { rect } = focus;
  if (focus.kind === 'caret' || grid.tooLarge) {
    return caretTo(caretCell(grid, rect.top, rect.left));
  }
  // A block: the cells it was made from when both lie in the rectangle, else its corners.
  const inRect = (index: number) => {
    const cell = grid.cells[index]!;
    return (
      cell.row >= rect.top &&
      cell.row < rect.bottom &&
      cell.left >= rect.left &&
      cell.left < rect.right
    );
  };
  const indexOfNodeId = (id: unknown): number => {
    if (typeof id !== 'string') return -1;
    for (let index = 0; index < grid.cells.length; index += 1) {
      if (gridCellNode(table, grid, index).attrs.nodeId === id) return index;
    }
    return -1;
  };
  let anchor = -1;
  let head = -1;
  if (old instanceof CellBlockSelection) {
    anchor = indexOfNodeId(old.$anchorCell.nodeAfter?.attrs.nodeId);
    head = indexOfNodeId(old.$headCell.nodeAfter?.attrs.nodeId);
    if (anchor < 0 || head < 0 || anchor === head || !inRect(anchor) || !inRect(head)) {
      anchor = -1;
      head = -1;
    }
  }
  if (anchor < 0) {
    const cells = grid.cellsIn(rect);
    anchor = grid.owner(rect.top, rect.left);
    head = grid.owner(rect.bottom - 1, rect.right - 1);
    if (anchor < 0) anchor = cells[0] ?? -1;
    if (head < 0) head = cells[cells.length - 1] ?? -1;
  }
  if (anchor < 0 || head < 0 || anchor === head) return caretTo(anchor >= 0 ? anchor : head);
  return CellBlockSelection.create(
    tr.doc,
    gridCellPos(table, tablePos, grid, anchor),
    gridCellPos(table, tablePos, grid, head),
  );
}

/**
 * Commits a plan's edit of the table at `tablePos` to `tr` (data-model §4.3): one
 * `ReplaceStep` from the first to the last child that differs by identity (unchanged rows keep
 * their nodes and their DOM; a table holding a non-row child, which only invalid books have, is
 * replaced as a whole node), the changed table attributes in the same transaction, the
 * selection from the edit's focus - or, when the selection was not inside the table, the old
 * selection mapped -, `DISCRETE_STEP` and `scrollIntoView`. Null for a no-op: the host then
 * dispatches nothing and records no undo step. In development and in the tests every commit
 * runs `assertTableValid`.
 */
export function commitTableEdit(
  tr: Transaction,
  tablePos: number,
  edit: TableEdit,
): Transaction | null {
  const before = tr.doc.nodeAt(tablePos);
  if (!before || before.type.name !== 'table') {
    throw new RangeError(`commitTableEdit: no table at ${tablePos}`);
  }
  const rows = edit.rows;
  let start = 0;
  while (start < before.childCount && start < rows.length && before.child(start) === rows[start]) {
    start += 1;
  }
  let endOld = before.childCount;
  let endNew = rows.length;
  while (endOld > start && endNew > start && before.child(endOld - 1) === rows[endNew - 1]) {
    endOld -= 1;
    endNew -= 1;
  }
  const childrenChanged = start < endOld || start < endNew;
  const nextAttrs = edit.tableAttrs ?? before.attrs;
  const attrKeys = changedAttrKeys(before.attrs, nextAttrs);
  if (!childrenChanged && attrKeys.length === 0) return null;
  if (import.meta.env.DEV) {
    assertTableValid(before, applyTableEdit(before, edit), edit.allowedIds, edit.pastedIrregular);
  }
  const old = tr.selection;
  const oldCell = cellRefAround(old.$head);
  const inside = selectionInside(old, tablePos, before);
  if (childrenChanged) {
    if (before.type.validContent(Fragment.from(rows))) {
      const from = tablePos + 1 + offsetOfChild(before, start);
      const to = tablePos + 1 + offsetOfChild(before, endOld);
      tr.step(new ReplaceStep(from, to, new Slice(Fragment.from(rows.slice(start, endNew)), 0, 0)));
      for (const key of attrKeys) tr.setNodeAttribute(tablePos, key, nextAttrs[key]);
    } else {
      const table = applyTableEdit(before, edit);
      tr.step(
        new ReplaceStep(
          tablePos,
          tablePos + before.nodeSize,
          new Slice(Fragment.from(table), 0, 0),
        ),
      );
    }
  } else {
    for (const key of attrKeys) tr.setNodeAttribute(tablePos, key, nextAttrs[key]);
  }
  if (inside) {
    const selection = focusSelection(tr, tablePos, edit.focus, old, oldCell);
    if (selection) tr.setSelection(selection);
  }
  return tr.setMeta(DISCRETE_STEP, true).scrollIntoView();
}

/* ------------------------------------------------------------------------ */
/* The Delete table transform (data-model §4.5 `table.delete`; C24)         */
/* ------------------------------------------------------------------------ */

/**
 * Removes the table at `tablePos` in `tr` (data-model §4.5 `table.delete` steps 1 and 2): when
 * its container's content model then needs a block there - a section's only content, the only
 * content of the Body view's annotation or history block (feature 004) - or a description
 * field's document would be left without content (an empty field always holds a paragraph,
 * `createRichFieldState`), an empty `p` with a fresh node id from `nextId()` takes its place; a
 * section annotation and a cite need none. It asks nothing about link targets (C13). ProseMirror's
 * generic `deleteSelection` throws when the table is a section's only content (vR2 X3), so the
 * paste router, and US9's *Delete table*, Cut, Delete and Backspace on a selected table, use this
 * transform. The selection is left to the caller.
 */
export function removeTable(tr: Transaction, tablePos: number, nextId: () => string): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') {
    throw new RangeError(`removeTable: no table at ${tablePos}`);
  }
  const $pos = tr.doc.resolve(tablePos);
  const parent = $pos.parent;
  const index = $pos.index();
  const rest: PMNode[] = [];
  parent.forEach((child, _offset, childIndex) => {
    if (childIndex !== index) rest.push(child);
  });
  const needsBlock =
    !parent.type.validContent(Fragment.from(rest)) || ($pos.depth === 0 && rest.length === 0);
  const end = tablePos + table.nodeSize;
  if (needsBlock) {
    tr.replaceWith(tablePos, end, table.type.schema.nodes.p!.create({ nodeId: nextId() }));
  } else {
    tr.delete(tablePos, end);
  }
  return tr;
}
