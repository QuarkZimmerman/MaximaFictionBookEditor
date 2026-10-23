/**
 * The privacy record and the logging discipline of the request loop (feature 005 US7 T080;
 * ai-catalogue §1.8, §6.16, §6.18; ai-service-protocol §9; research R10.4; review C14, C16,
 * C17, D5; FR-042, FR-100): every read tool writes a `tool.call` entry naming the part that
 * left the computer - *Read section 3 "Title" (2 300 characters, part 1 of 2)*, *Searched "ё"
 * (12 matches)* -, `request.start` names the outline and the selection as sent, no entry
 * carries a key, a token, a `docId` or an address path, a `tool.error` of an unknown node
 * carries the id alone, the configured key is `•••` wherever a service's words are rendered,
 * and an unexpected exception inside a step ends the request `failed (internal)` with the one
 * log line `{code: 'ai.internal', message: error.name}` - never the message or the stack. The
 * loop runs here against a scripted `ai.complete` (the fake RPC's `runJob`), the stand-in
 * journeys (`us7-ai-privacy.spec.ts`) prove the same against the core.
 */

import i18next from 'i18next';

import { activityText } from '@/ai/AiPanel';
import { displayKeyOf, KEY_MASK, maskKey } from '@/ai/address';
import {
  setFailNextTool,
  startAssistant,
  startRequest,
  stopAssistant,
  type RequestOutcome,
} from '@/ai/assistant';
import { forbiddenRequestMembers } from '@/ai/context';
import { callSummary, resultSummary } from '@/ai/summaries';
import type { CommandContext } from '@/app/commands';
import { initI18n } from '@/i18n';
import { actions, type AppStore, type AssistantActivityEntry } from '@/model/store';
import type { AiOutcome, ChatRequest } from '@/rpc/types';

