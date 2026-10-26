/**
 * The command table of the table commands (feature 006; I6; data-model §6.5, §9.1, §9.6): one
 * row per `table.*` command a user story implements - a literal `id: 'table.<name>'`, so the
 * definition scan of `tools/parity-check.mjs` finds it, and the ProseMirror command it runs -
 * and `tableCommand(row)`, the registry entry built from it. `registerTablesFeature` replaces
 * the stub of every id that has a row; the stubs of the commands without one stay until their
 * stories append them. US1 adds `insert.table`, *Add → Table* (`createInsertTableCommand`;
 * data-model §4.5), with its Source view branch (`sourceTable.ts`); US2 the twelve row and
 * column commands; US5 *Merge cells*, which asks the FR-015 question first (`confirm.ts`), and
 * *Split cell*.
 */

import type { Command as PMCommand } from 'prosemirror-state';

import type { Command, CommandContext } from '@/app/commands';
import { findTablePointAt, insertTableCommand } from '@/editor/commands/tableInsertion';
import {
  availability,
  isAvailable,
  planCommand,
  type TableCommandName,
  type TablePlan,
} from '@/editor/table/commands';
import type { PlanContext } from '@/editor/table/edit';
import {
  createTable,
  planDeleteColumns,
  planDeleteRows,
  planDuplicateColumns,
  planDuplicateRows,
  planInsertColumns,
  planInsertRows,
  planMerge,
  planMoveColumns,
  planMoveRows,
  planSplit,
} from '@/editor/table/ops';
import { collectBookIds } from '@/model/ids';
import type { SourceVerdict } from '@/views/source/sourceEditor';

import { runWithLinkCheck } from './confirm';
import { openTableDialog, rememberTableDialog } from './dialog';
import { reasonText } from './reasons';
import {
  runSourceTable,
  sourceTableActive,
  sourceTableReason,
  sourceTableVerdict,
} from './sourceTable';
import { activeTableTarget, type TableEditTarget } from './target';

export interface TableCommandRow {
  id: `table.${TableCommandName}`;
  /** The ProseMirror command to run, made with the host's plan context. */
  command(ctx: PlanContext): PMCommand;
  /** The plan behind `command`, which the FR-015 question makes a dry run of (US5). */
  plan?: TablePlan;
  /**
   * `linkTargets`: before the plan removes cells whose `id` a link targets, ask (FR-015;
   * data-model §6.4) - only the merges do (C13).
   */
  confirm?: 'linkTargets';
}

/**
 * The rows the user stories append (FR-039's order is the registry's, not this table's). US2:
 * the twelve row and column commands (FR-006, FR-038; data-model §4.5), each its plan through
 * `planCommand` - one undo step, nothing dispatched for a refusal, no question asked (C13). US5:
 * *Merge cells* (FR-013 to FR-015), which asks before link targets are lost, and *Split cell*
 * (FR-016), which never asks.
 */
