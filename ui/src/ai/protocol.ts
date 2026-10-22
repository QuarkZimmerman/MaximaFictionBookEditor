/**
 * The OpenAI-compatible service protocol as the assistant interprets it (feature 005 T042;
 * contracts/ai-service-protocol.md §3–§6 and §9, data-model §4.5, §9.3–§9.4; FR-023, FR-024;
 * review D2, D3, C16): the core performs one HTTP exchange per `ai.complete` call and returns an
 * `AiOutcome` without reading the body; this module reads it - the triage of an outcome into an
 * `ExchangeResult`, the parsing of the model's message (content forms, tool calls, the echo),
 * the argument coercion, the seven-row error-extraction ladder, the status classes, the wait
 * sources with the 300 s budget per request, the overflow detection and the plain-text rendering
 * rules of a service message (the HTML reduction through an inert document, the 2 000-character
 * cap, the configured key masked). Every function is pure; nothing here contacts a service,
 * touches the store or the live DOM. The module belongs to the lazy `ai-assistant` chunk.
 *
 * Naming: the parsed `choices[0].message` is an `AnswerMessage` here - data-model §9.3 calls it
 * `AssistantMessage`, a name the store already uses for a message of the conversation.
 */

import type { TFunction } from 'i18next';
import { z } from 'zod';

import type { AiOutcome } from '@/rpc/types';

import type { RequestFailure } from './assistant';

/* ------------------------------------------------------------------------ */
/* Constants of the contract                                                 */
/* ------------------------------------------------------------------------ */

/** The wait when a limit names none (§5 item 4; Kilo gives no hint). */
export const DEFAULT_WAIT_SECONDS = 30;
/** The total waiting allowed within one request (§5; FR-023 "5 minutes"). */
export const WAIT_BUDGET_SECONDS = 300;
/** The cap of a message reduced from HTML or plain text (§4 rows 5 and 6). */
export const REDUCED_TEXT_LIMIT = 300;
/** The cap of the message shown to the user (§4). */
export const SHOWN_MESSAGE_LIMIT = 2000;
/** What replaces the configured key in a displayed service text (§9). */
export const KEY_MASK = '•••';
/**
 * The catalogue key of the 3xx failure text "the address redirects — enter the final address"
 * (§4; the integration task adds the text to `ai.{en,ru,uk}.json`).
 */
export const FAILURE_REDIRECT_KEY = 'ai.failure.redirect';

/** The §6 regex: a 400 / 413 whose message matches is an overflow. */
export const OVERFLOW_PATTERN =
  /context length|maximum context|context window|too many tokens|context_length_exceeded|exceeds the available context size|prompt is too long|input is too long|token limit|reduce the length/i;
const CONTEXT_LENGTH_PATTERN = /maximum context length is (\d+)/i;
const REQUESTED_PATTERN = /requested about (\d+)/i;
/** The §5 item 3 regex: a wait named in the message ("Retry after 23s", "Retry after 35 seconds"). */
const RETRY_AFTER_PATTERN = /retry after (\d+)\s*s(?:ec(?:ond)?s?)?\b/i;

const AUTH_CODES = new Set([
  'invalid_api_key',
  'missing_api_key',
  'INVALID_TOKEN',
  'PAID_MODEL_AUTH_REQUIRED',
  'authentication_error',
]);
const MODEL_NOT_FOUND_CODES = new Set(['model_not_found', 'NOT_FOUND', 'model_unavailable']);
const OVERFLOW_CODES = new Set(['context_length_exceeded', 'context_length']);
const KNOWN_FINISH_REASONS = new Set(['tool_calls', 'stop', 'length', 'content_filter']);

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

/** Where a limit wait was read from (§5; the `limit.wait` activity entry). */
export type WaitSource = 'header' | 'body' | 'message' | 'default';

/** A wait before the retry of the same body (§5). */
export interface LimitWait {
  seconds: number;
  source: WaitSource;
}

/** The problem a tool call carries before any tool runs (§3.2: a type other than `function`). */
export interface ToolProblem {
  code: 'invalidArguments';
  message: string;
}

