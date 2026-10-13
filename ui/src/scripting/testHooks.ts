/**
 * Test hooks of the scripting runtime, exposed on `window.__mfbeTest` ONLY when the page was
 * opened with `?test=1` or the core reports `testHooks: true` in `app.info` (headless e2e and
 * the equivalence harness `tests/scripts/run-script.mjs`). Never active in a normal session.
 *
 *   __mfbeTest.runScript(idOrDir, {treeNodeId?})  -> RunResult   (also __mfbeTest.scripts.run)
 *   __mfbeTest.scripts.{list, refresh, state, lastRunId, cancel, treeCommands, document, toXml,
 *                       select, selectRange}
 */

import type { CommandContext } from '@/app/commands';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';

import { setBodySelection } from './api-impl';
import type { ScriptsFeature } from './catalog';
import type { RunResult, RunState } from './host';
import { getTreeScriptCommands, runScriptForTreeNode } from './tree';
import type { ScriptInfo } from './types';

export interface ScriptTestHooks {
  list(): ScriptInfo[];
  refresh(): Promise<void>;
  run(idOrDir: string, options?: { treeNodeId?: string }): Promise<RunResult>;
  cancel(): void;
  state(): RunState | null;
  lastRunId(): string | null;
  treeCommands(nodeId: string): { id: string; scriptId: string; label: string }[];
  document(): unknown;
  toXml(): Promise<string>;
  /** Selects a text block (or `[from, to)` inside it) in the Body view; false when unknown. */
  select(nodeId: string, from?: number, to?: number): boolean;
  /**
   * Selects from `anchor` to `head`, which may lie in different text blocks (the harness's
   * `--select-range`); the same engine as `mfbe.selection.set`. False when a node is unknown
   * or not mounted together with the anchor.
   */
  selectRange(
    anchor: { nodeId: string; offset: number },
    head: { nodeId: string; offset: number },
  ): boolean;
}

declare global {
  interface Window {
    __mfbeTest?: Record<string, unknown> & {
      runScript?: ScriptTestHooks['run'];
      scripts?: ScriptTestHooks;
    };
  }
}

/** True when the page asked for test hooks (`?test=1`). */
export function testHooksRequested(
  search = typeof window !== 'undefined' ? window.location.search : '',
) {
  return new URLSearchParams(search).get('test') === '1';
}

function matchScript(feature: ScriptsFeature, idOrDir: string): ScriptInfo | undefined {
  const direct = feature.find(idOrDir);
  if (direct) return direct;
  const wanted = idOrDir.replace(/[\\/]+$/, '');
  return feature
    .all()
    .find(
      (script) =>
        script.dir === wanted ||
        script.dir.endsWith(`/${wanted}`) ||
        script.dir.endsWith(`\\${wanted}`),
    );
}

export function installScriptTestHooks(
  feature: ScriptsFeature,
  getContext: () => CommandContext | null,
): void {
  if (typeof window === 'undefined') return;
  const requireContext = (): CommandContext => {
    const ctx = getContext();
    if (!ctx) throw new Error('scripting test hooks: no command context yet (UI not mounted)');
    return ctx;
  };
  const hooks: ScriptTestHooks = {
    list: () => feature.all(),
    refresh: () => feature.refresh(),
    async run(idOrDir, options = {}) {
      const ctx = requireContext();
      feature.ensureAttached(ctx);
      if (!feature.loaded) await feature.refresh();
      const script = matchScript(feature, idOrDir);
      if (!script) return { status: 'unavailable', message: `unknown script "${idOrDir}"` };
      if (options.treeNodeId) {
        return runScriptForTreeNode(feature.store, ctx, script.id, options.treeNodeId);
      }
      return feature.runScript(script, ctx);
    },
    cancel: () => feature.host.cancel(),
    state: () => feature.host.current,
    lastRunId: () => feature.host.lastRunId,
    treeCommands: (nodeId) =>
      getTreeScriptCommands(feature.store, nodeId).map(({ id, scriptId, label }) => ({
        id,
        scriptId,
        label,
      })),
    document: () => feature.store.getState().document,
    select(nodeId, from, to) {
      if (!hasBodyController(feature.store)) return false;
      const controller = getBodyController(feature.store);
      if (from === undefined) return controller.selectRange(nodeId, 0, Number.MAX_SAFE_INTEGER);
      return controller.selectRange(nodeId, from, to ?? from);
    },
    selectRange(anchor, head) {
      if (!hasBodyController(feature.store)) return false;
      try {
        setBodySelection(getBodyController(feature.store), anchor, head, 'selectRange');
        return true;
      } catch {
        return false;
      }
    },
    async toXml() {
      const ctx = requireContext();
      const state = ctx.store.getState();
      if (!ctx.rpc || !state.document || !state.docId) throw new Error('no document');
      const { text } = await ctx.rpc.call('doc.toXml', {
        docId: state.docId,
        document: state.document,
        elideBinaries: true,
      });
      return text;
    },
  };
  const existing = window.__mfbeTest ?? {};
  window.__mfbeTest = Object.assign(existing, { runScript: hooks.run, scripts: hooks });
}