export const TABLE_COMMAND_ROWS: TableCommandRow[] = [
  {
    id: 'table.insertRowAbove',
    command: (ctx) =>
      planCommand((address, c) => planInsertRows(address, { side: 'above' }, c), ctx),
  },
  {
    id: 'table.insertRowBelow',
    command: (ctx) =>
      planCommand((address, c) => planInsertRows(address, { side: 'below' }, c), ctx),
  },
  {
    id: 'table.deleteRow',
    command: (ctx) => planCommand((address, c) => planDeleteRows(address, c), ctx),
  },
  {
    id: 'table.insertColumnLeft',
    command: (ctx) =>
      planCommand((address, c) => planInsertColumns(address, { side: 'left' }, c), ctx),
  },
  {
    id: 'table.insertColumnRight',
    command: (ctx) =>
      planCommand((address, c) => planInsertColumns(address, { side: 'right' }, c), ctx),
  },
  {
    id: 'table.deleteColumn',
    command: (ctx) => planCommand((address, c) => planDeleteColumns(address, c), ctx),
  },
  {
    id: 'table.mergeCells',
    plan: planMerge,
    confirm: 'linkTargets',
    command: (ctx) => planCommand(planMerge, ctx),
  },
  {
    id: 'table.splitCell',
    command: (ctx) => planCommand(planSplit, ctx),
  },
  {
    id: 'table.moveRowUp',
    command: (ctx) =>
      planCommand((address, c) => planMoveRows(address, { direction: 'up' }, c), ctx),
  },
  {
    id: 'table.moveRowDown',
    command: (ctx) =>
      planCommand((address, c) => planMoveRows(address, { direction: 'down' }, c), ctx),
  },
  {
    id: 'table.moveColumnLeft',
    command: (ctx) =>
      planCommand((address, c) => planMoveColumns(address, { direction: 'left' }, c), ctx),
  },
  {
    id: 'table.moveColumnRight',
    command: (ctx) =>
      planCommand((address, c) => planMoveColumns(address, { direction: 'right' }, c), ctx),
  },
  {
    id: 'table.duplicateRow',
    command: (ctx) => planCommand((address, c) => planDuplicateRows(address, c), ctx),
  },
  {
    id: 'table.duplicateColumn',
    command: (ctx) => planCommand((address, c) => planDuplicateColumns(address, c), ctx),
  },
];

