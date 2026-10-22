/**
 * Types of `ai-standin.mjs` (the AI service stand-in of feature 005) for the Playwright
 * fixtures (`core.ts`) and the vitest (`tests/unit/ai/standin.test.ts`). The scenario
 * vocabulary is the one list of ai-catalogue §9.1 / data-model §11.1 / quickstart §0.2.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [member: string]: JsonValue | undefined };

/** Members every answer item accepts beside its own. */
export interface StandinAnswerExtras {
  /** Holds this answer for the given milliseconds. */
  delayMs?: number;
  /** Extra response headers (the `ratelimit-*` headers of ai-service-protocol §5, `Location`). */
  headers?: Record<string, string | number>;
}

/** `{text}` - 200, `finish_reason: "stop"`; `{finishReason: "length", text}` - a cut answer. */
export interface StandinTextItem extends StandinAnswerExtras {
  text: string;
  finishReason?: string;
}

export interface StandinToolCall {
  name: string;
  /** An object (serialised) or the JSON string a real service sends (may be wrong on purpose). */
  arguments?: JsonValue[] | { [member: string]: JsonValue | undefined } | string;
  /** `call_<n>` when absent. */
  id?: string;
}

/** 200, `finish_reason: "tool_calls"`; `content` exactly as given (absent / null / "" / text). */
export interface StandinToolCallsItem extends StandinAnswerExtras {
  toolCalls: StandinToolCall[];
  content?: string | null;
  finishReason?: string;
}

/**
 * `{status: 429 | 402 | 503, retryAfter?, body?}` - a limit (an OpenAI-shaped default body
 * when none is given); `{status, body, contentType?}` - any other HTTP answer: an object is
 * JSON, a string is served with `contentType` (`text/plain` by default).
 */
export interface StandinHttpItem extends StandinAnswerExtras {
  status: number;
  retryAfter?: number | string;
  body?: JsonValue;
  contentType?: string;
}

/** Holds the next answer for `delayMs`. */
export interface StandinDelayItem {
  delayMs: number;
}

/** 400 `context_length_exceeded` once, then the next item. */
export interface StandinOverflowItem extends StandinAnswerExtras {
  overflow: true;
}

export type StandinAnswerItem =
  StandinTextItem | StandinToolCallsItem | StandinHttpItem | StandinDelayItem | StandinOverflowItem;

/** Mode: 401 `missing_api_key` / `invalid_api_key` unless `Authorization: Bearer <key>`; null clears. */
export interface StandinKeyRequiredMode {
  keyRequired: string | null;
}

/** An element of the `models` mode's array: a bare id or an object with at least `id`. */
export type StandinModelEntry =
  string | ({ id: string; context_length?: number } & { [member: string]: JsonValue | undefined });

/**
 * Mode for `GET <base>/models`: an array becomes an OpenAI list (`[]` = no models), an object
 * is served verbatim as the non-list body (→ `format`); null clears.
 */
export interface StandinModelsMode {
  models: StandinModelEntry[] | { [member: string]: JsonValue | undefined } | null;
}

export type StandinMode = StandinKeyRequiredMode | StandinModelsMode;

export type StandinScenario = StandinAnswerItem | StandinMode;

export type StandinScenarioKind =
  'keyRequired' | 'models' | 'overflow' | 'toolCalls' | 'text' | 'http' | 'delay';

/** One recorded service request (data-model §11.2). */
export interface StandinRequest {
  /** ISO 8601 UTC. */
  at: string;
  method: string;
  /** Path and query as requested, e.g. `/v1/chat/completions`. */
  path: string;
  /** Request headers (lower-cased names); `authorization` is `"present"` or `"absent"` only. */
  headers: Record<string, string> & { authorization: 'present' | 'absent' };
  bodyBytes: number;
  /** The body parsed as JSON; absent when the body is empty or not JSON. */
  body?: JsonValue;
}

/** `GET /__standin/scenario`. */
export interface StandinState {
  queued: number;
  queue: StandinAnswerItem[];
  modes: {
    keyRequired: string | null;
    models: StandinModelsMode['models'];
  };
}

/** `fetch`-based helpers over the control endpoints. */
export interface StandinClient {
  /** `http://127.0.0.1:<port>` without a trailing slash. */
  url: string;
  /** Enqueues one answer item or sets a mode. */
  scenario(item: StandinScenario): Promise<StandinState>;
  /** Enqueues / applies several in order (one request). */
  scenarios(items: StandinScenario[]): Promise<StandinState>;
  state(): Promise<StandinState>;
  requests(): Promise<StandinRequest[]>;
  /** Empties the queue, resets the modes and clears the record. */
  reset(): Promise<void>;
}

export interface StandinServer {
  port: number;
  /** `http://127.0.0.1:<port>`. */
  url: string;
  close(): Promise<void>;
}

/** Classifies a scenario item; null for anything that is not one. */
export function scenarioKind(item: unknown): StandinScenarioKind | null;

/** Starts the stand-in in-process on 127.0.0.1:`port` (0, the default, picks a free port). */
export function serveStandin(options?: { port?: number }): Promise<StandinServer>;

/** Control-endpoint helpers for a stand-in at `url`. */
export function standinClient(url: string): StandinClient;
