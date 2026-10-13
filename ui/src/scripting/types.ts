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

export type ScriptKind = 'menu' | 'tree';

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
  legacy?: { source: string; fbeVersion?: string };
  /** Group id (folder name, `''` for ungrouped scripts, `tree` for tree commands). */
  group: string;
  dir: string;
  folder: string;
  /** Layer that provided the package: bundled | user | settings | portable. */
  source: string;
  entryUrl: string;
  warnings: string[];
}

export interface ScriptGroup {
  id: string;
  order: number;
  names: Record<string, string>;
  dir: string;
  icon?: string;
  scripts: ScriptInfo[];
}

export interface ScriptIssue {
  path: string;
  id?: string;
  reason: string;
  message: string;
  severity: 'error' | 'warning';
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
  | { kind: 'static'; id: string; text: string };

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

/** `ctx` handed to `run(ctx)`; `cancelled` is a live getter in the worker. */
export interface ScriptContextData {
  script: { id: string; name: string; group: string; kind: ScriptKind };
  uiLanguage: string;
  treeNode?: NodeRef;
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
  | 'edit.label'
  | 'edit.symbols'
  | 'env.settings'
  | 'env.docLanguage';

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
  'edit.label',
  'edit.symbols',
  'env.settings',
  'env.docLanguage',
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
  | { type: 'done' }
  | { type: 'fail'; error: ScriptErrorInfo }
  | { type: 'log'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; args: unknown[] };

/** The first (and only) message posted on the worker's own channel: hands over the port. */
export interface InitMessage {
  type: 'init';
  port: MessagePort;
}

export type { BinaryMeta, Description, Document };
