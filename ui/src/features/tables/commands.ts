/**
 * The command table of the table commands (feature 006; I6; data-model §6.5, §9.1, §9.6): one
 * row per `table.*` command a user story implements - a literal `id: 'table.<name>'`, so the
 * definition scan of `tools/parity-check.mjs` finds it, and the ProseMirror command it runs -
 * and `tableCommand(row)`, the registry entry built from it. `registerTablesFeature` replaces
 * the stub of every id that has a row; the table is empty in the foundation, so the 24 stubs
 * stay until the stories append their rows. US1 adds `insert.table`, *Add → Table*
 * (`createInsertTableCommand`; data-model §4.5).
 */

import type { Command as PMCommand } from 'prosemirror-state';

import type { Command, CommandContext } from '@/app/commands';
import { findTablePointAt, insertTableCommand } from '@/editor/commands/tableInsertion';
import { availability, isAvailable, type TableCommandName } from '@/editor/table/commands';
import type { PlanContext } from '@/editor/table/edit';
import { createTable } from '@/editor/table/ops';
import { collectBookIds } from '@/model/ids';

import { openTableDialog, rememberTableDialog } from './dialog';
import { reasonText } from './reasons';
import { activeTableTarget, type TableEditTarget } from './target';

export interface TableCommandRow {
  id: `table.${TableCommandName}`;
  /** The ProseMirror command to run, made with the host's plan context. */
  command(ctx: PlanContext): PMCommand;
}

/** The rows the user stories append (FR-039's order is the registry's, not this table's). */
export const TABLE_COMMAND_ROWS: TableCommandRow[] = [];

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
 * target, with the target's node ids and the book's ids.
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
  { ok: true } | { refused: 'noTarget' } | { refused: 'noTablePlace' };

/**
 * `insert.table`'s availability: `noTarget` without an active, editable target (the Source
 * view's branch is US1's T068, the fields' US10), `noTablePlace` where FR-004 finds no point at
 * the end of the selection (FR-004 (c)). A cheap read of the selection's ancestors (C21).
 */
export function insertTableAvailability(
  ctx: Pick<CommandContext, 'store'>,
): InsertTableAvailability {
  const target = editableTarget(ctx);
  if (!target) return { refused: 'noTarget' };
  return findTablePointAt(target.state!) ? { ok: true } : { refused: 'noTablePlace' };
}

/**
 * *Add → Table* (FR-001 to FR-004, FR-040, FR-043, FR-045, FR-048): the literal id, the group
 * `edit`, the Add menu's label (C32) and the `table-insert` icon (C27); no hotkey scope, since
 * Alt+T also works in the Source view (C6; decision 15), and the default run policy `blocked`.
 * `run` opens the dialog with the values last confirmed, stores the confirmed ones (without
 * waiting for the answer), checks the place again - at the selection the command started with -
 * and inserts the table there as one undo step, the caret in its first cell; a non-empty
 * selection stays and its end decides (decision 4).
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
      return answer.refused === 'noTarget'
        ? reasonText('noTarget', { command: 'insert.table' }, ctx.t)
        : reasonText('noTablePlace', undefined, ctx.t);
    },
    run: async (ctx) => {
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
