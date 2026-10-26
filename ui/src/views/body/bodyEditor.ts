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
 * - While a script runs (`setLocked`) the user cannot change the document: the view is not
 *   editable and every change but the run's own (`showModel`) is refused.
 */

import { Slice, type Node as PMNode } from 'prosemirror-model';
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import {
  AllSelection,
  EditorState,
  NodeSelection,
  type Plugin,
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { DISCRETE_STEP } from '@/editor/commands/util';
import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { baseEditorKeymap, bodyKeymap } from '@/editor/keymap';
import { binaryLookup, createImageNodeViews } from '@/editor/nodeviews/image';
import { createRawXmlNodeViews } from '@/editor/nodeviews/rawXml';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import { blockBoundaryPlugin, markControllerTransaction } from '@/editor/plugins/blockBoundary';
import { blockCaptionsKey, blockCaptionsPlugin } from '@/editor/plugins/blockCaptions';
import { clipboardPlugin, type ClipboardOptions } from '@/editor/plugins/clipboard';
import { DEFAULT_NBSP_DISPLAY_CHAR, nbspMarkerPlugin, nbspPluginKey } from '@/editor/plugins/nbsp';
import { nodeIdPlugin } from '@/editor/plugins/nodeIds';
import { overtypePlugin } from '@/editor/plugins/overtype';
import { searchMatchPlugin, withSearchMatch } from '@/editor/plugins/searchMatch';
import { selectionSyncPlugin } from '@/editor/plugins/selectionSync';
import { tableEditingPlugin } from '@/editor/table/plugin';
import {
  computeSelectionContext,
  EMPTY_SELECTION_CONTEXT,
  type SelectionContext,
} from '@/editor/plugins/selectionPath';
import { BLOCK_KINDS, createNodeIdGenerator, findNodeById } from '@/editor/schema';
import {
  DEFAULT_WINDOW_SIZE,
  blockFromModel,
  bodiesSliceUnchanged,
  blocksUnchanged,
  createWindow,
  extendWindow,
  leadingBlocks,
  replaceSectionsInModel,
  windowAround,
  windowCounts,
  windowSliceUnchanged,
  type SectionWindow,
} from '@/editor/virtualization';
import { pathOfCaret, type StructuralPosition } from '@/editor/structuralPath';
import type { Document } from '@/model/document';
import { collectBookIds } from '@/model/ids';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { Caret, ModelPoint } from '@/rpc/types';

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

/** The two ends of a Body selection as model points (feature 004 US7, data-model §7). */
export interface SelectionPoints {
  anchor: ModelPoint;
  head: ModelPoint;
}

/**
 * One end of a selection as a model point: the text block around it with ProseMirror's
 * `parentOffset`, else the nearest id-bearing ancestor with offset 0; null outside every
 * id-bearing node.
 */
function pointOf($pos: ReturnType<PMNode['resolve']>): ModelPoint | null {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    const id = node.attrs.nodeId;
    if (typeof id !== 'string' || !id) continue;
    return { nodeId: id, offset: depth === $pos.depth && node.isTextblock ? $pos.parentOffset : 0 };
  }
  return null;
}

/**
 * The selection of `state` as two model points for `doc.mapPositions` (`toSource`): a text
 * selection's ends are `{text block id, parentOffset}`, a node selection (an image, an
 * unknown element) is `{the selected node's id, 0}` at both ends. Null without a selection
 * inside an id-bearing node (an empty editor document).
 */
export function selectionPoints(state: EditorState): SelectionPoints | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    const id = selection.node.attrs.nodeId;
    if (typeof id === 'string' && id) {
      const point = { nodeId: id, offset: 0 };
      return { anchor: point, head: { ...point } };
    }
  }
  const anchor = pointOf(selection.$anchor);
  const head = pointOf(selection.$head);
  return anchor && head ? { anchor, head } : null;
}

/**
 * The selection a model point names in `doc`: inside a text block at the (clamped) offset;
 * before an atom (an image, an empty line, an unknown element - the node itself when it is
 * selectable); the first text position inside a container. Null when the node is not there.
 */
