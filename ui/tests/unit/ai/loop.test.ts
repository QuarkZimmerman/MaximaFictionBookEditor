/**
 * The request loop's pure companions (feature 005 T046; data-model §2.4, §5.1-§5.2; ai-catalogue
 * §6.11, §6.16): the active target derived from the settings and the effective list, the user
 * message that tells the model a fast-path replacement was rejected, and the conversation /
 * activity writer the loop appends to live. The loop itself is exercised end to end by the
 * `us2-ai-popup` journey against the stand-in.
 */

/**
 * The field target of the Description view (US10's `activeTableTarget`, T161), stood in for
 * by a mock: a field whose state holds a block of cells (feature 006 T173).
 */
const fieldTarget = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/tables/target', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tables/target')>();
  return { ...actual, activeTableTarget: () => fieldTarget.current };
});

import {
  appendActivity,
  appendMessage,
  conversationFor,
  nextRequestId,
  updateActivity,
} from '@/ai/activity';
import {
  historyTurns,
  rejectionMessage,
  startAssistant,
  startRequest,
  stopAssistant,
} from '@/ai/assistant';
import type { SelectionSnapshot } from '@/ai/context';
import { fetchedModelInfo, resolveActiveTarget } from '@/ai/target';
import { findNodeById } from '@/editor/schema';
import { CellBlockSelection } from '@/editor/table/selection';
import type { Document } from '@/model/document';
import { actions, createAppStore, type AssistantMessage } from '@/model/store';
import type { AiOutcome, AiServiceEntry, AiServicesResult, ChatRequest } from '@/rpc/types';
import { createRichFieldState } from '@/views/description/richFieldState';

import { fakeDialogs, fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

import { tablesBook } from './catalogueHarness';
import { validateDocument } from './sessionUtils';

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

/* ------------------------------------------------------------------------ */
/* Feature 006 (US11, T173): a block of cells gives a general request        */
/* ------------------------------------------------------------------------ */

describe('feature 006: a cells selection gives a general request (FR-063; T173)', () => {
  async function loop(outcomes: AiOutcome[], document: Document) {
    const bodies: ChatRequest[] = [];
    const queue = [...outcomes];
    const rpc = fakeRpc({
      'doc.validate': (params: unknown) =>
        validateDocument((params as { document: Document }).document),
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
    const settings = defaultSettings();
    settings.ai.mode = 'custom';
    settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: '', model: 'm1' };
    actions.setSettings(ctx.store, settings);
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, document);
    startAssistant(ctx.store);
    return { ctx, bodies };
  }

  const text = (content: string): AiOutcome => ({
    ok: true,
    status: 200,
    elapsedMs: 2,
    body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] },
  });

  /** The working context of a request body's system message. */
  const contextOf = (body: ChatRequest) => {
    const system = String((body.messages[0] as { content: unknown }).content);
    const start = system.indexOf('{', system.indexOf('Working context (the open book right now):'));
    return JSON.parse(system.slice(start, system.indexOf("\n\nThe book's text"))) as {
      selection: Record<string, unknown>;
      request: Record<string, unknown>;
    };
  };

  afterEach(() => {
    fieldTarget.current = null;
  });

  it('from the popup: a general request whose first user message is the instruction alone; a text reply is a message', async () => {
    const book = tablesBook();
    const snapshot = {
      form: 'cells',
      anchor: { nodeId: 'tBr2c1', offset: 0 },
      head: { nodeId: 'tBr3c2', offset: 0 },
      range: null,
      openStart: false,
      openEnd: false,
      nodeIds: ['tBr2c1', 'tBr2c2', 'tBr3c1', 'tBr3c2'],
      parent: null,
      xml: '',
      text: '',
      characters: 4,
      paragraphs: 4,
      blocks: 4,
      hasInlineElements: false,
      from: null,
      to: null,
      pm: null,
      cells: {
        table: { id: 'tB', path: 'body[1]/section[1]/table[2]', type: 'table' },
        row: 2,
        column: 1,
        rows: 2,
        columns: 2,
      },
    } as unknown as SelectionSnapshot;
    const { ctx, bodies } = await loop([text('Four cells of a table.')], book);
    const outcome = await startRequest(ctx, {
      origin: 'popup',
      instruction: 'what is this?',
      selection: snapshot,
    });
    expect(outcome.kind).toBe('answered');
    expect(bodies).toHaveLength(1);
    const user = bodies[0]!.messages.filter((m) => (m as { role: string }).role === 'user');
    expect((user.at(-1) as { content: string }).content).toBe('what is this?');
    const context = contextOf(bodies[0]!);
    expect(context.request).toMatchObject({ kind: 'general', source: 'popup' });
    expect(context.selection).toMatchObject({
      kind: 'cells',
      row: 2,
      column: 1,
      rows: 2,
      columns: 2,
    });
    expect(ctx.store.getState().document).toBe(book);
    stopAssistant(ctx.store);
  });

  it('from the panel with the Description view active: the block of the active field with its source; without one nothing of a field is reported', async () => {
    const book = tablesBook();
    const annotation = book.description.titleInfo.annotation!;
    const state = (() => {
      const base = createRichFieldState(annotation, () => 'ui_f');
      const at = (id: string) => findNodeById(base.doc, id)!.pos;
      return base.apply(
        base.tr.setSelection(CellBlockSelection.create(base.doc, at('tAnnr1c1'), at('tAnnr1c2'))),
      );
    })();
    fieldTarget.current = { kind: 'description', key: 'titleInfo.annotation', state };
    const { ctx, bodies } = await loop([text('A block of the annotation.')], book);
    actions.setActiveView(ctx.store, 'description');
    const outcome = await startRequest(ctx, {
      origin: 'panel',
      instruction: 'merge these cells',
      selection: null,
    });
    expect(outcome.kind).toBe('answered');
    const context = contextOf(bodies[0]!);
    expect(context.request).toMatchObject({ kind: 'general', source: 'panel' });
    expect(context.selection).toMatchObject({
      kind: 'cells',
      table: { id: 'tAnn', path: 'title-info/annotation[1]/table[1]' },
      row: 1,
      column: 1,
      rows: 1,
      columns: 2,
      source: { view: 'description', field: 'annotation' },
    });
    const user = bodies[0]!.messages.filter((m) => (m as { role: string }).role === 'user');
    expect((user.at(-1) as { content: string }).content).toBe('merge these cells');
    fieldTarget.current = null;
    const second = await loop([text('Nothing selected.')], tablesBook());
    actions.setActiveView(second.ctx.store, 'description');
    await startRequest(second.ctx, { origin: 'panel', instruction: 'hello', selection: null });
    expect(contextOf(second.bodies[0]!).selection).toMatchObject({ kind: 'none' });
    stopAssistant(ctx.store);
    stopAssistant(second.ctx.store);
  });
});
