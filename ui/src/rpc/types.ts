/**
 * Typed surface of the core <-> UI JSON-RPC contract
 * (specs/001-maxima-fb2-editor/contracts/rpc-api.md, version 1, with the additive changes of
 * specs/002-tester-feedback-fixes/contracts/rpc-api.md, minor 1,
 * specs/003-second-feedback-batch/contracts/rpc-api.md, minor 2, and
 * specs/004-third-feedback-batch/contracts/rpc-api.md, minor 3).
 *
 * Every method of rpc-api.md §3 and §5 appears in `RpcMethods`; every notification of §4 in
 * `RpcNotifications`. Document types come from the shared model (`@/model/document`).
 * Change the contract first, then this file, then the C++ handler table.
 */

import type {
  AnnotationNode,
  BinaryMeta,
  BlockNode,
  BodyNode,
  CellNode,
  DateNode,
  Description,
  Document,
  DocumentInfo,
  EpigraphNode,
  InlineNode,
  RowNode,
  SectionNode,
  StanzaNode,
  TextAuthorNode,
  TitleNode,
  ValidationIssue,
  ValidationReport,
  VerseNode,
} from '@/model/document';

export type { BinaryMeta, Document, ValidationIssue, ValidationReport } from '@/model/document';

export const RPC_API_VERSION = 1;
/**
 * Additive contract revision within RPC_API_VERSION (`app.info().apiMinor`; absent = 0). The
 * revision this UI was written for; it accepts any core answering minor >= 1 (rpc-api.md §6).
 */
export const RPC_API_MINOR = 3;

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
  /** `doc.mapPositions`: `serial` is not the session's current position map (feature 004). */
  docPositionsStale: 1005,
  /** `doc.exportDescription`: the target is the open document's own file (feature 004). */
  docSameAsOpenFile: 1006,
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

/**
 * The in-session caret of a view (the `CaretRegistry`: view switching, go-to-issue). Since
 * feature 004 nothing stored reaches it; the remembered place is a `RememberedPosition`.
 */
export interface Caret {
  view: ViewId;
  nodeId?: string;
  offset?: number;
  line?: number;
  column?: number;
}

/**
 * The remembered Body position of a file (feature 004 US8, rpc-api.md "Definitions shared by
 * the additions"): `path` a structural path under one of the three roots the Body view shows
 * (`body[n]`, `title-info/annotation[1]`, `document-info/history[1]`), `offset` a model offset
 * inside that text block (UTF-16 units of text plus 1 per inline atom, >= 0). It survives
 * saves, Source visits and restarts, unlike a session's node id.
 */
export interface RememberedPosition {
  path: string;
  offset: number;
}

/**
 * A Body-side position for `doc.mapPositions` (feature 004 US7, data-model §7): a node of the
 * Document JSON and a model offset inside it (UTF-16 code units of text plus 1 per inline atom,
 * marks of no width; 0 for a node without inline content).
 */
export interface ModelPoint {
  nodeId: string;
  offset: number;
}