import { fakeDialogs, fakeRpc, makeContext, type FakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

import { book, validateDocument } from './sessionUtils';

const KEY = 'sk-unit-key-7731';
const TOKEN = 'tok-page-session-4a1';
const ADDRESS_PATH = '/v1/secret-path';

beforeAll(async () => {
  await initI18n({ language: 'en' });
});

const t = () => i18next.getFixedT('en');

function entry(kind: AssistantActivityEntry['kind'], payload: Record<string, unknown>) {
  return { at: 0, requestId: 'r1', elapsedMs: 1, kind, payload } as AssistantActivityEntry;
}

/* ------------------------------------------------------------------------ */
/* The entries name the part, never the text                                 */
/* ------------------------------------------------------------------------ */

describe('the tool.call entries of the read tools name the part that left the computer', () => {
  const document = book({ preExisting: false });

  it('read_part: the section by number and title, the characters and the part index', () => {
    const call = { name: 'read_part', args: { node: 'body[1]/section[1]' } };
    const summary = resultSummary(
      t(),
      call,
      {
        node: { id: 's1', path: 'body[1]/section[1]', type: 'section', characters: 2300 },
        blocks: [{ text: 'x'.repeat(1200) }],
        more: { cursor: 'after:p1', remaining: { blocks: 1, characters: 1100 }, hint: 'more' },
      },
      document,
    );
    expect(summary).toBe('Read section 1 "ONE" (2300 characters, part 1 of 2)');
    expect(activityText(t(), entry('tool.call', { name: 'read_part', summary }))).toBe(
      'Read section 1 "ONE" (2300 characters, part 1 of 2)',
    );
    // The text the tool delivered ('xxx…', the paragraphs) is nowhere in the entry.
    expect(summary).not.toContain('xxxx');
    expect(summary).not.toContain('First paragraph');
  });

  it('get_outline, get_selection, get_description, find, read_script, read_resource', () => {
    const summary = (name: string, args: Record<string, unknown>) =>
      callSummary(t(), { name, args }, document);
    expect(summary('get_outline', {})).toBe('Read the outline');
    expect(summary('get_outline', { node: 's2' })).toBe('Read the outline of section 2');
    expect(summary('get_selection', {})).toBe('Read the selection');
    expect(summary('get_description', {})).toBe('Read the description');
    expect(summary('find', { text: 'ё' })).toBe('Searched "ё"');
    expect(
      resultSummary(
        t(),
        { name: 'find', args: { text: 'ё' } },
        { matches: [], total: 12 },
        document,
      ),
    ).toBe('Searched "ё" (12 matches)');
    expect(summary('read_script', { id: 'assistant/upper-case' })).toBe(
      'Read the script assistant/upper-case',
    );
    expect(summary('read_resource', { uri: 'mfbe://script-api.d.ts' })).toBe(
      'Read the reference mfbe://script-api.d.ts',
    );
    // set_description names the fields written, never a value (C14).
    expect(
      resultSummary(
        t(),
        { name: 'set_description', args: { description: { titleInfo: { bookTitle: 'secret' } } } },
        { description: {}, fields: ['titleInfo.bookTitle'] },
        document,
      ),
    ).toBe('Changed the description (titleInfo.bookTitle)');
  });

  it('request.start names the service, the outline by its sections and the selection by its size', () => {
    expect(
      activityText(
        t(),
        entry('request.start', {
          kind: 'selection',
          origin: 'popup',
          service: 'Stand-in',
          model: 'standin-chat',
          outline: { sections: 12 },
          selection: { characters: 240, blocks: 2 },
        }),
      ),
    ).toBe(
      "Request started — Stand-in · standin-chat — sent: the book's title and outline (12 sections), the selection (240 characters, 2 blocks)",
    );
    expect(
      activityText(
        t(),
        entry('request.start', {
          kind: 'general',
          origin: 'panel',
          service: 'Stand-in',
          model: 'standin-chat',
          outline: { sections: 1 },
        }),
      ),
    ).toBe(
      "Request started — Stand-in · standin-chat — sent: the book's title and outline (1 section)",
    );
    // An entry of an older session without the outline member still renders.
    expect(
      activityText(t(), entry('request.start', { service: 'S', model: 'm', kind: 'general' })),
    ).toBe('Request started — S · m');
  });

  it('a tool.error of an unknown node carries the id alone - no text, no path of a file', () => {
    const text = activityText(
      t(),
      entry('tool.error', {
        name: 'read_part',
        code: 'unknownNode',
        message: 'No node n9123 in the document.',
        hint: 'Use the ids returned by get_outline, read_part or find; paths shift after insertions.',
      }),
    );
    expect(text).toBe(
      'The assistant called read_part wrongly (unknownNode): No node n9123 in the document. ' +
        'Told: Use the ids returned by get_outline, read_part or find; paths shift after insertions.',
    );
  });

  it('no rendered entry of a whole request carries a key, a token, a docId or an address path', () => {
    const entries: AssistantActivityEntry[] = [
      entry('request.start', {
        kind: 'general',
        origin: 'panel',
        service: 'ai.standin.test:8787',
        model: 'standin-chat',
        outline: { sections: 3 },
      }),
      entry('validate.baseline', { errors: 0, warnings: 0, durationMs: 3 }),
      entry('exchange.sent', { n: 1, messages: 2, tools: 24, bytes: 4000 }),
      entry('exchange.answered', {
        n: 1,
        elapsedMs: 120,
        finishReason: 'tool_calls',
        toolCalls: 1,
      }),
      entry('tool.call', { name: 'read_part', summary: 'Read section 1 "ONE" (2300 characters)' }),
      entry('tool.result', {
        name: 'read_part',
        summary: 'Read section 1 "ONE" (2300 characters)',
      }),
      entry('limit.wait', { seconds: 2, source: 'header' }),
      entry('change.try', { tool: 'replace_node', target: 'body[1]/section[1]/title[1]' }),
      entry('validate', { new: 0, preExisting: 0, durationMs: 2 }),
      entry('change.accepted', { tool: 'replace_node', target: 'body[1]/section[1]/title[1]' }),
      entry('request.done', { changes: 1, exchanges: 2, elapsedMs: 900 }),
    ];
    const rendered = entries.map((e) => activityText(t(), e, KEY)).join('\n');
    for (const secret of [KEY, TOKEN, 'doc-1', 'docId', ADDRESS_PATH, '/books/alpha.fb2']) {
      expect(rendered, secret).not.toContain(secret);
    }
    // The host of the service may appear (the privacy record names where the text went).
    expect(rendered).toContain('ai.standin.test:8787');
  });
});

/* ------------------------------------------------------------------------ */
/* The rendering helpers treat every service text as text, the key masked    */
/* ------------------------------------------------------------------------ */

describe('service text is rendered as text with the configured key masked (C16, §9)', () => {
  it('request.failed shows the kind text and the service words with the key as •••', () => {
    const text = activityText(
      t(),
      entry('request.failed', {
        kind: 'auth',
        message: `Incorrect API key provided: ${KEY}. See <a href="https://x.test">help</a>`,
      }),
      KEY,
    );
    expect(text).toContain(`Incorrect API key provided: ${KEY_MASK}.`);
    expect(text).not.toContain(KEY);
    // Markup stays literal text: the panel renders the line as a text node.
    expect(text).toContain('<a href="https://x.test">help</a>');
  });

  it('maskKey and displayKeyOf: the custom key alone, trimmed, never an empty needle', () => {
    const settings = defaultSettings();
    expect(displayKeyOf(settings)).toBeUndefined();
    settings.ai.mode = 'custom';
    settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: `  ${KEY} `, model: 'm' };
    expect(displayKeyOf(settings)).toBe(KEY);
    settings.ai.custom.key = '   ';
    expect(displayKeyOf(settings)).toBeUndefined();
    // A one- to three-character "key" is no credential: masking it would strike letters out
    // of the model's words ("Thinking" → "Thin•••ing").
    settings.ai.custom.key = 'k';
    expect(displayKeyOf(settings)).toBeUndefined();
    settings.ai.custom.key = 'abcd';
    expect(displayKeyOf(settings)).toBe('abcd');
    expect(displayKeyOf(null)).toBeUndefined();
    expect(maskKey(`Bearer ${KEY} and again ${KEY}`, KEY)).toBe(
      `Bearer ${KEY_MASK} and again ${KEY_MASK}`,
    );
    expect(maskKey('untouched https://a.test/v1', undefined)).toBe('untouched https://a.test/v1');
  });
});

