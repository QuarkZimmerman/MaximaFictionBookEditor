// @vitest-environment node
/**
 * The AI service stand-in of the journeys (feature 005, FR-102; `tests/e2e/fixtures/ai-standin.mjs`),
 * driven in-process through every item of the scenario vocabulary (ai-catalogue §9.1,
 * data-model §11.1, quickstart §0.2): the chat completion shapes of ai-service-protocol (text,
 * tool calls with the four `content` shapes, a cut answer), the limit and error answers
 * (`Retry-After`, Kong / Pollinations / LLM7 bodies, `text/plain`, HTML, a 3xx, a 200 with
 * `error`), the delay, the one-off overflow, the `keyRequired` and `models` modes, the record
 * of every request with the `Authorization` value reduced to present / absent - and the loud
 * 500 of an empty queue.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  scenarioKind,
  serveStandin,
  standinClient,
  type StandinClient,
  type StandinServer,
} from '../../e2e/fixtures/ai-standin.mjs';

interface ChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content?: string | null;
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ErrorBody {
  error: { message: string; code?: string | number; type?: string };
}

let server: StandinServer;
let standin: StandinClient;

const BODY = {
  model: 'standin-chat',
  stream: false,
  messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
};

/** `POST <base>/chat/completions` with `BODY` (or `body`) and optional headers. */
function complete(
  base = '/v1',
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(`${server.url}${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: JSON.stringify(init.body ?? BODY),
  });
}

async function completion(base = '/v1'): Promise<ChatCompletion> {
  const response = await complete(base);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/json');
  return (await response.json()) as ChatCompletion;
}

beforeAll(async () => {
  server = await serveStandin({ port: 0 });
  standin = standinClient(server.url);
});

afterEach(async () => {
  await standin.reset();
});

afterAll(async () => {
  await server.close();
});

describe('ai-standin: binding and ready data', () => {
  it('listens on a loopback ephemeral port and names it', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(standin.url).toBe(server.url);
  });

  it('answers an empty queue with the loud 500', async () => {
    const response = await complete();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { message: 'stand-in: no scenario queued' },
    });
    // The failed request is still recorded.
    const requests = await standin.requests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/chat/completions' });
  });

  it('serves under any base path and nothing else', async () => {
    await standin.scenarios([{ text: 'one' }, { text: 'two' }, { text: 'three' }]);
    expect((await completion('/v1')).choices[0].message.content).toBe('one');
    expect((await completion('/openai')).choices[0].message.content).toBe('two');
    expect((await completion('')).choices[0].message.content).toBe('three');
    const stray = await fetch(`${server.url}/v1`);
    expect(stray.status).toBe(404);
    const wrongMethod = await fetch(`${server.url}/v1/chat/completions`);
    expect(wrongMethod.status).toBe(405);
    // ... and the stray requests are in the record (FR-102: every connection attempt).
    const paths = (await standin.requests()).map((request) => `${request.method} ${request.path}`);
    expect(paths).toEqual([
      'POST /v1/chat/completions',
      'POST /openai/chat/completions',
      'POST /chat/completions',
      'GET /v1',
      'GET /v1/chat/completions',
    ]);
  });
});

describe('ai-standin: chat completion items', () => {
  it('{text}: a chat completion with finish_reason stop and a plausible envelope', async () => {
    await standin.scenario({ text: '<p>Он вышел на улицу.</p>' });
    const answer = await completion();
    expect(answer.id).toMatch(/^chatcmpl-/);
    expect(answer.object).toBe('chat.completion');
    expect(answer.created).toBeGreaterThan(1_700_000_000);
    expect(answer.model).toBe('standin-chat');
    expect(answer.choices).toEqual([
      {
        index: 0,
        message: { role: 'assistant', content: '<p>Он вышел на улицу.</p>' },
        finish_reason: 'stop',
      },
    ]);
    expect(answer.usage.total_tokens).toBe(
      answer.usage.prompt_tokens + answer.usage.completion_tokens,
    );
    expect(answer.usage.prompt_tokens).toBeGreaterThan(0);
  });

  it('echoes the requested model', async () => {
    await standin.scenario({ text: 'ok' });
    const response = await complete('/v1', { body: { ...BODY, model: 'gpt-oss-120b' } });
    expect(((await response.json()) as ChatCompletion).model).toBe('gpt-oss-120b');
  });

  it('{toolCalls}: object arguments are serialised, ids are call_<n>, content absent', async () => {
    await standin.scenario({
      toolCalls: [
        { name: 'read_part', arguments: { node: 'body[1]/section[2]' } },
        { name: 'get_outline' },
      ],
    });
    const answer = await completion();
    const choice = answer.choices[0];
    expect(choice.finish_reason).toBe('tool_calls');
    expect('content' in choice.message).toBe(false);
    expect(choice.message.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_part', arguments: '{"node":"body[1]/section[2]"}' },
      },
      { id: 'call_2', type: 'function', function: { name: 'get_outline', arguments: '{}' } },
    ]);
  });

  it('{toolCalls}: string arguments pass as given (wrong types, invalid JSON included) and ids are kept', async () => {
    await standin.scenario({
      toolCalls: [
        {
          name: 'read_part',
          arguments: '{"node": "body[1]/section[2]", "format": "fb2xml"}',
          id: 'chatcmpl-tool-b565654a33bdfd02',
        },
        { name: 'find', arguments: '{"query": ' },
        { name: 'read_part', arguments: { section_number: '1' } },
      ],
      content: 'I will read section 2 first.',
    });
    const { message, finish_reason } = (await completion()).choices[0];
    expect(finish_reason).toBe('tool_calls');
    expect(message.content).toBe('I will read section 2 first.');
    expect(message.tool_calls?.map((call) => call.id)).toEqual([
      'chatcmpl-tool-b565654a33bdfd02',
      'call_3',
      'call_4',
    ]);
    expect(message.tool_calls?.[0].function.arguments).toBe(
      '{"node": "body[1]/section[2]", "format": "fb2xml"}',
    );
    expect(message.tool_calls?.[1].function.arguments).toBe('{"query": ');
    expect(message.tool_calls?.[2].function.arguments).toBe('{"section_number":"1"}');
  });

  it('{toolCalls, content}: the four content shapes of R3 exactly as given', async () => {
    await standin.scenarios([
      { toolCalls: [{ name: 'a' }] },
      { toolCalls: [{ name: 'a' }], content: null },
      { toolCalls: [{ name: 'a' }], content: '' },
      { toolCalls: [{ name: 'a' }], content: 'text beside the call' },
    ]);
    const first = (await completion()).choices[0].message;
    expect(Object.hasOwn(first, 'content')).toBe(false);
    expect((await completion()).choices[0].message.content).toBeNull();
    expect((await completion()).choices[0].message.content).toBe('');
    expect((await completion()).choices[0].message.content).toBe('text beside the call');
  });

  it('{finishReason: "length", text}: a cut answer', async () => {
    await standin.scenario({ finishReason: 'length', text: '<p>Он вышел на' });
    const choice = (await completion()).choices[0];
    expect(choice.finish_reason).toBe('length');
    expect(choice.message.content).toBe('<p>Он вышел на');
  });

  it('{finishReason} on tool calls: cut calls are served with the given reason', async () => {
    await standin.scenario({
      finishReason: 'length',
      toolCalls: [{ name: 'a', arguments: '{"x' }],
    });
    const choice = (await completion()).choices[0];
    expect(choice.finish_reason).toBe('length');
    expect(choice.message.tool_calls).toHaveLength(1);
  });

  it('accepts extra response headers on an answer (the ratelimit headers of §5)', async () => {
    await standin.scenario({
      toolCalls: [{ name: 'read_part', arguments: {} }],
      headers: { 'ratelimit-limit': 2, 'ratelimit-remaining': '0', 'ratelimit-reset': '2' },
    });
    const response = await complete();
    expect(response.status).toBe(200);
    expect(response.headers.get('ratelimit-limit')).toBe('2');
    expect(response.headers.get('ratelimit-remaining')).toBe('0');
    expect(response.headers.get('ratelimit-reset')).toBe('2');
  });
});

describe('ai-standin: limits and error shapes', () => {
  it('429 with Retry-After and the Kong body (OVH)', async () => {
    await standin.scenario({
      status: 429,
      retryAfter: 3,
      body: { message: 'API rate limit exceeded' },
    });
    const response = await complete();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ message: 'API rate limit exceeded' });
  });

  it('402 with Retry-After and the Pollinations body', async () => {
    const body = {
      status: 402,
      success: false,
      error: {
        code: 'FREE_LIMIT',
        message: 'Free limit reached: 1 reply every 30 seconds per IP. Retry after 2s',
      },
    };
    await standin.scenario({ status: 402, retryAfter: 2, body });
    const response = await complete();
    expect(response.status).toBe(402);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(await response.json()).toEqual(body);
  });

  it('429 without Retry-After and the LLM7 body (the wait named in the body only)', async () => {
    const body = {
      error: {
        message: 'Daily token quota exceeded. Retry after 84441 seconds.',
        code: 'quota_exceeded',
        retry_after: 84441,
      },
    };
    await standin.scenario({ status: 429, body });
    const response = await complete();
    expect(response.status).toBe(429);
    expect(response.headers.has('retry-after')).toBe(false);
    expect(await response.json()).toEqual(body);
  });

  it('a limit without a body gets an OpenAI-shaped default that names no wait', async () => {
    await standin.scenarios([{ status: 429 }, { status: 402 }, { status: 503 }]);
    for (const status of [429, 402, 503]) {
      const response = await complete();
      expect(response.status).toBe(status);
      expect(response.headers.has('retry-after')).toBe(false);
      const body = (await response.json()) as ErrorBody;
      expect(typeof body.error.message).toBe('string');
      expect(typeof body.error.code).toBe('string');
      expect(body.error.message).not.toMatch(/\d/);
    }
  });

  it('503 with Retry-After (the wait case) and a status without body', async () => {
    await standin.scenarios([{ status: 503, retryAfter: 2 }, { status: 418 }]);
    const limit = await complete();
    expect(limit.status).toBe(503);
    expect(limit.headers.get('retry-after')).toBe('2');
    const other = await complete();
    expect(other.status).toBe(418);
    expect(((await other.json()) as ErrorBody).error.message).toBe('stand-in: HTTP 418');
  });

  it('Retry-After as an HTTP-date string is passed through', async () => {
    await standin.scenario({ status: 429, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' });
    const response = await complete();
    expect(response.headers.get('retry-after')).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
  });

  it('{status, body}: a 200 with error and no choices (Kilo upstream failure)', async () => {
    const body = {
      id: 'gen-1',
      error: {
        message: 'Upstream error from Nvidia: ResourceExhausted',
        code: 502,
        metadata: { error_type: 'provider_unavailable' },
      },
    };
    await standin.scenario({ status: 200, body });
    const response = await complete();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });

  it('{status, body}: a string error (Kilo malformed JSON)', async () => {
    await standin.scenario({
      status: 400,
      body: { error: 'Malformed JSON', error_type: 'invalid_request' },
    });
    const response = await complete();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Malformed JSON',
      error_type: 'invalid_request',
    });
  });

  it('{status, body, contentType}: text/plain and text/html bodies', async () => {
    await standin.scenarios([
      { status: 400, contentType: 'text/plain', body: 'Failed to parse the request body as JSON' },
      {
        status: 400,
        contentType: 'text/html',
        body: '<html><body><pre>SyntaxError: Unexpected end of JSON input</pre></body></html>',
      },
      { status: 502, body: '' },
    ]);
    const plain = await complete();
    expect(plain.status).toBe(400);
    expect(plain.headers.get('content-type')).toBe('text/plain');
    expect(await plain.text()).toBe('Failed to parse the request body as JSON');
    const html = await complete();
    expect(html.status).toBe(400);
    expect(html.headers.get('content-type')).toBe('text/html');
    expect(await html.text()).toContain('<pre>SyntaxError');
    const empty = await complete();
    expect(empty.status).toBe(502);
    expect(empty.headers.get('content-length')).toBe('0');
    expect(await empty.text()).toBe('');
  });

  it('a string body without contentType is text/plain', async () => {
    await standin.scenario({ status: 500, body: 'Internal Server Error' });
    const response = await complete();
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Internal Server Error');
  });

  it('a 3xx with Location (no redirect is followed by the editor)', async () => {
    await standin.scenario({
      status: 302,
      body: '',
      headers: { Location: 'https://example.invalid/v1/chat/completions' },
    });
    // `redirect: 'manual'`: fetch would otherwise follow the Location off host.
    const manual = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    expect(manual.status).toBe(302);
    expect(manual.headers.get('location')).toBe('https://example.invalid/v1/chat/completions');
  });

  it('{overflow: true}: one 400 context_length_exceeded naming the sizes, then the next item', async () => {
    await standin.scenarios([{ overflow: true }, { text: 'after the split' }]);
    const overflow = await complete();
    expect(overflow.status).toBe(400);
    const body = (await overflow.json()) as ErrorBody;
    expect(body.error.code).toBe('context_length_exceeded');
    expect(body.error.message).toMatch(/maximum context length is 65536 tokens/i);
    expect(body.error.message).toMatch(/requested about 184529 tokens/i);
    expect((await completion()).choices[0].message.content).toBe('after the split');
  });
});

describe('ai-standin: delays', () => {
  it('{delayMs} holds the next answer; a delayMs member holds its own item', async () => {
    await standin.scenarios([{ delayMs: 150 }, { text: 'late' }, { text: 'later', delayMs: 120 }]);
    let started = Date.now();
    expect((await completion()).choices[0].message.content).toBe('late');
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    started = Date.now();
    expect((await completion()).choices[0].message.content).toBe('later');
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });

  it('{delayMs} before an empty queue delays the 500 too', async () => {
    await standin.scenario({ delayMs: 100 });
    const started = Date.now();
    const response = await complete();
    expect(response.status).toBe(500);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });
});

describe('ai-standin: keyRequired mode', () => {
  it('401 missing_api_key without Authorization, invalid_api_key with a wrong key, the queue with the right one', async () => {
    await standin.scenarios([{ keyRequired: 'sk-test-123' }, { text: 'OK' }]);
    const missing = await complete();
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: { message: 'Missing API key.', code: 'missing_api_key' },
    });
    const empty = await complete('/v1', { headers: { authorization: 'Bearer ' } });
    expect(empty.status).toBe(401);
    expect(((await empty.json()) as ErrorBody).error.code).toBe('missing_api_key');
    const wrong = await complete('/v1', { headers: { authorization: 'Bearer sk-wrong' } });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as ErrorBody).error.code).toBe('invalid_api_key');
    // Neither 401 consumed the queue.
    expect((await standin.state()).queued).toBe(1);
    const right = await complete('/v1', { headers: { authorization: 'Bearer sk-test-123' } });
    expect(right.status).toBe(200);
    expect(((await right.json()) as ChatCompletion).choices[0].message.content).toBe('OK');
    // The record says only whether the header was there.
    const auth = (await standin.requests()).map((request) => request.headers.authorization);
    expect(auth).toEqual(['absent', 'present', 'present', 'present']);
    expect(JSON.stringify(await standin.requests())).not.toContain('sk-test-123');
  });

  it('guards GET /models as well and is cleared by DELETE /__standin/scenario', async () => {
    await standin.scenario({ keyRequired: 'sk-test-123' });
    const refused = await fetch(`${server.url}/v1/models`);
    expect(refused.status).toBe(401);
    const allowed = await fetch(`${server.url}/v1/models`, {
      headers: { authorization: 'Bearer sk-test-123' },
    });
    expect(allowed.status).toBe(200);
    await fetch(`${server.url}/__standin/scenario`, { method: 'DELETE' });
    const open = await fetch(`${server.url}/v1/models`);
    expect(open.status).toBe(200);
    expect((await standin.state()).modes.keyRequired).toBeNull();
  });
});

describe('ai-standin: models', () => {
  interface ModelList {
    object: string;
    data: { id: string; object: string; context_length?: number }[];
  }

  it('answers the default list without the mode, under any base', async () => {
    for (const base of ['/v1', '/openai']) {
      const response = await fetch(`${server.url}${base}/models`);
      expect(response.status).toBe(200);
      const list = (await response.json()) as ModelList;
      expect(list.object).toBe('list');
      expect(list.data.map((model) => model.id)).toEqual(['standin-chat', 'standin-mini']);
      expect(list.data[0].context_length).toBe(131072);
      expect(list.data[0].object).toBe('model');
    }
  });

  it('{models: [...]}: an OpenAI list from objects and bare ids; [] = no models', async () => {
    await standin.scenario({
      models: [{ id: 'gpt-oss-120b', context_length: 131072 }, 'Mistral-Small'],
    });
    const list = (await (await fetch(`${server.url}/v1/models`)).json()) as ModelList;
    expect(list).toEqual({
      object: 'list',
      data: [
        {
          object: 'model',
          created: expect.any(Number),
          owned_by: 'standin',
          id: 'gpt-oss-120b',
          context_length: 131072,
        },
        { id: 'Mistral-Small', object: 'model', created: expect.any(Number), owned_by: 'standin' },
      ],
    });
    await standin.scenario({ models: [] });
    expect(await (await fetch(`${server.url}/v1/models`)).json()).toEqual({
      object: 'list',
      data: [],
    });
  });

  it('{models: {...}}: the object is served verbatim as the non-list body', async () => {
    await standin.scenario({ models: { message: 'not a list' } });
    const response = await fetch(`${server.url}/v1/models`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'not a list' });
  });

  it('the model list never consumes the queue', async () => {
    await standin.scenario({ text: 'kept' });
    await fetch(`${server.url}/v1/models`);
    expect((await standin.state()).queued).toBe(1);
  });
});

describe('ai-standin: the record and the control endpoints', () => {
  it('records method, path, headers, bodyBytes and the parsed body; control requests are not recorded', async () => {
    await standin.scenario({ text: 'OK' });
    const body = { ...BODY, tools: [{ type: 'function', function: { name: 'read_part' } }] };
    const raw = JSON.stringify(body);
    await complete('/v1', {
      body,
      headers: { 'user-agent': 'MaximaFictionBookEditor/0.0.5', accept: 'application/json' },
    });
    await standin.state();
    const requests = await standin.requests();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/chat/completions');
    expect(request.headers['user-agent']).toBe('MaximaFictionBookEditor/0.0.5');
    expect(request.headers.accept).toBe('application/json');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers.authorization).toBe('absent');
    expect(request.bodyBytes).toBe(Buffer.byteLength(raw));
    expect(request.body).toEqual(body);
  });

  it('a non-JSON body is recorded by its size without a parsed body', async () => {
    await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    });
    const [request] = await standin.requests();
    expect(request.bodyBytes).toBe(8);
    expect(request.body).toBeUndefined();
  });

  it('DELETE /__standin/requests clears the record; DELETE /__standin/scenario the queue and modes', async () => {
    await standin.scenarios([{ text: 'a' }, { keyRequired: 'k' }, { models: [] }]);
    await complete();
    expect(await standin.requests()).toHaveLength(1);
    await fetch(`${server.url}/__standin/requests`, { method: 'DELETE' });
    expect(await standin.requests()).toEqual([]);
    expect((await standin.state()).modes).toEqual({ keyRequired: 'k', models: [] });
    const cleared = (await (
      await fetch(`${server.url}/__standin/scenario`, { method: 'DELETE' })
    ).json()) as { queued: number; modes: unknown };
    expect(cleared).toEqual({ queued: 0, queue: [], modes: { keyRequired: null, models: null } });
    // The scenario reset left the record alone (the helper reset() clears both).
    await complete();
    expect(await standin.requests()).toHaveLength(1);
    await standin.reset();
    expect(await standin.requests()).toEqual([]);
  });

  it('POST /__standin/scenario reports the queue and refuses an unknown item or a bad mode', async () => {
    const state = await standin.scenarios([{ text: 'a' }, { delayMs: 1 }]);
    expect(state.queued).toBe(2);
    expect(state.queue).toEqual([{ text: 'a' }, { delayMs: 1 }]);
    for (const bad of [
      { foo: 'bar' },
      { toolCalls: [{ arguments: {} }] },
      { keyRequired: 5 },
      { models: 'gpt' },
      { status: 'x' },
      { text: 'a', delayMs: -1 },
      'text',
    ]) {
      const response = await fetch(`${server.url}/__standin/scenario`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bad),
      });
      expect(response.status, JSON.stringify(bad)).toBe(400);
      expect(((await response.json()) as ErrorBody).error.message).toMatch(/^stand-in: /);
    }
    const notJson = await fetch(`${server.url}/__standin/scenario`, {
      method: 'POST',
      body: '{',
    });
    expect(notJson.status).toBe(400);
    // Nothing of the refused items reached the queue.
    expect((await standin.state()).queued).toBe(2);
    const unknown = await fetch(`${server.url}/__standin/other`);
    expect(unknown.status).toBe(404);
    expect(await standin.requests()).toEqual([]);
  });

  it('scenarioKind classifies the vocabulary', () => {
    expect(scenarioKind({ text: 'a' })).toBe('text');
    expect(scenarioKind({ finishReason: 'length', text: 'a' })).toBe('text');
    expect(scenarioKind({ toolCalls: [] })).toBe('toolCalls');
    expect(scenarioKind({ status: 429 })).toBe('http');
    expect(scenarioKind({ status: 200, body: {} })).toBe('http');
    expect(scenarioKind({ delayMs: 5 })).toBe('delay');
    expect(scenarioKind({ text: 'a', delayMs: 5 })).toBe('text');
    expect(scenarioKind({ overflow: true })).toBe('overflow');
    expect(scenarioKind({ keyRequired: 'k' })).toBe('keyRequired');
    expect(scenarioKind({ models: [] })).toBe('models');
    expect(scenarioKind({})).toBeNull();
    expect(scenarioKind(null)).toBeNull();
    expect(scenarioKind([{ text: 'a' }])).toBeNull();
  });
});
