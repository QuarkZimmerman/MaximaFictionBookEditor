/**
 * Document Tree feature registrar (US5, T083/T084). Owns the tree panel state shared by the
 * panel (`views/tree/DocumentTree.tsx`) and the commands - the selected row, the collapsed
 * containers and the "navigation started from the tree" marker - and registers:
 *
 *  - `tree.view` / `tree.viewSource` (context menu View / View Source, Enter / double-click),
 *  - `tree.moveRight`, `tree.moveWithChildren`, `tree.moveLeft`, `tree.merge`, `tree.delete`
 *    (context menu + tree toolbar; `features/treeOps.ts` does the model work, the Body
 *    controller records each operation as one `body-model` undo entry),
 *  - `view.tree` (View > Document Tree) now persists `session.treeVisible` through
 *    `settings.set`,
 *  - `nav.selectTree` (Alt+Q) focuses the tree panel.
 */

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { navigateToSourcePosition } from '@/dialogs/validation';
import { actions, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import { selectionFor, type BodyEditorController } from '@/views/body/bodyEditor';
import { loadSourceText, requestViewSwitch, setCaretWhenReady } from '@/views/source/sync';

import { FIXED_BLOCK_IDS } from '@/editor/schema';

import { bodyController, cmdKeys } from '../editing/common';
import { canRunTreeOp, runTreeOp, type TreeOp } from '../treeOps';

import { locateInSource } from './sourceLocate';

export type TreeSelectionSource = 'tree' | 'body' | 'operation';

export interface TreeSelection {
  id: string | null;
  source: TreeSelectionSource;
}

export interface TreePanelState {
  selection: TreeSelection;
  /** Ids of the collapsed container rows. */
  collapsed: ReadonlySet<string>;
}

const INITIAL_STATE: TreePanelState = {
  selection: { id: null, source: 'body' },
  collapsed: new Set(),
};

/** Per-store tree state (an external store for `useSyncExternalStore`). */
export class TreeFeature {
  private state: TreePanelState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private focusHandler: (() => boolean) | null = null;
  /** Row the tree itself navigated to last (suppresses the echo of the Body selection). */
  private pendingNavigation: string | null = null;
  rpc: RpcClient | null = null;

  constructor(readonly store: AppStore) {
    store.subscribe((state, previous) => {
      if (state.docId !== previous.docId) {
        this.pendingNavigation = null;
        this.update({ selection: { id: null, source: 'body' }, collapsed: new Set() });
      }
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): TreePanelState => this.state;

  get selectedId(): string | null {
    return this.state.selection.id;
  }

  get collapsed(): ReadonlySet<string> {
    return this.state.collapsed;
  }

  private update(patch: Partial<TreePanelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  select(id: string | null, source: TreeSelectionSource): void {
    const { selection } = this.state;
    if (selection.id === id && selection.source === source) return;
    this.update({ selection: { id, source } });
  }

  /** Marks a navigation started from the tree (its Body echo must not move the selection). */
  markNavigation(rowId: string | null): void {
    this.pendingNavigation = rowId;
  }

  /** The row of the last tree navigation, cleared on read. */
  takePendingNavigation(): string | null {
    const pending = this.pendingNavigation;
    this.pendingNavigation = null;
    return pending;
  }

  toggleCollapsed(rowId: string): void {
    const next = new Set(this.state.collapsed);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    this.update({ collapsed: next });
  }

  /** Expands the given container rows (no-op when none of them is collapsed). */
  expand(rowIds: readonly string[]): void {
    if (!rowIds.some((id) => this.state.collapsed.has(id))) return;
    const next = new Set(this.state.collapsed);
    for (const id of rowIds) next.delete(id);
    this.update({ collapsed: next });
  }

  expandAll(): void {
    if (this.state.collapsed.size > 0) this.update({ collapsed: new Set() });
  }

  /** The panel registers how to focus itself (for `nav.selectTree`). */
  registerFocus(handler: (() => boolean) | null): void {
    this.focusHandler = handler;
  }

  focus(): boolean {
    return this.focusHandler?.() ?? false;
  }

  /** Remembers the RPC client seen in a command context (settings persistence). */
  attachRpc(rpc: RpcClient | null): void {
    if (rpc) this.rpc = rpc;
  }
}

const features = new WeakMap<AppStore, TreeFeature>();

export function getTreeFeature(store: AppStore): TreeFeature {
  let feature = features.get(store);
  if (!feature) {
    feature = new TreeFeature(store);
    features.set(store, feature);
  }
  return feature;
}

/**
 * Selects the element in the Body editor (moving the section window when it is not mounted)
 * without focusing the editor, so the tree keeps the keyboard focus.
 */
export function revealInBody(controller: BodyEditorController, nodeId: string): boolean {
  if (!controller.moveWindowTo(nodeId)) return false;
  const state = controller.editorState;
  if (!state) return false;
  const selection = selectionFor(state.doc, nodeId, 0);
  if (!selection) return false;
  controller.apply(state.tr.setSelection(selection).scrollIntoView());
  return true;
}

/* ------------------------------------------------------------------------ */
/* Operations                                                               */
/* ------------------------------------------------------------------------ */

const OP_COMMAND_IDS: Record<TreeOp, string> = {
  moveRight: 'tree.moveRight',
  moveWithChildren: 'tree.moveWithChildren',
  moveLeft: 'tree.moveLeft',
  merge: 'tree.merge',
  delete: 'tree.delete',
};

export function treeOpCommandId(op: TreeOp): string {
  return OP_COMMAND_IDS[op];
}

/** Model operations need a model that is not about to be replaced by pending Source text. */
function modelEditable(ctx: Pick<CommandContext, 'store'>): boolean {
  const state = ctx.store.getState();
  return state.document !== null && !state.sourceOnly && !state.sourceDirty;
}

/** The Annotation / History rows (feature 004): View and View Source only, never moved or deleted. */
export function isBlockRow(rowId: string | null): boolean {
  return rowId === FIXED_BLOCK_IDS.annotation || rowId === FIXED_BLOCK_IDS.history;
}

export function canRunTreeCommand(ctx: Pick<CommandContext, 'store'>, op: TreeOp): boolean {
  const state = ctx.store.getState();
  const selected = getTreeFeature(ctx.store).selectedId;
  return (
    !!selected &&
    !isBlockRow(selected) &&
    modelEditable(ctx) &&
    !!state.document &&
    canRunTreeOp(op, state.document, selected)
  );
}

/**
 * Runs a tree operation on the selected row: confirmation for Delete, the model step through
 * the Body controller (one undo entry), selection of the resulting node in tree and Body, and a
 * status message for refusals.
 */
export async function runTreeCommand(ctx: CommandContext, op: TreeOp): Promise<boolean> {
  const { store, t } = ctx;
  const feature = getTreeFeature(store);
  const nodeId = feature.selectedId;
  const model = store.getState().document;
  if (!nodeId || isBlockRow(nodeId) || !model || !modelEditable(ctx)) return false;
  if (op === 'delete') {
    const answer = await ctx.dialogs.showMessage({
      text: t('tree.deleteConfirm'),
      caption: t('tree.caption'),
      buttons: 'yesNo',
      icon: 'warning',
      defaultButton: 'no',
      testId: 'tree-delete-confirm',
    });
    if (answer !== 'yes') return false;
  }
  const current = store.getState().document;
  if (!current) return false;
  const result = runTreeOp(op, current, nodeId);
  if (!result.ok) {
    actions.setStatusMessage(store, t(`tree.status.${result.reason}`));
    return false;
  }
  const controller = bodyController(store);
  if (controller) {
    controller.applyModelStep(result.step, t(`tree.undo.${op}`));
  } else {
    actions.updateDocument(store, result.model);
  }
  if (result.selectNodeId) {
    feature.markNavigation(result.selectNodeId);
    feature.select(result.selectNodeId, 'operation');
    if (controller) revealInBody(controller, result.selectNodeId);
  }
  const message =
    op === 'merge'
      ? 'tree.status.merged'
      : op === 'delete'
        ? 'tree.status.deleted'
        : 'tree.status.moved';
  actions.setStatusMessage(store, t(message));
  return true;
}

/** View: shows the selected element in the Body view (switching to it when needed). */
export async function viewSelected(ctx: CommandContext, nodeId?: string | null): Promise<boolean> {
  const feature = getTreeFeature(ctx.store);
  const target = nodeId ?? feature.selectedId;
  if (!target) return false;
  feature.markNavigation(target);
  feature.select(target, 'tree');
  if (!(await requestViewSwitch(ctx, 'body'))) return false;
  const controller = bodyController(ctx.store);
  if (controller && controller.setCaret({ view: 'body', nodeId: target })) {
    controller.focus();
    return true;
  }
  return setCaretWhenReady(ctx, { view: 'body', nodeId: target });
}

/** View Source: opens the Source view positioned on the element's opening tag. */
export async function viewSelectedSource(
  ctx: CommandContext,
  nodeId?: string | null,
): Promise<boolean> {
  const feature = getTreeFeature(ctx.store);
  const target = nodeId ?? feature.selectedId;
  const model = ctx.store.getState().document;
  if (!target || !model) return false;
  feature.select(target, 'tree');
  const text = await loadSourceText(ctx);
  const position = locateInSource(text, model, target);
  if (!position) return requestViewSwitch(ctx, 'source');
  return navigateToSourcePosition(ctx, position.line, position.column);
}

/* ------------------------------------------------------------------------ */
/* Registrar                                                                */
/* ------------------------------------------------------------------------ */

function opCommand(op: TreeOp): Command {
  const id = OP_COMMAND_IDS[op];
  return {
    id,
    group: 'edit',
    ...cmdKeys(id),
    enabled: (ctx) => canRunTreeCommand(ctx, op),
    run: async (ctx) => {
      await runTreeCommand(ctx, op);
    },
  };
}

const hasSelection = (ctx: Pick<CommandContext, 'store'>): boolean =>
  !!getTreeFeature(ctx.store).selectedId && ctx.store.getState().document !== null;

export function registerTreeFeature(ctx: FeatureContext): void {
  const { commands, store } = ctx;
  const feature = getTreeFeature(store);
  // Forward-compatible: when the feature context carries the RPC client, use it right away.
  feature.attachRpc((ctx as { rpc?: RpcClient | null }).rpc ?? null);

  for (const op of Object.keys(OP_COMMAND_IDS) as TreeOp[]) commands.replace(opCommand(op));

  commands.replace({
    id: 'tree.view',
    group: 'edit',
    ...cmdKeys('tree.view'),
    enabled: hasSelection,
    run: async (c) => {
      await viewSelected(c);
    },
  });
  commands.replace({
    id: 'tree.viewSource',
    group: 'edit',
    ...cmdKeys('tree.viewSource'),
    enabled: hasSelection,
    run: async (c) => {
      await viewSelectedSource(c);
    },
  });

  // View > Document Tree: toggle + persist `session.treeVisible` (data-model.md §3.1).
  commands.replace({
    id: 'view.tree',
    group: 'view',
    ...cmdKeys('view.tree', 'menu.view.tree'),
    checked: (c) => {
      feature.attachRpc(c.rpc);
      return c.store.getState().treeVisible;
    },
    run: (c) => {
      actions.toggleTree(c.store);
      const treeVisible = c.store.getState().treeVisible;
      const rpc = c.rpc ?? feature.rpc;
      if (rpc && c.store.getState().connection === 'connected') {
        void rpc.call('settings.set', { patch: { session: { treeVisible } } }).catch(() => {
          // persistence is best effort; the panel state is already applied
        });
      }
    },
  });

  commands.replace({
    id: 'nav.selectTree',
    group: 'navigation',
    ...cmdKeys('nav.selectTree'),
    enabled: (c) => c.store.getState().treeVisible && c.store.getState().document !== null,
    run: (c) => {
      getTreeFeature(c.store).focus();
    },
  });
}
