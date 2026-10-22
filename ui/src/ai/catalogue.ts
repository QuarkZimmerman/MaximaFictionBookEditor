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
 * `get_description`, `find`), the selection tool (`set_selection`) and the first change tool
 * (`replace_selection`); US3 (T054), US4 (T061) and US6 (T075) add theirs at the marked places.
 */

import { Client } from '@modelcontextprotocol/client';
import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { createReport, nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2NameFor, fb2Schema, nodeTypeFor } from '@/editor/schema';
import type { Document, InlineNode, RawXmlNode } from '@/model/document';
import { RpcError } from '@/rpc/client';
import type { AiFragmentNotAllowedData, FragmentNode, FragmentResultNode } from '@/rpc/types';
import { contentFits } from '@/scripting/api-impl';
import type { WorkingCopy } from '@/scripting/workingCopy';

import type { RegexRunner } from './regexRunner';
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

export type { Block, NodeInfo, OutlineEntry } from './tools/model';

/* ------------------------------------------------------------------------ */
/* Contract constants                                                       */
/* ------------------------------------------------------------------------ */

/** Catalogue version reported by `get_context` (ai-catalogue §1). */
export const CATALOGUE_VERSION = 1;

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

const UNKNOWN_NODE_HINT =
  'Use the ids returned by get_outline, read_part or find; paths shift after insertions.';
const MORE_HINT = (tool: string) =>
  `More follows: call ${tool} again with the same arguments and this cursor for the next part.`;

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
  | { kind: 'source'; from: number; to: number; text: string };

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
) => Promise<T | ToolErrorEnvelope>;

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
  /** The Source view's text path (US5 T070): `replace_selection` on a `source` selection. */
  replaceSourceText?: (xml: string) => Promise<{ from: number; to: number }>;
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
  /** Drops the client and the server (turn-off, end of the request). */
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

