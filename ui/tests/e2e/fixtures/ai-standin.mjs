#!/usr/bin/env node
/**
 * Stand-in for an OpenAI-compatible AI service (feature 005, FR-102; quickstart §0.2,
 * ai-catalogue §9.1, data-model §11). Every AI journey runs against it, so no journey ever
 * contacts a real service, and it records every request it receives:
 *
 *   node tests/e2e/fixtures/ai-standin.mjs --port 8787   # prints {"port":8787,"url":"http://127.0.0.1:8787"}
 *                                                        # --port 0 (the default) picks a free port
 *
 * Binds 127.0.0.1 only - never 0.0.0.0, never a LAN address; a journey that needs a *hosted*
 * name gives it one through the core's `test.setAiResolve` hook. Never contacts anything.
 *
 * Service endpoints (under any base path, so `/v1/...` and `/openai/...` both work):
 *   POST <base>/chat/completions - answers with the next queued scenario item; an empty queue
 *                                  is HTTP 500 {"error":{"message":"stand-in: no scenario queued"}}
 *   GET  <base>/models           - the `models` mode's list, or the default list of
 *                                  `standin-chat` (context_length 131072) and `standin-mini`
 * Control endpoints:
 *   POST   /__standin/scenario   - enqueues one item (or an array of items) / sets a mode
 *   GET    /__standin/scenario   - {queued, queue, modes}
 *   DELETE /__standin/scenario   - empties the queue, resets the modes
 *   GET    /__standin/requests   - [{at, method, path, headers, bodyBytes, body}] - every
 *                                  non-control request; headers.authorization is "present" |
 *                                  "absent" only (a key never lands in the record)
 *   DELETE /__standin/requests   - clears the record
 *
 * Scenario vocabulary (one list - ai-catalogue §9.1, data-model §11.1, quickstart §0.2):
 *   {text}                                   200, finish_reason "stop"
 *   {toolCalls: [{name, arguments, id?}], content?}
 *                                            200, finish_reason "tool_calls"; `arguments` an
 *                                            object or the JSON string a real service sends;
 *                                            ids call_<n> unless given; `content` exactly as
 *                                            given (absent / null / "" / text)
 *   {status: 429 | 402 | 503, retryAfter?, body?}
 *                                            a limit: Retry-After when given, the body as
 *                                            given or an OpenAI-shaped default
 *   {status, body, contentType?}             any HTTP answer: an object is JSON, a string is
 *                                            served with contentType (text/plain by default)
 *   {delayMs}                                holds the next answer; also a member of an item
 *   {overflow: true}                         400 context_length_exceeded once, then the next item
 *   {finishReason: "length", text}           a cut answer
 *   {keyRequired: "<key>"}                   mode: no Authorization -> 401 missing_api_key, a
 *                                            wrong key -> 401 invalid_api_key, the right key
 *                                            -> the queue (also guards GET /models)
 *   {models: [...] | {...}}                  mode: an array becomes an OpenAI list ([] = no
 *                                            models), an object is served verbatim
 *   Any answer item also accepts `headers` (extra response headers, e.g. the ratelimit-*
 *   headers of ai-service-protocol §5) and `delayMs`.
 *
 * In-process use (the vitest `tests/unit/ai/standin.test.ts`): `serveStandin({port})` and
 * `standinClient(url)`; the Playwright fixtures (`fixtures/core.ts` `startStandin()`) spawn it
 * and read the port from its first stdout line, like `fake-core.mjs`. No dependencies. Never
 * shipped.
 */

import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const NO_SCENARIO = { error: { message: 'stand-in: no scenario queued' } };
const MODELS_CREATED = 1_761_091_200; // 2026-10-22, the day of the R3 probes

const DEFAULT_MODELS = [
  {
    id: 'standin-chat',
    object: 'model',
    created: MODELS_CREATED,
    owned_by: 'standin',
    context_length: 131072,
  },
  { id: 'standin-mini', object: 'model', created: MODELS_CREATED, owned_by: 'standin' },
];

const OVERFLOW_BODY = {
  error: {
    message:
      "This model's maximum context length is 65536 tokens. However, you requested about " +
      '184529 tokens (184519 in the messages, 10 in the completion). Please reduce the length ' +
      'of the messages or completion.',
    type: 'invalid_request_error',
    param: 'messages',
    code: 'context_length_exceeded',
  },
};

