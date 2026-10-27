/**
 * Table commands (T063): Tab navigation between cells (a new row is appended after the last
 * cell, Shift+Tab goes back) and the attribute setters behind the Table bar (table id/style,
 * cell id/style/colspan/rowspan/align/valign, row align). Where a new table goes is
 * `ui/src/editor/commands/tableInsertion.ts` (feature 006, FR-004).
 */

import type { Command } from 'prosemirror-state';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { planCommand } from '../table/commands';
import type { PlanContext } from '../table/edit';
import { planTabRow } from '../table/ops';
import { cellRefAround } from '../table/selection';

import { N } from './util';

/* ------------------------------------------------------------------------ */
/* Cell navigation                                                          */
/* ------------------------------------------------------------------------ */

/** Positions of all cells of the table at `tablePos`, in document order. */
export function cellPositions(state: EditorState, tablePos: number): number[] {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return [];
  const cells: number[] = [];
  table.descendants((node, pos) => {
    if (node.type === N.td || node.type === N.th) {
      cells.push(tablePos + 1 + pos);
      return false;
    }
    return true;
  });
  return cells;
}

function selectCellContent(tr: Transaction, cellPos: number): Transaction {
  const cell = tr.doc.nodeAt(cellPos)!;
  return tr.setSelection(
    TextSelection.create(tr.doc, cellPos + 1, cellPos + 1 + cell.content.size),
  );
}

/** The cell of the selection's head (a block's head cell, data-model §4.6) and its index. */
function headCell(state: EditorState): { cells: number[]; index: number } | null {
  const head = cellRefAround(state.selection.$head);
  if (!head) return null;
  const cells = cellPositions(state, head.tablePos);
  const index = cells.indexOf(head.cellPos);
  return index < 0 ? null : { cells, index };
}

/**
 * Tab (FR-005): the next cell, its content selected; in the table's last cell the Tab row
 * (`planTabRow`), a table command of its own: `commitTableEdit` marks it `DISCRETE_STEP`, so it
 * is one undo step between two bursts of typing (C33). A refusal dispatches nothing. `ctx`
 * gives the host's node ids (data-model §1.6).
 */
export function gotoNextCell(ctx: PlanContext): Command {
  return (state, dispatch) => {
    const found = headCell(state);
    if (!found) return false;
    const { cells, index } = found;
    if (index + 1 < cells.length) {
      if (dispatch) dispatch(selectCellContent(state.tr, cells[index + 1]!).scrollIntoView());
      return true;
    }
    return planCommand(planTabRow, ctx)(state, dispatch);
  };
}

/** Shift+Tab: the previous cell; on the first one the caret stays (and the key is handled). */
export const gotoPreviousCell: Command = (state, dispatch) => {
  const found = headCell(state);
  if (!found) return false;
  const { cells, index } = found;
  if (dispatch && index > 0) {
    dispatch(selectCellContent(state.tr, cells[index - 1]!).scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------------ */
/* Attribute setters (Table bar)                                            */
/* ------------------------------------------------------------------------ */

/** Sets one attribute of the node at `pos` (empty / null values remove the attribute). */
export function setNodeAttr(pos: number, name: string, value: string | number | null): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || !node.type.spec.attrs || !(name in node.type.spec.attrs)) return false;
    const normalized = value === '' ? null : value;
    if (node.attrs[name] === normalized) return true;
    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [name]: normalized }, node.marks),
      );
    }
    return true;
  };
}

export const ALIGN_VALUES = ['', 'left', 'center', 'right'] as const;
export const VALIGN_VALUES = ['', 'top', 'middle', 'bottom'] as const;