/* ------------------------------------------------------------------------ */
/* The loop against a scripted ai.complete                                    */
/* ------------------------------------------------------------------------ */

interface LoopHarness {
  store: AppStore;
  rpc: FakeRpc;
  ctx: CommandContext;
  /** The bodies `ai.complete` received, in order. */
  bodies: ChatRequest[];
  logCalls: () => Record<string, unknown>[];
}

/**
 * A store with the fixture book, the assistant on, the custom target at a loopback address
 * (no notice) with a key, and a fake RPC whose `ai.complete` answers the scripted outcomes in
 * order; `doc.validate` is the scripted validator of the session tests.
 */
async function loopHarness(outcomes: AiOutcome[]): Promise<LoopHarness> {
  const bodies: ChatRequest[] = [];
  const queue = [...outcomes];
  const rpc = fakeRpc({
    'doc.validate': (params: unknown) =>
      validateDocument((params as { document: Parameters<typeof validateDocument>[0] }).document),
    'ai.complete': (params: unknown) => {
      bodies.push((params as { body: ChatRequest }).body);
      const next = queue.shift();
      if (!next) throw new Error('no scripted outcome left');
      return next;
    },
    'log.error': {},
    'job.cancel': {},
    'schema.text': { text: '' },
  });
  const ctx = await makeContext({ rpc: rpc.client, dialogs: fakeDialogs() });
  const { store } = ctx;
  const settings = defaultSettings();
  settings.ai.mode = 'custom';
  settings.ai.custom = { address: `http://127.0.0.1:8787${ADDRESS_PATH}`, key: KEY, model: 'm1' };
  actions.setSettings(store, settings);
  actions.setConnection(store, 'connected');
  actions.setDocument(store, book({ preExisting: false }));
  startAssistant(store);
  return {
    store,
    rpc,
    ctx,
    bodies,
    logCalls: () =>
      rpc.calls
        .filter((call) => call.method === 'log.error')
        .map((call) => call.params as Record<string, unknown>),
  };
}

function toolCallOutcome(name: string, args: Record<string, unknown> = {}): AiOutcome {
  return {
    ok: true,
    status: 200,
    elapsedMs: 3,
    body: {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    },
  };
}

function textOutcome(text: string): AiOutcome {
  return {
    ok: true,
    status: 200,
    elapsedMs: 2,
    body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] },
  };
}

