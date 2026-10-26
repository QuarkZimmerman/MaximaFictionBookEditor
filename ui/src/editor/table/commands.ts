/**
 * The table commands' engine side (feature 006; I6; C21; data-model §2.5, §6.5, §9.1, §9.6):
 * their names, which of them read grid positions, the availability predicate behind every
 * command's enable state and reason, and the ProseMirror adapter of a plan.
 *
 * `availability` is cheap: it reads the selection and the cached grid and builds no node, since
 * toolbar buttons evaluate it on every application revision (`ui/src/app/Toolbars.tsx`); the
 * full plan runs only when the command runs. Each command's own check stands in this module's
 * check table (US2: the twelve row and column commands; US5: *Merge cells* and *Split cell*;
 * US8: *Repair table*); `registerAvailabilityCheck` adds or replaces one. `planCommandAt` runs a
 * plan on a table the selection need not be in (the mark's popover, US8).
 */

import { NodeSelection, type Command as PMCommand, type EditorState } from 'prosemirror-state';

import { paragraphNextToTable } from '../commands/tableInsertion';

import {
  commitTableEdit,
  deleteTableTransform,
  isRefusal,
  tableTarget,
  tableTargetAt,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
  type TableTarget,
} from './edit';
import {
  checkDelete,
  checkMerge,
  checkMove,
  checkRepair,
  checkSpanRoom,
  checkSplit,
  insertionLine,
  unitLines,
  type InsertSide,
  type LineAxis,
} from './ops';

/** The 24 table commands, the id of each without `table.` (data-model §9.1). */
export type TableCommandName =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'deleteRow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'deleteColumn'
  | 'mergeCells'
  | 'splitCell'
  | 'toggleHeaderCell'
  | 'makeHeaderCells'
  | 'makeNormalCells'
  | 'toggleHeaderRow'
  | 'toggleHeaderColumn'
  | 'repair'
  | 'select'
  | 'delete'
  | 'moveRowUp'
  | 'moveRowDown'
  | 'moveColumnLeft'
  | 'moveColumnRight'
  | 'duplicateRow'
  | 'duplicateColumn'
  | 'paragraphBefore'
  | 'paragraphAfter';

/** The names in FR-039's order. */
export const TABLE_COMMAND_NAMES: readonly TableCommandName[] = [
  'insertRowAbove',
  'insertRowBelow',
  'deleteRow',
  'insertColumnLeft',
  'insertColumnRight',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderCell',
  'makeHeaderCells',
  'makeNormalCells',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'repair',
  'select',
  'delete',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'duplicateRow',
  'duplicateColumn',
  'paragraphBefore',
  'paragraphAfter',
];

/**
 * The commands that read grid positions and answer `too-large` on a table too large for the
 * owner map, before any other refusal (data-model §2.5).
 */
export const POSITION_COMMANDS: ReadonlySet<TableCommandName> = new Set<TableCommandName>([
  'insertRowAbove',
  'insertRowBelow',
  'deleteRow',
  'insertColumnLeft',
  'insertColumnRight',
  'deleteColumn',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'duplicateRow',
  'duplicateColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'repair',
]);

/** The commands a table selected as a whole does not refuse (data-model §9.6, `tableSelected`). */
export const TABLE_SELECTION_COMMANDS: ReadonlySet<TableCommandName> = new Set<TableCommandName>([
  'select',
  'delete',
  'repair',
  'paragraphBefore',
  'paragraphAfter',
]);

/** A reason that does not come from a plan but from where the selection is (data-model §9.6). */
export interface HostRefusal {
  refused: 'notInTable' | 'mixedSelection' | 'tableSelected';
}

export type Availability = { ok: true } | Refusal | HostRefusal;

/** A command's own availability check: cheap, on the target and its cached grid. */
export type AvailabilityCheck = (target: TableTarget, state: EditorState) => { ok: true } | Refusal;

const OK = { ok: true } as const;

