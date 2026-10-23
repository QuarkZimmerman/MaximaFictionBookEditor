/**
 * The request loop's pure companions (feature 005 T046; data-model §2.4, §5.1-§5.2; ai-catalogue
 * §6.11, §6.16): the active target derived from the settings and the effective list, the user
 * message that tells the model a fast-path replacement was rejected, and the conversation /
 * activity writer the loop appends to live. The loop itself is exercised end to end by the
 * `us2-ai-popup` journey against the stand-in.
 */

import {
  appendActivity,
  appendMessage,
  conversationFor,
  nextRequestId,
  updateActivity,
} from '@/ai/activity';
import { historyTurns, rejectionMessage } from '@/ai/assistant';
import { fetchedModelInfo, resolveActiveTarget } from '@/ai/target';
import { createAppStore, type AssistantMessage } from '@/model/store';
import type { AiServiceEntry, AiServicesResult } from '@/rpc/types';

import { fakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

function entry(overrides: Partial<AiServiceEntry> = {}): AiServiceEntry {
  return {
    id: 'standin',
    name: 'Stand-in',
    address: 'http://127.0.0.1:8787/v1',
    model: 'standin-chat',
    keyRequired: false,
    hasKey: false,
    tools: true,
    limits: { en: 'none', ru: 'нет', uk: 'немає' },
    source: 'user',
    replaced: false,
    local: true,
    plainHttp: true,
    ...overrides,
  };
}

function services(list: AiServiceEntry[]): AiServicesResult {
  return {
    services: list,
    hidden: [],
    files: { bundled: '/b.json', user: '/u.json', userExists: true },
    issues: [],
  };
}

describe('resolveActiveTarget', () => {
  it('names the chosen free entry with its tools, terms and context length; a local entry needs no notice', async () => {
    const rpc = fakeRpc({
      'ai.services': services([
        entry({ id: 'ovhcloud', name: 'OVH', local: false, plainHttp: false, tools: false }),
        entry({ termsUrl: 'http://127.0.0.1:8787/terms', contextLength: 4096 }),
      ]),
    });
    const settings = defaultSettings();
    settings.ai.freeServiceId = 'standin';
    const resolved = await resolveActiveTarget(rpc.client, settings);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target).toMatchObject({
      target: { kind: 'free', id: 'standin' },
      name: 'Stand-in',
      model: 'standin-chat',
      hosted: false,
      plain: true,
      tools: true,
      contextLength: 4096,
      termsUrl: 'http://127.0.0.1:8787/terms',
      fallback: false,
    });
    expect(resolved.target.notice).toEqual({
      kind: 'free',
      id: 'standin',
      address: 'http://127.0.0.1:8787/v1',
      name: 'Stand-in',
      termsUrl: 'http://127.0.0.1:8787/terms',
    });
  });

  it('falls back to the first entry when the saved id is gone, and reports an empty list', async () => {
    const rpc = fakeRpc({
      'ai.services': services([entry({ id: 'kilo', name: 'Kilo', local: false, tools: false })]),
    });
    const settings = defaultSettings();
    settings.ai.freeServiceId = 'vanished';
    const resolved = await resolveActiveTarget(rpc.client, settings);
    expect(resolved).toMatchObject({
      ok: true,
      target: { target: { kind: 'free', id: 'kilo' }, fallback: true, hosted: true, tools: false },
    });
    const empty = fakeRpc({ 'ai.services': services([]) });
    expect(await resolveActiveTarget(empty.client, settings)).toEqual({
      ok: false,
      reason: 'emptyList',
    });
  });

  it('derives the custom target from the stored triple without reading the list; disabled and empty fields answer a reason', async () => {
    const rpc = fakeRpc({});
    const settings = defaultSettings();
    settings.ai.mode = 'custom';
    settings.ai.custom = { address: 'https://ai.example.test/v1/', key: 'sk', model: 'm' };
    const resolved = await resolveActiveTarget(rpc.client, settings);
    expect(resolved).toMatchObject({
      ok: true,
      target: {
        target: { kind: 'custom' },
        name: 'ai.example.test',
        model: 'm',
        hosted: true,
        plain: false,
        tools: true,
        notice: { kind: 'custom', address: 'https://ai.example.test/v1/', name: 'ai.example.test' },
      },
    });
    expect(rpc.calls).toEqual([]); // the key never travels, the list is not needed
    settings.ai.custom.model = '';
    expect(await resolveActiveTarget(rpc.client, settings)).toEqual({
      ok: false,
      reason: 'noModel',
    });
    settings.ai.custom.address = ' ';
    expect(await resolveActiveTarget(rpc.client, settings)).toEqual({
      ok: false,
      reason: 'emptyAddress',
    });
    settings.ai.mode = 'disabled';
    expect(await resolveActiveTarget(rpc.client, settings)).toEqual({
      ok: false,
      reason: 'disabled',
    });
    expect(await resolveActiveTarget(rpc.client, null)).toEqual({
      ok: false,
      reason: 'noSettings',
    });
  });

  it("takes the custom target's tools and context length from the last Fetch models answer when the chosen model was in it (US8, data-model §2.4)", async () => {
    const rpc = fakeRpc({});
    const settings = defaultSettings();
    settings.ai.mode = 'custom';
    settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: '', model: 'standin-mini' };
    const memory = {
      address: 'http://127.0.0.1:8787/v1/',
      models: [
        { id: 'standin-chat', contextLength: 131072 },
        { id: 'standin-mini', contextLength: 8192, tools: false },
        { id: 'standin-embed', contextLength: 0 },
      ],
    };
    // The chosen model is in the list (trailing slashes aside): its tools and context length.
    expect(await resolveActiveTarget(rpc.client, settings, memory)).toMatchObject({
      ok: true,
      target: { tools: false, contextLength: 8192, model: 'standin-mini', hosted: false },
    });
    // Listed without `tools`: assumed true; a context length of 0 is no length.
    settings.ai.custom.model = 'standin-embed';
    const embed = await resolveActiveTarget(rpc.client, settings, memory);
    expect(embed).toMatchObject({ ok: true, target: { tools: true } });
    if (embed.ok) expect(embed.target.contextLength).toBeUndefined();
    // A model the list did not have, another address, or no fetch at all: tools assumed true.
    settings.ai.custom.model = 'typed-model';
    expect(await resolveActiveTarget(rpc.client, settings, memory)).toMatchObject({
      ok: true,
      target: { tools: true },
    });
    settings.ai.custom.model = 'standin-mini';
    settings.ai.custom.address = 'http://127.0.0.1:9999/v1';
    expect(await resolveActiveTarget(rpc.client, settings, memory)).toMatchObject({
      ok: true,
      target: { tools: true },
    });
    expect(fetchedModelInfo(null, 'http://127.0.0.1:8787/v1', 'standin-mini')).toEqual({});
    expect(fetchedModelInfo(memory, 'http://127.0.0.1:8787/v1', 'standin-chat')).toEqual({
      contextLength: 131072,
    });
    expect(rpc.calls).toEqual([]);
  });
});

