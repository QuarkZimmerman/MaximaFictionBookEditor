/**
 * Typed surface of the core <-> UI JSON-RPC contract
 * (specs/001-maxima-fb2-editor/contracts/rpc-api.md, version 1).
 *
 * Every method of rpc-api.md §3 and §5 appears in `RpcMethods`; every notification of §4 in
 * `RpcNotifications`. Document types come from the shared model (`@/model/document`).
 * Change the contract first, then this file, then the C++ handler table.
 */

import type { BinaryMeta, Document, ValidationIssue, ValidationReport } from '@/model/document';

export type { BinaryMeta, Document, ValidationIssue, ValidationReport } from '@/model/document';

export const RPC_API_VERSION = 1;

/* ------------------------------------------------------------------------ */
/* Error codes (rpc-api.md §1)                                              */
/* ------------------------------------------------------------------------ */

export const RpcErrorCode = {
  // JSON-RPC 2.0 protocol errors
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  // Application errors
  docNotFound: 1000,
  docParseError: 1001,
  docIoError: 1002,
  docSourceMalformed: 1003,
  docNotFictionBook: 1004,
  binaryNotFound: 1010,
  spellDictionaryUnavailable: 1020,
  scriptNotFound: 1030,
  scriptInvalidManifest: 1031,
  settingsInvalid: 1040,
  dialogUnavailable: 1050,
  cancelled: 1090,
  // Client-side conditions raised by the RPC client itself (never sent by the core).
  clientTimeout: -32001,
  clientDisconnected: -32002,
  clientInvalidResponse: -32003,
} as const;

export type RpcErrorCodeValue = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];

/** Wire shape of a JSON-RPC error object. */
export interface RpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** `data` payloads documented for specific error codes. */
export interface DocParseErrorData {
  line: number;
  column: number;
  message: string;
}
export interface DocIoErrorData {
  path: string;
  reason: string;
}
export interface SpellDictionaryUnavailableData {
  lang: string;
}
export interface SettingsInvalidData {
  field: string;
}

/* ------------------------------------------------------------------------ */
/* Shared value types                                                       */
/* ------------------------------------------------------------------------ */

export type ViewId = 'description' | 'body' | 'source';
export type UiLanguage = 'en' | 'ru';
export type ThemeSetting = 'system' | 'light' | 'dark';
export type UiLanguageSetting = UiLanguage | 'system';

export type Platform = 'windows' | 'linux' | 'mac';

export interface Caret {
  view: ViewId;
  nodeId?: string;
  offset?: number;
  line?: number;
  column?: number;
}

export interface RecentFile {
  path: string;
  lastOpened: string; // ISO timestamp
  caret?: Caret;
  /** Present when the core has already noticed that the file is missing. */
  exists?: boolean;
}

