/**
 * Cancelling a request while its exchange is on its way (feature 005; ai-catalogue §6.15;
 * FR-034, SC-005): Escape (or Stop) between `ai.complete` going out and its `{jobId}` coming
 * back cancels the job the moment the id arrives, so the core's exchange does not run to its
 * end and its record says `cancelled` - the race behind a failure of `us2-ai-popup` scenario 6
 * under load ("ok" instead of "cancelled"). The loop runs against a fake RPC whose `runJob`
 * holds the job's start until the test releases it.
 */

import { cancelRequest, startAssistant, startRequest, stopAssistant } from '@/ai/assistant';
import type { CommandContext } from '@/app/commands';
import { initI18n } from '@/i18n';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

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

async function harness(): Promise<{ ctx: CommandContext; rpc: FakeRpc; held: () => HeldJob[] }> {
  const rpc = fakeRpc({
    'doc.validate': (params: unknown) =>
      validateDocument((params as { document: Parameters<typeof validateDocument>[0] }).document),
    'log.error': {},
    'job.cancel': {},
    'schema.text': { text: '' },
  });
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
  const ctx = await makeContext({ rpc: rpc.client, dialogs: fakeDialogs() });
  const settings = defaultSettings();
  settings.ai.mode = 'custom';
  settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: '', model: 'm1' };
  actions.setSettings(ctx.store, settings);
  actions.setConnection(ctx.store, 'connected');
  actions.setDocument(ctx.store, book({ preExisting: false }));
  startAssistant(ctx.store);
  return { ctx, rpc, held: () => jobs };
}

const cancels = (rpc: FakeRpc) => rpc.calls.filter((call) => call.method === 'job.cancel');

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
