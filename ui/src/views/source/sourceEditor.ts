/**
 * Imperative controller of the Source editor (T050/T079): owns the CodeMirror 6 state (XML
 * language, folding, bracket/tag matching, history; Find and Replace go through the shared
 * dialogs) and the loading state.
 * `SourceView.tsx` mounts it and renders the chrome from `getSnapshot()`.
 *
 * One controller exists per store (`sourceEditorFor(store, undo)`), created by the Source
 * feature registrar so that the Source history is its own undo view (data-model.md §2.2): the
 * `EditorState` - including its history - survives view switches, and the undo/caret adapters
 * work headless (`undoStep()`, `setCaret()`) while the Body or Description view is shown. The
 * `EditorView` only exists while the view is mounted.
 *
 * Text changes go to the Source session (`sync.ts`) which keeps the `sourceDirty` / `modified`
 * flags; one `UndoCoordinator` entry is recorded per CodeMirror history event.
 * `getCaret()` / `setCaret()` expose the selection as `{view: 'source', line, column}`.
 * Settings (wrap, line numbers, syntax highlighting, EOL / white-space marks, matched tags, tag
 * completion, font) are applied live through compartments, as is the interface theme
 * (`setDark()`: CodeMirror's dark flag and the dark highlight style of theme.ts); Insert toggles
 * the store's `insertMode` (INS/OVR). Tag completion (feature 003 US8, `completion.ts`) sits
 * before the editor keymaps so its Enter / Tab / Escape bindings win while a list is open.
 *
 * While a script runs or an AI request is in progress (`store.runLock`, the quiet lock of
 * feature 003 FR-011 and feature 005 FR-022) the editor
 * is read-only (`EditorState.readOnly` + `EditorView.editable(false)` in a compartment): typing,
 * pasting, cutting and deleting are refused, nothing is greyed, selecting and copying keep
 * working, and the clipboard commands and the context menu follow `state.readOnly`.
 *
 * *Add → Table* in the Source view (feature 006, FR-061; I23; data-model §7.3): `tablePoint()`
 * is the table rule's verdict at the end of the selection (`tablePoint.ts`), memoised on the
 * text, the selection's end, the tree's completeness, the core's parse error and the load
 * status, so `insert.table`'s `enabled` is cheap and synchronous; `subscribeContext` tells the
 * command states when the verdict changes, 100 ms after the last selection, text or tree
 * change; `pointAt` judges the point under the pointer for the context menu (C28), and a
 * right-click keeps the cursor where it is; `insertTable` inserts the table's XML
 * (`tableInsert.ts`) as one undo step. While the view is mounted an idle task completes the
 * syntax tree in slices of at most 25 ms - CodeMirror stops parsing 100,000 characters past
 * the viewport, and the rule needs the whole text.
 */

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  bracketMatching,
  ensureSyntaxTree,
  foldGutter,
  foldKeymap,
  syntaxTree,
  syntaxTreeAvailable,
} from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
} from '@codemirror/view';

import type { CommandContext } from '@/app/commands';
import { nbspMarker } from '@/editor/plugins/nbsp';
import type { CaretProvider } from '@/model/caret';
import { actions, isRunLocked, type AppStore } from '@/model/store';
import type { UndoCoordinator, ViewHistoryAdapter } from '@/model/undo';
import type { Caret, DocParseErrorData, Settings } from '@/rpc/types';

import { registerCompletionEditor, sourceCompletionExtension } from './completion';
import {
  binaryPlaceholdersExtension,
  collapseLevel,
  eolMarksExtension,
  expandLevel,
  highlightExtension,
  highlightLineEffect,
  highlightedLineField,
  lineColumnAt,
  lineNumbersExtension,
  matchedTagsExtension,
  matchingTagPosition,
  nbspSourceExtension,
  nextSyntaxError,
  offsetForLineColumn,
  overtypeExtension,
  parseSourceFont,
  sourceLanguage,
  whitespaceExtension,
  wrapExtension,
  type EditorTarget,
  type SourceFont,
} from './extensions';
import { createSourceSearchTarget, type SourceSearchTarget } from './searchTarget';
import {
  loadSourceText,
  mapBodySelectionToSource,
  onSourceSessionReset,
  registerSourceSelectionReader,
  sourceSession,
  updateSourceText,
  type SourceOffsets,
} from './sync';
import { planSourceTableInsertion, type SourceTableSpec } from './tableInsert';
import { sourceTablePoint, sourceVerdictKey, type SourceVerdict } from './tablePoint';
import { sourceThemeExtension } from './theme';

