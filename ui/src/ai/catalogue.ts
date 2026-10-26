/**
 * The assistant's catalogue (feature 005 T044; ai-catalogue §1, §3, §5; data-model §8; research
 * R2, decision D2): one `McpServer` with the tools, resources and prompts of the contract and one
 * `Client` linked to it by `InMemoryTransport.createLinkedPair()`. Nothing listens - no port, no
 * pipe, no `window` export (FR-050, SC-012); the MCP SDK and zod are confined to this module and
 * reach the page only through the lazily imported `ai-assistant` chunk (SC-013).
 *
 * The catalogue is bound to one request through `CatalogueDeps`: the working copy the tools
 * read and write, the request's selection, the context builder, the fragment round trips of the
 * core (`doc.fragmentToXml` / `doc.fragmentFromXml`), the `sc_<N>` allocator (review C12), the
 * validity hook of `hook.ts` (every change tool runs inside it with its strike key - §3.5) and
 * the regex runner (a worker with the 2-second budget, review C15). Every result is an MCP
 * `CallToolResult` whose `text` is `JSON.stringify(structuredContent)`; every failure is the
 * `{error: {code, message, hint?, expected?, issues?, strike?}}` envelope of §1.4 with
 * `isError: true`, so that the model - which receives the text alone - sees it too.
 *
 * Tools are registered in the contract's order, one `register…Tools` per group: this file holds
 * the read tools of US2 (`get_context`, `get_outline`, `read_part`, `get_selection`,
 * `get_description`, `find`), the selection tool (`set_selection`), the first change tool
 * (`replace_selection`) and the structural change tools of US3 (T054: `replace_node`,
 * `insert_node`, `remove_node`, `set_text`, `replace_all`, `set_description` - every one through
 * the hook with its strike key of §3.5, the pre-checks of the script API before the round trip:
 * `nodeFromModel` + `createChecked` on every level, `contentFits` against the parent's content
 * expression); US4 (T061) and US6 (T075) add theirs at the marked places. The read tools share
 * one continuation implementation (T056, `split.ts`): parts of whole units within
 * `deps.resultBudget()`, descent into an oversize child, `tooLarge` for one oversize block,
 * `more: {cursor, remaining, hint}` with the opaque cursors of §3.7.
 */

import { Client } from '@modelcontextprotocol/client';
import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import { InMemoryTransport, McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { NodeType } from 'prosemirror-model';
import { z } from 'zod';

// The `mfbe://` resources of ai-catalogue §4 (US6 T075; FR-081), bundled as text: the product's
// script API description (`docs/scripting/mfbe.d.ts` - the parity with the contract copy is a
// workspace-side check), the scripting guide whose §1-§3 are the manifest contract, and the
// bundled example script, whole, notice header included (review C1).
import exampleScriptIndex from '../../../scripts/18_editing/04_empty-line-before-poem-or-cite/index.js?raw';
import exampleScriptManifest from '../../../scripts/18_editing/04_empty-line-before-poem-or-cite/script.json?raw';
import scriptingGuide from '../../../docs/scripting/en.md?raw';
import scriptApiText from '../../../docs/scripting/mfbe.d.ts?raw';

import { createReport, nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { gridOfModel } from '@/editor/table/grid';
import { fb2NameFor, fb2Schema, nodeTypeFor } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import type {
  Description,
  Document,
  InlineNode,
  RawXmlNode,
  TableNode,
  ValidationReport,
} from '@/model/document';
import { RpcError } from '@/rpc/client';
import {
  RpcErrorCode,
  type AiFragmentNotAllowedData,
  type FragmentNode,
  type FragmentResultNode,
  type SchemaTextResult,
} from '@/rpc/types';
import { contentFits } from '@/scripting/api-impl';
import type { WorkingCopy } from '@/scripting/workingCopy';
import type { Fb2Elements } from '@/views/source/completion';
import fb2ElementsJson from '@/views/source/fb2Elements.json';

import {
  errorForModel,
  invalidXmlHint,
  issueKey,
  multiset,
  type ErrorForModel,
  type IssueMultiset,
} from './hook';
import type { RegexMatch, RegexRunner } from './regexRunner';
import {
  decodeCursor,
  moreOf,
  partition,
  partitionTree,
  type Cursor,
  type TreePartOutcome,
} from './split';
import { irregularTablesOf } from './tables';
import { DESCRIPTION_SHAPE, mergeDescription } from './tools/description';
import {
  blockOf,
  characterCount,
  childEntries,
  commonParentBlocks,
  containerSize,
  edgeTextContainer,
  hasInlineElements,
  indexDocument,
  inlineText,
  leafBlocks,
  marksAt,
  nodeIdOf,
  nodeInfo,
  normalizeInline,
  outline,
  outlineEntry,
  pathOf,
  resolveReference,
  siblingsOf,
  sliceInline,
  splitInline,
  TEXT_CONTAINERS,
  type DocIndex,
  type Entry,
  type OutlineEntry,
} from './tools/model';
import {
  checkProposal,
  RUN_NOT_CONFIRMED_HINT,
  type ProposalArgs,
  type ScriptProposal,
} from './proposal';
import { expansionFor, rewriteBlock } from './tools/replaceAll';
import { registerTableChangeTools, registerTableReadTools } from './tools/table';
import { inDescription, replaceEach, writeAt } from './tools/write';

export type { Block, NodeInfo, OutlineEntry } from './tools/model';

/* ------------------------------------------------------------------------ */
/* Contract constants                                                       */
/* ------------------------------------------------------------------------ */

/** Catalogue version reported by `get_context` (ai-catalogue §1). */
export const CATALOGUE_VERSION = 2; // feature 006 (US11): read_table, edit_table, `cells`

/** The name rule every tool, resource and prompt obeys (OpenAI's, the stricter one). */
export const TOOL_NAME_RULE = /^[a-zA-Z0-9_-]{1,64}$/;

/** OpenAI's limit on a function description. */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** The §3 order of the tools of this release's first part (T041 asserts it). */
export const US2_TOOL_NAMES = [
  'get_context',
  'get_outline',
  'read_part',
  'get_selection',
  'get_description',
  'find',
  'set_selection',
  'replace_selection',
] as const;

/** The structural change tools of US3 (T054), in the §3.3 order - registered after US2's. */
export const US3_TOOL_NAMES = [
  'replace_node',
  'insert_node',
  'remove_node',
  'set_text',
  'replace_all',
  'set_description',
] as const;

/** The schema and validation read tools of US4 (T061), in the §3.1 order - after `find`. */
export const US4_TOOL_NAMES = ['validate', 'get_schema'] as const;

/** The script read tools of US6 (T075), in the §3.1 order - after `get_schema`. */
export const US6_READ_TOOL_NAMES = ['list_scripts', 'read_script', 'read_resource'] as const;

/** The table read tool of feature 006 (US11; ai-catalogue Δ§1.2) - after `read_resource`. */
export const TABLE_READ_TOOL_NAMES = ['read_table'] as const;

/** The table change tool of feature 006 (US11; ai-catalogue Δ§1.2) - after `set_description`. */
export const TABLE_CHANGE_TOOL_NAMES = ['edit_table'] as const;

/** The script tools of US6 (T076, T077), in the §3.4 order - after the structural change tools. */
export const US6_SCRIPT_TOOL_NAMES = ['run_script', 'propose_script', 'reload_scripts'] as const;

/**
 * Every tool, in the `tools/list` order of §3: the read tools of §3.1 (US2's six, then US4's
 * two, then US6's three, then feature 006's `read_table`), the selection tools of §3.2, the
 * structural change tools of §3.3 with feature 006's `edit_table`, and the script tools of §3.4 -
 * 24 tools (ai-catalogue Δ§1.2).
 */
export const TOOL_NAMES = [
  ...US2_TOOL_NAMES.slice(0, 6),
  ...US4_TOOL_NAMES,
  ...US6_READ_TOOL_NAMES,
  ...TABLE_READ_TOOL_NAMES,
  ...US2_TOOL_NAMES.slice(6),
  ...US3_TOOL_NAMES,
  ...TABLE_CHANGE_TOOL_NAMES,
  ...US6_SCRIPT_TOOL_NAMES,
] as const;

/** The five schema files of `schema.text()` (rpc-api §3.13), in order - the resources of §4. */
export const SCHEMA_FILE_NAMES = [
  'FictionBook.xsd',
  'FictionBookGenres.xsd',
  'FictionBookLang.xsd',
  'FictionBookLinks.xsd',
  'FictionNotes.xsd',
] as const;

/** The URI of a schema file's MCP resource (ai-catalogue §4). */
export const schemaResourceUri = (name: string) => `fb2://schema/${name}`;

/** The `mfbe://` resources of §4 the `read_resource` tool serves (US6 T075), in the §4 order. */
export const MFBE_RESOURCE_URIS = [
  'mfbe://script-api.d.ts',
  'mfbe://script-manifest.md',
  'mfbe://example-script',
] as const;

export type MfbeResourceUri = (typeof MFBE_RESOURCE_URIS)[number];

/** The resource template of a script's file (§4): `id` percent-encoded, `file` the path within the package. */
export const SCRIPT_FILE_TEMPLATE = 'mfbe://scripts/{id}/{file}';

/** The eight fixed resource URIs (ai-catalogue §4): the five schema files, then the `mfbe://` three. */
export const RESOURCE_URIS = [...SCHEMA_FILE_NAMES.map(schemaResourceUri), ...MFBE_RESOURCE_URIS];

/** The bundled script the `mfbe://example-script` resource carries whole (§4, FR-081). */
export const EXAMPLE_SCRIPT_ID = '18/empty-line-before-poem-or-cite';

/** What each schema file holds (the resource description, ai-catalogue §4). */
const SCHEMA_FILE_ROLES: Record<(typeof SCHEMA_FILE_NAMES)[number], string> = {
  'FictionBook.xsd': 'the FictionBook 2.1 schema as shipped - every element and its content model',
  'FictionBookGenres.xsd': 'the genre enumeration (the values of <genre>)',
  'FictionBookLang.xsd': 'the xs:language type used by <lang> and xml:lang',
  'FictionBookLinks.xsd': 'the xlink attributes (l:href, l:type)',
  'FictionNotes.xsd': 'the notes schema shipped alongside (not reached from FictionBook.xsd)',
};

/** The licence line every schema resource carries before the notice itself is fetched. */
const SCHEMA_LICENCE_LINE =
  'Licence: BSD 2-clause, Copyright (c) 2004, Dmitry Gribov - the full notice is the notice member of get_schema.';

/** The change tools of §3.5 (every call runs under the hook with a strike key). */
export const CHANGE_TOOL_NAMES = [
  'replace_selection',
  ...US3_TOOL_NAMES,
  'edit_table',
  'run_script',
] as const;

const UNKNOWN_NODE_HINT =
  'Use the ids returned by get_outline, read_part or find; paths shift after insertions.';

/** The text containers `set_text` accepts (ai-catalogue §3.3). */
const TEXT_CONTAINER_LIST = 'p, subtitle, text-author, v, td, th, date';

/** The changed blocks `replace_all` lists at most (ai-catalogue §3.3; `count` stays exact). */
export const REPLACE_ALL_BLOCKS_LISTED = 100;

/* ------------------------------------------------------------------------ */
/* Error envelope (ai-catalogue §1.4)                                        */
/* ------------------------------------------------------------------------ */

export type ToolErrorCode =
  | 'unknownTool'
  | 'invalidArguments'
  | 'unknownNode'
  | 'invalidNode'
  | 'notAllowed'
  | 'invalidXml'
  | 'fragmentNotAllowed'
  | 'rejected'
  | 'noSelection'
  | 'selectionRequired'
  | 'textOnly'
  | 'tooLarge'
  | 'unavailable'
  | 'runNotConfirmed'
  /** Feature 006 (FR-052): a gate - the user's command would ask before removing link targets. */
  | 'confirmationRequired'
  | 'scriptIdBundled'
  | 'scriptExists'
  | 'scriptFailed'
  | 'cancelled'
  | 'internal';

export interface ToolErrorBody {
  code: ToolErrorCode;
  message: string;
  hint?: string;
  expected?: unknown;
  issues?: unknown[];
  strike?: { count: number; of: number };
  [extra: string]: unknown;
}

export interface ToolErrorEnvelope {
  error: ToolErrorBody;
  [extra: string]: unknown;
}

/** A tool failure: thrown by a handler, turned into the envelope by the registration wrapper. */
export class ToolError extends Error {
  readonly body: ToolErrorBody;

  constructor(
    code: ToolErrorCode,
    message: string,
    extra: Omit<ToolErrorBody, 'code' | 'message'> = {},
  ) {
    super(message);
    this.name = 'ToolError';
    this.body = { code, message, ...extra };
  }

  envelope(): ToolErrorEnvelope {
    return { error: { ...this.body } };
  }
}

export function isToolErrorEnvelope(value: unknown): value is ToolErrorEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    !!(value as ToolErrorEnvelope).error &&
    typeof (value as ToolErrorEnvelope).error === 'object' &&
    typeof (value as ToolErrorEnvelope).error.code === 'string'
  );
}

/* ------------------------------------------------------------------------ */
/* Selection model (ai-catalogue §3.2; data-model §4.2)                      */
/* ------------------------------------------------------------------------ */

/** A point of the Body selection in model terms: a node and a model offset inside it. */
export interface ModelPoint {
  nodeId: string;
  offset: number;
}

/**
 * The request's selection as the catalogue reads and writes it: the kinds of §3.2. `blocks`
 * lists the touched sibling blocks in order; `openStart` / `openEnd` say that the selection
 * starts inside the first / ends inside the last block (`anchor` / `head` give where - never
 * widened, review C6). `source` is the Source view's text selection (US5).
 */
export type ModelSelection =
  | { kind: 'none'; anchor: ModelPoint; head: ModelPoint }
  | { kind: 'inline'; anchor: ModelPoint; head: ModelPoint }
  | {
      kind: 'blocks';
      anchor: ModelPoint;
      head: ModelPoint;
      nodeIds: string[];
      openStart: boolean;
      openEnd: boolean;
    }
  | { kind: 'source'; from: number; to: number; text: string }
  /**
   * A block of cells (feature 006, FR-063; Δ§3.2): its table's node id and its rectangle from 1;
   * `source` for a block of a description field.
   */
  | {
      kind: 'cells';
      anchor: ModelPoint;
      head: ModelPoint;
      table: string;
      row: number;
      column: number;
      rows: number;
      columns: number;
      source?: { view: 'description'; field: 'annotation' | 'sti-annotation' | 'history' };
    };

/** The hint of `get_selection` on a block of cells (ai-catalogue Δ§3.1), verbatim. */
export const CELLS_SELECTION_HINT =
  'read_table with fromRow = row and toRow = row + rows - 1 shows these cells; edit_table takes the same row, column, rows and columns.';

/** Holds the request's selection; `set_selection` and `replace_selection` write it. */
export interface SelectionHolder {
  get(): ModelSelection;
  set(selection: ModelSelection): void;
}

