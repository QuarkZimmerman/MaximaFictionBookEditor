/**
 * The assistant proper (feature 005): the module behind the lazy `ai-assistant` chunk, imported
 * once by `ui/src/ai/index.ts` on the first turn-on (research R8.4, review B2; SC-013: nothing
 * of it is requested while the assistant is off or disabled). Everything under `src/ai/` but
 * the static set `index.ts`, `address.ts`, `agreements.ts` and `testHooks.ts` lands in this
 * chunk (vite.config.ts), the MCP SDK and zod included.
 *
 * The request loop of ai-catalogue §6 (T046 and T055; data-model §4.3-§4.7, §5.3; FR-022 to
 * FR-026, FR-031 to FR-035, FR-043, FR-044, FR-054, FR-060 to FR-064):
 *
 *  1. preconditions (`canSend`: on, a document, no run lock - a script run answers `busy`), the
 *     target resolved from the settings (`target.ts`), the first-use notice for a hosted
 *     service (`notice.tsx`; *No* → nothing happens, no activity entry);
 *  2. the `RequestSession` (`session.ts`): the lock with the banner label `<service> · <model>`,
 *     the baseline validation, the working copy; the selection snapshot and the working context
 *     (`context.ts`); the **one catalogue instance per turn-on** (`catalogue.ts`, data-model
 *     §8.5: built when the assistant is turned on, kept in `store.ai.catalogue`, re-bound to
 *     every request's working copy with `rebind`, closed at turn-off);
 *  3. the exchanges through the `ai.complete` job of the core: the first `ChatRequest` is
 *     `[system, …history, user]` with the `tools` array when the target offers tools (`model`
 *     and `stream` are the core's) - the history being the conversation's earlier **turns**
 *     (every earlier request's `user` message and the assistant's final text with its
 *     `[Changes applied in this turn: …]` / `[No change]` line, never tool traffic, interim
 *     words or notices - §5.2; none for the popup's selection requests); a text answer is
 *     judged by the fast-path table of `reply.ts` in a selection request and ends a general
 *     request (`answered` / `askedBack` by wording when nothing changed, else committed with the
 *     text shown - review C5); a replacement goes through the validity hook (`hook.ts`); tool
 *     calls run sequentially in the service's order through the catalogue with the hook behind
 *     every change tool, each with its localised `tool.call` summary (`summaries.ts`); a limit
 *     is waited out with a countdown within the 300 s budget, and so is the pacing wait of an
 *     answer with `ratelimit-remaining: 0` before the next exchange (`protocol.ts`); an
 *     oversize refusal removes its cause in the order of §6.12 - the oldest turns one request
 *     at a time (`history.trimmed`, the panel told), the largest tool result of the last round
 *     replaced by its first part, a block selection split along block boundaries into
 *     consecutive fast-path exchanges, the outline of the system message cut to whole top-level
 *     entries with `more` (`split.ts`) - and resends; an overflow message that names the limit
 *     sets the context-length hint the pre-emptive estimate uses for the rest of the session
 *     (review C13, memory only);
 *  4. the end: `committed` (one undo step named after the instruction, the replacement
 *     selected), `answered` / `askedBack` (nothing committed, `modified` untouched), `failed`,
 *     `cancelled` (Stop, Escape, the banner, the document replaced) or `rejected` (the third
 *     strike).
 *
 * Every step is wrapped (review C17): an unexpected exception ends the request as `failed
 * (internal)`, discards the working copy, releases the lock and logs the fixed code
 * `ai.internal` with `error.name` alone - never a message or a stack. The conversation and the
 * activity list (`activity.ts`) are written live and kept in memory only.
 */

