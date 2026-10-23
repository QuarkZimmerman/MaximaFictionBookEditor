/**
 * Application state: the current Document JSON plus the editing-session view state of
 * data-model.md §2.1. A tiny external store (no dependency) consumed by React through
 * `useSyncExternalStore`; non-React code (commands, RPC handlers) uses `getState()/setState()`.
 */

import { useSyncExternalStore } from 'react';

import type { Description, Document, ValidationReport } from './document';
import type { ConnectionStatus as RpcConnectionStatus } from '@/rpc/client';
import type {
  DocParseErrorData,
  JobProgress,
  Settings,
  ToolbarVisibility,
  UiLanguage,
  ViewId,
} from '@/rpc/types';

export type { ViewId } from '@/rpc/types';
export type ConnectionStatus = RpcConnectionStatus;
export type InsertMode = 'insert' | 'overwrite';
export type FileKind = Document['fileKind'];

/** Who holds the run lock: a script run or an AI assistant request (feature 005). */
export type RunKind = 'script' | 'ai';

/**
 * The run lock (feature 005 data-model §4.1, the generalisation of the `scriptRunning` flag of
 * feature 003 FR-011): while a script runs or an AI request is in progress the user cannot
 * change the document - the Body editor is locked, the Source editor read-only, the description
 * form read-only, the commands follow their `duringScriptRun` policy and the view cannot be
 * switched. The run banner shows the holder: its `label` (the script's name, or
 * `<service name> · <model>` for the assistant), the time since `startedAt` and, when set, the
 * current operation (`phase`).
 */
export interface RunLock {
  kind: RunKind;
  label: string;
  /** `Date.now()` at the start of the run. */
  startedAt: number;
  /** The current operation, shown by the banner (an AI request's state; scripts leave it unset). */
  phase?: string;
}

/** A message of the assistant's conversation (feature 005 data-model §5.1). */
export interface AssistantMessage {
  id: string;
  /** `Date.now()` when the message was added. */
  at: number;
  requestId: string;
  /** `notice` is editor-generated, localised text (a failure, "request cancelled"...). */
  role: 'user' | 'assistant' | 'notice';
  text: string;
  /** Assistant words beside tool calls - shown, never the final answer. */
  interim?: true;
  /** `finish_reason: length` without tool calls - shown as cut off, never applied. */
  cutOff?: true;
  /** Appended to the final text when the turn is resent as history (ai-catalogue §5.2). */
  appliedLine?: string;
  /** `assistant` after `committed`: the summary beside the Undo button. */
  undoLabel?: string;
}