/** One entry of `tool_calls`, normalised (§3.2). */
export interface ToolCallEntry {
  /** As received, or `mfbe_call_<exchange>_<n>` when the service gave none - used in the `tool` message. */
  id: string;
  /** True when the editor made the id. */
  suppliedId: boolean;
  /** `function` when absent; anything else makes the call an `invalidArguments` tool result. */
  type: string;
  /** `function.name`, `''` when missing. */
  name: string;
  /** `function.arguments` as received: a JSON string, an object (some local servers) or absent. */
  arguments: unknown;
  /** The position in `tool_calls`, 0-based. */
  index: number;
  problem?: ToolProblem;
}

/** The parsed `choices[0].message` (§3.2; data-model §9.3 "AssistantMessage"). */
export interface AnswerMessage {
  /** `content` normalised to a string (§3.5 applied), or the `refusal` when the content is empty. */
  text: string;
  /** True when `text` is the service's `refusal`. */
  refusal: boolean;
  /** The calls in the service's order; empty for `tool_calls: []` or no member. */
  toolCalls: ToolCallEntry[];
  /**
   * The message to append to the next request (§2.3, review D3): as received - reasoning members
   * and unknown members included, never read - with `content` normalised to `""` when the member
   * was absent, `role` supplied when missing and the ids the editor made written into the calls.
   */
  echo: Record<string, unknown>;
}

/** What the loop does with an answer, from `finish_reason` and the presence of tool calls (§3.3). */
export type FinishAction =
  /** The final text. */
  | 'text'
  /** Execute the calls, send the results, next exchange. */
  | 'tools'
  /** `length` without calls: the text is shown marked as cut off and never applied. */
  | 'cutOff'
  /** `length` with calls: the calls are not executed, the request ends `failed (truncated)`. */
  | 'truncated';

/** The normalised outcome of one exchange (data-model §9.3). */
export type ExchangeResult =
  | {
      kind: 'answer';
      message: AnswerMessage;
      /** `finish_reason` as received, `''` when absent. */
      finishReason: string;
      action: FinishAction;
      /** False for a value outside `tool_calls` | `stop` | `length` | `content_filter` (recorded in the activity entry). */
      knownFinishReason: boolean;
    }
  | {
      kind: 'limit';
      message: string;
      status?: number;
      serviceCode?: string | number;
      waitSeconds: number;
      waitSource: WaitSource;
    }
  | {
      kind: 'oversize';
      message: string;
      status: number;
      serviceCode?: string | number;
      /** `/maximum context length is (\d+)/i` of the message - the `contextLength` hint. */
      contextLength?: number;
      /** `/requested about (\d+)/i` of the message - the size that failed. */
      requested?: number;
    }
  | {
      kind: 'auth' | 'model';
      message: string;
      status?: number;
      serviceCode?: string | number;
      settingsLink: true;
    }
  | {
      kind: 'service';
      message: string;
      status?: number;
      serviceCode?: string | number;
      /** A 3xx: no redirect is followed - "the address redirects, enter the final address". */
      redirect?: true;
      settingsLink?: true;
    }
  | {
      kind: 'contentFilter' | 'format';
      message: string;
      status?: number;
      serviceCode?: string | number;
    }
  | { kind: 'offline' | 'timeout' | 'tls' | 'cancelled'; message: string };

/** The message and code read from an error body or text (§4 ladder). */
export interface ExtractedError {
  /** The ladder row that matched (4 reads as 1 with the status kept at 200 by the caller). */
  row: 1 | 2 | 3 | 5 | 6 | 7;
  message: string;
  serviceCode?: string | number;
  /** The body's `error.retry_after` in seconds when it is a number (§5 item 2). */
  retryAfterSeconds?: number;
}

/** The class of a failed exchange by status and code (§4 table; data-model §9.4). */
export interface StatusClass {
  kind: 'limit' | 'oversize' | 'auth' | 'model' | 'service';
  /** `auth`, `model` and the 3xx redirect: the failure is shown with a link to the settings page. */
  settingsLink?: true;
  /** A 3xx. */
  redirect?: true;
}

/** The numbers an overflow message names (§6), both optional. */
export interface OverflowHint {
  contextLength?: number;
  requested?: number;
}