function selectionAtPoint(doc: PMNode, point: ModelPoint): Selection | null {
  const found = findNodeById(doc, point.nodeId);
  if (!found) return null;
  if (found.node.isTextblock) {
    const offset = Math.min(Math.max(Math.floor(point.offset) || 0, 0), found.node.content.size);
    return TextSelection.create(doc, found.pos + 1 + offset);
  }
  if (found.node.isLeaf) return Selection.near(doc.resolve(found.pos), 1);
  return Selection.near(doc.resolve(Math.min(found.pos + 1, doc.content.size)), 1);
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

/** A position inside a text block as its node id and text offset (null elsewhere). */
function textPoint(doc: PMNode, pos: number): { nodeId: string; offset: number } | null {
  const $pos = doc.resolve(pos);
  const id = $pos.parent.isTextblock ? $pos.parent.attrs.nodeId : null;
  return typeof id === 'string' && id ? { nodeId: id, offset: $pos.parentOffset } : null;
}

/** The position of a text point in `doc`; null when its text block is not there. */
function textPointPos(doc: PMNode, point: { nodeId: string; offset: number }): number | null {
  const found = findNodeById(doc, point.nodeId);
  if (!found || !found.node.isTextblock) return null;
  return found.pos + 1 + Math.min(point.offset, found.node.content.size);
}

/** A text selection of `oldDoc` placed in `doc` on the same text blocks and offsets. */
function selectionOnSameNodes(selection: Selection, oldDoc: PMNode, doc: PMNode): Selection | null {
  if (!(selection instanceof TextSelection)) return null;
  const anchor = textPoint(oldDoc, selection.anchor);
  const head = textPoint(oldDoc, selection.head);
  const from = anchor && textPointPos(doc, anchor);
  const to = head && textPointPos(doc, head);
  return typeof from === 'number' && typeof to === 'number'
    ? TextSelection.create(doc, from, to)
    : null;
}

/**
 * Turns `current` into `next` with one step over the part of their content that differs:
 * `current` is `tr.doc` itself when `at` is undefined, else the node at position `at` of
 * `tr.doc` (a description block). When the step did not reach `next` (an attribute change),
 * the whole node is replaced.
 */
function replaceDifferences(tr: Transaction, current: PMNode, next: PMNode, at?: number): void {
  const inner = at === undefined ? 0 : at + 1;
  const start = current.content.findDiffStart(next.content);
  if (start !== null) {
    let { a: endA, b: endB } = current.content.findDiffEnd(next.content)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    tr.replace(inner + start, inner + endA, next.slice(start, endB));
  }
  if (at === undefined) {
    if (!tr.doc.eq(next)) tr.replaceWith(0, tr.doc.content.size, next.content);
    return;
  }
  const result = tr.doc.nodeAt(at);
  if (!result || !result.eq(next)) tr.replaceWith(at, at + (result?.nodeSize ?? 0), next);
}

/** Top-level sections of a body of the model. */
function sectionsOf(
  body: Document['bodies'][number] | undefined,
): Document['bodies'][number]['content'] {
  return body ? body.content.filter((child) => child.type === 'section') : [];
}

export interface EditorStateOptions {
  getNbspChar: () => string;
  /** Extra ProseMirror plugins contributed by features (e.g. spell checking). */
  plugins?: Plugin[];
  isOvertype?: () => boolean;
  toggleOvertype?: () => void;
  nextNodeId?: () => string;
  /** The localised texts the block captions use (read on every repaint). */
  getTranslate?: () => (key: string) => string;
  /**
   * The paste router's options (feature 006, I14): the book's ids, the node-id generator and the
   * status bar. Without them: no book ids, the state's generator, no messages (the unit tests).
   */
  clipboard?: ClipboardOptions;
}

export function createBodyEditorState(doc: PMNode, options: EditorStateOptions): EditorState {
  // One generator for the keymap's Tab row and the node-id plugin (feature 006, §1.6).
  const nextNodeId = options.nextNodeId ?? createNodeIdGenerator();
  return EditorState.create({
    doc,
    plugins: [
      history(),
      // The block of cells (feature 006, data-model §5.4): before the keymaps, so its
      // Shift+Arrow handling comes first; it has no paste props - `clipboardPlugin` keeps
      // claiming every paste (C4).
      tableEditingPlugin(),
      // The browser selection read before a press elsewhere or a key is handled, and the focus
      // that a press into the editor gives it (after the table plugin's press handling, which
      // leaves a plain press to the plugins after it).
      selectionSyncPlugin(),
      bodyKeymap({ toggleOvertype: options.toggleOvertype, nextNodeId }),
      baseEditorKeymap(),
      overtypePlugin(options.isOvertype ?? (() => false)),
      // Before the feature plugins, so it claims every paste (C4).
      clipboardPlugin(
        options.clipboard ?? { bookIds: () => new Set(), nextNodeId, message: () => {} },
      ),
      blockBoundaryPlugin(),
      blockCaptionsPlugin(options.getTranslate ?? (() => (key) => key)),
      nodeIdPlugin(nextNodeId),
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
  /** A script is running: only its own changes (`showModel`) reach the document. */
  private locked = false;
  private nbspChar: string | null = null;
  private readonly getNbspChar: () => string;
  private readonly extraPlugins: Plugin[];
  private translate: (key: string) => string;
  /**
   * The generator of the editor's `ui_N` node ids, shared with `nodeIdPlugin` (feature 006,
   * data-model §1.6): a function property, so it may be passed on unbound - the table plans
   * stamp every node they create with it, and the plugin then has nothing to append.
   */
  readonly nextNodeId = createNodeIdGenerator();

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
  /**
   * A selection placed while unmounted (a mapped Source selection, a restored position) is
   * scrolled into view when the view mounts (feature 004 US8, research R5.1 H5-a).
   */
  private scrollOnMount = false;
  /**
   * The Body view was shown for the current document, or its caret was placed on purpose
   * (`setCaret`): only then is the caret worth remembering - a document whose Body view was
   * never looked at keeps its previous record (feature 004 FR-100, research R5.6).
   */
  private shown = false;

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

  /** True once the Body view was mounted for this document or its caret was placed. */
  get bodyShown(): boolean {
    return this.shown;
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
    if (this.view) this.shown = true;
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
      getTranslate: () => this.translate,
      plugins: this.extraPlugins,
      // The paste router (feature 006, I14): the whole book's ids from the store's document, the
      // generator the plans share, refusals in the status bar.
      clipboard: {
        bookIds: () => {
          const document = this.store.getState().document;
          return document ? collectBookIds(document) : new Set<string>();
        },
        nextNodeId: this.nextNodeId,
        message: (key) => actions.setStatusMessage(this.store, this.translate(key)),
      },
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
    const kept = this.state!;
    // ProseMirror draws a selection only when an update changes it or the view takes the focus,
    // so a new view would not show a node selection kept while the view was unmounted (a picture
    // selected before another view was visited) although the commands act on it. The view
    // starts with the selection widened to the whole document and then shows the kept state,
    // which draws it without taking the focus.
    const drawSelection = kept.selection instanceof NodeSelection;
    this.view = new EditorView(this.container, {
      state: drawSelection ? kept.apply(kept.tr.setSelection(new AllSelection(kept.doc))) : kept,
      editable: () => this.isEditable,
      nodeViews: {
        ...createImageNodeViews({
          getDocId: () => this.store.getState().docId,
          getMissingText: () => this.translate('views.body.imageMissing'),
          // The pictures' boxes are reserved from the binary list (feature 006, R9.2).
          getBinary: binaryLookup(() => this.store.getState().document?.binaries),
        }),
        ...createRawXmlNodeViews(() => this.translate('editing.unknownElement')),
        ...createTableNodeViews(),
      },
      dispatchTransaction: (tr) => this.dispatch(tr),
      // `spellcheck="false"`: the browser engine's own checker stays off the editable root (the
      // editor's own plugin marks the misspellings - feature 004 US9, FR-081).
      attributes: { class: 'fb-editor', 'data-testid': 'body-editor', spellcheck: 'false' },
    });
    if (drawSelection) this.view.updateState(kept);
    if (this.scrollOnMount) {
      // The selection was placed while the view was unmounted (a mapped Source selection, a
      // restored position): bring it into view now that there is a DOM to scroll. The focus
      // comes first - ProseMirror scrolls to the selection only while it owns the DOM
      // selection, which it syncs on focus.
      this.scrollOnMount = false;
      this.view.focus();
      this.view.dispatch(this.view.state.tr.scrollIntoView());
    }
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
    this.applyToEditor(tr, false);
  }

  /**
   * Applies a transaction and writes the edited window back into the model, unless
   * `modelShown`: the store already holds the document the transaction shows (`showModel`).
   * While locked only such transactions may change the document. A document change that
   * carries `DISCRETE_STEP` (a table command, a paste, a cleared block - feature 006, FR-045)
   * is one history event of its own, as a command run through `execute` is: the group before
   * it is closed, and so is the one after it.
   */
  private applyToEditor(tr: Transaction, modelShown: boolean): void {
    const before = this.editorState;
    if (!before) return;
    if (tr.docChanged && this.locked && !modelShown) return;
    const discrete = tr.docChanged && tr.getMeta(DISCRETE_STEP) === true;
    if (tr.docChanged && (this.closeNextHistory || discrete)) closeHistory(tr);
    this.closeNextHistory = discrete;
    const { state: after, transactions } = before.applyTransaction(tr);
    if (this.view) this.view.updateState(after);
    this.state = after;
    const docChanged = transactions.some((t) => t.docChanged);
    if (docChanged) {
      const currentModel = this.store.getState().document;
      if (modelShown && transactions.length === 1 && this.window) {
        // The blocks of the shown document represent the model's nodes again.
        this.window = { ...this.window, doc: after.doc, blocks: leadingBlocks(after.doc) };
      } else if (currentModel && this.window) {
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
   * asynchronously (`selectionchange`); a key and a press outside the editor have it read first
   * (`selectionSyncPlugin`), so a hotkey or a menu sees a keyboard selection made just before.
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
      // A new document: its Body view has not been shown yet (the view may be mounted right
      // away, which `mount()` records; a caret placed by `setCaret()` counts as well).
      this.shown = this.view !== null && model !== null;
    } else if (model && this.model && this.window) {
      if (windowSliceUnchanged(this.model, model, this.window)) {
        // Only parts outside the window changed: keep the ProseMirror state and history.
        this.model = model;
        this.window = { ...this.window, ...windowCounts(model, this.window) };
        this.publish();
        return;
      }
      if (bodiesSliceUnchanged(this.model, model, this.window) && this.editorState) {
        // Bodies unchanged, a description block changed outside the editor (a Description
        // field edit, its undo, Replace in the Description view): rebuild that block alone.
        this.showBlocks(model);
        return;
      }
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

  /**
   * Shows the annotation / history nodes of `next` in the mounted blocks (feature 004, US2):
   * only the block whose model node changed is rebuilt, through one editor transaction kept
   * out of the editor history (the `showModel` pattern), so the Body history and the caret
   * survive an edit made in the Description view.
   */
  private showBlocks(next: Document): void {
    const previous = this.model;
    const state = this.editorState;
    const window = this.window;
    if (!previous || !state || !window) return;
    const tr = markControllerTransaction(closeHistory(state.tr).setMeta('addToHistory', false));
    let pos = 0;
    for (const kind of BLOCK_KINDS) {
      const mounted = window.blocks[kind];
      if (!mounted) continue;
      const current = tr.doc.nodeAt(pos);
      if (!current || current.type !== mounted.type) break;
      const before =
        kind === 'annotation'
          ? previous.description.titleInfo.annotation
          : previous.description.documentInfo.history;
      const after =
        kind === 'annotation'
          ? next.description.titleInfo.annotation
          : next.description.documentInfo.history;
      if (before !== after) {
        const rebuilt = blockFromModel(kind, after, this.nextNodeId);
        if (!current.eq(rebuilt)) {
          replaceDifferences(tr, current, rebuilt, pos);
        }
      }
      pos += tr.doc.nodeAt(pos)!.nodeSize;
    }
    const selection = selectionOnSameNodes(state.selection, state.doc, tr.doc);
    if (selection) tr.setSelection(selection);
    this.model = next;
    this.window = { ...window, ...windowCounts(next, window) };
    // The store holds `next` already when the change came from outside the controller; a
    // model step (`commitModel`) stores it here, before the editor shows it.
    if (this.store.getState().document !== next) actions.updateDocument(this.store, next);
    this.applyToEditor(tr, true);
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
    if (!current || this.locked) return null;
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
    const tr = markControllerTransaction(closeHistory(state.tr).setMeta('addToHistory', false));
    for (const change of mounted) {
      const found = findNodeById(tr.doc, change.nodeId);
      const node = nodeFromModel(change[side]);
      if (found && node) patchTextblock(tr, found.pos, found.node, node);
    }
    this.dispatch(tr);
  }

  /**
   * Shows `next` - this document as a script run left it, or as the run's undo or redo restores
   * it - through one editor transaction kept out of the editor history, so the edits made
   * before stay undoable. The window stays on the body and sections the user was looking at
   * (followed by their node ids), the selection on its text blocks.
   */
  showModel(next: Document): void {
    const previous = this.model;
    const state = this.editorState;
    if (next === previous) return;
    if (!previous || !state || !this.window) {
      this.model = next;
      actions.updateDocument(this.store, next);
      this.rebuildWindow();
      return;
    }
    this.followWindow(previous, next);
    let window = createWindow(next, this.windowOptions());
    const head = textPoint(state.doc, state.selection.head);
    if (head && !findNodeById(window.doc, head.nodeId)) {
      // The change moved the caret's block out of the window: show the part around it.
      const around = windowAround(next, head.nodeId, { windowSize: this.windowSize });
      if (around) {
        window = around;
        this.bodyIndex = around.bodyIndex;
        this.range = around.wholeBook ? null : { start: around.start, count: around.count };
      }
    }
    window = this.keepUnchangedBlocks(window, previous, next);
    const tr = markControllerTransaction(closeHistory(state.tr).setMeta('addToHistory', false));
    replaceDifferences(tr, state.doc, window.doc);
    const selection = selectionOnSameNodes(state.selection, state.doc, tr.doc);
    if (selection) tr.setSelection(selection);
    this.model = next;
    // The blocks that now represent the model's nodes are the ones of the shown document.
    this.window = { ...window, blocks: leadingBlocks(tr.doc) };
    actions.updateDocument(this.store, next);
    this.applyToEditor(tr, true);
    this.publish();
    this.publishSelection();
  }

  /**
   * `window` with the editor's own block nodes where the model's annotation / history node did
   * not change between `previous` and `next`: a block rebuilt from the same node is equal in
   * content but not in identity (an absent node gets a fresh paragraph id), and a replacement
   * at the top of the document would rebase the history of the body text below it.
   */
  private keepUnchangedBlocks(
    window: SectionWindow,
    previous: Document,
    next: Document,
  ): SectionWindow {
    const current = this.window;
    if (!current) return window;
    const children: PMNode[] = [];
    window.doc.forEach((child) => children.push(child));
    let changed = false;
    BLOCK_KINDS.forEach((kind, index) => {
      const mounted = current.blocks[kind];
      const fresh = window.blocks[kind];
      if (!mounted || !fresh || fresh !== children[index]) return;
      const before =
        kind === 'annotation'
          ? previous.description.titleInfo.annotation
          : previous.description.documentInfo.history;
      const after =
        kind === 'annotation'
          ? next.description.titleInfo.annotation
          : next.description.documentInfo.history;
      if (before !== after || mounted.type !== fresh.type) return;
      children[index] = mounted;
      changed = true;
    });
    if (!changed) return window;
    const doc = window.doc.type.create(window.doc.attrs, children);
    return { ...window, doc, blocks: leadingBlocks(doc) };
  }

  /** Keeps a section window on the same body and first section when the model changed. */
  private followWindow(previous: Document, next: Document): void {
    const window = this.window;
    if (!window || window.wholeBook) return;
    const bodyId = previous.bodies[window.bodyIndex]?.attrs.nodeId;
    const bodyIndex = next.bodies.findIndex((body) => body.attrs.nodeId === bodyId);
    if (bodyIndex < 0) return;
    this.bodyIndex = bodyIndex;
    const firstId = sectionsOf(previous.bodies[window.bodyIndex])[window.start]?.attrs.nodeId;
    const start = sectionsOf(next.bodies[bodyIndex]).findIndex(
      (section) => section.attrs.nodeId === firstId,
    );
    if (start >= 0) this.range = { start, count: window.count };
  }

  /** Stores a model produced outside the editor and refreshes the window around it. */
  private commitModel(next: Document): void {
    const previous = this.model;
    const window = this.window;
    const unchanged = previous && window && windowSliceUnchanged(previous, next, window);
    if (
      !unchanged &&
      previous &&
      window &&
      this.editorState &&
      bodiesSliceUnchanged(previous, next, window) &&
      !blocksUnchanged(previous, next, window)
    ) {
      // Only a description block changed: rebuild it in place, keeping the editor history.
      this.showBlocks(next);
      return;
    }
    this.model = next;
    actions.updateDocument(this.store, next);
    if (unchanged && window) {
      this.window = { ...window, ...windowCounts(next, window) };
      this.publish();
    } else {
      this.rebuildWindow();
    }
  }

  /* ------------------------------------------------------------- settings */

  setEditable(editable: boolean): void {
    this.editable = editable;
    this.view?.setProps({ editable: () => this.isEditable });
  }

  /** The user can change the document (editable and no script running). */
  get isEditable(): boolean {
    return this.editable && !this.locked;
  }

  /** Locks the document while a script runs (the run itself changes it through `showModel`). */
  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.view?.setProps({ editable: () => this.isEditable });
  }

  setTranslate(translate: (key: string) => string): void {
    if (this.translate === translate) return;
    this.translate = translate;
    // The block captions are drawn from the catalogue: repaint them in the new language.
    const state = this.editorState;
    if (state) this.dispatch(state.tr.setMeta(blockCaptionsKey, 'refresh'));
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
      // A replay restores a state the editor had: the boundary filter lets it through.
      return undo(state, (tr) => this.dispatch(markControllerTransaction(tr)));
    } finally {
      this.replaying = false;
    }
  }

  redoStep(): boolean {
    const state = this.editorState;
    if (!state || redoDepth(state) === 0) return false;
    this.replaying = true;
    try {
      return redo(state, (tr) => this.dispatch(markControllerTransaction(tr)));
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

  /**
   * The caret as a remembered position (feature 004 US8, research R5.2): the structural path
   * of the deepest node at the selection head (window offsets applied) and the offset inside
   * it when it is a text block, 0 otherwise (a selected image, a table). Null without a
   * document or for an empty editor document.
   */
  getPosition(): StructuralPosition | null {
    const state = this.editorState;
    if (!state) return null;
    const path = pathOfCaret(state, this.window);
    if (!path) return null;
    const $head = state.selection.$head;
    const node = (state.selection as { node?: PMNode }).node;
    const offset = node && node.isLeaf && !node.isTextblock ? 0 : $head.parentOffset;
    return { path, offset };
  }

  /**
   * Selects the node `caret.nodeId`, moving the window onto its section when needed. Works
   * mounted or not: unmounted, the selection is set in the kept state and scrolled into view
   * when the view mounts (feature 004 US8 - the view a file opens in is never switched).
   */
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
    // Mounted: the focus first, so that ProseMirror owns the DOM selection and scrolls to it
    // (it scrolls only then); unmounted: the kept state, scrolled into view on mount.
    this.focus();
    this.dispatch(state!.tr.setSelection(selection).scrollIntoView());
    if (!this.view) this.scrollOnMount = true;
    this.shown = true;
    return true;
  }

  /**
   * Selects from `anchor` to `head` (feature 004 US7, the mapped Source selection): the window
   * is moved onto the head's section; a range whose anchor the mounted window does not hold
   * becomes a caret at the head; a point naming a text block lands at its offset, an atom is
   * selected (the position before it), a container at its first text position. False when
   * the head's node is not in the document. The selection is scrolled into view when the view
   * mounts, if it is not mounted yet.
   */
  setSelectionPoints(anchor: ModelPoint, head: ModelPoint): boolean {
    if (!this.model || !this.moveWindowTo(head.nodeId)) return false;
    const state = this.editorState;
    if (!state) return false;
    const headSelection = selectionAtPoint(state.doc, head);
    if (!headSelection) return false;
    let selection: Selection = headSelection;
    const samePoint = anchor.nodeId === head.nodeId && anchor.offset === head.offset;
    if (!samePoint) {
      const anchorSelection = selectionAtPoint(state.doc, anchor);
      if (anchorSelection) {
        selection = TextSelection.between(
          state.doc.resolve(anchorSelection.anchor),
          state.doc.resolve(headSelection.head),
        );
      }
    }
    // Mounted: the focus first (ProseMirror scrolls only while it owns the DOM selection), as
    // `setCaret` does; unmounted: scrolled into view on mount.
    this.focus();
    this.dispatch(state.tr.setSelection(selection).scrollIntoView());
    if (!this.view) this.scrollOnMount = true;
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
    // The focus first, as `setCaret` does: ProseMirror scrolls to the selection only while it
    // owns the DOM selection, and a focus taken afterwards does not scroll (the Find dialog,
    // a text field or a menu had it).
    this.focus();
    this.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, start, end)).scrollIntoView(),
    );
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
