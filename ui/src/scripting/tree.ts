/**
 * Document Tree hook (T105, FR-145): the "Scripts" section of the tree context menu. The tree
 * component (owned by the tree feature) calls `getTreeScriptCommands(store, nodeId)` when it
 * builds the context menu for a node and runs the chosen entry with its command context:
 *
 *   const entries = getTreeScriptCommands(services.store, node.nodeId);
 *   // render under t('treeMenu.scripts'); on click: void entry.run(ctx)
 */

import type { CommandContext } from '@/app/commands';
import type { AppStore } from '@/model/store';

import { getScriptsFeature } from './catalog';
import { scriptName, type RunResult } from './host';
import type { NodeRef, ScriptInfo } from './types';

export interface TreeScriptCommand {
  /** Command id (`script.<id>`), usable as a React key and a testid suffix. */
  id: string;
  scriptId: string;
  label: string;
  description: string;
  iconUrl?: string;
  /** The node that will be passed to the script as `ctx.treeNode`. */
  node: NodeRef;
  run: (ctx: CommandContext) => Promise<RunResult>;
}

function typeOf(store: AppStore, nodeId: string): string | null {
  const document = store.getState().document;
  if (!document) return null;
  const stack: { type: string; attrs?: { nodeId?: unknown }; content?: unknown[] }[] = [
    ...(document.bodies as unknown as { type: string }[]),
  ];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.attrs?.nodeId === nodeId) return node.type;
    if (Array.isArray(node.content)) {
      for (const child of node.content as typeof stack) {
        if (child && typeof child === 'object' && child.type !== 'text') stack.push(child);
      }
    }
  }
  return null;
}

/** Tree-command scripts for the context menu of `nodeId` (empty when none or no document). */
export function getTreeScriptCommands(store: AppStore, nodeId: string): TreeScriptCommand[] {
  const feature = getScriptsFeature(store);
  if (!feature) return [];
  const type = typeOf(store, nodeId);
  if (!type) return [];
  const node: NodeRef = { nodeId, type };
  const language = store.getState().uiLanguage;
  return feature.treeScripts().map((script: ScriptInfo) => ({
    id: `script.${script.id}`,
    scriptId: script.id,
    label: scriptName(script, language),
    description: script.description?.[language] ?? script.description?.en ?? '',
    iconUrl: script.iconUrl,
    node,
    run: (ctx) => feature.runScript(script, ctx, { treeNode: node }),
  }));
}

/** Runs a tree-command script for an explicit node (also used by the test hooks). */
export function runScriptForTreeNode(
  store: AppStore,
  ctx: CommandContext,
  scriptId: string,
  nodeId: string,
): Promise<RunResult> {
  const feature = getScriptsFeature(store);
  const script = feature?.find(scriptId);
  const type = typeOf(store, nodeId);
  if (!feature || !script || !type) {
    return Promise.resolve({ status: 'unavailable', message: 'unknown script or node' });
  }
  return feature.runScript(script, ctx, { treeNode: { nodeId, type } });
}