/** The decision of the wait budget (FR-023). */
export type WaitDecision =
  /** Wait `seconds` (normalised: ≥ 1, whole) and retry the same body. */
  | { ok: true; seconds: number }
  /** The wait would take the request past the budget: it ends `failed (limit)` reporting `waitSeconds`. */
  | { ok: false; waitSeconds: number };

/** The parsed arguments of a tool call, or the `invalidArguments` envelope (§3.4; ai-catalogue §1.4). */
export type ArgumentsResult =
  | { ok: true; value: Record<string, unknown> }
  | {
      ok: false;
      error: { code: 'invalidArguments'; message: string; expected?: Record<string, unknown> };
    };

/** What `failed` carries (data-model §4.5) plus the 3xx flag of this module. */
export type Failure = RequestFailure & { redirect?: true };

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** A number of seconds given as a number or a numeric string, else undefined. */
function secondsOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return undefined;
}

function numberIn(pattern: RegExp, text: string): number | undefined {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** Collapses whitespace runs to one space and trims. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function withCode<T extends object>(
  result: T,
  serviceCode: string | number | undefined,
  retryAfterSeconds?: number,
): T & { serviceCode?: string | number; retryAfterSeconds?: number } {
  const out: T & { serviceCode?: string | number; retryAfterSeconds?: number } = { ...result };
  if (serviceCode !== undefined) out.serviceCode = serviceCode;
  if (retryAfterSeconds !== undefined) out.retryAfterSeconds = retryAfterSeconds;
  return out;
}

/* ------------------------------------------------------------------------ */
/* Text rendering rules (§3.5, §4, §9; review C16)                           */
/* ------------------------------------------------------------------------ */

/** §3.5: a UTF-8 BOM and surrounding ASCII whitespace removed; U+00A0 and U+202F are kept. */
export function normaliseText(text: string): string {
  return text.replace(/^[\uFEFF\t\n\v\f\r ]+/, '').replace(/[\uFEFF\t\n\v\f\r ]+$/, '');
}

/** §4: cuts a text to `limit` UTF-16 units with a final `…`, never splitting a surrogate pair. */
export function capMessage(text: string, limit = SHOWN_MESSAGE_LIMIT): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return '';
  let cut = limit - 1;
  const last = text.charCodeAt(cut - 1);
  if (cut > 0 && last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/** §9: every occurrence of the configured key in a displayed service text becomes `•••`. */
export function maskKey(text: string, key: string | undefined): string {
  const needle = key?.trim() ?? '';
  if (needle === '') return text;
  return text.split(needle).join(KEY_MASK);
}

/**
 * §4: the service's words as shown - the key masked, one code in parentheses when present, the
 * whole capped at 2 000 characters; plain text (URLs stay text - the caller renders it as such).
 */
export function formatServiceMessage(
  message: string,
  serviceCode?: string | number,
  key?: string,
  limit = SHOWN_MESSAGE_LIMIT,
): string {
  const code = serviceCode === undefined || serviceCode === '' ? '' : `(${String(serviceCode)})`;
  const suffix = code === '' ? '' : ` ${code}`;
  const words = capMessage(maskKey(message.trim(), key), Math.max(0, limit - suffix.length));
  if (words === '') return code;
  return `${words}${suffix}`;
}

/** §4 row 5: whether a non-JSON text is an HTML document or a `<pre>` / `<title>` fragment. */
export function isHtml(text: string): boolean {
  return /^<(?:!doctype\s+html|html|head|body|title|pre)\b/i.test(text.trimStart());
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return HTML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** The regex reduction, used where no `DOMParser` exists (a Node test without a DOM). */
function reduceHtmlByRegex(html: string): string {
  const clean = html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const strip = (fragment: string) => collapse(decodeEntities(fragment.replace(/<[^>]+>/g, ' ')));
  const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/i.exec(clean);
  const fromPre = pre ? strip(pre[1]!) : '';
  if (fromPre !== '') return fromPre;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(clean);
  const fromTitle = title ? strip(title[1]!) : '';
  if (fromTitle !== '') return fromTitle;
  return strip(clean);
}

/**
 * §4 row 5 (review C16): the text of the first `<pre>`, else of `<title>`, else of the body -
 * tags stripped, scripts and styles dropped, whitespace collapsed - read from an inert
 * `DOMParser` document that runs nothing and loads nothing; never the live DOM. Not capped: the
 * caller applies the 300-character rule.
 */
export function reduceHtml(html: string): string {
  if (typeof DOMParser !== 'function') return reduceHtmlByRegex(html);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const fromPre = collapse(doc.querySelector('pre')?.textContent ?? '');
  if (fromPre !== '') return fromPre;
  const fromTitle = collapse(doc.querySelector('title')?.textContent ?? '');
  if (fromTitle !== '') return fromTitle;
  for (const element of doc.querySelectorAll('script, style, noscript, template')) element.remove();
  // the text nodes of the body joined by a space, so that block elements do not run together
  const parts: string[] = [];
  const walker = doc.createTreeWalker(doc.body ?? doc, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeValue) parts.push(node.nodeValue);
  }
  return collapse(parts.join(' '));
}

/* ------------------------------------------------------------------------ */
/* §4 error extraction and the status classes                                */
/* ------------------------------------------------------------------------ */

/** Row 1's code: `error.code`, a top-level `error_type` when the code is numeric (Kilo), else `error.type`. */
function codeOf(
  error: Record<string, unknown>,
  body: Record<string, unknown>,
): string | number | undefined {
  const topLevelType = nonEmptyString(body.error_type);
  const code = error.code;
  if (typeof code === 'number') return topLevelType ?? code;
  if (typeof code === 'string' && code !== '') return code;
  return nonEmptyString(error.type) ?? topLevelType;
}

/**
 * §4: the message and the service code of a failed exchange - the seven rows in order, first
 * match wins: (1) `{error: {message, code?, type?}}`; (2) `{error: '<string>', message?,
 * error_type?}`; (3) `{message}` (Kong); (4) = (1) on a 200; (5) HTML text reduced; (6) plain
 * text trimmed; (7) the status line. Rows 5 and 6 are capped at 300 characters.
 */
export function extractError(source: {
  status?: number;
  body?: unknown;
  text?: string;
}): ExtractedError {
  const { status, body, text } = source;
  let serviceCode: string | number | undefined;
  let retryAfterSeconds: number | undefined;
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error)) {
      serviceCode = codeOf(error, body);
      retryAfterSeconds = secondsOf(error.retry_after);
      const message = nonEmptyString(error.message);
      if (message !== undefined) {
        return withCode({ row: 1, message: message.trim() }, serviceCode, retryAfterSeconds);
      }
    } else if (typeof error === 'string' && error.trim() !== '') {
      const detail = nonEmptyString(body.message);
      const message = detail ? `${error.trim()}: ${detail.trim()}` : error.trim();
      return withCode({ row: 2, message }, nonEmptyString(body.error_type));
    }
    const message = nonEmptyString(body.message);
    if (message !== undefined) {
      return withCode({ row: 3, message: message.trim() }, serviceCode, retryAfterSeconds);
    }
  }
  const raw = typeof body === 'string' ? body : text;
  if (typeof raw === 'string' && raw.trim() !== '') {
    if (isHtml(raw)) {
      const reduced = reduceHtml(raw);
      if (reduced !== '') {
        return withCode(
          { row: 5, message: capMessage(reduced, REDUCED_TEXT_LIMIT) },
          serviceCode,
          retryAfterSeconds,
        );
      }
    } else {
      return withCode(
        { row: 6, message: capMessage(raw.trim(), REDUCED_TEXT_LIMIT) },
        serviceCode,
        retryAfterSeconds,
      );
    }
  }
  const line = status === undefined ? 'HTTP' : `HTTP ${status}`;
  return withCode({ row: 7, message: line }, serviceCode, retryAfterSeconds);
}