export interface ResourceLayer {
  layer: 'settings' | 'user' | 'portable' | 'bundled';
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface AppInfo {
  version: string;
  build: string;
  platform: Platform;
  cefVersion?: string;
  uiLanguage: UiLanguage;
  /** Operating-system language reported by the core (`ru`, `en-US`, ...), when known. */
  systemLanguage?: string;
  dataDir: string;
  logDir: string;
  resourceLayers: ResourceLayer[];
  apiVersion: number;
}

export type ImageFormat = 'jpeg' | 'png';

/** settings.json, resource-formats.md §6. */
export interface Settings {
  schemaVersion: 1;
  view: {
    uiLanguage: UiLanguageSetting;
    /** Interface colours: follow the operating system, or force light/dark. */
    theme: ThemeSetting;
    bodyFont: string;
    bodyFontSize: number;
    bodyTextColor: string;
    bodyBackground: string;
    sourceFont: string;
    sourceWrap: boolean;
    sourceSyntaxHighlight: boolean;
    sourceShowEol: boolean;
    sourceShowWhitespace: boolean;
    sourceLineNumbers: boolean;
    sourceMatchTags: boolean;
    spellEnabled: boolean;
    spellHighlight: boolean;
    customDictionaryPath: string;
    fastMode: boolean;
  };
  other: {
    defaultEncoding: string;
    keepEncoding: boolean;
    restorePosition: boolean;
    scriptsFolder: string;
    genresFolder: string;
    askOnNonClearImage: boolean;
    insertClearImages: boolean;
    pasteImageFormat: ImageFormat;
    jpegQuality: number;
    nbspDisplayChar: string;
  };
  words: {
    showExclusionsInWordsDialog: boolean;
  };
  session: {
    windowGeometry: { x: number; y: number; width: number; height: number } | null;
    toolbars: ToolbarVisibility;
    treeVisible: boolean;
    findHistory: string[];
    replaceHistory: string[];
  };
}

export interface ToolbarVisibility {
  commands: boolean;
  scripts: boolean;
  links: boolean;
  table: boolean;
  status: boolean;
}

/** Recursive partial used by `settings.set({patch})`. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** data-model.md §3.1. `keys` is a platform-normalised chord (resource-formats.md §7). */
export interface HotkeyBinding {
  commandId: string;
  keys: string;
  source: 'default' | 'user';
}

export interface HotkeyCollision {
  keys: string;
  commandIds: string[];
}

export interface GenreEntry {
  code: string;
  category: string;
  names: Record<string, string>; // { en, ru, ... }
  source: string; // 'standard' | 'user:<file>' | 'bundled:<file>'
}

export interface LanguageEntry {
  code: string; // ISO 639-1
  names: Record<string, string>;
}

export interface SymbolEntry {
  codepoint: number;
  names: Record<string, string>;
  defaultHotkey?: string;
}

export interface SpellDictionary {
  lang: string;
  name: string;
  source: string;
}

/** script.json, script-manifest.md §2. */
export interface ScriptManifest {
  manifestVersion: 1;
  id: string;
  name: Record<string, string>;
  description?: Record<string, string>;
  kind: 'menu' | 'tree';
  entry?: string;
  icon?: string;
  defaultHotkey?: string;
  needsSelection?: boolean;
  undoLabel?: Record<string, string>;
  legacy?: { source: string; fbeVersion?: string };
}

export interface ScriptListEntry {
  manifest: ScriptManifest;
  folder: string;
  /** Group folder name without its `NN_` prefix; absent for ungrouped scripts. */
  group?: string;
  errors?: string[];
}

export interface FileFilter {
  name: string;
  extensions: string[]; // without the dot
}

export type MessageButtonSet =
  'ok' | 'okCancel' | 'yesNo' | 'yesNoCancel' | 'abortRetryIgnore' | 'close';

export type MessageButtonId =
  'ok' | 'cancel' | 'yes' | 'no' | 'abort' | 'retry' | 'ignore' | 'close';

/** Long operations may answer with a job handle instead of the result (rpc-api.md §1). */
export interface JobStart {
  jobId: string;
}
export type MaybeJob<T> = T | JobStart;

export function isJobStart(value: unknown): value is JobStart {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jobId' in value &&
    typeof (value as { jobId: unknown }).jobId === 'string'
  );
}

export interface JobProgress {
  jobId: string;
  phase: string;
  done: number;
  total: number;
}

export interface WordsEntry {
  word: string;
  count: number;
}

export interface SaveResult {
  path: string;
  encoding: string;
  converted: BinaryMeta[];
  validation: ValidationReport;
  needsConfirmation?: false;
}

export interface SaveNeedsConfirmation {
  needsConfirmation: true;
  validation: ValidationReport;
}

/* ------------------------------------------------------------------------ */
/* Methods (rpc-api.md §3 and §5)                                            */
/* ------------------------------------------------------------------------ */

type Empty = Record<string, never>;

export interface RpcMethods {
  // §3.1 app
  'app.info': { params: void; result: AppInfo };
  'app.quit': { params: { force?: boolean } | void; result: Empty };
  'app.openLogFolder': { params: void; result: Empty };
  'app.openFolder': { params: { path: string }; result: Empty };
  'app.setUiLanguage': {
    params: { lang: UiLanguageSetting };
    result: { restartRequired: boolean };
  };

  // §3.2 doc
  'doc.new': { params: void; result: Document };
  'doc.open': {
    params: { path: string };
    result: MaybeJob<{ document: Document; warnings: ValidationIssue[] }>;
  };
  'doc.openSource': {
    params: { path: string };
    result: { docId: string; text: string; encoding: string; error?: DocParseErrorData };
  };
  'doc.close': { params: { docId: string }; result: Empty };
  'doc.toXml': {
    params: { docId: string; document: Document; elideBinaries?: boolean };
    result: { text: string };
  };
  'doc.fromXml': { params: { docId: string; text: string }; result: { document: Document } };
  'doc.save': {
    params: {
      docId: string;
      document: Document;
      path?: string;
      encoding?: string;
      force?: boolean;
    };
    result: MaybeJob<SaveResult | SaveNeedsConfirmation>;
  };
  'doc.validate': {
    params: { docId: string; document?: Document; text?: string };
    result: MaybeJob<ValidationReport>;
  };
  'doc.recent': { params: void; result: RecentFile[] };
  'doc.clearRecent': { params: void; result: Empty };
  'doc.watch': { params: { docId: string; enabled: boolean }; result: Empty };
  'doc.caret': { params: { docId: string; caret?: Caret }; result: { caret?: Caret } };