export function selectionHolder(initial: ModelSelection): SelectionHolder {
  let current = initial;
  return {
    get: () => current,
    set: (selection) => {
      current = selection;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Dependencies                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Runs one change of the working copy under the validity hook (`hook.ts`, T045/T060):
 * checkpoint, `change()`, `doc.validate`, the key diff, accept or rollback with the `rejected`
 * envelope and the strike counter of `strikeKey`. A `ToolError` thrown by `change()` is a
 * rejected attempt too (review C4): the hook rolls back, counts the strike and returns the
 * envelope. The result is the change's success value or an error envelope.
 */
export type ChangeHook = <T extends object>(
  strikeKey: string,
  change: () => Promise<T>,
  options?: ChangeHookOptions,
) => Promise<T | ToolErrorEnvelope>;

export interface ChangeHookOptions {
  /**
   * The Source text path (US5, ai-catalogue §8.1): the change spliced the session's Source
   * text; the hook validates that text (`doc.validate({text})`) instead of the copy.
   */
  textPath?: boolean;
}

/** Why a tool is unavailable right now: the `unavailable` envelope's message and hint (§8). */
export interface ToolGate {
  message: string;
  hint?: string;
}

/** The parsed form of `{xml}` content: the nodes without ids and whether they are inline. */
export interface ParsedFragment {
  nodes: FragmentResultNode[];
  inline: boolean;
}

/** A message of a registered prompt (the layouts of ai-catalogue §5). */
export interface PromptText {
  role: 'user' | 'assistant';
  text: string;
}

/** What the catalogue is bound to: one request's working copy and its surroundings. */
export interface CatalogueDeps {
  /** The request's working copy: read by the read tools, written by the change tools. */
  copy: WorkingCopy;
  /** The request's selection (the editor's at start, as it is - review C6). */
  selection: SelectionHolder;
  /** The §2.1 working context without `outline` (`context.ts`), refreshed on every call. */
  context(): Record<string, unknown>;
  /** Changes accepted so far in this request (`get_context`). */
  changesInThisRequest(): number;
  /** `Date.now()` at the request's start (`get_context.requestElapsedMs`). */
  startedAt: number;
  /** `doc.fragmentToXml({nodes})` of the core (ai-catalogue §3.8). */
  fragmentToXml(nodes: FragmentNode[]): Promise<string>;
  /** `doc.fragmentFromXml` of the core; rejects with the core's `RpcError` (1001 / 1201). */
  fragmentFromXml(
    xml: string,
    parent: { nodeId: string } | { element: string },
  ): Promise<ParsedFragment>;
  /** The request's `sc_<N>` allocator for every node that enters the copy (review C12). */
  nextNodeId(): string;
  /** The model's regular expressions, in a worker with the 2-second budget (review C15). */
  runRegex: RegexRunner;
  /**
   * The validity hook of the request (`hook.applyChange` bound to the session). Without one
   * (unit tests of the catalogue alone) a change is applied unchecked.
   */
  applyChange?: ChangeHook;
  /**
   * The UTF-16 units one tool result may carry before it is delivered in parts (the
   * pre-emptive rule of §3.7, computed by the request loop from a known context length);
   * `undefined` = results go whole (FR-053: the editor applies no limit of its own).
   */
  resultBudget?: () => number | undefined;
  /** The message layouts of the registered prompts (`context.ts`); a plain default otherwise. */
  promptMessages?: (
    name: 'selection_edit' | 'general',
    args: Record<string, unknown>,
  ) => PromptText[] | Promise<PromptText[]>;
  /**
   * The Source view's text path (US5 T070): `replace_selection` on a `source` selection
   * splices the replacement into the request's Source text as its pending text (a refused
   * range throws `notAllowed`); the hook's text-path validation decides (`ChangeHookOptions`).
   */
  replaceSourceText?: (xml: string) => Promise<{ from: number; to: number }>;
  /**
   * The gate of the Source view (US5, ai-catalogue §8): asked before every call with the
   * current selection; a non-null answer is returned as the `unavailable` envelope without the
   * tool running (no hook, no strike) - the restricted six of the text mode, the structured
   * change tools after a text-path change, `run_script` outside the Body view.
   */
  gate?: (name: string, selection: ModelSelection) => ToolGate | null;
  /**
   * The validity check of the working copy as it stands (`RequestSession.validate`:
   * `doc.validate({docId, document})`, recorded for the test hook; the Source text mode of US5
   * validates its text instead) - the `validate` tool (US4 T061). Without one (the catalogue
   * alone) the tool answers `unavailable`.
   */
  validate?: () => Promise<ValidationReport>;
  /**
   * How `validate` names its tables (feature 006, Δ§3.1): `text` while it validates the Source
   * text (paths and lines), `document` otherwise (the default).
   */
  validateForm?: () => 'document' | 'text';
  /** The request's baseline (data-model §7.2): the error keys before the request with their counts. */
  baseline?: () => IssueMultiset;
  /**
   * `schema.text()` of the core (rpc-api §3.13): the five XSD files and the licence notice.
   * Fetched once per catalogue instance and cached (the `get_schema` tool and the
   * `fb2://schema/*` resources, US4 T061). Without one the tool answers `unavailable`.
   */
  schemaText?: () => Promise<SchemaTextResult>;
  /**
   * The scripts of the editor (US6 T075-T077): the effective list, a package's files, the
   * nested run, the proposal dialog and the write. Without one every script tool answers
   * `unavailable` (the catalogue alone, in unit tests).
   */
  scripts?: ScriptsDeps;
}

/** A script of the effective layers as the catalogue lists it (`list_scripts`, ai-catalogue §3.1). */
export interface CatalogueScript {
  id: string;
  /** The display name in the UI language (`en` fallback). */
  name: string;
  description?: string;
  kind: 'menu' | 'tree';
  needsSelection: boolean;
  group: string;
  /** The layer: `bundled` | `user` | `settings` | `portable`. */
  source: string;
  /** The package folder (absolute). */
  folder: string;
}

/** One file of a package as `read_script` reads it: the text, or a binary's size alone. */
export type ScriptFileContent = { content: string } | { binary: true; bytes?: number };

/** The end of a nested script run as the host reports it (data-model §6.6). */
export type NestedRunOutcome =
  | { status: 'done'; document: Document | null; durationMs: number }
  | { status: 'failed'; message: string; durationMs: number }
  | { status: 'cancelled'; durationMs: number }
  | { status: 'unavailable'; message: string };

/** The user's decision on a proposal, as the tool reports it to the model (ai-catalogue §3.4). */
export type ProposalDecision =
  | { written: true; id: string; path: string; warnings: string[]; runRequested: boolean }
  | { written: false; declined: true };

/** The scripts surface the request loop binds (`CatalogueDeps.scripts`). */
export interface ScriptsDeps {
  /** The effective list, fresh (`scripts.list` through the scripts feature), with the loader's issues. */
  list(): Promise<{ scripts: CatalogueScript[]; issues: string[] }>;
  /** `scripts.source`: the package folder, its entry and every file's path within the package. */
  files(id: string): Promise<{ folder: string; entry: string; files: string[] }>;
  /** `GET /scripts/{id}/{file}` with the session token. */
  readFile(id: string, file: string): Promise<ScriptFileContent>;
  /** `scripts.reload` and the feature's refresh: the count and the issues afterwards. */
  reload(): Promise<{ count: number; issues: string[] }>;
  /** True while the Body view is active - scripts run there only (review C8). */
  bodyView(): boolean;
  /** `app.info().dataDir`: the root of the user scripts folder the dialog names in full. */
  dataDir(): Promise<string>;
  uiLanguage(): string;
  /**
   * The nested run (T076; data-model §6.6): `ScriptHost.run` on the request's working copy;
   * the caller takes the result document over (`copy.reset`).
   */
  run(
    script: CatalogueScript,
    treeNode?: { nodeId: string; type: string },
  ): Promise<NestedRunOutcome>;
  /** The FR-084 gate (review C9): false for a script written in this conversation without the user's go. */
  runAllowed(id: string): boolean;
  /**
   * The proposal dialog and, after *Write* / *Write and run*, `scripts.write` (T077, §7.3-§7.5);
   * rejects with the core's `RpcError` when the write fails.
   */
  propose(proposal: ScriptProposal): Promise<ProposalDecision>;
}

/* ------------------------------------------------------------------------ */
/* The public object                                                        */
/* ------------------------------------------------------------------------ */

/** One entry of the service's `tools` array (ai-catalogue §1.5). */
export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** The outcome of one tool call as the request loop uses it (the text goes to the model). */
export interface ToolCallOutcome {
  /** `JSON.stringify(structuredContent)` - the `tool` message content. */
  text: string;
  /** The tool's result object or the error envelope. */
  result: Record<string, unknown>;
  isError: boolean;
  /** The envelope's body when the call failed. */
  error?: ToolErrorBody;
}

export interface Catalogue {
  server: McpServer;
  client: Client;
  /** The MCP `tools/list` as the client received it (the §3 order). */
  listed(): Tool[];
  /** The service's `tools` array, built once per instance. */
  tools(): OpenAiTool[];
  /** Calls a tool with the model's arguments (a JSON string or an object), never throws. */
  call(
    name: string,
    args: string | Record<string, unknown> | null | undefined,
  ): Promise<ToolCallOutcome>;
  /**
   * Binds the instance to another request's working copy and surroundings (data-model §8.5:
   * one instance per turn-on, re-bound to each request - T055). The tools, the server and the
   * client stay; every later call reads `deps`.
   */
  rebind(deps: CatalogueDeps): void;
  /** Drops the client and the server (turn-off). */
  close(): Promise<void>;
}

/** `{type: 'function', function: {name, description, parameters}}` with `$schema` stripped. */
export function toOpenAiTools(
  tools: readonly Pick<Tool, 'name' | 'description' | 'inputSchema'>[],
): OpenAiTool[] {
  return tools.map((tool) => {
    const { $schema: _schema, ...parameters } = tool.inputSchema as Record<string, unknown>;
    void _schema;
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description ?? '', parameters },
    };
  });
}

/**
 * The `tools` and `tool_choice` members of a chat request (ai-catalogue §1.5): the array with
 * `tool_choice: 'auto'` when the service entry offers tools, **no member at all** (never
 * `tools: []`) for an entry with `tools: false`.
 */
export function chatToolsMembers(
  tools: readonly OpenAiTool[],
  offered: boolean,
): { tools: OpenAiTool[]; tool_choice: 'auto' } | Record<string, never> {
  return offered && tools.length > 0 ? { tools: [...tools], tool_choice: 'auto' } : {};
}

/**
 * Builds a catalogue instance: server, client and transport pair, connected, bound to `deps`
 * (one request's working copy) until `rebind` binds it to the next request's.
 */
export async function createCatalogue(deps: CatalogueDeps): Promise<Catalogue> {
  const server = new McpServer({ name: 'mfbe-ai-catalogue', version: String(CATALOGUE_VERSION) });
  const context = new ToolContext(deps);
  registerReadTools(server, context);
  registerSchemaTools(server, context);
  registerScriptReadTools(server, context);
  registerTableReadTools(server, context);
  registerSelectionTools(server, context);
  registerChangeTools(server, context);
  registerTableChangeTools(server, context);
  registerScriptTools(server, context);
  registerSchemaResources(server, context);
  registerScriptResources(server, context);
  registerPrompts(server, () => context.deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'mfbe-ai-assistant', version: String(CATALOGUE_VERSION) });
  await client.connect(clientTransport);
  const listed = (await client.listTools()).tools;
  const openAiTools = toOpenAiTools(listed);
  const names = listed.map((tool) => tool.name);
  const schemaOf = new Map(listed.map((tool) => [tool.name, stripSchema(tool.inputSchema)]));

  const call: Catalogue['call'] = async (name, args) => {
    let parsed: Record<string, unknown> = {};
    if (typeof args === 'string' && args.trim()) {
      try {
        const value: unknown = JSON.parse(args);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        } else {
          return failure(
            new ToolError('invalidArguments', 'the arguments must be a JSON object', {
              expected: schemaOf.get(name),
            }),
          );
        }
      } catch (error) {
        return failure(
          new ToolError(
            'invalidArguments',
            `the arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            { expected: schemaOf.get(name) },
          ),
        );
      }
    } else if (args && typeof args === 'object') {
      parsed = args;
    }
    if (!names.includes(name)) {
      return failure(
        new ToolError('unknownTool', `No tool named "${name}".`, {
          hint: `The tools are: ${names.join(', ')}.`,
        }),
      );
    }
    // The Source view's gate (US5, §8): an `unavailable` result, nothing runs, no strike.
    const gate = context.deps.gate;
    if (gate) {
      const closed = gate(name, context.deps.selection.get());
      if (closed) {
        return failure(
          new ToolError('unavailable', closed.message, closed.hint ? { hint: closed.hint } : {}),
        );
      }
    }
    let result: CallToolResult;
    try {
      result = await client.callTool({ name, arguments: parsed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        return failure(
          new ToolError('unknownTool', `No tool named "${name}".`, {
            hint: `The tools are: ${names.join(', ')}.`,
          }),
        );
      }
      if (/validation error/i.test(message) || (error as { code?: number }).code === -32602) {
        return failure(
          new ToolError('invalidArguments', message, { expected: schemaOf.get(name) }),
        );
      }
      return failure(new ToolError('internal', message));
    }
    const text = result.content.map((item) => (item.type === 'text' ? item.text : '')).join('');
    if (result.isError && !isToolErrorEnvelope(result.structuredContent)) {
      // The SDK's own argument validation (`-32602 Input validation error: …`, §1.4).
      const isValidation = /validation error|-32602/i.test(text);
      return failure(
        new ToolError(isValidation ? 'invalidArguments' : 'internal', text, {
          ...(isValidation ? { expected: schemaOf.get(name) } : {}),
        }),
      );
    }
    const structured =
      result.structuredContent && typeof result.structuredContent === 'object'
        ? (result.structuredContent as Record<string, unknown>)
        : safeParse(text);
    if (isToolErrorEnvelope(structured)) {
      return { text, result: structured, isError: true, error: structured.error };
    }
    return { text, result: structured, isError: false };
  };

  return {
    server,
    client,
    listed: () => listed,
    tools: () => openAiTools,
    call,
    rebind: (next) => {
      context.deps = next;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = schema;
  void _schema;
  return rest;
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : { value };
  } catch {
    return { text };
  }
}

function failure(error: ToolError): ToolCallOutcome {
  const envelope = error.envelope();
  return { text: JSON.stringify(envelope), result: envelope, isError: true, error: envelope.error };
}

/* ------------------------------------------------------------------------ */
/* Registration helpers                                                     */
/* ------------------------------------------------------------------------ */

export type AnyObject = Record<string, unknown>;

/** An MCP result for a structured value; an envelope sets `isError`. */
function toolResult(value: AnyObject): CallToolResult {
  const isError = isToolErrorEnvelope(value);
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

interface ToolSpec<I extends z.ZodObject> {
  title: string;
  description: string;
  inputSchema: I;
  outputSchema?: z.ZodType;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

/** Registers one tool: the handler returns the result object or throws a `ToolError`. */
export function defineTool<I extends z.ZodObject>(
  server: McpServer,
  name: string,
  spec: ToolSpec<I>,
  handler: (args: z.infer<I>) => Promise<AnyObject> | AnyObject,
): void {
  if (!TOOL_NAME_RULE.test(name)) throw new Error(`catalogue: bad tool name "${name}"`);
  if (spec.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`catalogue: the description of "${name}" is too long`);
  }
  server.registerTool(
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      ...(spec.outputSchema ? { outputSchema: spec.outputSchema } : {}),
      annotations: spec.annotations,
    },
    (async (args: z.infer<I>) => {
      try {
        return toolResult(await handler(args));
      } catch (error) {
        return toolResult(toEnvelope(error));
      }
    }) as never,
  );
}

/** Any thrown value as an envelope: a `ToolError` as it is, the rest as `internal`. */
function toEnvelope(error: unknown): ToolErrorEnvelope {
  if (error instanceof ToolError) return error.envelope();
  if (error instanceof RpcError) return fragmentError(error).envelope();
  return {
    error: {
      code: 'internal',
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    },
  };
}

/** The core's fragment errors as envelopes (ai-catalogue §3.8; rpc-api §3.2). */
export function fragmentError(error: RpcError): ToolError {
  const data = (error.data ?? {}) as Partial<AiFragmentNotAllowedData> & {
    line?: number;
    column?: number;
    message?: string;
    field?: string;
  };
  if (error.code === 1001) {
    const detail = data.message ?? error.message;
    // The parse stage (data-model §7.3): the refusal in the `ErrorForModel` form too, with
    // the parser's line (the fragment's own) and no element.
    const issue: ErrorForModel = { code: 'xml.notWellFormed', element: '', message: detail };
    if (typeof data.line === 'number' && data.line > 0) issue.line = data.line;
    return new ToolError('invalidXml', `The XML is not well-formed: ${detail}`, {
      ...(data.line !== undefined ? { line: data.line } : {}),
      ...(data.column !== undefined ? { column: data.column } : {}),
      hint: invalidXmlHint(detail),
      issues: [issue],
    });
  }
  if (error.code === 1201) {
    const element = data.element ?? '';
    const parent = data.parent ?? '';
    const message = `The element "${element || '?'}" is not allowed inside "${parent || '?'}".`;
    return new ToolError('fragmentNotAllowed', message, {
      element,
      parent,
      hint: 'Use get_schema with the parent element to see what it may contain; return the elements that replace the selection, without a document wrapper.',
      issues: [{ code: 'schema.invalid', element, message }],
    });
  }
  if (error.code === -32602) {
    return new ToolError('invalidArguments', error.message, {
      ...(data.field ? { field: data.field } : {}),
    });
  }
  return new ToolError('internal', `${error.code}: ${error.message}`, { rpcCode: error.code });
}

/* ------------------------------------------------------------------------ */
/* Schemas shared by the tools                                              */
/* ------------------------------------------------------------------------ */

const nodeReference = (what: string) =>
  z
    .string()
    .min(1)
    .describe(
      `${what}: a nodeId (such as n42) or a structural path (such as body[1]/section[2]/p[3])`,
    );
export const cursorArg = z.string().optional().describe('more.cursor of the previous part');
export const formatArg = z
  .enum(['text', 'fb2xml'])
  .default('text')
  .describe('"text" (default) or "fb2xml"');
const flag = (what: string) => z.union([z.stringbool(), z.boolean()]).optional().describe(what);

export const nodeInfoSchema = z.looseObject({
  id: z.string(),
  path: z.string(),
  type: z.string(),
  characters: z.number().optional(),
});
const moreSchema = z
  .looseObject({
    cursor: z.string(),
    remaining: z.looseObject({}),
    hint: z.string(),
  })
  .optional();

/* ------------------------------------------------------------------------ */
/* The shared machinery of the handlers                                     */
/* ------------------------------------------------------------------------ */

/**
 * The continuation cursor of a call, decoded and checked against the form the tool issues
 * (`after:<nodeId>` for the node-based parts, `offset:<n>` for `find`): anything else is
 * `invalidArguments` with the hint to pass `more.cursor` unchanged.
 */
function cursorOf<K extends Cursor['kind']>(text: string, kind: K): Extract<Cursor, { kind: K }> {
  const cursor = decodeCursor(text);
  if (!cursor || cursor.kind !== kind) {
    throw new ToolError('invalidArguments', `unknown cursor "${text}"`, {
      hint: 'Pass more.cursor of the previous part unchanged.',
    });
  }
  return cursor as Extract<Cursor, { kind: K }>;
}

/** The fixed cost of a part's envelope (its node infos and members) against the budget. */
const PART_ENVELOPE_UNITS = 240;

/** A pre-check refusal in the `ErrorForModel` form (data-model §7.3): element, path, no line. */
function preCheckIssue(element: string, message: string, path?: string): ErrorForModel {
  const issue: ErrorForModel = { code: 'schema.invalid', element, message };
  if (path) issue.path = path;
  return issue;
}

/** The generated element table (resource-formats §12; T023): children, attributes, text. */
const FB2_ELEMENTS: Fb2Elements = fb2ElementsJson;

/** One line of a schema file as the whole-schema answer is cut (ai-catalogue §3.1, §3.7). */
interface SchemaLine {
  file: string;
  line: number;
  text: string;
}

export class ToolContext {
  /** The binding of the moment (`Catalogue.rebind` swaps it between requests). */
  deps: CatalogueDeps;
  /** `schema.text()` once per instance (ai-catalogue §4: read lazily, cached while the assistant is on). */
  private schemaCache: Promise<SchemaTextResult> | null = null;
  /** Told once the schema text is known (the resources add the notice to their descriptions). */
  onSchemaLoaded: ((schema: SchemaTextResult) => void) | null = null;

  constructor(deps: CatalogueDeps) {
    this.deps = deps;
  }

  get document(): Document {
    return this.deps.copy.document;
  }

  /** The schema files and the notice, fetched on the first call and cached; `unavailable` without the RPC. */
  schema(): Promise<SchemaTextResult> {
    if (this.schemaCache) return this.schemaCache;
    const fetch = this.deps.schemaText;
    if (!fetch) {
      return Promise.reject(
        new ToolError('unavailable', 'The schema text is not available in this context.'),
      );
    }
    const loading = fetch().then((schema) => {
      this.onSchemaLoaded?.(schema);
      return schema;
    });
    this.schemaCache = loading;
    loading.catch(() => {
      // A failed fetch is not cached: the next call tries again.
      if (this.schemaCache === loading) this.schemaCache = null;
    });
    return loading;
  }

  /** The scripts surface (US6); `unavailable` without one (the catalogue alone). */
  requireScripts(): ScriptsDeps {
    const scripts = this.deps.scripts;
    if (!scripts) {
      throw new ToolError('unavailable', 'The scripts are not available in this context.');
    }
    return scripts;
  }

  /** One script of the effective list by id; `invalidArguments` with the id list as the hint. */
  async scriptById(
    scripts: ScriptsDeps,
    id: string,
  ): Promise<{ script: CatalogueScript; all: CatalogueScript[] }> {
    const { scripts: all } = await scripts.list();
    const script = all.find((entry) => entry.id === id);
    if (!script) {
      throw new ToolError('invalidArguments', `No script with the id "${id}".`, {
        hint: `The scripts are: ${all.map((entry) => entry.id).join(', ')}.`,
        expected: { id: all.map((entry) => entry.id) },
      });
    }
    return { script, all };
  }

  /**
   * The `validate` tool (ai-catalogue §3.1; FR-065): the working copy validated now and its
   * errors split by the multiset rule of the hook into the ones this request introduced
   * (`newErrors` - any makes `ok` false) and the ones the book already had (`preExistingErrors`).
   */
  async validateNow(): Promise<AnyObject> {
    const validate = this.deps.validate;
    if (!validate) {
      throw new ToolError('unavailable', 'Validation is not available in this context.');
    }
    const report = await validate();
    const baseline = this.deps.baseline?.() ?? new Map<string, number>();
    const current = multiset(report.issues);
    const excess = new Set<string>();
    for (const [key, count] of current) {
      if (count > (baseline.get(key) ?? 0)) excess.add(key);
    }
    const errors = report.issues.filter((issue) => issue.severity === 'error');
    const fresh = errors.filter((issue) => excess.has(issueKey(issue))).map(errorForModel);
    const preExisting = errors.filter((issue) => !excess.has(issueKey(issue))).map(errorForModel);
    return {
      ok: fresh.length === 0,
      newErrors: fresh,
      preExistingErrors: preExisting,
      warnings: report.warningCount,
      durationMs: report.durationMs,
      // Feature 006 (FR-062; Δ§3.1): every table.irregular warning, in the report's form.
      irregularTables: irregularTablesOf(
        report,
        this.deps.validateForm?.() ?? 'document',
        this.index,
      ),
    };
  }

  /**
   * The whole schema (ai-catalogue §3.1 `get_schema` without `element`): the five files and the
   * notice, whole without a budget, else in parts of whole lines with a `<file>:<line>` cursor.
   */
  async wholeSchema(cursor?: string): Promise<AnyObject> {
    const schema = await this.schema();
    const limit = this.budget();
    if (limit === undefined && !cursor) return { files: schema.files, notice: schema.notice };
    let lines: SchemaLine[] = schema.files.flatMap((file) =>
      file.text.split('\n').map((text, line) => ({ file: file.name, line, text })),
    );
    if (cursor) {
      const at = cursorOf(cursor, 'line');
      const index = lines.findIndex((l) => l.file === at.file && l.line === at.line);
      if (index < 0) throw new ToolError('invalidArguments', `unknown cursor "${cursor}"`);
      lines = lines.slice(index);
    }
    const { taken, rest } = partition(lines, {
      sizeOf: (l) => l.text.length + 1,
      limit,
      fixed: schema.notice.length + 200,
      strict: false,
    });
    const files: { name: string; text: string; partial?: true }[] = [];
    for (const line of taken) {
      const last = files[files.length - 1];
      if (last && last.name === line.file) last.text += `\n${line.text}`;
      else files.push({ name: line.file, text: line.text });
    }
    const totals = new Map(schema.files.map((f) => [f.name, f.text.split('\n').length]));
    for (const file of files) {
      if (file.text.split('\n').length !== totals.get(file.name)) file.partial = true;
    }
    const out: AnyObject = { files, notice: schema.notice };
    const next = rest[0];
    if (next) {
      out.more = moreOf(
        'get_schema',
        { kind: 'line', file: next.file, line: next.line },
        { lines: rest.length, files: new Set(rest.map((l) => l.file)).size },
      );
    }
    return out;
  }

  /**
   * One element's content model (ai-catalogue §3.1 `get_schema` with `element`; rpc-api §3.13
   * `SchemaElementResult`) from the generated table alone - the core's reserved
   * `schema.element` is never called in 0.0.5 (R6). An unknown name is a result, not an error.
   */
  elementSchema(element: string): AnyObject {
    const name = element.trim().replace(/^.*:/, '');
    const info = FB2_ELEMENTS.elements[name];
    if (!info) return { known: false, name };
    const attributes = (info.attributes ?? []).map((attribute) => ({ ...attribute }));
    const out: AnyObject = {
      known: true,
      name,
      children: info.children.map((child) => ({ name: child })),
      attributes,
      text: info.text ?? false,
    };
    if (attributes.some((attribute) => attribute.name.startsWith('xlink:'))) {
      out.note =
        'In FictionBook files the xlink attributes are written with the l: prefix (l:href, l:type).';
    }
    return out;
  }

  get index(): DocIndex {
    return indexDocument(this.document);
  }

  /** `deps.resultBudget()` as the bound of one part; `undefined` = results go whole (FR-053). */
  budget(): number | undefined {
    const value = this.deps.resultBudget?.();
    return value !== undefined && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : undefined;
  }

  /** The baseline's error count the context reports (`set_description`'s `validation`). */
  preExistingErrors(): number {
    const value = this.deps.context().preExistingErrors;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /**
   * Resolves a node reference without failing: the entry, or `null` for an unknown one (the
   * strike key of a change tool names the resolved id, else the reference as given - §3.5).
   */
  lookup(reference: string): Entry | null {
    return resolveReference(this.index, reference);
  }

  /** The strike target of a node reference: its resolved id, else the reference as given. */
  targetOf(reference: string): string {
    const entry = this.lookup(reference);
    return entry ? nodeIdOf(entry.node) || reference : reference;
  }

  /** Resolves a node reference (path or id) or fails with `unknownNode`. */
  resolve(reference: string, what = 'node'): Entry {
    const entry = resolveReference(this.index, reference);
    if (!entry) {
      const message = `No node ${reference} in the document (${what}).`;
      throw new ToolError('unknownNode', message, {
        hint: UNKNOWN_NODE_HINT,
        issues: [{ code: 'unknownNode', element: '', path: reference, message }],
      });
    }
    return entry;
  }

  entryOf(nodeId: string): Entry | null {
    return this.index.byId.get(nodeId) ?? null;
  }

  /** The point's node as an entry, or `unknownNode`. */
  pointEntry(point: ModelPoint, what: string): Entry {
    const entry = this.entryOf(point.nodeId);
    if (!entry) {
      throw new ToolError('unknownNode', `No node ${point.nodeId} in the document (${what}).`, {
        hint: UNKNOWN_NODE_HINT,
      });
    }
    return entry;
  }

  /** The parent's `{nodeId}` for a core node, `{element}` for a UI-issued one (rpc-api §3.2). */
  parentReference(
    entry: Entry | null,
    fallbackElement: string,
  ): { nodeId: string } | { element: string } {
    if (!entry) return { element: fallbackElement };
    const id = nodeIdOf(entry.node);
    return /^n\d+$/.test(id) ? { nodeId: id } : { element: entry.node.type };
  }

  xmlOf(nodes: readonly ModelNodeJson[]): Promise<string> {
    if (nodes.length === 0) return Promise.resolve('');
    return this.deps.fragmentToXml(nodes as unknown as FragmentNode[]);
  }

  /** Parses `{xml}` content in the parent's context (fences and whitespace tolerated, §3.8). */
  async parseXml(
    xml: string,
    parent: { nodeId: string } | { element: string },
  ): Promise<ParsedFragment> {
    const text = stripFences(xml);
    if (!text) throw new ToolError('invalidArguments', 'the xml is empty');
    try {
      return await this.deps.fragmentFromXml(text, parent);
    } catch (error) {
      if (error instanceof RpcError) throw fragmentError(error);
      throw error;
    }
  }

  /** Gives every structural node of a parsed fragment an `sc_<N>` id (review C12). */
  assignIds<N extends ModelNodeJson>(node: N): N {
    if (node.type === 'text') return node;
    const attrs = { ...(node.attrs ?? {}) };
    if (typeof attrs.nodeId !== 'string' || !attrs.nodeId) attrs.nodeId = this.deps.nextNodeId();
    const content = node.content?.map((child) => this.assignIds(child));
    return { ...node, attrs, ...(content ? { content } : {}) };
  }

  /** The ProseMirror pre-check of a node (`createChecked` on every level): `invalidNode` when it fails. */
  preCheck(node: ModelNodeJson, what: string): void {
    const report = createReport();
    const built = nodeFromModel(node, report);
    if (!built) throw new ToolError('invalidNode', `${what}: cannot build a "${node.type}" node`);
    const problem = report.problems[0];
    if (problem) {
      throw new ToolError(
        'invalidNode',
        `${what}: invalid node at "${problem.path}": ${problem.message}` +
          (report.problems.length > 1 ? ` (and ${report.problems.length - 1} more)` : ''),
      );
    }
  }

  /**
   * Runs a change under the hook; without one (the catalogue alone, in unit tests) the change
   * is applied unchecked, still bracketed by a checkpoint so that a refused change leaves the
   * copy as it was and every change starts from a fresh root (the index cache is per root).
   */
  async change<T extends AnyObject>(
    strikeKey: string,
    run: () => Promise<T>,
    options?: ChangeHookOptions,
  ): Promise<T | ToolErrorEnvelope> {
    const hook = this.deps.applyChange;
    if (hook) return hook(strikeKey, run, options);
    const checkpoint = this.deps.copy.checkpoint();
    try {
      return await run();
    } catch (error) {
      this.deps.copy.rollback(checkpoint);
      return toEnvelope(error);
    }
  }

  /**
   * Content of a change tool: exactly one of the given forms (`{xml}` or `{node}` / `{nodes}`),
   * else `invalidArguments` naming the forms.
   */
  contentForm<F extends string>(
    content: Partial<Record<F, unknown>> | undefined,
    forms: readonly F[],
  ): F {
    const present = forms.filter((form) => content?.[form] !== undefined);
    if (present.length !== 1) {
      throw new ToolError(
        'invalidArguments',
        `content must hold exactly one of ${forms.map((f) => `{${f}}`).join(' or ')}`,
        {
          expected: {
            content: Object.fromEntries(
              forms.map((f) => [f, f === 'xml' ? 'FictionBook XML' : 'Document JSON']),
            ),
          },
        },
      );
    }
    return present[0]!;
  }

  /**
   * One block or structural node of a change tool's `{node}` JSON, with ids: an object with a
   * string `type` other than `text` (`invalidArguments` otherwise); `keepId` sets the top
   * node's id (`replace_node`: the replaced node keeps its id), every other structural node
   * gets a fresh `sc_<N>` (review C12).
   */
  jsonNode(value: unknown, what: string, keepId?: string): ModelNodeJson {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ToolError(
        'invalidArguments',
        `${what}: expected a node object {type, attrs?, content?}`,
        {
          expected: { type: 'p', content: [{ type: 'text', text: '…' }] },
        },
      );
    }
    const json = value as ModelNodeJson;
    if (typeof json.type !== 'string' || !json.type) {
      throw new ToolError('invalidArguments', `${what}: node.type is required`);
    }
    if (json.type === 'text') {
      throw new ToolError('invalidArguments', `${what}: a text node cannot stand alone`, {
        hint: 'Wrap the text in a text container such as <p>, or use set_text on an existing one.',
      });
    }
    const assigned = this.assignIds(stripIds(json));
    if (keepId) assigned.attrs = { ...(assigned.attrs ?? {}), nodeId: keepId };
    return assigned;
  }

  /**
   * The script API's `nodeFromScript` check of a node that enters the copy (`createChecked`
   * on every level, `invalidNode` with the offending path) - the node as the editor's
   * canonical JSON (`nodeToModel` of the checked ProseMirror node, ids kept).
   */
  checkedNode(node: ModelNodeJson, what: string, path?: string): ModelNodeJson {
    const report = createReport();
    const built = nodeFromModel(node, report);
    if (!built) {
      const message = `cannot build a "${node.type}" node`;
      throw new ToolError('invalidNode', `${what}: ${message}`, {
        issues: [preCheckIssue(node.type, message, path)],
      });
    }
    const problem = report.problems[0];
    if (problem) {
      // The pre-check stage (data-model §7.3): every problem in the `ErrorForModel` form -
      // `element` = the type at the problem's path, `path` = the target's structural path
      // joined with the problem's path inside the node, no `line`.
      const issues = report.problems.map((p) => {
        const element =
          p.path
            .split('/')
            .pop()
            ?.replace(/\[\d+\]$/, '') || node.type;
        return preCheckIssue(element, p.message, path ? `${path}/${p.path}` : p.path);
      });
      const more = report.problems.length - 1;
      throw new ToolError(
        'invalidNode',
        `${what}: invalid node at "${problem.path}": ${problem.message}` +
          (more > 0 ? ` (and ${more} more problem${more === 1 ? '' : 's'})` : ''),
        {
          hint: 'Use get_schema with the element to see its content model and attributes.',
          issues,
        },
      );
    }
    return nodeToModel(built);
  }

  /** An entry's parent as a container: its schema type (the `doc` for a body) and its name. */
  parentOf(entry: Entry): Container {
    return entry.parent
      ? containerOf(entry.parent.node)
      : { type: fb2Schema.nodes.doc!, name: 'FictionBook' };
  }

  /**
   * `contentFits` of the script API as a pre-check: the container's children with `[index,
   * index + replaced)` replaced by the given nodes must still match its content expression,
   * else `notAllowed` naming the pair and the content model (§3.3 `remove_node`'s hint).
   * `place` words where the nodes would go (`in place of this "p"`, `after this "p"`, `as its
   * last child`) or, for a removal, what would go (`this "p"`).
   */
  requireFits(
    container: Container,
    children: readonly ModelNodeJson[],
    index: number,
    replaced: number,
    inserted: readonly ModelNodeJson[],
    what: string,
    place: string,
    path?: string,
  ): void {
    const types = inserted.map((node) => nodeTypeFor(node.type, false) ?? fb2Schema.nodes.raw_xml!);
    if (contentFits(container.type, children, index, replaced, types)) return;
    // A parent whose children already break its content expression (a pre-existing error of
    // the book, FR-062) is not judged here: the schema pass of the hook decides by the key
    // diff whether the change adds an error or merely moves the old one (review C3).
    if (!contentFits(container.type, children, 0, 0, [])) return;
    const model = contentModelOf(container.type);
    const verb =
      inserted.length === 0
        ? `does not allow removing ${place}`
        : `does not allow ${describeTypes(inserted)} ${place}`;
    const message = `"${container.name}" ${verb}.`;
    throw new ToolError('notAllowed', `${what}: ${message}`, {
      hint: `The content model of "${container.name}" is: ${model || 'any content'}; the order and the number of children matter.`,
      contentModel: model,
      // The pre-check stage (data-model §7.3): the refusal in the `ErrorForModel` form -
      // the element that does not fit (the first one offered, or the container for a removal).
      issues: [preCheckIssue(inserted[0]?.type ?? container.name, message, path)],
    });
  }

  /** The description as `get_description` returns it: annotation, history and outputs as `{xml}`. */
  async describe(description: Description = this.document.description): Promise<AnyObject> {
    const xmlOf = async (node: ModelNodeJson | undefined) =>
      node ? { xml: await this.xmlOf(node.content ?? []) } : undefined;
    const titleInfo = async (info: typeof description.titleInfo) => {
      const { annotation, ...rest } = info;
      const xml = await xmlOf(annotation as unknown as ModelNodeJson | undefined);
      return { ...rest, ...(xml ? { annotation: xml } : {}) };
    };
    const { history, ...documentInfoRest } = description.documentInfo;
    const historyXml = await xmlOf(history as unknown as ModelNodeJson | undefined);
    return {
      titleInfo: await titleInfo(description.titleInfo),
      ...(description.srcTitleInfo
        ? { srcTitleInfo: await titleInfo(description.srcTitleInfo) }
        : {}),
      documentInfo: { ...documentInfoRest, ...(historyXml ? { history: historyXml } : {}) },
      ...(description.publishInfo ? { publishInfo: description.publishInfo } : {}),
      customInfo: description.customInfo,
      outputs: description.outputs.map((output: RawXmlNode) => ({ xml: output.attrs.xml })),
    };
  }

  /* --------------------------------------------------------- selection */

  selection(): ModelSelection {
    return this.deps.selection.get();
  }

  /**
   * The selection summary of `get_selection` (ai-catalogue §3.1) for the current selection,
   * in the given format; `blocks` renders a partial first / last block as a complete element
   * holding only the selected part (review C6).
   */
  async selectionSummary(format: 'text' | 'fb2xml', cursor?: string): Promise<AnyObject> {
    const selection = this.selection();
    if (selection.kind === 'source') {
      return {
        kind: 'source',
        xml: selection.text,
        characters: selection.text.length,
        paragraphs: 0,
        hasInlineElements: false,
        anchor: { offset: selection.from },
        head: { offset: selection.to },
      };
    }
    if (selection.kind === 'cells') return this.cellsSummary(selection);
    const anchorEntry = this.pointEntry(selection.anchor, 'anchor');
    const headEntry = this.pointEntry(selection.head, 'head');
    const anchor = { node: nodeInfo(anchorEntry), offset: selection.anchor.offset };
    const head = { node: nodeInfo(headEntry), offset: selection.head.offset };
    if (selection.kind === 'none') {
      return { kind: 'none', characters: 0, paragraphs: 0, hasInlineElements: false, anchor, head };
    }
    if (selection.kind === 'inline') {
      const content = this.inlineSelection(selection, anchorEntry);
      const out: AnyObject = {
        kind: 'inline',
        characters: inlineText(content).length,
        paragraphs: 1,
        hasInlineElements: hasInlineElements(content),
        anchor,
        head,
        parent: nodeInfo(anchorEntry),
      };
      if (format === 'fb2xml') out.xml = await this.xmlOf(content as ModelNodeJson[]);
      else out.text = inlineText(content);
      return out;
    }
    const blocks = this.selectedBlocks(selection);
    const parentEntry = blocks.entries[0]!.parent;
    let units = blocks.rendered.map((node, i) => ({ node, entry: blocks.entries[i]! }));
    if (cursor) {
      const after = cursorOf(cursor, 'after').nodeId;
      const at = units.findIndex((u) => nodeIdOf(u.entry.node) === after);
      if (at < 0) throw new ToolError('invalidArguments', `unknown cursor "${cursor}"`);
      units = units.slice(at + 1);
    }
    // The units are the selected sibling blocks, whole (a partial first / last block is its
    // selected part rendered as a complete element); one that alone does not fit is tooLarge -
    // the request loop ends a selection request on it (FR-035).
    const { taken, rest } = partition(units, {
      sizeOf: (u) => estimateXmlSize(u.node),
      limit: this.budget(),
      fixed: PART_ENVELOPE_UNITS,
      strict: true,
    });
    if (taken.length === 0 && units.length > 0) {
      const first = units[0]!;
      throw new ToolError(
        'tooLarge',
        'A single block of the selection is larger than one answer admits.',
        {
          node: nodeInfo(first.entry),
          characters: characterCount(first.node),
        },
      );
    }
    const out: AnyObject = {
      kind: 'blocks',
      characters: blocks.rendered.reduce((sum, node) => sum + characterCount(node), 0),
      paragraphs: blocks.rendered.reduce((sum, node) => sum + countTextContainers(node), 0),
      hasInlineElements: blocks.rendered.some(hasInlineBelow),
      anchor,
      head,
      from: nodeInfo(blocks.entries[0]!),
      to: nodeInfo(blocks.entries[blocks.entries.length - 1]!),
      openStart: selection.openStart,
      openEnd: selection.openEnd,
      ...(parentEntry ? { parent: nodeInfo(parentEntry) } : {}),
    };
    if (format === 'fb2xml') {
      out.xml = await this.xmlOf(taken.map((u) => u.node));
    } else {
      out.text = taken.map((u) => plainTextOf(u.node)).join('\n');
    }
    if (rest.length > 0) {
      out.more = moreOf(
        'get_selection',
        { kind: 'after', nodeId: nodeIdOf(taken[taken.length - 1]!.entry.node) },
        {
          blocks: rest.length,
          characters: rest.reduce((sum, u) => sum + characterCount(u.node), 0),
        },
      );
    }
    return out;
  }

  /**
   * `get_selection` on a block of cells (feature 006, Δ§3.1): the table, the rectangle, the
   * sizes over its cells, anchor and head at offset 0 and the hint - no text or XML (`format` and
   * `cursor` are ignored); a block of a description field with its `source`.
   */
  cellsSummary(selection: Extract<ModelSelection, { kind: 'cells' }>): AnyObject {
    const tableEntry = this.entryOf(selection.table);
    if (!tableEntry) {
      throw new ToolError('unknownNode', `No node ${selection.table} in the document (table).`, {
        hint: UNKNOWN_NODE_HINT,
      });
    }
    const grid = gridOfModel(tableEntry.node as unknown as TableNode);
    const top = selection.row - 1;
    const left = selection.column - 1;
    const cells = grid.tooLarge
      ? []
      : grid.cellsIn({ top, left, bottom: top + selection.rows, right: left + selection.columns });
    let characters = 0;
    let inline = false;
    for (const index of cells) {
      const cell = grid.cells[index]!;
      const node = tableEntry.node.content?.[grid.rowChild[cell.row]!]?.content?.[cell.index];
      if (!node) continue;
      characters += characterCount(node);
      if (hasInlineElements((node.content ?? []) as InlineNode[])) inline = true;
    }
    return {
      kind: 'cells',
      table: nodeInfo(tableEntry),
      row: selection.row,
      column: selection.column,
      rows: selection.rows,
      columns: selection.columns,
      ...(selection.source ? { source: selection.source } : {}),
      characters,
      paragraphs: cells.length,
      hasInlineElements: inline,
      anchor: { node: nodeInfo(this.pointEntry(selection.anchor, 'anchor')), offset: 0 },
      head: { node: nodeInfo(this.pointEntry(selection.head, 'head')), offset: 0 },
      hint: CELLS_SELECTION_HINT,
    };
  }

  /** The inline content an `inline` selection covers. */
  inlineSelection(
    selection: Extract<ModelSelection, { kind: 'inline' }>,
    container: Entry,
  ): InlineNode[] {
    if (!TEXT_CONTAINERS.has(container.node.type)) {
      throw new ToolError(
        'internal',
        `the selection's container "${container.node.type}" is not a text container`,
      );
    }
    const content = (container.node.content ?? []) as InlineNode[];
    const size = containerSize(container.node);
    const from = clamp(selection.anchor.offset, size);
    const to = clamp(selection.head.offset, size);
    return sliceInline(content, Math.min(from, to), Math.max(from, to));
  }

  /**
   * The blocks of a `blocks` selection as entries and as the rendered slice: a partial first /
   * last text container holds only its selected part.
   */
  selectedBlocks(selection: Extract<ModelSelection, { kind: 'blocks' }>): {
    entries: Entry[];
    rendered: ModelNodeJson[];
  } {
    const entries = selection.nodeIds.map((id) =>
      this.pointEntry({ nodeId: id, offset: 0 }, 'blocks'),
    );
    if (entries.length === 0) throw new ToolError('noSelection', 'The selection lists no blocks.');
    const rendered = entries.map((entry) => entry.node);
    if (selection.openStart) {
      rendered[0] = this.pruned(entries[0]!, selection.anchor, 'after');
    }
    if (selection.openEnd) {
      const last = entries.length - 1;
      const base = last === 0 ? rendered[0]! : entries[last]!.node;
      rendered[last] = this.prunedNode(base, entries[last]!, selection.head, 'before');
    }
    return { entries, rendered };
  }

  /** `block` with the content before (`after` kept) / after (`before` kept) the point removed. */
  pruned(entry: Entry, point: ModelPoint, keep: 'after' | 'before'): ModelNodeJson {
    return this.prunedNode(entry.node, entry, point, keep);
  }

  prunedNode(
    node: ModelNodeJson,
    entry: Entry,
    point: ModelPoint,
    keep: 'after' | 'before',
  ): ModelNodeJson {
    if (TEXT_CONTAINERS.has(node.type)) {
      if (nodeIdOf(entry.node) !== point.nodeId) return node;
      const content = (node.content ?? []) as InlineNode[];
      const [before, after] = splitInline(content, clamp(point.offset, containerSize(node)));
      return { ...node, content: (keep === 'after' ? after : before) as ModelNodeJson[] };
    }
    // A container: keep the children from / up to the one holding the point, pruned itself.
    const children = childEntries(this.index, entry);
    const holder = children.findIndex((child) => this.contains(child, point.nodeId));
    if (holder < 0) return node;
    const kept =
      keep === 'after'
        ? children
            .slice(holder)
            .map((child, i) => (i === 0 ? this.pruned(child, point, keep) : child.node))
        : children
            .slice(0, holder + 1)
            .map((child, i, all) =>
              i === all.length - 1 ? this.pruned(child, point, keep) : child.node,
            );
    return { ...node, content: kept };
  }

  contains(entry: Entry, nodeId: string): boolean {
    if (nodeIdOf(entry.node) === nodeId) return true;
    return childEntries(this.index, entry).some((child) => this.contains(child, nodeId));
  }

  /**
   * Classifies two model points into a selection (`set_selection`, and the state after a
   * replacement): the same text container → `inline` / `none`; the same other node → that
   * node as one closed block; else the sibling blocks under the deepest common ancestor with
   * `openStart` / `openEnd` from where the points fall (review C6).
   */
  classify(anchor: ModelPoint, head: ModelPoint): ModelSelection {
    const a = this.pointEntry(anchor, 'anchor');
    const h = this.pointEntry(head, 'head');
    const clampTo = (point: ModelPoint, entry: Entry): ModelPoint => ({
      nodeId: point.nodeId,
      offset: TEXT_CONTAINERS.has(entry.node.type)
        ? clamp(point.offset, containerSize(entry.node))
        : 0,
    });
    const anchorC = clampTo(anchor, a);
    const headC = clampTo(head, h);
    if (a.node === h.node) {
      if (TEXT_CONTAINERS.has(a.node.type)) {
        return anchorC.offset === headC.offset
          ? { kind: 'none', anchor: anchorC, head: headC }
          : { kind: 'inline', anchor: anchorC, head: headC };
      }
      return {
        kind: 'blocks',
        anchor: anchorC,
        head: headC,
        nodeIds: [nodeIdOf(a.node)],
        openStart: false,
        openEnd: false,
      };
    }
    const common = commonParentBlocks(this.index, a, h);
    if (!common) {
      throw new ToolError(
        'notAllowed',
        'The two points lie in parts of the document that have no common parent.',
        {
          hint: 'Select within the bodies: both points in the bodies, or both in one annotation / history.',
        },
      );
    }
    const startPoint = this.contains(common.from, anchorC.nodeId) ? anchorC : headC;
    const endPoint = startPoint === anchorC ? headC : anchorC;
    const firstText = edgeTextContainer(this.index, common.from, 'first');
    const lastText = edgeTextContainer(this.index, common.to, 'last');
    // An end is closed when its point is the start of the first / the end of the last text
    // container of the edge block, or names a non-text block itself (a node selection).
    const atBlock = (point: ModelPoint, block: Entry) =>
      point.nodeId === nodeIdOf(block.node) && !TEXT_CONTAINERS.has(block.node.type);
    const openStart =
      !!firstText &&
      !atBlock(startPoint, common.from) &&
      !(startPoint.nodeId === nodeIdOf(firstText.node) && startPoint.offset === 0);
    const openEnd =
      !!lastText &&
      !atBlock(endPoint, common.to) &&
      !(
        endPoint.nodeId === nodeIdOf(lastText.node) &&
        endPoint.offset === containerSize(lastText.node)
      );
    return {
      kind: 'blocks',
      anchor: anchorC,
      head: headC,
      nodeIds: common.blocks.map((entry) => nodeIdOf(entry.node)),
      openStart,
      openEnd,
    };
  }
}

function clamp(offset: number, size: number): number {
  return Math.max(0, Math.min(Math.floor(Number(offset) || 0), size));
}

/** A node as the container of children: its schema type and its name as the model knows it. */
interface Container {
  type: NodeType;
  name: string;
}

function containerOf(node: ModelNodeJson): Container {
  return { type: nodeTypeFor(node.type) ?? fb2Schema.nodes.raw_xml!, name: node.type };
}

/** The content expression of a node type in FB2 names (`title? epigraph* image? …`). */
function contentModelOf(type: NodeType): string {
  return (type.spec.content ?? '').replace(/[a-z_]+/g, (name) => fb2NameFor(name));
}

/** The node JSON without any `nodeId` (ids are issued by the editor - review C12). */
function stripIds(node: ModelNodeJson): ModelNodeJson {
  if (node.type === 'text') return node;
  const { nodeId: _id, ...attrs } = node.attrs ?? {};
  void _id;
  const content = node.content?.map(stripIds);
  return { ...node, attrs, ...(content ? { content } : {}) };
}

/** Strips a leading ```xml / ```fb2 fence and a trailing fence, then trims (§3.8). */
export function stripFences(text: string): string {
  let out = text.trim();
  const open = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n/.exec(out);
  if (open) out = out.slice(open[0].length);
  if (out.endsWith('```')) out = out.slice(0, -3);
  return out.trim();
}

function countTextContainers(node: ModelNodeJson): number {
  if (node.type === 'text') return 0;
  let count = TEXT_CONTAINERS.has(node.type) ? 1 : 0;
  for (const child of node.content ?? []) count += countTextContainers(child);
  return count;
}

function hasInlineBelow(node: ModelNodeJson): boolean {
  if (node.type === 'text') return (node.marks?.length ?? 0) > 0;
  if (TEXT_CONTAINERS.has(node.type))
    return hasInlineElements((node.content ?? []) as InlineNode[]);
  return (node.content ?? []).some(hasInlineBelow);
}

function plainTextOf(node: ModelNodeJson): string {
  if (TEXT_CONTAINERS.has(node.type)) return inlineText((node.content ?? []) as InlineNode[]);
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'text') continue;
    const text = plainTextOf(child);
    if (text || TEXT_CONTAINERS.has(child.type)) parts.push(text);
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------------ */
/* Read tools (ai-catalogue §3.1)                                           */
/* ------------------------------------------------------------------------ */

function registerReadTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'get_context',
    {
      title: 'Refresh the working context',
      description:
        'Returns the working context of the system message without the outline, refreshed: the book title and language, the counts, the modified flag, the selection, the caret, the kind of request, the pre-existing error count, plus changesInThisRequest and requestElapsedMs. Use it after changes to see the current counts; use get_outline for the outline.',
      inputSchema: z.object({}),
      outputSchema: z.looseObject({
        catalogueVersion: z.number(),
        changesInThisRequest: z.number(),
        requestElapsedMs: z.number(),
      }),
      annotations: { readOnlyHint: true },
    },
    () => {
      const { outline: _outline, ...rest } = ctx.deps.context();
      void _outline;
      return {
        catalogueVersion: CATALOGUE_VERSION,
        ...rest,
        changesInThisRequest: ctx.deps.changesInThisRequest(),
        requestElapsedMs: Math.max(0, Date.now() - ctx.deps.startedAt),
      };
    },
  );

  defineTool(
    server,
    'get_outline',
    {
      title: 'Get the outline',
      description:
        'Returns the outline tree: every body with its sections, nested, each with id, structural path, title (whole), characters, paragraphs and images. Without arguments the whole book; with node (a body or section) that node and its descendants; depth limits the nesting (1 = the entry alone). A large outline comes in parts: pass more.cursor back to get the next part.',
      inputSchema: z.object({
        node: nodeReference('a body or a section').optional(),
        depth: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('levels to include (default: unlimited)'),
        cursor: cursorArg,
      }),
      outputSchema: z.looseObject({
        entries: z.array(z.looseObject({ id: z.string(), path: z.string() })),
        more: moreSchema,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) => {
      let entries: OutlineEntry[];
      if (args.node) {
        const entry = ctx.resolve(args.node);
        if (entry.node.type !== 'body' && entry.node.type !== 'section') {
          throw new ToolError(
            'invalidArguments',
            `${args.node} is a "${entry.node.type}", not a body or a section.`,
            {
              hint: 'get_outline takes a body or a section; use read_part for other nodes.',
            },
          );
        }
        entries = [outlineEntry(ctx.index, entry, args.depth)];
      } else {
        entries = outline(ctx.index, args.depth);
      }
      if (args.cursor) {
        const after = cursorOf(args.cursor, 'after').nodeId;
        const at = entries.findIndex((e) => e.id === after);
        if (at < 0) throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
        entries = entries.slice(at + 1);
      }
      // Units: whole top-level entries with their subtrees (never split further - the model
      // asks for a body or a section with `node` when it needs one entry alone).
      const { taken, rest } = partition(entries, {
        sizeOf: (e) => JSON.stringify(e).length,
        limit: ctx.budget(),
        fixed: 40,
        strict: false,
      });
      const out: AnyObject = { entries: taken };
      if (rest.length > 0) {
        out.more = moreOf(
          'get_outline',
          { kind: 'after', nodeId: taken[taken.length - 1]!.id },
          {
            entries: rest.length,
            characters: rest.reduce((s, e) => s + e.characters, 0),
          },
        );
      }
      return out;
    },
  );

  defineTool(
    server,
    'read_part',
    {
      title: 'Read a part of the book',
      description:
        'Returns one node of the book (a body, section, poem, paragraph …) by nodeId or structural path, as plain-text blocks with their ids and paths (format "text", the default; inline elements such as images appear as U+FFFC) or as FictionBook XML (format "fb2xml"). A part too large for one answer comes in consecutive parts: pass the returned more.cursor to this tool with the same arguments to get the next part.',
      inputSchema: z.object({
        node: nodeReference('the node to read'),
        format: formatArg,
        cursor: cursorArg,
      }),
      outputSchema: z.looseObject({
        node: nodeInfoSchema,
        format: z.string(),
        from: nodeInfoSchema,
        to: nodeInfoSchema,
        more: moreSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const entry = ctx.resolve(args.node);
      const budget = ctx.budget();
      const base: AnyObject = {
        node: nodeInfo(entry),
        parent: entry.parent ? nodeInfo(entry.parent) : null,
        format: args.format,
      };
      const tooLarge = (leaf: Entry) =>
        new ToolError(
          'tooLarge',
          `The block ${pathOf(leaf)} alone is larger than one answer admits.`,
          { node: nodeInfo(leaf), characters: characterCount(leaf.node) },
        );
      if (args.format === 'text') {
        // Units: the leaf blocks of the part (text containers and atoms) in document order -
        // a paragraph is never cut; the first one that alone does not fit is tooLarge.
        let leaves = leafBlocks(ctx.index, entry);
        if (args.cursor) {
          const after = cursorOf(args.cursor, 'after').nodeId;
          const at = leaves.findIndex((leaf) => nodeIdOf(leaf.node) === after);
          if (at < 0) throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
          leaves = leaves.slice(at + 1);
        }
        const blocks = leaves.map((leaf) => ({ leaf, block: blockOf(leaf) }));
        const { taken, rest } = partition(blocks, {
          sizeOf: (b) => JSON.stringify(b.block).length + 1,
          limit: budget,
          fixed: PART_ENVELOPE_UNITS,
          strict: true,
        });
        if (taken.length === 0 && blocks.length > 0) throw tooLarge(blocks[0]!.leaf);
        const out: AnyObject = {
          ...base,
          blocks: taken.map((b) => b.block),
          from: taken.length > 0 ? nodeInfo(taken[0]!.leaf) : nodeInfo(entry),
          to: taken.length > 0 ? nodeInfo(taken[taken.length - 1]!.leaf) : nodeInfo(entry),
        };
        if (rest.length > 0) {
          out.more = moreOf(
            'read_part',
            { kind: 'after', nodeId: nodeIdOf(taken[taken.length - 1]!.leaf.node) },
            {
              blocks: rest.length,
              characters: rest.reduce((s, b) => s + characterCount(b.leaf.node), 0),
            },
          );
        }
        return out;
      }
      // fb2xml: the units are the direct children of one parent, taken whole; a child that
      // alone does not fit is descended into (§3.7), a leaf that does not fit is tooLarge.
      let parent: Entry = entry;
      let units: Entry[] = isLeafFor(entry) ? [entry] : childEntries(ctx.index, entry);
      let whole = true;
      if (args.cursor) {
        whole = false;
        const after = cursorOf(args.cursor, 'after').nodeId;
        const afterEntry = ctx.entryOf(after);
        if (!afterEntry) throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
        const next = followingUnits(ctx.index, entry, afterEntry);
        if (!next)
          return {
            ...base,
            parent: nodeInfo(entry),
            xml: '',
            from: nodeInfo(entry),
            to: nodeInfo(entry),
          };
        parent = next.parent;
        units = next.units;
      }
      const outcome: TreePartOutcome<Entry> = partitionTree(parent, units, {
        sizeOf: (unit) => estimateXmlSize(unit.node),
        limit: budget,
        fixed: PART_ENVELOPE_UNITS,
        isLeaf: isLeafFor,
        childrenOf: (unit) => childEntries(ctx.index, unit),
      });
      if (outcome.kind === 'tooLarge') throw tooLarge(outcome.unit);
      const { taken, rest } = outcome;
      parent = outcome.parent;
      if (outcome.descended) whole = false;
      const out: AnyObject = {
        ...base,
        ...(whole && rest.length === 0 ? {} : { parent: nodeInfo(parent) }),
        xml: await ctx.xmlOf(taken.map((unit) => unit.node)),
        from: taken.length > 0 ? nodeInfo(taken[0]!) : nodeInfo(parent),
        to: taken.length > 0 ? nodeInfo(taken[taken.length - 1]!) : nodeInfo(parent),
      };
      // What follows: the rest of this parent's children, else - climbing - the units after
      // the descended-into parent, up to the node read.
      const following =
        rest.length > 0 ? null : followingUnits(ctx.index, entry, parent === entry ? null : parent);
      const pending = rest.length > 0 ? rest : (following?.units ?? []);
      if (pending.length > 0 && taken.length > 0) {
        out.more = moreOf(
          'read_part',
          { kind: 'after', nodeId: nodeIdOf(taken[taken.length - 1]!.node) },
          {
            blocks: pending.length,
            characters: pending.reduce((s, u) => s + characterCount(u.node), 0),
          },
        );
      }
      return out;
    },
  );

  defineTool(
    server,
    'get_selection',
    {
      title: 'Get the selection',
      description:
        'Returns the current selection or caret: kind "none" (a caret), "inline" (inside one paragraph), "blocks" (whole blocks, or several blocks with a partly selected first or last block - openStart / openEnd), "cells" (a block of table cells: its table, row, column, rows and columns, numbered as edit_table takes them; read the cells with read_table) or "source" (XML text in the Source view), with its text (format "text") or FictionBook form (format "fb2xml"), its size, anchor and head, and the first and last block touched.',
      inputSchema: z.object({ format: formatArg, cursor: cursorArg }),
      outputSchema: z.looseObject({
        kind: z.enum(['none', 'inline', 'blocks', 'cells', 'source']),
        characters: z.number(),
        paragraphs: z.number(),
        hasInlineElements: z.boolean(),
      }),
      annotations: { readOnlyHint: true },
    },
    (args) => ctx.selectionSummary(args.format, args.cursor),
  );

  defineTool(
    server,
    'get_description',
    {
      title: 'Get the description',
      description:
        'Returns the description (metadata) of the book: title-info (genres, authors, book title, annotation, keywords, date, cover page, language, translators, sequences), src-title-info, document-info (authors, program used, date, source URLs, id, version, history, publishers), publish-info, custom-info and output instructions. The annotation and the history are given as {xml} (FictionBook XML of their content).',
      inputSchema: z.object({}),
      outputSchema: z.looseObject({ description: z.looseObject({}) }),
      annotations: { readOnlyHint: true },
    },
    async () => ({ description: await ctx.describe() }),
  );

  defineTool(
    server,
    'find',
    {
      title: 'Find text in the bodies',
      description:
        "Searches the text of the bodies (not the description) with the editor's search engine and returns every match with the block's id and path, the match offsets inside the block (model offsets), the matched text and ±40 characters of context. Options: regex (a regular expression, ECMAScript syntax), matchCase, wholeWord, within (a node to search in). A very long list comes in parts: pass more.cursor back for the next part.",
      inputSchema: z.object({
        text: z.string().min(1).describe('the text or regular expression to find'),
        regex: flag('treat text as a regular expression'),
        matchCase: flag('case-sensitive'),
        wholeWord: flag('whole words only'),
        within: nodeReference('search inside this node only').optional(),
        cursor: cursorArg,
      }),
      outputSchema: z.looseObject({
        matches: z.array(z.looseObject({ from: z.number(), to: z.number(), text: z.string() })),
        total: z.number(),
        more: moreSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { blocks, texts, matches } = await searchBlocks(ctx, args);
      const all = matches.map((m) => {
        const leaf = blocks[m.block]!;
        const text = texts[m.block]!;
        return {
          node: nodeInfo(leaf),
          from: m.from,
          to: m.to,
          text: m.text,
          context: text.slice(Math.max(0, m.from - 40), Math.min(text.length, m.to + 40)),
        };
      });
      let start = 0;
      if (args.cursor) {
        start = cursorOf(args.cursor, 'offset').offset;
        if (start > all.length) {
          throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
        }
      }
      // Units: whole matches; all of them unless the budget says otherwise (review C13).
      const { taken, rest } = partition(all.slice(start), {
        sizeOf: (m) => JSON.stringify(m).length + 1,
        limit: ctx.budget(),
        fixed: 60,
        strict: false,
      });
      const out: AnyObject = { matches: taken, total: all.length };
      if (rest.length > 0) {
        out.more = moreOf(
          'find',
          { kind: 'offset', offset: start + taken.length },
          { matches: rest.length },
        );
      }
      return out;
    },
  );
}

/* ------------------------------------------------------------------------ */
/* The schema and validation tools and resources (ai-catalogue §3.1, §4; T061) */
/* ------------------------------------------------------------------------ */

const issueSchema = z.looseObject({
  code: z.string(),
  element: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  message: z.string(),
});

/**
 * `validate` and `get_schema` (US4; FR-065): read tools - no change, no hook. `get_schema`
 * without `element` hands on the schema files of `schema.text()` (whole, or in parts of whole
 * lines under a result budget); with `element` it answers from the generated table alone -
 * the core's reserved `schema.element` is never called in 0.0.5 (R6).
 */
function registerSchemaTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'validate',
    {
      title: 'Validate the book now',
      description:
        'Validates the book as it stands with the changes of this request against the FB2 2.1 schema. newErrors are the errors this request introduced (any of them makes ok false and must be corrected); preExistingErrors are the ones the book already had before the request (they do not block a change). irregularTables lists the tables whose rows differ in width, whose cells overlap or whose spans reach past the last row: valid FB2, but readers lay them out unpredictably; edit_table with op repair makes one regular. Every change tool validates on its own; use this to check the whole state before answering.',
      inputSchema: z.object({}),
      outputSchema: z.looseObject({
        ok: z.boolean(),
        newErrors: z.array(issueSchema),
        preExistingErrors: z.array(issueSchema),
        warnings: z.number(),
        durationMs: z.number(),
        irregularTables: z.array(z.looseObject({ problems: z.string() })),
      }),
      annotations: { readOnlyHint: true },
    },
    () => ctx.validateNow(),
  );

  defineTool(
    server,
    'get_schema',
    {
      title: 'Get the FB2 schema',
      description:
        'Returns the FictionBook 2.1 schema. With element (an FB2 element name such as "section" or "title-info"): its content model - the child elements it may hold, its attributes (name, required, type) and whether it may hold text; an unknown name answers known: false. Without element: the text of the five XSD files with their licence notice (a large answer may come in parts: pass more.cursor back for the next part). Use it when a change was rejected and you need to know what an element may contain.',
      inputSchema: z.object({
        element: z
          .string()
          .optional()
          .describe('an FB2 element name (section, p, title-info, …); omit for the whole schema'),
        cursor: cursorArg,
      }),
      outputSchema: z.looseObject({
        known: z.boolean().optional(),
        name: z.string().optional(),
        children: z.array(z.looseObject({ name: z.string() })).optional(),
        files: z.array(z.looseObject({ name: z.string(), text: z.string() })).optional(),
        notice: z.string().optional(),
        more: moreSchema,
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) => {
      if (args.element !== undefined && args.element.trim() !== '') {
        return ctx.elementSchema(args.element);
      }
      return ctx.wholeSchema(args.cursor);
    },
  );
}

/**
 * The MCP resources `fb2://schema/<name>` (ai-catalogue §4): the five schema files, read lazily
 * through the one cached `schema.text()` call, `application/xml`, with the licence notice in
 * the description (the fixed licence line at once, the full notice once the text is known).
 */
function registerSchemaResources(server: McpServer, ctx: ToolContext): void {
  const metadataOf = (name: (typeof SCHEMA_FILE_NAMES)[number], notice?: string) => ({
    title: `FB2 2.1 schema: ${name}`,
    description: `${SCHEMA_FILE_ROLES[name]}. ${notice ? `Notice:\n${notice}` : SCHEMA_LICENCE_LINE}`,
    mimeType: 'application/xml',
  });
  const registered = SCHEMA_FILE_NAMES.map((name) =>
    server.registerResource(
      `schema-${name.replace(/\./g, '-')}`,
      schemaResourceUri(name),
      metadataOf(name),
      async (uri) => {
        const schema = await ctx.schema();
        const file = schema.files.find((f) => f.name === name);
        if (!file) throw new Error(`schema.text() returned no ${name}`);
        return { contents: [{ uri: uri.href, mimeType: 'application/xml', text: file.text }] };
      },
    ),
  );
  ctx.onSchemaLoaded = (schema) => {
    registered.forEach((resource, i) => {
      resource.update({ metadata: metadataOf(SCHEMA_FILE_NAMES[i]!, schema.notice) });
    });
  };
}

/* ------------------------------------------------------------------------ */
/* Scripts (US6 T075-T077; ai-catalogue §3.1, §3.4, §4, §7)                   */
/* ------------------------------------------------------------------------ */

/** The manifest contract: §1 "Where scripts live" to §3 "A script" of the scripting guide. */
export function scriptManifestText(guide: string = scriptingGuide): string {
  const start = guide.indexOf('\n## 1.');
  const end = guide.indexOf('\n## 4.');
  if (start < 0 || end < 0 || end <= start) return guide;
  return `${guide.slice(start + 1, end).trimEnd()}\n`;
}

/** The `mfbe://example-script` package: the bundled script whole, notice header included (§4). */
export function exampleScriptPackage(): { id: string; files: { path: string; content: string }[] } {
  return {
    id: EXAMPLE_SCRIPT_ID,
    files: [
      { path: 'script.json', content: exampleScriptManifest },
      { path: 'index.js', content: exampleScriptIndex },
    ],
  };
}

const MFBE_RESOURCE_MIME: Record<MfbeResourceUri, string> = {
  'mfbe://script-api.d.ts': 'text/typescript',
  'mfbe://script-manifest.md': 'text/markdown',
  'mfbe://example-script': 'application/json',
};

const MFBE_RESOURCE_META: Record<
  MfbeResourceUri,
  { name: string; title: string; description: string }
> = {
  'mfbe://script-api.d.ts': {
    name: 'script-api',
    title: 'Script API (mfbe.d.ts)',
    description:
      'The mfbe interface a script may use - the allow-list of the sandbox: mfbe.doc, mfbe.selection, mfbe.ui, mfbe.edit, mfbe.env, with every type. Nothing else exists inside a script.',
  },
  'mfbe://script-manifest.md': {
    name: 'script-manifest',
    title: 'Script package and manifest format',
    description:
      'Where scripts live, the script.json manifest (manifestVersion 1, id, name, description, kind, entry, needsSelection, undoLabel) and how the entry module is written.',
  },
  'mfbe://example-script': {
    name: 'example-script',
    title: 'Example script package',
    description:
      'One bundled script as a complete package: {id, files: [{path, content}]} - script.json and index.js, whole, with its notice header.',
  },
};

/** The text of one `mfbe://` resource (`read_resource`, the resources). */
export function mfbeResourceText(uri: MfbeResourceUri): string {
  switch (uri) {
    case 'mfbe://script-api.d.ts':
      return scriptApiText;
    case 'mfbe://script-manifest.md':
      return scriptManifestText();
    default:
      return JSON.stringify(exampleScriptPackage(), null, 2);
  }
}

/** The MIME type of a script file by its extension (the resource template of §4). */
function scriptFileMime(path: string): string {
  const dot = path.lastIndexOf('.');
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  switch (extension) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'text/javascript';
    case 'json':
      return 'application/json';
    case 'ts':
    case 'mts':
      return 'text/typescript';
    case 'md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}

const scriptSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  kind: z.enum(['menu', 'tree']),
  needsSelection: z.boolean(),
  group: z.string(),
  source: z.string(),
  available: z.boolean(),
  reason: z.enum(['needsSelection', 'treeOnly', 'sourceView']).optional(),
});

/** Why a script is not runnable right now (`list_scripts.reason`, ai-catalogue §3.1). */
function scriptReason(
  script: CatalogueScript,
  bodyView: boolean,
  hasSelection: boolean,
): 'needsSelection' | 'treeOnly' | 'sourceView' | undefined {
  if (!bodyView) return 'sourceView';
  if (script.kind === 'tree') return 'treeOnly';
  if (script.needsSelection && !hasSelection) return 'needsSelection';
  return undefined;
}

function registerScriptReadTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'list_scripts',
    {
      title: 'List the scripts',
      description:
        'Lists the scripts of the editor (bundled and user ones) with id, name, description, kind ("menu" runs from the Scripts menu, "tree" acts on a Document Tree node) and whether a selection is needed. available says whether run_script may run it now: reason "needsSelection" (select text first with set_selection), "treeOnly" (pass treeNode), "sourceView" (scripts run in the Body view only; ask the user to switch). issues lists packages the loader could not read.',
      inputSchema: z.object({}),
      outputSchema: z.looseObject({ scripts: z.array(scriptSchema), issues: z.array(z.string()) }),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const scripts = ctx.requireScripts();
      const listing = await scripts.list();
      const bodyView = scripts.bodyView();
      const hasSelection = ctx.deps.selection.get().kind !== 'none';
      return {
        scripts: listing.scripts.map((script) => {
          const reason = scriptReason(script, bodyView, hasSelection);
          return {
            id: script.id,
            name: script.name,
            ...(script.description === undefined ? {} : { description: script.description }),
            kind: script.kind,
            needsSelection: script.needsSelection,
            group: script.group,
            source: script.source,
            available: reason === undefined,
            ...(reason === undefined ? {} : { reason }),
          };
        }),
        issues: listing.issues,
      };
    },
  );

  defineTool(
    server,
    'read_script',
    {
      title: 'Read a script',
      description:
        "Returns a script's files: the manifest (script.json), the entry module and the other modules in full, with the package folder and the layer it comes from. Binary files (icons) are listed with binary: true and their size, without content. Read a script before proposing a change to it; a bundled script is never changed in place - propose the changed files under a new id.",
      inputSchema: z.object({ id: z.string().min(1).describe('the script id from list_scripts') }),
      outputSchema: z.looseObject({
        id: z.string(),
        folder: z.string(),
        source: z.string(),
        files: z.array(
          z.looseObject({
            path: z.string(),
            content: z.string().optional(),
            binary: z.boolean().optional(),
            bytes: z.number().optional(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const scripts = ctx.requireScripts();
      const { script } = await ctx.scriptById(scripts, args.id);
      const source = await scripts.files(script.id);
      const files = await Promise.all(
        source.files.map(async (path) => {
          const read = await scripts.readFile(script.id, path);
          return 'content' in read
            ? { path, content: read.content }
            : { path, binary: true, ...(read.bytes === undefined ? {} : { bytes: read.bytes }) };
        }),
      );
      return {
        id: script.id,
        folder: source.folder || script.folder,
        source: script.source,
        files,
      };
    },
  );

  defineTool(
    server,
    'read_resource',
    {
      title: 'Read a reference text',
      description:
        'Returns one of the references for writing scripts: "mfbe://script-api.d.ts" (the mfbe interface a script may use - everything else is unavailable inside the sandbox), "mfbe://script-manifest.md" (where scripts live, the script.json manifest and how the entry module is written), "mfbe://example-script" (one bundled script as a complete package with every file). Read them before propose_script.',
      inputSchema: z.object({
        uri: z.enum(MFBE_RESOURCE_URIS).describe('one of the three mfbe:// references'),
      }),
      outputSchema: z.looseObject({ uri: z.string(), mimeType: z.string(), text: z.string() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) => ({
      uri: args.uri,
      mimeType: MFBE_RESOURCE_MIME[args.uri],
      text: mfbeResourceText(args.uri),
    }),
  );
}

/** The core's `scripts.write` refusals as envelopes (ai-catalogue §3.4; rpc-api §3.8). */
export function scriptWriteError(error: RpcError): ToolError {
  const data = (error.data ?? {}) as {
    errors?: unknown;
    field?: string;
    path?: string;
    id?: string;
  };
  switch (error.code) {
    case RpcErrorCode.scriptInvalidManifest:
      return new ToolError('invalidArguments', 'The script loader refused the manifest.', {
        hint: 'Correct script.json as the errors say and propose again.',
        errors: Array.isArray(data.errors) ? data.errors : [error.message],
      });
    case RpcErrorCode.aiScriptIdBundled:
      return new ToolError(
        'scriptIdBundled',
        `"${data.id ?? ''}" is a bundled script, which is never modified.`,
        {
          hint: 'Propose the changed script under a new id such as assistant/<name>.',
        },
      );
    case RpcErrorCode.aiScriptExists:
      return new ToolError(
        'scriptExists',
        `A user script with this id or folder exists: ${data.path ?? ''}`,
        {
          hint: 'Pass overwrite: true to replace it whole, or choose another id.',
        },
      );
    case RpcErrorCode.invalidParams:
      return new ToolError('invalidArguments', error.message, {
        ...(data.field ? { field: data.field } : {}),
      });
    default:
      return new ToolError('internal', `${error.code}: ${error.message}`, { rpcCode: error.code });
  }
}

function registerScriptTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'run_script',
    {
      title: 'Run a script',
      description:
        'Runs a script of list_scripts inside this request, exactly as from the Scripts menu: its own dialogs appear to the user, its changes become part of this request (validated like every change; one undo step). Body view only. A script with needsSelection needs a non-empty selection (set_selection first); a "tree" script needs treeNode. A script written in this conversation runs only when the user asked for it (Write and run, or a later instruction). status "failed" means the script threw and its changes were rolled back; the request goes on.',
      inputSchema: z.object({
        id: z.string().min(1).describe('the script id from list_scripts'),
        treeNode: z
          .string()
          .optional()
          .describe('for a "tree" script: the node it acts on (a nodeId or a structural path)'),
      }),
      outputSchema: z.looseObject({
        status: z.enum(['done']),
        changed: z.boolean(),
        message: z.string().optional(),
        durationMs: z.number(),
      }),
      annotations: changeAnnotations,
    },
    async (args) => {
      const scripts = ctx.requireScripts();
      if (!scripts.bodyView()) {
        throw new ToolError('unavailable', 'Scripts run in the Body view only.', {
          hint: 'scripts run in the Body view; ask the user to switch',
        });
      }
      return ctx.change(`run_script:${args.id}`, async () => {
        const { script } = await ctx.scriptById(scripts, args.id);
        let treeNode: { nodeId: string; type: string } | undefined;
        if (script.kind === 'tree') {
          if (!args.treeNode) {
            throw new ToolError(
              'invalidArguments',
              `"${script.id}" is a Document Tree script: pass treeNode, the node it acts on.`,
              { expected: { id: script.id, treeNode: 'a nodeId or a structural path' } },
            );
          }
          const entry = ctx.resolve(args.treeNode);
          treeNode = { nodeId: nodeIdOf(entry.node), type: entry.node.type };
        }
        if (script.needsSelection && ctx.deps.selection.get().kind === 'none') {
          throw new ToolError(
            'selectionRequired',
            `"${script.id}" works on the selection and nothing is selected.`,
            { hint: 'Call set_selection first, then run_script.' },
          );
        }
        if (!scripts.runAllowed(script.id)) {
          throw new ToolError(
            'runNotConfirmed',
            `"${script.id}" was written in this conversation and the user has not asked to run it.`,
            { hint: RUN_NOT_CONFIRMED_HINT },
          );
        }
        const outcome = await scripts.run(script, treeNode);
        switch (outcome.status) {
          case 'done':
            if (outcome.document) ctx.deps.copy.reset(outcome.document);
            return {
              status: 'done',
              changed: outcome.document !== null,
              durationMs: outcome.durationMs,
            };
          case 'failed':
            throw new ToolError('scriptFailed', outcome.message, {
              hint: 'The script threw; its changes were rolled back. Continue without it or correct the script.',
              durationMs: outcome.durationMs,
            });
          case 'cancelled':
            throw new ToolError('cancelled', 'The user cancelled the run and the request.');
          default:
            throw new ToolError('unavailable', outcome.message);
        }
      });
    },
  );

  defineTool(
    server,
    'propose_script',
    {
      title: 'Propose a script',
      description:
        'Proposes a complete user script package to the user, who sees every file in full and the target folder and decides: Write, Write and run, or Don\'t write - nothing is written before that. files must hold script.json (manifestVersion 1, the same id, name.en, kind, entry, needsSelection, undoLabel) and the entry module ("export default async function run(ctx) {…}" against the mfbe interface alone - read mfbe://script-api.d.ts, mfbe://script-manifest.md and mfbe://example-script first); further modules are imported by relative path. Ids are "assistant/<kebab-name>" (group 90_assistant). A bundled script is never modified: propose the changed files under a new id. To change an existing user script read_script it first and pass the full new set with overwrite: true. summary: what the script does, for the user (≤ 500 characters). written: false, declined: true means the user said no - do not propose again without a new instruction. runRequested: true means the user chose Write and run: call run_script now.',
      inputSchema: z.object({
        id: z.string().min(1).describe('the new script id, assistant/<kebab-name>'),
        group: z
          .string()
          .optional()
          .describe('the group folder under scripts/ (default 90_assistant)'),
        folder: z
          .string()
          .optional()
          .describe('the package folder name (default: the last id segment)'),
        files: z
          .array(
            z.object({
              path: z.string().describe('relative to the package folder, / separators'),
              content: z.string().describe('the full text of the file'),
            }),
          )
          .describe('every file of the package (1–64), script.json and the entry module included'),
        overwrite: flag('replace the existing user script of this id whole'),
        summary: z.string().describe('what the script does, shown to the user (≤ 500 characters)'),
      }),
      outputSchema: z.looseObject({
        written: z.boolean(),
        declined: z.boolean().optional(),
        id: z.string().optional(),
        path: z.string().optional(),
        warnings: z.array(z.string()).optional(),
        runRequested: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const scripts = ctx.requireScripts();
      const { scripts: all } = await scripts.list();
      const existing = {
        bundledIds: new Set(all.filter((s) => s.source === 'bundled').map((s) => s.id)),
        userIds: new Set(all.filter((s) => s.source !== 'bundled').map((s) => s.id)),
      };
      const proposalArgs: ProposalArgs = {
        id: args.id,
        ...(args.group === undefined ? {} : { group: args.group }),
        ...(args.folder === undefined ? {} : { folder: args.folder }),
        files: args.files,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        summary: args.summary,
      };
      const check = checkProposal(proposalArgs, {
        dataDir: await scripts.dataDir(),
        uiLanguage: scripts.uiLanguage(),
        existing,
      });
      if (!check.ok) {
        const { refusal } = check;
        throw new ToolError(refusal.code, refusal.message, {
          ...(refusal.hint === undefined ? {} : { hint: refusal.hint }),
          ...(refusal.field === undefined ? {} : { field: refusal.field }),
        });
      }
      try {
        return await scripts.propose(check.proposal);
      } catch (error) {
        if (error instanceof RpcError) throw scriptWriteError(error);
        throw error;
      }
    },
  );

  defineTool(
    server,
    'reload_scripts',
    {
      title: 'Re-read the scripts',
      description:
        'Re-reads the script folders (a package copied in by hand appears) and returns the count of scripts and the issues of packages the loader could not read. propose_script re-reads on its own; call this only when the user says scripts were added outside the editor.',
      inputSchema: z.object({}),
      outputSchema: z.looseObject({ count: z.number(), issues: z.array(z.string()) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const scripts = ctx.requireScripts();
      return scripts.reload();
    },
  );
}

/**
 * The `mfbe://` resources of §4 (US6 T075): the three fixed ones from the bundled texts and the
 * template `mfbe://scripts/{id}/{file}` served from the core (`GET /scripts/{id}/{file}`); a
 * binary file is not readable as a resource.
 */
function registerScriptResources(server: McpServer, ctx: ToolContext): void {
  for (const uri of MFBE_RESOURCE_URIS) {
    const meta = MFBE_RESOURCE_META[uri];
    server.registerResource(
      meta.name,
      uri,
      { title: meta.title, description: meta.description, mimeType: MFBE_RESOURCE_MIME[uri] },
      (resourceUri) => ({
        contents: [
          { uri: resourceUri.href, mimeType: MFBE_RESOURCE_MIME[uri], text: mfbeResourceText(uri) },
        ],
      }),
    );
  }
  server.registerResource(
    'script-file',
    new ResourceTemplate(SCRIPT_FILE_TEMPLATE, { list: undefined }),
    {
      title: 'A file of a script package',
      description:
        'One file of a script of list_scripts: id percent-encoded (18%2Fremove-spaces), file the path within the package. Binary files are not readable.',
    },
    async (resourceUri, variables) => {
      const scripts = ctx.requireScripts();
      const idValue = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const fileValue = Array.isArray(variables.file) ? variables.file[0] : variables.file;
      const id = decodeURIComponent(String(idValue ?? ''));
      const file = decodeURIComponent(String(fileValue ?? ''));
      const read = await scripts.readFile(id, file);
      if (!('content' in read)) {
        throw new ToolError(
          'unavailable',
          `"${file}" is a binary file; it is not readable as text.`,
        );
      }
      return {
        contents: [{ uri: resourceUri.href, mimeType: scriptFileMime(file), text: read.content }],
      };
    },
  );
}

/** The `FindQuery` arguments `find` and `replace_all` share (ai-catalogue §3.1, §3.3). */
interface SearchArgs {
  text: string;
  regex?: boolean;
  matchCase?: boolean;
  wholeWord?: boolean;
  within?: string;
}

/**
 * The editor's search over the text containers of the bodies (or of `within`) through the
 * regex runner (a worker with the 2-second budget for a model-supplied expression - review
 * C15): the blocks, their plain texts and the matches. An invalid expression or a time-out is
 * `invalidArguments` with the engine's message; an unknown `within` is `unknownNode`.
 */
async function searchBlocks(
  ctx: ToolContext,
  args: SearchArgs,
): Promise<{ blocks: Entry[]; texts: string[]; matches: RegexMatch[] }> {
  const roots = args.within ? [ctx.resolve(args.within, 'within')] : ctx.index.bodies;
  const blocks = roots
    .flatMap((root) => leafBlocks(ctx.index, root))
    .filter((leaf) => TEXT_CONTAINERS.has(leaf.node.type));
  const texts = blocks.map((leaf) => inlineText((leaf.node.content ?? []) as InlineNode[]));
  const result = await ctx.deps.runRegex({
    query: args.text,
    regex: args.regex === true,
    matchCase: args.matchCase === true,
    wholeWord: args.wholeWord === true,
    texts,
  });
  if (!result.ok) {
    throw new ToolError(
      'invalidArguments',
      result.reason === 'timeout'
        ? result.message
        : `invalid regular expression: ${result.message}`,
      {
        hint:
          result.reason === 'timeout'
            ? 'The pattern took too long; use a simpler expression.'
            : 'Use ECMAScript regular-expression syntax, or set regex to false for a literal search.',
      },
    );
  }
  return { blocks, texts, matches: result.matches };
}

/** True for the nodes the fb2xml splitter never descends into. */
function isLeafFor(entry: Entry): boolean {
  const type = entry.node.type;
  return (
    TEXT_CONTAINERS.has(type) || type === 'image' || type === 'empty-line' || type === 'raw-xml'
  );
}

/** A cheap size estimate of a node's XML (text plus a tag allowance per structural node). */
function estimateXmlSize(node: ModelNodeJson): number {
  if (node.type === 'text') return (node.text ?? '').length + (node.marks?.length ?? 0) * 24;
  let size = node.type.length * 2 + 8;
  for (const child of node.content ?? []) size += estimateXmlSize(child);
  return size;
}

/**
 * The units that follow `after` within the part being read: its following siblings, else -
 * climbing - the following siblings of its parent, up to the node read. `after` null = the
 * descended-into parent itself has been read whole: continue after it.
 */
function followingUnits(
  index: DocIndex,
  read: Entry,
  after: Entry | null,
): { parent: Entry; units: Entry[] } | null {
  let current = after;
  while (current && current.node !== read.node) {
    const parent = current.parent;
    if (!parent) return null;
    const siblings = childEntries(index, parent);
    const at = siblings.findIndex((s) => s.node === current!.node);
    const rest = at >= 0 ? siblings.slice(at + 1) : [];
    if (rest.length > 0) return { parent, units: rest };
    current = parent;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Selection and the first change tool (ai-catalogue §3.2)                   */
/* ------------------------------------------------------------------------ */

const pointArg = z
  .object({
    node: nodeReference('the node of the point'),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000_000)
      .optional()
      .describe('model offset inside the node (default 0)'),
  })
  .optional();

function registerSelectionTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'set_selection',
    {
      title: 'Set the selection',
      description:
        'Moves the selection: either {anchor: {node, offset}, head: {node, offset}} (a caret when head is absent; offsets are model offsets inside the block and are clamped) or {node} to select the whole node. Exactly one of the two forms. Returns the new selection as get_selection does. No document change.',
      inputSchema: z.object({
        anchor: pointArg,
        head: pointArg,
        node: nodeReference('the node to select whole').optional(),
      }),
      outputSchema: z.looseObject({ kind: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      if ((args.node ? 1 : 0) + (args.anchor ? 1 : 0) !== 1) {
        throw new ToolError('invalidArguments', 'give exactly one of {anchor, head?} or {node}', {
          expected: {
            anchor: { node: 'nodeId or path', offset: 0 },
            head: { node: 'nodeId or path', offset: 0 },
            node: 'nodeId or path',
          },
        });
      }
      let selection: ModelSelection;
      if (args.node) {
        const entry = ctx.resolve(args.node);
        const id = nodeIdOf(entry.node);
        selection = TEXT_CONTAINERS.has(entry.node.type)
          ? ctx.classify(
              { nodeId: id, offset: 0 },
              { nodeId: id, offset: containerSize(entry.node) },
            )
          : {
              kind: 'blocks',
              anchor: { nodeId: id, offset: 0 },
              head: { nodeId: id, offset: 0 },
              nodeIds: [id],
              openStart: false,
              openEnd: false,
            };
        if (selection.kind === 'none')
          selection = { kind: 'inline', anchor: selection.anchor, head: selection.head };
      } else {
        const anchor = {
          nodeId: nodeIdOf(ctx.resolve(args.anchor!.node, 'anchor').node),
          offset: args.anchor!.offset ?? 0,
        };
        const head = args.head
          ? {
              nodeId: nodeIdOf(ctx.resolve(args.head.node, 'head').node),
              offset: args.head.offset ?? 0,
            }
          : anchor;
        selection = ctx.classify(anchor, head);
      }
      ctx.deps.selection.set(selection);
      return ctx.selectionSummary('text');
    },
  );

  defineTool(
    server,
    'replace_selection',
    {
      title: 'Replace the selection',
      description:
        'Replaces the selected content: content {text} (plain text; inside a paragraph it takes the formatting at the selection start; over blocks every non-empty line becomes a paragraph) or content {xml} (FictionBook XML: inline content for a selection inside one paragraph, one or several block elements such as <p>, <subtitle>, <poem>, <empty-line/> for a block selection). A partly selected first or last block keeps its unselected text. Exactly one of text / xml. The change is checked against the FB2 schema; an "error" answer means nothing was applied. Afterwards the replacement is selected. Fails with noSelection for a caret, and with notAllowed for a block of table cells (use edit_table).',
      inputSchema: z.object({
        content: z.object({
          text: z.string().optional().describe('plain text'),
          xml: z.string().optional().describe('FictionBook XML'),
        }),
      }),
      outputSchema: z.looseObject({
        replaced: z.looseObject({ characters: z.number(), paragraphs: z.number() }),
        inserted: z.array(nodeInfoSchema),
        selection: z.looseObject({}),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (args) => {
      const { text, xml } = args.content;
      if ((text === undefined ? 0 : 1) + (xml === undefined ? 0 : 1) !== 1) {
        throw new ToolError('invalidArguments', 'content must hold exactly one of text or xml', {
          expected: { content: { text: 'plain text' } },
        });
      }
      const selection = ctx.selection();
      if (selection.kind === 'none') {
        throw new ToolError('noSelection', 'Nothing is selected: the selection is a caret.', {
          hint: 'Use set_selection first, or insert_node to add content at a node.',
        });
      }
      if (selection.kind === 'cells') {
        // A block of cells (feature 006, Δ§3.2): never replaced as one piece - one strike.
        const refusal = new ToolError(
          'notAllowed',
          'A block of table cells cannot be replaced as one piece.',
          {
            hint: "Use edit_table for the block's structure and attributes (the same row, column, rows and columns), or set_text / replace_node on each cell; read_table gives their ids.",
          },
        );
        return ctx.change('replace_selection:selection', () => Promise.reject(refusal));
      }
      if (selection.kind === 'source') {
        if (xml === undefined) {
          throw new ToolError(
            'invalidArguments',
            'a Source view selection takes {xml} (XML text), not {text}',
          );
        }
        if (!ctx.deps.replaceSourceText) {
          throw new ToolError(
            'unavailable',
            'Replacing the selected Source text is not available in this request.',
          );
        }
        const replace = ctx.deps.replaceSourceText;
        return ctx.change(
          'replace_selection:selection',
          async () => {
            const range = await replace(xml);
            const inserted = stripFences(xml);
            ctx.deps.selection.set({
              kind: 'source',
              from: range.from,
              to: range.to,
              text: inserted,
            });
            return {
              replaced: { characters: selection.text.length, paragraphs: 0 },
              inserted: [],
              selection: await ctx.selectionSummary('text'),
            };
          },
          { textPath: true },
        );
      }
      return ctx.change('replace_selection:selection', () =>
        selection.kind === 'inline'
          ? replaceInline(ctx, selection, text, xml)
          : replaceBlocks(ctx, selection, text, xml),
      );
    },
  );
}

/** `replace_selection` on an `inline` selection: text with the marks at the start, or inline XML. */
async function replaceInline(
  ctx: ToolContext,
  selection: Extract<ModelSelection, { kind: 'inline' }>,
  text: string | undefined,
  xml: string | undefined,
): Promise<AnyObject> {
  const container = ctx.pointEntry(selection.anchor, 'selection');
  if (!TEXT_CONTAINERS.has(container.node.type)) {
    throw new ToolError(
      'internal',
      `the selection's container "${container.node.type}" is not a text container`,
    );
  }
  const content = (container.node.content ?? []) as InlineNode[];
  const size = containerSize(container.node);
  const from = Math.min(clamp(selection.anchor.offset, size), clamp(selection.head.offset, size));
  const to = Math.max(clamp(selection.anchor.offset, size), clamp(selection.head.offset, size));
  const replacedText = inlineText(sliceInline(content, from, to));
  let inserted: InlineNode[];
  if (text !== undefined) {
    const marks = marksAt(content, from);
    inserted = text
      ? [{ type: 'text', text, ...(marks && marks.length > 0 ? { marks } : {}) }]
      : [];
  } else {
    const parsed = await ctx.parseXml(xml!, ctx.parentReference(container, container.node.type));
    if (!parsed.inline) {
      throw new ToolError(
        'fragmentNotAllowed',
        'The selection is inside one paragraph: the replacement must be inline content (text and inline elements), not block elements.',
        {
          element: parsed.nodes[0]?.type ?? '',
          parent: container.node.type,
          hint: 'Return text with inline elements such as <emphasis>, <strong>, <a l:href="…">; select whole blocks with set_selection to replace blocks.',
        },
      );
    }
    inserted = (parsed.nodes as unknown as InlineNode[]).map(
      (node) => ctx.assignIds(node as unknown as ModelNodeJson) as unknown as InlineNode,
    );
  }
  const [head] = splitInline(content, from);
  const [, tail] = splitInline(content, to);
  const next: ModelNodeJson = {
    ...container.node,
    content: normalizeInline([...head, ...inserted, ...tail]) as ModelNodeJson[],
  };
  ctx.preCheck(next, 'replace_selection');
  const id = nodeIdOf(container.node);
  ctx.deps.copy.replace(id, next);
  const insertedSize = inserted.reduce(
    (sum, node) => sum + (node.type === 'text' ? node.text.length : 1),
    0,
  );
  ctx.deps.selection.set(
    insertedSize === 0
      ? { kind: 'none', anchor: { nodeId: id, offset: from }, head: { nodeId: id, offset: from } }
      : {
          kind: 'inline',
          anchor: { nodeId: id, offset: from },
          head: { nodeId: id, offset: from + insertedSize },
        },
  );
  const entry = ctx.entryOf(id)!;
  return {
    replaced: { characters: replacedText.length, paragraphs: 1 },
    inserted: [nodeInfo(entry)],
    selection: await ctx.selectionSummary('text'),
  };
}

/**
 * `replace_selection` on a `blocks` selection: the new blocks replace the selected siblings as
 * a slice with the selection's open ends - the first new block's inline content joins the
 * unselected head of a partly selected first block, the last one's the unselected tail of a
 * partly selected last block (the editor's replace / paste semantics, review C6).
 */
async function replaceBlocks(
  ctx: ToolContext,
  selection: Extract<ModelSelection, { kind: 'blocks' }>,
  text: string | undefined,
  xml: string | undefined,
): Promise<AnyObject> {
  const { entries, rendered } = ctx.selectedBlocks(selection);
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const parentEntry = first.parent;
  const siblings = siblingsOf(ctx.index, first);
  const startIndex = siblings.findIndex((s) => s.node === first.node);
  const endIndex = siblings.findIndex((s) => s.node === last.node);
  if (startIndex < 0 || endIndex < startIndex) {
    throw new ToolError('internal', 'the selected blocks are not siblings in order');
  }
  const replacedCharacters = rendered.reduce((sum, node) => sum + characterCount(node), 0);
  const replacedParagraphs = rendered.reduce((sum, node) => sum + countTextContainers(node), 0);

  // The new blocks.
  let blocks: ModelNodeJson[];
  if (text !== undefined) {
    blocks = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) =>
        ctx.assignIds({ type: 'p', attrs: {}, content: [{ type: 'text', text: line }] }),
      );
  } else {
    const parsed = await ctx.parseXml(
      xml!,
      ctx.parentReference(parentEntry, parentEntry ? parentEntry.node.type : 'body'),
    );
    if (parsed.inline) {
      throw new ToolError(
        'fragmentNotAllowed',
        'The selection covers blocks: the replacement must be block elements (<p>, <subtitle>, <poem>, …), not bare inline content.',
        {
          element: '#inline',
          parent: parentEntry ? parentEntry.node.type : 'FictionBook',
          hint: 'Wrap the text in <p>…</p> or return the elements that replace the selected blocks.',
        },
      );
    }
    blocks = (parsed.nodes as unknown as ModelNodeJson[]).map((node) => ctx.assignIds(node));
  }

  // Open ends: the partial first / last blocks keep their unselected text (text containers only).
  const openStart = selection.openStart;
  const openEnd = selection.openEnd;
  const requireContainer = (entry: Entry, which: string) => {
    if (!TEXT_CONTAINERS.has(entry.node.type)) {
      throw new ToolError(
        'notAllowed',
        `The selection ${which} inside the nested block "${entry.node.type}"; replacing such a slice is not supported.`,
        {
          hint: 'Use set_selection to select whole blocks (or a range inside one paragraph), then replace them.',
        },
      );
    }
  };
  let headContent: InlineNode[] = [];
  let tailContent: InlineNode[] = [];
  if (openStart) {
    requireContainer(first, 'starts');
    const size = containerSize(first.node);
    [headContent] = splitInline(
      (first.node.content ?? []) as InlineNode[],
      clamp(startPointOf(selection, first).offset, size),
    );
  }
  if (openEnd) {
    requireContainer(last, 'ends');
    const size = containerSize(last.node);
    [, tailContent] = splitInline(
      (last.node.content ?? []) as InlineNode[],
      clamp(endPointOf(selection, last).offset, size),
    );
  }
  const inlineOf = (block: ModelNodeJson, which: string): InlineNode[] => {
    if (!TEXT_CONTAINERS.has(block.type)) {
      throw new ToolError(
        'notAllowed',
        `The ${which} element of the replacement must be a text container (such as <p>) to join the partly selected block, not "${block.type}".`,
        {
          hint: 'Start (or end) the replacement with the paragraph that continues the partly selected one.',
        },
      );
    }
    return (block.content ?? []) as InlineNode[];
  };
  let result: ModelNodeJson[];
  if (openStart || openEnd) {
    if (blocks.length === 0) {
      result = [
        {
          ...first.node,
          content: normalizeInline([...headContent, ...tailContent]) as ModelNodeJson[],
        },
      ];
    } else if (openStart && openEnd && blocks.length === 1) {
      result = [
        {
          ...first.node,
          content: normalizeInline([
            ...headContent,
            ...inlineOf(blocks[0]!, 'only'),
            ...tailContent,
          ]) as ModelNodeJson[],
        },
      ];
    } else {
      result = [...blocks];
      if (openStart) {
        result[0] = {
          ...first.node,
          content: normalizeInline([
            ...headContent,
            ...inlineOf(blocks[0]!, 'first'),
          ]) as ModelNodeJson[],
        };
      }
      if (openEnd) {
        const lastNew = result[result.length - 1]!;
        result[result.length - 1] = {
          ...lastNew,
          content: normalizeInline([
            ...inlineOf(lastNew, 'last'),
            ...tailContent,
          ]) as ModelNodeJson[],
        };
      }
    }
  } else {
    result = blocks;
  }

  // Pre-checks: every new node builds, and the parent accepts the new sequence.
  for (const node of result) ctx.preCheck(node, 'replace_selection');
  const parentType = parentEntry
    ? (nodeTypeFor(parentEntry.node.type) ?? fb2Schema.nodes.raw_xml!)
    : fb2Schema.nodes.doc!;
  const insertedTypes = result.map(
    (node) => nodeTypeFor(node.type, false) ?? fb2Schema.nodes.raw_xml!,
  );
  const siblingJson = siblings.map((s) => s.node);
  if (!contentFits(parentType, siblingJson, startIndex, endIndex - startIndex + 1, insertedTypes)) {
    throw new ToolError(
      'notAllowed',
      `The parent "${parentEntry ? parentEntry.node.type : 'FictionBook'}" does not allow ${describeTypes(result)} in place of the selected blocks.`,
      {
        hint: `Return elements the parent may hold here (get_schema with "${parentEntry ? parentEntry.node.type : 'body'}" lists them); the FB2 order of children matters.`,
      },
    );
  }

  // Apply through the working copy: replace the first selected block, insert the rest after
  // it, remove the other selected blocks.
  const copy = ctx.deps.copy;
  const oldIds = entries.map((entry) => nodeIdOf(entry.node));
  if (result.length === 0) {
    for (const id of oldIds) copy.remove(id);
  } else {
    copy.replace(oldIds[0]!, result[0]!);
    let previous = nodeIdOf(result[0]!);
    for (const node of result.slice(1)) {
      copy.insert('after', previous, node);
      previous = nodeIdOf(node);
    }
    for (const id of oldIds.slice(1)) copy.remove(id);
  }

  // Afterwards the replacement is selected (FR-031).
  const ids = result.map((node) => nodeIdOf(node));
  const infos = ids
    .map((id) => ctx.entryOf(id))
    .filter((e): e is Entry => !!e)
    .map(nodeInfo);
  if (ids.length === 0) {
    const anchor = { nodeId: nodeIdOf(parentEntry?.node ?? first.node), offset: 0 };
    ctx.deps.selection.set({ kind: 'none', anchor, head: anchor });
  } else {
    const firstNew = ctx.entryOf(ids[0]!)!;
    const lastNew = ctx.entryOf(ids[ids.length - 1]!)!;
    const startText = edgeTextContainer(ctx.index, firstNew, 'first');
    const endText = edgeTextContainer(ctx.index, lastNew, 'last');
    const anchor = {
      nodeId: nodeIdOf((startText ?? firstNew).node),
      offset: openStart
        ? headContent.reduce((s, n) => s + (n.type === 'text' ? n.text.length : 1), 0)
        : 0,
    };
    const endSize = endText ? containerSize(endText.node) : 0;
    const head = {
      nodeId: nodeIdOf((endText ?? lastNew).node),
      offset: openEnd
        ? endSize - tailContent.reduce((s, n) => s + (n.type === 'text' ? n.text.length : 1), 0)
        : endSize,
    };
    ctx.deps.selection.set(
      ids.length === 1 &&
        startText &&
        endText &&
        startText.node === endText.node &&
        anchor.offset !== head.offset
        ? { kind: 'inline', anchor, head }
        : { kind: 'blocks', anchor, head, nodeIds: ids, openStart, openEnd },
    );
  }
  return {
    replaced: { characters: replacedCharacters, paragraphs: replacedParagraphs },
    inserted: infos,
    selection: await ctx.selectionSummary('text'),
  };
}

function startPointOf(
  selection: Extract<ModelSelection, { kind: 'blocks' }>,
  first: Entry,
): ModelPoint {
  return selection.anchor.nodeId === nodeIdOf(first.node) ? selection.anchor : selection.head;
}

function endPointOf(
  selection: Extract<ModelSelection, { kind: 'blocks' }>,
  last: Entry,
): ModelPoint {
  return selection.head.nodeId === nodeIdOf(last.node) ? selection.head : selection.anchor;
}

function describeTypes(nodes: readonly ModelNodeJson[]): string {
  if (nodes.length === 0) return 'an empty replacement';
  return nodes.map((node) => `"${fb2NameFor(node.type)}"`).join(', ');
}

/* ------------------------------------------------------------------------ */
/* The structural change tools (ai-catalogue §3.3, §3.5; T054)              */
/* ------------------------------------------------------------------------ */

const xmlContentArg = z.string().optional().describe('FictionBook XML');

const changeAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

/**
 * The six structural change tools. Every one computes its strike key from the arguments
 * (`<tool>:<resolved nodeId or the reference as given>`, `insert_node:<where>@<nodeId>`,
 * `replace_all:<query>`, `set_description:description` - §3.5) and runs **everything** - the
 * argument checks, the resolution, the parse of `{xml}` content, the ProseMirror pre-checks
 * and the write - inside `ctx.change`, so that every refused attempt counts one strike for its
 * key (review C4) and the hook's checkpoint brackets the write. The results name the nodes
 * touched (`NodeInfo` with id, path, type, characters) so that the request loop can summarise
 * the call ("Replaced paragraph body[1]/section[2]/p[4]") and the model can re-read them.
 */
function registerChangeTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    'replace_node',
    {
      title: 'Replace a node',
      description:
        'Replaces one node of the book (a paragraph, title, section, poem, …) by new content: content {xml} (FictionBook XML of exactly one element that may stand in its place - for several elements use insert_node) or content {node} (the Document JSON of one node). The replaced node keeps its id; new nodes inside get fresh ids. Exactly one of xml / node. The change is checked against the FB2 schema: an "error" answer means nothing was applied. The first body cannot be replaced by anything but a body.',
      inputSchema: z.object({
        node: nodeReference('the node to replace'),
        content: z.object({
          xml: xmlContentArg,
          node: z.looseObject({}).optional().describe('Document JSON of one node'),
        }),
      }),
      outputSchema: z.looseObject({ node: nodeInfoSchema }),
      annotations: changeAnnotations,
    },
    (args) =>
      ctx.change(`replace_node:${ctx.targetOf(args.node)}`, async () => {
        const form = ctx.contentForm(args.content, ['xml', 'node'] as const);
        const entry = ctx.resolve(args.node);
        if (!entry.parent && inDescription(entry)) {
          throw new ToolError(
            'notAllowed',
            `The ${entry.root} element is part of the description.`,
            {
              hint: 'Use set_description with {annotation: {xml}} / {history: {xml}}, or change its paragraphs.',
            },
          );
        }
        const id = nodeIdOf(entry.node);
        let node: ModelNodeJson;
        const parent = ctx.parentOf(entry);
        if (form === 'xml') {
          const parsed = await ctx.parseXml(
            args.content.xml!,
            ctx.parentReference(entry.parent, parent.name),
          );
          if (parsed.inline) {
            throw new ToolError(
              'fragmentNotAllowed',
              'The content must be one element that stands in the place of the node, not bare inline content.',
              {
                element: '#inline',
                parent: parent.name,
                hint: `Return one element such as <${entry.node.type}>…</${entry.node.type}>; use set_text to replace the text of a paragraph.`,
              },
            );
          }
          if (parsed.nodes.length !== 1) {
            throw new ToolError(
              'invalidArguments',
              parsed.nodes.length === 0
                ? 'The xml yields no element.'
                : `The xml yields ${parsed.nodes.length} elements; replace_node takes exactly one.`,
              {
                hint:
                  parsed.nodes.length === 0
                    ? 'Return one element in FictionBook XML.'
                    : 'Use insert_node for several elements (and remove_node for the old one), or wrap them in one element the parent accepts.',
              },
            );
          }
          node = ctx.assignIds(parsed.nodes[0] as unknown as ModelNodeJson);
          node = { ...node, attrs: { ...(node.attrs ?? {}), nodeId: id } };
        } else {
          node = ctx.jsonNode(args.content.node, 'replace_node', id);
        }
        const checked = ctx.checkedNode(node, 'replace_node', pathOf(entry));
        if (!entry.parent && checked.type !== 'body') {
          const message = `A body can only be replaced by a body, not by a "${checked.type}".`;
          throw new ToolError('notAllowed', message, {
            hint: 'Replace or insert the sections inside the body instead.',
            issues: [preCheckIssue(checked.type, message, pathOf(entry))],
          });
        }
        const siblings = siblingsOf(ctx.index, entry).map((s) => s.node);
        ctx.requireFits(
          parent,
          siblings,
          siblings.indexOf(entry.node),
          1,
          [checked],
          'replace_node',
          `in place of this "${entry.node.type}"`,
          pathOf(entry),
        );
        writeAt(ctx.deps.copy, entry, { kind: 'replace', node: checked });
        const after = ctx.entryOf(id);
        if (!after) throw new Error('the replaced node is missing afterwards');
        return { node: nodeInfo(after) };
      }),
  );

  defineTool(
    server,
    'insert_node',
    {
      title: 'Insert nodes',
      description:
        'Inserts new content next to a node: where "before" or "after" puts it beside the node, "append" makes it the last child of the node (for example the last paragraph of a section). content {xml} (FictionBook XML of one or several sibling elements, inserted in order) or content {nodes} (a list of Document JSON nodes). Exactly one of xml / nodes. Returns the inserted nodes with their new ids and paths. The change is checked against the FB2 schema; an "error" answer means nothing was inserted.',
      inputSchema: z.object({
        where: z
          .enum(['before', 'after', 'append'])
          .describe('before / after the node, or append as its last child'),
        node: nodeReference('the reference node'),
        content: z.object({
          xml: xmlContentArg,
          nodes: z.array(z.looseObject({})).optional().describe('Document JSON nodes, in order'),
        }),
      }),
      outputSchema: z.looseObject({ nodes: z.array(nodeInfoSchema) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (args) =>
      ctx.change(`insert_node:${args.where}@${ctx.targetOf(args.node)}`, async () => {
        const form = ctx.contentForm(args.content, ['xml', 'nodes'] as const);
        const entry = ctx.resolve(args.node);
        const append = args.where === 'append';
        // The parse context: the reference's parent, or the reference itself for `append`.
        const parentEntry = append ? entry : entry.parent;
        const parent = append ? containerOf(entry.node) : ctx.parentOf(entry);
        if (!append && !entry.parent && inDescription(entry)) {
          throw new ToolError('notAllowed', `The ${entry.root} element has no siblings.`, {
            hint: 'Append inside it, or use set_description.',
          });
        }
        if (append && isLeafFor(entry)) {
          throw new ToolError(
            'notAllowed',
            `"${entry.node.type}" holds no block children; nothing can be appended to it.`,
            {
              hint: 'Insert before or after it, or use set_text / replace_selection for its text.',
            },
          );
        }
        let nodes: ModelNodeJson[];
        if (form === 'xml') {
          const parsed = await ctx.parseXml(
            args.content.xml!,
            ctx.parentReference(parentEntry, parent.name),
          );
          if (parsed.inline) {
            throw new ToolError(
              'fragmentNotAllowed',
              `The content must be block elements that "${parent.name}" may hold, not bare inline content.`,
              {
                element: '#inline',
                parent: parent.name,
                hint: 'Wrap the text in <p>…</p>, or use replace_selection inside a paragraph.',
              },
            );
          }
          if (parsed.nodes.length === 0) {
            throw new ToolError('invalidArguments', 'The xml yields no element.', {
              hint: 'Return one or several elements in FictionBook XML.',
            });
          }
          nodes = parsed.nodes.map((node) => ctx.assignIds(node as unknown as ModelNodeJson));
        } else {
          const given = args.content.nodes!;
          if (given.length === 0) {
            throw new ToolError('invalidArguments', 'nodes is empty.', {
              hint: 'Give one or several Document JSON nodes.',
            });
          }
          nodes = given.map((value, i) => ctx.jsonNode(value, `insert_node: nodes[${i}]`));
        }
        // The path the pre-check names: the parent of the new nodes (the node for `append`).
        const parentPath = append
          ? pathOf(entry)
          : entry.parent
            ? pathOf(entry.parent)
            : entry.root;
        const checked = nodes.map((node) => ctx.checkedNode(node, 'insert_node', parentPath));
        if (append) {
          const children = childEntries(ctx.index, entry).map((child) => child.node);
          ctx.requireFits(
            parent,
            children,
            children.length,
            0,
            checked,
            'insert_node',
            'as its last child',
            parentPath,
          );
        } else {
          const siblings = siblingsOf(ctx.index, entry).map((s) => s.node);
          const index = siblings.indexOf(entry.node) + (args.where === 'after' ? 1 : 0);
          ctx.requireFits(
            parent,
            siblings,
            index,
            0,
            checked,
            'insert_node',
            `${args.where} this "${entry.node.type}"`,
            parentPath,
          );
        }
        writeAt(ctx.deps.copy, entry, { kind: 'insert', where: args.where, nodes: checked });
        const infos = checked.map((node) => {
          const after = ctx.entryOf(nodeIdOf(node));
          if (!after) throw new Error('an inserted node is missing afterwards');
          return nodeInfo(after);
        });
        return { nodes: infos };
      }),
  );

  defineTool(
    server,
    'remove_node',
    {
      title: 'Remove a node',
      description:
        "Removes one node of the book with everything inside it (a paragraph, an empty line, a section, a poem, …). Refused with notAllowed when the parent needs it - the first body, the last section of a body, the last line of a stanza - with the parent's content model in the hint. Returns the removed node and its character count. The change is checked against the FB2 schema.",
      inputSchema: z.object({ node: nodeReference('the node to remove') }),
      outputSchema: z.looseObject({ removed: nodeInfoSchema, characters: z.number() }),
      annotations: changeAnnotations,
    },
    (args) =>
      ctx.change(`remove_node:${ctx.targetOf(args.node)}`, async () => {
        const entry = ctx.resolve(args.node);
        if (!entry.parent && entry.root === 'body[1]') {
          const message = 'The first body is the book itself and cannot be removed.';
          throw new ToolError('notAllowed', message, {
            hint: `A FictionBook needs its first body (content model of "body": ${contentModelOf(fb2Schema.nodes.body!)}); remove sections inside it instead.`,
            contentModel: contentModelOf(fb2Schema.nodes.body!),
            issues: [preCheckIssue('body', message, 'body[1]')],
          });
        }
        const removed = nodeInfo(entry);
        const characters = characterCount(entry.node);
        if (entry.parent || entry.root.startsWith('body[')) {
          const siblings = siblingsOf(ctx.index, entry).map((s) => s.node);
          ctx.requireFits(
            ctx.parentOf(entry),
            siblings,
            siblings.indexOf(entry.node),
            1,
            [],
            'remove_node',
            `this "${entry.node.type}"`,
            pathOf(entry),
          );
        }
        writeAt(ctx.deps.copy, entry, { kind: 'remove' });
        return { removed, characters };
      }),
  );

  defineTool(
    server,
    'set_text',
    {
      title: 'Set the text of a block',
      description: `Replaces the whole content of one text container (${TEXT_CONTAINER_LIST}) by plain text. All inline formatting of the block is lost - emphasis, strong, links, footnotes, inline images; to keep or change formatting use replace_node with xml. Other nodes are refused with textOnly. The change is checked against the FB2 schema.`,
      inputSchema: z.object({
        node: nodeReference('the text container'),
        text: z.string().describe('the new plain text (empty clears the block)'),
      }),
      outputSchema: z.looseObject({ node: nodeInfoSchema }),
      annotations: changeAnnotations,
    },
    (args) =>
      ctx.change(`set_text:${ctx.targetOf(args.node)}`, async () => {
        const entry = ctx.resolve(args.node);
        if (!TEXT_CONTAINERS.has(entry.node.type)) {
          const message = `"${entry.node.type}" is not a text container; set_text takes ${TEXT_CONTAINER_LIST}.`;
          throw new ToolError('textOnly', message, {
            hint: 'Use replace_node with xml to keep formatting, or read_part to find the paragraphs inside it.',
            issues: [{ code: 'textOnly', element: entry.node.type, path: pathOf(entry), message }],
          });
        }
        const next: ModelNodeJson = {
          ...entry.node,
          content: args.text ? [{ type: 'text', text: args.text }] : [],
        };
        const checked = ctx.checkedNode(next, 'set_text', pathOf(entry));
        const id = nodeIdOf(entry.node);
        writeAt(ctx.deps.copy, entry, { kind: 'replace', node: checked });
        const after = ctx.entryOf(id);
        if (!after) throw new Error('the block is missing afterwards');
        return { node: nodeInfo(after) };
      }),
  );

  defineTool(
    server,
    'replace_all',
    {
      title: 'Find and replace in the bodies',
      description:
        "Replaces every match of text in the bodies (not the description) with the editor's find-and-replace: the same options as find (regex, matchCase, wholeWord, within). replacement is literal; with regex it uses the editor's expansion: $0 the whole match, $1–$9 the groups, $U / $L / $T upper / lower / title case for what follows, $S / $E strong / emphasis for what follows, $Q resets. Returns the exact count and the changed blocks (at most 100 listed). count 0 changes nothing. The change is checked against the FB2 schema.",
      inputSchema: z.object({
        text: z.string().min(1).describe('the text or regular expression to find'),
        regex: flag('treat text as a regular expression'),
        matchCase: flag('case-sensitive'),
        wholeWord: flag('whole words only'),
        within: nodeReference('replace inside this node only').optional(),
        replacement: z
          .string()
          .describe('the replacement (literal, or with $-expansions for regex)'),
      }),
      outputSchema: z.looseObject({ count: z.number(), blocks: z.array(nodeInfoSchema) }),
      annotations: changeAnnotations,
    },
    async (args) => {
      // The search runs first: no match is a success without the hook (no checkpoint, no
      // strike); a bad expression or an unknown `within` is a refused attempt of the key.
      let search: Awaited<ReturnType<typeof searchBlocks>>;
      try {
        search = await searchBlocks(ctx, args);
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        return ctx.change(`replace_all:${args.text}`, () => Promise.reject(error));
      }
      if (search.matches.length === 0) return { count: 0, blocks: [] };
      return ctx.change(`replace_all:${args.text}`, async () => {
        const expand = expansionFor(args.replacement, args.regex === true);
        const byBlock = new Map<number, RegexMatch[]>();
        for (const match of search.matches) {
          const list = byBlock.get(match.block) ?? [];
          list.push(match);
          byBlock.set(match.block, list);
        }
        const rewrites: { entry: Entry; node: ModelNodeJson }[] = [];
        for (const [block, matches] of byBlock) {
          const entry = search.blocks[block]!;
          const rewritten = rewriteBlock(entry.node, matches, expand);
          if (rewritten === entry.node) continue;
          rewrites.push({ entry, node: ctx.checkedNode(rewritten, 'replace_all', pathOf(entry)) });
        }
        // Every rewrite is computed from the index before the first write, then all are
        // written at once (the description roots in one rewrite each).
        replaceEach(ctx.deps.copy, rewrites);
        const blocks = rewrites
          .slice(0, REPLACE_ALL_BLOCKS_LISTED)
          .map(({ node }) => ctx.entryOf(nodeIdOf(node)))
          .filter((e): e is Entry => !!e)
          .map(nodeInfo);
        return { count: search.matches.length, blocks };
      });
    },
  );

  defineTool(
    server,
    'set_description',
    {
      title: 'Change the description',
      description:
        'Changes the description (metadata - the book\'s title, authors, genres, language, annotation, document and publisher info; shown in the Description view, not in the body text) by a partial merge, one level deep: give the blocks to change (titleInfo, srcTitleInfo, documentInfo, publishInfo) with only the members to change - members given replace the existing value, members absent stay; the lists genres, authors, translators, sequences, coverpage, srcUrls, homePages, emails, publishers replace whole; customInfo and outputs replace whole. The book\'s title is titleInfo.bookTitle: {"description": {"titleInfo": {"bookTitle": "New title"}}}. annotation / history are {xml} (FictionBook XML of their content) or null to remove; srcTitleInfo / publishInfo null removes the block; titleInfo and documentInfo cannot be removed. Returns the description afterwards. The change is checked against the FB2 schema (genre codes, lang, dates, required members).',
      inputSchema: z.object({
        description: z
          .looseObject({})
          .describe(
            'the members of the description to change, e.g. {"titleInfo": {"bookTitle": "New title"}} - the book\'s title is titleInfo.bookTitle (the member is named bookTitle, not title)',
          ),
      }),
      outputSchema: z.looseObject({
        description: z.looseObject({}),
        validation: z.looseObject({ newErrors: z.number(), preExistingErrors: z.number() }),
        fields: z.array(z.string()),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (args) =>
      ctx.change('set_description:description', async () => {
        const merged = await mergeDescription(ctx.document.description, args.description, {
          parseXml: async (xml, element) => {
            const parsed = await ctx.parseXml(xml, { element });
            if (parsed.inline) {
              throw new ToolError(
                'fragmentNotAllowed',
                `The ${element} takes block elements (<p>, <poem>, <cite>, …), not bare inline content.`,
                { element: '#inline', parent: element, hint: 'Wrap the text in <p>…</p>.' },
              );
            }
            return parsed.nodes.map((node) => ctx.assignIds(node as unknown as ModelNodeJson));
          },
          nextNodeId: () => ctx.deps.nextNodeId(),
          fail: (message, extra) => {
            throw new ToolError('invalidArguments', `set_description: ${message}`, {
              ...(extra?.hint ? { hint: extra.hint } : {}),
              expected: extra?.expected ?? DESCRIPTION_SHAPE,
            });
          },
        });
        ctx.deps.copy.setDescription(merged.description);
        return {
          description: await ctx.describe(),
          validation: { newErrors: 0, preExistingErrors: ctx.preExistingErrors() },
          fields: merged.fields,
        };
      }),
  );
}

/* ------------------------------------------------------------------------ */
/* Prompts (ai-catalogue §5)                                                */
/* ------------------------------------------------------------------------ */

function registerPrompts(server: McpServer, depsOf: () => CatalogueDeps): void {
  const messages = async (name: 'selection_edit' | 'general', args: Record<string, unknown>) => {
    const deps = depsOf();
    const texts = deps.promptMessages
      ? await deps.promptMessages(name, args)
      : [{ role: 'user' as const, text: `Instruction: ${String(args.instruction ?? '')}` }];
    return {
      messages: texts.map((m) => ({
        role: m.role,
        content: { type: 'text' as const, text: m.text },
      })),
    };
  };
  server.registerPrompt(
    'selection_edit',
    {
      title: 'Edit the selection',
      description:
        'The fast path of a selection request: the instruction and the selected content in FictionBook form, asking for the replacement alone (or NO CHANGE with an answer).',
      argsSchema: z.object({ instruction: z.string().describe("the user's instruction") }),
    },
    (args) => messages('selection_edit', args),
  );
  server.registerPrompt(
    'general',
    {
      title: 'General request',
      description:
        'A request from the panel: the instruction (with the paragraph at the caret for a popup request without a selection) answered with text or tool calls.',
      argsSchema: z.object({
        instruction: z.string().describe("the user's instruction"),
        caretContext: z
          .union([z.stringbool(), z.boolean()])
          .optional()
          .describe('include the paragraph at the caret'),
      }),
    },
    (args) => messages('general', args),
  );
}
