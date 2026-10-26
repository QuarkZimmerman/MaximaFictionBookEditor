/**
 * The table plugin (feature 006; data-model §5.2, §5.4; I7; C4; U10): the block of cells as
 * the user makes and sees it, in a host's ProseMirror state.
 *
 * - **Decorations**: the class `mfbe-cell-selected` on each cell of a block (the highlight's
 *   styles are `ui/src/editor/styles.css`'s, data-model §5.6).
 * - **Mouse**: a primary-button press in a cell and a move into another cell of the same table
 *   make the block from the first cell to the hovered one until the button is released;
 *   `createSelectionBetween` gives that block meanwhile, so ProseMirror's text selection does
 *   not show across cells (a drag inside one cell, into another table or out of the table
 *   stays a text selection). Shift+click on another cell of the table makes the block from the
 *   caret's cell (or the block's anchor cell). Ctrl+click and Cmd+click are left to links. A
 *   secondary-button press keeps the selection; the context menu's rules move it (C28).
 * - **Keys**: Shift+Arrow at the edge of the cell's content (`view.endOfTextblock`) makes a
 *   block towards the next grid cell; with a block, its head moves one grid step, holes
 *   skipped, and back on the anchor cell the block becomes a caret there; at the table's edge
 *   the key is left to ProseMirror. Delete and Backspace with a block (with or without Ctrl,
 *   Alt or Mod; Shift+Delete stays the platform's Cut) clear it with the clear-block plan (US4,
 *   data-model §4.6). Plain Up and Down, Tab and Enter are not intercepted (FR-005: Up and Down
 *   leave the table into the adjacent text; Enter stays `enterInCell`'s no-op).
 * - **Type-over** (US4, FR-011): text input with a block is one transaction - the clear, the
 *   text at the start of the block's top-left cell, the caret after it, `DISCRETE_STEP` - so the
 *   clear and the first character are one undo step and the following characters group as
 *   typing. A composition over a block (an input method, a dead key; U39) is one undo step as
 *   well: `compositionstart` selects the content of the block's top-left cell, which the
 *   composition replaces; the transaction of the composition's first change also clears the
 *   block's other cells, and the composition's end closes the undo step; Undo gives the block
 *   back. Every other selection is left alone at once, so typing elsewhere costs nothing more.
 * - **Normalisation** (U10), an appended transaction that sets a selection and never adds a
 *   step (no automatic repair, R1.7): a text selection whose ends lie in two cells of one table
 *   becomes the block between them; a selected `td` or `th` node becomes a text selection over
 *   its content, a selected `tr` the block over its cells - so no `NodeSelection` of a cell or a
 *   row outlives the transaction that made it (data-model §5.8).
 * - **No paste props** at all: the clipboard plugin's router owns every paste (C4).
 */

import { closeHistory } from 'prosemirror-history';
import type { ResolvedPos } from 'prosemirror-model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type SelectionBookmark,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { DISCRETE_STEP } from '../commands/util';

import { commitTableEdit, isRefusal } from './edit';
import { gridOfNode, type Rect, type TableGrid } from './grid';
import { planClearBlock } from './ops';
import {
  CellBlockSelection,
  blockTopLeftCellPos,
  cellBlockOrNull,
  cellRefAround,
  cellRefAt,
  gridCellPos,
  gridIndexOf,
  isCellNode,
  type CellRef,
} from './selection';

export const tableEditingKey = new PluginKey<ComposeOver | null>('mfbe-table-editing');

/** The class a block's cells carry. */
export const CELL_SELECTED_CLASS = 'mfbe-cell-selected';

export type GridDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_DIRECTIONS: Readonly<Record<string, GridDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/* ------------------------------------------------------------------------ */
/* Grid steps                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The cell one grid step from cell `index` in `direction`: the owner of the next position -
 * up `(row − 1, left)`, down `(row + rowsIn, left)`, left `(row, left − 1)`, right
 * `(row, left + colspan)` -, holes skipped; −1 at the table's edge.
 */