export { offsetForLineColumn } from './extensions';
export type { EditorTarget } from './extensions';
export type { SourceSearchOptions, SourceSearchTarget } from './searchTarget';
export type { SourceTableSpec } from './tableInsert';
export type { SourceVerdict } from './tablePoint';

/**
 * The table rule at a right-click (C28): the verdict at the offset under the pointer and that
 * offset, where running *Table…* first moves the cursor - or, for a click inside a non-empty
 * selection, the verdict at the selection's end and `moveTo` null (the selection stays).
 */
export interface SourcePointAt {
  verdict: SourceVerdict;
  moveTo: number | null;
}

/** How long after the last selection, text or tree change the table state is announced. */
const CONTEXT_DELAY_MS = 100;
/** How long after a change the idle parse task starts again. */
const PARSE_DELAY_MS = 150;
/** The longest slice of the idle parse task. */
const PARSE_SLICE_MS = 25;

/** 1-based column of the first non-blank character of `line` (1 for blank lines). */
export function firstNonBlankColumn(state: EditorState, line: number): number {
  const info = state.doc.line(Math.min(Math.max(line, 1), state.doc.lines));
  const index = info.text.search(/\S/);
  return index < 0 ? 1 : index + 1;
}

/** Caret of a CodeMirror state as `{view: 'source', line, column}` (1-based). */
export function caretOfState(state: EditorState): Caret {
  const { line, column } = lineColumnAt(state, state.selection.main.head);
  return { view: 'source', line, column };
}

export interface SourceEditorSettings {
  wrap: boolean;
  lineNumbers: boolean;
  highlight: boolean;
  showEol: boolean;
  showWhitespace: boolean;
  matchTags: boolean;
  /** Tag completion after `<` and `</` (`view.sourceTagCompletion`, feature 003). */
  tagCompletion: boolean;
  /** Raw `view.sourceFont` setting ("Consolas, 12"); empty = defaults. */
  font: string;
  /** Non-breaking-space marker (□ ▫ ◦), null for the plain space (`other.nbspDisplayChar`). */
  nbspMarker: string | null;
}

export const DEFAULT_SOURCE_SETTINGS: SourceEditorSettings = {
  wrap: true,
  lineNumbers: true,
  highlight: true,
  showEol: false,
  showWhitespace: false,
  matchTags: true,
  tagCompletion: true,
  font: '',
  nbspMarker: null,
};

/** The Source editor settings of the application settings (defaults when unavailable). */
export function sourceSettingsOf(settings: Settings | null | undefined): SourceEditorSettings {
  const view = settings?.view;
  if (!view) return DEFAULT_SOURCE_SETTINGS;
  return {
    nbspMarker: nbspMarker(settings?.other?.nbspDisplayChar),
    wrap: view.sourceWrap ?? DEFAULT_SOURCE_SETTINGS.wrap,
    lineNumbers: view.sourceLineNumbers ?? DEFAULT_SOURCE_SETTINGS.lineNumbers,
    highlight: view.sourceSyntaxHighlight ?? DEFAULT_SOURCE_SETTINGS.highlight,
    showEol: view.sourceShowEol ?? DEFAULT_SOURCE_SETTINGS.showEol,
    showWhitespace: view.sourceShowWhitespace ?? DEFAULT_SOURCE_SETTINGS.showWhitespace,
    matchTags: view.sourceMatchTags ?? DEFAULT_SOURCE_SETTINGS.matchTags,
    tagCompletion: view.sourceTagCompletion ?? DEFAULT_SOURCE_SETTINGS.tagCompletion,
    font: view.sourceFont ?? '',
  };
}

export function sameSourceSettings(a: SourceEditorSettings, b: SourceEditorSettings): boolean {
  return (
    a.wrap === b.wrap &&
    a.lineNumbers === b.lineNumbers &&
    a.highlight === b.highlight &&
    a.showEol === b.showEol &&
    a.showWhitespace === b.showWhitespace &&
    a.matchTags === b.matchTags &&
    a.tagCompletion === b.tagCompletion &&
    a.font === b.font &&
    a.nbspMarker === b.nbspMarker
  );
}

export type SourceLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface SourceEditorSnapshot {
  status: SourceLoadStatus;
  loadError: string | null;
}

export type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface SourceEditorOptions {
  store: AppStore;
  undo: UndoCoordinator;
  translate?: Translate;
  settings?: SourceEditorSettings;
  /** Start with the dark interface theme (default: light). */
  dark?: boolean;
}

/** How long the navigation line highlight stays (ms). */
const HIGHLIGHT_MS = 2500;

const overtypeAttributes = EditorView.editorAttributes.of({ class: 'mfbe-source-overtype' });

