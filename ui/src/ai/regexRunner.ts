/**
 * Model-supplied regular expressions of `find` / `replace_all` run off the main thread with a
 * 2-second budget (feature 005 T044; ai-catalogue §3.1, review C15: no main-thread ReDoS). The
 * search itself (`runRegexSearch`) is a pure function shared by the worker (`regex.worker.ts`)
 * and the tests; `createRegexRunner` is the host side: it posts the request to a worker,
 * waits for the answer within the budget, terminates the worker on a time-out and creates a
 * fresh one for the next call. A failure to build the expression is reported as such (the
 * engine's message) and becomes `invalidArguments` in the catalogue.
 */

import { allMatches, buildSearchRegExp } from '@/features/search/replacement';

/** The budget of one search (review C15). */
export const REGEX_BUDGET_MS = 2000;

export interface RegexSearchRequest {
  /** The query as the model gave it (a regular expression when `regex` is true). */
  query: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  /** The texts to search, one per block, in document order. */
  texts: string[];
}

export interface RegexMatch {
  /** Index into `texts`. */
  block: number;
  from: number;
  to: number;
  text: string;
  /** Capture groups (`match[1..]`) for the replacement expansion. */
  groups: (string | undefined)[];
}

export type RegexSearchResult =
  | { ok: true; matches: RegexMatch[] }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'timeout'; message: string };

/** Searches every text with the query's expression (pure; runs in the worker). */
export function runRegexSearch(request: RegexSearchRequest): RegexSearchResult {
  let re: RegExp | null;
  try {
    re = buildSearchRegExp({
      query: request.query,
      regex: request.regex,
      matchCase: request.matchCase,
      wholeWord: request.wholeWord,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!re) {
    let message = 'the query is empty or not a valid regular expression';
    if (request.regex) {
      try {
        new RegExp(request.query, 'u');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
    }
    return { ok: false, reason: 'invalid', message };
  }
  const matches: RegexMatch[] = [];
  request.texts.forEach((text, block) => {
    for (const m of allMatches(re, text)) {
      matches.push({
        block,
        from: m.index,
        to: m.index + m[0].length,
        text: m[0],
        groups: Array.from(m).slice(1),
      });
    }
  });
  return { ok: true, matches };
}

/** The runner the catalogue is given (`CatalogueDeps.runRegex`). */
export type RegexRunner = (request: RegexSearchRequest) => Promise<RegexSearchResult>;

/** What the runner needs of a worker (a real `Worker` or a test double). */
export interface RegexWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * Runs each request in a worker with the budget; a time-out terminates the worker (the search
 * stops with it) and the next request gets a fresh one. A request without a regular expression
 * is answered in place (a literal search cannot run away). Requests are serialised.
 */
export function createRegexRunner(
  createWorker: () => RegexWorkerLike,
  budgetMs = REGEX_BUDGET_MS,
): RegexRunner {
  let worker: RegexWorkerLike | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const run = (request: RegexSearchRequest): Promise<RegexSearchResult> => {
    if (!request.regex) return Promise.resolve(runRegexSearch(request));
    return new Promise<RegexSearchResult>((resolve) => {
      worker ??= createWorker();
      const current = worker;
      let settled = false;
      const finish = (result: RegexSearchResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        current.onmessage = null;
        current.onerror = null;
        resolve(result);
      };
      const timer = setTimeout(() => {
        current.terminate();
        if (worker === current) worker = null;
        finish({
          ok: false,
          reason: 'timeout',
          message: `the pattern took too long (more than ${budgetMs / 1000} seconds); simplify it`,
        });
      }, budgetMs);
      current.onmessage = (event) => finish(event.data as RegexSearchResult);
      current.onerror = (event) => {
        if (worker === current) worker = null;
        current.terminate();
        const message =
          event && typeof event === 'object' && 'message' in event
            ? String((event as { message: unknown }).message)
            : 'the search worker failed';
        finish({ ok: false, reason: 'invalid', message });
      };
      current.postMessage(request);
    });
  };
  return (request) => {
    const next = queue.then(() => run(request));
    queue = next.catch(() => undefined);
    return next;
  };
}
