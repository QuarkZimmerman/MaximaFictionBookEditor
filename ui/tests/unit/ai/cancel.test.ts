/**
 * Cancelling a request while its exchange is on its way (feature 005; ai-catalogue §6.15;
 * FR-034, SC-005): Escape (or Stop) between `ai.complete` going out and its `{jobId}` coming
 * back cancels the job the moment the id arrives, so the core's exchange does not run to its
 * end and its record says `cancelled` - the race behind a failure of `us2-ai-popup` scenario 6
 * under load ("ok" instead of "cancelled"). The same holds for the commit's `doc.validate`, a
 * job above 2 MiB: a cancel before its id arrived would let the job end with its report and
 * the copy be committed. Below 2 MiB `doc.validate` is a plain request no `job.cancel` stops:
 * its report arrives all the same, and a request cancelled meanwhile neither commits nor goes
 * on - nor do the steps before the session (the baseline, the Source text check), whose jobs
 * are cancelled like the others. The loop runs against a fake RPC whose `runJob` holds the
 * job's start until the test releases it.
 */

import { cancelRequest, startAssistant, startRequest, stopAssistant } from '@/ai/assistant';
import type { CommandContext } from '@/app/commands';
import { initI18n } from '@/i18n';
import type { Document, ValidationReport } from '@/model/document';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type AiOutcome } from '@/rpc/types';
import { setBodySelection } from '@/scripting/api-impl';
import { getBodyController } from '@/views/body/bodyEditor';
import { sourceEditorFor } from '@/views/source/sourceEditor';

import { fakeDialogs, fakeRpc, makeContext, type FakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

import { book, validateDocument } from './sessionUtils';

beforeAll(async () => {
  await initI18n({ language: 'en' });
});

type RunJob = (
  method: string,
  params: unknown,
  options?: { onStart?: (jobId: string) => void },
) => Promise<unknown>;

/** The held exchange: `start` delivers the job's id, `finish` ends the job. */
interface HeldJob {
  start(jobId: string): void;
  finish(error: RpcError): void;
}

type ValidateParams = { document: Parameters<typeof validateDocument>[0] };

/** The fake RPC with the given extra responders; `doc.validate` answers at once. */
function rpcWith(extra: Record<string, unknown> = {}): FakeRpc {
  return fakeRpc({
    'doc.validate': (params: unknown) => validateDocument((params as ValidateParams).document),
    'log.error': {},
    'job.cancel': {},
    'schema.text': { text: '' },
    ...extra,
  });
}

/** The command context with the assistant on, the custom target and the fixture book. */
async function assistantContext(rpc: FakeRpc): Promise<CommandContext> {
  const ctx = await makeContext({ rpc: rpc.client, dialogs: fakeDialogs() });
  const settings = defaultSettings();
  settings.ai.mode = 'custom';
  settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: '', model: 'm1' };
  actions.setSettings(ctx.store, settings);
  actions.setConnection(ctx.store, 'connected');
  actions.setDocument(ctx.store, book({ preExisting: false }));
  startAssistant(ctx.store);
  return ctx;
}

async function harness(): Promise<{ ctx: CommandContext; rpc: FakeRpc; held: () => HeldJob[] }> {
  const rpc = rpcWith();
  const jobs: HeldJob[] = [];
  const fake = rpc.client as unknown as { runJob: RunJob };
  const original = fake.runJob;
  fake.runJob = (method, params, options) => {
    if (method !== 'ai.complete') return original(method, params, options);
    rpc.calls.push({ method, params });
    return new Promise((_resolve, reject) => {
      jobs.push({ start: (jobId) => options?.onStart?.(jobId), finish: reject });
    });
  };
  return { ctx: await assistantContext(rpc), rpc, held: () => jobs };
}

const cancels = (rpc: FakeRpc) => rpc.calls.filter((call) => call.method === 'job.cancel');

/**
 * The held validation: `start` delivers the job's id (a book above 2 MiB; never called, the
 * validation is the plain request of a smaller book), `settle` ends it as the core does.
 */
interface HeldValidation {
  start(jobId: string): void;
  /** `job.failed` 1090 when a `job.cancel` reached the job, else the report. */
  settle(): void;
}