/**
 * §6: a 400 or 413 whose `serviceCode` is `context_length_exceeded` / `context_length` or whose
 * message matches `OVERFLOW_PATTERN` is an overflow; the two numbers of the message are kept
 * (the `contextLength` hint and the size that failed). Null when it is not one.
 */
export function detectOverflow(input: {
  status?: number;
  serviceCode?: string | number;
  message: string;
}): OverflowHint | null {
  const { status, serviceCode, message } = input;
  if (status !== 400 && status !== 413) return null;
  const byCode = typeof serviceCode === 'string' && OVERFLOW_CODES.has(serviceCode);
  if (!byCode && !OVERFLOW_PATTERN.test(message)) return null;
  const hint: OverflowHint = {};
  const contextLength = numberIn(CONTEXT_LENGTH_PATTERN, message);
  if (contextLength !== undefined && contextLength > 0) hint.contextLength = contextLength;
  const requested = numberIn(REQUESTED_PATTERN, message);
  if (requested !== undefined && requested > 0) hint.requested = requested;
  return hint;
}

function isLimitCode(code: string | number | undefined): boolean {
  return code === 429 || code === 402 || code === '429' || code === '402';
}

/**
 * §4 "Status-driven interpretation", in the table's order: 429 / 402 (any body) or a code 429 /
 * 402 inside a 200 → `limit`; 503 with `Retry-After` → `limit`; 400 / 413 matching §6 →
 * `oversize`; 401 / 403 or a key-related code → `auth` (settings link); 404 with a model code or
 * 400 `model_unavailable` → `model` (settings link); a 3xx → `service` flagged `redirect`
 * (settings link); anything else → `service`.
 */
