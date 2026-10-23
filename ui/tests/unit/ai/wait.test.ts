/**
 * Limit waits of the AI assistant (feature 005 T040; FR-023; ai-service-protocol §5,
 * data-model §9.4 "Wait rules", research R3.5, review D2): the wait sources in order -
 * `Retry-After` header, the body's `error.retry_after`, the message regex, the 30 s default -
 * on the recorded limit answers, 402 and 503-with-`Retry-After` handled like 429, a wait ≤ 0
 * counted as 1 s, the running total per request capped at 300 s (LLM7's daily quota of
 * 84 441 s is reported, not waited), and the pacing wait on `ratelimit-remaining: 0`.
 */

import {
  DEFAULT_WAIT_SECONDS,
  WAIT_BUDGET_SECONDS,
  WaitBudget,
  normaliseWait,
  pacingWait,
  planWait,
  triage,
  waitFor,
  type ExchangeResult,
} from '@/ai/protocol';
import type { AiOutcome } from '@/rpc/types';

/* ------------------------------------------------------------------------ */
/* Recorded limit answers (R3-evidence, 2026-10-22)                          */
/* ------------------------------------------------------------------------ */

/** `ovh/ratelimit_3rd_in_minute.txt`: 429, `retry-after: 15`, `ratelimit-reset: 15`, Kong body. */
const OVH_429: AiOutcome = {
  ok: false,
  kind: 'http',
  status: 429,
  body: { message: 'API rate limit exceeded', request_id: '873ee43e9421950bd0774d5ebd862071' },
  retryAfterSeconds: 15,
  rateLimit: { limit: 2, remaining: 0, resetSeconds: 15 },
  elapsedMs: 209,
};

/** `llm7/burst_7.txt`: 429, `retry-after: 35`, `retry_after: 35` in the body and in the words. */
const LLM7_429_BODY = {
  error: {
    message: 'Daily token quota exceeded. Retry after 35 seconds.',
    type: 'insufficient_quota',
    param: null,
    code: 'quota_exceeded',
    retry_after: 35,
  },
};
const LLM7_429: AiOutcome = {
  ok: false,
  kind: 'http',
  status: 429,
  body: LLM7_429_BODY,
  retryAfterSeconds: 35,
  elapsedMs: 180,
};

/** `pollinations/rl_pair_2.txt`: 402 `FREE_LIMIT`, `retry-after: 23`, "Retry after 23s" in the words. */
const POLLINATIONS_402_BODY = {
  status: 402,
  success: false,
  error: {
    code: 'FREE_LIMIT',
    message:
      'Free limit reached: 1 reply every 30 seconds per IP. Retry after 23s, or get unlimited replies with a pollen key at https://enter.pollinations.ai/?ref=classic',
    timestamp: '2026-10-22T09:35:27.667Z',
    fixUrl: 'https://enter.pollinations.ai/?ref=classic',
  },
};
const POLLINATIONS_402: AiOutcome = {
  ok: false,
  kind: 'http',
  status: 402,
  body: POLLINATIONS_402_BODY,
  retryAfterSeconds: 23,
  elapsedMs: 150,
};

/** The stand-in's default 429 body (no wait named anywhere - Kilo's documented behaviour). */
const STANDIN_429: AiOutcome = {
  ok: false,
  kind: 'http',
  status: 429,
  body: {
    error: {
      message: 'Rate limit reached for the stand-in. Please try again later.',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    },
  },
  elapsedMs: 5,
};

/** `ovh/b_mistral_tools_r2.txt`: a successful answer with `ratelimit-remaining: 0`, `ratelimit-reset: 22`. */
const OVH_PACED_ANSWER: AiOutcome = {
  ok: true,
  status: 200,
  body: {
    id: 'chatcmpl-87255508e69fa5c7',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Section 2 is longer.', tool_calls: [] },
        finish_reason: 'stop',
      },
    ],
    created: 1792661978,
    model: 'Mistral-Small-3.2-24B-Instruct-2506',
    object: 'chat.completion',
  },
  rateLimit: { limit: 2, remaining: 0, resetSeconds: 22 },
  elapsedMs: 793,
};

function limit(result: ExchangeResult): Extract<ExchangeResult, { kind: 'limit' }> {
  if (result.kind !== 'limit') throw new Error(`expected a limit, got ${result.kind}`);
  return result;
}

/* ------------------------------------------------------------------------ */
/* Wait sources in order (§5 items 1-4)                                      */
/* ------------------------------------------------------------------------ */

