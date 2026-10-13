/**
 * Table commands (T063): insertion from the Table properties dialog (rows + optional header
 * row, as `IDD_TABLE`), Tab navigation between cells (a new row is appended after the last
 * cell, Shift+Tab goes back) and the attribute setters behind the Table bar (table id/style,
 * cell id/style/colspan/rowspan/align/valign, row align).
 */

import type { Command } from 'prosemirror-state';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import {
  ancestor,
  canInsertAt,
  CONTAINER_TYPES,
  createTable,
  N,
  selectInside,
  type Found,
} from './util';

/** Containers that accept a table (FB2: section, annotation, cite). */
const TABLE_PARENTS = new Set(['section', 'annotation', 'cite']);

/** Insert position for a table: after the caret's block, when its container accepts tables. */
export function tableInsertPoint(state: EditorState): { pos: number; index: number } | null {
  const { $from } = state.selection;
  // The nearest container must accept tables (FBE `GetHP`: a title or stanza does not).
  const container = ancestor($from, CONTAINER_TYPES);
  if (!container || !TABLE_PARENTS.has(container.node.type.name)) return null;
  if ($from.depth !== container.depth + 1 || !$from.parent.isTextblock) return null;
  const index = $from.index(container.depth) + 1;
  if (!canInsertAt(container.node, index, N.table!)) return null;
  return { pos: $from.after(), index };
}

export function canInsertTable(state: EditorState): boolean {
  return tableInsertPoint(state) !== null && !ancestor(state.selection.$from, ['table']);
}

/** Inserts a table with `rows` data rows (and a header row) after the current paragraph. */
export function insertTable(rows: number, header: boolean): Command {
  return (state, dispatch) => {
    if (!canInsertTable(state)) return false;
    const point = tableInsertPoint(state)!;
    if (dispatch) {
      const table = createTable(rows, header);
      const tr = state.tr.insert(point.pos, table);
      dispatch(selectInside(tr, point.pos).scrollIntoView());
    }
    return true;
  };
}

/* ------------------------------------------------------------------------ */
/* Cell navigation                                                          */
/* ------------------------------------------------------------------------ */

function cellOf(state: EditorState): Found | null {
  return ancestor(state.selection.$from, ['td', 'th']);
}

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

/** Tab: next cell; after the last cell a new row (same number of cells) is appended. */
export const gotoNextCell: Command = (state, dispatch) => {
  const cell = cellOf(state);
  const table = ancestor(state.selection.$from, ['table']);
  if (!cell || !table) return false;
  const cells = cellPositions(state, table.pos);
  const index = cells.indexOf(cell.pos);
  if (index < 0) return false;
  if (dispatch) {
    if (index + 1 < cells.length) {
      dispatch(selectCellContent(state.tr, cells[index + 1]!).scrollIntoView());
    } else {
      const row = ancestor(state.selection.$from, ['tr'])!;
      const newRow = N.tr!.create(
        { align: row.node.attrs.align },
        row.node.content.content.map((c) => N.td!.create({ colspan: c.attrs.colspan })),
      );
      const insertAt = row.pos + row.node.nodeSize;
      const tr = state.tr.insert(insertAt, newRow);
      dispatch(selectCellContent(tr, insertAt + 1).scrollIntoView());
    }
  }
  return true;
};

/** Shift+Tab: previous cell (stays on the first one). */
export const gotoPreviousCell: Command = (state, dispatch) => {
  const cell = cellOf(state);
  const table = ancestor(state.selection.$from, ['table']);
  if (!cell || !table) return false;
  const cells = cellPositions(state, table.pos);
  const index = cells.indexOf(cell.pos);
  if (index < 0) return false;
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

/** Parses a colspan/rowspan field: positive integers only, anything else clears it. */
export function parseSpan(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 1 ? n : null;
}

export const ALIGN_VALUES = ['', 'left', 'center', 'right'] as const;
export const VALIGN_VALUES = ['', 'top', 'middle', 'bottom'] as const;
