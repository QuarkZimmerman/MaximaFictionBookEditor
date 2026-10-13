/**
 * Scripts feature registrar (US12, T105). Called once by `createAppServices()`:
 *  - creates the per-store `ScriptsFeature` (`scripting/catalog.ts`): the sandbox host, the
 *    dynamic `script.<id>` commands, `scripts.last`, `scripts.openFolder`, `scripts.reload`
 *    and the Hotkeys "Scripts" defaults from the manifests;
 *  - wires the test hooks (`window.__mfbeTest.runScript`), active only with `?test=1` or a
 *    core started with `--test-hooks`.
 * The catalogue itself loads when the feature is attached to the RPC client, which happens
 * through `useScriptsMenu()` / `<ScriptsToolbar/>` (mounted by App.tsx) or the first command
 * context seen.
 */

import type { FeatureContext } from '@/app/services';
import { installScriptsFeature } from '@/scripting/catalog';
import { installScriptTestHooks, testHooksRequested } from '@/scripting/testHooks';

export {
  getScriptsFeature,
  installScriptsFeature,
  LAST_SCRIPT_COMMAND,
  OPEN_FOLDER_COMMAND,
  RELOAD_COMMAND,
} from '@/scripting/catalog';
export { getTreeScriptCommands, runScriptForTreeNode } from '@/scripting/tree';
// React side (mounted by App.tsx): `useScriptsMenu()` from '@/scripting/ScriptsMenu' and
// `<ScriptsToolbar/>` from '@/scripting/ScriptsToolbar'.

export function registerScriptsFeature(ctx: FeatureContext): void {
  const feature = installScriptsFeature({
    store: ctx.store,
    commands: ctx.commands,
    hotkeys: ctx.hotkeys,
    undo: ctx.undo,
  });
  const install = () => installScriptTestHooks(feature, () => feature.commandContext());
  if (testHooksRequested()) install();
  else feature.onTestHooks = install;
}