describe('the loop: an unexpected exception and a service failure (C17, R10.4, D5)', () => {
  let harness: LoopHarness | null = null;

  afterEach(() => {
    if (harness) stopAssistant(harness.store);
    harness = null;
    setFailNextTool(null);
  });

  it('an exception thrown inside a tool step ends the request failed (internal) and logs ai.internal with the error name alone', async () => {
    harness = await loopHarness([toolCallOutcome('get_outline'), textOutcome('unused')]);
    const { store, ctx, rpc } = harness;
    const secret = 'boom: the instruction said «aiq-0c1f» and the book says «Дорога длинна»';
    setFailNextTool('get_outline', secret);
    const instruction = 'Read the outline aiq-0c1f';

    const outcome: RequestOutcome = await startRequest(ctx, {
      origin: 'panel',
      instruction,
      selection: null,
    });
    expect(outcome).toEqual({ kind: 'failed', failure: { kind: 'internal' } });

    // The one log line: the fixed code, the error's name as the message, no stack, the request
    // id as the only context - and nothing of the message, the instruction or the book.
    const logged = harness.logCalls();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual({
      source: 'ui',
      code: 'ai.internal',
      message: 'Error',
      stack: undefined,
      context: { requestId: expect.stringMatching(/^r\d+$/) as unknown as string },
    });
    const everything = JSON.stringify(rpc.calls.filter((call) => call.method === 'log.error'));
    for (const forbidden of [secret, 'boom', 'aiq-0c1f', 'Дорога', KEY, '/books/alpha.fb2']) {
      expect(everything, forbidden).not.toContain(forbidden);
    }

    // The record and the notice: `failed (internal)`, the localised text, the lock released,
    // the document as it was (nothing of the exception's words anywhere on screen).
    const { conversation } = store.getState().ai;
    const failed = conversation.activity.filter((e) => e.kind === 'request.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload).toEqual({ kind: 'internal' });
    expect(activityText(t(), failed[0]!)).toBe(
      'Failed: Something went wrong inside the editor; the book was left unchanged.',
    );
    const notice = conversation.messages.at(-1)!;
    expect(notice.role).toBe('notice');
    expect(notice.text).toBe(
      'Something went wrong inside the editor; the book was left unchanged.',
    );
    expect(JSON.stringify(conversation)).not.toContain('boom');
    expect(store.getState().runLock).toBeNull();
    expect(store.getState().ai.request).toBeNull();
    expect(store.getState().modified).toBe(false);
    // The tool.call entry was written before the step threw: it names the part, not the error.
    const calls = conversation.activity.filter((e) => e.kind === 'tool.call');
    expect(calls.map((e) => e.payload.summary)).toEqual(['Read the outline']);
  });

  it("a service failure is rendered with the key masked and never logged by the UI; the body carries no docId, path or key member and the book's title alone", async () => {
    harness = await loopHarness([
      {
        ok: false,
        kind: 'http',
        status: 401,
        elapsedMs: 4,
        body: {
          error: { message: `Incorrect API key provided: ${KEY}.`, code: 'invalid_api_key' },
        },
      },
    ]);
    const { store, ctx, bodies } = harness;
    const outcome = await startRequest(ctx, {
      origin: 'panel',
      instruction: 'Fix the typos',
      selection: null,
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.kind).toBe('auth');

    // Nothing logged by the UI for a service failure (the core writes its ai.http line).
    expect(harness.logCalls()).toEqual([]);

    // The record and the notice carry the service's words with the key as •••.
    const { conversation } = store.getState().ai;
    const failed = conversation.activity.find((e) => e.kind === 'request.failed')!;
    expect(failed.payload).toEqual({
      kind: 'auth',
      message: `Incorrect API key provided: ${KEY_MASK}.`,
    });
    const notice = conversation.messages.at(-1)!;
    expect(notice.text).toContain(`Incorrect API key provided: ${KEY_MASK}. (invalid_api_key)`);
    expect(notice.text).not.toContain(KEY);
    expect(activityText(t(), failed, KEY)).not.toContain(KEY);

    // The request body (ai-service-protocol §9): no forbidden member, the book's title and
    // language only - no authors, no genres, no file path, no docId, no key, no address path.
    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(forbiddenRequestMembers(body.messages)).toEqual([]);
    const serialised = JSON.stringify(body);
    const system = (body.messages[0] as { content: string }).content;
    expect(system).toContain('"book": {\n    "title": "Alpha"\n  }');
    for (const forbidden of [
      'docId',
      'doc-1',
      '/books/alpha.fb2',
      KEY,
      ADDRESS_PATH,
      '"authors"',
      '"genres"',
      'Petrov',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    // The members of the body: the messages and the tools array with its choice - the core adds
    // `model` and `stream`; nothing else (no `user`, no `metadata`).
    expect(Object.keys(body).sort()).toEqual(['messages', 'tool_choice', 'tools']);
  });
});