describe('rejectionMessage', () => {
  it('is the §6.11 user message with every issue on its own line', () => {
    const text = rejectionMessage([
      {
        code: 'xml.notWellFormed',
        element: '',
        message: 'Opening and ending tag mismatch',
        line: 1,
      },
      {
        code: 'schema.invalid',
        element: 'title',
        path: 'body[1]/section[2]/title[1]',
        message: 'not expected',
      },
    ]);
    expect(text).toBe(
      'The replacement was rejected by the FB2 2.1 schema check and was not applied:\n' +
        '- xml.notWellFormed: Opening and ending tag mismatch (line 1)\n' +
        '- schema.invalid, element title at body[1]/section[2]/title[1]: not expected\n' +
        'Reply with a corrected replacement only, in the same form.',
    );
  });
});

describe('the conversation writer', () => {
  it("adopts the document, appends messages and activity entries live and drops another document's conversation", () => {
    const store = createAppStore();
    conversationFor(store, 'doc-1');
    const requestId = nextRequestId();
    expect(requestId).toMatch(/^r\d+$/);
    const user = appendMessage(store, { requestId, role: 'user', text: 'Fix typos' });
    expect(user.id).toMatch(/^m\d+$/);
    appendActivity(store, {
      requestId,
      elapsedMs: 5,
      kind: 'request.start',
      payload: { kind: 'selection' },
    });
    appendActivity(store, { requestId, elapsedMs: 9, kind: 'request.done' });
    const { conversation } = store.getState().ai;
    expect(conversation.docId).toBe('doc-1');
    expect(conversation.messages.map((m) => [m.role, m.text])).toEqual([['user', 'Fix typos']]);
    expect(conversation.activity.map((e) => [e.kind, e.requestId, e.elapsedMs, e.payload])).toEqual(
      [
        ['request.start', requestId, 5, { kind: 'selection' }],
        ['request.done', requestId, 9, {}],
      ],
    );
    // The same document keeps it; another one clears it (FR-045).
    conversationFor(store, 'doc-1');
    expect(store.getState().ai.conversation.messages).toHaveLength(1);
    conversationFor(store, 'doc-2');
    expect(store.getState().ai.conversation).toEqual({
      docId: 'doc-2',
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    expect(nextRequestId()).not.toBe(requestId);
  });

  it('completes the payload of an earlier entry in place (the tool.call summary after the result)', () => {
    const store = createAppStore();
    conversationFor(store, 'doc-1');
    const entry = appendActivity(store, {
      requestId: 'r1',
      elapsedMs: 1,
      kind: 'tool.call',
      payload: { name: 'find', summary: 'Searched "ё"' },
    });
    appendActivity(store, { requestId: 'r1', elapsedMs: 2, kind: 'tool.result' });
    updateActivity(store, entry, { summary: 'Searched "ё" (12 matches)' });
    const { activity } = store.getState().ai.conversation;
    expect(activity.map((e) => e.kind)).toEqual(['tool.call', 'tool.result']);
    expect(activity[0]!.payload).toEqual({ name: 'find', summary: 'Searched "ё" (12 matches)' });
    expect(activity[0]!.at).toBe(entry.at);
    // An entry of a cleared conversation is left alone.
    conversationFor(store, 'doc-2');
    updateActivity(store, entry, { summary: 'late' });
    expect(store.getState().ai.conversation.activity).toEqual([]);
  });
});

describe('historyTurns (ai-catalogue §5.2 item 2, data-model §5.3)', () => {
  const message = (
    requestId: string,
    role: AssistantMessage['role'],
    text: string,
    extra: Partial<AssistantMessage> = {},
  ): AssistantMessage => ({
    id: `${requestId}-${role}-${text}`,
    at: 0,
    requestId,
    role,
    text,
    ...extra,
  });

  it('resends every earlier request as its user text and its final text with the applied line - never tool traffic, interim words or notices', () => {
    const messages: AssistantMessage[] = [
      message('r1', 'user', 'Fix the titles'),
      message('r1', 'assistant', 'Reading the outline first.', { interim: true }),
      message('r1', 'assistant', 'Done: three titles.', {
        appliedLine: '[Changes applied in this turn: replace_node ×3]',
        undoLabel: 'Fix the titles',
      }),
      message('r2', 'user', 'How many footnotes?'),
      message('r2', 'assistant', 'Two.', { appliedLine: '[No change]' }),
      message('r3', 'user', 'Rename everything'),
      message('r3', 'notice', 'Request cancelled.'),
      message('r4', 'user', 'And now?'),
    ];
    expect(historyTurns(messages, 'r4')).toEqual([
      {
        requestId: 'r1',
        user: 'Fix the titles',
        assistant: 'Done: three titles.\n[Changes applied in this turn: replace_node ×3]',
      },
      { requestId: 'r2', user: 'How many footnotes?', assistant: 'Two.\n[No change]' },
    ]);
  });

  it('falls back to [No change] for a final text without a line and keeps the order of the requests', () => {
    const messages: AssistantMessage[] = [
      message('r2', 'user', 'Second'),
      message('r2', 'assistant', 'Answer two'),
      message('r1', 'user', 'First'),
      message('r1', 'assistant', 'Answer one'),
    ];
    expect(historyTurns(messages, 'r9').map((turn) => turn.assistant)).toEqual([
      'Answer two\n[No change]',
      'Answer one\n[No change]',
    ]);
    expect(historyTurns([], 'r1')).toEqual([]);
  });
});