export function gridStep(grid: TableGrid, index: number, direction: GridDirection): number {
  const cell = grid.cells[index]!;
  let row = cell.row;
  let col = cell.left;
  const [dRow, dCol] =
    direction === 'up'
      ? [-1, 0]
      : direction === 'down'
        ? [1, 0]
        : direction === 'left'
          ? [0, -1]
          : [0, 1];
  if (direction === 'up') row -= 1;
  else if (direction === 'down') row += cell.rowsIn;
  else if (direction === 'left') col -= 1;
  else col += cell.colspan;
  while (row >= 0 && row < grid.height && col >= 0 && col < grid.width) {
    const owner = grid.owner(row, col);
    if (owner >= 0 && owner !== index) return owner;
    row += dRow;
    col += dCol;
  }
  return -1;
}

/* ------------------------------------------------------------------------ */
/* Selections the plugin makes                                              */
/* ------------------------------------------------------------------------ */

/** The block for a DOM selection between two cells of one table, else null. */
function blockBetween($anchor: ResolvedPos, $head: ResolvedPos): CellBlockSelection | null {
  const anchor = cellRefAround($anchor);
  if (!anchor) return null;
  const head = cellRefAround($head);
  if (!head || head.tablePos !== anchor.tablePos || head.cellPos === anchor.cellPos) return null;
  return cellBlockOrNull($anchor.doc, anchor.cellPos, head.cellPos);
}

/** The selection a `tr` node selection becomes (data-model §5.2). */
function rowSelection(state: EditorState, rowPos: number): Selection {
  const doc = state.doc;
  const row = doc.nodeAt(rowPos)!;
  const cells: number[] = [];
  row.forEach((child, offset) => {
    if (isCellNode(child)) cells.push(rowPos + 1 + offset);
  });
  if (cells.length === 0) return Selection.near(doc.resolve(rowPos), 1);
  const first = cells[0]!;
  const last = cells[cells.length - 1]!;
  if (cells.length === 1) {
    const cell = doc.nodeAt(first)!;
    return TextSelection.create(doc, first + 1, first + 1 + cell.content.size);
  }
  return cellBlockOrNull(doc, first, last) ?? TextSelection.create(doc, first + 1);
}

/** The normalisation of §5.2: a transaction that sets the selection, or null. */
function normalise(state: EditorState): Transaction | null {
  const { selection } = state;
  if (selection instanceof TextSelection) {
    if (selection.empty) return null;
    const block = blockBetween(selection.$anchor, selection.$head);
    return block ? state.tr.setSelection(block) : null;
  }
  if (selection instanceof NodeSelection) {
    const node = selection.node;
    if (isCellNode(node)) {
      const from = selection.from + 1;
      return state.tr.setSelection(TextSelection.create(state.doc, from, from + node.content.size));
    }
    if (node.type.name === 'tr') return state.tr.setSelection(rowSelection(state, selection.from));
  }
  return null;
}

/** The cell a selection starts a Shift+click block from: a caret's cell or a block's anchor. */
function shiftAnchor(selection: Selection): CellRef | null {
  if (selection instanceof CellBlockSelection) {
    return cellRefAt(selection.$anchorCell.doc, selection.$anchorCell.pos);
  }
  if (!(selection instanceof TextSelection)) return null;
  const head = cellRefAround(selection.$head);
  if (!head) return null;
  const anchor = cellRefAround(selection.$anchor);
  return anchor && anchor.cellPos === head.cellPos ? head : null;
}

/* ------------------------------------------------------------------------ */
/* Mouse                                                                    */
/* ------------------------------------------------------------------------ */

interface Drag {
  /** The cell of the press. */
  start: CellRef;
  /** The position of the press, for the text selection inside the first cell. */
  downPos: number;
  stop: () => void;
}

const drags = new WeakMap<EditorView, Drag>();