/** The span guard of an insertion at its line (`checkSpanRoom`; data-model §2.5). */
function insertionCheck(axis: LineAxis, side: InsertSide): AvailabilityCheck {
  return ({ address }) => {
    const insertion = insertionLine(address, axis, side);
    return insertion ? checkSpanRoom(address, axis, insertion.line, insertion.count) : OK;
  };
}

/** The span guard of a duplication at line b of its unit `[a, b)`. */
function duplicationCheck(axis: LineAxis): AvailabilityCheck {
  return ({ address }) => {
    const unit = unitLines(address, axis);
    return unit ? checkSpanRoom(address, axis, unit[1], unit[1] - unit[0]) : OK;
  };
}

/**
 * The check table: each command's own check, the cheap part of its plan, which the plan runs
 * first, so the two cannot disagree (C21). US2: the span guard of the insertions and
 * duplications (`checkSpanRoom`), the deletes' `only-row` … `all-columns` (`checkDelete`) and the
 * moves' crossings and bands (`checkMove`). US5: *Merge cells* (`checkMerge`: a block, else
 * `needs-block`) and *Split cell* (`checkSplit`: the caret's cell owning a second position, else
 * `not-merged` for the cell or the block). US6's five header commands register none: they take
 * any cell or block, and the two toggles, which read positions, answer `too-large` from
 * `POSITION_COMMANDS` (data-model §2.5, §4.5). US8: *Repair table* (`checkRepair`: `regular` on a
 * regular table; a selected whole table does not refuse it, `TABLE_SELECTION_COMMANDS`).
 */
const checks = new Map<TableCommandName, AvailabilityCheck>([
  ['insertRowAbove', insertionCheck('row', 'above')],
  ['insertRowBelow', insertionCheck('row', 'below')],
  ['insertColumnLeft', insertionCheck('column', 'left')],
  ['insertColumnRight', insertionCheck('column', 'right')],
  ['deleteRow', ({ address }) => checkDelete(address, 'row')],
  ['deleteColumn', ({ address }) => checkDelete(address, 'column')],
  ['mergeCells', ({ address }) => checkMerge(address)],
  ['splitCell', ({ address }) => checkSplit(address)],
  ['moveRowUp', ({ address }) => checkMove(address, 'up')],
  ['moveRowDown', ({ address }) => checkMove(address, 'down')],
  ['moveColumnLeft', ({ address }) => checkMove(address, 'left')],
  ['moveColumnRight', ({ address }) => checkMove(address, 'right')],
  ['duplicateRow', duplicationCheck('row')],
  ['duplicateColumn', duplicationCheck('column')],
  ['repair', ({ address }) => checkRepair(address) ?? OK],
]);

/**
 * Registers the availability check of a command (a user story does it with its plan); returns
 * the function that removes it again - when it is still the registered one - and puts back the
 * check it replaced.
 */
export function registerAvailabilityCheck(
  name: TableCommandName,
  check: AvailabilityCheck,
): () => void {
  const replaced = checks.get(name);
  checks.set(name, check);
  return () => {
    if (checks.get(name) !== check) return;
    if (replaced) checks.set(name, replaced);
    else checks.delete(name);
  };
}

/**
 * Whether the command `name` can act on `state`'s selection: `notInTable` without a table at
 * the selection, `mixedSelection` for a selection that reaches outside the table,
 * `tableSelected` for a whole table selected (but for the commands of
 * `TABLE_SELECTION_COMMANDS`), `too-large` for a command of `POSITION_COMMANDS` on a table too
 * large for the owner map, then the check the command's story registered, else ok. Builds no
 * node and reads the cached grid only (C21).
 */