/**
 * A right-click keeps the cursor (feature 006, C28): the browser would otherwise move its
 * caret to the pointer, which CodeMirror reads as the new selection only when that reaches it
 * before the context menu takes the focus - a race. The menu judges *Table…* at the clicked
 * point and moves the cursor there only when the entry runs. The editor still takes the focus
 * that the press would give it.
 */
const rightClickKeepsSelection = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 2) return false;
    event.preventDefault();
    if (!view.hasFocus) view.focus();
    return true;
  },
});

/**
 * The read-only configuration of a locked editor: commands and key bindings see
 * `state.readOnly`, the content is not `contenteditable` (no typing, pasting or dropping) while
 * it stays selectable; nothing is styled differently.
 */
export function lockExtension(locked: boolean): Extension {
  return locked ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

/** Dispatch target used while the editor is not mounted (transactions go to the kept state). */
class HeadlessTarget implements EditorTarget {
  constructor(private readonly owner: SourceEditorController) {}

  get state(): EditorState {
    return this.owner.state;
  }

  // Bound: CodeMirror's state commands destructure `{state, dispatch}` from the target.
  readonly dispatch = (spec: TransactionSpec): void => {
    this.owner.dispatchHeadless(spec);
  };
}

/** History adapter for the undo coordinator (delegates to the controller, mounted or not). */
class SourceHistoryAdapter implements ViewHistoryAdapter {
  constructor(private readonly owner: SourceEditorController) {}

  undo(): boolean {
    return this.owner.undoStep();
  }

  redo(): boolean {
    return this.owner.redoStep();
  }

  get canUndo(): boolean {
    return this.owner.canUndo;
  }

  get canRedo(): boolean {
    return this.owner.canRedo;
  }
}

export class SourceEditorController {
  private readonly store: AppStore;
  private readonly undo: UndoCoordinator;
  private translate: Translate;
  private settings: SourceEditorSettings;
  /** Dark interface theme in effect (CodeMirror dark flag + dark highlight style). */
  private dark: boolean;

  /** The canonical state: `view.state` while mounted, kept here while unmounted. */
  private headless: EditorState;
  private view: EditorView | null = null;
  private container: HTMLElement | null = null;
  private readonly extensions: Extension[];
  private readonly compartments = {
    wrap: new Compartment(),
    gutter: new Compartment(),
    highlight: new Compartment(),
    eol: new Compartment(),
    whitespace: new Compartment(),
    matchTags: new Compartment(),
    completion: new Compartment(),
    overtype: new Compartment(),
    theme: new Compartment(),
    nbsp: new Compartment(),
    lock: new Compartment(),
  };
  private loadToken = 0;
  private revealPending = false;
  /** Navigation requested before the text was loaded: applied once the text is there. */
  private pendingTarget: { line: number; column?: number; highlight: boolean } | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: SourceEditorSnapshot = { status: 'idle', loadError: null };
  private readonly listeners = new Set<() => void>();

  /** The table state's listeners (`subscribeContext`) and the verdict last announced to them. */
  private readonly contextListeners = new Set<() => void>();
  private contextTimer: ReturnType<typeof setTimeout> | null = null;
  private contextKey: string | null = null;
  /** `tablePoint()` for its key: the text, the selection's end, the tree, the error, the status. */
  private verdictMemo: {
    doc: Text;
    at: number;
    complete: boolean;
    parseError: DocParseErrorData | null;
    status: SourceLoadStatus;
    verdict: SourceVerdict;
  } | null = null;
  /** The idle parse task: the delay before it starts, the idle callback between its slices. */
  private parseTimer: ReturnType<typeof setTimeout> | null = null;
  private parseIdle: number | null = null;

  /** Find/Replace over the editor text for the search feature (US2). */
  readonly searchTarget: SourceSearchTarget;

  constructor(options: SourceEditorOptions) {
    this.store = options.store;
    this.undo = options.undo;
    this.translate = options.translate ?? ((key) => key);
    this.settings = options.settings ?? DEFAULT_SOURCE_SETTINGS;
    this.dark = options.dark ?? false;
    const c = this.compartments;
    this.extensions = [
      c.theme.of(sourceThemeExtension(this.dark)),
      c.gutter.of(lineNumbersExtension(this.settings.lineNumbers)),
      c.wrap.of(wrapExtension(this.settings.wrap)),
      c.highlight.of(highlightExtension(this.settings.highlight, this.dark)),
      c.eol.of(eolMarksExtension(this.settings.showEol)),
      c.whitespace.of(whitespaceExtension(this.settings.showWhitespace)),
      c.matchTags.of(matchedTagsExtension(this.settings.matchTags)),
      c.overtype.of(this.isOvertype() ? overtypeAttributes : []),
      c.nbsp.of(nbspSourceExtension(this.settings.nbspMarker)),
      c.lock.of(lockExtension(this.isLocked())),
      sourceLanguage(),
      history(),
      foldGutter(),
      drawSelection(),
      highlightSpecialChars(),
      highlightActiveLine(),
      bracketMatching(),
      highlightSelectionMatches(),
      highlightedLineField,
      binaryPlaceholdersExtension((size) =>
        this.translate('source.binaryPlaceholder', { count: size }),
      ),
      overtypeExtension(() => this.isOvertype()),
      rightClickKeepsSelection,
      // Before the editor keymaps: Enter, Tab and Escape go to an open completion list first.
      c.completion.of(sourceCompletionExtension(this.settings.tagCompletion)),
      keymap.of([
        {
          key: 'Insert',
          run: () => {
            actions.toggleInsertMode(this.store);
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.afterChange(update.startState, update.state);
          this.scheduleParse(PARSE_DELAY_MS);
        }
        if (
          update.docChanged ||
          update.selectionSet ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.scheduleContextCheck();
        }
      }),
      EditorView.contentAttributes.of({ 'data-testid': 'source-editor', spellcheck: 'false' }),
    ];
    this.headless = EditorState.create({ doc: '', extensions: this.extensions });
    this.searchTarget = createSourceSearchTarget(() => this.target);
    // `edit.completeTag` opens the list of the mounted editor (nothing while unmounted).
    registerCompletionEditor(this.store, () => this.view);
    this.store.subscribe((state, previous) => {
      if (state.insertMode !== previous.insertMode) this.applyOvertype();
      // The quiet lock of a run applies mounted or not (the kept state is what the next mount
      // shows).
      if (isRunLocked(state) !== isRunLocked(previous)) this.applyLock();
      // The core's parse error of this text decides the table verdict (`notWellFormed`).
      if (state.sourceParseError !== previous.sourceParseError) this.scheduleContextCheck();
    });
    onSourceSessionReset(this.store, () => this.reset());
    // The switch flow reads the selection on the way to the Body view (feature 004 US7).
    registerSourceSelectionReader(this.store, () => this.selectionOffsets());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SourceEditorSnapshot => this.snapshot;

  get editorView(): EditorView | null {
    return this.view;
  }

  /** The current editor state (mounted or headless). */
  get state(): EditorState {
    return this.view ? this.view.state : this.headless;
  }

  /** Dispatch target that works mounted and headless. */
  get target(): EditorTarget {
    return this.view ?? this.headlessTarget;
  }

  private readonly headlessTarget: EditorTarget = new HeadlessTarget(this);

  private publish(patch: Partial<SourceEditorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
    // The load status is part of the table verdict (`loading`, `failed`).
    this.scheduleContextCheck();
  }

  setTranslate(translate: Translate): void {
    this.translate = translate;
  }

  /* ------------------------------------------------------------- mounting */

  mount(container: HTMLElement): void {
    if (this.container === container && this.view) return;
    this.unmount();
    this.container = container;
    this.view = new EditorView({ state: this.headless, parent: container });
    if (this.revealPending) this.revealSelection();
  }

  unmount(): void {
    this.cancelParse();
    if (this.view) {
      this.headless = this.view.state;
      this.view.destroy();
      this.view = null;
    }
    this.container = null;
    this.loadToken += 1; // cancels a pending load
    // The next mount loads again: until then the view is not ready (a navigation request made
    // meanwhile waits for the load, and the status attribute never reports a stale "ready").
    if (this.snapshot.status === 'ready') this.publish({ status: 'idle' });
  }

  /** Unmounts and forgets the listeners; the controller is not usable afterwards. */
  destroy(): void {
    this.unmount();
    this.listeners.clear();
    this.contextListeners.clear();
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = null;
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
  }

  /** Drops the text and the history (document closed/replaced). */
  reset(): void {
    this.replaceText('');
    this.pendingTarget = null;
    this.publish({ status: 'idle', loadError: null });
  }

  /* -------------------------------------------------------------- loading */

  /** Loads the text of the current document (toXml, pending edits or Source-only raw text). */
  async load(ctx: CommandContext): Promise<void> {
    const token = ++this.loadToken;
    this.publish({ status: 'loading', loadError: null });
    try {
      const text = await loadSourceText(ctx);
      if (token !== this.loadToken) return;
      // A different text means a fresh state: loading is not an undoable edit and does not
      // mark the text dirty. The same text keeps the state - and the Source history - alive.
      if (text !== this.state.doc.toString()) this.replaceText(text);
      this.applySettings();
      const session = sourceSession(this.store);
      const parseError = this.store.getState().sourceParseError;
      const pending = session.pendingCaret ?? parseError;
      // Feature 004 US7: the Body selection of a direct switch, mapped against the text just
      // loaded; an explicit navigation target or a parse error position wins over it.
      const mapped = await mapBodySelectionToSource(ctx, {
        skip: this.pendingTarget !== null || pending !== null,
      });
      if (token !== this.loadToken) return;
      const target = this.pendingTarget;
      this.pendingTarget = null;
      this.publish({ status: 'ready' });
      // The table rule needs the whole text parsed: the idle task completes the tree.
      this.scheduleParse(0);
      if (target) {
        this.goTo(target.line, target.column, { highlight: target.highlight });
      } else if (pending) {
        this.goTo(pending.line, pending.column || undefined, { highlight: parseError !== null });
        session.pendingCaret = null;
      } else if (mapped) {
        this.setSelection(mapped.anchor, mapped.head);
      } else {
        this.revealSelection();
      }
      this.view?.focus();
    } catch (error) {
      if (token !== this.loadToken) return;
      this.publish({
        status: 'failed',
        loadError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private replaceText(text: string): void {
    const hadHistory = undoDepth(this.state) > 0 || redoDepth(this.state) > 0;
    let fresh = EditorState.create({ doc: text, extensions: this.extensions });
    if (this.isLocked()) {
      // The construction-time extensions carry the lock of that moment; a script running now
      // locks the fresh state too (also after `reset()`, which applies no other setting).
      fresh = fresh.update({
        effects: this.compartments.lock.reconfigure(lockExtension(true)),
      }).state;
    }
    if (this.view) this.view.setState(fresh);
    else this.headless = fresh;
    // The old history no longer applies to this text.
    if (hadHistory) this.undo.clearView('source');
  }

  /* ------------------------------------------------------------- settings */

  setSettings(settings: SourceEditorSettings): void {
    if (sameSourceSettings(this.settings, settings)) return;
    this.settings = settings;
    this.applySettings();
  }

  get currentSettings(): SourceEditorSettings {
    return this.settings;
  }

  /** Parsed font of the current settings (`null` fields mean "default"). */
  get font(): SourceFont {
    return parseSourceFont(this.settings.font);
  }

  /** Switches between the light and the dark CodeMirror theme (interface theme). */
  setDark(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    this.target.dispatch({
      effects: [
        this.compartments.theme.reconfigure(sourceThemeExtension(dark)),
        this.compartments.highlight.reconfigure(highlightExtension(this.settings.highlight, dark)),
      ],
    });
  }

  get isDark(): boolean {
    return this.dark;
  }

  /** Re-applies every compartment (also after `replaceText`, whose fresh state has defaults). */
  private applySettings(): void {
    const c = this.compartments;
    const s = this.settings;
    this.target.dispatch({
      effects: [
        c.theme.reconfigure(sourceThemeExtension(this.dark)),
        c.wrap.reconfigure(wrapExtension(s.wrap)),
        c.gutter.reconfigure(lineNumbersExtension(s.lineNumbers)),
        c.highlight.reconfigure(highlightExtension(s.highlight, this.dark)),
        c.eol.reconfigure(eolMarksExtension(s.showEol)),
        c.whitespace.reconfigure(whitespaceExtension(s.showWhitespace)),
        c.matchTags.reconfigure(matchedTagsExtension(s.matchTags)),
        c.completion.reconfigure(sourceCompletionExtension(s.tagCompletion)),
        c.overtype.reconfigure(this.isOvertype() ? overtypeAttributes : []),
        c.nbsp.reconfigure(nbspSourceExtension(s.nbspMarker)),
        c.lock.reconfigure(lockExtension(this.isLocked())),
      ],
    });
  }

  private isOvertype(): boolean {
    return this.store.getState().insertMode === 'overwrite';
  }

  private applyOvertype(): void {
    this.target.dispatch({
      effects: this.compartments.overtype.reconfigure(this.isOvertype() ? overtypeAttributes : []),
    });
  }

  /* ----------------------------------------------------------------- lock */

  /** A script run or an AI request holds the document: the quiet lock is on (feature 003 FR-011). */
  private isLocked(): boolean {
    return isRunLocked(this.store.getState());
  }

  private applyLock(): void {
    this.target.dispatch({
      effects: this.compartments.lock.reconfigure(lockExtension(this.isLocked())),
    });
  }

  /** True while the editor refuses the user's changes (`state.readOnly`). */
  get locked(): boolean {
    return this.state.readOnly;
  }

  /* ---------------------------------------------------------- transactions */

  /** Applies a transaction to the kept state (used while unmounted; not for callers). */
  dispatchHeadless(spec: TransactionSpec): void {
    if (this.view) {
      this.view.dispatch(spec);
      return;
    }
    const transaction: Transaction = this.headless.update(spec);
    this.headless = transaction.state;
    if (transaction.docChanged) this.afterChange(transaction.startState, transaction.state);
    if (
      transaction.docChanged ||
      !transaction.startState.selection.eq(transaction.state.selection)
    ) {
      this.scheduleContextCheck();
    }
  }

  private afterChange(startState: EditorState, state: EditorState): void {
    updateSourceText(this.store, state.doc.toString());
    if (undoDepth(state) > undoDepth(startState)) {
      this.undo.record('source', this.translate('views.source.undoLabel'));
    }
    // The user is editing: the old error position is stale.
    if (this.store.getState().sourceParseError) actions.setSourceParseError(this.store, null);
  }

  /**
   * Replaces the whole text as one change kept out of the editor's history and selects
   * `selection` (offsets into the new text; the start of the text by default) - the AI
   * assistant's commit in the Source view and the undo / redo of its one snapshot step (feature
   * 005 US5): the step is the undo coordinator's snapshot entry, not a Source history event,
   * and the editor's own earlier events are mapped through the change. The caller has set the
   * Source session's baseline to `text` when the text is to count as clean. Works mounted and
   * headless; the lock is bypassed (the editor's `readOnly` applies to the user's input).
   */
  replaceWholeText(text: string, selection?: { anchor: number; head: number }): void {
    const length = this.state.doc.length;
    const clamp = (offset: number) => Math.min(Math.max(Math.floor(offset) || 0, 0), text.length);
    const range = selection
      ? EditorSelection.single(clamp(selection.anchor), clamp(selection.head))
      : EditorSelection.single(0);
    this.target.dispatch({
      changes: { from: 0, to: length, insert: text },
      selection: range,
      annotations: Transaction.addToHistory.of(false),
      filter: false,
    });
    this.revealSelection();
  }

  /* ------------------------------------------------- Add → Table (feature 006) */

  /** What the table rule reads besides the state: the load status and the core's parse error. */
  private tableContext(): { status: SourceLoadStatus; parseError: DocParseErrorData | null } {
    return { status: this.snapshot.status, parseError: this.store.getState().sourceParseError };
  }

  /**
   * The table rule's verdict at the end of the main selection (`tablePoint.ts`; I23), memoised
   * on the text, the selection's end, the tree's completeness, the core's parse error and the
   * load status - `insert.table`'s `enabled` and its reason read it on every render. `loading`
   * while the view is unmounted (the status is then `idle`).
   */
  tablePoint(): SourceVerdict {
    const state = this.state;
    const at = state.selection.main.to;
    const complete = syntaxTreeAvailable(state, state.doc.length);
    const { status, parseError } = this.tableContext();
    const memo = this.verdictMemo;
    if (
      memo &&
      memo.doc === state.doc &&
      memo.at === at &&
      memo.complete === complete &&
      memo.parseError === parseError &&
      memo.status === status
    ) {
      return memo.verdict;
    }
    const verdict = sourceTablePoint(state, { status, parseError }, at);
    this.verdictMemo = { doc: state.doc, at, complete, parseError, status, verdict };
    return verdict;
  }

  /**
   * The verdict at the point under the pointer (the nearest position), for the context menu's
   * *Table…* (C28): with `moveTo` that offset, where the cursor goes when the entry runs; for a
   * click inside a non-empty main selection the verdict at the selection's end and `moveTo`
   * null - the selection stays (the spec's edge case). Opening the menu moves nothing.
   * `loading` while unmounted.
   */
  pointAt(coords: { x: number; y: number }): SourcePointAt {
    const view = this.view;
    if (!view) return { verdict: { code: 'loading' }, moveTo: null };
    const pos = view.posAtCoords(coords, false);
    const main = view.state.selection.main;
    if (!main.empty && pos >= main.from && pos <= main.to) {
      return { verdict: this.tablePoint(), moveTo: null };
    }
    return { verdict: sourceTablePoint(view.state, this.tableContext(), pos), moveTo: pos };
  }

  /**
   * Tells `listener` when the table verdict changes - its code, its line or its element - 100 ms
   * after the last selection, text or tree change (and after a change of the load status or of
   * the core's parse error): `services.subscribeAll` attaches it, so the menus and the toolbar
   * follow the verdict, and typing that keeps the verdict notifies nothing.
   */
  readonly subscribeContext = (listener: () => void): (() => void) => {
    if (this.contextListeners.size === 0) this.contextKey = sourceVerdictKey(this.tablePoint());
    this.contextListeners.add(listener);
    return () => {
      this.contextListeners.delete(listener);
      if (this.contextListeners.size === 0 && this.contextTimer) {
        clearTimeout(this.contextTimer);
        this.contextTimer = null;
      }
    };
  };

  private scheduleContextCheck(): void {
    if (this.contextListeners.size === 0) return;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = setTimeout(() => {
      this.contextTimer = null;
      const key = sourceVerdictKey(this.tablePoint());
      if (key === this.contextKey) return;
      this.contextKey = key;
      for (const listener of [...this.contextListeners]) listener();
    }, CONTEXT_DELAY_MS);
  }

  /**
   * The idle parse task: while the view is mounted, `delay` ms from now (0 after a load, 150 after
   * a change), slices of at most 25 ms of `ensureSyntaxTree` on idle time until the tree reaches
   * the end of the text; the view's own parser stops 100,000 characters past the viewport.
   */
  private scheduleParse(delay: number): void {
    this.cancelParse();
    if (!this.view) return;
    this.parseTimer = setTimeout(() => {
      this.parseTimer = null;
      this.requestParseSlice();
    }, delay);
  }

  private requestParseSlice(): void {
    if (!this.view) return;
    if (typeof requestIdleCallback === 'function') {
      this.parseIdle = requestIdleCallback(
        () => {
          this.parseIdle = null;
          this.parseSlice();
        },
        { timeout: 500 },
      );
    } else {
      this.parseTimer = setTimeout(() => {
        this.parseTimer = null;
        this.parseSlice();
      }, 0);
    }
  }

  private parseSlice(): void {
    const view = this.view;
    if (!view) return;
    const state = view.state;
    const complete =
      syntaxTreeAvailable(state, state.doc.length) ||
      ensureSyntaxTree(state, state.doc.length, PARSE_SLICE_MS) !== null;
    if (!complete) {
      this.requestParseSlice();
      return;
    }
    // The view's language state takes the complete tree (highlighting, folding, the matched
    // tags); the transaction tells the context listeners (a tree change).
    if (ensureSyntaxTree(state, state.doc.length, 0) !== syntaxTree(state)) view.dispatch({});
    this.scheduleContextCheck();
  }

  private cancelParse(): void {
    if (this.parseTimer) clearTimeout(this.parseTimer);
    this.parseTimer = null;
    if (this.parseIdle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.parseIdle);
    }
    this.parseIdle = null;
  }

  /**
   * Inserts FR-003's table at an allowed point (FR-061 "What" and "Undo"; data-model §7.3 "One
   * undo step"): false while the editor is locked or the verdict is not `ok`; otherwise one
   * transaction - the XML laid out like its neighbours (`tableInsert.ts`), the cursor between
   * the first cell's tags, `input.table`, isolated in the history on both sides so that typing
   * in the first cell is a step of its own - after which the editor has the focus. `afterChange`
   * records the one undo-coordinator entry ("Source edit") and clears the core's parse error.
   * A selection-only transaction follows, which the history keeps as the cursor after the
   * insertion: Redo gives that cursor back (FR-045; quickstart §1, 10.), where it would
   * otherwise map the cursor from before the insertion through it, to the end of the table.
   */
  insertTable(spec: SourceTableSpec): boolean {
    if (this.locked) return false;
    const point = this.tablePoint();
    if (point.code !== 'ok') return false;
    const plan = planSourceTableInsertion(this.state, point, spec);
    this.target.dispatch({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      selection: { anchor: plan.cursor },
      userEvent: 'input.table',
      annotations: isolateHistory.of('full'),
      scrollIntoView: true,
    });
    this.target.dispatch({ selection: { anchor: plan.cursor } });
    this.view?.focus();
    return true;
  }

  /* ----------------------------------------------------------- navigation */

  /**
   * Moves the cursor to a 1-based line/column, scrolls it into view (when mounted, otherwise on
   * the next mount) and optionally highlights the line for a moment. Without a column (schema
   * errors only carry a line) the cursor lands on the first non-blank character of the line.
   */
  goTo(line: number, column?: number, options: { highlight?: boolean } = {}): boolean {
    // Before the text is loaded (or while a load is in flight) the target would be lost with
    // the state the load replaces: remember it for the end of the load.
    if (this.snapshot.status !== 'ready') {
      this.pendingTarget = { line, column, highlight: options.highlight ?? false };
    }
    const pos = offsetForLineColumn(
      this.state,
      line,
      column ?? firstNonBlankColumn(this.state, line),
    );
    this.target.dispatch({ selection: { anchor: pos } });
    this.revealSelection();
    if (options.highlight) this.highlightLine(this.state.doc.lineAt(pos).number);
    return true;
  }

  /** Moves the cursor to a document offset. */
  goToOffset(pos: number, options: { highlight?: boolean } = {}): boolean {
    const { line, column } = lineColumnAt(this.state, pos);
    return this.goTo(line, column, options);
  }

  private revealSelection(): void {
    const view = this.view;
    if (!view) {
      this.revealPending = true;
      return;
    }
    this.revealPending = false;
    const head = view.state.selection.main.head;
    view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
    view.focus();
  }

  /** Highlights a line for a moment (navigation target); editing or moving the cursor ends it. */
  highlightLine(line: number): void {
    this.target.dispatch({ effects: highlightLineEffect.of(line) });
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      this.highlightTimer = null;
      this.target.dispatch({ effects: highlightLineEffect.of(null) });
    }, HIGHLIGHT_MS);
  }

  /** "Go to matching tag": the paired opening/closing tag of the tag under the cursor. */
  gotoMatchingTag(): boolean {
    const pos = matchingTagPosition(this.state, this.state.selection.main.head);
    if (pos === null) return false;
    return this.goToOffset(pos);
  }

  /** Next XML syntax problem after the cursor (wrapping), from the editor's own parser. */
  gotoNextSyntaxError(): boolean {
    const pos = nextSyntaxError(this.state, this.state.selection.main.head);
    if (pos === null) return false;
    return this.goToOffset(pos, { highlight: true });
  }

  /** FBE "Collapse N tree levels": folds the elements of nesting level `level` (1 = root). */
  collapseLevel(level: number): number {
    return collapseLevel(this.target, level);
  }

  /** FBE "Expand N tree levels": unfolds the elements of nesting level `level`. */
  expandLevel(level: number): number {
    return expandLevel(this.target, level);
  }

  /** The main selection as UTF-16 offsets into the text (feature 004 US7, `doc.mapPositions`). */
  selectionOffsets(): SourceOffsets {
    const { anchor, head } = this.state.selection.main;
    return { anchor, head };
  }

  /**
   * Selects from `anchor` to `head` (offsets into the text, clamped; the mapped Body selection)
   * and brings the head into view - on the next mount while unmounted. False when there is no
   * text.
   */
  setSelection(anchor: number, head: number): boolean {
    const length = this.state.doc.length;
    if (length === 0) return false;
    const clamp = (offset: number) => Math.min(Math.max(Math.floor(offset) || 0, 0), length);
    const selection = EditorSelection.single(clamp(anchor), clamp(head));
    this.target.dispatch({ selection });
    this.revealSelection();
    return true;
  }

  getCaret(): Caret | null {
    return caretOfState(this.state);
  }

  setCaret(caret: Caret): boolean {
    if (caret.line === undefined) return false;
    return this.goTo(caret.line, caret.column ?? 1);
  }

  /** Caret provider for the caret registry (works while the view is unmounted). */
  readonly caretProvider: CaretProvider = {
    get: () => this.getCaret(),
    set: (caret) => this.setCaret(caret),
  };

  /* ----------------------------------------------------------------- undo */

  undoStep(): boolean {
    return undo(this.target);
  }

  redoStep(): boolean {
    return redo(this.target);
  }

  get canUndo(): boolean {
    return undoDepth(this.state) > 0;
  }

  get canRedo(): boolean {
    return redoDepth(this.state) > 0;
  }

  /** History adapter for the undo coordinator (works while the view is unmounted). */
  readonly undoAdapter: ViewHistoryAdapter = new SourceHistoryAdapter(this);

  /** Current editor text (tests). */
  get text(): string {
    return this.state.doc.toString();
  }
}

/* ------------------------------------------------------------------------ */
/* Per-store controllers                                                    */
/* ------------------------------------------------------------------------ */

const controllers = new WeakMap<AppStore, SourceEditorController>();

/** The Source editor controller of `store`, created on first use (registrar and view share it). */
export function sourceEditorFor(
  store: AppStore,
  undo: UndoCoordinator,
  options: Omit<SourceEditorOptions, 'store' | 'undo'> = {},
): SourceEditorController {
  let controller = controllers.get(store);
  if (!controller) {
    controller = new SourceEditorController({ store, undo, ...options });
    controllers.set(store, controller);
  }
  return controller;
}

/** The Source editor controller of `store`, or null when none was created yet. */
export function getSourceEditor(store: AppStore): SourceEditorController | null {
  return controllers.get(store) ?? null;
}