/** The cell under the viewport point (x, y), or null. */
function cellAtCoords(
  view: EditorView,
  x: number,
  y: number,
): { ref: CellRef; pos: number } | null {
  let found: { pos: number; inside: number } | null;
  try {
    found = view.posAtCoords({ left: x, top: y });
  } catch {
    // jsdom and a detached view measure nothing.
    return null;
  }
  if (!found) return null;
  const doc = view.state.doc;
  const around = cellRefAround(doc.resolve(found.pos));
  if (around) return { ref: around, pos: found.pos };
  if (found.inside >= 0) {
    const ref = cellRefAt(doc, found.inside) ?? cellRefAround(doc.resolve(found.inside));
    if (ref) return { ref, pos: ref.cellPos + 1 };
  }
  return null;
}

function startDrag(view: EditorView, start: CellRef, downPos: number): void {
  drags.get(view)?.stop();
  const root = view.root as Document | ShadowRoot;
  const move = (event: Event) => {
    const drag = drags.get(view);
    if (!drag) return;
    const mouse = event as MouseEvent;
    if (mouse.buttons !== undefined && (mouse.buttons & 1) === 0) {
      drag.stop();
      return;
    }
    const over = cellAtCoords(view, mouse.clientX, mouse.clientY);
    // Outside the table, or in another one: ProseMirror's text selection applies.
    if (!over || over.ref.tablePos !== drag.start.tablePos) return;
    const state = view.state;
    if (over.ref.cellPos === drag.start.cellPos) {
      // Back in the first cell: the text selection from the press.
      if (state.selection instanceof CellBlockSelection) {
        const max = state.doc.content.size;
        view.dispatch(
          state.tr.setSelection(
            TextSelection.create(state.doc, Math.min(drag.downPos, max), Math.min(over.pos, max)),
          ),
        );
      }
      return;
    }
    const block = cellBlockOrNull(state.doc, drag.start.cellPos, over.ref.cellPos);
    if (block && !state.selection.eq(block)) view.dispatch(state.tr.setSelection(block));
  };
  const stop = () => {
    root.removeEventListener('mousemove', move);
    root.removeEventListener('mouseup', stop);
    root.removeEventListener('dragstart', stop);
    if (drags.get(view)?.stop === stop) drags.delete(view);
  };
  root.addEventListener('mousemove', move);
  root.addEventListener('mouseup', stop);
  root.addEventListener('dragstart', stop);
  drags.set(view, { start, downPos, stop });
}

function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
  if (event.button === 2) return keepSelectionOnRightClick(view, event);
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return false;
  const clicked = cellAtCoords(view, event.clientX, event.clientY);
  if (!clicked) return false;
  if (event.shiftKey) {
    const state = view.state;
    const anchor = shiftAnchor(state.selection);
    if (!anchor || anchor.tablePos !== clicked.ref.tablePos) return false;
    let selection: Selection | null;
    if (anchor.cellPos === clicked.ref.cellPos) {
      // On the block's own anchor cell: a caret there; inside the caret's cell: ProseMirror's.
      if (!(state.selection instanceof CellBlockSelection)) return false;
      selection = TextSelection.create(state.doc, clicked.pos);
    } else {
      selection = cellBlockOrNull(state.doc, anchor.cellPos, clicked.ref.cellPos);
    }
    if (!selection) return false;
    view.dispatch(state.tr.setSelection(selection));
    event.preventDefault();
    return true;
  }
  startDrag(view, clicked.ref, clicked.pos);
  return false;
}

/**
 * A right-click keeps the selection - a block, a caret or a text selection (feature 006, C28;
 * data-model §9.3): the browser would otherwise move its caret to the pointer, which
 * ProseMirror reads as the new selection only when that reaches it before the context menu
 * takes the focus, so opening the menu would move the caret or not by a race. The context
 * menu decides instead: its right-click rule puts a caret into a clicked cell that does not
 * hold the selection (`prepare`), and *Table…* moves the caret to the clicked point only when
 * it runs. The editor still takes the focus that the press would give it.
 */
function keepSelectionOnRightClick(view: EditorView, event: MouseEvent): boolean {
  event.preventDefault();
  if (!view.hasFocus()) view.focus();
  return true;
}

/* ------------------------------------------------------------------------ */
/* Keys                                                                     */
/* ------------------------------------------------------------------------ */

