/**
 * The Table properties dialog's values (feature 006, FR-001, FR-002; I22; U26; data-model §11;
 * rpc-api.md §3.7; resource-formats.md §6): the dialog proposes the values last confirmed,
 * `session.tableDialog` in `settings.json`, and falls back member by member to 2, 2, no header
 * row, no header column when the core sends no such member (an older core, a fixture) or a value
 * of the wrong type or out of range. OK stores all four values in one `settings.set` patch, best
 * effort: a failure is logged and the insertion goes on; Cancel stores nothing.
 */

import { createElement } from 'react';

import type { CommandContext } from '@/app/commands';
import { describeError, isClientSideError, logUiError } from '@/app/diagnostics';
import { TablePropertiesDialog, type TableProperties } from '@/dialogs/TablePropertiesDialog';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from '@/editor/table/ops';
import { actions } from '@/model/store';
import type { Settings } from '@/rpc/types';

/** The values of the first use (FR-002). */
export const TABLE_DIALOG_DEFAULTS: Readonly<TableProperties> = Object.freeze({
  rows: 2,
  columns: 2,
  headerRow: false,
  headerColumn: false,
});

function count(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The values the dialog proposes: the stored ones, each missing or invalid member its default. */
export function tableDialogValues(settings: Settings | null | undefined): TableProperties {
  const stored = (settings?.session as { tableDialog?: unknown } | undefined)?.tableDialog;
  const member = (name: keyof TableProperties): unknown =>
    stored !== null && typeof stored === 'object'
      ? (stored as Record<string, unknown>)[name]
      : undefined;
  return {
    rows: count(member('rows'), MAX_TABLE_ROWS, TABLE_DIALOG_DEFAULTS.rows),
    columns: count(member('columns'), MAX_TABLE_COLUMNS, TABLE_DIALOG_DEFAULTS.columns),
    headerRow: flag(member('headerRow'), TABLE_DIALOG_DEFAULTS.headerRow),
    headerColumn: flag(member('headerColumn'), TABLE_DIALOG_DEFAULTS.headerColumn),
  };
}

/** Opens the dialog with the values of the store's settings; null when it is cancelled. */
export function openTableDialog(
  ctx: Pick<CommandContext, 'dialogs' | 'store'>,
): Promise<TableProperties | null> {
  const initial = tableDialogValues(ctx.store.getState().settings);
  return ctx.dialogs.openCustom<TableProperties | null>((close) =>
    createElement(TablePropertiesDialog, { initial, onClose: close }),
  );
}

/**
 * Stores the confirmed values: one `settings.set` patch with all four members, then the store's
 * settings. A failure is logged (client-side errors only; the core logs its own) and swallowed:
 * the table is inserted all the same.
 */
export async function rememberTableDialog(
  ctx: Pick<CommandContext, 'rpc' | 'store'>,
  values: TableProperties,
): Promise<void> {
  const { rpc } = ctx;
  if (!rpc) return;
  try {
    const result = await rpc.call('settings.set', {
      patch: {
        session: {
          tableDialog: {
            rows: values.rows,
            columns: values.columns,
            headerRow: values.headerRow,
            headerColumn: values.headerColumn,
          },
        },
      },
    });
    if (result?.settings) actions.setSettings(ctx.store, result.settings);
  } catch (error) {
    if (!isClientSideError(error)) return;
    const { message, stack } = describeError(error);
    await logUiError(rpc, { code: 'tables.dialogSaveFailed', message, stack });
  }
}
