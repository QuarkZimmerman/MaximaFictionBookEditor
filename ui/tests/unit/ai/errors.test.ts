/**
 * Error normalisation of the AI assistant (feature 005 T040; ai-service-protocol §4, §6, §9;
 * data-model §9.4): the seven-row extraction ladder - first match wins - on the bodies recorded
 * in research R3 (`R3-evidence/<service>/…`, copied here as literals), the HTML reduction through
 * an inert document, the 300 / 2 000 caps, the configured key masked with `•••`, the status
 * classes of the table (auth, model, limit, service, the 3xx redirect) and the overflow
 * detection with its two numbers.
 */

import type { TFunction } from 'i18next';

import {
  FAILURE_REDIRECT_KEY,
  KEY_MASK,
  capMessage,
  classifyStatus,
  detectOverflow,
  extractError,
  failureText,
  formatServiceMessage,
  isHtml,
  maskKey,
  needsSettingsLink,
  reduceHtml,
  toFailure,
  triage,
  type ExchangeResult,
} from '@/ai/protocol';
import type { AiOutcome } from '@/rpc/types';

/* ------------------------------------------------------------------------ */
/* Recorded bodies (R3-evidence, 2026-10-22)                                  */
/* ------------------------------------------------------------------------ */

/** `ovh/unknown_model.txt`, HTTP 404 - the OpenAI form. */
const OVH_404 = {
  error: {
    code: 'model_not_found',
    message: 'The model `no-such-model-xyz` does not exist.',
    param: null,
    type: 'invalid_request_error',
  },
};

/** `llm7/burst_7.txt`, HTTP 429, `retry-after: 35`. */
const LLM7_429 = {
  error: {
    message: 'Daily token quota exceeded. Retry after 35 seconds.',
    type: 'insufficient_quota',
    param: null,
    code: 'quota_exceeded',
    retry_after: 35,
  },
};

/** `llm7/unknown_model.txt`, HTTP 400. */
const LLM7_400_MODEL = {
  error: {
    message: "Model 'no-such-model-xyz' is currently unavailable.",
    type: 'invalid_request_error',
    param: null,
    code: 'model_unavailable',
  },
};

/** `llm7/keyed_model_empty_bearer.txt`, HTTP 401. */
const LLM7_401 = {
  error: {
    message: 'Missing API key.',
    type: 'authentication_error',
    param: null,
    code: 'missing_api_key',
  },
};

/** `kilo/b_oversize_400k_lfm64k.txt`, HTTP 400 - numeric `error.code`, top-level `error_type`. */
const KILO_OVERSIZE = {
  error: {
    message:
      "This endpoint's maximum context length is 65536 tokens. However, you requested about 184529 tokens (184519 of text input, 10 in the output). Please reduce the length of either one, or use the context-compression plugin to compress your prompt automatically.",
    code: 400,
    metadata: { provider_name: null },
  },
  error_type: 'context_length_exceeded',
};

/** `kilo/unknown_model.txt`, HTTP 401 - a string code beside a top-level `error_type`. */
const KILO_401_PAID = {
  error: { code: 'PAID_MODEL_AUTH_REQUIRED', message: 'You need to sign in to use this model.' },
  error_type: 'paid_model_auth_required',
};

/** `kilo/auth_dummy_bearer.txt`, HTTP 401. */
const KILO_401_TOKEN = {
  error: {
    code: 'INVALID_TOKEN',
    message: 'Your authentication token is invalid. Please sign in again.',
  },
  error_type: 'authentication_required',
};

/** `kilo/malformed_json.txt`, HTTP 400 - a string `error`. */
const KILO_400_STRING = {
  error: 'Malformed JSON',
  error_type: 'invalid_request',
  message: 'Request body is not valid JSON: Unexpected end of JSON input',
};

/** `kilo/nemotron_tools_r1.txt`, HTTP 404 - a provider error passed through. */
const KILO_404_PROVIDER = {
  error: {
    message: 'Provider returned error',
    code: 404,
    metadata: {
      raw: '{"status":404,"title":"Not Found","detail":"Function \'ac74040f\': Not found"}',
      provider_name: 'Nvidia',
      is_byok: false,
    },
  },
  user_id: 'org_2uwFc1szZKyZweUX7pX97kXQf2O',
};

/** `kilo/b_reasoning_tools_r1.txt`, HTTP 200 - a service failure delivered as a 200. */
const KILO_200_ERROR = {
  id: 'gen-1792661691-W5NPmX9GnmJc3FGszFug',
  error: {
    message:
      'Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (17/16)',
    code: 502,
    metadata: { error_type: 'provider_unavailable' },
  },
};