/** Delete and Backspace with a block: the clear-block commit (data-model §4.6). */
function clearOnDelete(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return false;
  if (event.key === 'Delete' && event.shiftKey) return false;
  const tr = view.state.tr.deleteSelection();
  if (tr.docChanged) view.dispatch(tr);
  return true;
}

function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  // A key after a composition over a block, before its end step ran (the browser may take input
  // before timers): that step first, so the key's change is not part of the composition's undo
  // step.
  const compose = composeOf(view.state);
  if (compose && !view.composing) finishCompose(view, compose.serial);
  if (view.state.selection instanceof CellBlockSelection && clearOnDelete(view, event)) return true;
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const direction = ARROW_DIRECTIONS[event.key];
  if (!direction) return false;
  const state = view.state;
  const { selection } = state;
  let anchor: CellRef | null;
  let head: CellRef | null;
  if (selection instanceof CellBlockSelection) {
    anchor = cellRefAt(state.doc, selection.$anchorCell.pos);
    head = cellRefAt(state.doc, selection.$headCell.pos);
  } else if (selection instanceof TextSelection) {
    head = cellRefAround(selection.$head);
    anchor = cellRefAround(selection.$anchor);
    if (!head || !anchor || anchor.cellPos !== head.cellPos) return false;
    if (!view.endOfTextblock(direction)) return false;
  } else {
    return false;
  }
  if (!anchor || !head) return false;
  const grid = gridOfNode(head.table);
  if (grid.tooLarge) return false;
  const next = gridStep(grid, gridIndexOf(grid, head), direction);
  if (next < 0) return false;
  const nextPos = gridCellPos(head.table, head.tablePos, grid, next);
  let target: Selection | null;
  if (nextPos === anchor.cellPos) {
    // Back on the anchor cell: a caret there, at the side the head came from.
    const cell = state.doc.nodeAt(nextPos)!;
    const atEnd = direction === 'left' || direction === 'up';
    target = TextSelection.create(state.doc, nextPos + 1 + (atEnd ? cell.content.size : 0));
  } else {
    target = cellBlockOrNull(state.doc, anchor.cellPos, nextPos);
  }
  if (!target) return false;
  view.dispatch(state.tr.setSelection(target).scrollIntoView());
  return true;
}

/* ------------------------------------------------------------------------ */
/* Typing over a block (data-model §4.6 "Type over a block")                */
/* ------------------------------------------------------------------------ */

/**
 * Text typed with a block: the clear, the text at the start of the top-left cell, the caret
 * after it - `insertText` reaches the block's `replaceWith` - in one `DISCRETE_STEP` transaction,
 * also when no cell had content.
 */
function typeOver(view: EditorView, text: string): boolean {
  if (!(view.state.selection instanceof CellBlockSelection)) return false;
  view.dispatch(view.state.tr.insertText(text).setMeta(DISCRETE_STEP, true).scrollIntoView());
  return true;
}

/**
 * A composition over a block (U39; data-model §4.6 "IME and dead keys"), the table plugin's state
 * from `compositionstart` to the composition's end step.
 */
export interface ComposeOver {
  /** Which composition: the end step of an earlier one leaves a later one alone. */
  serial: number;
  /** The table's `nodeId`: a table replaced meanwhile is never cleared. */
  tableNodeId: unknown;
  /** The position just before the table, mapped through every change. */
  tablePos: number;
  rect: Rect;
  /** The grid index of the block's top-left cell, whose content the composition replaces. */
  keep: number;
  /** The top-left cell's `nodeId`: only a composition that types there clears the block. */
  keepNodeId: unknown;
  /** The composition changed the document. */
  changed: boolean;
  /** The block's other cells are cleared. */
  cleared: boolean;
  /** The `composition` meta of the composition's changes (ProseMirror's composition id). */
  composition: unknown;
}

/** The meta of a transaction that sets or drops the plugin's `ComposeOver`. */
interface ComposeMeta {
  compose: ComposeOver | null;
}