/** OpenAI-shaped default bodies of the limit statuses (no wait is named: the 30 s default rule). */
const DEFAULT_LIMIT_BODIES = {
  429: {
    error: {
      message: 'Rate limit reached for the stand-in. Please try again later.',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    },
  },
  402: {
    error: {
      message: 'Free limit reached for the stand-in.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    },
  },
  503: {
    error: {
      message: 'The stand-in is overloaded.',
      type: 'server_error',
      code: 'service_unavailable',
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/* ----------------------------- scenario items --------------------------- */

/**
 * Classifies a scenario item: 'keyRequired' | 'models' (modes), 'overflow' | 'toolCalls' |
 * 'text' | 'http' | 'delay' (answers); null for anything else.
 */
export function scenarioKind(item) {
  if (!isPlainObject(item)) return null;
  if ('keyRequired' in item) return 'keyRequired';
  if ('models' in item) return 'models';
  if (item.overflow === true) return 'overflow';
  if (Array.isArray(item.toolCalls)) return 'toolCalls';
  if (typeof item.text === 'string' || typeof item.finishReason === 'string') return 'text';
  if (Number.isInteger(item.status)) return 'http';
  if (typeof item.delayMs === 'number') return 'delay';
  return null;
}

/** Throws with the reason when `item` is not a valid scenario item or mode. */
function validateItem(item) {
  const kind = scenarioKind(item);
  if (!kind) throw new Error(`unknown scenario item: ${JSON.stringify(item)}`);
  if (kind === 'keyRequired' && item.keyRequired !== null && typeof item.keyRequired !== 'string') {
    throw new Error('keyRequired must be a string (or null to clear the mode)');
  }
  if (
    kind === 'models' &&
    item.models !== null &&
    !Array.isArray(item.models) &&
    !isPlainObject(item.models)
  ) {
    throw new Error('models must be an array, an object (or null to clear the mode)');
  }
  if (kind === 'toolCalls') {
    for (const call of item.toolCalls) {
      if (!isPlainObject(call) || typeof call.name !== 'string') {
        throw new Error('every tool call needs a string name');
      }
      if (
        call.arguments !== undefined &&
        typeof call.arguments !== 'string' &&
        !isPlainObject(call.arguments)
      ) {
        throw new Error(`tool call ${call.name}: arguments must be an object or a JSON string`);
      }
      if (call.id !== undefined && typeof call.id !== 'string') {
        throw new Error(`tool call ${call.name}: id must be a string`);
      }
    }
  }
  if (kind === 'http' && (item.status < 100 || item.status > 999)) {
    throw new Error(`status ${item.status} is not an HTTP status`);
  }
  if ('delayMs' in item && (typeof item.delayMs !== 'number' || item.delayMs < 0)) {
    throw new Error('delayMs must be a non-negative number');
  }
  if ('headers' in item && !isPlainObject(item.headers)) {
    throw new Error('headers must be an object of header name to value');
  }
  return kind;
}

/* ------------------------------- the server ----------------------------- */

/**
 * Creates the stand-in's state and request handler (not yet listening).
 */
function createStandin() {
  const state = {
    queue: [],
    modes: { keyRequired: null, models: null },
    requests: [],
    nextCall: 1,
    nextCompletion: 1,
  };

  const snapshot = () => ({
    queued: state.queue.length,
    queue: state.queue,
    modes: state.modes,
  });

  /** Enqueues one item or applies one mode (validated already). */
  const apply = (item, kind) => {
    if (kind === 'keyRequired') state.modes.keyRequired = item.keyRequired;
    else if (kind === 'models') state.modes.models = item.models;
    else state.queue.push(item);
  };

  const sendJson = (res, status, body, extraHeaders = {}) =>
    sendBytes(res, status, Buffer.from(JSON.stringify(body)), {
      'content-type': 'application/json',
      ...extraHeaders,
    });

  const sendBytes = (res, status, bytes, headers) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { ...headers, 'content-length': bytes.length });
    res.end(bytes);
  };

  /** Lower-cased copy of an item's extra response headers. */
  const extraHeaders = (item) => {
    const out = {};
    for (const [name, value] of Object.entries(item.headers ?? {})) {
      out[name.toLowerCase()] = String(value);
    }
    if (item.retryAfter !== undefined && item.retryAfter !== null) {
      out['retry-after'] = String(item.retryAfter);
    }
    return out;
  };

  const chatCompletion = (message, finishReason, requestBody, bodyBytes) => {
    const completionTokens = Math.max(1, Math.ceil(JSON.stringify(message).length / 4));
    const promptTokens = Math.max(1, Math.ceil(bodyBytes / 4));
    return {
      id: `chatcmpl-standin-${state.nextCompletion++}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model:
        isPlainObject(requestBody) && typeof requestBody.model === 'string'
          ? requestBody.model
          : 'standin-chat',
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  };

  /** The answer of one queue item as {status, body | bytes, headers}. */
  const answerFor = (item, kind, requestBody, bodyBytes) => {
    const headers = extraHeaders(item);
    if (kind === 'overflow') {
      return { status: 400, json: OVERFLOW_BODY, headers };
    }
    if (kind === 'text') {
      const message = { role: 'assistant' };
      if (typeof item.text === 'string') message.content = item.text;
      return {
        status: 200,
        json: chatCompletion(message, item.finishReason ?? 'stop', requestBody, bodyBytes),
        headers,
      };
    }
    if (kind === 'toolCalls') {
      const message = { role: 'assistant' };
      if ('content' in item) message.content = item.content;
      message.tool_calls = item.toolCalls.map((call) => ({
        id: call.id ?? `call_${state.nextCall++}`,
        type: 'function',
        function: {
          name: call.name,
          arguments:
            typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments ?? {}),
        },
      }));
      return {
        status: 200,
        json: chatCompletion(message, item.finishReason ?? 'tool_calls', requestBody, bodyBytes),
        headers,
      };
    }
    // kind === 'http'
    const { status } = item;
    if (item.body === undefined) {
      return {
        status,
        json: DEFAULT_LIMIT_BODIES[status] ?? {
          error: { message: `stand-in: HTTP ${status}`, type: 'server_error' },
        },
        headers,
      };
    }
    if (typeof item.body === 'string') {
      return {
        status,
        bytes: Buffer.from(item.body, 'utf8'),
        headers: {
          'content-type': item.contentType ?? 'text/plain; charset=utf-8',
          ...headers,
        },
      };
    }
    return {
      status,
      json: item.body,
      headers: item.contentType ? { 'content-type': item.contentType, ...headers } : headers,
    };
  };

  /** The key mode's verdict: null when the request may proceed, else the 401 body. */
  const keyVerdict = (req) => {
    const key = state.modes.keyRequired;
    if (key === null) return null;
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S.*)$/i.exec(header.trim()) : null;
    if (!match) {
      return { error: { message: 'Missing API key.', code: 'missing_api_key' } };
    }
    if (match[1] !== key) {
      return {
        error: {
          message: `Incorrect API key provided: ${match[1]}.`,
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      };
    }
    return null;
  };

  const serveChat = async (req, res, requestBody, bodyBytes) => {
    const refused = keyVerdict(req);
    if (refused) {
      sendJson(res, 401, refused);
      return;
    }
    let delay = 0;
    for (;;) {
      const item = state.queue.shift();
      if (item === undefined) {
        if (delay > 0) await sleep(delay);
        sendJson(res, 500, NO_SCENARIO);
        return;
      }
      const kind = scenarioKind(item);
      if (kind === 'delay') {
        delay += item.delayMs;
        continue;
      }
      delay += item.delayMs ?? 0;
      const answer = answerFor(item, kind, requestBody, bodyBytes);
      if (delay > 0) await sleep(delay);
      if (answer.json !== undefined) sendJson(res, answer.status, answer.json, answer.headers);
      else sendBytes(res, answer.status, answer.bytes, answer.headers);
      return;
    }
  };

  const serveModels = (req, res) => {
    const refused = keyVerdict(req);
    if (refused) {
      sendJson(res, 401, refused);
      return;
    }
    const mode = state.modes.models;
    if (mode === null) {
      sendJson(res, 200, { object: 'list', data: DEFAULT_MODELS });
      return;
    }
    if (Array.isArray(mode)) {
      const data = mode.map((entry) =>
        typeof entry === 'string'
          ? { id: entry, object: 'model', created: MODELS_CREATED, owned_by: 'standin' }
          : { object: 'model', created: MODELS_CREATED, owned_by: 'standin', ...entry },
      );
      sendJson(res, 200, { object: 'list', data });
      return;
    }
    sendJson(res, 200, mode);
  };

  const serveControl = (req, res, url, text) => {
    const { method } = req;
    if (url.pathname === '/__standin/scenario') {
      if (method === 'GET') {
        sendJson(res, 200, snapshot());
        return;
      }
      if (method === 'DELETE') {
        state.queue = [];
        state.modes = { keyRequired: null, models: null };
        sendJson(res, 200, snapshot());
        return;
      }
      if (method === 'POST') {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          sendJson(res, 400, {
            error: { message: `stand-in: scenario is not JSON: ${error.message}` },
          });
          return;
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        let kinds;
        try {
          kinds = items.map(validateItem);
        } catch (error) {
          sendJson(res, 400, { error: { message: `stand-in: ${error.message}` } });
          return;
        }
        items.forEach((item, index) => apply(item, kinds[index]));
        sendJson(res, 200, snapshot());
        return;
      }
      sendJson(
        res,
        405,
        { error: { message: `stand-in: ${method} not allowed here` } },
        { allow: 'GET, POST, DELETE' },
      );
      return;
    }
    if (url.pathname === '/__standin/requests') {
      if (method === 'GET') {
        sendJson(res, 200, state.requests);
        return;
      }
      if (method === 'DELETE') {
        state.requests = [];
        sendJson(res, 200, {});
        return;
      }
      sendJson(
        res,
        405,
        { error: { message: `stand-in: ${method} not allowed here` } },
        { allow: 'GET, DELETE' },
      );
      return;
    }
    sendJson(res, 404, { error: { message: `stand-in: no control endpoint ${url.pathname}` } });
  };

  /** The record of one service request: the Authorization value never lands in it. */
  const record = (req, bytes, parsed) => {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    headers.authorization = 'authorization' in req.headers ? 'present' : 'absent';
    const entry = {
      at: new Date().toISOString(),
      method: req.method,
      path: req.url,
      headers,
      bodyBytes: bytes.length,
    };
    if (parsed !== undefined) entry.body = parsed;
    state.requests.push(entry);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const handle = async (req, res) => {
    res.on('error', () => {});
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let bytes;
    try {
      bytes = await readBody(req);
    } catch {
      return;
    }
    const text = bytes.toString('utf8');
    if (url.pathname.startsWith('/__standin/')) {
      serveControl(req, res, url, text);
      return;
    }
    let parsed;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    record(req, bytes, parsed);
    if (url.pathname.endsWith('/chat/completions')) {
      if (req.method !== 'POST') {
        sendJson(
          res,
          405,
          { error: { message: 'stand-in: use POST for chat completions' } },
          { allow: 'POST' },
        );
        return;
      }
      await serveChat(req, res, parsed, bytes.length);
      return;
    }
    if (url.pathname.endsWith('/models')) {
      if (req.method !== 'GET') {
        sendJson(
          res,
          405,
          { error: { message: 'stand-in: use GET for the model list' } },
          { allow: 'GET' },
        );
        return;
      }
      serveModels(req, res);
      return;
    }
    sendJson(res, 404, {
      error: {
        message: `stand-in: no such endpoint ${req.method} ${url.pathname}`,
        code: 'not_found',
      },
    });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.destroyed && !res.writableEnded) {
        sendJson(res, 500, { error: { message: 'stand-in: internal error' } });
      }
    });
  });
  server.on('clientError', (_error, socket) => {
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return { server, state };
}

/**
 * Starts the stand-in in-process on 127.0.0.1:`port` (0 = a free port).
 * Resolves to `{port, url, close()}`.
 */
export async function serveStandin({ port = 0 } = {}) {
  const { server } = createStandin();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  return {
    port: bound,
    url: `http://127.0.0.1:${bound}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/* ------------------------------ the client ------------------------------ */

/**
 * `fetch`-based helpers over the control endpoints of a stand-in at `url`
 * (`http://127.0.0.1:<port>`), shared by the Playwright fixtures and the vitest.
 */
export function standinClient(url) {
  const base = url.replace(/\/+$/, '');
  const control = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`stand-in ${method} ${path}: HTTP ${response.status} ${text}`);
    return text.length > 0 ? JSON.parse(text) : undefined;
  };
  return {
    url: base,
    scenario: (item) => control('POST', '/__standin/scenario', item),
    scenarios: (items) => control('POST', '/__standin/scenario', items),
    state: () => control('GET', '/__standin/scenario'),
    requests: () => control('GET', '/__standin/requests'),
    reset: async () => {
      await control('DELETE', '/__standin/scenario');
      await control('DELETE', '/__standin/requests');
    },
  };
}

/* -------------------------------- the CLI ------------------------------- */

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync.native(entry) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const requestedPort = portIndex >= 0 ? Number(args[portIndex + 1]) : 0;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    console.error('ai-standin: --port needs a port number (0 picks a free one)');
    process.exit(2);
  }
  const started = await serveStandin({ port: requestedPort });
  process.stdout.write(`${JSON.stringify({ port: started.port, url: started.url })}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      started.close().finally(() => process.exit(0));
    });
  }
}
