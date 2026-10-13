/**
 * Imperative controller of the Source editor (T050/T079): owns the CodeMirror 6 state (XML
 * language, folding, bracket/tag matching, search keymap, history) and the loading state.
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
 * Settings (wrap, line numbers, syntax highlighting, EOL / white-space marks, matched tags, font)
 * are applied live through compartments, as is the interface theme (`setDark()`: CodeMirror's
 * dark flag and the dark highlight style of theme.ts); Insert toggles the store's `insertMode`
 * (INS/OVR).
 */

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  Compartment,
  EditorState,
  type Extension,
  type Transaction,
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
import type { CaretProvider } from '@/model/caret';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator, ViewHistoryAdapter } from '@/model/undo';
import type { Caret, Settings } from '@/rpc/types';

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
import { loadSourceText, onSourceSessionReset, sourceSession, updateSourceText } from './sync';
import { sourceThemeExtension } from './theme';

export { offsetForLineColumn } from './extensions';
export type { EditorTarget } from './extensions';
export type { SourceSearchOptions, SourceSearchTarget } from './searchTarget';

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
  /** Raw `view.sourceFont` setting ("Consolas, 12"); empty = defaults. */
  font: string;
}

export const DEFAULT_SOURCE_SETTINGS: SourceEditorSettings = {
  wrap: true,
  lineNumbers: true,
  highlight: true,
  showEol: false,
  showWhitespace: false,
  matchTags: true,
  font: '',
};

/** The Source editor settings of the application settings (defaults when unavailable). */
export function sourceSettingsOf(settings: Settings | null | undefined): SourceEditorSettings {
  const view = settings?.view;
  if (!view) return DEFAULT_SOURCE_SETTINGS;
  return {
    wrap: view.sourceWrap ?? DEFAULT_SOURCE_SETTINGS.wrap,
    lineNumbers: view.sourceLineNumbers ?? DEFAULT_SOURCE_SETTINGS.lineNumbers,
    highlight: view.sourceSyntaxHighlight ?? DEFAULT_SOURCE_SETTINGS.highlight,
    showEol: view.sourceShowEol ?? DEFAULT_SOURCE_SETTINGS.showEol,
    showWhitespace: view.sourceShowWhitespace ?? DEFAULT_SOURCE_SETTINGS.showWhitespace,
    matchTags: view.sourceMatchTags ?? DEFAULT_SOURCE_SETTINGS.matchTags,
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
    a.font === b.font
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
    overtype: new Compartment(),
    theme: new Compartment(),
  };
  private loadToken = 0;
  private revealPending = false;
  /** Navigation requested before the text was loaded: applied once the text is there. */
  private pendingTarget: { line: number; column?: number; highlight: boolean } | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: SourceEditorSnapshot = { status: 'idle', loadError: null };
  private readonly listeners = new Set<() => void>();

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
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.afterChange(update.startState, update.state);
      }),
      EditorView.contentAttributes.of({ 'data-testid': 'source-editor', spellcheck: 'false' }),
    ];
    this.headless = EditorState.create({ doc: '', extensions: this.extensions });
    this.searchTarget = createSourceSearchTarget(() => this.target);
    this.store.subscribe((state, previous) => {
      if (state.insertMode !== previous.insertMode) this.applyOvertype();
    });
    onSourceSessionReset(this.store, () => this.reset());
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
    if (this.view) {
      this.headless = this.view.state;
      this.view.destroy();
      this.view = null;
    }
    this.container = null;
    this.loadToken += 1; // cancels a pending load
  }

  /** Unmounts and forgets the listeners; the controller is not usable afterwards. */
  destroy(): void {
    this.unmount();
    this.listeners.clear();
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
      this.publish({ status: 'ready' });
      const session = sourceSession(this.store);
      const parseError = this.store.getState().sourceParseError;
      const target = this.pendingTarget;
      this.pendingTarget = null;
      const pending = session.pendingCaret ?? parseError;
      if (target) {
        this.goTo(target.line, target.column, { highlight: target.highlight });
      } else if (pending) {
        this.goTo(pending.line, pending.column || undefined, { highlight: parseError !== null });
        session.pendingCaret = null;
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
    const fresh = EditorState.create({ doc: text, extensions: this.extensions });
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
        c.overtype.reconfigure(this.isOvertype() ? overtypeAttributes : []),
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
  }

  private afterChange(startState: EditorState, state: EditorState): void {
    updateSourceText(this.store, state.doc.toString());
    if (undoDepth(state) > undoDepth(startState)) {
      this.undo.record('source', this.translate('views.source.undoLabel'));
    }
    // The user is editing: the old error position is stale.
    if (this.store.getState().sourceParseError) actions.setSourceParseError(this.store, null);
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