function answer(finishReason: string, message: Record<string, unknown>): AiOutcome {
  const choice = { finish_reason: finishReason, message: { role: 'assistant', ...message } };
  return { ok: true, status: 200, elapsedMs: 1, body: { choices: [choice] } };
}

/** The Source text of the Source-view requests, and the report of its check: well-formed, clean. */
const SOURCE_TEXT = '<FictionBook><body/></FictionBook>';
const TEXT_REPORT: ValidationReport = { issues: [], errorCount: 0, warningCount: 0, durationMs: 1 };

/**
 * Holds the `n`-th `doc.validate` of the fake RPC (1 = the first - the baseline, or the Source
 * text check when the request has one, answered with `textReport`); the others answer at once.
 */
function holdValidation(rpc: FakeRpc, n: number, textReport = TEXT_REPORT): HeldValidation[] {
  const held: HeldValidation[] = [];
  let validations = 0;
  const fake = rpc.client as unknown as { runJob: RunJob };
  const original = fake.runJob;
  fake.runJob = (method, params, options) => {
    if (method !== 'doc.validate' || ++validations !== n) return original(method, params, options);
    rpc.calls.push({ method, params });
    let jobId = '';
    return new Promise((resolve, reject) => {
      held.push({
        start: (id) => {
          jobId = id;
          options?.onStart?.(id);
        },
        settle: () => {
          const hit = cancels(rpc).some(
            (call) => (call.params as { jobId: string }).jobId === jobId,
          );
          if (hit) reject(new RpcError(RpcErrorCode.cancelled, 'cancelled', { jobId }));
          else {
            const { document } = params as Partial<ValidateParams>;
            resolve(document ? validateDocument(document) : textReport);
          }
        },
      });
    });
  };
  return held;
}

/** A request whose model changes `p1` with `set_text`, then answers a text. */
function setTextAnswers(): AiOutcome[] {
  const edit = { node: 'p1', text: 'First paragraph, edited.' };
  return [
    answer('tool_calls', {
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'set_text', arguments: JSON.stringify(edit) },
        },
      ],
    }),
    answer('stop', { content: 'Done.' }),
  ];
}

/**
 * A request with a change to commit: `ai.complete` answers at once - `set_text` on `p1`, then a
 * text -, and so do the validations but the `hold`-th: by default the commit's (the baseline
 * and the change's validation come first).
 */
async function commitHarness(hold = 3): Promise<{
  ctx: CommandContext;
  rpc: FakeRpc;
  held: HeldValidation[];
}> {
  const answers = setTextAnswers();
  const rpc = rpcWith({ 'ai.complete': () => answers.shift() });
  const held = holdValidation(rpc, hold);
  return { ctx: await assistantContext(rpc), rpc, held };
}

/** The store's document and `modified` flag before a request. */
function stateBefore(ctx: CommandContext): { document: Document | null; modified: boolean } {
  const { document, modified } = ctx.store.getState();
  return { document, modified };
}

/** The document the request started on, untouched: the store's, `modified` and the undo history. */
function expectUntouched(ctx: CommandContext, before: ReturnType<typeof stateBefore>): void {
  expect(ctx.store.getState().document).toBe(before.document);
  expect(ctx.store.getState().modified).toBe(before.modified);
  expect(ctx.undo.canUndo).toBe(false);
  expect(ctx.store.getState().runLock).toBeNull();
}

