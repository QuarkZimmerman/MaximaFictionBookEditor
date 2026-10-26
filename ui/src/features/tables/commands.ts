/**
 * The command table of the table commands (feature 006; I6; data-model §6.5, §9.1, §9.6): one
 * row per `table.*` command a user story implements - a literal `id: 'table.<name>'`, so the
 * definition scan of `tools/parity-check.mjs` finds it, and the ProseMirror command it runs -
 * and `tableCommand(row)`, the registry entry built from it. `registerTablesFeature` replaces
 * the stub of every id that has a row; the table is empty in the foundation, so the 24 stubs
 * stay until the stories append their rows.
 */

import type { Command as PMCommand } from 'prosemirror-state';

import type { Command, CommandContext } from '@/app/commands';
import { availability, isAvailable, type TableCommandName } from '@/editor/table/commands';
import type { PlanContext } from '@/editor/table/edit';
import { collectBookIds } from '@/model/ids';

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
