/**
 * Application state: the current Document JSON plus the editing-session view state of
 * data-model.md §2.1. A tiny external store (no dependency) consumed by React through
 * `useSyncExternalStore`; non-React code (commands, RPC handlers) uses `getState()/setState()`.
 */

import { useSyncExternalStore } from 'react';

import type { Document, ValidationReport } from './document';
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

export interface AppState {
  /** Core connection status (mirrors the RPC client). */
  connection: ConnectionStatus;
  /** Current document model, or null before New/Open. */
  document: Document | null;
  docId: string | null;
  /** Absolute path; null for a new, unsaved document. */
  path: string | null;
  fileKind: FileKind | null;
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
  /** A script is running: the user cannot change the document until it ends. */
  scriptRunning: boolean;
  /** Result shown in the non-modal validation panel (null = panel hidden). */
  validation: ValidationReport | null;
  toolbars: ToolbarVisibility;
  treeVisible: boolean;
  fastMode: boolean;
  settings: Settings | null;
  /** Toolbar layout changes sent to the core and not answered yet (app/toolbarLayouts.ts). */
  layoutSavesPending: number;
  uiLanguage: UiLanguage;
}

export const DEFAULT_TOOLBARS: ToolbarVisibility = {
  commands: true,
  scripts: true,
  links: true,
  table: true,
  status: true,
};

export function createInitialState(overrides: Partial<AppState> = {}): AppState {
  return {
    connection: 'disconnected',
    document: null,
    docId: null,
    path: null,
    fileKind: null,
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
    scriptRunning: false,
    validation: null,
    toolbars: { ...DEFAULT_TOOLBARS },
    treeVisible: true,
    fastMode: false,
    settings: null,
    layoutSavesPending: 0,
    uiLanguage: 'en',
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

/* ------------------------------------------------------------------------ */
/* Actions (plain functions so commands and RPC handlers can use them too)   */
/* ------------------------------------------------------------------------ */

export const actions = {
  setConnection(store: AppStore, connection: ConnectionStatus): void {
    store.setState({ connection });
  },

  /** Replaces the current document (New/Open/Reload). */
  setDocument(store: AppStore, document: Document, options: { sourceOnly?: boolean } = {}): void {
    store.setState({
      document,
      docId: document.docId,
      path: document.path ?? null,
      fileKind: document.fileKind,
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
      modified: false,
      sourceDirty: false,
      document,
    });
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

  setScriptRunning(store: AppStore, scriptRunning: boolean): void {
    store.setState({ scriptRunning });
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

  toggleFastMode(store: AppStore): void {
    store.setState((s) => ({ fastMode: !s.fastMode }));
  },

  /**
   * Applies settings received from the core (settings.get / settings.changed). While a toolbar
   * layout change is on its way to the core, the layouts shown stay: the settings reported for
   * an earlier change would undo it until the core reports the latest.
   */
  setSettings(store: AppStore, settings: Settings): void {
    const { layoutSavesPending, settings: current } = store.getState();
    if (layoutSavesPending > 0 && current) {
      settings = {
        ...settings,
        session: { ...settings.session, toolbarLayouts: current.session.toolbarLayouts },
      };
    }
    store.setState({
      settings,
      toolbars: { ...settings.session.toolbars },
      treeVisible: settings.session.treeVisible,
      fastMode: settings.view.fastMode,
    });
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