/** `ovh/ratelimit_3rd_in_minute.txt`, HTTP 429 - Kong's `{message}`. */
const OVH_429_KONG = {
  message: 'API rate limit exceeded',
  request_id: '873ee43e9421950bd0774d5ebd862071',
};

/** `ovh/auth_dummy_bearer.txt`, HTTP 403 - Kong's `{message}` with a URL inside. */
const OVH_403_KONG = {
  message:
    'Forbidden: authentication failed.  Please generate a new one at https://kepler.ai.cloud.ovh.net/v1/oauth/ovh/authorize?iam_action=publicCloudProject:ai:endpoints/call',
};

/** `pollinations/rl_pair_2.txt`, HTTP 402, `retry-after: 23`. */
const POLLINATIONS_402 = {
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

/** `pollinations/unknown_model.txt`, HTTP 404. */
const POLLINATIONS_404 = {
  status: 404,
  success: false,
  error: {
    code: 'NOT_FOUND',
    message:
      'Model "no-such-model-xyz" isn\'t on the Classic API. Free models: https://text.pollinations.ai/models. Every model we offer is on https://enter.pollinations.ai/?ref=classic',
    timestamp: '2026-10-22T09:37:47.992Z',
    fixUrl: 'https://enter.pollinations.ai/?ref=classic',
  },
};

/** `pollinations/malformed_json.txt`, HTTP 400, `text/html`. */
const POLLINATIONS_HTML =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>SyntaxError: Unexpected end of JSON input</pre>\n</body>\n</html>\n';

/** `kilo/base_get.txt`, HTTP 404, `text/html` (abbreviated; no `<pre>`, a `<title>`). */
const KILO_HTML =
  '<!DOCTYPE html><html data-dpl-id="dpl_FraodVz3imihmFoxntz4KFLb8LbF"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><script src="/_next/static/immutable/chunks/2k-ohlk-yhk92.js" async=""></script><meta name="robots" content="noindex"/><title>404: This page could not be found.</title></head><body><div hidden=""><!--$--><!--/$--></div><div style="font-family:system-ui"><div><style>body{color:#000;background:#fff;margin:0}</style><h1 class="next-error-h1">404</h1><div style="display:inline-block"><h2>This page could not be found.</h2></div></div></div><script>(self.__next_f=self.__next_f||[]).push([0])</script></body></html>';

/** `ovh/malformed_json.txt`, HTTP 400, `text/plain`. */
const OVH_PLAIN =
  'Failed to parse the request body as JSON: messages: EOF while parsing a list at line 1 column 39';

function http(
  status: number,
  body?: unknown,
  extra: Partial<Extract<AiOutcome, { ok: false }>> = {},
): AiOutcome {
  const outcome: AiOutcome = { ok: false, kind: 'http', status, elapsedMs: 210, ...extra };
  if (body !== undefined) outcome.body = body;
  return outcome;
}

function text(status: number, value: string): AiOutcome {
  return { ok: false, kind: 'http', status, text: value, elapsedMs: 210 };
}

function failed(result: ExchangeResult): Exclude<ExchangeResult, { kind: 'answer' }> {
  if (result.kind === 'answer') throw new Error('expected a failure, got an answer');
  return result;
}

/* ------------------------------------------------------------------------ */
/* §4 extraction ladder                                                      */
/* ------------------------------------------------------------------------ */

describe('extractError - the ladder, first match wins (§4)', () => {
  it('row 1: the OpenAI form - message and code, type when there is no code', () => {
    expect(extractError({ status: 404, body: OVH_404 })).toEqual({
      row: 1,
      message: 'The model `no-such-model-xyz` does not exist.',
      serviceCode: 'model_not_found',
    });
    expect(extractError({ status: 429, body: LLM7_429 })).toMatchObject({
      row: 1,
      message: 'Daily token quota exceeded. Retry after 35 seconds.',
      serviceCode: 'quota_exceeded',
      retryAfterSeconds: 35,
    });
    expect(
      extractError({
        status: 400,
        body: { error: { message: 'Bad request', type: 'invalid_request_error' } },
      }),
    ).toEqual({ row: 1, message: 'Bad request', serviceCode: 'invalid_request_error' });
    expect(extractError({ status: 402, body: POLLINATIONS_402 })).toMatchObject({
      row: 1,
      serviceCode: 'FREE_LIMIT',
    });
  });

  it("row 1: Kilo's top-level error_type replaces a numeric error.code only", () => {
    expect(extractError({ status: 400, body: KILO_OVERSIZE })).toEqual({
      row: 1,
      message: KILO_OVERSIZE.error.message,
      serviceCode: 'context_length_exceeded',
    });
    expect(extractError({ status: 401, body: KILO_401_PAID })).toEqual({
      row: 1,
      message: 'You need to sign in to use this model.',
      serviceCode: 'PAID_MODEL_AUTH_REQUIRED',
    });
    // a numeric code without a top-level error_type stays numeric (metadata is not read)
    expect(extractError({ status: 404, body: KILO_404_PROVIDER })).toEqual({
      row: 1,
      message: 'Provider returned error',
      serviceCode: 404,
    });
  });

  it('row 2: a string error with message and error_type', () => {
    expect(extractError({ status: 400, body: KILO_400_STRING })).toEqual({
      row: 2,
      message: 'Malformed JSON: Request body is not valid JSON: Unexpected end of JSON input',
      serviceCode: 'invalid_request',
    });
    expect(extractError({ status: 400, body: { error: 'Bad request' } })).toEqual({
      row: 2,
      message: 'Bad request',
    });
  });

  it('row 3: Kong {message} without error', () => {
    expect(extractError({ status: 429, body: OVH_429_KONG })).toEqual({
      row: 3,
      message: 'API rate limit exceeded',
    });
    expect(extractError({ status: 403, body: OVH_403_KONG })).toEqual({
      row: 3,
      message: OVH_403_KONG.message,
    });
  });

  it('row 4: HTTP 200 with an error object and no choices reads as row 1 with status 200', () => {
    expect(extractError({ status: 200, body: KILO_200_ERROR })).toEqual({
      row: 1,
      message: KILO_200_ERROR.error.message,
      serviceCode: 502,
    });
    expect(triage({ ok: true, status: 200, body: KILO_200_ERROR, elapsedMs: 3 })).toMatchObject({
      kind: 'service',
      status: 200,
      serviceCode: 502,
    });
  });

  it('row 5: HTML - the first <pre>, else the <title>, tags stripped, whitespace collapsed', () => {
    expect(extractError({ status: 400, text: POLLINATIONS_HTML })).toEqual({
      row: 5,
      message: 'SyntaxError: Unexpected end of JSON input',
    });
    expect(extractError({ status: 404, text: KILO_HTML })).toEqual({
      row: 5,
      message: '404: This page could not be found.',
    });
    expect(
      extractError({
        status: 502,
        text: '<html><head><title>  502   Bad\n Gateway </title></head><body><pre>upstream\n\n  timed   out <b>(nginx)</b></pre><pre>second</pre></body></html>',
      }),
    ).toEqual({ row: 5, message: 'upstream timed out (nginx)' });
  });

  it('row 5: HTML without <pre> or <title> falls back to the body text; ≤ 300 characters', () => {
    expect(
      extractError({
        status: 503,
        text: '<html><body><h1>Service Unavailable</h1><p>Try later.</p></body></html>',
      }),
    ).toEqual({
      row: 5,
      message: 'Service Unavailable Try later.',
    });
    const long = `<html><body><pre>${'word '.repeat(200)}</pre></body></html>`;
    const result = extractError({ status: 500, text: long });
    expect(result.row).toBe(5);
    expect(result.message.length).toBeLessThanOrEqual(300);
    expect(result.message.endsWith('…')).toBe(true);
  });

  it('row 6: plain text trimmed, ≤ 300 characters', () => {
    expect(extractError({ status: 400, text: `  ${OVH_PLAIN}\n` })).toEqual({
      row: 6,
      message: OVH_PLAIN,
    });
    const result = extractError({ status: 500, text: 'x'.repeat(1000) });
    expect(result.row).toBe(6);
    expect(result.message.length).toBe(300);
    expect(result.message.endsWith('…')).toBe(true);
  });

  it('row 7: nothing usable gives the status line', () => {
    expect(extractError({ status: 503 })).toEqual({ row: 7, message: 'HTTP 503' });
    expect(extractError({ status: 503, text: '   ' })).toEqual({ row: 7, message: 'HTTP 503' });
    expect(extractError({ status: 500, body: {} })).toEqual({ row: 7, message: 'HTTP 500' });
    expect(extractError({ status: 500, body: { error: { code: 'x' } } })).toEqual({
      row: 7,
      message: 'HTTP 500',
      serviceCode: 'x',
    });
    expect(extractError({ status: 302, body: null })).toEqual({ row: 7, message: 'HTTP 302' });
    expect(extractError({})).toEqual({ row: 7, message: 'HTTP' });
  });

  it('the body wins over the text, and a JSON body that is a string is text', () => {
    expect(extractError({ status: 400, body: OVH_404, text: OVH_PLAIN }).row).toBe(1);
    expect(extractError({ status: 400, body: 'plain words' })).toEqual({
      row: 6,
      message: 'plain words',
    });
    expect(extractError({ status: 400, body: 7 })).toEqual({ row: 7, message: 'HTTP 400' });
  });
});

/* ------------------------------------------------------------------------ */
/* HTML reduction, caps and masking (§4, §9, review C16)                     */
/* ------------------------------------------------------------------------ */

describe('reduceHtml - an inert document, never the live DOM', () => {
  it('runs no script and loads nothing while reducing', () => {
    const marker = '__mfbeProtocolTestMarker';
    const globalRecord = globalThis as Record<string, unknown>;
    delete globalRecord[marker];
    const hostile = `<html><head><title>T</title></head><body><script>globalThis.${marker} = 1</script><img src="x" onerror="globalThis.${marker} = 2"><pre>payload &lt;ok&gt; &amp; done</pre></body></html>`;
    expect(reduceHtml(hostile)).toBe('payload <ok> & done');
    expect(globalRecord[marker]).toBeUndefined();
    expect(document.body.innerHTML).not.toContain(marker);
    expect(document.querySelector('img')).toBeNull();
  });

  it('isHtml recognises documents and fragments, not angle brackets in prose', () => {
    expect(isHtml(POLLINATIONS_HTML)).toBe(true);
    expect(isHtml(KILO_HTML)).toBe(true);
    expect(isHtml('  <html><body>x</body></html>')).toBe(true);
    expect(isHtml('<pre>only a pre</pre>')).toBe(true);
    expect(isHtml('<title>t</title>')).toBe(true);
    expect(isHtml(OVH_PLAIN)).toBe(false);
    expect(isHtml('a < b and b > c')).toBe(false);
    expect(isHtml('<p>Hello</p>')).toBe(false); // not a document and not pre/title: plain text
    expect(isHtml('<?xml version="1.0"?><root/>')).toBe(false);
  });

  it('returns "" for HTML without any text', () => {
    expect(reduceHtml('<html><head></head><body></body></html>')).toBe('');
    expect(reduceHtml('<html><body><style>body{}</style><script>1</script></body></html>')).toBe(
      '',
    );
  });

  it('reduces by regex where no DOMParser exists, with the same results', () => {
    vi.stubGlobal('DOMParser', undefined);
    try {
      expect(reduceHtml(POLLINATIONS_HTML)).toBe('SyntaxError: Unexpected end of JSON input');
      expect(reduceHtml(KILO_HTML)).toBe('404: This page could not be found.');
      expect(
        reduceHtml(
          '<html><head><title>  502   Bad\n Gateway </title></head><body><pre>upstream\n\n  timed   out <b>(nginx)</b></pre></body></html>',
        ),
      ).toBe('upstream timed out (nginx)');
      expect(
        reduceHtml('<html><body><h1>Service Unavailable</h1><p>Try later.</p></body></html>'),
      ).toBe('Service Unavailable Try later.');
      expect(
        reduceHtml(
          '<html><body><pre>a &lt;b&gt; &amp; &#39;c&#x27; &nbsp;d &unknown;</pre></body></html>',
        ),
      ).toBe("a <b> & 'c' d &unknown;");
      expect(
        reduceHtml(
          '<html><body><style>body{}</style><script>var x = "<pre>no</pre>"</script><!-- <pre>no</pre> --></body></html>',
        ),
      ).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('capMessage, maskKey, formatServiceMessage', () => {
  it('caps at 2 000 characters by default with an ellipsis, keeping surrogate pairs whole', () => {
    expect(capMessage('short')).toBe('short');
    const exact = 'a'.repeat(2000);
    expect(capMessage(exact)).toBe(exact);
    const over = capMessage('a'.repeat(2001));
    expect(over.length).toBe(2000);
    expect(over.endsWith('…')).toBe(true);
    const emoji = capMessage('😀'.repeat(1500), 2000);
    expect(emoji.length).toBeLessThanOrEqual(2000);
    expect(emoji.endsWith('…')).toBe(true);
    expect([...emoji.slice(0, -1)].every((ch) => ch === '😀')).toBe(true);
    expect(capMessage('abcdef', 3)).toBe('ab…');
    expect(capMessage('', 3)).toBe('');
  });

  it('maskKey replaces every occurrence of the configured key with •••', () => {
    expect(KEY_MASK).toBe('•••');
    expect(maskKey('Invalid key sk-abc123 (sk-abc123)', 'sk-abc123')).toBe('Invalid key ••• (•••)');
    expect(maskKey('Bearer sk-abc123xyz', 'sk-abc123')).toBe('Bearer •••xyz');
    expect(maskKey('nothing here', 'sk-abc123')).toBe('nothing here');
    expect(maskKey('a key with (parens)', 'with (parens)')).toBe('a key •••');
    expect(maskKey('untouched', undefined)).toBe('untouched');
    expect(maskKey('untouched', '')).toBe('untouched');
    expect(maskKey('untouched', '   ')).toBe('untouched');
    expect(maskKey('key: sk-x ', ' sk-x ')).toBe('key: ••• ');
  });

  it('formatServiceMessage: the code in parentheses, URLs as text, the key masked, capped', () => {
    expect(formatServiceMessage(OVH_404.error.message, 'model_not_found')).toBe(
      'The model `no-such-model-xyz` does not exist. (model_not_found)',
    );
    expect(formatServiceMessage(KILO_200_ERROR.error.message, 502)).toBe(
      `${KILO_200_ERROR.error.message} (502)`,
    );
    const kong = formatServiceMessage(OVH_403_KONG.message);
    expect(kong).toBe(OVH_403_KONG.message);
    expect(kong).toContain('https://kepler.ai.cloud.ovh.net/v1/oauth/ovh/authorize');
    expect(kong).not.toMatch(/<a\b/);
    expect(
      formatServiceMessage('Invalid key sk-secret-1 given', 'invalid_api_key', 'sk-secret-1'),
    ).toBe('Invalid key ••• given (invalid_api_key)');
    const long = formatServiceMessage('x'.repeat(5000), 'code');
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith(' (code)')).toBe(true);
    expect(formatServiceMessage('', 'code')).toBe('(code)');
    expect(formatServiceMessage('  spaced  ')).toBe('spaced');
  });
});

/* ------------------------------------------------------------------------ */
/* Status classes (§4 table, data-model §9.4)                                */
/* ------------------------------------------------------------------------ */

describe('classifyStatus', () => {
  const plain = (status: number, serviceCode?: string | number, message = 'x') =>
    classifyStatus({ status, serviceCode, message });

  it('auth: 401, 403 and the key-related codes with any status, with the settings link', () => {
    expect(plain(401)).toEqual({ kind: 'auth', settingsLink: true });
    expect(plain(403)).toEqual({ kind: 'auth', settingsLink: true });
    for (const code of [
      'invalid_api_key',
      'missing_api_key',
      'INVALID_TOKEN',
      'PAID_MODEL_AUTH_REQUIRED',
      'authentication_error',
    ]) {
      expect(plain(400, code), code).toEqual({ kind: 'auth', settingsLink: true });
      expect(plain(200, code), code).toEqual({ kind: 'auth', settingsLink: true });
    }
    expect(plain(401, 'quota_exceeded')).toEqual({ kind: 'auth', settingsLink: true });
  });

  it('model: 404 with model_not_found / NOT_FOUND / model_unavailable, 400 model_unavailable', () => {
    expect(plain(404, 'model_not_found')).toEqual({ kind: 'model', settingsLink: true });
    expect(plain(404, 'NOT_FOUND')).toEqual({ kind: 'model', settingsLink: true });
    expect(plain(404, 'model_unavailable')).toEqual({ kind: 'model', settingsLink: true });
    expect(plain(400, 'model_unavailable')).toEqual({ kind: 'model', settingsLink: true });
    expect(plain(404)).toEqual({ kind: 'service' });
    expect(plain(404, 404)).toEqual({ kind: 'service' });
    expect(plain(500, 'model_not_found')).toEqual({ kind: 'service' });
  });

  it('limit: 429 and 402 with any body, codes 429 / 402 inside a 200, 503 with Retry-After', () => {
    expect(plain(429)).toEqual({ kind: 'limit' });
    expect(plain(429, 'quota_exceeded')).toEqual({ kind: 'limit' });
    expect(plain(402, 'FREE_LIMIT')).toEqual({ kind: 'limit' });
    expect(plain(200, 429)).toEqual({ kind: 'limit' });
    expect(plain(200, '402')).toEqual({ kind: 'limit' });
    expect(plain(500, 429)).toEqual({ kind: 'service' });
    expect(classifyStatus({ status: 503, message: 'x', retryAfterSeconds: 10 })).toEqual({
      kind: 'limit',
    });
    expect(classifyStatus({ status: 503, message: 'x' })).toEqual({ kind: 'service' });
    expect(classifyStatus({ status: 503, message: 'x', retryAfterSeconds: 0 })).toEqual({
      kind: 'service',
    });
  });

  it('overflow: 400 / 413 by code or by the §6 regex', () => {
    expect(plain(400, 'context_length_exceeded')).toEqual({ kind: 'oversize' });
    expect(plain(413, 'context_length')).toEqual({ kind: 'oversize' });
    expect(
      plain(400, 'invalid_request_error', "This model's maximum context length is 128000 tokens."),
    ).toEqual({
      kind: 'oversize',
    });
    expect(plain(413, undefined, 'Payload too large')).toEqual({ kind: 'service' });
    expect(plain(400, 'invalid_request_error', 'messages[0].content is required')).toEqual({
      kind: 'service',
    });
    expect(plain(500, 'context_length_exceeded')).toEqual({ kind: 'service' });
  });

  it('3xx: a service failure flagged as a redirect with the settings link', () => {
    for (const status of [301, 302, 303, 307, 308]) {
      expect(plain(status), String(status)).toEqual({
        kind: 'service',
        redirect: true,
        settingsLink: true,
      });
    }
  });

  it('anything else is a service failure', () => {
    expect(plain(500)).toEqual({ kind: 'service' });
    expect(plain(502, 'provider_unavailable')).toEqual({ kind: 'service' });
    expect(plain(200, 502)).toEqual({ kind: 'service' });
    expect(plain(418)).toEqual({ kind: 'service' });
    expect(classifyStatus({ message: 'x' })).toEqual({ kind: 'service' });
  });

  it('the rows apply in the order of the table: limit, then overflow, then auth, then model', () => {
    // a 429 carrying a key-related code is still a limit (the limit rows come first)
    expect(plain(429, 'invalid_api_key')).toEqual({ kind: 'limit' });
    // a 400 overflow with key-related words in the message is an overflow (row 3 before row 4)
    expect(plain(400, 'context_length_exceeded', 'invalid_api_key')).toEqual({ kind: 'oversize' });
    // a 401 whose message speaks of the context length is an auth failure (overflow needs 400 / 413)
    expect(plain(401, undefined, 'maximum context length is 4096 tokens')).toEqual({
      kind: 'auth',
      settingsLink: true,
    });
  });
});

describe('triage over http outcomes - the classes end to end', () => {
  it('401 / 403 / key codes → auth with the service words and the settings link', () => {
    expect(triage(http(401, LLM7_401))).toEqual({
      kind: 'auth',
      status: 401,
      serviceCode: 'missing_api_key',
      message: 'Missing API key.',
      settingsLink: true,
    });
    expect(triage(http(401, KILO_401_TOKEN))).toMatchObject({
      kind: 'auth',
      serviceCode: 'INVALID_TOKEN',
    });
    expect(triage(http(401, KILO_401_PAID))).toMatchObject({
      kind: 'auth',
      serviceCode: 'PAID_MODEL_AUTH_REQUIRED',
    });
    expect(triage(http(403, OVH_403_KONG))).toEqual({
      kind: 'auth',
      status: 403,
      message: OVH_403_KONG.message,
      settingsLink: true,
    });
  });

  it('404 model codes and 400 model_unavailable → model', () => {
    expect(triage(http(404, OVH_404))).toMatchObject({
      kind: 'model',
      serviceCode: 'model_not_found',
      settingsLink: true,
    });
    expect(triage(http(404, POLLINATIONS_404))).toMatchObject({
      kind: 'model',
      serviceCode: 'NOT_FOUND',
    });
    expect(triage(http(400, LLM7_400_MODEL))).toMatchObject({
      kind: 'model',
      serviceCode: 'model_unavailable',
    });
    expect(triage(http(404, KILO_404_PROVIDER))).toMatchObject({
      kind: 'service',
      serviceCode: 404,
      message: 'Provider returned error',
    });
  });

  it('429 / 402 → limit; 503 with and without Retry-After', () => {
    expect(triage(http(429, OVH_429_KONG, { retryAfterSeconds: 15 }))).toEqual({
      kind: 'limit',
      status: 429,
      message: 'API rate limit exceeded',
      waitSeconds: 15,
      waitSource: 'header',
    });
    expect(triage(http(402, POLLINATIONS_402, { retryAfterSeconds: 23 }))).toMatchObject({
      kind: 'limit',
      status: 402,
      serviceCode: 'FREE_LIMIT',
      waitSeconds: 23,
    });
    expect(triage(text(503, 'overloaded'), 1)).toEqual({
      kind: 'service',
      status: 503,
      message: 'overloaded',
    });
    expect(triage({ ...text(503, 'overloaded'), retryAfterSeconds: 12 })).toEqual({
      kind: 'limit',
      status: 503,
      message: 'overloaded',
      waitSeconds: 12,
      waitSource: 'header',
    });
  });

  it('3xx → service "the address redirects" with the settings link; 5xx → service', () => {
    expect(triage(http(301))).toEqual({
      kind: 'service',
      status: 301,
      message: 'HTTP 301',
      redirect: true,
      settingsLink: true,
    });
    expect(triage(text(307, '<html><title>Moved</title></html>'))).toEqual({
      kind: 'service',
      status: 307,
      message: 'Moved',
      redirect: true,
      settingsLink: true,
    });
    expect(triage(text(400, OVH_PLAIN))).toEqual({
      kind: 'service',
      status: 400,
      message: OVH_PLAIN,
    });
    expect(triage(text(400, POLLINATIONS_HTML))).toEqual({
      kind: 'service',
      status: 400,
      message: 'SyntaxError: Unexpected end of JSON input',
    });
    expect(triage(http(400, KILO_400_STRING))).toEqual({
      kind: 'service',
      status: 400,
      serviceCode: 'invalid_request',
      message: 'Malformed JSON: Request body is not valid JSON: Unexpected end of JSON input',
    });
    expect(triage(http(500))).toEqual({ kind: 'service', status: 500, message: 'HTTP 500' });
  });
});

/* ------------------------------------------------------------------------ */
/* §6 overflow                                                               */
/* ------------------------------------------------------------------------ */

describe('detectOverflow (§6)', () => {
  it('Kilo: by error_type, the two numbers kept', () => {
    const extracted = extractError({ status: 400, body: KILO_OVERSIZE });
    expect(detectOverflow({ status: 400, ...extracted })).toEqual({
      contextLength: 65536,
      requested: 184529,
    });
    expect(triage(http(400, KILO_OVERSIZE))).toEqual({
      kind: 'oversize',
      status: 400,
      serviceCode: 'context_length_exceeded',
      message: KILO_OVERSIZE.error.message,
      contextLength: 65536,
      requested: 184529,
    });
  });

  it('OpenAI and the stand-in: by code, with the numbers; llama.cpp: by message alone', () => {
    const openai = {
      error: {
        message:
          "This model's maximum context length is 128000 tokens. However, you requested about 184529 tokens (184519 in the messages, 10 in the completion). Please reduce the length of the messages or completion.",
        type: 'invalid_request_error',
        param: 'messages',
        code: 'context_length_exceeded',
      },
    };
    expect(triage(http(400, openai))).toMatchObject({
      kind: 'oversize',
      contextLength: 128000,
      requested: 184529,
    });
    const llama = {
      error: {
        message: 'the request exceeds the available context size, try increasing it',
        type: 'server_error',
        code: 500,
      },
    };
    const result = triage(http(400, llama));
    expect(result).toMatchObject({ kind: 'oversize', status: 400 });
    expect(result).not.toHaveProperty('contextLength');
    expect(result).not.toHaveProperty('requested');
    expect(triage(http(413, { error: 'Request too large: prompt is too long' }))).toMatchObject({
      kind: 'oversize',
      status: 413,
    });
  });

  it('every alternative of the regex matches, case-insensitively', () => {
    const phrases = [
      'Context Length exceeded',
      'maximum context reached',
      'the context window is full',
      'Too many tokens in the prompt',
      'context_length_exceeded',
      'request exceeds the available context size',
      'Your prompt is too long',
      'the input is too long for this model',
      'over the token limit',
      'please reduce the length of your messages',
    ];
    for (const message of phrases) {
      expect(detectOverflow({ status: 400, message }), message).toEqual({});
      expect(detectOverflow({ status: 413, message }), message).toEqual({});
    }
  });

  it('only 400 and 413 count; a code alone counts; other messages do not', () => {
    expect(
      detectOverflow({ status: 500, message: 'maximum context length is 1 tokens' }),
    ).toBeNull();
    expect(detectOverflow({ status: 429, message: 'token limit' })).toBeNull();
    expect(detectOverflow({ status: 400, message: 'Bad request' })).toBeNull();
    expect(detectOverflow({ status: 400, serviceCode: 'context_length', message: 'x' })).toEqual(
      {},
    );
    expect(
      detectOverflow({ status: 400, serviceCode: 'invalid_request_error', message: 'x' }),
    ).toBeNull();
    expect(detectOverflow({ message: 'token limit' })).toBeNull();
  });

  it('the numbers are read case-insensitively and left out when absent or zero', () => {
    expect(
      detectOverflow({
        status: 400,
        message: 'Maximum Context Length Is 4096 tokens; you Requested About 5000 tokens',
      }),
    ).toEqual({
      contextLength: 4096,
      requested: 5000,
    });
    expect(detectOverflow({ status: 400, message: 'maximum context length is 0 tokens' })).toEqual(
      {},
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Failure mapping and the localised text (FR-024)                           */
/* ------------------------------------------------------------------------ */

describe('toFailure', () => {
  it('maps every non-answer result onto a Failure of data-model §4.5', () => {
    expect(toFailure(failed(triage(http(401, LLM7_401))))).toEqual({
      kind: 'auth',
      status: 401,
      serviceCode: 'missing_api_key',
      message: 'Missing API key.',
    });
    expect(toFailure(failed(triage(http(429, LLM7_429, { retryAfterSeconds: 84441 }))))).toEqual({
      kind: 'limit',
      status: 429,
      serviceCode: 'quota_exceeded',
      message: 'Daily token quota exceeded. Retry after 35 seconds.',
      waitSeconds: 84441,
    });
    expect(toFailure(failed(triage(http(400, KILO_OVERSIZE))))).toEqual({
      kind: 'oversize',
      status: 400,
      serviceCode: 'context_length_exceeded',
      message: KILO_OVERSIZE.error.message,
    });
    expect(toFailure(failed(triage(http(302))))).toEqual({
      kind: 'service',
      status: 302,
      message: 'HTTP 302',
      redirect: true,
    });
    expect(toFailure({ kind: 'offline', message: 'Could not resolve host' })).toEqual({
      kind: 'offline',
      message: 'Could not resolve host',
    });
    expect(toFailure({ kind: 'timeout', message: '' })).toEqual({ kind: 'timeout' });
    expect(toFailure({ kind: 'contentFilter', message: 'policy', status: 200 })).toEqual({
      kind: 'contentFilter',
      message: 'policy',
      status: 200,
    });
    expect(toFailure({ kind: 'format', message: '{}', status: 200 })).toEqual({
      kind: 'format',
      message: '{}',
      status: 200,
    });
    // the core cancels a transfer at shutdown only: nothing of the request survives it
    expect(toFailure({ kind: 'cancelled', message: 'shutdown' })).toEqual({
      kind: 'internal',
      message: 'shutdown',
    });
  });
});

describe('failureText and needsSettingsLink', () => {
  const calls: { key: string; params?: Record<string, unknown> }[] = [];
  const stub = (key: string, params?: Record<string, unknown>): string => {
    calls.push({ key, params });
    if (key === 'ai.failure.withMessage')
      return `${params!.text} The service said: ${params!.message}`;
    if (key === 'ai.failure.limitWait') return `wait of ${params!.seconds} s`;
    return `[${key}]`;
  };
  const t = stub as unknown as TFunction;
  beforeEach(() => {
    calls.length = 0;
  });

  it('quotes the service message with its code, masked and capped, through ai.failure.withMessage', () => {
    const text = failureText(
      t,
      {
        kind: 'auth',
        status: 401,
        serviceCode: 'invalid_api_key',
        message: 'Incorrect API key provided: sk-live-1',
      },
      'sk-live-1',
    );
    expect(text).toBe(
      '[ai.failure.auth] The service said: Incorrect API key provided: ••• (invalid_api_key)',
    );
    expect(calls.map((call) => call.key)).toEqual(['ai.failure.auth', 'ai.failure.withMessage']);
  });

  it('uses the kind text alone when there is no message', () => {
    expect(failureText(t, { kind: 'timeout' })).toBe('[ai.failure.timeout]');
    expect(failureText(t, { kind: 'service', status: 500, message: '' })).toBe(
      '[ai.failure.service]',
    );
    expect(failureText(t, { kind: 'internal' })).toBe('[ai.failure.internal]');
  });

  it('a limit with a refused wait names the seconds (FR-023)', () => {
    expect(
      failureText(t, {
        kind: 'limit',
        status: 429,
        serviceCode: 'quota_exceeded',
        message: 'Daily token quota exceeded.',
        waitSeconds: 84441,
      }),
    ).toBe('wait of 84441 s The service said: Daily token quota exceeded. (quota_exceeded)');
    expect(failureText(t, { kind: 'limit' })).toBe('[ai.failure.limit]');
  });

  it('a redirect uses its own key; the settings link for auth, model, noService and the redirect', () => {
    expect(FAILURE_REDIRECT_KEY).toBe('ai.failure.redirect');
    expect(
      failureText(t, { kind: 'service', status: 301, message: 'HTTP 301', redirect: true }),
    ).toBe('[ai.failure.redirect] The service said: HTTP 301');
    expect(needsSettingsLink({ kind: 'auth' })).toBe(true);
    expect(needsSettingsLink({ kind: 'model' })).toBe(true);
    expect(needsSettingsLink({ kind: 'noService' })).toBe(true);
    expect(needsSettingsLink({ kind: 'service', redirect: true })).toBe(true);
    expect(needsSettingsLink({ kind: 'service' })).toBe(false);
    expect(needsSettingsLink({ kind: 'limit' })).toBe(false);
    expect(needsSettingsLink({ kind: 'offline' })).toBe(false);
  });

  it('a numeric code is shown too and a message of 5 000 characters is capped at 2 000', () => {
    const text = failureText(t, {
      kind: 'service',
      status: 200,
      serviceCode: 502,
      message: 'x'.repeat(5000),
    });
    const quoted = text.slice('[ai.failure.service] The service said: '.length);
    expect(quoted.length).toBeLessThanOrEqual(2000);
    expect(quoted.endsWith(' (502)')).toBe(true);
  });
});