import type { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

import type { CommandContext } from '@/app/commands';
import { logUiError } from '@/app/diagnostics';
import type { ModelNodeJson } from '@/editor/fromModel';
import { createNodeIdGenerator } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import type { Document, ValidationReport } from '@/model/document';
import {
  actions,
  emptyConversation,
  isRunLocked,
  type AppStore,
  type AssistantActivityEntry,
  type AssistantMessage,
  type AssistantRequestView,
} from '@/model/store';
import { resolveToken, RpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode, type AiOutcome, type ChatRequest, type FragmentNode } from '@/rpc/types';
import { plainText } from '@/scripting/api-impl';
import { getScriptsFeature, type ScriptsFeature } from '@/scripting/catalog';
import { scriptName, type ScriptHost } from '@/scripting/host';
import type { ScriptInfo, ScriptSourceResult } from '@/scripting/types';
import type { WorkingCopy } from '@/scripting/workingCopy';
import {
  getBodyController,
  hasBodyController,
  type BodyEditorController,
} from '@/views/body/bodyEditor';
import { getSourceEditor } from '@/views/source/sourceEditor';

import {
  appendActivity,
  appendMessage,
  conversationFor,
  nextRequestId,
  updateActivity,
  type ActivityKind,
} from './activity';
import { displayKeyOf } from './address';
import {
  chatToolsMembers,
  createCatalogue,
  selectionHolder,
  ToolError,
  type Catalogue,
  type CatalogueDeps,
  type CatalogueScript,
  type ChangeHook,
  type ChangeHookOptions,
  type ModelSelection,
  type NestedRunOutcome,
  type ProposalDecision,
  type ScriptFileContent,
  type ScriptsDeps,
  type SelectionHolder,
  type ToolCallOutcome,
  type ToolErrorEnvelope,
} from './catalogue';
import {
  appliedLine,
  assertChatRequestPrivate,
  buildWorkingContext,
  caretBlock,
  caretContextMessage,
  outlineOf,
  selectionEditMessage,
  selectionSnapshot,
  systemPrompt,
  type CaretBlock,
  type OutlineEntry,
  type SelectionPart,
  type SelectionSnapshot,
  type WorkingContext,
  type WorkingContextInput,
} from './context';
import {
  applyChange,
  rejectedEnvelope,
  rejectionFromEnvelope,
  SELECTION_TARGET,
  selectionReplacement,
  strikeIssues,
  strikeKey,
  type ChangeOutcome,
  type ChangeRejected,
  type ErrorForModel,
  type SelectionReplacementResult,
} from './hook';
import { requireAgreement } from './notice';
import {
  defaultAuthorLine,
  filesToWrite,
  runAllowed,
  type ScriptProposal,
  type WrittenScript,
} from './proposal';
import { showProposal } from './proposal.tsx';
import {
  failureText,
  maskKey,
  pacingWait,
  toFailure,
  triage,
  WaitBudget,
  type ExchangeResult,
  type Failure,
  type LimitWait,
  type ToolCallEntry,
} from './protocol';
import { createRegexRunner } from './regexRunner';
import { createRegexWorker } from './regexWorkerFactory';
import { claimsChange, decideTextReply, isQuestion, undoLabel } from './reply';
import { cancelJob, startRequestSession, type RequestSession, type SessionRpc } from './session';
import {
  commitSource,
  firstChangedNodeId,
  prepareSource,
  SOURCE_TEXT_MODE_TOOL_NAMES,
  sourceModelSelection,
  sourcePresenter,
  sourceTextReplacer,
  sourceToolGate,
  textPathSpec,
  type SourceRequestState,
} from './source';
import { cutOutline, fitsContext, halve, resultBudgetFor, trimTurns } from './split';
import {
  argumentsOf,
  callSummary,
  continuationKey,
  resultSummary,
  type SummarisedCall,
} from './summaries';
import { resolveActiveTarget, type ActiveTarget } from './target';
import { containerSize, indexDocument, resolveReference, TEXT_CONTAINERS } from './tools/model';
import { inDescription } from './tools/write';

/** The end of a request as the panel and the popup see it (data-model §4.1 `outcome`, §4.5). */
export type RequestFailureKind =
  | 'offline'
  | 'timeout'
  | 'tls'
  | 'auth'
  | 'model'
  | 'limit'
  | 'oversize'
  | 'paragraphTooLarge'
  | 'service'
  | 'format'
  | 'truncated'
  | 'contentFilter'
  | 'invalidAtEnd'
  | 'validationUnavailable'
  | 'busy'
  | 'noService'
  /** US5: the Source text is not well-formed and nothing is selected (FR-072). */
  | 'sourceNotWellFormed'
  /** US5: the Source selection intersects a binary, the stylesheet or the prolog (C11). */
  | 'sourceRefused'
  /** US5: the text path's `doc.fromXml` changed the binary store (never expected). */
  | 'binariesChanged'
  | 'internal';

export interface RequestFailure {
  kind: RequestFailureKind;
  status?: number;
  serviceCode?: string | number;
  /** The service's own words; shown, never logged by the UI. */
  message?: string;
  /** `limit`: the wait that was not waited for. */
  waitSeconds?: number;
  /** A 3xx answer: "the address redirects" (protocol.ts). */
  redirect?: true;
  /** `invalidAtEnd`: the errors found at the commit. */
  errors?: ErrorForModel[];
}

/**
 * Where the accepted changes of a request went (FR-106): the `request.done` entry's `changes`
 * and the test hook's `places`. The Body view shows the bodies' text alone, so a change to the
 * description - the book title, the authors, the annotation … - is named as such.
 */
export interface ChangePlaces {
  total: number;
  /** Changes in the text of the bodies. */
  body: number;
  /** Changes in the description (metadata) - the Description view shows them, the Body view not. */
  description: number;
  /** The description fields written (`titleInfo.bookTitle`, …), each once, in order. */
  fields: string[];
}

/** One accepted change's place: known at once, or `unknown` until the commit's diff decides. */
type ChangePlace = 'body' | 'description' | 'unknown';

export type RequestOutcome =
  | {
      kind: 'committed';
      text?: string;
      cutOff?: boolean;
      undo?: { label: string };
      /** Where the changes went (FR-106). */
      changes?: ChangePlaces;
    }
  /**
   * `answered` / `askedBack`: nothing was changed. `claimedChange` marks a text that claims a
   * change ("I have translated the title…") made through no tool - shown as words only, never
   * as done (FR-106).
   */
  | { kind: 'answered'; text: string; cutOff?: boolean; claimedChange?: true }
  | { kind: 'askedBack'; text: string; cutOff?: boolean; claimedChange?: true }
  | { kind: 'failed'; failure: RequestFailure }
  | { kind: 'cancelled' }
  | { kind: 'rejected'; text?: string; issues: ErrorForModel[] };

/** What starts a request (data-model §4.1): where from, what the user typed. */
export interface StartRequestOptions {
  origin: 'popup' | 'panel';
  instruction: string;
  /**
   * The Body selection the popup showed when it opened (`selectionSnapshot`); `undefined`
   * takes the editor's selection at the start, `null` is a caret (a `general` request). In
   * the Source view the popup's snapshot carries the selected range (`range`), which the
   * `preparing` step classifies (US5).
   */
  selection?: SelectionSnapshot | null;
}

/** The request as the popup and the panel follow it live (`store.ai.request`). */
export interface AiRequestView extends AssistantRequestView {
  kind: 'selection' | 'general';
  instruction: string;
  service: { name: string; model: string };
  /** The current operation (the banner's text). */
  phase: string;
  elapsedMs: number;
  /** A split selection: the part under way (ai-catalogue §6.12 step 3). */
  part?: { index: number; count: number };
  /** Seconds left of a limit wait (FR-023). */
  countdown?: number;
}

/** What `__mfbeTest.ai.lastRequest()` reports (quickstart §0.4). */
export interface LastRequestInfo {
  id: string;
  state: RequestOutcome['kind'];
  exchanges: number;
  validations: { durationMs: number }[];
  fromXmlCalls: number;
  changes: number;
  /** Where the changes went (FR-106; a committed request). */
  places?: ChangePlaces;
  /** `answered` / `askedBack`: the text claimed a change that no tool made (FR-106). */
  claimedChange?: boolean;
}

/* ------------------------------------------------------------------------ */
/* On / off                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Turns the assistant on: the state flips, the conversation starts empty and the catalogue
 * instance of this turn-on is built (data-model §8.5 - server, client and transport in memory;
 * building it sends nothing, gathers no context, computes no outline); no request, no lock.
 */
export function startAssistant(store: AppStore): void {
  const state = store.getState();
  if (state.ai.on) return;
  actions.updateAi(store, {
    on: true,
    loaded: true,
    request: null,
    conversation: emptyConversation(),
    panelFocus: false,
  });
  void openCatalogue(store).catch(() => {});
}

/**
 * Turns the assistant off: a running request is cancelled and discarded, the conversation is
 * cleared (FR-045), the catalogue instance closed and the request reference dropped; the
 * document and `modified` are untouched (FR-095). The imported chunk stays idle.
 */
export function stopAssistant(store: AppStore): void {
  active?.cancel();
  closeCatalogue();
  failNextTool = null;
  writtenScripts.clear();
  actions.updateAi(store, {
    on: false,
    request: null,
    catalogue: null,
    conversation: emptyConversation(),
    panelFocus: false,
  });
}

/* ------------------------------------------------------------------------ */
/* The catalogue instance of a turn-on (data-model §8.5)                    */
/* ------------------------------------------------------------------------ */

let catalogueGeneration = 0;
let cataloguePromise: Promise<Catalogue> | null = null;

/**
 * The binding of the instance between requests: every use fails loudly (a tool call outside a
 * request would be a bug of the loop), nothing of a document is held.
 */
function unboundDeps(): CatalogueDeps {
  const unbound = (): never => {
    throw new Error('the catalogue is not bound to a request');
  };
  const deps = {
    get copy(): WorkingCopy {
      return unbound();
    },
    selection: { get: unbound, set: unbound },
    context: unbound,
    changesInThisRequest: () => 0,
    startedAt: 0,
    fragmentToXml: () => Promise.reject(new Error('the catalogue is not bound to a request')),
    fragmentFromXml: () => Promise.reject(new Error('the catalogue is not bound to a request')),
    nextNodeId: unbound,
    runRegex: () => Promise.reject(new Error('the catalogue is not bound to a request')),
  };
  return deps as unknown as CatalogueDeps;
}

/**
 * The catalogue instance of the current turn-on, built once (`startAssistant`) and shared by
 * every request until `closeCatalogue`; `store.ai.catalogue` holds it once connected. An
 * instance whose turn-on ended while it was being built is closed at once.
 */
function openCatalogue(store: AppStore): Promise<Catalogue> {
  if (cataloguePromise) return cataloguePromise;
  catalogueGeneration += 1;
  const generation = catalogueGeneration;
  const promise = createCatalogue(unboundDeps()).then((catalogue) => {
    if (generation !== catalogueGeneration || !store.getState().ai.on) {
      void catalogue.close().catch(() => {});
      throw new Error('the assistant was turned off while its catalogue was built');
    }
    actions.updateAi(store, { catalogue });
    return catalogue;
  });
  cataloguePromise = promise;
  promise.catch(() => {
    if (cataloguePromise === promise) cataloguePromise = null;
  });
  return promise;
}

/** Closes the instance of the turn-on (turn-off); a later `openCatalogue` builds a new one. */
function closeCatalogue(): void {
  catalogueGeneration += 1;
  const promise = cataloguePromise;
  cataloguePromise = null;
  if (promise) void promise.then((catalogue) => catalogue.close()).catch(() => {});
}

/* ------------------------------------------------------------------------ */
/* The request                                                               */
/* ------------------------------------------------------------------------ */

let active: RequestRun | null = null;
let lastRequest: LastRequestInfo | null = null;
/** Test hook (hooks builds): the next call of this tool throws inside the loop (review C17). */
let failNextTool: { name: string; message: string } | null = null;

/**
 * The FR-084 gate's state (ai-catalogue §7.6; data-model §10.2; review C9): the scripts written
 * in this conversation, by id, with the request that wrote them, the moment on the
 * conversation's clock and whether the user chose *Write and run*. `conversationClock` orders
 * the instructions and the writes; cleared at turn-off (the conversation ends with it).
 */
const writtenScripts = new Map<string, WrittenScript>();
let conversationClock = 0;

/** The next moment of the conversation's clock (an instruction sent, a script written). */
function tick(): number {
  conversationClock += 1;
  return conversationClock;
}

/**
 * `__mfbeTest.ai.failNextTool(name, message)`: makes the next call of `name` throw a plain
 * `Error(message)` inside the loop, so that a journey can prove the `failed (internal)` end and
 * the log line that names the code and `error.name` only (ai-catalogue §9.1 "internal
 * failure"); `null` clears it.
 */
export function setFailNextTool(name: string | null, message = 'test hook'): void {
  failNextTool = name === null ? null : { name, message };
}

/** The last request's summary for the test hook (null before the first). */
export function lastRequestInfo(): LastRequestInfo | null {
  return lastRequest;
}

/** The running request, or null. */
export function activeRequest(): { id: string; cancel(): void } | null {
  return active;
}

/**
 * Starts a request (ai-catalogue §6). Resolves with the request's outcome; while it runs
 * `store.ai.request` follows it. A call while nothing can be sent answers `failed` without
 * touching the document: `busy` while a script or another request holds the lock, `noService`
 * without a resolvable target, `internal` while the assistant is off (the UI never asks then).
 */
export async function startRequest(
  ctx: CommandContext,
  options: StartRequestOptions,
): Promise<RequestOutcome> {
  const { store } = ctx;
  const state = store.getState();
  const rpc = ctx.rpc;
  if (!state.ai.on || !state.document || !state.docId || !rpc) {
    return { kind: 'failed', failure: { kind: 'internal' } };
  }
  if (isRunLocked(state) || active) return { kind: 'failed', failure: { kind: 'busy' } };
  if (!options.instruction.trim()) return { kind: 'failed', failure: { kind: 'internal' } };
  let target: ActiveTarget;
  try {
    const resolved = await resolveActiveTarget(rpc, state.settings, state.ai.customModels);
    if (!resolved.ok) return { kind: 'failed', failure: { kind: 'noService' } };
    target = resolved.target;
  } catch (error) {
    return { kind: 'failed', failure: failureOf(error) };
  }
  // The first-use notice for a hosted service (FR-021): *No* → nothing happens.
  if (target.hosted && !(await requireAgreement(ctx, target.notice))) return { kind: 'cancelled' };
  // The dialog took time: the preconditions again.
  const again = store.getState();
  if (!again.ai.on || !again.document || again.docId !== state.docId) {
    return { kind: 'cancelled' };
  }
  if (isRunLocked(again) || active) return { kind: 'failed', failure: { kind: 'busy' } };

  const run = new RequestRun(ctx, rpc, options, target);
  active = run;
  try {
    return await run.execute();
  } finally {
    if (active === run) active = null;
  }
}

/** Cancels the running request (Escape in the popup, the banner's Cancel, `ai.cancel`). */
export function cancelRequest(store: AppStore): void {
  void store;
  active?.cancel();
}

/** The module's surface as `ui/src/ai/index.ts` imports it (`import('./assistant')`). */
export interface AssistantModule {
  startAssistant: typeof startAssistant;
  stopAssistant: typeof stopAssistant;
  startRequest: typeof startRequest;
  cancelRequest: typeof cancelRequest;
  lastRequestInfo?: typeof lastRequestInfo;
  activeRequest?: typeof activeRequest;
  setFailNextTool?: typeof setFailNextTool;
  openAskPopup?: (ctx: CommandContext) => Promise<void>;
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function isCancelledError(error: unknown): boolean {
  return error instanceof RpcError && error.code === RpcErrorCode.cancelled;
}

/** File extensions `read_script` lists as binary (no content; the core serves them for `<img>`). */
const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'svgz']);

/**
 * One file of a script package through the core's `GET /scripts/{id}/{file}` with the session
 * token (ai-catalogue §3.1 `read_script`, §4 template): the text of a text file; a binary
 * file's size alone (a HEAD request), never its bytes.
 */