describe('a cancel while the exchange is on its way (ai-catalogue §6.15)', () => {
  let store: CommandContext['store'] | null = null;
  let jobs: (() => HeldJob[]) | null = null;
  let running: Promise<unknown> | null = null;

  afterEach(async () => {
    // A request a failed expectation left waiting ends here, so the next one is not `busy`.
    for (const job of jobs?.() ?? []) job.finish(new RpcError(RpcErrorCode.cancelled, 'end'));
    await running;
    if (store) stopAssistant(store);
    store = null;
    jobs = null;
    running = null;
  });

  async function start(): Promise<{
    ctx: CommandContext;
    rpc: FakeRpc;
    held: () => HeldJob[];
    outcome: ReturnType<typeof startRequest>;
  }> {
    const { ctx, rpc, held } = await harness();
    store = ctx.store;
    jobs = held;
    const outcome = startRequest(ctx, {
      origin: 'popup',
      instruction: 'Fix the typos',
      selection: null,
    });
    running = outcome;
    await vi.waitFor(() => expect(held()).toHaveLength(1));
    return { ctx, rpc, held, outcome };
  }

  it('before the job id arrives: the job is cancelled as soon as the id comes back', async () => {
    const { ctx, rpc, held, outcome } = await start();
    // Escape while `ai.complete` is on its way: there is no job id to cancel yet.
    cancelRequest(ctx.store);
    expect(cancels(rpc)).toEqual([]);
    // The id arrives: the job is cancelled at once, not left to run to its end.
    held()[0]!.start('job-42');
    expect(cancels(rpc)).toEqual([{ method: 'job.cancel', params: { jobId: 'job-42' } }]);
    held()[0]!.finish(new RpcError(RpcErrorCode.cancelled, 'cancelled', { jobId: 'job-42' }));
    expect((await outcome).kind).toBe('cancelled');
    expect(cancels(rpc)).toHaveLength(1);
  });

  it('after the job id arrived: the job is cancelled once, at the cancel', async () => {
    const { ctx, rpc, held, outcome } = await start();
    held()[0]!.start('job-43');
    expect(cancels(rpc)).toEqual([]);
    cancelRequest(ctx.store);
    expect(cancels(rpc)).toEqual([{ method: 'job.cancel', params: { jobId: 'job-43' } }]);
    held()[0]!.finish(new RpcError(RpcErrorCode.cancelled, 'cancelled', { jobId: 'job-43' }));
    expect((await outcome).kind).toBe('cancelled');
    expect(cancels(rpc)).toHaveLength(1);
  });
});

