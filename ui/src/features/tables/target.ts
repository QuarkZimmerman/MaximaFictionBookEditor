/**
 * The editor a table command acts on (feature 006; I10; data-model §6.1, §6.2): a
 * `TableEditTarget`. This phase has the Body adapter over the Body controller; the rich fields
 * of the Description view register theirs with the focus rule (US10), and the Source view has
 * none (its `insert.table` branch is US1's).
 */

import type { Command as PMCommand, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { isRunLocked, type AppStore } from '@/model/store';
import {
  getBodyController,
  hasBodyController,
  type BodyEditorController,
} from '@/views/body/bodyEditor';

export interface TableEditTarget {
  kind: 'body' | 'description';
  /** `body`, or the field key. */
  key: string;
  readonly state: EditorState | null;
  readonly view: EditorView | null;
  /** The ProseMirror DOM of the host: the scope of the table commands' hotkeys (C6). */
  readonly dom: HTMLElement | null;
  /** The host shows an editable document and no run lock is held. */
  readonly editable: boolean;
  /** A cell takes inline images only there (the fields; spec Assumptions). */
  readonly imagesOnlyInCells: boolean;
  /** The host's node-id generator (data-model §1.6). */
  nextNodeId(): string;
  /** A dry run of a ProseMirror command. */
  canRun(cmd: PMCommand): boolean;
  /** Runs a ProseMirror command as exactly one undo step. */
  run(cmd: PMCommand): boolean;
  /** Sets a selection only (a drop point, a right-click): no undo step. */
  setSelection(tr: Transaction): void;
  /** Selection changes of the host; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

function bodyActive(store: AppStore): boolean {
  const state = store.getState();
  return state.activeView === 'body' && state.document !== null && !state.sourceOnly;
}

const bodyAdapters = new WeakMap<BodyEditorController, TableEditTarget>();

/** The Body adapter over the store's Body controller (one per controller). */
export function bodyTableTarget(store: AppStore): TableEditTarget | null {
  if (!hasBodyController(store)) return null;
  const controller = getBodyController(store);
  let adapter = bodyAdapters.get(controller);
  if (adapter) return adapter;
  adapter = {
    kind: 'body',
    key: 'body',
    get state() {
      return controller.editorState;
    },
    get view() {
      return controller.editorView;
    },
    get dom() {
      return controller.editorView?.dom ?? null;
    },
    get editable() {
      return (
        bodyActive(store) &&
        controller.isEditable &&
        !!controller.editorState &&
        !isRunLocked(store.getState())
      );
    },
    imagesOnlyInCells: false,
    // The controller's generator is a function property: it may be passed on unbound.
    nextNodeId: () => controller.nextNodeId(),
    canRun: (cmd) => controller.canExecute(cmd),
    // `execute` closes the history around the command; the commit adds `DISCRETE_STEP`.
    run: (cmd) => controller.execute(cmd),
    setSelection: (tr) => controller.apply(tr),
    subscribe: (listener) => controller.subscribeContext(listener),
  };
  bodyAdapters.set(controller, adapter);
  return adapter;
}

/**
 * The active table edit target: the Body adapter while the Body view is active; none in the
 * Source view and, until US10 registers the field adapters with the focus rule, in the
 * Description view.
 */
export function activeTableTarget(store: AppStore): TableEditTarget | null {
  return bodyActive(store) ? bodyTableTarget(store) : null;
}

/**
 * Calls `listener` when the active target changes (a view switch, a document opened or closed)
 * and when the selection of the active target changes, so menus and toolbar buttons
 * re-evaluate the table commands. Returns the unsubscribe function.
 */
export function subscribeTableTargets(store: AppStore, listener: () => void): () => void {
  let current = activeTableTarget(store);
  let unsubscribeTarget = current ? current.subscribe(listener) : null;
  const unsubscribeStore = store.subscribe(() => {
    const next = activeTableTarget(store);
    if (next === current) return;
    unsubscribeTarget?.();
    current = next;
    unsubscribeTarget = next ? next.subscribe(listener) : null;
    listener();
  });
  return () => {
    unsubscribeStore();
    unsubscribeTarget?.();
  };
}