/**
 * The content of a block's top-left cell, selected at the start of a composition over the block:
 * a text selection whose bookmark is the block's, so that the undo step the composition starts
 * gives the block back, as the undo step of typing over a block does (data-model §5.7).
 */
export class ComposeOverSelection extends TextSelection {
  constructor(
    $anchor: ResolvedPos,
    $head: ResolvedPos,
    /** The block's bookmark. */
    readonly block: SelectionBookmark,
  ) {
    super($anchor, $head);
  }

  /**
   * The block's bookmark, typed as `TextSelection`'s: its reader, the history, takes any
   * `SelectionBookmark`.
   */
  override getBookmark(): ReturnType<TextSelection['getBookmark']> {
    return this.block as ReturnType<TextSelection['getBookmark']>;
  }
}

function composeOf(state: EditorState): ComposeOver | null {
  return tableEditingKey.getState(state) ?? null;
}

let composeSerial = 0;

/**
 * The transaction `compositionstart` dispatches with a block (U39; data-model §4.6), else null:
 * the content of the block's top-left cell selected as a `ComposeOverSelection` - the composition
 * (an input method's text, a dead key's character) replaces it there -, the undo group before
 * it closed, and the block kept in the plugin's state. The document does not change yet:
 * Chromium places a starting composition by the text offsets its selection had when it began
 * (the block's head cell, where the hidden caret stands), so a change before the composition's
 * first text lands - a clear at `compositionstart` - makes it lose the composition and keep that
 * first text (`に日本` for `日本`, `´é` for `é`; the US4 journey). The composition's first change
 * clears the block's other cells (`composeInto`); from its first text on, the composition is a
 * DOM range that changes elsewhere leave alone, and every other cell of a block follows its
 * top-left cell in the document.
 */
export function composeOverTransaction(state: EditorState): Transaction | null {
  const { selection, doc } = state;
  if (!(selection instanceof CellBlockSelection)) return null;
  const table = doc.nodeAt(selection.tablePos);
  const cellPos = blockTopLeftCellPos(doc, selection.tablePos, selection.rect);
  if (!table || cellPos === null) return null;
  const keep = cellIndexOfPos(gridOfNode(table), doc, cellPos);
  if (keep === null) return null;
  const cell = doc.nodeAt(cellPos)!;
  const compose: ComposeOver = {
    serial: (composeSerial += 1),
    tableNodeId: table.attrs.nodeId,
    tablePos: selection.tablePos,
    rect: { ...selection.rect },
    keep,
    keepNodeId: cell.attrs.nodeId,
    changed: false,
    cleared: false,
    composition: undefined,
  };
  const content = new ComposeOverSelection(
    doc.resolve(cellPos + 1),
    doc.resolve(cellPos + 1 + cell.content.size),
    selection.getBookmark(),
  );
  const meta: ComposeMeta = { compose };
  return closeHistory(state.tr.setSelection(content).setMeta(tableEditingKey, meta));
}

/**
 * `compositionstart`: the end step of an earlier composition over a block first, when it has
 * not run yet (an input method may start the next composition at once); then
 * `composeOverTransaction`, and false - ProseMirror's handling goes on.
 */
function composeOver(view: EditorView): boolean {
  const earlier = composeOf(view.state);
  if (earlier && !view.composing) finishCompose(view, earlier.serial);
  const tr = composeOverTransaction(view.state);
  if (tr) view.dispatch(tr);
  return false;
}

/**
 * The block's other cells cleared in `tr` - the clear-block plan with the top-left cell kept -,
 * the selection where it was in the top-left cell, no `DISCRETE_STEP`: the clear is part of the
 * composition's undo step, which that meta would close before the composition's later changes.
 * False, `tr` unchanged, when the table was replaced or the selection is not in the top-left
 * cell.
 */