describe('a cancel while the validation of the commit is on its way (ai-catalogue §6.14, §6.15)', () => {
  let store: CommandContext['store'] | null = null;
  let held: HeldValidation[] = [];
  let running: Promise<unknown> | null = null;

  afterEach(async () => {
    // A request a failed expectation left waiting ends here, so the next one is not `busy`.
    for (const job of held) job.settle();
    await running;
    if (store) stopAssistant(store);
    store = null;
    held = [];
    running = null;
  });

  it('before the job id arrives: the job is cancelled as soon as the id comes back, nothing is committed', async () => {
    const harnessed = await commitHarness();
    const { ctx, rpc } = harnessed;
    store = ctx.store;
    held = harnessed.held;
    const before = ctx.store.getState().document;
    const outcome = startRequest(ctx, {
      origin: 'panel',
      instruction: 'Edit the first paragraph',
      selection: null,
    });
    running = outcome;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    // Escape while the commit's `doc.validate` is on its way: there is no job id to cancel yet.
    cancelRequest(ctx.store);
    expect(cancels(rpc)).toEqual([]);
    // The id arrives: the job is cancelled at once - left alone, it would end with its report
    // and the copy would be committed although the user cancelled.
    held[0]!.start('job-44');
    expect(cancels(rpc)).toEqual([{ method: 'job.cancel', params: { jobId: 'job-44' } }]);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expect(ctx.store.getState().document).toBe(before);
    expect(ctx.undo.canUndo).toBe(false);
  });

  it('as a plain request (2 MiB and less): its report arrives all the same, nothing is committed (SC-005)', async () => {
    const harnessed = await commitHarness();
    const { ctx, rpc } = harnessed;
    store = ctx.store;
    held = harnessed.held;
    const before = stateBefore(ctx);
    const outcome = startRequest(ctx, {
      origin: 'panel',
      instruction: 'Edit the first paragraph',
      selection: null,
    });
    running = outcome;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    // Escape while the commit's `doc.validate` runs: no job, nothing a `job.cancel` could stop.
    cancelRequest(ctx.store);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    expect(cancels(rpc)).toEqual([]);
    expect(lastActivity(ctx)).toBe('request.cancelled');
  });

  it('the popup fast path: a cancel while the replacement is validated commits nothing', async () => {
    // A popup request on "First" of `p1`: the model answers the replacement as text (§5.1).
    const rpc = rpcWith({
      'ai.complete': () => answer('stop', { content: 'Primary' }),
      'doc.fragmentToXml': { xml: 'First' },
    });
    held = holdValidation(rpc, 2); // the baseline answers; the replacement's validation waits
    const ctx = await assistantContext(rpc);
    store = ctx.store;
    const controller = getBodyController(ctx.store, ctx.undo);
    controller.setModel(ctx.store.getState().document, ctx.store.getState().docId);
    setBodySelection(controller, { nodeId: 'p1', offset: 0 }, { nodeId: 'p1', offset: 5 });
    const before = stateBefore(ctx);
    const outcome = startRequest(ctx, { origin: 'popup', instruction: 'Fix the word' });
    running = outcome;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    // Escape while the replacement's `doc.validate` runs (a plain request): the replacement is
    // accepted on the copy, which is never committed.
    cancelRequest(ctx.store);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    expect(controller.editorState!.doc.textContent).toContain('First paragraph.');
    expect(rpc.calls.filter((call) => call.method === 'doc.validate')).toHaveLength(2);
  });

  it('in the Source view (structured changes): a cancel while the copy is validated - a plain request - re-renders and commits nothing', async () => {
    const answers = setTextAnswers();
    const rpc = rpcWith({
      'ai.complete': () => answers.shift(),
      'doc.toXml': { text: SOURCE_TEXT, serial: 3 },
      'doc.mapPositions': { toSource: [0], toModel: [], durationMs: 1 },
    });
    held = holdValidation(rpc, 3); // the commit's validation, after the baseline and the change's
    const ctx = await assistantContext(rpc);
    store = ctx.store;
    const editor = sourceEditorFor(ctx.store, ctx.undo);
    actions.setActiveView(ctx.store, 'source');
    const before = stateBefore(ctx);
    const outcome = startRequest(ctx, {
      origin: 'panel',
      instruction: 'Edit the first paragraph',
      selection: null,
    });
    running = outcome;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    cancelRequest(ctx.store);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    expect(rpc.calls.some((call) => call.method === 'doc.toXml')).toBe(false);
    expect(editor.text).toBe('');
  });

  it('in the Source view (the text path): a cancel while the accepted text is parsed for the commit publishes nothing and leaves the Body history alone', async () => {
    // A popup request on `<body/>` with a model without tools: the reply replaces the selected
    // text, the spliced text is validated whole and accepted, the commit parses it.
    let parsed: ((answer: unknown) => void) | null = null;
    const rpc = rpcWith({
      'ai.complete': () => answer('stop', { content: '<body><section><p>x</p></section></body>' }),
      'doc.validate': (params: unknown) => {
        const { document } = params as Partial<ValidateParams>;
        return document ? validateDocument(document) : TEXT_REPORT;
      },
      'doc.fromXml': () => new Promise((resolve) => (parsed = resolve)),
    });
    const ctx = await assistantContext(rpc);
    store = ctx.store;
    const settings = ctx.store.getState().settings!;
    actions.updateAi(ctx.store, {
      customModels: { address: settings.ai.custom.address, models: [{ id: 'm1', tools: false }] },
    });
    const editor = sourceEditorFor(ctx.store, ctx.undo);
    editor.replaceWholeText(SOURCE_TEXT);
    actions.setActiveView(ctx.store, 'source');
    const clearView = vi.spyOn(ctx.undo, 'clearView');
    const before = stateBefore(ctx);
    const range = { from: SOURCE_TEXT.indexOf('<body/>'), to: SOURCE_TEXT.indexOf('</Fiction') };
    const outcome = startRequest(ctx, {
      origin: 'popup',
      instruction: 'Add a section',
      selection: { range } as Parameters<typeof startRequest>[1]['selection'],
    });
    running = outcome;
    await vi.waitFor(() => expect(parsed).not.toBeNull());
    cancelRequest(ctx.store);
    parsed!({ document: ctx.store.getState().document, serial: 9, remap: { map: {} } });
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    expect(clearView).not.toHaveBeenCalled();
    expect(editor.text).toBe(SOURCE_TEXT);
  });
});

/** The kind of the request's last activity entry. */
function lastActivity(ctx: CommandContext): string | undefined {
  return ctx.store.getState().ai.conversation.activity.at(-1)?.kind;
}

