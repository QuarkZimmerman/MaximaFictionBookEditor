/**
 * Imperative controller of the Body editor (T049, editable since T057): owns the ProseMirror
 * state (and the `EditorView` while the Body view is mounted), the section window
 * (`editor/virtualization.ts`) and the write-back of edits into the document model.
 * `BodyView.tsx` is a thin React wrapper that mounts the controller and renders the chrome.
 *
 * One controller exists per application store (`getBodyController(store)`), created by the
 * editing feature at start-up; it survives view switches so the ProseMirror history (and with
 * it Edit > Undo/Redo across views) is kept while the user visits the Description or Source
 * view. Commands run through `execute()` / `canExecute()` whether or not the view is mounted.
 *
 * - `setModel()` rebuilds the editor document when the model is replaced from outside (open,
 *   Source re-parse, reload) or when the window moves; models produced by the editor's own
 *   transactions are recognised and do not rebuild it; the caret is preserved across rebuilds.
 * - `prosemirror-history` is installed; one `UndoCoordinator` entry (`body` view) is recorded
 *   per history event. Model-level steps (edits outside the mounted window, e.g. a footnote
 *   section added to an unmounted notes body) are recorded under the `body-model` view; the
 *   coordinator keeps both in chronological order and model steps survive window moves.
 * - The selection is reported to the store as `body[1]/section[3]/p[12]` and published to the
 *   Links / Table bars as a `SelectionContext`; `getCaret()` / `setCaret()` expose it as
 *   `{view: 'body', nodeId, offset}` for Restore position and go-to-issue (moving the window when
 *   the target section is not mounted).
 */