export function classifyStatus(input: {
  status?: number;
  serviceCode?: string | number;
  message: string;
  retryAfterSeconds?: number;
}): StatusClass {
  const { status, serviceCode, message, retryAfterSeconds } = input;
  if (status === 429 || status === 402) return { kind: 'limit' };
  if (status === 200 && isLimitCode(serviceCode)) return { kind: 'limit' };
  if (status === 503 && retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    return { kind: 'limit' };
  }
  if (detectOverflow({ status, serviceCode, message }) !== null) return { kind: 'oversize' };
  const code = typeof serviceCode === 'string' ? serviceCode : undefined;
  if (status === 401 || status === 403 || (code !== undefined && AUTH_CODES.has(code))) {
    return { kind: 'auth', settingsLink: true };
  }
  if (
    (status === 404 && code !== undefined && MODEL_NOT_FOUND_CODES.has(code)) ||
    (status === 400 && code === 'model_unavailable')
  ) {
    return { kind: 'model', settingsLink: true };
  }
  if (status !== undefined && status >= 300 && status < 400) {
    return { kind: 'service', redirect: true, settingsLink: true };
  }
  return { kind: 'service' };
}

/* ------------------------------------------------------------------------ */
/* §5 waits                                                                  */
/* ------------------------------------------------------------------------ */

/** §5: a wait of 0 or negative seconds counts as 1 s, fractions round up, a non-number is the default. */
export function normaliseWait(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_WAIT_SECONDS;
  return seconds <= 0 ? 1 : Math.ceil(seconds);
}

/**
 * §5: the wait before the retry of the same body - the first of the `Retry-After` header
 * (`retryAfterSeconds` of the outcome), the body's `error.retry_after`, a number in the message
 * (`RETRY_AFTER_PATTERN`) and the 30 s default; `message` is the extracted service message.
 */
export function waitFor(
  source: { retryAfterSeconds?: number; body?: unknown },
  message: string,
): LimitWait {
  const header = source.retryAfterSeconds;
  if (typeof header === 'number' && Number.isFinite(header)) {
    return { seconds: normaliseWait(header), source: 'header' };
  }
  const error = isRecord(source.body) ? source.body.error : undefined;
  const fromBody = isRecord(error) ? secondsOf(error.retry_after) : undefined;
  if (fromBody !== undefined) return { seconds: normaliseWait(fromBody), source: 'body' };
  const fromMessage = numberIn(RETRY_AFTER_PATTERN, message);
  if (fromMessage !== undefined) return { seconds: normaliseWait(fromMessage), source: 'message' };
  return { seconds: DEFAULT_WAIT_SECONDS, source: 'default' };
}

/**
 * §5 pacing (review D2): a successful answer whose `rateLimit` says `remaining: 0` with a
 * `resetSeconds`, when another exchange follows, is waited out first as a limit wait of source
 * `header`; null otherwise - a failed outcome has its own wait, and without `resetSeconds`
 * nothing is paced.
 */
