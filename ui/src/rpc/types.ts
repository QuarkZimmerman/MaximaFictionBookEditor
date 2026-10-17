/**
 * Typed surface of the core <-> UI JSON-RPC contract
 * (specs/001-maxima-fb2-editor/contracts/rpc-api.md, version 1, with the additive changes of
 * specs/002-tester-feedback-fixes/contracts/rpc-api.md, minor 1, and
 * specs/003-second-feedback-batch/contracts/rpc-api.md, minor 2).
 *
 * Every method of rpc-api.md §3 and §5 appears in `RpcMethods`; every notification of §4 in
 * `RpcNotifications`. Document types come from the shared model (`@/model/document`).
 * Change the contract first, then this file, then the C++ handler table.
 */

import type { BinaryMeta, Document, ValidationIssue, ValidationReport } from '@/model/document';

export type { BinaryMeta, Document, ValidationIssue, ValidationReport } from '@/model/document';

export const RPC_API_VERSION = 1;
/**
 * Additive contract revision within RPC_API_VERSION (`app.info().apiMinor`; absent = 0). The
 * revision this UI was written for; it accepts any core answering minor >= 1 (rpc-api.md §6).
 */
export const RPC_API_MINOR = 2;

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
  releaseUnavailable: 1060,
  /** `app.restart` without a shell (browser/dev mode): the UI reloads its page (feature 003). */
  restartUnavailable: 1070,
  /** `app.restart`: the shell could not start the new instance; `data.reason` (feature 003). */
  restartFailed: 1071,
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
/** `data` of 1060 `app.releaseUnavailable`: why the latest-release request failed. */
export interface ReleaseUnavailableData {
  reason: 'offline' | 'timeout' | 'http' | 'format';
}

/* ------------------------------------------------------------------------ */
/* Shared value types                                                       */
/* ------------------------------------------------------------------------ */

export type ViewId = 'description' | 'body' | 'source';
export type UiLanguage = 'en' | 'ru' | 'uk';
export type ThemeSetting = 'system' | 'light' | 'dark';
export type UiLanguageSetting = UiLanguage | 'system';
/** How often the editor checks for a new version at start-up (feature 003, data-model §5). */
export type VersionCheckSchedule = 'everyStart' | 'daily' | 'weekly' | 'monthly' | 'never';

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
  /** Additive contract revision (feature 002: 1, feature 003: 2); the UI accepts minor >= 1. */
  apiMinor: number;
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
    /** Source view: offer tag names after `<` and the closing tag after `</` (feature 003). */
    sourceTagCompletion: boolean;
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
    /** Settings > Other "Dictionaries folder": the settings layer of dictionaries ("" = default). */
    dictionariesFolder: string;
    /** Settings > Other "Template folder": where `blank.fb2` is looked up first ("" = default). */
    templateFolder: string;
    askOnNonClearImage: boolean;
    insertClearImages: boolean;
    pasteImageFormat: ImageFormat;
    jpegQuality: number;
    /** Marker shown for U+00A0: the plain space (no marker, default), □, ▫ or ◦. */
    nbspDisplayChar: string;
    /** Automatic check for a new version at start-up (feature 003, default `monthly`). */
    versionCheck: VersionCheckSchedule;
  };
  words: {
    showExclusionsInWordsDialog: boolean;
  };
  session: {
    /**
     * Window placement (feature 003: recorded by the shell at quit): the normal bounds plus
     * `maximized` when the window was maximised.
     */
    windowGeometry: {
      x: number;
      y: number;
      width: number;
      height: number;
      maximized?: boolean;
    } | null;
    toolbars: ToolbarVisibility;
    treeVisible: boolean;
    findHistory: string[];
    replaceHistory: string[];
    /** Customised toolbar layouts ("commands", "scripts"): button ids and "-"; absent = original. */
    toolbarLayouts: Partial<Record<string, string[]>>;
    /** Linux and macOS: the folder last used by Open or Save As ("" = none yet). */
    lastFileDialogFolder: string;
    /**
     * ISO 8601 UTC time of the last version check that got an answer (manual or automatic);
     * absent until one did, never written on failure (feature 003, data-model §5).
     */
    lastVersionCheck?: string;
  };
}

export interface ToolbarVisibility {
  commands: boolean;
  scripts: boolean;
  links: boolean;
  table: boolean;
  status: boolean;
}