function clearOthers(tr: Transaction, compose: ComposeOver): boolean {
  const tablePos = compose.tablePos;
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table' || table.attrs.nodeId !== compose.tableNodeId) {
    return false;
  }
  const { $anchor, $head } = tr.selection;
  const inKept = ($pos: ResolvedPos) => {
    const ref = cellRefAround($pos);
    return !!ref && ref.tablePos === tablePos && ref.cell.attrs.nodeId === compose.keepNodeId;
  };
  const grid = gridOfNode(table);
  if (grid.tooLarge || !inKept($anchor) || !inKept($head)) return false;
  const edit = planClearBlock(
    { table, grid, rect: compose.rect },
    { nextId: noNewNodes },
    { keep: compose.keep },
  );
  if (isRefusal(edit)) return false;
  if (!commitTableEdit(tr, tablePos, edit)) return true;
  // The kept cell stands where it stood: the cells and rows before it are unchanged.
  const cellPos = blockTopLeftCellPos(tr.doc, tablePos, compose.rect)!;
  const at = (offset: number) => cellPos + 1 + offset;
  tr.setSelection(TextSelection.create(tr.doc, at($anchor.parentOffset), at($head.parentOffset)));
  tr.setMeta(DISCRETE_STEP, false);
  return true;
}

/**
 * The DOM caret back at the composition's text, as ProseMirror reads the first change of a
 * composition over a block: Chromium ends a composition step by putting the caret at the text
 * offset its selection had when the composition began - in the block's head cell, where the
 * hidden caret stood - plus the composition's length, and ProseMirror takes the text node at the
 * DOM caret for the composition's when it redraws. With the caret elsewhere it redraws the
 * composition's cell from the document - the text the browser typed into an empty top-left cell
 * as a new text node, a cell of a one-row block in the DOM of the head cell -, which drops the
 * browser's text node and so the composition: Chromium keeps its first text (`¨ü` for `ü`; the
 * US4 journey). The composition replaced all of the cell's content, so its text is the cell's
 * first text node.
 */
function caretToComposition(view: EditorView, cellPos: number): void {
  const cell = view.nodeDOM(cellPos);
  const selection = view.dom.ownerDocument.getSelection();
  if (!cell || !selection || (selection.focusNode && cell.contains(selection.focusNode))) return;
  const text = view.dom.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT).nextNode();
  if (text) selection.collapse(text, text.nodeValue?.length ?? 0);
}

/**
 * A change of a composition over a block that ProseMirror reads as text typed between `from`
 * and `to` (`handleTextInput`), before the block's other cells are cleared: when it lies in the
 * block's top-left cell, the DOM caret back at the composition (`caretToComposition`), then one
 * transaction - ProseMirror's own for the change (`deflt`, which carries its composition id)
 * with the block's other cells cleared (`clearOthers`) -, true. So the clear and the composed
 * text are one undo step (SC-007), whose bookmark is the block, and no appended transaction
 * changes a table (data-model §4.4). False otherwise: ProseMirror applies the change, and the
 * end step clears.
 */
function composeInto(
  view: EditorView,
  from: number,
  to: number,
  deflt: (() => Transaction) | undefined,
): boolean {
  const compose = composeOf(view.state);
  if (!compose || compose.cleared || !view.composing || !deflt) return false;
  const cellPos = blockTopLeftCellPos(view.state.doc, compose.tablePos, compose.rect);
  const cell = cellPos === null ? null : view.state.doc.nodeAt(cellPos);
  if (cellPos === null || !cell || cell.attrs.nodeId !== compose.keepNodeId) return false;
  if (from < cellPos + 1 || to > cellPos + 1 + cell.content.size) return false;
  caretToComposition(view, cellPos);
  const tr = deflt();
  const mapped = { ...compose, tablePos: tr.mapping.map(compose.tablePos) };
  if (!clearOthers(tr, mapped)) return false;
  const composition: unknown = tr.getMeta('composition');
  const meta: ComposeMeta = { compose: { ...mapped, changed: true, cleared: true, composition } };
  view.dispatch(tr.setMeta(tableEditingKey, meta));
  return true;
}

/**
 * `compositionend` after a composition over a block: its end step a macrotask later, once
 * ProseMirror has read the composition's last change (it flushes pending DOM changes in a
 * microtask).
 */