/** `insertRowAbove` → `table-insert-row-above`, the icon base name (resource-formats §19). */
export function tableIcon(name: string): string {
  return `table-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function editableTarget(ctx: Pick<CommandContext, 'store'>): TableEditTarget | null {
  const target = activeTableTarget(ctx.store);
  return target && target.editable && target.state ? target : null;
}

/**
 * The registry entry of a row: the group `table`, the keys and icon of data-model §9.1, the
 * hotkey scope `tableTarget` (the registry's `replace` drops the stub's fields, so it is set
 * here again), the default run policy `blocked` (FR-048: unavailable while a script or an
 * assistant request holds the run lock, with the registry's run-lock text); enabled on an
 * active, editable target whose `availability` is ok; its reason `noTarget.table` without such
 * a target, else the refusal's words; `run` checks again and runs the command through the
 * target, with the target's node ids and the book's ids - for a row with `confirm`, through
 * `runWithLinkCheck`, which asks the FR-015 question first where needed and returns the promise
 * of the answer (data-model §9.1).
 */
export function tableCommand(row: TableCommandRow): Command {
  const name = row.id.slice('table.'.length) as TableCommandName;
  return {
    id: row.id,
    group: 'table',
    labelKey: `menu.tableStructure.${name}`,
    tooltipKey: `tables.cmd.${name}.tooltip`,
    descriptionKey: `tables.cmd.${name}.description`,
    icon: tableIcon(name),
    hotkeyScope: 'tableTarget',
    enabled: (ctx) => {
      const target = editableTarget(ctx);
      return !!target && isAvailable(availability(target.state!, name));
    },
    unavailableReason: (ctx) => {
      const target = editableTarget(ctx);
      if (!target) return reasonText('noTarget', { command: row.id }, ctx.t);
      const answer = availability(target.state!, name);
      return isAvailable(answer) ? null : reasonText(answer, ctx.t);
    },
    run: (ctx) => {
      const target = editableTarget(ctx);
      if (!target || !isAvailable(availability(target.state!, name))) return;
      if (row.confirm === 'linkTargets' && row.plan) {
        return runWithLinkCheck(ctx, target, row.plan).then(() => undefined);
      }
      const document = ctx.store.getState().document;
      target.run(
        row.command({
          nextId: () => target.nextNodeId(),
          bookIds: document ? collectBookIds(document) : undefined,
        }),
      );
    },
  };
}

/* ------------------------------------------------------------------------ */
/* insert.table - Add → Table (US1; data-model §4.5)                        */
/* ------------------------------------------------------------------------ */

/** Whether *Add → Table* can insert at the active target's selection (data-model §9.6). */
export type InsertTableAvailability =
  | { ok: true }
  | { refused: 'noTarget' }
  | { refused: 'noTablePlace' }
  | { refused: 'source'; verdict: Exclude<SourceVerdict, { code: 'ok' }> };

/**
 * `insert.table`'s availability: in the Source view the verdict at the cursor (`ok`, or a
 * refusal with its `source.<code>`; FR-061); elsewhere `noTarget` without an active, editable
 * target (the fields' come with US10), `noTablePlace` where FR-004 finds no point at the end of
 * the selection (FR-004 (c)). A cheap read - of the selection's ancestors (C21), or of the
 * Source controller's memoised verdict.
 */
export function insertTableAvailability(
  ctx: Pick<CommandContext, 'store'>,
): InsertTableAvailability {
  if (sourceTableActive(ctx.store)) {
    const verdict = sourceTableVerdict(ctx.store);
    return verdict.code === 'ok' ? { ok: true } : { refused: 'source', verdict };
  }
  const target = editableTarget(ctx);
  if (!target) return { refused: 'noTarget' };
  return findTablePointAt(target.state!) ? { ok: true } : { refused: 'noTablePlace' };
}

/**
 * *Add → Table* (FR-001 to FR-004, FR-040, FR-043, FR-045, FR-048, FR-061): the literal id, the
 * group `edit`, the Add menu's label (C32) and the `table-insert` icon (C27); no hotkey scope,
 * since Alt+T also works in the Source view (C6; decision 15), and the default run policy
 * `blocked`. `run` opens the dialog with the values last confirmed, stores the confirmed ones
 * (without waiting for the answer), checks the place again - at the selection the command
 * started with - and inserts the table there as one undo step, the caret in its first cell; a
 * non-empty selection stays and its end decides (decision 4). With the Source view active it
 * runs the Source branch (`runSourceTable`): the table's XML at the cursor.
 */
export function createInsertTableCommand(): Command {
  return {
    id: 'insert.table',
    group: 'edit',
    labelKey: 'menu.add.table',
    tooltipKey: 'cmd.insert.table.tooltip',
    descriptionKey: 'cmd.insert.table.description',
    icon: 'table-insert',
    enabled: (ctx) => 'ok' in insertTableAvailability(ctx),
    unavailableReason: (ctx) => {
      const answer = insertTableAvailability(ctx);
      if ('ok' in answer) return null;
      switch (answer.refused) {
        case 'source':
          return sourceTableReason(answer.verdict, ctx.t);
        case 'noTarget':
          return reasonText('noTarget', { command: 'insert.table' }, ctx.t);
        default:
          return reasonText('noTablePlace', undefined, ctx.t);
      }
    },
    run: async (ctx) => {
      if (sourceTableActive(ctx.store)) {
        await runSourceTable(ctx);
        return;
      }
      const start = editableTarget(ctx);
      if (!start || !findTablePointAt(start.state!)) return;
      const before = start.state!;
      const values = await openTableDialog(ctx);
      if (!values) return;
      // The values are stored first, best effort; the insertion does not wait for the answer:
      // meanwhile the focus coming back from the dialog would move the editor's caret.
      const stored = rememberTableDialog(ctx, values);
      const target = editableTarget(ctx);
      const state = target?.state;
      if (target && state) {
        // The selection the command started with, when the dialog's focus handling moved it.
        if (state.doc === before.doc && !state.selection.eq(before.selection)) {
          target.setSelection(state.tr.setSelection(before.selection));
        }
        if (findTablePointAt(target.state!)) {
          const nextId = () => target.nextNodeId();
          target.run(
            insertTableCommand(
              createTable(
                values.rows,
                values.columns,
                values.headerRow,
                values.headerColumn,
                nextId,
              ),
              nextId,
            ),
          );
        }
      }
      await stored;
    },
  };
}