/** Recursive partial used by `settings.set({patch})`; a patch replaces arrays whole. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** `settings.set` patch; a toolbar layout set to `null` restores the original layout. */
export type SettingsPatch = DeepPartial<Omit<Settings, 'session'>> & {
  session?: DeepPartial<Omit<Settings['session'], 'toolbarLayouts'>> & {
    toolbarLayouts?: Partial<Record<string, string[] | null>>;
  };
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

/**
 * `spell.dictionaries()` entry (rpc-api.md §3.4). `source` is the resource layer the pair was
 * found in: `bundled` (built in), `user` (per-user folder), `portable` (portable folder) or
 * `settings` (the folder chosen in Settings). The path fields are optional for older cores.
 */
export interface SpellDictionary {
  /** Dictionary tag = file stem of the `.aff`/`.dic` pair (`uk_UA`). */
  tag?: string;
  lang: string;
  name: string;
  source: string;
  /** `.aff` file. */
  path?: string;
  dicPath?: string;
  /** `<tag>.txt` notice next to the pair, when present (shown in About). */
  readmePath?: string;
}

/** `spell.dictionaryLicense` result: the `<tag>.txt` notice text (empty when there is none). */
export interface SpellDictionaryLicense {
  tag: string;
  text: string;
  path?: string;
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

/** A file dialog request as the core received it (`test.dialogRequests`, feature 002). */
export interface FileDialogRequestRecord {
  method: 'dialog.openFile' | 'dialog.saveFile' | 'dialog.pickFolder';
  mode: 'open' | 'openMultiple' | 'save' | 'folder';
  title: string;
  filters?: FileFilter[];
  multiple?: boolean;
  /** Index of the type selected when the dialog opens. */
  selectedFilter?: number;
  folder?: string;
  defaultPath?: string;
  encodingChoices?: string[];
  selectedEncoding?: string;
  encodingLabel?: string;
}

/** The latest published release (`app.latestRelease`, feature 002). */
export interface ReleaseInfo {
  tag: string;
  /** The tag without a leading "v". */
  version: string;
  /** The release's page, `.../releases/tag/<tag>`. */
  url: string;
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

/** A user template that could not be used; the bundled one was used instead (feature 002). */
export interface TemplateIssue {
  path: string;
  reason: 'unreadable' | 'empty' | 'notWellFormed' | 'notFictionBook';
  /** The core's reader message (English). */
  detail?: string;
}

/** The template a new document uses (resource-formats §2a). */
export interface TemplateInfo {
  path: string;
  layer: 'settings' | 'user' | 'portable' | 'bundled';
  issue?: TemplateIssue;
}

/**
 * Sent with a document the core loaded (feature 002): the document details it filled in, as
 * the original did, and for a new document a user template it could not use. Not part of the
 * document model (`loadedDocument()` removes them).
 */
export interface LoadReport {
  filledIn?: string[];
  templateIssue?: TemplateIssue;
}

export interface RpcMethods {
  // §3.1 app
  'app.info': { params: void; result: AppInfo };
  'app.quit': { params: { force?: boolean } | void; result: Empty };
  'app.openLogFolder': { params: void; result: Empty };
  'app.openFolder': { params: { path: string }; result: Empty };
  /** The system sound of a search that continued from the other end (feature 002). */
  'app.beep': { params: { kind: 'searchWrap' }; result: Empty };
  /** Help > Check for new version: the latest published release (feature 002, 1060 on failure). */
  'app.latestRelease': { params: void; result: ReleaseInfo };
  'app.setUiLanguage': {
    params: { lang: UiLanguageSetting };
    result: { restartRequired: boolean };
  };
  /**
   * "Restart now?" (feature 003 US3): the shell starts the editor again with its own options,
   * `reopen` as the document to open and the current window placement, then quits normally.
   * Called after the unsaved-changes prompt; no `reopen` for a never-saved document. Errors:
   * 1070 (no shell: the UI reloads its page, `?open=<reopen>` added), 1071 {reason}.
   */
  'app.restart': { params: { reopen?: string } | void; result: Empty };

  // §3.2 doc
  'doc.new': { params: void; result: Document & LoadReport };
  'doc.open': {
    params: { path: string };
    result: MaybeJob<{ document: Document & LoadReport; warnings: ValidationIssue[] }>;
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
  'doc.fromXml': {
    params: { docId: string; text: string };
    result: { document: Document & LoadReport };
  };
  /**
   * A `YYYY-MM-DD` value as the system's regional long date without the weekday (feature 003,
   * the Today button); `invalidParams` unless a calendar date.
   */
  'doc.formatDate': { params: { value: string }; result: { text: string } };
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
  /** Notice (`<tag>.txt`) of a dictionary for About; 1020 for an unknown tag. */
  'spell.dictionaryLicense': { params: { tag: string }; result: SpellDictionaryLicense };
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
  'resources.template': { params: void; result: TemplateInfo };
  'resources.openTemplateFolder': { params: void; result: { path: string } };

  // §3.7 settings / hotkeys
  'settings.get': { params: void; result: Settings };
  'settings.set': {
    params: { patch: SettingsPatch };
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
    params: {
      title: string;
      filters: FileFilter[];
      multiple?: boolean;
      /** Index of the type selected when the dialog opens (default 0). */
      selectedFilter?: number;
      /** Where the dialog opens (default: the folder last used by Open or Save As). */
      folder?: string;
      /** The file proposed: the dialog opens on its folder with its name filled in. */
      defaultPath?: string;
    };
    result: { paths: string[] };
  };
  'dialog.saveFile': {
    params: {
      title: string;
      filters: FileFilter[];
      defaultPath?: string;
      encodingChoices?: string[];
      /** The entry of `encodingChoices` selected when the dialog opens (default: the first). */
      selectedEncoding?: string;
      /** Label of the encoding choice in the interface language (default: the shell's own). */
      encodingLabel?: string;
      /** Index of the type selected when the dialog opens (default 0). */
      selectedFilter?: number;
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
  'test.dialogRequests': { params: void; result: FileDialogRequestRecord[] };
  'test.beeps': { params: void; result: { count: number } };
  'test.enqueueRelease': {
    params: { result: Partial<ReleaseInfo> & { tag: string } } | { error: ReleaseUnavailableData };
    result: { queued: number };
  };
  /** Shell-delegated network requests (`app.latestRelease`) made since start (feature 003). */
  'test.requests': { params: void; result: { method: string; at: string }[] };
  /** The `app.restart` calls the test provider recorded (feature 003). */
  'test.restartRequests': { params: void; result: { reopen?: string; argv: string[] }[] };
  /** Emits `app.closeRequested` exactly as the shell's close handshake does (feature 003). */
  'test.requestClose': { params: void; result: Empty };
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
  /** The shell was asked to close its window; the UI runs its quit flow (feature 003). */
  'app.closeRequested': Record<string, never>;
}

export type RpcNotificationName = keyof RpcNotifications;