export function pacingWait(outcome: AiOutcome): LimitWait | null {
  if (!outcome.ok) return null;
  const limit = outcome.rateLimit;
  if (limit === undefined || limit.remaining !== 0) return null;
  const reset = limit.resetSeconds;
  if (typeof reset !== 'number' || !Number.isFinite(reset) || reset <= 0) return null;
  return { seconds: normaliseWait(reset), source: 'header' };
}

/**
 * §5 / FR-023: a wait is honoured only while `waitedSeconds + wait ≤ totalSeconds` (300 s per
 * request); beyond that it is reported, not waited for (LLM7's daily quota of 84 441 s).
 */
export function planWait(
  waitedSeconds: number,
  seconds: number,
  totalSeconds = WAIT_BUDGET_SECONDS,
): WaitDecision {
  const wait = normaliseWait(seconds);
  return waitedSeconds + wait <= totalSeconds
    ? { ok: true, seconds: wait }
    : { ok: false, waitSeconds: wait };
}

/** The running total of the waits of one request against the 300 s budget (`planWait` with state). */
export class WaitBudget {
  #waited = 0;

  constructor(readonly totalSeconds: number = WAIT_BUDGET_SECONDS) {}

  /** The seconds waited so far (every honoured limit and pacing wait). */
  get waitedSeconds(): number {
    return this.#waited;
  }

  get remainingSeconds(): number {
    return Math.max(0, this.totalSeconds - this.#waited);
  }

  /** Reserves a wait: honoured waits are counted; a refused one leaves the total as it is. */
  take(seconds: number): WaitDecision {
    const decision = planWait(this.#waited, seconds, this.totalSeconds);
    if (decision.ok) this.#waited += decision.seconds;
    return decision;
  }
}

/* ------------------------------------------------------------------------ */
/* §3.2 the message, §3.4 the arguments                                      */
/* ------------------------------------------------------------------------ */

/** §3.2: `content` as a string - absent / `null` → `''`, a parts array → its `text` members joined. */
export function normaliseContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        return isRecord(part) && typeof part.text === 'string' ? part.text : '';
      })
      .join('');
  }
  return '';
}

/**
 * §3.2: `choices[0].message` parsed - the text (content normalised, `refusal` when the content is
 * empty), the tool calls with ids supplied as `mfbe_call_<exchange>_<n>` where missing (`n` =
 * the 1-based position), and the echo for the next request kept as received (review D3).
 */
export function parseMessage(message: unknown, exchange = 1): AnswerMessage {
  const record = isRecord(message) ? message : {};
  const content = normaliseText(normaliseContent(record.content));
  const refusalText = typeof record.refusal === 'string' ? normaliseText(record.refusal) : '';
  const refusal = content === '' && refusalText !== '';
  const echo: Record<string, unknown> = { ...record };
  if (typeof echo.role !== 'string') echo.role = 'assistant';
  if (!('content' in echo)) echo.content = '';
  const toolCalls: ToolCallEntry[] = [];
  if (Array.isArray(record.tool_calls)) {
    const echoedCalls: unknown[] = [];
    record.tool_calls.forEach((raw: unknown, index: number) => {
      if (!isRecord(raw)) {
        echoedCalls.push(raw);
        return;
      }
      const givenId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined;
      const id = givenId ?? `mfbe_call_${exchange}_${index + 1}`;
      const type = raw.type === undefined ? 'function' : String(raw.type);
      const fn = isRecord(raw.function) ? raw.function : undefined;
      const name = fn !== undefined && typeof fn.name === 'string' ? fn.name : '';
      const entry: ToolCallEntry = {
        id,
        suppliedId: givenId === undefined,
        type,
        name,
        arguments: fn?.arguments,
        index,
      };
      if (type !== 'function') {
        entry.problem = {
          code: 'invalidArguments',
          message: `unsupported tool call type: ${type}`,
        };
      } else if (name === '') {
        entry.problem = { code: 'invalidArguments', message: 'tool call without a function name' };
      }
      toolCalls.push(entry);
      echoedCalls.push(givenId === undefined ? { ...raw, id } : raw);
    });
    echo.tool_calls = echoedCalls;
  }
  return { text: refusal ? refusalText : content, refusal, toolCalls, echo };
}