export interface RecentFile {
  path: string;
  lastOpened: string; // ISO timestamp
  /**
   * @deprecated Since feature 004 the core never writes it again (remembered positions live in
   * `positions.json`, `doc.position`); an item read from a file of release 0.0.3 or earlier
   * may still carry it until that file is next written. Read-only; removed with the next major.
   */
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
  /**
   * Additive contract revision (feature 002: 1, feature 003: 2, feature 004: 3); the UI accepts
   * minor >= 1 and, with a core that answers no `serial`, switches views without mapping.
   */
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
    /** Switch the keyboard layout when a document is opened (feature 004, FR-090). */
    switchKeyboardLayout: boolean;
    /**
     * The shell's identifier of the chosen layout (Windows KLID `00000419`, macOS input source
     * id, X11 group name; "" = none chosen); the id alone decides the match at an open.
     */
    keyboardLayoutId: string;
    /** The name the system gave the chosen layout when it was picked ("<name> (not installed)"). */
    keyboardLayoutName: string;
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
    /**
     * Width of the Document Tree pane in CSS px (feature 004, FR-003; default 260, core range
     * 100-10000). Written when a divider drag ends; the UI clamps the width it applies to the
     * window (pane 160 px, view 320 px) without rewriting the setting.
     */
    treeWidth: number;
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

/** Why a dictionary file is not used (feature 003 US4, rpc-api.md §3.4). */
export type SpellDictionaryRejectReason =
  'partnerMissing' | 'unreadable' | 'unsupportedEncoding' | 'shadowed';

/** A file of a dictionaries folder the core could not use (`spell.dictionaryReport`). */
export interface SpellRejectedDictionary {
  /** The file concerned: the `.aff`, or a lone / unreadable `.dic`. */
  path: string;
  reason: SpellDictionaryRejectReason;
  /**
   * `shadowed`: the layer whose pair of the same tag stays in effect (`bundled` | `settings` |
   * `user`); `unsupportedEncoding`: the encoding the `.aff` `SET` line declares.
   */
  detail?: string;
}

/** A folder of the dictionaries lookup, in order: settings (chosen), user, portable, bundled. */
export interface SpellDictionaryFolder {
  layer: 'settings' | 'user' | 'portable' | 'bundled';
  /** Empty when the layer has no folder (no folder chosen, no portable folder). */
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
}

/**
 * `spell.dictionaryReport()` result (feature 003 US4): the dictionaries in effect, the files
 * that could not be used with the reason, and the folders of the lookup with their state. The
 * core refreshes the layers and the registry before answering, so dictionaries copied into a
 * folder are picked up when Settings are applied, without a restart.
 */
export interface SpellDictionaryReport {
  dictionaries: SpellDictionary[];
  rejected: SpellRejectedDictionary[];
  folders: SpellDictionaryFolder[];
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

/** One keyboard layout the system offers for switching (feature 004, rpc-api.md §3.11). */
export interface KeyboardLayout {
  /** The shell's stable identifier: Windows KLID `00000419`, macOS input source id, X11 group name. */
  id: string;
  /** What the system shows for it. */
  name: string;
}

/** `system.keyboardLayouts()` result: `supported: false` comes with a `reason` and no layouts. */
export interface KeyboardLayoutList {
  supported: boolean;
  reason?: 'wayland' | 'noDisplay' | 'noShell' | 'unsupported';
  layouts: KeyboardLayout[];
  /** The active layout's id when the platform can tell. */
  current?: string;
}

/**
 * `system.activateKeyboardLayout` result - a result, never an error: `notInstalled` (not in the
 * current list), `refused` (the system declined; the core logged it), `unsupported` (no provider
 * or no switch on this platform); `activated: false` without a reason when the request completed
 * but the system kept its own choice (macOS, best effort).
 */
export interface KeyboardLayoutSwitch {
  activated: boolean;
  reason?: 'notInstalled' | 'refused' | 'unsupported';
}

/** A recorded `system.activateKeyboardLayout` request of the test stand-in (`at` ISO 8601 UTC). */
export interface KeyboardLayoutRequest {
  id: string;
  at: string;
  activated: boolean;
}

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

/**
 * `doc.readDescription` result (feature 004 US4, rpc-api.md §3.2): the description of another
 * FictionBook file, read as Open reads it, for the import into the open document.
 * `description` is as read (node ids from the open document's allocator); `documentDetails`
 * the file's document-info after the fill-in of 002 FR-005 (the UI takes the four document
 * details from it); `binaries` the metadata of the binaries an importable entry refers to,
 * held by the hidden session `importId` - a `docId` for `GET /binary/{importId}/{id}/preview`
 * (the dialog's cover picture), `binary.copy` and `doc.close`, which the UI calls whatever the
 * outcome. The reader's `warnings` are not shown.
 */
export interface ReadDescriptionResult {
  importId: string;
  description: Description;
  documentDetails: DocumentInfo;
  binaries: BinaryMeta[];
  warnings: ValidationIssue[];
}

/**
 * `doc.exportDescription` result (feature 004 US5, rpc-api.md §3.2): the FBD file written -
 * the live description, the binaries it refers to (converted to JPEG/PNG in the copy and
 * reported in `converted` as Save reports them) and one empty section, always UTF-8 - with
 * the validation report of that exported content. The open document's session is untouched.
 */
export interface ExportDescriptionResult {
  path: string;
  validation: ValidationReport;
  converted: BinaryMeta[];
  needsConfirmation?: false;
}

/* ------------------------------------------------------------------------ */
/* feature 005 — doc.fragment*, schema.text, scripts.write                  */
/* (specs/005-ai-assistant/contracts/rpc-api.md §3.2, §3.8, §3.13)          */
/* ------------------------------------------------------------------------ */

/**
 * A block or structural node of a fragment (feature 005, rpc-api.md §3.2): the body-tree
 * node shapes of the document model, as the UI holds them in its working copy.
 */
export type FragmentBlockNode =
  | BodyNode
  | SectionNode
  | TitleNode
  | EpigraphNode
  | AnnotationNode
  | BlockNode
  | StanzaNode
  | TextAuthorNode
  | VerseNode
  | DateNode
  | RowNode
  | CellNode;

/**
 * A node `doc.fragmentToXml` takes: block / structural nodes, or the inline nodes of one text
 * container's content (never a mix in one list). `attrs.nodeId` is never written.
 */
export type FragmentNode = FragmentBlockNode | InlineNode;

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
  /**
   * The Source text of `document`. With `positions: true` the core records the position map
   * of the text (feature 004 US7) and names it by `serial` for `doc.mapPositions`; a core
   * without the map answers no `serial`. The received document becomes the session's snapshot.
   */
  'doc.toXml': {
    params: { docId: string; document: Document; elideBinaries?: boolean; positions?: boolean };
    result: { text: string; serial?: number };
  };
  /**
   * Parses Source text back into the model (1001 when malformed). With `positions: true` the
   * core records the position map of the parsed text against the new node ids (feature 004
   * US7) and names it by `serial`; a success without the flag drops the map.
   */
  'doc.fromXml': {
    params: { docId: string; text: string; positions?: boolean };
    result: { document: Document & LoadReport; serial?: number };
  };
  /**
   * Body <-> Source positions through the position map `serial` names (feature 004 US7,
   * rpc-api.md §3.2): `toSource` turns model points into UTF-16 offsets of the text (an
   * entity counts as its one character, mark tags nothing; `null` for an unknown node),
   * `toModel` turns offsets into model points (a start tag -> the element's start, an end tag
   * -> its end, whitespace -> the next element; `null` outside every mapped node - the UI
   * goes to the document's start). Errors: 1000, 1005 {docId, serial} when `serial` is not the
   * current map, invalidParams {field} for a malformed point, an offset outside the text or
   * neither list.
   */
  'doc.mapPositions': {
    params: { docId: string; serial: number; toSource?: ModelPoint[]; toModel?: number[] };
    result: { toSource: (number | null)[]; toModel: (ModelPoint | null)[]; durationMs: number };
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
  /** Unchanged by feature 004: empties `recent.json` only, never the positions record (D4). */
  'doc.clearRecent': { params: void; result: Empty };
  'doc.watch': { params: { docId: string; enabled: boolean }; result: Empty };
  /**
   * The remembered Body position of the session's file (feature 004 US8, rpc-api.md §3.2).
   * Set: `position` must match the structural-path grammar with an offset >= 0
   * (`invalidParams` {field} otherwise); kept in the session and, when the session has a file
   * and `other.restorePosition` is on, recorded in `positions.json` under the session's path
   * (100 files, the platform's path comparison) - the core gates, so a UI without the settings
   * yet cannot record either. Get: the session's position (set here or loaded at `doc.open`),
   * `{}` when nothing is remembered or the setting is off. The core validates the shape only;
   * resolving the path against the document (FR-101's fallback) is the UI's.
   */
  'doc.position': {
    params: { docId: string; position?: RememberedPosition };
    result: { position?: RememberedPosition };
  };
  /**
   * @deprecated Since feature 004: an alias of `doc.position` in the 1.x caret shape, kept so
   * that apiMinor 3 stays additive; the UI never calls it. A `body` caret whose node id the
   * session's snapshot knows is recorded as its structural path; any other caret stays in the
   * session. Removed with the next major (`apiVersion` 2).
   */
  'doc.caret': { params: { docId: string; caret?: Caret }; result: { caret?: Caret } };
  /**
   * The description of another FictionBook file for the import into `docId` (feature 004
   * US4; a job above Open's threshold with Open's phases). Errors are Open's: 1004, 1001 (no
   * Source-only fallback), 1002 (a missing file prunes no recent entry), 1000, invalidParams.
   */
  'doc.readDescription': {
    params: { docId: string; path: string };
    result: MaybeJob<ReadDescriptionResult>;
  };
  /**
   * Writes the description of `docId` - `document` is the live model, so unsaved edits count
   * - as a stand-alone FBD file at `path` (feature 004 US5): UTF-8 always, one empty section as
   * the body, the referenced binaries alone. `needsConfirmation` asks Save's question, answered
   * by a repeat with `force: true`; a job above Save's threshold with Save's phases. Errors:
   * 1006 (the open document's own file, by file identity), 1000, 1002, invalidParams.
   */
  'doc.exportDescription': {
    params: { docId: string; document: Document; path: string; force?: boolean };
    result: MaybeJob<ExportDescriptionResult | SaveNeedsConfirmation>;
  };
  /** Cancels a running long operation; it then reports `job.failed` 1090 (rpc-api.md §1). */
  'job.cancel': { params: { jobId: string }; result: Empty };

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
  /**
   * Copies the binary `id` of the session `fromDocId` (the import session) into `docId`'s
   * store inside the core (feature 004 US4): identical content already there is answered with
   * `existing: true` and nothing added, else the copy is stored under `suggestedId ?? id` made
   * unique (the UI repoints the imported cover page to the returned `id`), `existing: false`
   * and `referenceCount` 0. Errors: 1000 for either session, 1010 for the id, invalidParams.
   */
  'binary.copy': {
    params: { docId: string; fromDocId: string; id: string; suggestedId?: string };
    result: BinaryMeta & { existing: boolean };
  };

  // §3.4 spell
  'spell.dictionaries': { params: void; result: SpellDictionary[] };
  /** Feature 003 US4: dictionaries in effect, rejected files and lookup folders (refreshed). */
  'spell.dictionaryReport': { params: void; result: SpellDictionaryReport };
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
  /** Feature 003 US4: the chosen dictionaries folder, else `<Data>/dictionaries` (created). */
  'resources.openDictionariesFolder': { params: void; result: { path: string } };

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

  // §3.11 system (shell-delegated; feature 004)
  /** The keyboard layouts the system offers, read afresh; `noShell` without a provider. */
  'system.keyboardLayouts': { params: void; result: KeyboardLayoutList };
  /**
   * Switches the editor's window to the layout `id` when the system lists it (FR-091); called
   * once per document opened when `other.switchKeyboardLayout` is on. `invalidParams` for a
   * missing or empty `id`; every other outcome is a result.
   */
  'system.activateKeyboardLayout': { params: { id: string }; result: KeyboardLayoutSwitch };

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
  /** Reseeds the recording keyboard layout stand-in of `--test-hooks` (feature 004). */
  'test.setKeyboardLayouts': { params: KeyboardLayoutList; result: Empty };
  /** Every `system.activateKeyboardLayout` the stand-in received since start (feature 004). */
  'test.keyboardLayoutRequests': { params: void; result: KeyboardLayoutRequest[] };

  // feature 005 — doc.fragment*, schema.text, scripts.write
  /**
   * The FictionBook XML text of the given nodes exactly as the writer writes them inside a
   * book (feature 005, rpc-api.md §3.2): structural elements one per line, one tab per level
   * re-based so that the first start tag is at column 0, nodes separated by `\n`, the
   * session's xlink prefix, no declaration, no namespace declarations, no `nodeId`, an image
   * as its tag only; inline nodes as the content of a text container. Exactly one of `nodes`
   * (the nodes as the UI holds them) or `nodeIds` (resolved in `document`, else in the
   * session's snapshot; written in document order, a nested id once inside its ancestor,
   * duplicates ignored). Errors: 1000; 1003 for a Source-only session; invalidParams
   * {field: 'nodes'} (both or neither form, a mixed list, an undecodable node), {field:
   * 'nodeIds', nodeId} for an unknown id. No side effects - the snapshot is untouched.
   */
  'doc.fragmentToXml': {
    params:
      | { docId: string; nodes: FragmentNode[] }
      | { docId: string; document?: Document; nodeIds: string[] };
    result: { xml: string };
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
  /** The shell was asked to close its window; the UI runs its quit flow (feature 003). */
  'app.closeRequested': Record<string, never>;
}

export type RpcNotificationName = keyof RpcNotifications;