import { Slice, type Node as PMNode } from 'prosemirror-model';
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import {
  EditorState,
  type Plugin,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { baseEditorKeymap, bodyKeymap } from '@/editor/keymap';
import { createImageNodeViews } from '@/editor/nodeviews/image';
import { createRawXmlNodeViews } from '@/editor/nodeviews/rawXml';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import { clipboardPlugin } from '@/editor/plugins/clipboard';
import { DEFAULT_NBSP_DISPLAY_CHAR, nbspMarkerPlugin, nbspPluginKey } from '@/editor/plugins/nbsp';
import { nodeIdPlugin } from '@/editor/plugins/nodeIds';
import { overtypePlugin } from '@/editor/plugins/overtype';
import { searchMatchPlugin, withSearchMatch } from '@/editor/plugins/searchMatch';
import {
  computeSelectionContext,
  EMPTY_SELECTION_CONTEXT,
  type SelectionContext,
} from '@/editor/plugins/selectionPath';
import { createNodeIdGenerator, findNodeById } from '@/editor/schema';
import {
  DEFAULT_WINDOW_SIZE,
  createWindow,
  extendWindow,
  replaceSectionsInModel,
  windowAround,
  windowCounts,
  windowSliceUnchanged,
  type SectionWindow,
} from '@/editor/virtualization';
import type { Document } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { Caret } from '@/rpc/types';

export { selectionNodeId, selectionPath } from '@/editor/plugins/selectionPath';

/* ------------------------------------------------------------------------ */
/* Pure helpers                                                             */
/* ------------------------------------------------------------------------ */

export function caretOf(state: EditorState): Caret | null {
  const nodeId = selectionNodeIdOf(state);
  if (!nodeId) return null;
  return { view: 'body', nodeId, offset: state.selection.$head.parentOffset };
}

function selectionNodeIdOf(state: EditorState): string | null {
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth >= 1; depth -= 1) {
    const id = $head.node(depth).attrs.nodeId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/** Text selection inside the node with `nodeId` (at `offset` for text blocks). */
export function selectionFor(doc: PMNode, nodeId: string, offset: number | undefined) {
  const found = findNodeById(doc, nodeId);
  if (!found) return null;
  const inside = found.pos + 1;
  if (found.node.isTextblock) {
    const target = inside + Math.min(Math.max(offset ?? 0, 0), found.node.content.size);
    return TextSelection.create(doc, target);
  }
  return TextSelection.near(doc.resolve(Math.min(inside, doc.content.size)));
}

export interface EditorStateOptions {
  getNbspChar: () => string;
  /** Extra ProseMirror plugins contributed by features (e.g. spell checking). */
  plugins?: Plugin[];
  isOvertype?: () => boolean;
  toggleOvertype?: () => void;
  nextNodeId?: () => string;
}

export function createBodyEditorState(doc: PMNode, options: EditorStateOptions): EditorState {
  return EditorState.create({
    doc,
    plugins: [
      history(),
      bodyKeymap({ toggleOvertype: options.toggleOvertype }),
      baseEditorKeymap(),
      overtypePlugin(options.isOvertype ?? (() => false)),
      clipboardPlugin(),
      nodeIdPlugin(options.nextNodeId ?? createNodeIdGenerator()),
      nbspMarkerPlugin(options.getNbspChar),
      searchMatchPlugin(),
      ...(options.plugins ?? []),
    ],
  });
}

/* ------------------------------------------------------------------------ */
/* Controller                                                               */
/* ------------------------------------------------------------------------ */

export interface BodyEditorSnapshot {
  hasDocument: boolean;
  wholeBook: boolean;
  bodyIndex: number;
  bodyCount: number;
  /** `name` attribute of each body (undefined for the main body). */
  bodyNames: (string | undefined)[];
  start: number;
  count: number;
  totalSections: number;
  before: number;
  after: number;
  /** Conversion problems of the mounted window (`path: message` lines). */
  problems: string[];
}

const EMPTY_SNAPSHOT: BodyEditorSnapshot = {
  hasDocument: false,
  wholeBook: true,
  bodyIndex: 0,
  bodyCount: 0,
  bodyNames: [],
  start: 0,
  count: 0,
  totalSections: 0,
  before: 0,
  after: 0,
  problems: [],
};

/**
 * A reversible edit of the document model outside the mounted window (data-model.md §2.2:
 * part of the Body history, recorded under the `body-model` undo view so it survives window
 * moves that reset the ProseMirror history). `apply`/`revert` work relative to the current
 * model so they compose with ProseMirror edits of the mounted sections made before or after.
 */
export interface ModelStep {
  apply(model: Document): Document;
  revert(model: Document): Document;
  /**
   * The text blocks the step replaces (Replace, Replace All). Mounted ones are changed through
   * an editor transaction kept out of the editor history instead of a rebuilt window, which
   * would drop the history of the edits made before: both stay undoable.
   */
  textblocks?: readonly TextblockChange[];
}

/** The content of one text block before and after a model-level step. */
export interface TextblockChange {
  nodeId: string;
  before: ModelNodeJson;
  after: ModelNodeJson;
}

/** Replaces the content of the text block at `pos` by `next`'s, changing only what differs. */
function patchTextblock(tr: Transaction, pos: number, current: PMNode, next: PMNode): void {
  const start = current.content.findDiffStart(next.content);
  if (start === null) return;
  let { a: endA, b: endB } = current.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  tr.replace(pos + 1 + start, pos + 1 + endA, new Slice(next.content.cut(start, endB), 0, 0));
}

/** Undo view id of the model-level steps. */
export const BODY_MODEL_UNDO_VIEW = 'body-model';

export interface BodyEditorOptions {
  store: AppStore;
  undo: UndoCoordinator;
  windowSize?: number;
  editable?: boolean;
  /** Current NBSP display character (read on every repaint). */
  getNbspChar?: () => string;
  /** Localised strings (updated through `setTranslate`). */
  translate?: (key: string) => string;
  /** Extra ProseMirror plugins contributed by features (e.g. spell checking). */
  plugins?: Plugin[];
}

export class BodyEditorController {
  private readonly store: AppStore;
  private readonly undo: UndoCoordinator;
  private readonly windowSize: number;
  private editable: boolean;
  private nbspChar: string | null = null;
  private readonly getNbspChar: () => string;
  private readonly extraPlugins: Plugin[];
  private translate: (key: string) => string;
  private readonly nextNodeId = createNodeIdGenerator();

  private view: EditorView | null = null;
  private container: HTMLElement | null = null;
  /** The editor state; authoritative while the view is unmounted. */
  private state: EditorState | null = null;
  private window: SectionWindow | null = null;
  /** The model instance the current window represents. */
  private model: Document | null = null;
  private docId: string | null = null;
  private bodyIndex = 0;
  private range: { start: number; count: number } | null = null;
  private snapshot: BodyEditorSnapshot = EMPTY_SNAPSHOT;
  private context: SelectionContext = EMPTY_SELECTION_CONTEXT;
  private readonly listeners = new Set<() => void>();
  private readonly contextListeners = new Set<() => void>();
  /** Model-level steps (edits outside the mounted window); ProseMirror keeps its own history. */
  private modelUndo: ModelStep[] = [];
  private modelRedo: ModelStep[] = [];
  private replaying = false;
  /** The next document change starts a new history event (set after a command ran). */
  private closeNextHistory = false;

  constructor(options: BodyEditorOptions) {
    this.store = options.store;
    this.undo = options.undo;
    this.windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.editable = options.editable ?? true;
    const fallback = options.getNbspChar ?? (() => DEFAULT_NBSP_DISPLAY_CHAR);
    this.getNbspChar = () => this.nbspChar ?? fallback();
    this.extraPlugins = options.plugins ?? [];
    this.translate = options.translate ?? ((key) => key);
  }

  /* ------------------------------------------------------------ snapshot */

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): BodyEditorSnapshot => this.snapshot;

  /** Selection context for the Links / Table bars (`useSyncExternalStore`-compatible). */
  readonly subscribeContext = (listener: () => void): (() => void) => {
    this.contextListeners.add(listener);
    return () => {
      this.contextListeners.delete(listener);
    };
  };

  readonly getContext = (): SelectionContext => this.context;

  get editorView(): EditorView | null {
    return this.view;
  }

  /** Current editor state (also while unmounted); null without a document. */
  get editorState(): EditorState | null {
    return this.view ? this.view.state : this.state;
  }

  get currentWindow(): SectionWindow | null {
    return this.window;
  }

  get currentModel(): Document | null {
    return this.model;
  }

  get isMounted(): boolean {
    return this.view !== null;
  }

  private publish(): void {
    const w = this.window;
    const model = this.model;
    this.snapshot =
      w && model
        ? {
            hasDocument: true,
            wholeBook: w.wholeBook,
            bodyIndex: w.bodyIndex,
            bodyCount: w.bodyCount,
            bodyNames: model.bodies.map((body) => body.attrs.name),
            start: w.start,
            count: w.count,
            totalSections: w.totalSections,
            before: w.before,
            after: w.after,
            problems: w.report.problems.map((p) => `${p.path}: ${p.message}`),
          }
        : EMPTY_SNAPSHOT;
    for (const listener of [...this.listeners]) listener();
  }

  private publishSelection(): void {
    const state = this.editorState;
    this.context = state ? computeSelectionContext(state, this.window) : EMPTY_SELECTION_CONTEXT;
    actions.setSelection(this.store, this.context.path, this.context.nodeId);
    for (const listener of [...this.contextListeners]) listener();
  }

  /* ------------------------------------------------------------- mounting */

  /** Attaches the editor to `container` (creates the EditorView when a window exists). */
  mount(container: HTMLElement): void {
    if (this.container === container && this.view) return;
    this.unmount();
    this.container = container;
    this.ensureView();
  }

  /** Detaches the DOM view; the state (with its history) is kept for the next mount. */
  unmount(): void {
    if (this.view) {
      this.state = this.view.state;
      this.view.destroy();
      this.view = null;
    }
    this.container = null;
  }

  destroy(): void {
    this.unmount();
    this.listeners.clear();
    this.contextListeners.clear();
  }

  private createState(doc: PMNode): EditorState {
    return createBodyEditorState(doc, {
      getNbspChar: this.getNbspChar,
      isOvertype: () => this.store.getState().insertMode === 'overwrite',
      toggleOvertype: () => actions.toggleInsertMode(this.store),
      nextNodeId: this.nextNodeId,
      plugins: this.extraPlugins,
    });
  }

  private ensureView(): void {
    if (!this.window) return;
    if (!this.state || this.state.doc !== this.window.doc) {
      this.resetState(this.createState(this.window.doc));
    }
    if (!this.container) return;
    if (this.view) {
      if (this.view.state !== this.state) this.view.updateState(this.state!);
      return;
    }
    this.view = new EditorView(this.container, {
      state: this.state!,
      editable: () => this.editable,
      nodeViews: {
        ...createImageNodeViews({
          getDocId: () => this.store.getState().docId,
          getMissingText: () => this.translate('views.body.imageMissing'),
        }),
        ...createRawXmlNodeViews(() => this.translate('editing.unknownElement')),
        ...createTableNodeViews(),
      },
      dispatchTransaction: (tr) => this.dispatch(tr),
      attributes: { class: 'fb-editor', 'data-testid': 'body-editor' },
    });
    this.publishSelection();
  }

  /**
   * Replaces the state and forgets the ProseMirror history (the editor document was rebuilt
   * for another window or model); model-level steps stay undoable.
   */
  private resetState(state: EditorState): void {
    this.state = state;
    this.undo.clearView('body');
    if (this.view) this.view.updateState(state);
  }

  /* ------------------------------------------------------------- dispatch */

  private dispatch(tr: Transaction): void {
    const before = this.editorState;
    if (!before) return;
    if (tr.docChanged && this.closeNextHistory) closeHistory(tr);
    this.closeNextHistory = false;
    const { state: after, transactions } = before.applyTransaction(tr);
    if (this.view) this.view.updateState(after);
    this.state = after;
    const docChanged = transactions.some((t) => t.docChanged);
    if (docChanged) {
      const currentModel = this.store.getState().document;
      if (currentModel && this.window) {
        const result = replaceSectionsInModel(currentModel, this.window, after.doc);
        this.window = result.window;
        this.model = result.model;
        actions.updateDocument(this.store, result.model);
        this.publish();
      }
      if (!this.replaying && undoDepth(after) > undoDepth(before)) {
        this.undo.record('body', this.translate('views.body.undoLabel'));
      }
    }
    if (docChanged || transactions.some((t) => t.selectionSet)) this.publishSelection();
  }

  /**
   * Runs a ProseMirror command against the current state (view mounted or not). Each command
   * is its own undo step: the history group of preceding typing is closed first.
   */
  execute(command: Command): boolean {
    this.syncSelectionFromDom();
    const state = this.editorState;
    if (!state) return false;
    const result = command(state, (tr) => this.dispatch(closeHistory(tr)), this.view ?? undefined);
    if (result) {
      this.closeNextHistory = true;
      this.focus();
    }
    return result;
  }

  /**
   * The state commands are evaluated against. ProseMirror reads the browser selection
   * asynchronously (`selectionchange`); the editor state is the single source of truth here,
   * so a hotkey pressed within the same tick as a keyboard selection sees the previous one.
   */
  get selectionState(): EditorState | null {
    return this.editorState;
  }

  /** Kept for callers that want to make sure the state is current before reading it. */
  syncSelection(): void {
    this.syncSelectionFromDom();
  }

  /** Forces ProseMirror to process a pending (timer-scheduled) selection read. */
  private syncSelectionFromDom(): void {
    const view = this.view as unknown as { domObserver?: { forceFlush?: () => void } } | null;
    view?.domObserver?.forceFlush?.();
  }

  /** Dry run of a command (enable state), against the selection the user sees. */
  canExecute(command: Command): boolean {
    const state = this.selectionState;
    if (!state) return false;
    try {
      return command(state, undefined, this.view ?? undefined);
    } catch {
      return false;
    }
  }

  /** Applies a transaction built by the caller against `editorState` (its own undo step). */
  apply(tr: Transaction): void {
    this.dispatch(tr.docChanged ? closeHistory(tr) : tr);
    if (tr.docChanged) this.closeNextHistory = true;
  }

  focus(): void {
    if (this.view && !this.view.hasFocus()) this.view.focus();
  }

  /* ---------------------------------------------------------------- model */

  /**
   * Shows `model` (null closes the editor). A different `docId` resets the window to the first
   * body; a model produced by the editor's own edits is already represented and ignored. A
   * model whose mounted slice is unchanged (edits elsewhere) keeps the editor state.
   */
  setModel(model: Document | null, docId: string | null): void {
    if (model === this.model && docId === this.docId) return;
    if (docId !== this.docId) {
      this.bodyIndex = 0;
      this.range = null;
      this.docId = docId;
    } else if (
      model &&
      this.model &&
      this.window &&
      windowSliceUnchanged(this.model, model, this.window)
    ) {
      // Only parts outside the window changed: keep the ProseMirror state and history.
      this.model = model;
      this.window = { ...this.window, ...windowCounts(model, this.window) };
      this.publish();
      return;
    }
    this.model = model;
    if (!model) {
      this.window = null;
      this.state = null;
      this.view?.destroy();
      this.view = null;
      this.modelUndo = [];
      this.modelRedo = [];
      this.publish();
      this.context = EMPTY_SELECTION_CONTEXT;
      for (const listener of [...this.contextListeners]) listener();
      return;
    }
    this.rebuildWindow();
  }

  private windowOptions() {
    return {
      windowSize: this.windowSize,
      bodyIndex: this.bodyIndex,
      start: this.range?.start,
      count: this.range?.count,
    };
  }

  /** Rebuilds the editor document for the current window, preserving the caret when possible. */
  private rebuildWindow(): void {
    if (!this.model) return;
    const caret = this.editorState ? caretOf(this.editorState) : null;
    this.window = createWindow(this.model, this.windowOptions());
    this.ensureView();
    if (caret?.nodeId && this.state) {
      const selection = selectionFor(this.state.doc, caret.nodeId, caret.offset);
      if (selection) {
        this.state = this.state.apply(this.state.tr.setSelection(selection));
        this.view?.updateState(this.state);
      }
    }
    this.publish();
    this.publishSelection();
  }

  /** Mounts more sections towards the hidden ones ("... N more sections"). */
  extend(direction: 'before' | 'after'): void {
    if (!this.model || !this.window) return;
    const next = extendWindow(this.model, this.window, direction, this.windowSize, {
      windowSize: this.windowSize,
    });
    this.range = { start: next.start, count: next.count };
    this.rebuildWindow();
  }

  /** Switches to another body (windowed mode). */
  selectBody(index: number): void {
    if (!this.model) return;
    this.bodyIndex = index;
    this.range = null;
    this.rebuildWindow();
  }

  /**
   * Applies a reversible model-level step (an edit outside the mounted window) and records it
   * in the Body history. Returns the new model.
   */
  applyModelStep(step: ModelStep, label?: string): Document | null {
    const current = this.store.getState().document;
    if (!current) return null;
    const next = step.apply(current);
    this.commitStep(step, next, 'after');
    if (!this.replaying) {
      this.modelUndo.push(step);
      this.modelRedo = [];
      this.undo.record(BODY_MODEL_UNDO_VIEW, label ?? this.translate('views.body.undoLabel'));
    }
    return next;
  }

  /**
   * Stores the model a step produced: text blocks of the step that are mounted change through
   * one editor transaction outside the editor history; anything else refreshes the window.
   */
  private commitStep(step: ModelStep, next: Document, side: 'before' | 'after'): void {
    const state = this.editorState;
    const mounted =
      state && step.textblocks
        ? step.textblocks.filter((change) => findNodeById(state.doc, change.nodeId))
        : [];
    if (!state || !this.window || mounted.length === 0) {
      this.commitModel(next);
      return;
    }
    // The model takes every change first; the editor's transaction then writes the mounted
    // blocks back into it unchanged.
    this.model = next;
    actions.updateDocument(this.store, next);
    // Closed group: typing after the step is an undo step of its own.
    const tr = closeHistory(state.tr).setMeta('addToHistory', false);
    for (const change of mounted) {
      const found = findNodeById(tr.doc, change.nodeId);
      const node = nodeFromModel(change[side]);
      if (found && node) patchTextblock(tr, found.pos, found.node, node);
    }
    this.dispatch(tr);
  }

  /** Stores a model produced outside the editor and refreshes the window around it. */
  private commitModel(next: Document): void {
    const unchanged =
      this.model && this.window && windowSliceUnchanged(this.model, next, this.window);
    this.model = next;
    actions.updateDocument(this.store, next);
    if (unchanged && this.window) {
      this.window = { ...this.window, ...windowCounts(next, this.window) };
      this.publish();
    } else {
      this.rebuildWindow();
    }
  }

  /* ------------------------------------------------------------- settings */

  setEditable(editable: boolean): void {
    this.editable = editable;
    this.view?.setProps({ editable: () => this.editable });
  }

  get isEditable(): boolean {
    return this.editable;
  }

  setTranslate(translate: (key: string) => string): void {
    this.translate = translate;
  }

  /** Sets the NBSP display character (Settings > Other) and repaints the markers. */
  setNbspChar(char: string): void {
    if (this.nbspChar === char) return;
    this.nbspChar = char;
    this.refreshNbsp();
  }

  /** Repaints the NBSP markers after the display character changed. */
  refreshNbsp(): void {
    const state = this.editorState;
    if (state) this.dispatch(state.tr.setMeta(nbspPluginKey, 'refresh'));
  }

  /* ------------------------------------------------------------ undo/caret */

  /** `body` undo view: one ProseMirror history event. */
  undoStep(): boolean {
    const state = this.editorState;
    if (!state || undoDepth(state) === 0) return false;
    this.replaying = true;
    try {
      return undo(state, (tr) => this.dispatch(tr));
    } finally {
      this.replaying = false;
    }
  }

  redoStep(): boolean {
    const state = this.editorState;
    if (!state || redoDepth(state) === 0) return false;
    this.replaying = true;
    try {
      return redo(state, (tr) => this.dispatch(tr));
    } finally {
      this.replaying = false;
    }
  }

  get canUndo(): boolean {
    const state = this.editorState;
    return !!state && undoDepth(state) > 0;
  }

  get canRedo(): boolean {
    const state = this.editorState;
    return !!state && redoDepth(state) > 0;
  }

  /** `body-model` undo view: one model-level step. */
  undoModelStep(): boolean {
    const step = this.modelUndo.pop();
    const current = this.store.getState().document;
    if (!step || !current) return false;
    this.replaying = true;
    try {
      this.commitStep(step, step.revert(current), 'before');
    } finally {
      this.replaying = false;
    }
    this.modelRedo.push(step);
    return true;
  }

  redoModelStep(): boolean {
    const step = this.modelRedo.pop();
    const current = this.store.getState().document;
    if (!step || !current) return false;
    this.replaying = true;
    try {
      this.commitStep(step, step.apply(current), 'after');
    } finally {
      this.replaying = false;
    }
    this.modelUndo.push(step);
    return true;
  }

  get canUndoModelStep(): boolean {
    return this.modelUndo.length > 0;
  }

  get canRedoModelStep(): boolean {
    return this.modelRedo.length > 0;
  }

  getCaret(): Caret | null {
    const state = this.editorState;
    return state ? caretOf(state) : null;
  }

  /** Selects the node `caret.nodeId`, moving the window onto its section when needed. */
  setCaret(caret: Caret): boolean {
    if (!caret.nodeId || !this.model) return false;
    let state = this.editorState;
    let selection = state ? selectionFor(state.doc, caret.nodeId, caret.offset) : null;
    if (!selection) {
      if (!this.moveWindowTo(caret.nodeId)) return false;
      state = this.editorState;
      selection = state ? selectionFor(state.doc, caret.nodeId, caret.offset) : null;
      if (!selection) return false;
    }
    this.dispatch(state!.tr.setSelection(selection).scrollIntoView());
    this.focus();
    return true;
  }

  /** Moves the window so that the section containing `nodeId` is mounted (if not already). */
  moveWindowTo(nodeId: string): boolean {
    if (!this.model) return false;
    const state = this.editorState;
    if (state && findNodeById(state.doc, nodeId)) return true;
    const target = windowAround(this.model, nodeId, { windowSize: this.windowSize });
    if (!target) return false;
    this.bodyIndex = target.bodyIndex;
    this.range = { start: target.start, count: target.count };
    this.window = target;
    this.ensureView();
    this.publish();
    this.publishSelection();
    return true;
  }

  /**
   * Shows a Find / Replace match: mounts its section when needed, selects `[from, to)` inside
   * the text block `nodeId`, highlights it as the current match and scrolls it into view. The
   * focus stays where it is (the modeless Find dialog keeps it).
   */
  showSearchMatch(nodeId: string, from: number, to: number): boolean {
    if (!this.moveWindowTo(nodeId)) return false;
    const state = this.editorState;
    if (!state) return false;
    const found = findNodeById(state.doc, nodeId);
    if (!found || !found.node.isTextblock) return false;
    const base = found.pos + 1;
    const size = found.node.content.size;
    const start = base + Math.min(Math.max(from, 0), size);
    const end = base + Math.min(Math.max(to, from), size);
    const tr = state.tr.setSelection(TextSelection.create(state.doc, start, end));
    this.dispatch(withSearchMatch(tr, start, end).scrollIntoView());
    // ProseMirror scrolls to the selection only while it has the focus.
    const view = this.view;
    if (view) {
      const marked = view.dom.querySelector('.mfbe-search-match');
      const target = marked ?? view.domAtPos(start).node;
      const element = target instanceof Element ? target : target.parentElement;
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return true;
  }

  /** Selects the text range `[from, to)` inside the text block `nodeId` (find/replace). */
  selectRange(nodeId: string, from: number, to: number): boolean {
    if (!this.moveWindowTo(nodeId)) return false;
    const state = this.editorState;
    if (!state) return false;
    const found = findNodeById(state.doc, nodeId);
    if (!found || !found.node.isTextblock) return false;
    const base = found.pos + 1;
    const size = found.node.content.size;
    const start = base + Math.min(Math.max(from, 0), size);
    const end = base + Math.min(Math.max(to, from), size);
    this.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, start, end)).scrollIntoView(),
    );
    this.focus();
    return true;
  }
}

/* ------------------------------------------------------------------------ */
/* Registry                                                                 */
/* ------------------------------------------------------------------------ */

const controllers = new WeakMap<AppStore, BodyEditorController>();

/** The Body controller of `store` (created on first use). */
export function getBodyController(
  store: AppStore,
  undo?: UndoCoordinator,
  options: Partial<BodyEditorOptions> = {},
): BodyEditorController {
  let controller = controllers.get(store);
  if (!controller) {
    if (!undo) throw new Error('getBodyController: the controller has not been created yet');
    controller = new BodyEditorController({ store, undo, ...options });
    controllers.set(store, controller);
  }
  return controller;
}

export function hasBodyController(store: AppStore): boolean {
  return controllers.has(store);
}
