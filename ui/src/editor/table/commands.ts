/**
 * The table commands' engine side (feature 006; I6; C21; data-model §2.5, §6.5, §9.1, §9.6):
 * their names, which of them read grid positions, the availability predicate behind every
 * command's enable state and reason, and the ProseMirror adapter of a plan.
 *
 * `availability` is cheap: it reads the selection and the cached grid and builds no node, since
 * toolbar buttons evaluate it on every application revision (`ui/src/app/Toolbars.tsx`); the
 * full plan runs only when the command runs. Each command's own check stands in this module's
 * check table (US2: the twelve row and column commands); `registerAvailabilityCheck` adds or
 * replaces one.
 */

import type { Command as PMCommand, EditorState } from 'prosemirror-state';

import {
  commitTableEdit,
  isRefusal,
  tableTarget,
  type PlanContext,
  type Refusal,
  type TableAddress,
  type TableEdit,
  type TableTarget,
} from './edit';
import {
  checkDelete,
  checkMove,
  checkSpanRoom,
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
 * moves' crossings and bands (`checkMove`).
 */
const checks = new Map<TableCommandName, AvailabilityCheck>([
  ['insertRowAbove', insertionCheck('row', 'above')],
  ['insertRowBelow', insertionCheck('row', 'below')],
  ['insertColumnLeft', insertionCheck('column', 'left')],
  ['insertColumnRight', insertionCheck('column', 'right')],
  ['deleteRow', ({ address }) => checkDelete(address, 'row')],
  ['deleteColumn', ({ address }) => checkDelete(address, 'column')],
  ['moveRowUp', ({ address }) => checkMove(address, 'up')],
  ['moveRowDown', ({ address }) => checkMove(address, 'down')],
  ['moveColumnLeft', ({ address }) => checkMove(address, 'left')],
  ['moveColumnRight', ({ address }) => checkMove(address, 'right')],
  ['duplicateRow', duplicationCheck('row')],
  ['duplicateColumn', duplicationCheck('column')],
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
 * false then. (The FR-015 question is US5's.)
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