/** One line of the activity list (feature 005 data-model §5.2; the kinds of ai-catalogue §6.16). */
export interface AssistantActivityEntry {
  at: number;
  requestId: string;
  elapsedMs: number;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * The assistant's conversation (feature 005 data-model §5.1): in memory only, empty while the
 * assistant is off, cleared by Clear, turn-off, a document change and exit (FR-045).
 */
export interface AssistantConversation {
  /** The document it belongs to; a different `docId` clears it. Null while empty. */
  docId: string | null;
  messages: AssistantMessage[];
  activity: AssistantActivityEntry[];
  /** How many oldest turns the last exchange left out (FR-025). */
  droppedTurns: number;
}

/**
 * The request the panel and the popup show (feature 005 data-model §4): the stories that run
 * requests (US2, US3) own its full shape; the store holds what they publish, null while none
 * runs.
 */
export interface AssistantRequestView {
  /** `r<N>` per page session. */
  id: string;
  origin: 'popup' | 'panel';
  /** The state of data-model §4.3. */
  state: string;
  /** `Date.now()` at the start. */
  startedAt: number;
  [detail: string]: unknown;
}

/**
 * The AI assistant's state (feature 005 data-model §3.1). `visible` is the panel's visibility
 * (FR-040 as amended 2026-10-23): it mirrors `session.aiPanelVisible` like `treeVisible`
 * mirrors `session.treeVisible` - adopted from the first settings snapshot (true at the first
 * start), flipped by the user's `ai.toggle` and the panel's close button, written back through
 * the debounced session save - and is independent of the mode: a visible panel is *live* while
 * `ai.mode` is a service and *inert* while it is `disabled` (FR-096). `on` is the live state -
 * `visible` and enabled, the chunk imported and the catalogue instance built - derived by the
 * feature (`ai/index.ts`) and never set by the user directly (`on ⇒ visible`); `width` mirrors
 * `session.aiPanelWidth` like `treeWidth` mirrors `session.treeWidth` (adopted from the first
 * snapshot, written back by the divider's drag end). Nothing else is persisted: `loaded`
 * records the one import of the lazy chunk; `catalogue`, the `request` and the `conversation`
 * exist only while `on`; `panelFocus` is set by the popup's "Continue in panel" and
 * `contextLengthHint` by Fetch models and overflow messages - in memory only, never a setting
 * (review C13); `customModels` is the last *Fetch models* answer of the settings page (US8,
 * data-model §2.4): the models the custom service listed, kept with the address they were
 * fetched from so that the active target takes `tools` and `contextLength` from it while the
 * chosen model is among them - transient as well, never a setting.
 */
export interface AssistantState {
  visible: boolean;
  on: boolean;
  width: number;
  loaded: boolean;
  /** The catalogue instance (§8.5), typed by the lazy chunk that builds and drops it. */
  catalogue: object | null;
  request: AssistantRequestView | null;
  conversation: AssistantConversation;
  panelFocus: boolean;
  contextLengthHint: number | null;
  customModels: CustomModelsMemory | null;
}

/** One model of a *Fetch models* answer (`ai.models`, rpc-api §3.12), as the core normalised it. */
export interface FetchedModel {
  id: string;
  contextLength?: number;
  tools?: boolean;
}

/** The last *Fetch models* answer and the custom address it came from (data-model §2.4, §2.6). */
export interface CustomModelsMemory {
  address: string;
  models: FetchedModel[];
}

export interface AppState {
  /** Core connection status (mirrors the RPC client). */
  connection: ConnectionStatus;
  /** Current document model, or null before New/Open. */
  document: Document | null;
  docId: string | null;
  /** Absolute path; null for a new, unsaved document. */
  path: string | null;
  fileKind: FileKind | null;
  /**
   * The description of a new document as its template and the editor's own filling-in made
   * it (feature 004 US4, FR-033): set when a template document is loaded (File > New, the
   * start-up document), cleared by a save and by Open. While the live description still
   * equals it by content, the description import applies silently
   * (`features/transfer/untouched.ts`).
   */
  newDocumentBaseline: Description | null;
  /** Any unsaved change in any view. */
  modified: boolean;
  /** Source text diverged from the model (Source view editing in progress). */
  sourceDirty: boolean;
  /** Malformed XML: the document is only available in the Source view (FR-021). */
  sourceOnly: boolean;
  /** Last parse error of the Source text (blocks leaving the Source view until fixed). */
  sourceParseError: DocParseErrorData | null;
  activeView: ViewId;
  /** Human-readable element path of the selection, e.g. "body[1]/section[3]/p[12]". */
  selectionPath: string;
  /** Node id of the selection anchor (tree sync). */
  selectionNodeId: string | null;
  insertMode: InsertMode;
  /** Explicit status-bar message; null shows the default ("Ready" / "Not connected"). */
  statusMessage: string | null;
  /** Progress of the running long operation, if any. */
  progress: JobProgress | null;
  /**
   * A script run or an AI request holds the document: the user cannot change it until the run
   * ends (`isRunLocked(state)` is the derived flag the consumers read).
   */
  runLock: RunLock | null;
  /** Result shown in the non-modal validation panel (null = panel hidden). */
  validation: ValidationReport | null;
  toolbars: ToolbarVisibility;
  treeVisible: boolean;
  /**
   * Width of the Document Tree pane in CSS px (`session.treeWidth`, feature 004 US1): the value
   * the user settled on, stored as is; the layout clamps what it applies (`app/splitter.ts`).
   */
  treeWidth: number;
  fastMode: boolean;
  settings: Settings | null;
  /** Toolbar layout changes sent to the core and not answered yet (app/toolbarLayouts.ts). */
  layoutSavesPending: number;
  uiLanguage: UiLanguage;
  /** The AI assistant (feature 005): the panel's visibility and width mirror two session keys. */
  ai: AssistantState;
}

export const DEFAULT_TOOLBARS: ToolbarVisibility = {
  commands: true,
  scripts: true,
  links: true,
  table: true,
  status: true,
};

/** The pane width of release 0.0.3 - the default of `session.treeWidth` (resource-formats §6). */
export const DEFAULT_TREE_WIDTH = 260;

/** The default of `session.aiPanelWidth` (feature 005 resource-formats §B; data-model §3.2). */
export const DEFAULT_AI_PANEL_WIDTH = 360;

/** The default of `session.aiPanelVisible` (feature 005 FR-040): the panel is open at the first start. */
export const DEFAULT_AI_PANEL_VISIBLE = true;

/** An empty conversation (feature 005 data-model §5.1): the state while the assistant is off. */
export function emptyConversation(): AssistantConversation {
  return { docId: null, messages: [], activity: [], droppedTurns: 0 };
}

/**
 * The assistant's state at start-up: not live, nothing loaded, the panel's visibility and
 * width at their defaults until the settings arrive (the first snapshot adopts the stored ones).
 */
export function createAssistantState(overrides: Partial<AssistantState> = {}): AssistantState {
  return {
    visible: DEFAULT_AI_PANEL_VISIBLE,
    on: false,
    width: DEFAULT_AI_PANEL_WIDTH,
    loaded: false,
    catalogue: null,
    request: null,
    conversation: emptyConversation(),
    panelFocus: false,
    contextLengthHint: null,
    customModels: null,
    ...overrides,
  };
}

export function createInitialState(overrides: Partial<AppState> = {}): AppState {
  return {
    connection: 'disconnected',
    document: null,
    docId: null,
    path: null,
    fileKind: null,
    newDocumentBaseline: null,
    modified: false,
    sourceDirty: false,
    sourceOnly: false,
    sourceParseError: null,
    activeView: 'body',
    selectionPath: '',
    selectionNodeId: null,
    insertMode: 'insert',
    statusMessage: null,
    progress: null,
    runLock: null,
    validation: null,
    toolbars: { ...DEFAULT_TOOLBARS },
    treeVisible: true,
    treeWidth: DEFAULT_TREE_WIDTH,
    fastMode: false,
    settings: null,
    layoutSavesPending: 0,
    uiLanguage: 'en',
    ai: createAssistantState(),
    ...overrides,
  };
}

export type StatePatch = Partial<AppState> | ((state: AppState) => Partial<AppState>);

export interface Store<S> {
  getState(): S;
  /** Shallow-merges the patch; listeners run only when at least one field changed. */
  setState(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: (state: S, previous: S) => void): () => void;
}

export type AppStore = Store<AppState>;

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(state: S, previous: S) => void>();
  return {
    getState: () => state,
    setState(patch) {
      const partial = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(partial) as (keyof S)[]) {
        if (!Object.is(partial[key], state[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const previous = state;
      state = { ...state, ...partial };
      for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createAppStore(overrides: Partial<AppState> = {}): AppStore {
  return createStore(createInitialState(overrides));
}

/** The application-wide store; tests create their own with `createAppStore()`. */
export const appStore: AppStore = createAppStore();

/**
 * React hook selecting a slice of the state. Selectors must return a stable value for
 * unchanged state (primitives or sub-objects of the immutable state), otherwise React
 * re-renders on every store change.
 */
export function useAppState<T>(selector: (state: AppState) => T, store: AppStore = appStore): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

/**
 * True while a script run or an AI request holds the document (the quiet lock of feature 003
 * FR-011 and feature 005 FR-022): the derived flag every consumer of the lock reads - command
 * enablement, the Body and Source locks, the description form, the bars, the view switch, the
 * exit confirmation and the version check's idle condition. Usable as a `useAppState` selector.
 */
export function isRunLocked(state: Pick<AppState, 'runLock'>): boolean {
  return state.runLock !== null;
}

/* ------------------------------------------------------------------------ */
/* Actions (plain functions so commands and RPC handlers can use them too)   */
/* ------------------------------------------------------------------------ */

export const actions = {
  setConnection(store: AppStore, connection: ConnectionStatus): void {
    store.setState({ connection });
  },

  /**
   * Replaces the current document (New/Open/Reload). The untouched baseline of a new document
   * is forgotten here; the file feature sets it again for a template document.
   */
  setDocument(store: AppStore, document: Document, options: { sourceOnly?: boolean } = {}): void {
    store.setState({
      document,
      docId: document.docId,
      path: document.path ?? null,
      fileKind: document.fileKind,
      newDocumentBaseline: null,
      modified: false,
      sourceDirty: false,
      sourceOnly: options.sourceOnly ?? false,
      sourceParseError: null,
      selectionPath: '',
      selectionNodeId: null,
      progress: null,
      validation: null,
      activeView: options.sourceOnly ? 'source' : store.getState().activeView,
    });
  },

  /** Applies an edited model (same docId) and marks the document modified. */
  updateDocument(store: AppStore, document: Document): void {
    store.setState({ document, modified: true });
  },

  closeDocument(store: AppStore): void {
    store.setState({
      document: null,
      docId: null,
      path: null,
      fileKind: null,
      newDocumentBaseline: null,
      modified: false,
      sourceDirty: false,
      sourceOnly: false,
      sourceParseError: null,
      selectionPath: '',
      selectionNodeId: null,
      progress: null,
      validation: null,
    });
  },

  /**
   * Applies the model parsed back from the Source text (same docId): the document is no longer
   * Source-only, the Source text is in sync again; `modified` is kept (the text may have been
   * edited) unless `modified` is given explicitly.
   */
  replaceDocumentFromSource(store: AppStore, document: Document, modified?: boolean): void {
    store.setState((s) => ({
      document,
      docId: document.docId,
      path: document.path ?? s.path,
      fileKind: document.fileKind,
      sourceDirty: false,
      sourceOnly: false,
      sourceParseError: null,
      modified: modified ?? s.modified,
    }));
  },

  setSourceDirty(store: AppStore, sourceDirty: boolean): void {
    store.setState((s) => ({ sourceDirty, modified: s.modified || sourceDirty }));
  },

  setSourceParseError(store: AppStore, sourceParseError: DocParseErrorData | null): void {
    store.setState({ sourceParseError });
  },

  setModified(store: AppStore, modified: boolean): void {
    store.setState({ modified });
  },

  /** After a successful save: new path/kind, clean state. */
  markSaved(store: AppStore, path: string, fileKind?: FileKind): void {
    const current = store.getState();
    const document =
      current.document && current.document.path !== path
        ? { ...current.document, path }
        : current.document;
    store.setState({
      path,
      fileKind: fileKind ?? current.fileKind ?? kindFromPath(path),
      newDocumentBaseline: null,
      modified: false,
      sourceDirty: false,
      document,
    });
  },

  /**
   * Remembers the description of a freshly loaded template document as the state the
   * description import compares with (feature 004 US4, FR-033); null forgets it.
   */
  setNewDocumentBaseline(store: AppStore, newDocumentBaseline: Description | null): void {
    store.setState({ newDocumentBaseline });
  },

  setActiveView(store: AppStore, activeView: ViewId): void {
    store.setState({ activeView });
  },

  setSelection(
    store: AppStore,
    selectionPath: string,
    selectionNodeId: string | null = null,
  ): void {
    store.setState({ selectionPath, selectionNodeId });
  },

  setInsertMode(store: AppStore, insertMode: InsertMode): void {
    store.setState({ insertMode });
  },

  toggleInsertMode(store: AppStore): void {
    store.setState((s) => ({ insertMode: s.insertMode === 'insert' ? 'overwrite' : 'insert' }));
  },

  setStatusMessage(store: AppStore, statusMessage: string | null): void {
    store.setState({ statusMessage });
  },

  setProgress(store: AppStore, progress: JobProgress | null): void {
    store.setState({ progress });
  },

  /** Takes (a lock) or releases (null) the run lock; a run's `phase` changes through a new lock object. */
  setRunLock(store: AppStore, runLock: RunLock | null): void {
    store.setState({ runLock });
  },

  /** Shows (report) or hides (null) the validation panel. */
  setValidation(store: AppStore, validation: ValidationReport | null): void {
    store.setState({ validation });
  },

  toggleToolbar(store: AppStore, name: keyof ToolbarVisibility): void {
    store.setState((s) => ({ toolbars: { ...s.toolbars, [name]: !s.toolbars[name] } }));
  },

  setToolbars(store: AppStore, toolbars: Partial<ToolbarVisibility>): void {
    store.setState((s) => ({ toolbars: { ...s.toolbars, ...toolbars } }));
  },

  setTreeVisible(store: AppStore, treeVisible: boolean): void {
    store.setState({ treeVisible });
  },

  toggleTree(store: AppStore): void {
    store.setState((s) => ({ treeVisible: !s.treeVisible }));
  },

  /** A divider drag ended: the pane width the user settled on (written back like `treeVisible`). */
  setTreeWidth(store: AppStore, treeWidth: number): void {
    store.setState({ treeWidth });
  },

  toggleFastMode(store: AppStore): void {
    store.setState((s) => ({ fastMode: !s.fastMode }));
  },

  /**
   * The AI panel's divider drag ended: the width the user settled on (feature 005 FR-040),
   * written back like `treeWidth` through the debounced session save.
   */
  setAiPanelWidth(store: AppStore, width: number): void {
    store.setState((s) => (s.ai.width === width ? {} : { ai: { ...s.ai, width } }));
  },

  /**
   * The user showed or hid the AI panel (feature 005 FR-040 as amended: View → AI Assistant,
   * the hotkey, the toolbar button, the close button), written back like `treeVisible`. The
   * live state (`on`) is the feature's to follow (`ai/index.ts` turns the assistant off before
   * it hides the panel and on after it shows one while the mode is a service).
   */
  setAiPanelVisible(store: AppStore, visible: boolean): void {
    store.setState((s) => (s.ai.visible === visible ? {} : { ai: { ...s.ai, visible } }));
  },

  /** Changes part of the assistant's state (feature 005 data-model §3); `width` and `visible` have their own actions. */
  updateAi(store: AppStore, patch: Partial<Omit<AssistantState, 'width' | 'visible'>>): void {
    store.setState((s) => ({ ai: { ...s.ai, ...patch } }));
  },

  /**
   * Applies settings received from the core (settings.get, settings.changed, the result of a
   * settings.set). The toolbar and tree flags and the tree pane width are taken from the first
   * snapshot only - the start-up read of the stored session: from then on they are the
   * window's own state, which the settings runtime writes back to `session.*` with a short
   * delay (features/settings/apply.ts). A later snapshot - the core reports the settings after
   * every settings.set, the UI's own ones included (the version check's record, Fast mode, the
   * dialog) - may still show the flags as they were before a change that is on its way, and
   * would undo it: the status bar hidden a moment ago came back and its hiding was never
   * saved. While a toolbar layout change is on its way to the core, the layouts shown stay for
   * the same reason: the settings reported for an earlier change would undo it until the core
   * reports the latest.
   */
  setSettings(store: AppStore, settings: Settings): void {
    const { layoutSavesPending, settings: current } = store.getState();
    if (layoutSavesPending > 0 && current) {
      settings = {
        ...settings,
        session: { ...settings.session, toolbarLayouts: current.session.toolbarLayouts },
      };
    }
    // A core without the key (before API minor 3) leaves the default width.
    const storedWidth = settings.session.treeWidth as number | undefined;
    // Likewise the AI panel's width and visibility (API minor 4, feature 005): from the first
    // snapshot only - a core without the visibility key leaves the panel open, the default of
    // FR-040; whether the visible panel is live follows the mode (the feature's), not a setting.
    const storedPanelWidth = settings.session.aiPanelWidth as number | undefined;
    const storedPanelVisible = settings.session.aiPanelVisible as boolean | undefined;
    store.setState((s) => ({
      settings,
      fastMode: settings.view.fastMode,
      ...(current
        ? {}
        : {
            toolbars: { ...settings.session.toolbars },
            treeVisible: settings.session.treeVisible,
            treeWidth: typeof storedWidth === 'number' ? storedWidth : DEFAULT_TREE_WIDTH,
            ai: {
              ...s.ai,
              width:
                typeof storedPanelWidth === 'number' ? storedPanelWidth : DEFAULT_AI_PANEL_WIDTH,
              visible:
                typeof storedPanelVisible === 'boolean'
                  ? storedPanelVisible
                  : DEFAULT_AI_PANEL_VISIBLE,
            },
          }),
    }));
  },

  /** Counts a toolbar layout change sent to the core (1) or answered (-1). */
  countLayoutSave(store: AppStore, step: 1 | -1): void {
    store.setState((s) => ({ layoutSavesPending: s.layoutSavesPending + step }));
  },

  setUiLanguage(store: AppStore, uiLanguage: UiLanguage): void {
    store.setState({ uiLanguage });
  },
};

export function kindFromPath(path: string): FileKind {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'fbd') return 'fbd';
  if (ext === 'xml') return 'xml';
  return 'fb2';
}

/** File name shown in the title bar and prompts ("Untitled" is localised by the caller). */
export function documentFileName(state: Pick<AppState, 'path'>): string | null {
  if (!state.path) return null;
  const parts = state.path.split(/[\\/]/);
  return parts[parts.length - 1] || state.path;
}
