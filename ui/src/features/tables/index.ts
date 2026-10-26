/**
 * Tables feature registrar (feature 006; data-model §6.1, §9.1, §9.5; research R2.1, R2.3).
 * Called once by `createAppServices()` right after the images feature: it replaces the stub of
 * every `table.*` command that has a row in the command table (`commands.ts`), installs the
 * resolver of the table commands' hotkey scope - the active table edit target's DOM, so a chord
 * the user assigned runs a table command only with the focus inside the Body editor (C6) -, the
 * Body context menu's table section with its right-click rule, and the test hooks when the page
 * or the core asks for them.
 */

import type { FeatureContext } from '@/app/services';
import { testHooksRequested } from '@/scripting/testHooks';
import { registerContextMenuExtension } from '@/views/body/contextMenuExtensions';

import { TABLE_COMMAND_ROWS, tableCommand } from './commands';
import { prepareTableContextMenu, tableContextMenuItems } from './contextMenu';
import { activeTableTarget } from './target';
import { installTablesTestHooks } from './testHooks';

export { TABLE_COMMAND_ROWS, tableCommand, tableIcon, type TableCommandRow } from './commands';
export { prepareTableContextMenu, tableContextMenuItems } from './contextMenu';
export { reasonText, type ReasonCode } from './reasons';
export {
  activeTableTarget,
  bodyTableTarget,
  subscribeTableTargets,
  type TableEditTarget,
} from './target';
export { findModelTable, installTablesTestHooks, type TablesTestHooks } from './testHooks';

export function registerTablesFeature(ctx: FeatureContext): void {
  for (const row of TABLE_COMMAND_ROWS) ctx.commands.replace(tableCommand(row));
  ctx.commands.setHotkeyScope('tableTarget', () => activeTableTarget(ctx.store)?.dom ?? null);
  // The Body context menu's table section and its right-click rule (C28; data-model §9.3).
  registerContextMenuExtension('prepare', prepareTableContextMenu);
  registerContextMenuExtension('table', (controller, click, commandCtx) =>
    tableContextMenuItems(ctx.commands, controller, click, commandCtx),
  );
  if (testHooksRequested()) {
    installTablesTestHooks(ctx);
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
        if ((info as { testHooks?: boolean }).testHooks) installTablesTestHooks(ctx);
      })
      .catch(() => {
        // No core: no hooks.
      });
  });
}
