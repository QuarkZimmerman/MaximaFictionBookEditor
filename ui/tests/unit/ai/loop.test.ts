/**
 * The request loop's pure companions (feature 005 T046; data-model §2.4, §5.1-§5.2; ai-catalogue
 * §6.11, §6.16): the active target derived from the settings and the effective list, the user
 * message that tells the model a fast-path replacement was rejected, and the conversation /
 * activity writer the loop appends to live. The loop itself is exercised end to end by the
 * `us2-ai-popup` journey against the stand-in.
 */

import { appendActivity, appendMessage, conversationFor, nextRequestId } from '@/ai/activity';
import { rejectionMessage } from '@/ai/assistant';
import { resolveActiveTarget } from '@/ai/target';
import { createAppStore } from '@/model/store';
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
});
