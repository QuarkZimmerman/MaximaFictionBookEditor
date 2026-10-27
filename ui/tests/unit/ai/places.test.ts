/**
 * FR-106 (requester, 2026-10-23, after the rc.1 smoke test: a title translation was reported
 * done while the book window showed no change): every ended request tells the user what
 * happened to the book. The loop runs here against a scripted `ai.complete` (the fake RPC's
 * `runJob`, as activity.test.ts does):
 *
 *  - a committed request's `request.done` entry carries `changes: {total, body, description,
 *    fields}` and its line names the count AND the place - "1 change in the Description view
 *    (book title)" for `set_description` (which the Body view does not display), "1 change in
 *    the body text" for `set_text`, both when mixed; the test hook's `places` says the same;
 *  - a text answer that claims a change ("The book's title has been translated…") with no
 *    change tool ends `answered` with `claimedChange`, is never "Done", and the panel's line and
 *    the mark under the message say that no change was made;
 *  - `summarisePlaces` decides an `unknown` place (a nested script, the Source text path) by the
 *    commit's diff.
 */

import i18next from 'i18next';

import { activityText, changesText, resultMarks } from '@/ai/AiPanel';
import {
  lastRequestInfo,
  startAssistant,
  startRequest,
  stopAssistant,
  summarisePlaces,
  type RequestOutcome,
} from '@/ai/assistant';
import type { CommandContext } from '@/app/commands';
import { initI18n } from '@/i18n';
import { actions, type AppStore } from '@/model/store';
import type { AiOutcome, ChatRequest } from '@/rpc/types';

import { fakeDialogs, fakeRpc, makeContext, type FakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

import { tableNode } from './catalogueHarness';
import { book, validateDocument } from './sessionUtils';

beforeAll(async () => {
  await initI18n({ language: 'en' });
});

const t = () => i18next.getFixedT('en');

interface LoopHarness {
  store: AppStore;
  rpc: FakeRpc;
  ctx: CommandContext;
  bodies: ChatRequest[];
}

async function loopHarness(
  outcomes: AiOutcome[],
  document = book({ preExisting: false }),
): Promise<LoopHarness> {
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
  settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: '', model: 'm1' };
  actions.setSettings(store, settings);
  actions.setConnection(store, 'connected');
  actions.setDocument(store, document);
  startAssistant(store);
  return { store, rpc, ctx, bodies };
}

