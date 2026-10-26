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
 *   typing; `compositionstart` with a block selects the content of its top-left cell, which the
 *   composition (an input method, a dead key) replaces, and the block's other cells are cleared
 *   in a `DISCRETE_STEP` transaction when the composition ends (U39). Every other selection is left alone at once, so typing elsewhere
 *   costs nothing more.
 * - **Normalisation** (U10), an appended transaction that sets a selection and never adds a
 *   step (no automatic repair, R1.7): a text selection whose ends lie in two cells of one table
 *   becomes the block between them; a selected `td` or `th` node becomes a text selection over
 *   its content, a selected `tr` the block over its cells - so no `NodeSelection` of a cell or a
 *   row outlives the transaction that made it (data-model §5.8).
 * - **No paste props** at all: the clipboard plugin's router owns every paste (C4).
 */

import type { ResolvedPos } from 'prosemirror-model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
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

export const tableEditingKey = new PluginKey('mfbe-table-editing');

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

/** A block whose other cells are cleared when the composition over it ends (U39). */
interface PendingClear {
  tableNodeId: unknown;
  tablePos: number;
  rect: Rect;
  /** The grid index of the top-left cell, which the composition replaced. */
  keep: number;
}

const pendingClears = new WeakMap<EditorView, PendingClear>();

/**
 * The start of a composition with a block (U39): the content of the block's top-left cell is
 * selected - no document change, so the browser composes undisturbed: a transaction that
 * changes the document under a starting composition makes Chromium keep its first text (US4
 * journey) - and the composition (an input method's text, a dead key's character) replaces it
 * there; false, so ProseMirror's composition handling goes on. The block's other cells are
 * cleared when the composition ends (`composeEnd`).
 */
function composeOver(view: EditorView): boolean {
  const { selection } = view.state;
  if (!(selection instanceof CellBlockSelection)) return false;
  const doc = view.state.doc;
  const cellPos = blockTopLeftCellPos(doc, selection.tablePos, selection.rect);
  if (cellPos === null) return false;
  const table = doc.nodeAt(selection.tablePos)!;
  pendingClears.set(view, {
    tableNodeId: table.attrs.nodeId,
    tablePos: selection.tablePos,
    rect: { ...selection.rect },
    keep: cellIndexOfPos(gridOfNode(table), doc, cellPos) ?? -1,
  });
  const size = doc.nodeAt(cellPos)!.content.size;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(doc, cellPos + 1, cellPos + 1 + size)),
  );
  return false;
}

/**
 * The end of a composition that began over a block: once ProseMirror has read the composed text
 * (a macrotask later), the block's other cells are cleared - the clear-block plan with the
 * top-left cell kept, one `DISCRETE_STEP` transaction, so it is an undo step of its own - and
 * the caret stays after the composed text.
 */
function composeEnd(view: EditorView): boolean {
  const pending = pendingClears.get(view);
  if (!pending) return false;
  pendingClears.delete(view);
  setTimeout(() => clearAfterComposition(view, pending), 0);
  return false;
}

function clearAfterComposition(view: EditorView, pending: PendingClear): void {
  if (view.isDestroyed) return;
  const state = view.state;
  const table = state.doc.nodeAt(pending.tablePos);
  if (!table || table.type.name !== 'table' || table.attrs.nodeId !== pending.tableNodeId) return;
  const grid = gridOfNode(table);
  if (grid.tooLarge) return;
  const edit = planClearBlock(
    { table, grid, rect: pending.rect },
    { nextId: noNewNodes },
    { keep: pending.keep },
  );
  if (isRefusal(edit)) return;
  const old = state.selection;
  const kept = cellRefAround(old.$head);
  const tr = commitTableEdit(state.tr, pending.tablePos, edit);
  if (!tr) return;
  const cellPos = blockTopLeftCellPos(tr.doc, pending.tablePos, pending.rect);
  const cell = cellPos === null ? null : tr.doc.nodeAt(cellPos);
  if (cellPos !== null && cell && kept && kept.cell.attrs.nodeId === cell.attrs.nodeId) {
    const offset = Math.min(old.$head.parentOffset, cell.content.size);
    tr.setSelection(TextSelection.create(tr.doc, cellPos + 1 + offset));
  } else {
    tr.setSelection(old.map(tr.doc, tr.mapping));
  }
  view.dispatch(tr);
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

export function tableEditingPlugin(): Plugin {
  return new Plugin({
    key: tableEditingKey,
    props: {
      decorations: blockDecorations,
      handleDOMEvents: {
        mousedown: handleMouseDown,
        compositionstart: (view) => composeOver(view),
        compositionend: (view) => composeEnd(view),
      },
      handleKeyDown,
      handleTextInput: (view, _from, _to, text) => typeOver(view, text),
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
