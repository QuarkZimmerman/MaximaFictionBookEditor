/**
 * Types of the scripting runtime (US12): the catalogue the core returns from `scripts.list`,
 * the worker <-> host bridge messages and the public `mfbe` shapes a script sees
 * (contracts/script-api.d.ts, mirrored by docs/scripting/mfbe.d.ts). Everything that crosses
 * the worker boundary must be structured-cloneable (plain JSON).
 */

import type { BinaryMeta, Description, Document } from '@/model/document';

/* ------------------------------------------------------------------------ */
/* Catalogue (scripts.list)                                                  */
/* ------------------------------------------------------------------------ */

// Feature 011 (US11, D41): 'treeRows' scripts list places in the tree (the tree bar's Scripts menu).
export type ScriptKind = 'menu' | 'tree' | 'treeRows';

export interface ScriptInfo {
  manifestVersion: 1;
  id: string;
  name: Record<string, string>;
  description?: Record<string, string>;
  kind: ScriptKind;
  entry: string;
  icon?: string;
  /** `/scripts/<id>/<icon>` (relative to the core origin). */
  iconUrl?: string;
  defaultHotkey?: string;
  needsSelection: boolean;
  undoLabel?: Record<string, string>;
  /**
   * The classic FictionBook Editor script the package was converted from: its path in the
   * original's Scripts folder, the FBE release (`2.7` for 2.7beta1, `2.7.9`) and the version
   * its header states (feature 007).
   */
  legacy?: ScriptLegacy;
  /** Group id (folder name, `''` for ungrouped scripts, `tree` for tree commands). */
  group: string;
  dir: string;
  folder: string;
  /** Layer that provided the package: bundled | user | settings | portable. */
  source: string;
  /** Where the script comes from; `assistant` is the assistant's folder (feature 007). */
  origin: ScriptOrigin;
  /**
   * The script of a lower layer this one replaces (feature 007, FR-085): it then shows in that
   * script's group and place, and keeps that script's icon when it has none of its own.
   */
  overrides?: ScriptOverride;
  entryUrl: string;
  warnings: string[];
}

/** `ScriptInfo.overrides`: the replaced script's origin and package folder. */
export interface ScriptOverride {
  origin: ScriptOrigin;
  dir: string;
}

export interface ScriptLegacy {
  source: string;
  fbeVersion?: string;
  sourceVersion?: string;
  /**
   * Other paths of the same classic script (feature 007): the 2.7.9 path of a package unchanged
   * since 2.7beta1, whose `source` stays 2.7beta1's. References resolve them like `source`.
   */
  aliases?: string[];
}

export type ScriptOrigin = 'bundled' | 'settings' | 'user' | 'portable' | 'assistant';

export interface ScriptGroup {
  id: string;
  order: number;
  names: Record<string, string>;
  dir: string;
  /** The icon file group.json declares. */
  icon?: string;
  /**
   * `/script-groups/<folder>/icon` (relative to the core origin): the merged group's declared
   * icon, from the layer whose declaration it uses (feature 007, rpc-api §2).
   */
  iconUrl?: string;
  scripts: ScriptInfo[];
}

export interface ScriptIssue {
  path: string;
  id?: string;
  reason: string;
  message: string;
  /** `info` (feature 007): `overridden` - the script at `path` is replaced by another layer's. */
  severity: 'error' | 'warning' | 'info';
}

export interface ScriptsListResult {
  groups: ScriptGroup[];
  issues: ScriptIssue[];
  folders: { bundled?: string; user?: string; custom?: string; portable?: string };
}

export interface ScriptSourceResult {
  entryUrl: string;
  entry: string;
  dir: string;
  files: string[];
}

/* ------------------------------------------------------------------------ */
/* Public API shapes (script-api.d.ts)                                       */
/* ------------------------------------------------------------------------ */

export interface NodeRef {
  nodeId: string;
  type: string;
}

export interface Position {
  nodeId: string;
  offset: number;
}

export type MarkName = 'strong' | 'emphasis' | 'strikethrough' | 'sub' | 'sup' | 'code';

export interface FindQuery {
  text: string;
  regex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  within?: NodeRef | string;
}

export interface Match {
  nodeId: string;
  from: number;
  to: number;
  text: string;
}

export interface SelectionInfo {
  anchor: Position;
  head: Position;
  text: string;
  nodes: NodeRef[];
}

export interface ButtonSpec {
  id: string;
  label: string;
  default?: boolean;
  cancel?: boolean;
}

export interface MessageOptions {
  caption?: string;
  buttons?: ButtonSpec[];
  icon?: 'info' | 'warning' | 'error' | 'question';
}

export interface PromptOptions {
  caption?: string;
  defaultValue?: string;
  yesNoCancel?: boolean;
}

export type FormField =
  | {
      kind: 'text';
      id: string;
      label: string;
      value?: string;
      placeholder?: string;
      multiline?: boolean;
    }
  | { kind: 'number'; id: string; label: string; value?: number; min?: number; max?: number }
  | { kind: 'checkbox'; id: string; label: string; value?: boolean }
  | { kind: 'select'; id: string; label: string; options: FormOption[]; value?: string }
  | { kind: 'radio'; id: string; label: string; options: FormOption[]; value?: string }
  | {
      kind: 'list';
      id: string;
      label: string;
      options: FormOption[];
      value?: string[];
      multiple?: boolean;
    }
  | { kind: 'static'; id: string; text: string }
  | {
      /**
       * A pattern with named presets and a validity check (feature 007, contracts/script-api.md
       * §4): choosing a preset puts its value in the field; OK is disabled while the pattern
       * does not compile with `flags`. The value is the pattern string.
       */
      kind: 'regexp';
      id: string;
      label: string;
      value?: string;
      presets?: FormOption[];
      presetsLabel?: string;
      flags?: string;
    };