async function readScriptFile(id: string, file: string): Promise<ScriptFileContent> {
  const base = import.meta.env.BASE_URL ?? '/';
  const token = resolveToken();
  const path = file.split('/').map(encodeURIComponent).join('/');
  const url = `${base}scripts/${encodeURIComponent(id)}/${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const dot = file.lastIndexOf('.');
  const extension = dot >= 0 ? file.slice(dot + 1).toLowerCase() : '';
  if (BINARY_EXTENSIONS.has(extension)) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const length = Number(head.headers.get('content-length'));
      return Number.isFinite(length) && length > 0
        ? { binary: true, bytes: length }
        : { binary: true };
    } catch {
      return { binary: true };
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new ToolError('internal', `GET /scripts/${id}/${file} failed: ${response.status}`);
  }
  return { content: await response.text() };
}

/** One accepted change with its place and, for `set_description`, the fields it wrote. */
interface PlacedChange {
  place: ChangePlace;
  fields: string[];
}

/**
 * The `changes` of the `request.done` entry (FR-106): the accepted changes counted by place;
 * an `unknown` place (a nested script run, the Source view's text path) is decided by the
 * commit's diff of the document before and after - `descriptionChanged` / `bodiesChanged` -
 * and counts for the bodies unless the description alone changed.
 */
export function summarisePlaces(
  changes: readonly PlacedChange[],
  diff: { descriptionChanged: boolean; bodiesChanged: boolean },
): ChangePlaces {
  const out: ChangePlaces = { total: changes.length, body: 0, description: 0, fields: [] };
  for (const change of changes) {
    let place = change.place;
    if (place === 'unknown') {
      place = diff.descriptionChanged && !diff.bodiesChanged ? 'description' : 'body';
    }
    if (place === 'description') out.description += 1;
    else out.body += 1;
    for (const field of change.fields) if (!out.fields.includes(field)) out.fields.push(field);
  }
  return out;
}

/** The commit's diff for `summarisePlaces`: by reference first, then by content (copy-on-write documents). */
function documentDiff(
  before: Pick<Document, 'description' | 'bodies'>,
  after: Pick<Document, 'description' | 'bodies'>,
): { descriptionChanged: boolean; bodiesChanged: boolean } {
  const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
  return {
    descriptionChanged: !same(before.description, after.description),
    bodiesChanged: !same(before.bodies, after.bodies),
  };
}

/** The sections of an outline, nested ones included (the `request.start` entry names the count). */
function countSections(entries: readonly OutlineEntry[]): number {
  return entries.reduce(
    (sum, entry) => sum + (entry.type === 'section' ? 1 : 0) + countSections(entry.children),
    0,
  );
}

/** The failure a thrown value stands for: 1200 → `noService`, everything else `internal`. */
function failureOf(error: unknown): RequestFailure {
  if (error instanceof RpcError && error.code === RpcErrorCode.aiNoService) {
    return { kind: 'noService' };
  }
  return { kind: 'internal' };
}

/** The §6.11 user message after a rejected fast-path replacement. */
export function rejectionMessage(issues: readonly ErrorForModel[]): string {
  const list = issues
    .map((issue) => {
      const where = [issue.element ? `element ${issue.element}` : '', issue.path ?? '']
        .filter((part) => part !== '')
        .join(' at ');
      const line = issue.line !== undefined ? ` (line ${issue.line})` : '';
      return `- ${issue.code}${where ? `, ${where}` : ''}: ${issue.message}${line}`;
    })
    .join('\n');
  return (
    'The replacement was rejected by the FB2 2.1 schema check and was not applied:\n' +
    `${list}\n` +
    'Reply with a corrected replacement only, in the same form.'
  );
}

/** The catalogue's selection for a Body snapshot (ai-catalogue §3.2). */
function modelSelectionOf(
  snapshot: SelectionSnapshot | null,
  caret: CaretBlock | null,
): ModelSelection {
  if (!snapshot || snapshot.form === 'xml' || !snapshot.anchor || !snapshot.head) {
    const point = { nodeId: caret?.id ?? snapshot?.anchor?.nodeId ?? '', offset: 0 };
    return { kind: 'none', anchor: point, head: point };
  }
  if (snapshot.form === 'inline') {
    return { kind: 'inline', anchor: snapshot.anchor, head: snapshot.head };
  }
  return {
    kind: 'blocks',
    anchor: snapshot.anchor,
    head: snapshot.head,
    nodeIds: snapshot.nodeIds,
    openStart: snapshot.openStart,
    openEnd: snapshot.openEnd,
  };
}

/** Text containers in a block (the `paragraphs` count of a part). */
function textContainers(node: ModelNodeJson): number {
  if (node.type === 'text') return 0;
  let count = TEXT_CONTAINERS.has(node.type) ? 1 : 0;
  for (const child of node.content ?? []) count += textContainers(child);
  return count;
}

function idOf(node: ModelNodeJson): string {
  const id = node.attrs?.nodeId;
  return typeof id === 'string' ? id : '';
}

/** One block of a split selection (data-model §4.6). */
interface PartBlock {
  id: string;
  node: ModelNodeJson;
}

/** The split of a block selection under way (ai-catalogue §6.12 step 3). */
interface SplitState {
  /** The parts still to send, the current one first. */
  pending: PartBlock[][];
  done: number;
  total: number;
  previousTail?: string;
  firstInsertedId?: string;
  lastInsertedId?: string;
}

type ChatMessage = Record<string, unknown>;

/** One earlier turn of the conversation as it is resent (ai-catalogue §5.2 item 2). */
export interface HistoryTurn {
  requestId: string;
  user: string;
  /** The assistant's final text with its `appliedLine` on the last line. */
  assistant: string;
}

/**
 * The turns of the conversation an exchange carries (data-model §5.3): for every earlier
 * request - the current one left out - its `user` message and the assistant's **final** text
 * (the last `assistant` message that is not interim) with its `[Changes applied …]` /
 * `[No change]` line; `notice` messages, interim words and the tool traffic of earlier requests
 * are never resent, and a request without a final text (failed, cancelled, rejected) leaves no
 * turn.
 */
export function historyTurns(
  messages: readonly AssistantMessage[],
  currentRequestId: string,
): HistoryTurn[] {
  const byRequest = new Map<string, { user?: string; final?: AssistantMessage }>();
  const order: string[] = [];
  for (const message of messages) {
    if (message.requestId === currentRequestId) continue;
    let entry = byRequest.get(message.requestId);
    if (!entry) {
      entry = {};
      byRequest.set(message.requestId, entry);
      order.push(message.requestId);
    }
    if (message.role === 'user') {
      if (entry.user === undefined) entry.user = message.text;
    } else if (message.role === 'assistant' && !message.interim) {
      entry.final = message;
    }
  }
  const turns: HistoryTurn[] = [];
  for (const requestId of order) {
    const entry = byRequest.get(requestId)!;
    if (entry.user === undefined || !entry.final) continue;
    const line = entry.final.appliedLine ?? appliedLine({});
    turns.push({ requestId, user: entry.user, assistant: `${entry.final.text}\n${line}` });
  }
  return turns;
}

/** The chat messages of the kept turns. */
function turnMessages(turns: readonly HistoryTurn[]): ChatMessage[] {
  return turns.flatMap((turn) => [
    { role: 'user', content: turn.user },
    { role: 'assistant', content: turn.assistant },
  ]);
}

/** A tool message of the request with what produced it (the shrink rule of §6.12 step 2). */
interface ToolMessageRecord {
  message: ChatMessage;
  call: SummarisedCall;
  /** The tools round (one per answer with tool calls) the message belongs to. */
  round: number;
}

const READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_context',
  'get_outline',
  'read_part',
  'get_selection',
  'get_description',
  'find',
]);

/** Below this size a tool result is not what overflows an exchange: step 2 is skipped. */
const MIN_SHRINKABLE_UNITS = 400;

/** The outline reduced to its bodies alone (ai-catalogue §6.12 step 4's last form). */
function bodiesAlone(entries: readonly OutlineEntry[]): OutlineEntry[] {
  return entries.map((entry) => ({ ...entry, children: [] }));
}

function outlineCharacters(entries: readonly OutlineEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.characters, 0);
}

function countEntries(entries: readonly OutlineEntry[]): number {
  return entries.reduce((sum, entry) => sum + 1 + countEntries(entry.children), 0);
}

/* ------------------------------------------------------------------------ */
/* RequestRun                                                                */
/* ------------------------------------------------------------------------ */

class RequestRun {
  readonly id = nextRequestId();
  readonly startedAt = Date.now();
  /** When the user's instruction was sent, on the conversation's clock (the FR-084 gate). */
  readonly instructionAt = tick();
  private session: RequestSession | null = null;
  /** The script host while a nested run is under way (US6 T076): its Cancel is ours. */
  private nestedHost: ScriptHost | null = null;
  private catalogue: Catalogue | null = null;
  private holder: SelectionHolder | null = null;
  private controller: BodyEditorController | null = null;
  /** The Source view's state when the request runs there (US5; null in the Body view). */
  private source: SourceRequestState | null = null;
  /** The RPC surface that counts the request's parses (`fromXmlCalls`). */
  private sessionRpc: SessionRpc | null = null;
  private selection: SelectionSnapshot | null = null;
  private caret: CaretBlock | null = null;
  private kind: 'selection' | 'general' = 'general';
  private jobId: string | null = null;
  private cancelled = false;
  private ended = false;
  private waitAbort: (() => void) | null = null;
  private exchanges = 0;
  private fromXmlCalls = 0;
  /** A change tool was called by the model in this request (row b of the fast-path table, C7). */
  private changeToolCalled = false;
  /** Hook invocations so far (a tool call that raised it was a change tool). */
  private hookCalls = 0;
  /** The outcome of the last change the hook saw (the catalogue's `replace_selection` of a part). */
  private lastChangeOutcome: ChangeOutcome<Record<string, unknown>> | null = null;
  /** Set by the change hook on the third strike: the request ends `rejected` after the call. */
  private rejectedIssues: ErrorForModel[] | null = null;
  private readonly budget = new WaitBudget();
  private readonly nextNodeId = createNodeIdGenerator('sc_');
  private view: AiRequestView;
  private readonly t: CommandContext['t'];
  private readonly store: AppStore;
  /** Accepted changes per tool (the `[Changes applied in this turn: …]` line, §5.2). */
  private readonly changesByTool = new Map<string, number>();
  /** The accepted changes with their places (the `request.done` entry's `changes`, FR-106). */
  private readonly placedChanges: PlacedChange[] = [];
  /** Where the changes went, decided at the commit (`summarisePlaces`). */
  private places: ChangePlaces | null = null;
  /** The conversation's earlier turns and how many of the oldest were left out (§6.12 step 1). */
  private turns: HistoryTurn[] = [];
  private droppedTurns = 0;
  /** The tool messages of this request with what produced them (§6.12 step 2). */
  private readonly toolMessages: ToolMessageRecord[] = [];
  private round = 0;
  /** The pacing wait a successful answer asked for before the next exchange (§6.7). */
  private pendingPacing: LimitWait | null = null;
  /** The context length known for this request (the entry's, a hint, an overflow message's). */
  private contextLength: number | undefined;
  /** While a tool result is shrunk to its first part: the budget of that part (§6.12 step 2). */
  private partBudget: number | undefined;
  /** The UTF-16 units of the exchange without the result under way (the pre-emptive rule). */
  private fixedUnits = 0;
  /** The parts delivered per continued read (`read_part` … with a cursor): the part index. */
  private readonly partCounters = new Map<string, number>();
  /** The working context input of the request, rebuilt when the outline is cut (§6.12 step 4). */
  private contextInput: WorkingContextInput | null = null;
  private context: WorkingContext | null = null;
  private outlineEntries: OutlineEntry[] = [];
  private outlineForm: 'whole' | 'cut' | 'bodies' = 'whole';

  constructor(
    private readonly ctx: CommandContext,
    private readonly rpc: RpcClient,
    private readonly options: StartRequestOptions,
    private readonly target: ActiveTarget,
  ) {
    this.t = ctx.t;
    this.store = ctx.store;
    this.view = {
      id: this.id,
      origin: options.origin,
      state: 'created',
      startedAt: this.startedAt,
      kind: 'general',
      instruction: options.instruction,
      service: { name: target.name, model: target.model },
      phase: '',
      elapsedMs: 0,
    };
  }

  /* ------------------------------------------------------------- state */

  /** Publishes the live view (`store.ai.request`); an `undefined` member removes the key. */
  private publish(patch: Partial<AiRequestView>): void {
    const next: AiRequestView = { ...this.view };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    this.view = next;
    if (!this.ended) actions.updateAi(this.store, { request: this.view });
  }

  private setPhase(phase: string): void {
    this.session?.setPhase(phase);
    this.publish({ phase });
  }

  private activity(kind: ActivityKind, payload?: Record<string, unknown>): AssistantActivityEntry {
    return appendActivity(this.store, {
      requestId: this.id,
      elapsedMs: Date.now() - this.startedAt,
      kind,
      ...(payload ? { payload } : {}),
    });
  }

  /** The context length the size rule works with: the request's, else the session's hint, else the entry's. */
  private knownContextLength(): number | undefined {
    return (
      this.contextLength ??
      this.store.getState().ai.contextLengthHint ??
      this.target.contextLength ??
      undefined
    );
  }

  /**
   * The UTF-16 units one tool result may carry (`CatalogueDeps.resultBudget`): the part budget
   * of a shrink under way, else the pre-emptive bound of a known context length (§3.7), else
   * none - results go whole (FR-053).
   */
  private resultBudget(): number | undefined {
    const fromContext = resultBudgetFor(this.fixedUnits, this.knownContextLength());
    if (this.partBudget === undefined) return fromContext;
    return fromContext === undefined ? this.partBudget : Math.min(this.partBudget, fromContext);
  }

  /**
   * Asks the running work to stop: the job of the exchange or of a validation is cancelled - or,
   * while `ai.complete` / `doc.validate` is on its way, as soon as its id arrives -, a wait cut
   * short (ai-catalogue §6.15).
   */
  cancel(): void {
    if (this.cancelled || this.ended) return;
    this.cancelled = true;
    const jobId = this.jobId;
    if (jobId) {
      this.jobId = null;
      cancelJob(this.rpc, jobId);
    }
    this.waitAbort?.();
    this.session?.cancelValidation();
    // A nested script run ends with the request (FR-080, review C10): the host closes the
    // script's dialogs and resolves the run as cancelled.
    this.nestedHost?.cancel();
  }

  /* ------------------------------------------------------------ the run */

  async execute(): Promise<RequestOutcome> {
    try {
      const outcome = await this.run();
      return this.finish(outcome);
    } catch (error) {
      if (this.cancelled || isCancelledError(error)) return this.finish({ kind: 'cancelled' });
      void logUiError(this.rpc, {
        code: 'ai.internal',
        message: error instanceof Error ? error.name : 'Error',
        context: { requestId: this.id },
      });
      return this.finish({ kind: 'failed', failure: failureOf(error) });
    }
  }

  private async run(): Promise<RequestOutcome> {
    const { store, t, options, target } = this;
    const state = store.getState();
    const docId = state.docId!;
    this.publish({ state: 'preparing', phase: t('ai.phase.preparing') });

    const controller = hasBodyController(store) ? getBodyController(store) : null;
    this.controller = controller;
    const editorState = controller?.editorState ?? null;
    const window = controller?.currentWindow ?? null;
    const toXml = (nodes: ModelNodeJson[]) => this.toXml(docId, nodes);
    // The session's RPC counts the parses of the request (the test hook's `fromXmlCalls`): the
    // fragment parses of the fast path and the tools, and the text path's one `doc.fromXml`.
    const rpc = this.rpc;
    const sessionRpc: SessionRpc = {
      call: ((method: string, ...rest: unknown[]) => {
        if (method === 'doc.fragmentFromXml' || method === 'doc.fromXml') this.fromXmlCalls += 1;
        return (rpc.call as (...args: unknown[]) => unknown)(method, ...rest);
      }) as RpcClient['call'],
      runJob: ((...args: unknown[]) =>
        (rpc.runJob as (...a: unknown[]) => unknown)(...args)) as RpcClient['runJob'],
    };
    this.sessionRpc = sessionRpc;
    const sourceEditor = state.activeView === 'source' ? getSourceEditor(store) : null;
    let selection = options.selection;
    // The text's own report when the text path starts on a well-formed text (its baseline).
    let textReport: ValidationReport | null = null;
    // The Source selection the catalogue works on - the panel's request stays `general` (its
    // instruction as typed) while `get_selection` / `replace_selection` see the selected text.
    let sourceSelection: SelectionSnapshot | null = null;
    if (sourceEditor) {
      // The Source view (US5, ai-catalogue §8.1, §8.4): the pending text committed only when
      // the request will use structured tools, the selection mapped and classified, or the
      // text path on the text as it stands; a refused range and a text-mode request without a
      // selection end here, before the lock - nothing is sent.
      const prepared = await prepareSource({
        ctx: this.ctx,
        rpc: sessionRpc,
        editor: sourceEditor,
        docId,
        offersTools: target.tools,
        origin: options.origin,
        // The popup's captured range; the editor's selection for the panel and for a caret.
        ...(selection?.range ? { range: selection.range } : {}),
        toXml,
      });
      if (prepared.kind === 'failed') {
        return { kind: 'failed', failure: { kind: prepared.failure } };
      }
      this.source = prepared.state;
      sourceSelection = prepared.selection;
      selection = options.origin === 'panel' ? null : prepared.selection;
      textReport = prepared.textReport;
      this.caret = null;
    } else if (selection === undefined) {
      selection = editorState ? await selectionSnapshot(editorState, window, toXml) : null;
    } else if (selection === null && options.origin === 'panel' && editorState) {
      // The panel's request in the Body view stays `general` (the instruction as typed, no fast
      // path) while the tools see the Body selection - the context's `selection`,
      // `get_selection`, a `needsSelection` script of `run_script` (ai-catalogue §2.1, §3.2,
      // §3.4; US6) - as the Source view's panel request does with its text selection.
      sourceSelection = await selectionSnapshot(editorState, window, toXml);
    }
    if (this.cancelled) return { kind: 'cancelled' };
    this.selection = selection ?? null;
    if (!sourceEditor) this.caret = editorState ? caretBlock(editorState, window) : null;
    this.kind = this.selection ? 'selection' : 'general';
    this.publish({ kind: this.kind });

    const label = t('ai.banner.label', { service: target.name, model: target.model });
    const started = await startRequestSession(
      {
        store,
        rpc: sessionRpc,
        undo: this.ctx.undo,
        getController: () => this.controller,
        nextNodeId: this.nextNodeId,
      },
      {
        origin: options.origin,
        kind: this.kind,
        instruction: options.instruction,
        label,
        phase: t('ai.phase.preparing'),
        selection: this.selection,
        onCancel: () => this.cancel(),
        onDocumentReplaced: () => this.cancel(),
        onTick: (elapsedMs) => this.publish({ elapsedMs }),
        // The Source view: the step tagged with it (Edit → Undo there stays there, the Body
        // view's Ctrl+Z activates it) and the text put back along with the model (§8.3).
        ...(this.source
          ? { present: sourcePresenter(store, this.source), undoView: 'source' as const }
          : {}),
      },
    );
    if (!started.ok) {
      switch (started.reason) {
        case 'busy':
          return { kind: 'failed', failure: { kind: 'busy' } };
        case 'validationUnavailable':
          return { kind: 'failed', failure: { kind: 'validationUnavailable' } };
        case 'cancelled':
          return { kind: 'cancelled' };
        default:
          return { kind: 'failed', failure: { kind: 'internal' } };
      }
    }
    const session = started.session;
    this.session = session;
    const source = this.source;
    if (source) {
      // The Source text the request works on (data-model §6.1 `source`): the text path keeps
      // an accepted replacement here until the commit; a well-formed text validated as text
      // is its own baseline (§7.2), a text that is not well-formed compares against the live
      // model's - the last well-formed text's - report (FR-072).
      const range = source.classification?.range ?? { from: 0, to: 0 };
      session.source = {
        text: source.textBefore,
        textBefore: source.textBefore,
        from: range.from,
        to: range.to,
        wellFormed: source.wellFormed,
        changed: false,
        pending: null,
      };
      if (textReport) session.setBaseline(textReport);
    }
    conversationFor(store, docId);
    appendMessage(store, { requestId: this.id, role: 'user', text: options.instruction });
    // The privacy record's first line (US7 T081, FR-042): what the system message carries - the
    // outline (its sections) - and the selection that goes with a selection request, by size.
    this.outlineEntries = outlineOf(session.before);
    this.activity('request.start', {
      kind: this.kind,
      origin: options.origin,
      service: target.name,
      model: target.model,
      outline: { sections: countSections(this.outlineEntries) },
      ...(this.selection
        ? { selection: { characters: this.selection.characters, blocks: this.selection.blocks } }
        : {}),
    });
    this.activity('validate.baseline', {
      errors: session.baselineReport.errorCount,
      warnings: session.baselineReport.warningCount,
      durationMs: session.baselineReport.durationMs,
    });
    if (this.cancelled) return { kind: 'cancelled' };

    // The working context and the system prompt (ai-catalogue §2), built once per request -
    // rebuilt only when the outline is cut (§6.12 step 4). The Description view counts as the
    // Body view here: the working copy is the model and every tool is available (§6 step 3).
    this.contextInput = {
      document: session.before,
      version: this.ctx.version,
      activeView: state.activeView,
      uiLanguage: state.uiLanguage,
      modified: session.modifiedBefore,
      // The Source view's panel request describes the selected text too (the tools see it).
      selection: this.selection ?? sourceSelection,
      caret: this.caret ?? source?.caret?.ref ?? null,
      request: { kind: this.kind, source: options.origin },
      preExistingErrors: session.preExistingErrors,
      ...(source ? { sourceWellFormed: source.wellFormed } : {}),
    };
    this.context = buildWorkingContext(this.contextInput);
    let systemMessage: ChatMessage = { role: 'system', content: systemPrompt(this.context) };

    // The catalogue instance of this turn-on, bound to this request's working copy
    // (ai-catalogue §1, §3; data-model §8.5).
    const holder = selectionHolder(
      source
        ? sourceModelSelection(source, sourceSelection)
        : modelSelectionOf(this.selection ?? sourceSelection, this.caret),
    );
    this.holder = holder;
    const catalogue = await openCatalogue(store);
    if (this.cancelled) return { kind: 'cancelled' };
    catalogue.rebind({
      copy: session.copy,
      selection: holder,
      context: () => this.context as unknown as Record<string, unknown>,
      changesInThisRequest: () => session.changesInThisRequest,
      startedAt: this.startedAt,
      fragmentToXml: (nodes) => this.toXml(docId, nodes as unknown as ModelNodeJson[]),
      fragmentFromXml: async (xml, parent) => {
        this.fromXmlCalls += 1;
        const result = await this.rpc.call('doc.fragmentFromXml', { docId, xml, parent });
        return { nodes: result.nodes, inline: result.inline };
      },
      nextNodeId: this.nextNodeId,
      runRegex: createRegexRunner(createRegexWorker),
      applyChange: this.changeHook(session),
      resultBudget: () => this.resultBudget(),
      // US4 (T061): the `validate` tool runs the session's validation against its baseline;
      // `get_schema` and the schema resources read `schema.text()` once per catalogue instance.
      // US5: in the Source view the text is validated once it is what the request works on
      // (text mode, or after a text-path change), the copy otherwise.
      validate: () =>
        session.source && (session.source.changed || !session.source.wellFormed)
          ? session.validateText(session.source.text)
          : session.validate(),
      baseline: () => session.baseline,
      schemaText: () => this.rpc.call('schema.text'),
      // US6 (ai-catalogue §3.1, §3.4, §7): the scripts - the list, a package's files, the
      // nested run on the request's copy, the FR-084 gate and the proposal dialog.
      scripts: this.scriptsDeps(session),
      // US5 (ai-catalogue §8): the text path of `replace_selection` on a `source` selection and
      // the gate - the six tools of the text mode, the structured change tools after a text
      // change, `run_script` outside the Body view (C8).
      ...(source
        ? {
            replaceSourceText: sourceTextReplacer(session, () => holder.get()),
            gate: sourceToolGate(() => ({
              wellFormed: source.wellFormed,
              structuredAllowed: session.structuredAllowed,
            })),
          }
        : {}),
    });
    this.catalogue = catalogue;

    // The first user message: the fast path (§5.1), the caret-context form of `general` for
    // the popup without a selection (§5.2 item 3, FR-033) or the panel's plain instruction.
    let user: string;
    if (this.selection) {
      user = selectionEditMessage(options.instruction, this.selection);
    } else if (this.caret && options.origin === 'popup') {
      user = caretContextMessage(options.instruction, {
        id: this.caret.id,
        path: this.caret.path,
        xml: await toXml([this.caret.node]),
      });
    } else {
      user = options.instruction;
    }
    // The conversation's earlier turns (§5.2 item 2): a panel request and the popup's general
    // request carry them; the popup's selection request does not (§5.1 item 2).
    if (options.origin === 'panel' || !this.selection) {
      this.turns = historyTurns(store.getState().ai.conversation.messages, this.id);
    }
    // Source text mode (§8.4): the `tools` array holds the restricted six alone.
    const offeredTools =
      source && !source.wellFormed
        ? catalogue
            .tools()
            .filter((tool) =>
              (SOURCE_TEXT_MODE_TOOL_NAMES as readonly string[]).includes(tool.function.name),
            )
        : catalogue.tools();
    const toolsMembers = chatToolsMembers(offeredTools, target.tools);
    const toolCount = 'tools' in toolsMembers ? toolsMembers.tools.length : 0;
    let own: ChatMessage[] = [{ role: 'user', content: user }];
    const compose = (): ChatMessage[] => [
      systemMessage,
      ...turnMessages(this.turns.slice(this.droppedTurns)),
      ...own,
    ];
    let split: SplitState | null = null;
    const nextPart = async (): Promise<void> => {
      own = [{ role: 'user', content: await this.partMessage(split!) }];
      this.publish({ part: { index: split!.done + 1, count: split!.total } });
    };
    /** The §6.12 reductions that need no selection: turns (1), the largest tool result (2), the outline (4). */
    const reduce = async (
      overflow: Extract<ExchangeResult, { kind: 'oversize' }> | null,
    ): Promise<boolean> => {
      const message = overflow?.message;
      const unitsOf = (turns: readonly HistoryTurn[], system: ChatMessage = systemMessage) =>
        JSON.stringify({
          messages: [system, ...turnMessages(turns), ...own],
          ...toolsMembers,
        }).length;
      const fits = (units: number) => fitsContext(units, this.knownContextLength());
      // 1. The oldest turns, one request at a time while any remain (FR-025).
      const remaining = this.turns.slice(this.droppedTurns);
      if (remaining.length > 0) {
        const trimmed = trimTurns(
          remaining,
          (kept) => kept.length < remaining.length && fits(unitsOf(kept)),
        );
        this.droppedTurns += Math.max(1, trimmed.dropped);
        this.activity('history.trimmed', { turns: this.droppedTurns });
        appendMessage(store, {
          requestId: this.id,
          role: 'notice',
          text: t('ai.panel.historyTrimmed', { count: this.droppedTurns }),
        });
        const { conversation } = store.getState().ai;
        actions.updateAi(store, {
          conversation: { ...conversation, droppedTurns: this.droppedTurns },
        });
        return true;
      }
      // 2. The largest tool result of the last round, replaced by its first part (§3.7).
      const lastRound = this.toolMessages.filter((record) => record.round === this.round);
      const candidates = lastRound
        .filter((record) => READ_TOOL_NAMES.has(record.call.name))
        .map((record) => ({ record, size: String(record.message.content ?? '').length }))
        .filter(({ size }) => size > MIN_SHRINKABLE_UNITS)
        .sort((a, b) => b.size - a.size);
      for (const { record, size } of candidates) {
        const shrunk = await this.shrinkToolResult(catalogue, record, Math.floor(size / 2));
        if (!shrunk) continue;
        this.activity('split', {
          what: 'toolResult',
          tool: record.call.name,
          part: 1,
          parts: shrunk.parts,
          ...(message === undefined ? {} : { message }),
        });
        return true;
      }
      // 4. A general request: the outline cut to its first top-level entries, whole subtrees,
      // halving; then the bodies alone; then nothing is left to remove.
      if (this.selection || !this.contextInput) return false;
      const current = this.outlineEntries;
      const withOutline = (entries: OutlineEntry[], more?: WorkingContext['outlineMore']) => {
        const input: WorkingContextInput = {
          ...this.contextInput!,
          outline: entries,
          ...(more ? { outlineMore: more } : {}),
        };
        const context = buildWorkingContext(input);
        return { context, system: { role: 'system', content: systemPrompt(context) } };
      };
      const total = countEntries(outlineOf(session.before));
      let next: { context: WorkingContext; system: ChatMessage; entries: OutlineEntry[] };
      if (this.outlineForm !== 'bodies') {
        const cut = cutOutline(
          current,
          (prefix) =>
            prefix.length < current.length &&
            fits(unitsOf(this.turns.slice(this.droppedTurns), withOutline([...prefix]).system)),
        );
        if (cut.ok && cut.entries.length < current.length) {
          const built = withOutline(cut.entries, cut.more);
          next = { ...built, entries: cut.entries };
          this.outlineForm = 'cut';
        } else {
          const bodies = bodiesAlone(outlineOf(session.before));
          const sections = total - bodies.length;
          const built = withOutline(bodies, {
            cursor: `after:${bodies[bodies.length - 1]?.id ?? ''}`,
            remaining: { entries: sections, characters: outlineCharacters(bodies) },
            hint: 'The outline is reduced to the bodies: call get_outline with node = a body for its sections.',
          });
          next = { ...built, entries: bodies };
          this.outlineForm = 'bodies';
        }
      } else {
        return false;
      }
      this.outlineEntries = next.entries;
      this.context = next.context;
      systemMessage = next.system;
      this.activity('split', {
        what: 'outline',
        part: 1,
        parts: Math.max(2, Math.ceil(total / Math.max(1, countEntries(next.entries)))),
        ...(message === undefined ? {} : { message }),
      });
      return true;
    };

    for (;;) {
      if (this.cancelled) return { kind: 'cancelled' };
      // The pacing wait of the previous answer (`ratelimit-remaining: 0`, §6.7) comes first.
      if (this.pendingPacing) {
        const pacing = this.pendingPacing;
        this.pendingPacing = null;
        const decision = this.budget.take(pacing.seconds);
        if (!decision.ok) {
          return {
            kind: 'failed',
            failure: { kind: 'limit', waitSeconds: decision.waitSeconds },
          };
        }
        this.activity('limit.wait', { seconds: decision.seconds, source: pacing.source });
        await this.waitSeconds(decision.seconds);
        if (this.cancelled) return { kind: 'cancelled' };
      }
      // The pre-emptive estimate against a known context length (§3.7, data-model §5.3): the
      // same reductions as after a refusal, before the exchange goes out.
      for (let guard = 0; guard < 32; guard += 1) {
        const units = JSON.stringify({ messages: compose(), ...toolsMembers }).length;
        if (fitsContext(units, this.knownContextLength())) break;
        if (!(await reduce(null))) break;
        if (this.cancelled) return { kind: 'cancelled' };
      }
      const messages = compose();
      const body: ChatRequest = { messages, ...toolsMembers };
      // Development builds: no docId, path, key or token member leaves with the body (§9, T082).
      assertChatRequestPrivate(body);
      const bytes = JSON.stringify(body).length;
      this.fixedUnits = bytes;
      this.exchanges += 1;
      const n = this.exchanges;
      this.activity('exchange.sent', {
        n,
        messages: messages.length,
        tools: toolCount,
        bytes,
      });
      this.setPhase(t('ai.phase.waiting'));
      this.publish({ state: 'exchanging' });
      let outcome: AiOutcome;
      try {
        outcome = await this.rpc.runJob(
          'ai.complete',
          { target: target.target, body },
          {
            onStart: (jobId) => {
              // A cancel that came while `ai.complete` was on its way found no job to cancel:
              // the job is cancelled now, or the exchange would run to its end in the core.
              if (this.cancelled) cancelJob(this.rpc, jobId);
              else this.jobId = jobId;
            },
          },
        );
      } catch (error) {
        this.jobId = null;
        if (this.cancelled || isCancelledError(error)) return { kind: 'cancelled' };
        if (error instanceof RpcError && error.code === RpcErrorCode.aiNoService) {
          return { kind: 'failed', failure: { kind: 'noService' } };
        }
        throw error;
      }
      this.jobId = null;
      if (this.cancelled) return { kind: 'cancelled' };
      const result = triage(outcome, n);
      this.activity('exchange.answered', {
        n,
        elapsedMs: outcome.elapsedMs,
        finishReason: result.kind === 'answer' ? result.finishReason : result.kind,
        toolCalls: result.kind === 'answer' ? result.message.toolCalls.length : 0,
        ...(outcome.rateLimit ? { rateLimit: outcome.rateLimit } : {}),
      });

      if (result.kind === 'limit') {
        const decision = this.budget.take(result.waitSeconds);
        if (!decision.ok) {
          return {
            kind: 'failed',
            failure: { ...toFailure(result), waitSeconds: decision.waitSeconds },
          };
        }
        this.activity('limit.wait', { seconds: decision.seconds, source: result.waitSource });
        await this.waitSeconds(decision.seconds);
        if (this.cancelled) return { kind: 'cancelled' };
        continue;
      }
      if (result.kind === 'oversize') {
        // An overflow message that names the limit sets the hint for the rest of the session
        // (memory only - review C13).
        if (result.contextLength !== undefined) {
          this.contextLength = result.contextLength;
          actions.updateAi(store, { contextLengthHint: result.contextLength });
        }
        // §6.12 steps 1, 2 and 4: turns, the largest tool result, the outline - then resend.
        if (await reduce(result)) continue;
        if (this.cancelled) return { kind: 'cancelled' };
        if (!this.selection) return { kind: 'failed', failure: toFailure(result) };
        // Step 3: a selection request splits the selection along block boundaries.
        const tooLarge: RequestOutcome = {
          kind: 'failed',
          failure: { kind: 'paragraphTooLarge', message: result.message },
        };
        if (this.selection.form !== 'blocks' || !editorState || !this.selection.pm) {
          return tooLarge;
        }
        const current: PartBlock[] = split
          ? split.pending[0]!
          : blocksOf(editorState, this.selection);
        if (current.length <= 1) return tooLarge;
        const [left, right]: [PartBlock[], PartBlock[]] = halve(current);
        if (!split) split = { pending: [left, right], done: 0, total: 2 };
        else {
          split.pending.splice(0, 1, left, right);
          split.total += 1;
        }
        this.activity('split', {
          what: 'selection',
          part: split.done + 1,
          parts: split.total,
          message: result.message,
        });
        await nextPart();
        continue;
      }
      if (result.kind !== 'answer') return { kind: 'failed', failure: toFailure(result) };

      // An answer (ai-catalogue §6.8). A successful answer with `ratelimit-remaining: 0` and a
      // reset is paced before the next exchange, when one follows (§6.7; FR-023).
      const { message } = result;
      this.pendingPacing = pacingWait(outcome);
      if (result.action === 'truncated') {
        return { kind: 'failed', failure: { kind: 'truncated' } };
      }
      if (result.action === 'tools') {
        own.push(message.echo);
        this.round += 1;
        if (message.text) {
          appendMessage(store, {
            requestId: this.id,
            role: 'assistant',
            text: message.text,
            interim: true,
          });
        }
        // Parallel calls run sequentially in the service's order, each answered by its own
        // `tool` message with the matching id (§6.9).
        for (const call of message.toolCalls) {
          if (this.cancelled) return { kind: 'cancelled' };
          const tool = await this.callTool(catalogue, call);
          const toolMessage: ChatMessage = {
            role: 'tool',
            tool_call_id: call.id,
            content: tool.text,
          };
          own.push(toolMessage);
          this.toolMessages.push({
            message: toolMessage,
            call: { name: call.name, args: argumentsOf(call.arguments) },
            round: this.round,
          });
          if (this.rejectedIssues) {
            return {
              kind: 'rejected',
              issues: this.rejectedIssues,
              ...(message.text ? { text: message.text } : {}),
            };
          }
        }
        continue;
      }

      // A text-only reply (§6.11): the fast path for a selection request, a message otherwise.
      const cutOff = result.action === 'cutOff';
      const text = message.text;
      if (!this.selection) return this.textEnd(text, cutOff);
      const part = split ? split.pending[0]! : null;
      const partSnapshot = split && part ? await this.partSnapshot(split, part) : this.selection;
      const decision = decideTextReply({ text, finishReason: result.finishReason }, partSnapshot, {
        changeToolCalled: this.changeToolCalled,
      });
      if (decision.kind === 'message') return this.textEnd(decision.text, decision.cutOff);
      if (decision.kind === 'noChange') {
        if (!split || !part) return this.nothingToChange();
        // This part stays as it is; the next one follows.
        split.done += 1;
        split.pending.shift();
        split.previousTail = await toXml([part[part.length - 1]!.node]);
        if (split.pending.length === 0) return this.commit(undefined, false, split);
        await nextPart();
        continue;
      }

      // A replacement through the hook (target `selection`).
      this.setPhase(t('ai.phase.validating'));
      this.publish({ state: 'validating' });
      let rejected: ChangeRejected;
      if (this.source && !split) {
        // The Source view (US5, §8.1): the replacement goes through the catalogue's
        // `replace_selection` - `inline` / `blocks` at the model level in the parent's context,
        // `source` as the text path - with the hook behind it (`changeHook` writes the entries).
        const applied = await this.applySourceReplacement(catalogue, decision);
        if (applied.accepted) return this.commit(undefined, false, null);
        rejected = applied;
      } else if (!split || !part) {
        if (!controller) return { kind: 'failed', failure: { kind: 'internal' } };
        const content =
          decision.form === 'inline'
            ? decision.xml !== null
              ? { xml: decision.xml, textFallback: decision.text }
              : { text: decision.text }
            : { xml: decision.xml };
        this.activity('change.try', { tool: 'replace_selection', target: 'selection' });
        const applied = await applyChange(
          session,
          selectionReplacement(session, this.selection, content, controller),
        );
        this.recordChange(applied, 'replace_selection', 'selection', 'body');
        if (applied.accepted) return this.commit(undefined, false, null, applied.result);
        rejected = applied;
      } else {
        const partXml = decision.form === 'inline' ? (decision.xml ?? decision.text) : decision.xml;
        const applied = await this.applyPart(catalogue, split, part, partXml);
        if (applied.accepted) {
          const inserted = (applied.result as { inserted?: { id: string }[] }).inserted ?? [];
          const firstId = inserted[0]?.id;
          const lastId = inserted[inserted.length - 1]?.id;
          if (split.firstInsertedId === undefined && firstId) split.firstInsertedId = firstId;
          if (lastId) split.lastInsertedId = lastId;
          split.done += 1;
          split.pending.shift();
          const place = lastId ? session.copy.place(lastId) : undefined;
          if (place) split.previousTail = await toXml([place.node]);
          if (split.pending.length === 0) return this.commit(undefined, false, split);
          await nextPart();
          continue;
        }
        rejected = applied;
      }
      // Rejected: the third strike ends the request with the three rejections' issues (§6.10.7),
      // else the model is told (§6.11).
      if (rejected.ended) {
        return {
          kind: 'rejected',
          issues: strikeIssues(session, strikeKey('replace_selection', SELECTION_TARGET)),
        };
      }
      own.push(message.echo, { role: 'user', content: rejectionMessage(rejected.issues) });
    }
  }

  /**
   * §6.12 step 2: calls `record`'s read tool again with the same arguments under a budget of
   * `budget` UTF-16 units, so that the result arrives as its first part with `more` (or as the
   * `tooLarge` envelope when its first block alone does not fit - which travels too), and puts
   * the part in the tool message's place. `null` when the result did not get smaller (the
   * caller goes on to the next step).
   */
  private async shrinkToolResult(
    catalogue: Catalogue,
    record: ToolMessageRecord,
    budget: number,
  ): Promise<{ parts: number } | null> {
    const before = String(record.message.content ?? '');
    this.partBudget = budget;
    let outcome: ToolCallOutcome;
    try {
      outcome = await catalogue.call(record.call.name, record.call.args);
    } finally {
      this.partBudget = undefined;
    }
    if (outcome.text.length >= before.length) return null;
    record.message.content = outcome.text;
    const more = outcome.result.more as { remaining?: Record<string, unknown> } | undefined;
    const remaining = more?.remaining;
    const left = Object.values(remaining ?? {}).reduce<number>(
      (max, value) => (typeof value === 'number' ? Math.max(max, value) : max),
      0,
    );
    const parts = outcome.isError ? 1 : 1 + Math.max(1, Math.ceil(left / Math.max(1, budget)));
    return { parts: more ? parts : 1 };
  }

  /* ------------------------------------------------------- the fast path */

  /** The snapshot of one part: the part's blocks in FB2 form, the open ends at the extremes only. */
  private async partSnapshot(split: SplitState, part: PartBlock[]): Promise<SelectionSnapshot> {
    const base = this.selection!;
    const isFirst = split.done === 0;
    const isLast = split.pending.length === 1;
    const nodes = part.map((block) => block.node);
    const xml = await this.toXml(this.store.getState().docId!, nodes);
    const first = part[0]!;
    const last = part[part.length - 1]!;
    const lastSize = containerSize(last.node);
    return {
      ...base,
      openStart: isFirst && base.openStart,
      openEnd: isLast && base.openEnd,
      nodeIds: part.map((block) => block.id),
      anchor: { nodeId: first.id, offset: isFirst ? (base.anchor?.offset ?? 0) : 0 },
      head: { nodeId: last.id, offset: isLast ? (base.head?.offset ?? lastSize) : lastSize },
      xml,
      text: nodes.map((node) => plainText(node)).join('\n'),
      characters: nodes.reduce((sum, node) => sum + plainText(node).length, 0),
      paragraphs: nodes.reduce((sum, node) => sum + textContainers(node), 0),
      blocks: part.length,
      from: { id: first.id, path: base.from?.path ?? '' },
      to: { id: last.id, path: base.to?.path ?? '' },
    };
  }

  /** The user message of the current part (§5.1 with `{{partNote}}`). */
  private async partMessage(split: SplitState): Promise<string> {
    const part = split.pending[0]!;
    const snapshot = await this.partSnapshot(split, part);
    const note: SelectionPart = {
      index: split.done + 1,
      count: split.total,
      ...(split.previousTail ? { previousTail: split.previousTail } : {}),
    };
    return selectionEditMessage(this.options.instruction, snapshot, note);
  }

  /**
   * Applies one part's replacement through the catalogue's `replace_selection` - at the model
   * level, so that the parts accumulate in the working copy - with the hook behind it; the
   * hook's outcome is the result.
   */
  private async applyPart(
    catalogue: Catalogue,
    split: SplitState,
    part: PartBlock[],
    xml: string,
  ): Promise<ChangeOutcome<Record<string, unknown>>> {
    const snapshot = await this.partSnapshot(split, part);
    this.holder!.set(modelSelectionOf(snapshot, this.caret));
    this.lastChangeOutcome = null;
    const outcome = await catalogue.call('replace_selection', { content: { xml } });
    const recorded = this.lastChangeOutcome;
    if (recorded) return recorded;
    // The catalogue refused the call before the hook: not a strike, an internal failure.
    throw new Error(outcome.error?.message ?? 'replace_selection did not reach the hook');
  }

  /**
   * The fast-path replacement in the Source view (US5): through the catalogue's
   * `replace_selection` on the request's selection - `{xml}` (or `{text}` for a plain inline
   * reply); an inline reply whose XML does not parse as inline content is applied as plain
   * text afterwards (§5.1 row i - the second attempt is one of the same strike key).
   */
  private async applySourceReplacement(
    catalogue: Catalogue,
    decision: Extract<ReturnType<typeof decideTextReply>, { kind: 'replacement' }>,
  ): Promise<ChangeOutcome<Record<string, unknown>>> {
    const attempt = async (
      content: { xml: string } | { text: string },
    ): Promise<ChangeOutcome<Record<string, unknown>>> => {
      this.lastChangeOutcome = null;
      const outcome = await catalogue.call('replace_selection', { content });
      const recorded: ChangeOutcome<Record<string, unknown>> | null = this.lastChangeOutcome;
      if (recorded) return recorded;
      throw new Error(outcome.error?.message ?? 'replace_selection did not reach the hook');
    };
    if (decision.form !== 'inline') return attempt({ xml: decision.xml });
    if (decision.xml === null) return attempt({ text: decision.text });
    const first = await attempt({ xml: decision.xml });
    if (first.accepted || first.ended || first.stage !== 'parse') return first;
    return attempt({ text: decision.text });
  }

  /* ------------------------------------------------------------- tools */

  private async callTool(catalogue: Catalogue, call: ToolCallEntry): Promise<ToolCallOutcome> {
    const { t, store } = this;
    const session = this.session!;
    this.setPhase(t('ai.phase.runningTool', { tool: call.name }));
    this.publish({ state: 'executingTools' });
    // The `tool.call` entry names what is about to be read or changed (the privacy record,
    // US7 scenario 3); the result completes it with sizes and counts (`summaries.ts`).
    const summarised: SummarisedCall = { name: call.name, args: argumentsOf(call.arguments) };
    const entry = this.activity('tool.call', {
      name: call.name,
      summary: callSummary(t, summarised, session.copy.document),
    });
    if (failNextTool && failNextTool.name === call.name) {
      const { message } = failNextTool;
      failNextTool = null;
      throw new Error(message);
    }
    const hookCallsBefore = this.hookCalls;
    let outcome: ToolCallOutcome;
    if (call.problem) {
      const envelope = { error: { code: call.problem.code, message: call.problem.message } };
      outcome = {
        text: JSON.stringify(envelope),
        result: envelope,
        isError: true,
        error: envelope.error,
      };
    } else {
      outcome = await catalogue.call(
        call.name,
        call.arguments as string | Record<string, unknown> | null | undefined,
      );
    }
    // The model took the tool route for a change (the hook ran): a later text reply is a
    // message, not the replacement (ai-catalogue §5.1 row b; read tools do not count - C7).
    if (this.hookCalls > hookCallsBefore) this.changeToolCalled = true;
    if (outcome.isError) {
      this.activity('tool.error', {
        name: call.name,
        code: outcome.error?.code ?? 'internal',
        message: outcome.error?.message ?? '',
        ...(outcome.error?.hint === undefined ? {} : { hint: outcome.error.hint }),
        ...(outcome.error?.expected === undefined ? {} : { expected: outcome.error.expected }),
        ...(outcome.error?.strike ? { strike: outcome.error.strike } : {}),
      });
      return outcome;
    }
    // A continued read counts its parts; the completed summary replaces the provisional one.
    const key = continuationKey(summarised);
    const part = summarised.args.cursor === undefined ? 1 : (this.partCounters.get(key) ?? 1) + 1;
    this.partCounters.set(key, part);
    const summary = resultSummary(t, summarised, outcome.result, session.copy.document, { part });
    if (summary) updateActivity(store, entry, { summary });
    this.activity('tool.result', { name: call.name, summary: summary ?? call.name });
    return outcome;
  }

  /* ------------------------------------------------------- scripts (US6) */

  /** The scripts feature of the store (installed by the registrar), attached; `unavailable` without one. */
  private scriptsFeature(): ScriptsFeature {
    const feature = getScriptsFeature(this.store);
    if (!feature) throw new ToolError('unavailable', 'The scripts are not available.');
    feature.ensureAttached(this.ctx);
    return feature;
  }

  /** A script of the feature's list as the catalogue lists it (names in the UI language). */
  private catalogueScript(script: ScriptInfo): CatalogueScript {
    const language = this.store.getState().uiLanguage;
    const description = script.description?.[language] ?? script.description?.en;
    return {
      id: script.id,
      name: scriptName(script, language),
      ...(description ? { description } : {}),
      kind: script.kind,
      needsSelection: script.needsSelection,
      group: script.group,
      source: script.source,
      folder: script.dir,
    };
  }

  /** The loader's issues as one line each (`list_scripts.issues`, `reload_scripts.issues`). */
  private scriptIssues(feature: ScriptsFeature): string[] {
    return feature.issues.map(
      (issue) =>
        `${issue.reason}: ${issue.message}${issue.id ? ` (${issue.id})` : ''}${issue.path ? ` - ${issue.path}` : ''}`,
    );
  }

  /**
   * The scripts surface of the catalogue (`CatalogueDeps.scripts`; ai-catalogue §3.1, §3.4,
   * §7): the effective list and the files through the scripts feature and the core, the nested
   * run on the request's working copy, the FR-084 gate and the proposal dialog with its write.
   */
  private scriptsDeps(session: RequestSession): ScriptsDeps {
    const { store } = this;
    let dataDir: Promise<string> | null = null;
    return {
      list: async () => {
        const feature = this.scriptsFeature();
        if (!feature.loaded) await feature.refresh();
        return {
          scripts: feature.all().map((script) => this.catalogueScript(script)),
          issues: this.scriptIssues(feature),
        };
      },
      files: async (id) => {
        const source = (await this.rpc.call('scripts.source', {
          scriptId: id,
        })) as unknown as ScriptSourceResult;
        return { folder: source.dir, entry: source.entry, files: source.files };
      },
      readFile: (id, file) => readScriptFile(id, file),
      reload: async () => {
        const feature = this.scriptsFeature();
        await this.rpc.call('scripts.reload');
        await feature.refresh();
        return { count: feature.all().length, issues: this.scriptIssues(feature) };
      },
      // The Description view is not the Body view for a run (review C8): the script's dialogs
      // and selection calls need the Body editor.
      bodyView: () => store.getState().activeView === 'body' && !this.source,
      dataDir: () => {
        dataDir ??= this.rpc.call('app.info').then((info) => info.dataDir);
        return dataDir;
      },
      uiLanguage: () => store.getState().uiLanguage,
      run: (script, treeNode) => this.runNestedScript(session, script, treeNode),
      runAllowed: (id) =>
        runAllowed(writtenScripts.get(id), { id: this.id, instructionAt: this.instructionAt }),
      propose: (proposal) => this.proposeScript(session, proposal),
    };
  }

  /**
   * `run_script` (T076; data-model §6.6; review C10): the script host runs the script nested in
   * this request - from the working copy, with no lock, banner, undo entry or `scripts.lastRun`
   * of its own, nothing published, its dialogs captioned as run by the assistant (the
   * `script.dialog` entry when one opens); the banner says "running script <name>"; the
   * banner's Cancel ends the run and the request together (`cancel()`).
   */
  private async runNestedScript(
    session: RequestSession,
    script: CatalogueScript,
    treeNode?: { nodeId: string; type: string },
  ): Promise<NestedRunOutcome> {
    const { t, store, ctx } = this;
    const feature = this.scriptsFeature();
    const info = feature.find(script.id);
    if (!info) return { status: 'unavailable', message: `unknown script "${script.id}"` };
    if (feature.host.isRunning) {
      return { status: 'unavailable', message: 'another script is running' };
    }
    const name = scriptName(info, store.getState().uiLanguage);
    this.setPhase(t('ai.phase.runningScript', { name }));
    // The `script.dialog` entry: written once per dialog the nested run opens (the host's
    // `waiting` flag flips while a message, prompt or form is up).
    let waiting = false;
    const unsubscribe = feature.host.subscribe(() => {
      const state = feature.host.current;
      const now = !!state && state.status === 'running' && state.waiting;
      if (now && !waiting) this.activity('script.dialog', { id: script.id, name });
      waiting = now;
    });
    this.nestedHost = feature.host;
    const started = Date.now();
    try {
      const result = await feature.host.run(
        info,
        {
          rpc: this.rpc,
          dialogs: ctx.dialogs,
          t,
          uiLanguage: store.getState().uiLanguage,
          ...(treeNode ? { treeNode } : {}),
        },
        { nested: { workingCopy: session.copy, session: session.run } },
      );
      const durationMs = Date.now() - started;
      switch (result.status) {
        case 'done':
          return { status: 'done', document: result.document ?? null, durationMs };
        case 'failed':
          return {
            status: 'failed',
            message: result.message ?? result.error?.message ?? 'the script failed',
            durationMs,
          };
        case 'cancelled':
          return { status: 'cancelled', durationMs };
        default:
          return { status: 'unavailable', message: result.message ?? result.status };
      }
    } finally {
      unsubscribe();
      this.nestedHost = null;
    }
  }

  /**
   * `propose_script` after the pre-checks (T077; ai-catalogue §7.3-§7.5; data-model §10.2):
   * the dialog over the locked document; *Write* / *Write and run* → `scripts.write` with the
   * author line in the entry module, the written script remembered for the FR-084 gate (with
   * the permission of *Write and run* for this request), the feature's list refreshed (the
   * core re-read the scripts and the menu follows `resources.changed`), the `script.proposed`
   * entry; *Don't write* (the button, Escape, the banner's Cancel) → declined, nothing written.
   * A write the core refuses rejects with its `RpcError` (the catalogue maps it).
   */
  private async proposeScript(
    session: RequestSession,
    proposal: ScriptProposal,
  ): Promise<ProposalDecision> {
    const { t, ctx } = this;
    const files = proposal.files.map((file) => ({ path: file.path, bytes: file.bytes }));
    const result = await showProposal(ctx, proposal, {
      defaultAuthorLine: defaultAuthorLine(t),
      run: session.run,
    });
    if (result.decision === 'decline' || this.cancelled) {
      this.activity('script.proposed', { id: proposal.scriptId, files, written: false });
      return { written: false, declined: true };
    }
    const written = await this.rpc.call('scripts.write', {
      id: proposal.scriptId,
      group: proposal.group,
      folder: proposal.folder,
      files: filesToWrite(proposal, result.authorLine),
      ...(proposal.existing ? { overwrite: true } : {}),
    });
    const runRequested = result.decision === 'writeAndRun';
    writtenScripts.set(proposal.scriptId, {
      id: proposal.scriptId,
      requestId: this.id,
      writtenAt: tick(),
      runRequested,
    });
    // The core rescanned and notified; the feature's list is refreshed here too so that the
    // model's next list_scripts / run_script sees the script at once (SC-011).
    await this.scriptsFeature().refresh();
    this.activity('script.proposed', {
      id: proposal.scriptId,
      files,
      written: true,
      runRequested,
      path: written.path,
    });
    return {
      written: true,
      id: written.id,
      path: written.path,
      warnings: written.warnings,
      runRequested,
    };
  }

  /**
   * The validity hook behind every change tool of the catalogue (ai-catalogue §6.10): the
   * tool's pre-check, parse and argument refusals (a `ToolError` with a strike code) become
   * `ChangeRejection`s - rolled back and counted for the key like the hook's own rejection
   * (review C4); a gate or failure (`unavailable`, `runNotConfirmed`, `scriptFailed`,
   * `cancelled`, `internal`) is rolled back too but counts nothing and is answered as it is.
   */
  private changeHook(session: RequestSession): ChangeHook {
    return async <T extends object>(
      key: string,
      change: () => Promise<T>,
      options?: ChangeHookOptions,
    ) => {
      const colon = key.indexOf(':');
      const tool = colon < 0 ? key : key.slice(0, colon);
      const target = colon < 0 ? '' : key.slice(colon + 1);
      this.hookCalls += 1;
      this.activity('change.try', { tool, target });
      // Where the change goes, from the target as it stands before the change (a removed node
      // cannot be resolved afterwards) - FR-106.
      const place = this.placeOf(tool, target, session.copy.document);
      const thrown: { error: ToolError | null } = { error: null };
      let outcome: ChangeOutcome<T>;
      try {
        outcome = await applyChange<T>(session, {
          tool,
          target,
          apply: async () => {
            try {
              return await change();
            } catch (error) {
              if (error instanceof ToolError) {
                thrown.error = error;
                throw rejectionFromEnvelope(error.body) ?? error;
              }
              throw error;
            }
          },
          // The Source text path (US5): the spliced text validated whole instead of the copy.
          ...(options?.textPath && this.holder ? textPathSpec(session, this.holder) : {}),
        });
      } catch (error) {
        // A gate or failure: the copy is back at the checkpoint, no strike, the envelope as is.
        if (error === thrown.error && thrown.error) return thrown.error.envelope();
        throw error;
      }
      this.lastChangeOutcome = outcome as ChangeOutcome<Record<string, unknown>>;
      this.recordChange(outcome, tool, target, place);
      if (outcome.accepted) return outcome.result;
      if (outcome.ended) this.rejectedIssues = strikeIssues(session, key);
      if (thrown.error) return { error: { ...thrown.error.body, strike: outcome.strike } };
      return rejectedEnvelope(outcome) as ToolErrorEnvelope;
    };
  }

  /**
   * Where a change tool's change goes (FR-106), from its strike target (ai-catalogue §3.5)
   * before the change runs: the description for `set_description`; the root of the target
   * node - a body or a description root (the annotation, the history) - for the node tools;
   * the bodies for `replace_all` and a Body selection; `unknown` for a nested script run and
   * the Source view's text path, which the commit's diff decides.
   */
  private placeOf(tool: string, target: string, document: Document): ChangePlace {
    switch (tool) {
      case 'set_description':
        return 'description';
      case 'replace_all':
        return 'body';
      case 'replace_selection':
        return this.holder?.get().kind === 'source' ? 'unknown' : 'body';
      case 'run_script':
        return 'unknown';
      case 'replace_node':
      case 'remove_node':
      case 'set_text':
      case 'insert_node': {
        const at = target.indexOf('@');
        const reference = tool === 'insert_node' && at >= 0 ? target.slice(at + 1) : target;
        if (!reference) return 'unknown';
        let entry: ReturnType<typeof resolveReference>;
        try {
          entry = resolveReference(indexDocument(document), reference);
        } catch {
          entry = null;
        }
        if (!entry) return 'unknown';
        return inDescription(entry) ? 'description' : 'body';
      }
      default:
        return 'unknown';
    }
  }

  /** The activity entries of a change's outcome (`validate`, `change.accepted` / `change.rejected`). */
  private recordChange(
    outcome: ChangeOutcome<unknown>,
    tool: string,
    target: string,
    place: ChangePlace,
  ): void {
    const session = this.session!;
    if (outcome.accepted) {
      this.changesByTool.set(tool, (this.changesByTool.get(tool) ?? 0) + 1);
      // The place of the change for the end line (FR-106); `set_description` names its fields.
      const fields = (outcome.result as { fields?: unknown } | undefined)?.fields;
      this.placedChanges.push({
        place,
        fields:
          tool === 'set_description' && Array.isArray(fields)
            ? fields.filter((field): field is string => typeof field === 'string')
            : [],
      });
      this.activity('validate', {
        new: 0,
        preExisting: session.preExistingErrors,
        durationMs: outcome.report.durationMs,
      });
      this.activity('change.accepted', { tool, target, summary: tool });
      return;
    }
    if (outcome.report) {
      this.activity('validate', {
        new: outcome.issues.length,
        preExisting: session.preExistingErrors,
        durationMs: outcome.report.durationMs,
      });
    }
    this.activity('change.rejected', {
      tool,
      target,
      code: outcome.code,
      issues: outcome.issues,
      strike: outcome.strike,
    });
  }

  /* ------------------------------------------------------------- the end */

  /** A text answer: committed when changes were made (review C5), else `answered` / `askedBack`. */
  private async textEnd(text: string, cutOff: boolean): Promise<RequestOutcome> {
    const session = this.session!;
    if (session.changesInThisRequest > 0) return this.commit(text, cutOff, null);
    return this.wordsOnly(text, cutOff);
  }

  /**
   * The end of a request that changed nothing (§5.2): `askedBack` when the text is a question
   * by wording, `answered` otherwise; a text that claims a change - "I have translated the
   * title" - which no tool made is marked `claimedChange`, so that the panel shows it as words
   * only and never as done (FR-106: the rc.1 smoke test read such an answer as done).
   */
  private wordsOnly(text: string, cutOff: boolean): RequestOutcome {
    return {
      kind: isQuestion(text) ? 'askedBack' : 'answered',
      text,
      ...(cutOff ? { cutOff: true } : {}),
      ...(claimsChange(text) ? { claimedChange: true } : {}),
    };
  }

  /** Row d of the fast-path table: the reply equals the selection (FR-043: nothing changes). */
  private nothingToChange(): RequestOutcome {
    return { kind: 'answered', text: this.t('ai.popup.nothingToChange') };
  }

  /** The commit (ai-catalogue §6.14): the last validation, one undo step, the replacement selected. */
  private async commit(
    text: string | undefined,
    cutOff: boolean,
    split: SplitState | null,
    replacement?: SelectionReplacementResult,
  ): Promise<RequestOutcome> {
    const session = this.session!;
    this.setPhase(this.t('ai.phase.validating'));
    this.publish({ state: 'committing' });
    // The Source view (US5, §8.3): the text path's one `doc.fromXml` with the binary store
    // asserted, the structured path's re-render, the caret at the first change.
    const result = this.source
      ? await commitSource({
          ctx: this.ctx,
          rpc: this.sessionRpc ?? this.rpc,
          session,
          state: this.source,
          firstChangedNodeId: firstChangedNodeId(session),
          insertedIds: this.insertedIds(),
        })
      : await session.commit();
    switch (result.kind) {
      case 'committed':
        if (!this.source) this.selectReplacement(split, replacement);
        // Where the changes went (FR-106): the places known per change, the unknown ones
        // decided by the diff of the document before and after.
        this.places = summarisePlaces(
          this.placedChanges,
          this.placedChanges.some((change) => change.place === 'unknown')
            ? documentDiff(session.before, result.after)
            : { descriptionChanged: false, bodiesChanged: false },
        );
        return {
          kind: 'committed',
          ...(text === undefined ? {} : { text }),
          ...(cutOff ? { cutOff: true } : {}),
          undo: { label: undoLabel(this.options.instruction) },
          changes: this.places,
        };
      case 'unchanged':
        if (text === undefined) return this.nothingToChange();
        return this.wordsOnly(text, cutOff);
      case 'lost':
        return { kind: 'cancelled' };
      default:
        return {
          kind: 'failed',
          failure:
            result.failure.kind === 'binariesChanged'
              ? { kind: 'binariesChanged' }
              : { kind: 'invalidAtEnd', errors: result.failure.errors },
        };
    }
  }

  /**
   * The ids of the nodes a fast-path replacement of the Source view inserted (selected in the
   * re-rendered text): the last accepted `replace_selection`'s `inserted` list.
   */
  private insertedIds(): string[] {
    const session = this.session!;
    for (let i = session.changes.length - 1; i >= 0; i -= 1) {
      const record = session.changes[i]!;
      if (record.tool !== 'replace_selection' || !record.outcome?.accepted) continue;
      const inserted = (record.outcome.result as { inserted?: { id?: unknown }[] } | undefined)
        ?.inserted;
      return (inserted ?? [])
        .map((node) => node.id)
        .filter((id): id is string => typeof id === 'string' && id !== '');
    }
    return [];
  }

  /** Selects the replacement in the Body view (FR-031): by its nodes, else by its range. */
  private selectReplacement(
    split: SplitState | null,
    replacement: SelectionReplacementResult | undefined,
  ): void {
    const controller = this.controller;
    const state = controller?.editorState;
    if (!controller || !state) return;
    let firstId: string | undefined;
    let lastId: string | undefined;
    if (split) {
      firstId = split.firstInsertedId;
      lastId = split.lastInsertedId;
    } else if (replacement && replacement.inserted.length > 0) {
      firstId = replacement.inserted[0]!.id;
      lastId = replacement.inserted[replacement.inserted.length - 1]!.id;
    }
    const doc = state.doc;
    let from = -1;
    let to = -1;
    if (firstId && lastId) {
      doc.descendants((node, pos) => {
        const id = node.attrs.nodeId;
        const inner = node.isTextblock || !node.isLeaf;
        if (id === firstId) from = inner ? pos + 1 : pos;
        if (id === lastId) to = inner ? pos + node.nodeSize - 1 : pos + node.nodeSize;
        return from < 0 || to < 0;
      });
    }
    if ((from < 0 || to < from) && replacement && !split) {
      from = replacement.range.from;
      to = replacement.range.to;
    }
    if (from < 0 || to < from || to > doc.content.size) return;
    try {
      const selection = TextSelection.between(doc.resolve(from), doc.resolve(to));
      controller.apply(state.tr.setSelection(selection).scrollIntoView());
    } catch {
      // The replacement is in the document; its selection is a convenience (FR-031).
    }
  }

  /** The end of the request: the session ended, the entries written, the view released. */
  private finish(outcome: RequestOutcome): RequestOutcome {
    if (this.ended) return outcome;
    const { store, t } = this;
    const session = this.session;
    if (session && !session.ended) session.discard();
    // The instance of the turn-on stays; it is bound to nothing between requests.
    if (this.catalogue) this.catalogue.rebind(unboundDeps());
    this.catalogue = null;
    this.waitAbort?.();
    const elapsedMs = Date.now() - this.startedAt;
    if (session) {
      // Only a request that got as far as the lock has entries (a notice answered No has none).
      // The final text carries its `appliedLine` for the history of the next request (§5.2).
      switch (outcome.kind) {
        case 'committed': {
          // The end line names the count and the place of the changes (FR-106): `changes` is
          // the `ChangePlaces` object - the Body text, the Description with its fields, or both.
          const places: ChangePlaces = this.places ?? {
            total: session.changesInThisRequest,
            body: session.changesInThisRequest,
            description: 0,
            fields: [],
          };
          this.activity('request.done', {
            changes: places,
            exchanges: this.exchanges,
            elapsedMs,
          });
          appendMessage(store, {
            requestId: this.id,
            role: 'assistant',
            text: outcome.text ?? t('ai.end.committed'),
            appliedLine: appliedLine(this.changesByTool),
            undoLabel: outcome.undo?.label ?? undoLabel(this.options.instruction),
            ...(outcome.cutOff ? { cutOff: true as const } : {}),
          });
          break;
        }
        case 'answered':
        case 'askedBack':
          // Words only: nothing changed; a text that claims a change no tool made is marked
          // so that the panel says so beside it (FR-106).
          this.activity(
            outcome.kind === 'answered' ? 'request.answered' : 'request.askedBack',
            outcome.claimedChange ? { claimedChange: true } : undefined,
          );
          appendMessage(store, {
            requestId: this.id,
            role: 'assistant',
            text: outcome.text,
            appliedLine: appliedLine({}),
            ...(outcome.cutOff ? { cutOff: true as const } : {}),
          });
          break;
        case 'cancelled':
          this.activity('request.cancelled');
          appendMessage(store, { requestId: this.id, role: 'notice', text: t('ai.end.cancelled') });
          break;
        case 'failed': {
          // The service's words reach the record and the notice with the configured key masked
          // (ai-service-protocol §9, review C16) - the panel masks again when it renders.
          const key = displayKeyOf(store.getState().settings);
          const failure = outcome.failure as Failure;
          this.activity('request.failed', {
            kind: failure.kind,
            ...(failure.message === undefined ? {} : { message: maskKey(failure.message, key) }),
          });
          appendMessage(store, {
            requestId: this.id,
            role: 'notice',
            text: failureText(t, failure, key),
          });
          break;
        }
        default:
          this.activity('request.rejected', { issues: outcome.issues });
          appendMessage(store, { requestId: this.id, role: 'notice', text: t('ai.end.rejected') });
          break;
      }
    }
    lastRequest = {
      id: this.id,
      state: outcome.kind,
      exchanges: this.exchanges,
      validations: (session?.validations ?? []).map((v) => ({ durationMs: v.durationMs })),
      fromXmlCalls: this.fromXmlCalls,
      changes: session?.changesInThisRequest ?? 0,
      ...(outcome.kind === 'committed' && this.places ? { places: this.places } : {}),
      ...((outcome.kind === 'answered' || outcome.kind === 'askedBack') && outcome.claimedChange
        ? { claimedChange: true }
        : {}),
    };
    this.ended = true;
    if (store.getState().ai.request?.id === this.id) actions.updateAi(store, { request: null });
    return outcome;
  }

  /* ----------------------------------------------------------- helpers */

  /** A limit wait with its countdown (FR-023); cut short by `cancel()`. */
  private waitSeconds(seconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let left = seconds;
      const show = () => {
        this.setPhase(this.t('ai.phase.limitWait', { seconds: left }));
        this.publish({ state: 'waiting', countdown: left });
      };
      const done = () => {
        clearInterval(timer);
        this.waitAbort = null;
        this.publish({ countdown: undefined });
        resolve();
      };
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) done();
        else show();
      }, 1000);
      this.waitAbort = done;
      show();
    });
  }

  private async toXml(docId: string, nodes: ModelNodeJson[]): Promise<string> {
    const { xml } = await this.rpc.call('doc.fragmentToXml', {
      docId,
      nodes: nodes as unknown as FragmentNode[],
    });
    return xml;
  }
}

/** The blocks of a block selection as the slice renders them (a partial first / last block trimmed). */
function blocksOf(editorState: EditorState, selection: SelectionSnapshot): PartBlock[] {
  const { from, to } = selection.pm!;
  const blocks: PartBlock[] = [];
  editorState.doc.slice(from, to).content.forEach((child) => {
    const node = nodeToModel(child);
    blocks.push({ id: idOf(node), node });
  });
  return blocks;
}

export { openAskPopup } from './AskPopup';