/** `z.toJSONSchema` without its `$schema` member (ai-catalogue §1.4 `expected`); undefined when it cannot be derived. */
function expectedOf(schema: z.ZodType): Record<string, unknown> | undefined {
  try {
    const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
    delete json.$schema;
    return json;
  } catch {
    return undefined;
  }
}

/**
 * §3.4 / ai-catalogue §1.6: `function.arguments` parsed - a JSON string (`JSON.parse`; absent or
 * empty → `{}`), or an object accepted as already parsed - then coerced by the tool's zod
 * `schema` when given (`"1"` → 1, `"true"` → true, unknown members dropped). Every mistake is the
 * `invalidArguments` envelope with the parser's or zod's message and `expected` (the explicit
 * JSON schema, else the one derived from `schema`) - a tool result the model can read (FR-054),
 * never an exception.
 */
export function parseArguments(
  raw: unknown,
  options: { schema?: z.ZodType; expected?: Record<string, unknown> } = {},
): ArgumentsResult {
  const expected = options.expected ?? (options.schema ? expectedOf(options.schema) : undefined);
  const invalid = (message: string): ArgumentsResult => ({
    ok: false,
    error: expected
      ? { code: 'invalidArguments', message, expected }
      : { code: 'invalidArguments', message },
  });
  let value: unknown;
  if (raw === undefined || raw === null || raw === '') {
    value = {};
  } else if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return invalid(`arguments are not valid JSON: ${detail}`);
    }
  } else {
    value = raw;
  }
  if (!isRecord(value)) {
    const found = value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`;
    return invalid(`arguments must be a JSON object, not ${found}`);
  }
  if (!options.schema) return { ok: true, value };
  const parsed = options.schema.safeParse(value);
  if (!parsed.success) return invalid(z.prettifyError(parsed.error));
  return isRecord(parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid('arguments must be a JSON object');
}

/* ------------------------------------------------------------------------ */
/* §3.1 triage                                                               */
/* ------------------------------------------------------------------------ */

function formatResult(status: number, body: unknown): ExchangeResult {
  const json = JSON.stringify(body) ?? '';
  return { kind: 'format', status, message: capMessage(json, REDUCED_TEXT_LIMIT) };
}

/** §3.2–§3.3: an answer from `choices[0]`. */
function answerOf(
  choice: Record<string, unknown>,
  exchange: number,
  status: number,
): ExchangeResult {
  const message = parseMessage(choice.message, exchange);
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : '';
  if (finishReason === 'content_filter') {
    return { kind: 'contentFilter', message: message.text, status };
  }
  const hasCalls = message.toolCalls.length > 0;
  let action: FinishAction;
  if (finishReason === 'length') action = hasCalls ? 'truncated' : 'cutOff';
  else action = hasCalls ? 'tools' : 'text';
  return {
    kind: 'answer',
    message,
    finishReason,
    action,
    knownFinishReason: KNOWN_FINISH_REASONS.has(finishReason),
  };
}

/** §4–§6: a failed exchange (an `http` outcome, or a 200 with `error` and no `choices`). */
function failureOf(
  source: { status?: number; body?: unknown; text?: string },
  retryAfterSeconds: number | undefined,
): ExchangeResult {
  const extracted = extractError(source);
  const { status } = source;
  const { message, serviceCode } = extracted;
  const statusPart = status !== undefined ? { status } : {};
  const codePart = serviceCode !== undefined ? { serviceCode } : {};
  const klass = classifyStatus({ status, serviceCode, message, retryAfterSeconds });
  switch (klass.kind) {
    case 'limit': {
      const wait = waitFor({ retryAfterSeconds, body: source.body }, message);
      return {
        kind: 'limit',
        ...statusPart,
        ...codePart,
        message,
        waitSeconds: wait.seconds,
        waitSource: wait.source,
      };
    }
    case 'oversize': {
      const hint = detectOverflow({ status, serviceCode, message }) ?? {};
      return { kind: 'oversize', status: status ?? 0, ...codePart, message, ...hint };
    }
    case 'auth':
    case 'model':
      return { kind: klass.kind, ...statusPart, ...codePart, message, settingsLink: true };
    case 'service':
      return klass.redirect
        ? {
            kind: 'service',
            ...statusPart,
            ...codePart,
            message,
            redirect: true,
            settingsLink: true,
          }
        : { kind: 'service', ...statusPart, ...codePart, message };
  }
}

/**
 * §3.1: an `AiOutcome` → `ExchangeResult`. `ok` with a non-empty `choices` → `answer` (or
 * `contentFilter`); `ok` with `error` and no choices → the error rules with `status: 200`; `ok`
 * otherwise → `format` with the first 300 characters of the JSON; `http` → the error rules
 * (limit, oversize, auth, model, service - a 3xx included); the transport kinds → themselves with
 * the transport's message. `exchange` numbers the ids supplied to calls without one.
 */
export function triage(outcome: AiOutcome, exchange = 1): ExchangeResult {
  if (outcome.ok) {
    const { body, status } = outcome;
    if (isRecord(body)) {
      const choices = body.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const first: unknown = choices[0];
        if (isRecord(first) && isRecord(first.message)) return answerOf(first, exchange, status);
        return formatResult(status, body);
      }
      if (body.error !== undefined && body.error !== null) {
        return failureOf({ status, body }, outcome.retryAfterSeconds);
      }
    }
    return formatResult(status, body);
  }
  if (outcome.kind === 'http') {
    return failureOf(
      { status: outcome.status, body: outcome.body, text: outcome.text },
      outcome.retryAfterSeconds,
    );
  }
  const message = outcome.message ?? '';
  if (outcome.kind === 'format') {
    return outcome.status !== undefined
      ? { kind: 'format', message, status: outcome.status }
      : { kind: 'format', message };
  }
  return { kind: outcome.kind, message };
}

/* ------------------------------------------------------------------------ */
/* Failures and their text (data-model §4.5; FR-024)                         */
/* ------------------------------------------------------------------------ */

/**
 * Data-model §4.5: the `Failure` a non-answer result becomes when the request ends `failed` -
 * `limit` keeps the wait that was not waited for; a `cancelled` transport outcome (the core
 * stopped the transfer at shutdown) is `internal`.
 */
export function toFailure(result: Exclude<ExchangeResult, { kind: 'answer' }>): Failure {
  const failure: Failure = {
    kind: result.kind === 'cancelled' ? 'internal' : result.kind,
  };
  if (result.message !== '') failure.message = result.message;
  if ('status' in result && result.status !== undefined) failure.status = result.status;
  if ('serviceCode' in result && result.serviceCode !== undefined) {
    failure.serviceCode = result.serviceCode;
  }
  if (result.kind === 'limit') failure.waitSeconds = result.waitSeconds;
  if (result.kind === 'service' && result.redirect) failure.redirect = true;
  return failure;
}

/** Whether the failure is shown with a link to the settings page: `auth`, `model`, `noService`, the 3xx redirect. */
export function needsSettingsLink(failure: Failure): boolean {
  return (
    failure.kind === 'auth' ||
    failure.kind === 'model' ||
    failure.kind === 'noService' ||
    (failure.kind === 'service' && failure.redirect === true)
  );
}

/**
 * FR-024: the localised text of a failure - `ai.failure.<kind>` (`ai.failure.limitWait` for a
 * limit whose wait was not waited for, `FAILURE_REDIRECT_KEY` for a 3xx), wrapped by
 * `ai.failure.withMessage` around the service's own words when the failure carries them
 * (`formatServiceMessage`: the key masked, the code in parentheses, capped). Plain text.
 */
export function failureText(t: TFunction, failure: Failure, key?: string): string {
  let text: string;
  if (failure.kind === 'limit' && failure.waitSeconds !== undefined) {
    text = t('ai.failure.limitWait', { seconds: failure.waitSeconds });
  } else if (failure.kind === 'service' && failure.redirect) {
    text = t(FAILURE_REDIRECT_KEY);
  } else {
    text = t(`ai.failure.${failure.kind}`);
  }
  const words =
    failure.message === undefined
      ? ''
      : formatServiceMessage(failure.message, failure.serviceCode, key);
  return words === '' ? text : t('ai.failure.withMessage', { text, message: words });
}