describe('waitFor - the sources in order', () => {
  it('1. the Retry-After header wins over the body and the words', () => {
    expect(waitFor(OVH_429, 'API rate limit exceeded')).toEqual({ seconds: 15, source: 'header' });
    expect(waitFor(LLM7_429, LLM7_429_BODY.error.message)).toEqual({
      seconds: 35,
      source: 'header',
    });
    expect(
      waitFor({ retryAfterSeconds: 60, body: LLM7_429_BODY }, LLM7_429_BODY.error.message),
    ).toEqual({
      seconds: 60,
      source: 'header',
    });
    expect(waitFor(POLLINATIONS_402, POLLINATIONS_402_BODY.error.message)).toEqual({
      seconds: 23,
      source: 'header',
    });
  });

  it("2. the body's error.retry_after when there is no header", () => {
    expect(waitFor({ body: LLM7_429_BODY }, LLM7_429_BODY.error.message)).toEqual({
      seconds: 35,
      source: 'body',
    });
    expect(waitFor({ body: { error: { retry_after: '40' } } }, 'Retry after 9 seconds')).toEqual({
      seconds: 40,
      source: 'body',
    });
    // a non-numeric retry_after is ignored
    expect(waitFor({ body: { error: { retry_after: 'soon' } } }, 'Retry after 9 seconds')).toEqual({
      seconds: 9,
      source: 'message',
    });
    expect(waitFor({ body: { error: { retry_after: null } } }, 'x')).toEqual({
      seconds: 30,
      source: 'default',
    });
    // only `error.retry_after` is read - not a top-level member of another name
    expect(waitFor({ body: { retry_after: 12 } }, 'x')).toEqual({ seconds: 30, source: 'default' });
  });

  it('3. the number in the message when neither header nor body names one', () => {
    expect(waitFor({}, POLLINATIONS_402_BODY.error.message)).toEqual({
      seconds: 23,
      source: 'message',
    });
    expect(
      waitFor({ body: { message: 'x' } }, 'Daily token quota exceeded. Retry after 35 seconds.'),
    ).toEqual({
      seconds: 35,
      source: 'message',
    });
  });

  it('3. the regex forms: s, sec, secs, second, seconds, case-insensitive, a word boundary after', () => {
    const forms: [string, number][] = [
      ['retry after 5 s', 5],
      ['Retry after 7sec', 7],
      ['retry after 9 secs', 9],
      ['retry after 11 second', 11],
      ['RETRY AFTER 12 SECONDS', 12],
      ['Please retry after 23s.', 23],
      ['retry after 23s, or get a key', 23],
    ];
    for (const [message, seconds] of forms) {
      expect(waitFor({}, message), message).toEqual({ seconds, source: 'message' });
    }
    const unmatched = [
      'retry after 5 minutes',
      'retry after 5 ms',
      'retry after 5 seasons',
      'retry after a while',
      'retry in 5 seconds',
      'retry after 5',
    ];
    for (const message of unmatched) {
      expect(waitFor({}, message), message).toEqual({ seconds: 30, source: 'default' });
    }
  });

  it('4. 30 s when nothing is stated', () => {
    expect(DEFAULT_WAIT_SECONDS).toBe(30);
    expect(
      waitFor(STANDIN_429, 'Rate limit reached for the stand-in. Please try again later.'),
    ).toEqual({
      seconds: 30,
      source: 'default',
    });
    expect(waitFor({}, '')).toEqual({ seconds: 30, source: 'default' });
  });

  it('a wait of 0 or negative seconds counts as 1 s; fractions round up', () => {
    expect(waitFor({ body: { error: { retry_after: 0 } } }, 'x')).toEqual({
      seconds: 1,
      source: 'body',
    });
    expect(waitFor({ body: { error: { retry_after: -5 } } }, 'x')).toEqual({
      seconds: 1,
      source: 'body',
    });
    expect(waitFor({ body: { error: { retry_after: 2.2 } } }, 'x')).toEqual({
      seconds: 3,
      source: 'body',
    });
    expect(waitFor({ retryAfterSeconds: -1 }, 'x')).toEqual({ seconds: 1, source: 'header' });
    expect(waitFor({}, 'retry after 0 s')).toEqual({ seconds: 1, source: 'message' });
    expect(normaliseWait(0)).toBe(1);
    expect(normaliseWait(-3)).toBe(1);
    expect(normaliseWait(0.4)).toBe(1);
    expect(normaliseWait(1.5)).toBe(2);
    expect(normaliseWait(15)).toBe(15);
    expect(normaliseWait(Number.NaN)).toBe(DEFAULT_WAIT_SECONDS);
    expect(normaliseWait(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WAIT_SECONDS);
  });
});

/* ------------------------------------------------------------------------ */
/* Triage: which outcomes are waits                                          */
/* ------------------------------------------------------------------------ */

describe('triage - limits (§5)', () => {
  it('429 with the Kong body: header wait, message kept', () => {
    expect(triage(OVH_429)).toEqual({
      kind: 'limit',
      status: 429,
      message: 'API rate limit exceeded',
      waitSeconds: 15,
      waitSource: 'header',
    });
  });

  it('402 (Pollinations FREE_LIMIT) is a limit like a 429', () => {
    expect(triage(POLLINATIONS_402)).toEqual({
      kind: 'limit',
      status: 402,
      serviceCode: 'FREE_LIMIT',
      message: POLLINATIONS_402_BODY.error.message,
      waitSeconds: 23,
      waitSource: 'header',
    });
    const noHeader = limit(triage({ ...POLLINATIONS_402, retryAfterSeconds: undefined }));
    expect(noHeader.waitSeconds).toBe(23);
    expect(noHeader.waitSource).toBe('message');
  });

  it("LLM7's quota: header, then body when the header is missing", () => {
    expect(limit(triage(LLM7_429))).toMatchObject({
      waitSeconds: 35,
      waitSource: 'header',
      serviceCode: 'quota_exceeded',
    });
    const { retryAfterSeconds: _dropped, ...withoutHeader } = LLM7_429;
    void _dropped;
    expect(limit(triage(withoutHeader as AiOutcome))).toMatchObject({
      waitSeconds: 35,
      waitSource: 'body',
    });
  });

  it('503 with Retry-After is a limit; 503 without is a service failure (review D2)', () => {
    const overloaded: AiOutcome = {
      ok: false,
      kind: 'http',
      status: 503,
      body: {
        error: {
          message: 'The server is overloaded. Please try again later.',
          type: 'server_error',
        },
      },
      retryAfterSeconds: 45,
      elapsedMs: 100,
    };
    expect(triage(overloaded)).toEqual({
      kind: 'limit',
      status: 503,
      serviceCode: 'server_error',
      message: 'The server is overloaded. Please try again later.',
      waitSeconds: 45,
      waitSource: 'header',
    });
    const { retryAfterSeconds: _dropped, ...withoutHeader } = overloaded;
    void _dropped;
    expect(triage(withoutHeader as AiOutcome)).toEqual({
      kind: 'service',
      status: 503,
      serviceCode: 'server_error',
      message: 'The server is overloaded. Please try again later.',
    });
  });

  it('a 200-with-error whose code is 429 / 402 is a limit with the default wait', () => {
    const upstream: AiOutcome = {
      ok: true,
      status: 200,
      body: { error: { message: 'Upstream rate limit', code: 429, metadata: {} } },
      elapsedMs: 50,
    };
    expect(triage(upstream)).toEqual({
      kind: 'limit',
      status: 200,
      serviceCode: 429,
      message: 'Upstream rate limit',
      waitSeconds: 30,
      waitSource: 'default',
    });
  });

  it('the stand-in default body: 30 s default', () => {
    expect(limit(triage(STANDIN_429))).toMatchObject({
      waitSeconds: 30,
      waitSource: 'default',
      serviceCode: 'rate_limit_exceeded',
    });
  });

  it('a limit answer carries its own small wait: body retry_after 0 → 1 s', () => {
    const zero: AiOutcome = {
      ok: false,
      kind: 'http',
      status: 429,
      body: { error: { message: 'slow down', retry_after: 0 } },
      elapsedMs: 5,
    };
    expect(limit(triage(zero))).toMatchObject({ waitSeconds: 1, waitSource: 'body' });
  });
});

/* ------------------------------------------------------------------------ */
/* The 300 s budget per request                                              */
/* ------------------------------------------------------------------------ */

describe('WaitBudget - 300 s per request (FR-023)', () => {
  it('reports a wait beyond the budget instead of waiting (LLM7 daily quota: 84 441 s)', () => {
    expect(WAIT_BUDGET_SECONDS).toBe(300);
    const budget = new WaitBudget();
    expect(budget.totalSeconds).toBe(300);
    expect(budget.remainingSeconds).toBe(300);
    expect(budget.take(84441)).toEqual({ ok: false, waitSeconds: 84441 });
    expect(budget.waitedSeconds).toBe(0);
    expect(budget.remainingSeconds).toBe(300);
  });

  it('honours 3 × 100 s and refuses the fourth; exactly 300 is still honoured', () => {
    const budget = new WaitBudget();
    expect(budget.take(100)).toEqual({ ok: true, seconds: 100 });
    expect(budget.take(100)).toEqual({ ok: true, seconds: 100 });
    expect(budget.take(100)).toEqual({ ok: true, seconds: 100 });
    expect(budget.waitedSeconds).toBe(300);
    expect(budget.remainingSeconds).toBe(0);
    expect(budget.take(100)).toEqual({ ok: false, waitSeconds: 100 });
    expect(budget.take(1)).toEqual({ ok: false, waitSeconds: 1 });
    expect(budget.waitedSeconds).toBe(300);
  });

  it('a wait that would just exceed the remainder is refused with the normalised seconds', () => {
    const budget = new WaitBudget();
    expect(budget.take(299)).toEqual({ ok: true, seconds: 299 });
    expect(budget.take(2)).toEqual({ ok: false, waitSeconds: 2 });
    expect(budget.take(1)).toEqual({ ok: true, seconds: 1 });
    expect(budget.remainingSeconds).toBe(0);
  });

  it('normalises: 0 and negative waits count as 1 s, fractions round up', () => {
    const budget = new WaitBudget();
    expect(budget.take(0)).toEqual({ ok: true, seconds: 1 });
    expect(budget.take(-7)).toEqual({ ok: true, seconds: 1 });
    expect(budget.take(0.1)).toEqual({ ok: true, seconds: 1 });
    expect(budget.take(2.5)).toEqual({ ok: true, seconds: 3 });
    expect(budget.waitedSeconds).toBe(6);
  });

  it('a smaller budget for tests, and the pure planWait behind it', () => {
    const budget = new WaitBudget(10);
    expect(budget.take(6)).toEqual({ ok: true, seconds: 6 });
    expect(budget.take(5)).toEqual({ ok: false, waitSeconds: 5 });
    expect(budget.take(4)).toEqual({ ok: true, seconds: 4 });

    expect(planWait(0, 84441)).toEqual({ ok: false, waitSeconds: 84441 });
    expect(planWait(200, 100)).toEqual({ ok: true, seconds: 100 });
    expect(planWait(201, 100)).toEqual({ ok: false, waitSeconds: 100 });
    expect(planWait(0, 0)).toEqual({ ok: true, seconds: 1 });
    expect(planWait(5, 3, 8)).toEqual({ ok: true, seconds: 3 });
    expect(planWait(5, 4, 8)).toEqual({ ok: false, waitSeconds: 4 });
  });

  it('pacing waits count against the same budget', () => {
    const budget = new WaitBudget();
    const pacing = pacingWait(OVH_PACED_ANSWER);
    expect(pacing).toEqual({ seconds: 22, source: 'header' });
    expect(budget.take(pacing!.seconds)).toEqual({ ok: true, seconds: 22 });
    expect(budget.take(limit(triage(OVH_429)).waitSeconds)).toEqual({ ok: true, seconds: 15 });
    expect(budget.waitedSeconds).toBe(37);
  });
});

/* ------------------------------------------------------------------------ */
/* Pacing on ratelimit-remaining: 0 (§5, review D2)                          */
/* ------------------------------------------------------------------------ */

describe('pacingWait', () => {
  it('a successful answer with remaining 0 and resetSeconds is paced by the header', () => {
    expect(pacingWait(OVH_PACED_ANSWER)).toEqual({ seconds: 22, source: 'header' });
    expect(
      pacingWait({ ...OVH_PACED_ANSWER, rateLimit: { remaining: 0, resetSeconds: 0.5 } }),
    ).toEqual({
      seconds: 1,
      source: 'header',
    });
  });

  it('nothing is paced with a remainder, without resetSeconds, or on a failed outcome', () => {
    expect(
      pacingWait({ ...OVH_PACED_ANSWER, rateLimit: { limit: 2, remaining: 1, resetSeconds: 18 } }),
    ).toBeNull();
    expect(pacingWait({ ...OVH_PACED_ANSWER, rateLimit: { limit: 2, remaining: 0 } })).toBeNull();
    expect(
      pacingWait({ ...OVH_PACED_ANSWER, rateLimit: { limit: 2, remaining: 0, resetSeconds: 0 } }),
    ).toBeNull();
    expect(pacingWait({ ...OVH_PACED_ANSWER, rateLimit: undefined })).toBeNull();
    expect(pacingWait(OVH_429)).toBeNull(); // a 429 is a limit wait of its own, not a pacing wait
    expect(pacingWait({ ok: false, kind: 'offline', message: 'x', elapsedMs: 1 })).toBeNull();
  });
});
