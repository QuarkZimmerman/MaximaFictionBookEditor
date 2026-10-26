/**
 * The editor a table command acts on (feature 006; I10; data-model §6.1, §6.2): a
 * `TableEditTarget`. The Body adapter over the Body controller; the field adapters of the
 * Description view's rich fields (US10: the book annotation, the source book's annotation and
 * the history), which `RichField` registers on mount and removes on unmount; the Source view has
 * none (its `insert.table` branch is `sourceTable.ts`, US1).
 *
 * The active target (`activeTableTarget`): the Body adapter in the Body view; in the Description
 * view the field the focus rule marks active, or none; none in the Source view. The focus rule
 * (`installFieldFocusRule`, one `focusin` listener on the document while the Description view is
 * shown): focus entering a registered field's editor makes it the active field; focus entering
 * the chrome - a toolbar (`.mfbe-toolbar`, the Table bar included), the menu bar, a menu popup, a
 * dialog, or the assistant's panel (`aside.mfbe-ai-panel`, so a block of the field still reaches
 * a request sent from there, data-model §15.4) - keeps it; focus entering any other element
 * clears it, and so does the unmount of the active field. The table commands' hotkeys keep the
 * event-target check of their scope (C6), since a rule that follows `focusin` alone leaks.
 * `subscribeTableTargets` fires on activation changes and on the active target's changes, so the
 * menus, the toolbar buttons and the Table bar follow a field's selection (C30).
 */

import type { Command as PMCommand, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { DISCRETE_STEP } from '@/editor/commands/util';
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

/* ------------------------------------------------------------------------ */
/* The field adapters of the Description view (US10)                        */
/* ------------------------------------------------------------------------ */

/** A rich field's adapter: `notify()` tells its subscribers that the field's state changed. */
export type FieldTarget = TableEditTarget & { notify(): void };

export interface FieldTargetOptions {
  /** The field key: `titleInfo.annotation`, `srcTitleInfo.annotation`, `documentInfo.history`. */
  key: string;
  view: () => EditorView | null;
  /** The field is not read-only (the run lock makes the form read-only). */
  editable: () => boolean;
  /** The field's `richFieldIdGenerator(key)`. */
  nextNodeId: () => string;
}

/**
 * The adapter of a rich field (data-model §6.1): `run` dispatches the command's transactions
 * marked `DISCRETE_STEP`, so the field records exactly one Description undo entry for it and
 * closes the typing burst around it; `setSelection` dispatches a selection as it is (a drop
 * point, a right-click); pictures go into cells only (spec Assumptions).
 */
export function createFieldTarget(options: FieldTargetOptions): FieldTarget {
  const listeners = new Set<() => void>();
  return {
    kind: 'description',
    key: options.key,
    get state() {
      return options.view()?.state ?? null;
    },
    get view() {
      return options.view();
    },
    get dom() {
      return options.view()?.dom ?? null;
    },
    get editable() {
      return !!options.view() && options.editable();
    },
    imagesOnlyInCells: true,
    nextNodeId: () => options.nextNodeId(),
    canRun: (cmd) => {
      const view = options.view();
      return !!view && cmd(view.state);
    },
    run: (cmd) => {
      const view = options.view();
      if (!view) return false;
      return cmd(view.state, (tr) => view.dispatch(tr.setMeta(DISCRETE_STEP, true)), view);
    },
    setSelection: (tr) => {
      options.view()?.dispatch(tr);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The mounted rich fields' adapters, and the one the focus rule marks active. */
const fieldTargets = new Set<FieldTarget>();
let activeField: FieldTarget | null = null;
const activationListeners = new Set<() => void>();

function setActiveField(next: FieldTarget | null): void {
  if (activeField === next) return;
  activeField = next;
  for (const listener of [...activationListeners]) listener();
}

/**
 * Registers a rich field's adapter (on the field's mount); the returned function unregisters it
 * and clears the active field when it was this one (an unmount clears it).
 */
export function registerFieldTarget(target: FieldTarget): () => void {
  fieldTargets.add(target);
  return () => {
    fieldTargets.delete(target);
    if (activeField === target) setActiveField(null);
  };
}

/** The registered field whose editor holds `element`, active or not; null otherwise. */
export function fieldTargetFor(element: EventTarget | null | undefined): FieldTarget | null {
  if (!(element instanceof Node)) return null;
  for (const target of fieldTargets) {
    const dom = target.dom;
    if (dom && dom.contains(element)) return target;
  }
  return null;
}

/** Makes the registered field `key` the active one (the field's context menu, T164). */
export function activateFieldTarget(key: string): void {
  for (const target of fieldTargets) {
    if (target.key === key) {
      setActiveField(target);
      return;
    }
  }
}

/** The chrome whose focus keeps the active field (data-model §6.1). */
const KEEPS_FIELD =
  '.mfbe-toolbar, [role="menubar"], [role="menu"], [role="dialog"], aside.mfbe-ai-panel';

/**
 * The focus rule of the Description view (data-model §6.1): one `focusin` listener on the
 * document, acting while `store` shows the Description view. Returns the uninstall function.
 */
export function installFieldFocusRule(store: AppStore): () => void {
  const onFocusIn = (event: FocusEvent) => {
    if (store.getState().activeView !== 'description') return;
    const element = event.target;
    if (!(element instanceof Element)) return;
    const field = fieldTargetFor(element);
    if (field) setActiveField(field);
    else if (!element.closest(KEEPS_FIELD)) setActiveField(null);
  };
  document.addEventListener('focusin', onFocusIn, true);
  return () => document.removeEventListener('focusin', onFocusIn, true);
}

/* ------------------------------------------------------------------------ */
/* The active target                                                        */
/* ------------------------------------------------------------------------ */

/**
 * The active table edit target: the Body adapter while the Body view is active; in the
 * Description view the field adapter the focus rule marks active, or none; none in the Source
 * view (its `insert.table` branch is `sourceTable.ts`).
 */
export function activeTableTarget(store: AppStore): TableEditTarget | null {
  if (store.getState().activeView === 'description') return activeField;
  return bodyActive(store) ? bodyTableTarget(store) : null;
}

/**
 * Calls `listener` when the active target changes (a view switch, a document opened or closed,
 * a field activated or cleared) and when the active target's selection or document changes, so
 * menus and toolbar buttons re-evaluate the table commands. Returns the unsubscribe function.
 */
export function subscribeTableTargets(store: AppStore, listener: () => void): () => void {
  let current = activeTableTarget(store);
  let unsubscribeTarget = current ? current.subscribe(listener) : null;
  const check = () => {
    const next = activeTableTarget(store);
    if (next === current) return;
    unsubscribeTarget?.();
    current = next;
    unsubscribeTarget = next ? next.subscribe(listener) : null;
    listener();
  };
  const unsubscribeStore = store.subscribe(check);
  activationListeners.add(check);
  return () => {
    unsubscribeStore();
    activationListeners.delete(check);
    unsubscribeTarget?.();
  };
}