export function availability(state: EditorState, name: TableCommandName): Availability {
  const target = tableTarget(state);
  if (!target) return { refused: 'notInTable' };
  if (target.selection === 'mixed') return { refused: 'mixedSelection' };
  if (target.selection === 'table' && !TABLE_SELECTION_COMMANDS.has(name)) {
    return { refused: 'tableSelected' };
  }
  if (POSITION_COMMANDS.has(name) && target.address.grid.tooLarge) return { refused: 'too-large' };
  const check = checks.get(name);
  return check ? check(target, state) : OK;
}

/** True for an `{ok: true}` availability. */
export function isAvailable(answer: Availability): answer is { ok: true } {
  return 'ok' in answer && answer.ok === true;
}

/** A plan: a pure function of the table address (data-model §4). */
export type TablePlan = (address: TableAddress, ctx: PlanContext) => TableEdit | Refusal;

/**
 * The ProseMirror adapter of a plan: the target of the selection, the plan, `commitTableEdit`
 * (one step, `DISCRETE_STEP`). It dispatches nothing for a refusal or a no-op, and answers
 * false then. It asks nothing: the FR-015 question is the host's (`runWithLinkCheck` of the
 * tables feature; C13).
 */
export function planCommand(plan: TablePlan, ctx: PlanContext): PMCommand {
  return (state, dispatch) => {
    const target = tableTarget(state);
    if (!target || target.selection === 'mixed' || target.selection === 'none') return false;
    const edit = plan(target.address, ctx);
    if (isRefusal(edit)) return false;
    const tr = commitTableEdit(state.tr, target.tablePos, edit);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/**
 * `planCommand`'s twin for the table at `tablePos` (I5; data-model §3.5): the plan runs on
 * `tableTargetAt(state, tablePos)` - the selection's target when the selection addresses that
 * table, otherwise the table alone - and `commitTableEdit` maps the selection when it is not in
 * the table, so the caret stays where it was. The mark's popover repairs its own table with it,
 * whatever table holds the caret. Nothing is dispatched for a refusal, a no-op or a position
 * where no table stands.
 */
export function planCommandAt(tablePos: number, plan: TablePlan, ctx: PlanContext): PMCommand {
  return (state, dispatch) => {
    const target = tableTargetAt(state, tablePos);
    if (!target) return false;
    const edit = plan(target.address, ctx);
    if (isRefusal(edit)) return false;
    const tr = commitTableEdit(state.tr, target.tablePos, edit);
    if (!tr) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

/* ------------------------------------------------------------------------ */
/* US9: the whole-table commands (FR-032, FR-033; data-model §4.5)          */
/* ------------------------------------------------------------------------ */

/** The table a whole-table command acts on: a caret's, a block's or the selected table. */
function wholeTableTarget(state: EditorState): TableTarget | null {
  const target = tableTarget(state);
  return target && target.selection !== 'mixed' && target.selection !== 'none' ? target : null;
}

/**
 * *Select table* (data-model §4.5 `table.select`): a `NodeSelection` of the selection's table -
 * the table view puts `fb-selected` on it (T037) -; no document change, no undo step. False
 * without a table.
 */
export const selectTableCommand: PMCommand = (state, dispatch) => {
  const target = wholeTableTarget(state);
  if (!target) return false;
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, target.tablePos)));
  return true;
};

/** *Delete table* (data-model §4.5 `table.delete`): `deleteTableTransform`, one undo step. */
export function deleteTableCommand(ctx: PlanContext): PMCommand {
  return (state, dispatch) => {
    const target = wholeTableTarget(state);
    if (!target) return false;
    if (dispatch) dispatch(deleteTableTransform(state.tr, target.tablePos, () => ctx.nextId()));
    return true;
  };
}

/** *Paragraph before / after table* (FR-033): `paragraphNextToTable`, one undo step. */
export function paragraphCommand(side: 'before' | 'after', ctx: PlanContext): PMCommand {
  return (state, dispatch) => {
    const target = wholeTableTarget(state);
    if (!target) return false;
    if (dispatch) {
      dispatch(paragraphNextToTable(state.tr, target.tablePos, side, () => ctx.nextId()));
    }
    return true;
  };
}