function composeEnd(view: EditorView): boolean {
  const compose = composeOf(view.state);
  if (compose) setTimeout(() => finishCompose(view, compose.serial), 0);
  return false;
}

/**
 * The end step of a composition over a block: the block's other cells cleared if no change of
 * the composition did it - with the composition's id, so in its undo step -; then one
 * transaction drops the block from the plugin's state and closes the undo step, so the
 * characters typed next group as typing - the rule `DISCRETE_STEP` gives typing over a block
 * (§4.6); a composition that changed nothing gives the block back.
 */
function finishCompose(view: EditorView, serial: number): void {
  if (view.isDestroyed) return;
  const compose = composeOf(view.state);
  if (!compose || compose.serial !== serial) return;
  if (compose.changed && !compose.cleared) {
    const tr = view.state.tr;
    if (clearOthers(tr, compose) && tr.docChanged) {
      if (compose.composition) tr.setMeta('composition', compose.composition);
      view.dispatch(tr);
    }
  }
  const { state } = view;
  const meta: ComposeMeta = { compose: null };
  const tr = state.tr.setMeta(tableEditingKey, meta);
  if (!compose.changed && state.selection instanceof ComposeOverSelection) {
    tr.setSelection(state.selection.block.resolve(state.doc));
  }
  view.dispatch(closeHistory(tr));
}

/** The grid index of the cell that stands right after `cellPos`, when it is one of `grid`'s. */
function cellIndexOfPos(grid: TableGrid, doc: EditorState['doc'], cellPos: number): number | null {
  const ref = cellRefAt(doc, cellPos);
  if (!ref) return null;
  const index = gridIndexOf(grid, ref);
  return index < 0 ? null : index;
}

/** The clear-block plan creates no node. */
function noNewNodes(): string {
  throw new Error('the clear-block plan creates no node');
}

/* ------------------------------------------------------------------------ */
/* The plugin                                                               */
/* ------------------------------------------------------------------------ */

function blockDecorations(state: EditorState): DecorationSet | null {
  const { selection } = state;
  if (!(selection instanceof CellBlockSelection)) return null;
  const decorations = selection.cellPositions().map((pos) => {
    const cell = state.doc.nodeAt(pos)!;
    return Decoration.node(pos, pos + cell.nodeSize, { class: CELL_SELECTED_CLASS });
  });
  return DecorationSet.create(state.doc, decorations);
}

export function tableEditingPlugin(): Plugin<ComposeOver | null> {
  return new Plugin<ComposeOver | null>({
    key: tableEditingKey,
    state: {
      init: () => null,
      apply(tr, compose) {
        const meta = tr.getMeta(tableEditingKey) as ComposeMeta | undefined;
        if (meta) return meta.compose;
        if (!compose || !tr.docChanged) return compose;
        return {
          ...compose,
          tablePos: tr.mapping.map(compose.tablePos),
          changed: true,
          composition: compose.composition ?? tr.getMeta('composition'),
        };
      },
    },
    props: {
      decorations: blockDecorations,
      handleDOMEvents: {
        mousedown: handleMouseDown,
        compositionstart: (view) => composeOver(view),
        compositionend: (view) => composeEnd(view),
      },
      handleKeyDown,
      handleTextInput: (view, from, to, text, deflt) =>
        composeInto(view, from, to, deflt) || typeOver(view, text),
      createSelectionBetween(view, $anchor, $head) {
        const drag = drags.get(view);
        if (drag) {
          // A drag that started in a cell: the block from that cell to the cell of the head,
          // while the head is in another cell of the same table.
          const head = cellRefAround($head);
          if (!head || head.tablePos !== drag.start.tablePos) return null;
          if (head.cellPos === drag.start.cellPos) return null;
          return cellBlockOrNull(view.state.doc, drag.start.cellPos, head.cellPos);
        }
        return blockBetween($anchor, $head);
      },
    },
    view(editorView) {
      return {
        destroy() {
          drags.get(editorView)?.stop();
        },
      };
    },
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;
      return normalise(state);
    },
  });
}