export interface FormOption {
  value: string;
  label: string;
}

export interface FormSpec {
  title: string;
  width?: number;
  fields: FormField[];
  okLabel?: string;
  cancelLabel?: string;
}

export type FormValue = string | number | boolean | string[];
export type FormValues = Record<string, FormValue>;

export interface DocStats {
  characters: number;
  words: number;
  paragraphs: number;
  sections: number;
  images: number;
  notes: number;
  binaryBytes: number;
}

export interface ScriptSettings {
  nbspDisplayChar: string;
  pasteImageFormat: 'jpeg' | 'png';
  jpegQuality: number;
  uiLanguage: string;
}

export interface SymbolInfo {
  codepoint: number;
  name: string;
}

/** The end of a script run as its dialogs see it: one still open when the run ends closes. */
export interface RunEnd {
  readonly ended: boolean;
  subscribe(listener: () => void): () => void;
}

/**
 * Who started a run (script API version 2, contracts/script-api.md §1 of feature 007): a menu,
 * toolbar, hotkey or tree command ('user'), the AI assistant ('assistant'), or another script
 * through `mfbe.scripts.run` ('script').
 */
export type StartedBy = 'user' | 'assistant' | 'script';

/** `ctx` handed to `run(ctx)`; `cancelled` is a live getter in the worker. */
export interface ScriptContextData {
  script: { id: string; name: string; group: string; kind: ScriptKind };
  uiLanguage: string;
  treeNode?: NodeRef;
  startedBy: StartedBy;
  /** The calling script's id when `startedBy` is 'script'. */
  caller?: string;
  /** The `args` of `mfbe.scripts.run`, structured-cloned, when `startedBy` is 'script'. */
  args?: unknown;
}

/* ------------------------------------------------------------------------ */
/* Bridge messages                                                           */
/* ------------------------------------------------------------------------ */

/** Every host-side capability a script can call, keyed by `mfbe.<object>.<member>`. */
export type ApiMethod =
  | 'doc.get'
  | 'doc.getNode'
  | 'doc.replaceNode'
  | 'doc.insertNode'
  | 'doc.removeNode'
  | 'doc.setDescription'
  | 'doc.getElementsByTagName'
  | 'doc.textOf'
  | 'doc.setText'
  | 'doc.parentOf'
  | 'doc.childrenOf'
  | 'doc.find'
  | 'doc.replaceAll'
  | 'doc.binaries'
  | 'doc.stats'
  | 'selection.get'
  | 'selection.set'
  | 'selection.replaceText'
  | 'selection.wrap'
  | 'selection.unwrap'
  | 'selection.selectNode'
  | 'selection.scrollIntoView'
  | 'ui.message'
  | 'ui.prompt'
  | 'ui.form'
  | 'ui.status'
  | 'ui.progress'
  | 'ui.report'
  | 'edit.label'
  | 'edit.symbols'
  | 'env.settings'
  | 'env.docLanguage'
  // Script API version 2 (feature 007, contracts/script-api.md §2-§5).
  | 'clipboard.readText'
  | 'clipboard.writeText'
  | 'files.saveText'
  | 'files.saveBinaries'
  | 'scripts.run'
  // Script API version 3 (feature 011, contracts/script-api.md): power (e), rows of the tree.
  | 'tree.showRows'
  | 'tree.clearRows';

export const API_METHODS: readonly ApiMethod[] = [
  'doc.get',
  'doc.getNode',
  'doc.replaceNode',
  'doc.insertNode',
  'doc.removeNode',
  'doc.setDescription',
  'doc.getElementsByTagName',
  'doc.textOf',
  'doc.setText',
  'doc.parentOf',
  'doc.childrenOf',
  'doc.find',
  'doc.replaceAll',
  'doc.binaries',
  'doc.stats',
  'selection.get',
  'selection.set',
  'selection.replaceText',
  'selection.wrap',
  'selection.unwrap',
  'selection.selectNode',
  'selection.scrollIntoView',
  'ui.message',
  'ui.prompt',
  'ui.form',
  'ui.status',
  'ui.progress',
  'ui.report',
  'edit.label',
  'edit.symbols',
  'env.settings',
  'env.docLanguage',
  'clipboard.readText',
  'clipboard.writeText',
  'files.saveText',
  'files.saveBinaries',
  'scripts.run',
  'tree.showRows',
  'tree.clearRows',
];

/** Messages from the host to the worker (over the private MessagePort). */
export type HostMessage =
  | { type: 'run'; entryUrl: string; context: ScriptContextData }
  | { type: 'result'; id: number; value: unknown; json?: boolean }
  /** A rejected call: `name`/`code` of a `ScriptApiError` (api-impl.ts) when it was one. */
  | { type: 'error'; id: number; message: string; name?: string; code?: string }
  | { type: 'cancel' };

export interface ScriptErrorInfo {
  name: string;
  message: string;
  /** The `code` of a `ScriptApiError` the script let through (`clipboard.readNotAllowed`, …). */
  code?: string;
  line?: number;
  column?: number;
  /** File of the location when it is not the entry module (relative to the package). */
  file?: string;
  stack?: string;
}

/** Messages from the worker to the host. */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'call'; id: number; method: ApiMethod; args: unknown[] }
  /** `value`: what the script's run() returned (structured-cloned) - for mfbe.scripts.run. */
  | { type: 'done'; value?: unknown }
  | { type: 'fail'; error: ScriptErrorInfo }
  | { type: 'log'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; args: unknown[] };

/** The first (and only) message posted on the worker's own channel: hands over the port. */
export interface InitMessage {
  type: 'init';
  port: MessagePort;
}

export type { BinaryMeta, Description, Document };
