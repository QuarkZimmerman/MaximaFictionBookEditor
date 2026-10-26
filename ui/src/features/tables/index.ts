/**
 * Tables feature registrar (feature 006; data-model §6.1, §9.1, §9.5; research R2.1, R2.3).
 * Called once by `createAppServices()` right after the images feature: it replaces the stub of
 * every `table.*` command that has a row in the command table (`commands.ts`) and that of
 * `insert.table` (*Add → Table*, US1), installs the resolver of the table commands' hotkey
 * scope - the active table edit target's DOM, so a chord the user assigned runs a table command
 * only with the focus inside the Body editor (C6) -, the Body context menu's table section with
 * its right-click rule, and the test hooks when the page or the core asks for them: the tables'
 * (`__mfbeTest.tables`) and the Source view's (`__mfbeTest.sourceTable`, `sourceTable.ts`).
 * US8 gives the Body editor's table node views the warning mark of an irregular table: its texts
 * from `describeTableMark` in the interface language (`marks.ts`), its click the popover with
 * *Repair table* (`MarkPopover.tsx`). US10 installs the focus rule of the Description view's
 * field targets (`target.ts`): the hotkey scope, the menus and the toolbar buttons then follow
 * the focused annotation or history field there.
 */

import type { FeatureContext } from '@/app/services';
import i18next from '@/i18n';
import { testHooksRequested } from '@/scripting/testHooks';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';
import { registerContextMenuExtension } from '@/views/body/contextMenuExtensions';

import { TABLE_COMMAND_ROWS, createInsertTableCommand, tableCommand } from './commands';
import { prepareTableClick, tableSectionItems } from './contextMenu';
import { describeTableMark } from './marks';
import { openTableMarkPopover } from './MarkPopover';
import { installSourceTableHooks } from './sourceTable';
import { activeTableTarget, bodyTableTarget, installFieldFocusRule } from './target';
import { installTablesTestHooks } from './testHooks';

export {
  TABLE_COMMAND_ROWS,
  createInsertTableCommand,
  insertTableAvailability,
  tableCommand,
  tableIcon,
  type InsertTableAvailability,
  type TableCommandRow,
} from './commands';
export { confirmLinkTargets, linkTargetCount, runWithLinkCheck } from './confirm';
export {
  TABLE_DIALOG_DEFAULTS,
  openTableDialog,
  rememberTableDialog,
  tableDialogValues,
} from './dialog';
export { prepareTableClick, tableSectionItems } from './contextMenu';
export { describeTableMark, type TableMarkDescription } from './marks';
export { openTableMarkPopover, type MarkActivation } from './MarkPopover';
export { reasonText, type ReasonCode } from './reasons';
export {
  installSourceTableHooks,
  runSourceTable,
  sourceTableActive,
  sourceTableReason,
  sourceTableVerdict,
  type SourceSweepAnswer,
  type SourceTableTestHooks,
} from './sourceTable';
export {
  activateFieldTarget,
  activeTableTarget,
  bodyTableTarget,
  createFieldTarget,
  fieldTargetFor,
  installFieldFocusRule,
  registerFieldTarget,
  subscribeTableTargets,
  type FieldTarget,
  type FieldTargetOptions,
  type TableEditTarget,
} from './target';
export { findModelTable, installTablesTestHooks, type TablesTestHooks } from './testHooks';

function installTestHooks(ctx: FeatureContext): void {
  installTablesTestHooks(ctx);
  installSourceTableHooks(ctx);
}

export function registerTablesFeature(ctx: FeatureContext): void {
  for (const row of TABLE_COMMAND_ROWS) ctx.commands.replace(tableCommand(row));
  // *Add → Table* (US1): takes over the stub the editing feature no longer replaces.
  ctx.commands.replace(createInsertTableCommand());
  // The scope is the active target's editor: the Body editor, or the focused field (C6).
  ctx.commands.setHotkeyScope('tableTarget', () => activeTableTarget(ctx.store)?.dom ?? null);
  installFieldFocusRule(ctx.store);
  // The Body context menu's table section and its right-click rule on the Body adapter (C28;
  // data-model §9.3); the Description fields' menu uses them on the field's adapter (US10).
  registerContextMenuExtension('prepare', (_controller, click) => {
    const target = bodyTableTarget(ctx.store);
    if (target) prepareTableClick(target, click);
  });
  registerContextMenuExtension('table', (_controller, click, commandCtx) => {
    const target = bodyTableTarget(ctx.store);
    return target ? tableSectionItems(ctx.commands, target, click, commandCtx) : [];
  });
  // The warning mark of an irregular table in the Body view (FR-057; data-model §3.3): the
  // controller exists - the editing feature installed it first -, the texts follow the
  // interface language through the controller's language listeners, and a click opens the
  // mark's popover on the Body target (data-model §3.5; the rich fields pass their own, US10).
  if (hasBodyController(ctx.store)) {
    getBodyController(ctx.store).setTableViewOptions({
      describe: (summary) => describeTableMark(summary, i18next.t),
      onMarkActivate: (info) => {
        const commandCtx = ctx.getCommandContext?.();
        const target = activeTableTarget(ctx.store);
        if (commandCtx && target) void openTableMarkPopover(commandCtx, target, info);
      },
    });
  }
  if (testHooksRequested()) {
    installTestHooks(ctx);
    return;
  }
  // A core started with test hooks says so in `app.info`, asked once the client has connected
  // for the first time (the services exist before `App` connects it; `main.tsx`).
  const rpc = ctx.rpc;
  if (!rpc) return;
  let asked = false;
  const stop = rpc.onStatus((status) => {
    if (status !== 'connected' || asked) return;
    asked = true;
    stop();
    void rpc
      .call('app.info')
      .then((info) => {
        if ((info as { testHooks?: boolean }).testHooks) installTestHooks(ctx);
      })
      .catch(() => {
        // No core: no hooks.
      });
  });
}
