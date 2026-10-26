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

import { gridCellNode, type GridPos, type PlanContext, type TableFocus } from './edit';
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