/** Builds the catalogue of one request: server, client and transport pair, connected. */
export async function createCatalogue(deps: CatalogueDeps): Promise<Catalogue> {
  const server = new McpServer({ name: 'mfbe-ai-catalogue', version: String(CATALOGUE_VERSION) });
  const context = new ToolContext(deps);
  registerReadTools(server, context);
  // T061 (US4): `validate`, `get_schema`; T075 (US6): `list_scripts`, `read_script`,
  // `read_resource` - here, before the selection tool, to keep the §3 order.
  registerSelectionTools(server, context);
  // T054 (US3): `replace_node`, `insert_node`, `remove_node`, `set_text`, `replace_all`,
  // `set_description`; T076 (US6): `run_script`, `propose_script`, `reload_scripts`.
  registerPrompts(server, deps);

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

type AnyObject = Record<string, unknown>;

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
function defineTool<I extends z.ZodObject>(
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
    const hints: string[] = [];
    if (/nbsp|entity/i.test(detail)) hints.push('write the character U+00A0 itself, never &nbsp;');
    if (/xml|FictionBook|declaration/i.test(detail)) {
      hints.push('return the elements that replace the selection, without a document wrapper');
    }
    return new ToolError('invalidXml', `The XML is not well-formed: ${detail}`, {
      ...(data.line !== undefined ? { line: data.line } : {}),
      ...(data.column !== undefined ? { column: data.column } : {}),
      hint:
        hints.join('; ') ||
        'Return well-formed FB2 XML: escape &, < and > in text; only the five predefined entities exist.',
    });
  }
  if (error.code === 1201) {
    return new ToolError(
      'fragmentNotAllowed',
      `The element "${data.element ?? '?'}" is not allowed inside "${data.parent ?? '?'}".`,
      {
        element: data.element ?? '',
        parent: data.parent ?? '',
        hint: 'Use get_schema with the parent element to see what it may contain; return the elements that replace the selection, without a document wrapper.',
      },
    );
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
const cursorArg = z.string().optional().describe('more.cursor of the previous part');
const formatArg = z
  .enum(['text', 'fb2xml'])
  .default('text')
  .describe('"text" (default) or "fb2xml"');
const flag = (what: string) => z.union([z.stringbool(), z.boolean()]).optional().describe(what);

const nodeInfoSchema = z.looseObject({
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

/** What a `read_part` / `get_selection` part is cut from: a list of units with their sizes. */
interface Taken<T> {
  taken: T[];
  rest: T[];
}

/**
 * Takes whole units from the front while their serialised size stays within the budget;
 * without a budget everything. The first unit is taken even when it alone exceeds the budget
 * unless `strict` says that such a unit is too large (`tooLarge` / descent, decided by the
 * caller).
 */
function takeWithin<T>(
  units: readonly T[],
  sizeOf: (unit: T) => number,
  budget: number | undefined,
  fixed: number,
  strict: boolean,
): Taken<T> {
  if (budget === undefined) return { taken: [...units], rest: [] };
  const taken: T[] = [];
  let used = fixed;
  for (const unit of units) {
    const size = sizeOf(unit);
    if (taken.length > 0 && used + size > budget) break;
    if (taken.length === 0 && used + size > budget && strict) break;
    taken.push(unit);
    used += size;
  }
  return { taken, rest: units.slice(taken.length) };
}

class ToolContext {
  constructor(readonly deps: CatalogueDeps) {}

  get document(): Document {
    return this.deps.copy.document;
  }

  get index(): DocIndex {
    return indexDocument(this.document);
  }

  budget(): number | undefined {
    const value = this.deps.resultBudget?.();
    return value !== undefined && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : undefined;
  }

  /** Resolves a node reference (path or id) or fails with `unknownNode`. */
  resolve(reference: string, what = 'node'): Entry {
    const entry = resolveReference(this.index, reference);
    if (!entry) {
      throw new ToolError('unknownNode', `No node ${reference} in the document (${what}).`, {
        hint: UNKNOWN_NODE_HINT,
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

  /** Runs a change under the hook (or unchecked without one). */
  change<T extends AnyObject>(
    strikeKey: string,
    run: () => Promise<T>,
  ): Promise<T | ToolErrorEnvelope> {
    const hook = this.deps.applyChange;
    if (hook) return hook(strikeKey, run);
    return run().catch((error: unknown) => toEnvelope(error));
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
    const budget = this.budget();
    let units = blocks.rendered.map((node, i) => ({ node, entry: blocks.entries[i]! }));
    if (cursor) {
      const after = parseCursor(cursor, 'after:');
      const at = units.findIndex((u) => nodeIdOf(u.entry.node) === after);
      if (at < 0) throw new ToolError('invalidArguments', `unknown cursor "${cursor}"`);
      units = units.slice(at + 1);
    }
    const sizeOf = (u: { node: ModelNodeJson }) => JSON.stringify(u.node).length;
    const { taken, rest } = takeWithin(units, sizeOf, budget, 200, true);
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
      out.more = {
        cursor: `after:${nodeIdOf(taken[taken.length - 1]!.entry.node)}`,
        remaining: {
          blocks: rest.length,
          characters: rest.reduce((sum, u) => sum + characterCount(u.node), 0),
        },
        hint: MORE_HINT('get_selection'),
      };
    }
    return out;
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

function parseCursor(cursor: string, prefix: string): string {
  if (!cursor.startsWith(prefix) || cursor.length === prefix.length) {
    throw new ToolError('invalidArguments', `unknown cursor "${cursor}"`, {
      hint: 'Pass more.cursor of the previous part unchanged.',
    });
  }
  return cursor.slice(prefix.length);
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
        const after = parseCursor(args.cursor, 'after:');
        const at = entries.findIndex((e) => e.id === after);
        if (at < 0) throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
        entries = entries.slice(at + 1);
      }
      const { taken, rest } = takeWithin(
        entries,
        (e) => JSON.stringify(e).length,
        ctx.budget(),
        40,
        false,
      );
      const out: AnyObject = { entries: taken };
      if (rest.length > 0) {
        out.more = {
          cursor: `after:${taken[taken.length - 1]!.id}`,
          remaining: {
            entries: rest.length,
            characters: rest.reduce((s, e) => s + e.characters, 0),
          },
          hint: MORE_HINT('get_outline'),
        };
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
      if (args.format === 'text') {
        let leaves = leafBlocks(ctx.index, entry);
        if (args.cursor) {
          const after = parseCursor(args.cursor, 'after:');
          const at = leaves.findIndex((leaf) => nodeIdOf(leaf.node) === after);
          if (at < 0) throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
          leaves = leaves.slice(at + 1);
        }
        const blocks = leaves.map((leaf) => ({ leaf, block: blockOf(leaf) }));
        const { taken, rest } = takeWithin(
          blocks,
          (b) => JSON.stringify(b.block).length + 1,
          budget,
          240,
          true,
        );
        if (taken.length === 0 && blocks.length > 0) {
          const first = blocks[0]!;
          throw new ToolError(
            'tooLarge',
            `The block ${first.block.path} alone is larger than one answer admits.`,
            {
              node: nodeInfo(first.leaf),
              characters: characterCount(first.leaf.node),
            },
          );
        }
        const out: AnyObject = {
          ...base,
          blocks: taken.map((b) => b.block),
          from: taken.length > 0 ? nodeInfo(taken[0]!.leaf) : nodeInfo(entry),
          to: taken.length > 0 ? nodeInfo(taken[taken.length - 1]!.leaf) : nodeInfo(entry),
        };
        if (rest.length > 0) {
          out.more = {
            cursor: `after:${nodeIdOf(taken[taken.length - 1]!.leaf.node)}`,
            remaining: {
              blocks: rest.length,
              characters: rest.reduce((s, b) => s + characterCount(b.leaf.node), 0),
            },
            hint: MORE_HINT('read_part'),
          };
        }
        return out;
      }
      // fb2xml: units are the direct children of one parent; a huge child is descended into.
      let parent: Entry = entry;
      let units: Entry[] = isLeafFor(entry) ? [entry] : childEntries(ctx.index, entry);
      let whole = true;
      if (args.cursor) {
        whole = false;
        const after = parseCursor(args.cursor, 'after:');
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
      for (;;) {
        const sized = units.map((unit) => ({ unit, size: estimateXmlSize(unit.node) }));
        const { taken, rest } = takeWithin(sized, (s) => s.size, budget, 240, true);
        if (taken.length > 0 || sized.length === 0) {
          const nodes = taken.map((s) => s.unit.node);
          const out: AnyObject = {
            ...base,
            ...(whole && rest.length === 0 ? {} : { parent: nodeInfo(parent) }),
            xml: await ctx.xmlOf(nodes),
            from: taken.length > 0 ? nodeInfo(taken[0]!.unit) : nodeInfo(parent),
            to: taken.length > 0 ? nodeInfo(taken[taken.length - 1]!.unit) : nodeInfo(parent),
          };
          const remaining = rest.map((s) => s.unit);
          const following =
            remaining.length > 0
              ? null
              : followingUnits(ctx.index, entry, parent === entry ? null : parent);
          const pending = remaining.length > 0 ? remaining : (following?.units ?? []);
          if (pending.length > 0 && taken.length > 0) {
            out.more = {
              cursor: `after:${nodeIdOf(taken[taken.length - 1]!.unit.node)}`,
              remaining: {
                blocks: pending.length,
                characters: pending.reduce((s, u) => s + characterCount(u.node), 0),
              },
              hint: MORE_HINT('read_part'),
            };
          }
          return out;
        }
        // The first unit alone does not fit: descend into it, or refuse a text container.
        const first = sized[0]!.unit;
        if (isLeafFor(first)) {
          throw new ToolError(
            'tooLarge',
            `The block ${pathOf(first)} alone is larger than one answer admits.`,
            {
              node: nodeInfo(first),
              characters: characterCount(first.node),
            },
          );
        }
        whole = false;
        parent = first;
        units = childEntries(ctx.index, first);
      }
    },
  );

  defineTool(
    server,
    'get_selection',
    {
      title: 'Get the selection',
      description:
        'Returns the current selection or caret: kind "none" (a caret), "inline" (inside one paragraph), "blocks" (whole blocks, or several blocks with a partly selected first or last block - openStart / openEnd) or "source" (XML text in the Source view), with its text (format "text") or FictionBook form (format "fb2xml"), its size, anchor and head, and the first and last block touched.',
      inputSchema: z.object({ format: formatArg, cursor: cursorArg }),
      outputSchema: z.looseObject({
        kind: z.enum(['none', 'inline', 'blocks', 'source']),
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
    async () => {
      const description = ctx.document.description;
      const xmlOf = async (node: ModelNodeJson | undefined) =>
        node ? { xml: await ctx.xmlOf(node.content ?? []) } : undefined;
      const titleInfo = async (info: typeof description.titleInfo) => {
        const { annotation, ...rest } = info;
        const xml = await xmlOf(annotation as unknown as ModelNodeJson | undefined);
        return { ...rest, ...(xml ? { annotation: xml } : {}) };
      };
      const { history, ...documentInfoRest } = description.documentInfo;
      const historyXml = await xmlOf(history as unknown as ModelNodeJson | undefined);
      return {
        description: {
          titleInfo: await titleInfo(description.titleInfo),
          ...(description.srcTitleInfo
            ? { srcTitleInfo: await titleInfo(description.srcTitleInfo) }
            : {}),
          documentInfo: { ...documentInfoRest, ...(historyXml ? { history: historyXml } : {}) },
          ...(description.publishInfo ? { publishInfo: description.publishInfo } : {}),
          customInfo: description.customInfo,
          outputs: description.outputs.map((output: RawXmlNode) => ({ xml: output.attrs.xml })),
        },
      };
    },
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
      const all = result.matches.map((m) => {
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
        start = Number(parseCursor(args.cursor, 'offset:'));
        if (!Number.isInteger(start) || start < 0 || start > all.length) {
          throw new ToolError('invalidArguments', `unknown cursor "${args.cursor}"`);
        }
      }
      const slice = all.slice(start);
      const { taken, rest } = takeWithin(
        slice,
        (m) => JSON.stringify(m).length + 1,
        ctx.budget(),
        60,
        false,
      );
      const out: AnyObject = { matches: taken, total: all.length };
      if (rest.length > 0) {
        out.more = {
          cursor: `offset:${start + taken.length}`,
          remaining: { matches: rest.length },
          hint: MORE_HINT('find'),
        };
      }
      return out;
    },
  );
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
        'Replaces the selected content: content {text} (plain text; inside a paragraph it takes the formatting at the selection start; over blocks every non-empty line becomes a paragraph) or content {xml} (FictionBook XML: inline content for a selection inside one paragraph, one or several block elements such as <p>, <subtitle>, <poem>, <empty-line/> for a block selection). A partly selected first or last block keeps its unselected text. Exactly one of text / xml. The change is checked against the FB2 schema; an "error" answer means nothing was applied. Afterwards the replacement is selected. Fails with noSelection for a caret.',
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
        return ctx.change('replace_selection:selection', async () => {
          const range = await replace(xml);
          ctx.deps.selection.set({ kind: 'source', from: range.from, to: range.to, text: xml });
          return {
            replaced: { characters: selection.text.length, paragraphs: 0 },
            inserted: [],
            selection: await ctx.selectionSummary('text'),
          };
        });
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
/* Prompts (ai-catalogue §5)                                                */
/* ------------------------------------------------------------------------ */

function registerPrompts(server: McpServer, deps: CatalogueDeps): void {
  const messages = async (name: 'selection_edit' | 'general', args: Record<string, unknown>) => {
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