describe('a cancel while the request starts (ai-catalogue §6 steps 3 and 4, §6.15)', () => {
  let store: CommandContext['store'] | null = null;
  let held: HeldValidation[] = [];
  let running: Promise<unknown> | null = null;

  afterEach(async () => {
    // A request a failed expectation left waiting ends here, so the next one is not `busy`.
    for (const job of held) job.settle();
    await running;
    if (store) stopAssistant(store);
    store = null;
    held = [];
    running = null;
  });

  it('the baseline before its job id arrives: the job is cancelled as soon as the id comes back, nothing is sent', async () => {
    const harnessed = await commitHarness(1);
    const { ctx, rpc } = harnessed;
    store = ctx.store;
    held = harnessed.held;
    const before = stateBefore(ctx);
    const outcome = startRequest(ctx, {
      origin: 'panel',
      instruction: 'Edit the first paragraph',
      selection: null,
    });
    running = outcome;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(ctx.store.getState().runLock).toMatchObject({ kind: 'ai' });
    // Stop while the baseline's `doc.validate` (a job above 2 MiB) is on its way.
    cancelRequest(ctx.store);
    expect(cancels(rpc)).toEqual([]);
    // The id arrives: the job is cancelled at once, not left to validate the whole book.
    held[0]!.start('job-45');
    expect(cancels(rpc)).toEqual([{ method: 'job.cancel', params: { jobId: 'job-45' } }]);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    expect(rpc.calls.some((call) => call.method === 'ai.complete')).toBe(false);
    expect(cancels(rpc)).toHaveLength(1);
  });

  /**
   * A panel request in the Source view with a model without tools: the text path, whose first
   * step validates the text as it stands (§8.4) - before the lock is taken; held here.
   */
  async function sourceTextRequest(textReport?: ValidationReport) {
    const rpc = rpcWith();
    held = holdValidation(rpc, 1, textReport);
    const ctx = await assistantContext(rpc);
    store = ctx.store;
    const settings = ctx.store.getState().settings!;
    actions.updateAi(ctx.store, {
      customModels: { address: settings.ai.custom.address, models: [{ id: 'm1', tools: false }] },
    });
    sourceEditorFor(ctx.store, ctx.undo).replaceWholeText(SOURCE_TEXT);
    actions.setActiveView(ctx.store, 'source');
    const before = stateBefore(ctx);
    const outcome = startRequest(ctx, { origin: 'panel', instruction: 'Fix it', selection: null });
    running = outcome;
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(rpc.calls.find((call) => call.method === 'doc.validate')?.params).toMatchObject({
      text: SOURCE_TEXT,
    });
    return { ctx, rpc, before, outcome };
  }

  it('the Source text check before its job id arrives: the job is cancelled as soon as the id comes back, the request ends there, nothing is sent', async () => {
    const { ctx, rpc, before, outcome } = await sourceTextRequest();
    cancelRequest(ctx.store);
    expect(cancels(rpc)).toEqual([]);
    held[0]!.start('job-46');
    expect(cancels(rpc)).toEqual([{ method: 'job.cancel', params: { jobId: 'job-46' } }]);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    // Neither the baseline nor an exchange followed.
    expect(rpc.calls.filter((call) => call.method === 'doc.validate')).toHaveLength(1);
    expect(rpc.calls.some((call) => call.method === 'ai.complete')).toBe(false);
  });

  it('the Source text check as a plain request: the request ends when its report arrives, before it is acted on', async () => {
    // The text does not parse: acted on, the report would end the request `failed
    // (sourceNotWellFormed)` with the parse error in the status bar.
    const broken: ValidationReport = {
      issues: [
        {
          severity: 'error',
          code: 'xml.notWellFormed',
          params: { message: 'Premature end of data' },
          line: 1,
          column: 9,
        },
      ],
      errorCount: 1,
      warningCount: 0,
      durationMs: 1,
    };
    const { ctx, rpc, before, outcome } = await sourceTextRequest(broken);
    const status = ctx.store.getState().statusMessage;
    cancelRequest(ctx.store);
    held[0]!.settle();
    expect((await outcome).kind).toBe('cancelled');
    expectUntouched(ctx, before);
    expect(ctx.store.getState().statusMessage).toBe(status);
    expect(cancels(rpc)).toEqual([]);
    expect(rpc.calls.some((call) => call.method === 'ai.complete')).toBe(false);
  });
});