  // §3.3 binary
  'binary.list': { params: { docId: string }; result: BinaryMeta[] };
  'binary.add': {
    params: { docId: string; path: string; suggestedId?: string; convertNow?: boolean };
    result: BinaryMeta;
  };
  'binary.addFromClipboard': { params: { docId: string }; result: BinaryMeta };
  'binary.remove': { params: { docId: string; id: string; force?: boolean }; result: Empty };
  'binary.convert': {
    params: { docId: string; id: string; format: ImageFormat; quality?: number };
    result: BinaryMeta;
  };
  'binary.export': { params: { docId: string; id: string; path: string }; result: Empty };

  // §3.4 spell
  'spell.dictionaries': { params: void; result: SpellDictionary[] };
  'spell.check': { params: { words: string[]; langs: string[] }; result: { misspelled: string[] } };
  'spell.suggest': { params: { word: string; langs: string[] }; result: { suggestions: string[] } };
  'spell.addWord': { params: { word: string }; result: Empty };
  'spell.removeWord': { params: { word: string }; result: Empty };
  'spell.customWords': { params: void; result: string[] };
  'spell.customDictionaryPath': { params: { path?: string } | void; result: { path: string } };

  // §3.5 words
  'words.analyze': {
    params: { docId: string; document: Document; includeExclusions?: boolean };
    result: { entries: WordsEntry[]; durationMs: number };
  };
  'words.exclusions': { params: { add?: string[]; remove?: string[] } | void; result: string[] };

  // §3.6 resources
  'resources.genres': { params: void; result: { entries: GenreEntry[]; userFiles: string[] } };
  'resources.languages': { params: void; result: LanguageEntry[] };
  'resources.symbols': { params: void; result: SymbolEntry[] };
  'resources.layers': { params: void; result: ResourceLayer[] };
  'resources.openGenresFolder': { params: void; result: Empty };

  // §3.7 settings / hotkeys
  'settings.get': { params: void; result: Settings };
  'settings.set': {
    params: { patch: DeepPartial<Settings> };
    result: { settings: Settings; restartRequired: boolean };
  };
  'hotkeys.defaults': { params: void; result: HotkeyBinding[] };
  'hotkeys.get': { params: void; result: HotkeyBinding[] };
  'hotkeys.set': {
    params: { bindings: HotkeyBinding[] };
    result: { collisions: HotkeyCollision[] };
  };

  // §3.8 scripts
  'scripts.list': { params: void; result: ScriptListEntry[] };
  'scripts.source': { params: { scriptId: string }; result: { entryUrl: string } };
  'scripts.reload': { params: void; result: Empty };
  'scripts.lastRun': { params: { scriptId?: string } | void; result: { scriptId?: string } };

  // §3.9 dialog (shell-delegated)
  'dialog.openFile': {
    params: { title: string; filters: FileFilter[]; multiple?: boolean };
    result: { paths: string[] };
  };
  'dialog.saveFile': {
    params: {
      title: string;
      filters: FileFilter[];
      defaultPath?: string;
      encodingChoices?: string[];
    };
    result: { path?: string; encoding?: string };
  };
  'dialog.pickFolder': { params: { title: string }; result: { path?: string } };
  'dialog.message': {
    params: { text: string; caption: string; buttons: MessageButtonSet };
    result: { button: MessageButtonId };
  };

  // §3.10 log
  'log.error': {
    params: {
      source: string;
      code: string;
      message: string;
      stack?: string;
      context?: Record<string, unknown>;
    };
    result: Empty;
  };

  // §5 development/test-only
  'test.enqueueDialog': { params: { method: string; result: unknown }; result: Empty };
  'test.corpusSample': { params: { count: number; seed: number }; result: { paths: string[] } };
  'test.metrics': {
    params: void;
    result: { memoryBytes: number; openDurations: number[] } & Record<string, unknown>;
  };
}

export type RpcMethodName = keyof RpcMethods;
export type RpcParams<M extends RpcMethodName> = RpcMethods[M]['params'];
export type RpcResult<M extends RpcMethodName> = RpcMethods[M]['result'];

/* ------------------------------------------------------------------------ */
/* Notifications (rpc-api.md §4)                                            */
/* ------------------------------------------------------------------------ */

export interface RpcNotifications {
  'doc.changedOnDisk': { docId: string; path: string; mtime: string };
  'job.progress': JobProgress;
  'job.done': { jobId: string; result?: unknown };
  'job.failed': { jobId: string; error: RpcErrorObject };
  'resources.changed': { what: 'genres' | 'scripts' | 'dictionaries' };
  'app.openPaths': { paths: string[] };
  'settings.changed': { settings: Settings };
}

export type RpcNotificationName = keyof RpcNotifications;