function toolCallsOutcome(calls: { name: string; args: Record<string, unknown> }[]): AiOutcome {
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
            tool_calls: calls.map((call, i) => ({
              id: `call_${i + 1}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
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

const TITLE_CHANGE = {
  name: 'set_description',
  args: { description: { titleInfo: { bookTitle: 'Alpha, in English' } } },
};
const BODY_CHANGE = { name: 'set_text', args: { node: 'p1', text: 'First paragraph, edited.' } };

describe('FR-106: the end of a request names what happened to the book', () => {
  let harness: LoopHarness | null = null;

  afterEach(() => {
    if (harness) stopAssistant(harness.store);
    harness = null;
  });

  async function run(text: string): Promise<RequestOutcome> {
    return startRequest(harness!.ctx, { origin: 'panel', instruction: text, selection: null });
  }

  it('set_description: committed, the end entry and its line name 1 change in the Description view (book title); the places reach the test hook', async () => {
    harness = await loopHarness([
      toolCallsOutcome([TITLE_CHANGE]),
      textOutcome('The book’s title has been changed to “Alpha, in English”.'),
    ]);
    const { store } = harness;
    const outcome = await run('Переведи название книги на английский');
    expect(outcome.kind).toBe('committed');
    if (outcome.kind !== 'committed') return;
    expect(outcome.changes).toEqual({
      total: 1,
      body: 0,
      description: 1,
      fields: ['titleInfo.bookTitle'],
    });
    expect(store.getState().document!.description.titleInfo.bookTitle).toBe('Alpha, in English');
    expect(store.getState().modified).toBe(true);

    const { conversation } = store.getState().ai;
    const done = conversation.activity.filter((e) => e.kind === 'request.done');
    expect(done).toHaveLength(1);
    expect(done[0]!.payload).toEqual({
      changes: { total: 1, body: 0, description: 1, fields: ['titleInfo.bookTitle'] },
      exchanges: 2,
      elapsedMs: expect.any(Number) as unknown as number,
    });
    const line = activityText(t(), done[0]!);
    expect(
      line.startsWith('Done: 1 change in the Description view (book title) — 2 exchanges, '),
    ).toBe(true);
    expect(line).not.toContain('Alpha'); // the value written is never in the record (C14)
    // The mark under the assistant's final message says the same.
    const marks = resultMarks(t(), conversation.messages, conversation.activity);
    const final = conversation.messages.at(-1)!;
    expect(final.role).toBe('assistant');
    expect(marks.get(final.id)).toEqual({
      kind: 'applied',
      text: 'Applied to the book: 1 change in the Description view (book title)',
    });
    expect(lastRequestInfo()).toMatchObject({
      state: 'committed',
      changes: 1,
      places: { total: 1, body: 0, description: 1, fields: ['titleInfo.bookTitle'] },
    });
    expect(lastRequestInfo()!.claimedChange).toBeUndefined();
  });

  it('set_text in a body: 1 change in the body text; mixed with set_description: both named', async () => {
    harness = await loopHarness([
      toolCallsOutcome([BODY_CHANGE]),
      textOutcome('Edited the first paragraph.'),
    ]);
    const first = await run('Edit the first paragraph');
    expect(first.kind).toBe('committed');
    if (first.kind !== 'committed') return;
    expect(first.changes).toEqual({ total: 1, body: 1, description: 0, fields: [] });
    let done = harness.store
      .getState()
      .ai.conversation.activity.filter((e) => e.kind === 'request.done');
    expect(activityText(t(), done.at(-1)!)).toMatch(
      /^Done: 1 change in the body text — 2 exchanges, /,
    );

    // The same conversation: a request with one change of each kind, in one answer.
    stopAssistant(harness.store);
    harness = await loopHarness([
      toolCallsOutcome([BODY_CHANGE, TITLE_CHANGE]),
      textOutcome('Both done.'),
    ]);
    const mixed = await run('Edit the paragraph and translate the title');
    expect(mixed.kind).toBe('committed');
    if (mixed.kind !== 'committed') return;
    expect(mixed.changes).toEqual({
      total: 2,
      body: 1,
      description: 1,
      fields: ['titleInfo.bookTitle'],
    });
    done = harness.store
      .getState()
      .ai.conversation.activity.filter((e) => e.kind === 'request.done');
    expect(activityText(t(), done.at(-1)!)).toMatch(
      /^Done: 1 change in the body text, 1 change in the Description view \(book title\) — 2 exchanges, /,
    );
  });

  it('a text that claims a change with no change tool ends answered with claimedChange: never Done, the line and the mark say no change was made, the book untouched', async () => {
    harness = await loopHarness([
      textOutcome("The book's title has been translated to English: “Alpha, in English”."),
    ]);
    const { store } = harness;
    const before = store.getState().document;
    const outcome = await run('Translate the title of the book into English');
    expect(outcome).toEqual({
      kind: 'answered',
      text: "The book's title has been translated to English: “Alpha, in English”.",
      claimedChange: true,
    });
    expect(store.getState().document).toBe(before);
    expect(store.getState().modified).toBe(false);
    expect(store.getState().runLock).toBeNull();

    const { conversation } = store.getState().ai;
    const kinds = conversation.activity.map((e) => e.kind);
    expect(kinds).not.toContain('request.done');
    const end = conversation.activity.at(-1)!;
    expect(end.kind).toBe('request.answered');
    expect(end.payload).toEqual({ claimedChange: true });
    expect(activityText(t(), end)).toBe(
      'Answered — the book was not changed (no change was made — the assistant only described one)',
    );
    const marks = resultMarks(t(), conversation.messages, conversation.activity);
    const final = conversation.messages.at(-1)!;
    expect(final.role).toBe('assistant');
    expect(final.appliedLine).toBe('[No change]');
    expect(marks.get(final.id)).toEqual({
      kind: 'claimedChange',
      text: t()('ai.result.claimedChange'),
    });
    expect(lastRequestInfo()).toMatchObject({ state: 'answered', changes: 0, claimedChange: true });
  });

  it('a plain answer and an ask-back carry no claim; a claim ending with a question is askedBack with the claim', async () => {
    harness = await loopHarness([textOutcome('The book has 2 footnotes.')]);
    const answer = await run('How many footnotes?');
    expect(answer).toEqual({ kind: 'answered', text: 'The book has 2 footnotes.' });
    const end = harness.store.getState().ai.conversation.activity.at(-1)!;
    expect(end.payload).toEqual({});
    expect(activityText(t(), end)).toBe('Answered — the book was not changed');
    expect(
      resultMarks(
        t(),
        harness.store.getState().ai.conversation.messages,
        harness.store.getState().ai.conversation.activity,
      ).size,
    ).toBe(0);

    stopAssistant(harness.store);
    harness = await loopHarness([
      textOutcome('The title has been translated. Shall I translate the chapter titles too?'),
    ]);
    const asked = await run('Translate the title');
    expect(asked).toEqual({
      kind: 'askedBack',
      text: 'The title has been translated. Shall I translate the chapter titles too?',
      claimedChange: true,
    });
    const askedEnd = harness.store.getState().ai.conversation.activity.at(-1)!;
    expect(askedEnd.kind).toBe('request.askedBack');
    expect(activityText(t(), askedEnd)).toBe(
      'The assistant asked a question — the book was not changed (no change was made — the assistant only described one)',
    );
  });
});

describe('summarisePlaces / changesText', () => {
  it('counts the known places, lists the fields once, and decides unknown places by the diff', () => {
    const noDiff = { descriptionChanged: false, bodiesChanged: false };
    expect(summarisePlaces([], noDiff)).toEqual({ total: 0, body: 0, description: 0, fields: [] });
    expect(
      summarisePlaces(
        [
          { place: 'body', fields: [] },
          { place: 'description', fields: ['titleInfo.bookTitle', 'titleInfo.genres'] },
          { place: 'description', fields: ['titleInfo.genres'] },
        ],
        noDiff,
      ),
    ).toEqual({
      total: 3,
      body: 1,
      description: 2,
      fields: ['titleInfo.bookTitle', 'titleInfo.genres'],
    });
    // A nested script run / the Source text path: the description alone changed → description.
    expect(
      summarisePlaces([{ place: 'unknown', fields: [] }], {
        descriptionChanged: true,
        bodiesChanged: false,
      }),
    ).toEqual({ total: 1, body: 0, description: 1, fields: [] });
    for (const diff of [
      { descriptionChanged: false, bodiesChanged: true },
      { descriptionChanged: true, bodiesChanged: true },
      noDiff,
    ]) {
      expect(summarisePlaces([{ place: 'unknown', fields: [] }], diff)).toEqual({
        total: 1,
        body: 1,
        description: 0,
        fields: [],
      });
    }
  });

  it('renders the places in words, the fields by their names, an older numeric payload as a count', () => {
    expect(changesText(t(), { total: 3, body: 3, description: 0, fields: [] })).toBe(
      '3 changes in the body text',
    );
    expect(
      changesText(t(), {
        total: 2,
        body: 0,
        description: 2,
        fields: ['titleInfo.authors', 'documentInfo.history', 'publishInfo.odd'],
      }),
    ).toBe('2 changes in the Description view (authors, history, publishInfo.odd)');
    expect(changesText(t(), { total: 1, body: 0, description: 1, fields: [] })).toBe(
      '1 change in the Description view',
    );
    expect(changesText(t(), 3)).toBe('3 changes');
    expect(changesText(t(), { total: 2 })).toBe('2 changes');
    expect(changesText(t(), undefined)).toBe('');
    // The old payload keeps the old line; the new one names the place.
    const entry = (changes: unknown) => ({
      at: 0,
      requestId: 'r1',
      elapsedMs: 1,
      kind: 'request.done',
      payload: { changes, exchanges: 2, elapsedMs: 1000 },
    });
    expect(activityText(t(), entry(1))).toBe('Done: 1 change in 2 exchanges, 00:01');
    expect(
      activityText(t(), entry({ total: 1, body: 0, description: 1, fields: ['titleInfo.lang'] })),
    ).toBe('Done: 1 change in the Description view (language) — 2 exchanges, 00:01');
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006 (US11, T174): edit_table counts by the root of its table      */
/* ------------------------------------------------------------------------ */

describe('feature 006: edit_table counts by the root of its table (Δ§6.14)', () => {
  let harness: LoopHarness | null = null;

  afterEach(() => {
    if (harness) stopAssistant(harness.store);
    harness = null;
  });

  it('a table of a body counts for the body text, the annotation table for the Description view; the strike target is split at @', async () => {
    const document = book({ preExisting: false });
    const sections = (
      document.bodies[0] as unknown as {
        content: { attrs?: { nodeId?: string }; content: unknown[] }[];
      }
    ).content;
    sections
      .find((s) => s.attrs?.nodeId === 's1')!
      .content.push(
        tableNode('tR', [
          ['a', 'b'],
          ['c', 'd'],
        ]),
      );
    const withAnnotation = {
      ...document,
      description: {
        ...document.description,
        titleInfo: {
          ...document.description.titleInfo,
          annotation: {
            type: 'annotation',
            attrs: { nodeId: 'ann' },
            content: [
              tableNode('tAnn', [
                ['r1c1', 'r1c2'],
                ['r2c1', 'r2c2'],
              ]),
            ],
          },
        },
      },
    } as unknown as typeof document;
    harness = await loopHarness(
      [
        toolCallsOutcome([
          { name: 'edit_table', args: { table: 'tR', op: 'insertRows', row: 1, where: 'after' } },
          {
            name: 'edit_table',
            args: {
              table: 'title-info/annotation[1]/table[1]',
              op: 'insertRows',
              row: 2,
              where: 'after',
            },
          },
        ]),
        textOutcome('Two rows added.'),
      ],
      withAnnotation,
    );
    const outcome = await startRequest(harness.ctx, {
      origin: 'panel',
      instruction: 'add the rows',
      selection: null,
    });
    expect(outcome.kind).toBe('committed');
    if (outcome.kind !== 'committed') return;
    expect(outcome.changes).toEqual({ total: 2, body: 1, description: 1, fields: [] });
    const tries = harness.store
      .getState()
      .ai.conversation.activity.filter((entry) => entry.kind === 'change.try')
      .map((entry) => entry.payload);
    expect(tries).toEqual([
      { tool: 'edit_table', target: 'insertRows@tR' },
      { tool: 'edit_table', target: 'insertRows@tAnn' },
    ]);
  });
});
