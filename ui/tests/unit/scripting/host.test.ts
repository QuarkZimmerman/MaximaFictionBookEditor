/**
 * T099 / feature 002 T057-T058 - the run lifecycle of the script host with a fake worker: the
 * private port handshake, the run's working copy replacing the document at the end as one undo
 * entry (undo and redo exact, however many changes), the document locked during the run,
 * Cancel and failures restoring the document and closing the script's dialogs, errors
 * reported as "Script error: <message> at line L, column C" (dialog + log.error), the
 * Last-script memory (`scripts.lastRun`), the silent-run notice after the watchdog delay and
 * the busy guard. Feature 003 (T027): the run's duration set at the end and announced as
 * "finished in N s" (with a transient notice after a run longer than 5 s), the `waiting` flag
 * following the script's dialogs, the elapsed-time ticks while running and their end.
 */

import { createInstance } from 'i18next';

import { createAppServices, type AppServices } from '@/app/services';
import { transientNotices } from '@/app/transientNotices';
import { initI18n } from '@/i18n';
import { actions, createAppStore, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import {
  ScriptHost,
  durationSeconds,
  formatElapsed,
  formatRunProgress,
  formatScriptError,
  type RunResult,
  type WorkerLike,
} from '@/scripting/host';
import { activeRunSession, cancelActiveRun, startRunSession } from '@/scripting/runSession';
import type { HostMessage, InitMessage, ScriptInfo, WorkerMessage } from '@/scripting/types';
import { WorkingCopy } from '@/scripting/workingCopy';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDialogs, fakeDocument, fakeRpc, type FakeDialogs } from '../features/testUtils';

/** Stands in for the sandbox worker: exposes the transferred port to the test. */
class FakeWorker implements WorkerLike {
  port: MessagePort | null = null;
  terminated = 0;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: HostMessage[] = [];
  postMessage(message: unknown, transfer?: Transferable[]) {
    const init = message as InitMessage;
    if (init.type === 'init') {
      this.port = (transfer?.[0] as MessagePort | undefined) ?? init.port;
      this.port.onmessage = (event: MessageEvent<HostMessage>) => {
        this.received.push(event.data);
      };
    }
  }
  terminate() {
    this.terminated += 1;
  }
  /** Worker -> host. */
  send(message: WorkerMessage) {
    this.port!.postMessage(message);
  }
  async waitFor(type: HostMessage['type']): Promise<HostMessage> {
    // Time-based, not tick-based: a timer tick is 1-15 ms depending on the platform/load.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = this.received.find((m) => m.type === type);
      if (found) return found;
      await tick();
    }
    throw new Error(`no ${type} message received`);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitUntil(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

const SCRIPT: ScriptInfo = {
  manifestVersion: 1,
  id: 'test.append',
  name: { en: 'Append paragraph', ru: 'Добавить абзац' },
  kind: 'menu',
  entry: 'index.js',
  needsSelection: false,
  undoLabel: { en: 'Append' },
  group: '04_Model',
  dir: '/tmp/scripts/04_Model/01_Append',
  folder: '01_Append',
  source: 'bundled',
  entryUrl: '/scripts/test.append/index.js',
  warnings: [],
};

interface Harness {
  services: AppServices;
  store: AppStore;
  dialogs: FakeDialogs;
  worker: FakeWorker;
  host: ScriptHost;
  rpc: RpcClient;
  calls: { method: string; params: unknown }[];
  t: Awaited<ReturnType<typeof initI18n>>['t'];
  run(options?: { treeNode?: { nodeId: string; type: string } }): Promise<RunResult>;
}

async function harness(
  options: { watchdogMs?: number; tickMs?: number; customAnswers?: unknown[] } = {},
) {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'scripts.source': { entryUrl: '/scripts/test.append/index.js', entry: 'index.js', files: [] },
    'scripts.lastRun': (params: unknown) => ({
      scriptId: (params as { scriptId: string }).scriptId,
    }),
    'log.error': {},
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const dialogs = fakeDialogs([], options.customAnswers ?? []);
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  const worker = new FakeWorker();
  const host = new ScriptHost({
    store,
    undo: services.undo,
    createWorker: () => worker,
    getController: () => getBodyController(store),
    origin: () => 'http://127.0.0.1:4100',
    watchdogMs: options.watchdogMs,
    tickMs: options.tickMs,
  });
  const h: Harness = {
    services,
    store,
    dialogs,
    worker,
    host,
    rpc: rpc.client,
    calls: rpc.calls,
    t: i18n.t,
    run: (runOptions = {}) =>
      host.run(SCRIPT, {
        rpc: rpc.client,
        dialogs,
        t: i18n.t,
        uiLanguage: 'en',
        treeNode: runOptions.treeNode,
      }),
  };
  return h;
}

/** Starts a run and waits until the worker received the run context. */
async function started(h: Harness): Promise<{ done: Promise<RunResult> }> {
  const done = h.run();
  await tick();
  h.worker.send({ type: 'ready' });
  await h.worker.waitFor('run');
  return { done };
}

function paragraphTexts(store: AppStore): string[] {
  const section = store.getState().document!.bodies[0]!.content[0] as {
    content: { type: string; content?: { text?: string }[] }[];
  };
  return section.content.filter((c) => c.type === 'p').map((c) => c.content?.[0]?.text ?? '');
}

const APPEND_CALL: WorkerMessage = {
  type: 'call',
  id: 1,
  method: 'doc.insertNode',
  args: ['append', 'n2', { type: 'p', attrs: {}, content: [{ type: 'text', text: 'Added' }] }],
};

describe('ScriptHost', () => {
  it('hands the private port to the worker, sends the run context and resolves on done', async () => {
    const h = await harness();
    const done = h.run({ treeNode: { nodeId: 'n2', type: 'section' } });
    await tick();
    expect(h.worker.port).not.toBeNull();
    expect(h.host.isRunning).toBe(true);
    expect(h.store.getState().statusMessage).toBe('Running script "Append paragraph"...');
    h.worker.send({ type: 'ready' });
    const run = await h.worker.waitFor('run');
    expect(run).toEqual({
      type: 'run',
      entryUrl: 'http://127.0.0.1:4100/scripts/test.append/index.js',
      context: {
        script: { id: 'test.append', name: 'Append paragraph', group: '04_Model', kind: 'menu' },
        uiLanguage: 'en',
        treeNode: { nodeId: 'n2', type: 'section' },
      },
    });
    h.worker.send(APPEND_CALL);
    const result = await h.worker.waitFor('result');
    expect(result).toMatchObject({ type: 'result', id: 1 });
    expect((result as { value: { type: string } }).value.type).toBe('p');
    // The write went to the run's working copy; the document changes at the end.
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    // Errors of the API travel back as `error` messages, the run goes on.
    h.worker.send({ type: 'call', id: 2, method: 'doc.getNode', args: ['nope'] });
    const failed = await h.worker.waitFor('error');
    expect(failed).toMatchObject({ type: 'error', id: 2 });
    expect((failed as { message: string }).message).toContain('unknown nodeId');
    h.worker.send({ type: 'call', id: 3, method: 'doc.get', args: [] });
    await tick();
    await tick();
    const json = h.worker.received.find((m) => m.type === 'result' && m.id === 3) as {
      json?: boolean;
      value: string;
    };
    expect(json.json).toBe(true);
    expect(JSON.parse(json.value).docId).toBe('doc-1');

    h.worker.send({ type: 'done' });
    await expect(done).resolves.toEqual({ status: 'done', error: undefined, message: undefined });
    expect(h.worker.terminated).toBe(1);
    expect(h.host.isRunning).toBe(false);
    expect(h.host.current?.status).toBe('done');
    expect(h.host.lastRunId).toBe('test.append');
    expect(h.calls.find((c) => c.method === 'scripts.lastRun')?.params).toEqual({
      scriptId: 'test.append',
    });
    // The status says how long the run took: rounded to whole seconds, at least one.
    expect(h.store.getState().statusMessage).toBe('Script "Append paragraph" finished in 1 s');
    expect(paragraphTexts(h.store)).toEqual(['Hello', 'Added']);
    // The whole run is one undo entry; Redo applies it again.
    expect(h.services.undo.undoDepth).toBe(1);
    expect(h.services.undo.peekUndo()?.label).toBe('Append');
    h.services.undo.undo();
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    h.services.undo.redo();
    expect(paragraphTexts(h.store)).toEqual(['Hello', 'Added']);
  });

  it('locks the document for the length of the run', async () => {
    const h = await harness();
    const controller = getBodyController(h.store);
    expect(controller.isEditable).toBe(true);
    const { done } = await started(h);
    expect(h.store.getState().runLock).toEqual({
      kind: 'script',
      label: 'Append paragraph',
      startedAt: h.host.current!.startedAt,
    });
    expect(controller.isEditable).toBe(false);
    // An edit of the user (here a transaction as a command would build it) is refused.
    const state = controller.editorState!;
    controller.apply(state.tr.insertText('typed', 3));
    expect(controller.editorState!.doc.textContent).not.toContain('typed');
    h.worker.send({ type: 'done' });
    await done;
    expect(h.store.getState().runLock).toBeNull();
    expect(controller.isEditable).toBe(true);
  });

  it('one undo entry restores a run of 1,500 changes exactly; redo applies it again', async () => {
    const h = await harness();
    const before = JSON.stringify(h.store.getState().document);
    const { done } = await started(h);
    const count = 1_500;
    for (let i = 1; i <= count; i += 1) {
      h.worker.send({
        type: 'call',
        id: i,
        method: 'doc.insertNode',
        args: [
          'append',
          'n2',
          { type: 'p', attrs: {}, content: [{ type: 'text', text: `P${i}` }] },
        ],
      });
    }
    await waitUntil(
      () => h.worker.received.some((m) => m.type === 'result' && m.id === count),
      'the last result',
    );
    h.worker.send({ type: 'done' });
    await done;
    const after = JSON.stringify(h.store.getState().document);
    expect(paragraphTexts(h.store)).toHaveLength(count + 1);
    expect(h.services.undo.undoDepth).toBe(1);
    h.services.undo.undo();
    expect(JSON.stringify(h.store.getState().document)).toBe(before);
    h.services.undo.redo();
    expect(JSON.stringify(h.store.getState().document)).toBe(after);
  });

  it('cancel terminates the worker, closes its dialogs and restores the document', async () => {
    const h = await harness({ customAnswers: ['ok', new Promise(() => {})] });
    const { done } = await started(h);
    h.worker.send(APPEND_CALL);
    await h.worker.waitFor('result');
    h.worker.send({ type: 'call', id: 2, method: 'doc.setText', args: ['n3', 'Changed'] });
    // A message box shows the changes made so far...
    h.worker.send({ type: 'call', id: 3, method: 'ui.message', args: ['So far'] });
    await waitUntil(
      () => h.worker.received.some((m) => m.type === 'result' && m.id === 3),
      'the message answer',
    );
    expect(paragraphTexts(h.store)).toEqual(['Changed', 'Added']);
    expect(h.store.getState().modified).toBe(true);
    // ...and a second one waits for the user when Cancel is chosen.
    h.worker.send({ type: 'call', id: 4, method: 'ui.message', args: ['Waiting'] });
    await waitUntil(() => h.dialogs.custom.length === 2, 'the second message box');
    const runEnd = h.dialogs.custom[1]!.props.runEnd as { ended: boolean };
    expect(runEnd.ended).toBe(false);

    h.host.cancel();
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(runEnd.ended).toBe(true);
    expect(h.worker.terminated).toBe(1);
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    expect(h.store.getState().modified).toBe(false);
    expect(h.store.getState().runLock).toBeNull();
    expect(h.services.undo.canUndo).toBe(false);
    expect(h.services.undo.canRedo).toBe(false);
    expect(h.store.getState().statusMessage).toBe('Script "Append paragraph" was cancelled');
    expect(h.host.current?.status).toBe('cancelled');
    // Cancelling again is a no-op.
    h.host.cancel();
    expect(h.worker.terminated).toBe(1);
  });

  it("runs under a run session: the lock is the session's, Cancel reaches it from the banner", async () => {
    // Feature 005 T026: the lifecycle pieces moved into the RunSession the AI requests share.
    const h = await harness();
    expect(activeRunSession(h.store)).toBeNull();
    const { done } = await started(h);
    const session = activeRunSession(h.store)!;
    expect(session.kind).toBe('script');
    expect(session.label).toBe('Append paragraph');
    expect(session.undoLabel).toBe('Append');
    expect(session.before).toBe(h.store.getState().document);
    expect(h.store.getState().runLock).toEqual(session.lock);
    expect(h.host.current?.startedAt).toBe(session.startedAt);
    h.worker.send(APPEND_CALL);
    await h.worker.waitFor('result');
    // The banner's Cancel: through the session to the host, which restores the document.
    cancelActiveRun(h.store);
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(session.ended).toBe(true);
    expect(session.outcome).toBe('discarded');
    expect(activeRunSession(h.store)).toBeNull();
    expect(h.store.getState().runLock).toBeNull();
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    expect(h.services.undo.canUndo).toBe(false);

    // A completed run ends its session as committed: one undo entry.
    const other = await harness();
    const second = await started(other);
    other.worker.send(APPEND_CALL);
    await other.worker.waitFor('result');
    const committed = activeRunSession(other.store)!;
    other.worker.send({ type: 'done' });
    await second.done;
    expect(committed.outcome).toBe('committed');
    expect(other.services.undo.undoDepth).toBe(1);
    expect(paragraphTexts(other.store)).toEqual(['Hello', 'Added']);
  });

  it('reports failures with line and column, logs them and restores the document', async () => {
    const h = await harness();
    const done = h.run();
    await tick();
    h.worker.send({ type: 'ready' });
    await h.worker.waitFor('run');
    h.worker.send(APPEND_CALL);
    await h.worker.waitFor('result');
    h.worker.send({
      type: 'fail',
      error: { name: 'Error', message: 'boom', line: 4, column: 9, stack: 'Error: boom\n at x' },
    });
    const result = await done;
    expect(result.status).toBe('failed');
    expect(result.message).toBe('Script error: boom at line 4, column 9');
    expect(h.dialogs.shown.map((d) => d.text)).toEqual(['Script error: boom at line 4, column 9']);
    expect(h.dialogs.shown[0]!.testId).toBe('dialog-script-error');
    const logged = h.calls.find((c) => c.method === 'log.error')?.params as {
      source: string;
      code: string;
      message: string;
      context: { scriptId: string; line: string; column: string };
    };
    expect(logged.source).toBe('script');
    expect(logged.code).toBe('script.error');
    expect(logged.message).toContain('boom at line 4, column 9');
    expect(logged.context).toMatchObject({ scriptId: 'test.append', line: '4', column: '9' });
    // The document is left as it was before the run; nothing to undo.
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    expect(h.services.undo.undoDepth).toBe(0);
    expect(h.store.getState().statusMessage).toBe('Script "Append paragraph" failed');
    expect(h.host.lastRunId).toBe('test.append');
  });

  it('maps uncaught worker errors (ErrorEvent) and a missing location', async () => {
    const h = await harness();
    const done = h.run();
    await tick();
    h.worker.onerror!({
      message: 'Uncaught ReferenceError: x is not defined',
      lineno: 12,
      colno: 3,
      filename: 'http://127.0.0.1:4100/scripts/test.append/lib/helper.js',
      preventDefault() {},
    } as unknown as ErrorEvent);
    const result = await done;
    expect(result.message).toBe(
      'Script error: Uncaught ReferenceError: x is not defined at line 12, column 3 (lib/helper.js)',
    );
    expect(formatScriptError(h.t, { name: 'SyntaxError', message: "Unexpected token '}'" })).toBe(
      "Script error: Unexpected token '}'",
    );
  });

  it('ends as cancelled when its document is replaced, leaving the new document alone', async () => {
    const h = await harness({ customAnswers: ['ok'] });
    const { done } = await started(h);
    h.worker.send(APPEND_CALL);
    h.worker.send({ type: 'call', id: 2, method: 'ui.message', args: ['Shown'] });
    await waitUntil(
      () => h.worker.received.some((m) => m.type === 'result' && m.id === 2),
      'the message answer',
    );
    expect(paragraphTexts(h.store)).toEqual(['Hello', 'Added']);
    // Another book is opened from outside (a file passed to the running editor).
    actions.setDocument(h.store, fakeDocument({ docId: 'doc-2' }));
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.worker.terminated).toBe(1);
    expect(h.store.getState().docId).toBe('doc-2');
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    expect(h.store.getState().runLock).toBeNull();
    expect(h.services.undo.canUndo).toBe(false);
  });

  it('marks a run silent after the watchdog delay (information only) until it acts again', async () => {
    const h = await harness({ watchdogMs: 150 });
    const { done } = await started(h);
    await waitUntil(() => h.host.current?.silent === true, 'the silent mark');
    // Information only: no dialog, the run goes on.
    expect(h.dialogs.custom).toEqual([]);
    expect(h.host.isRunning).toBe(true);
    h.worker.send({ type: 'call', id: 1, method: 'ui.progress', args: [1, 2] });
    await h.worker.waitFor('result');
    expect(h.host.current?.silent).toBe(false);
    await waitUntil(() => h.host.current?.silent === true, 'the silent mark again');
    h.host.cancel();
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.host.current?.silent).toBe(false);
  });

  it('is not marked silent while the script waits for the user in a dialog', async () => {
    const h = await harness({ watchdogMs: 100, customAnswers: [new Promise(() => {})] });
    const { done } = await started(h);
    h.worker.send({ type: 'call', id: 1, method: 'ui.message', args: ['Waiting'] });
    await waitUntil(() => h.dialogs.custom.length === 1, 'the message box');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.host.current?.silent).toBeFalsy();
    h.host.cancel();
    await done;
  });

  it('refuses a second run while one is in progress and fails cleanly without a source', async () => {
    const h = await harness();
    const first = h.run();
    await tick();
    const second = await h.run();
    expect(second.status).toBe('busy');
    expect(h.dialogs.shown[0]!.testId).toBe('dialog-script-busy');
    h.host.cancel();
    await first;

    const broken = await harness();
    const rpcFail = fakeRpc({});
    const result = await broken.host.run(SCRIPT, {
      rpc: rpcFail.client,
      dialogs: broken.dialogs,
      t: broken.t,
      uiLanguage: 'en',
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('could not be loaded');
    expect(broken.services.undo.isGrouping).toBe(false);
  });

  /* ------------------------------------------- feature 003: duration, waiting, ticks */

  /** Moves `Date.now()` forward by `offsetMs` from the real clock (timers stay real). */
  function shiftClock(): { by(offsetMs: number): void; restore(): void } {
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    return {
      by(offsetMs) {
        offset = offsetMs;
      },
      restore() {
        spy.mockRestore();
      },
    };
  }

  it('sets the duration at the end and says "finished in N s"; a run over 5 s also shows a notice', async () => {
    const clock = shiftClock();
    try {
      // A short run: no duration while running, the duration at the end, no notice.
      const short = await harness();
      const notices = transientNotices(short.store);
      const { done } = await started(short);
      expect(short.host.current?.durationMs).toBeUndefined();
      expect(short.host.current?.waiting).toBe(false);
      clock.by(1_400);
      short.worker.send({ type: 'done' });
      await done;
      expect(short.host.current?.status).toBe('done');
      expect(short.host.current?.durationMs).toBeGreaterThanOrEqual(1_400);
      expect(short.host.current?.durationMs).toBeLessThan(5_000);
      expect(short.host.current?.elapsedMs).toBe(short.host.current?.durationMs);
      expect(short.store.getState().statusMessage).toBe(
        'Script "Append paragraph" finished in 1 s',
      );
      expect(notices.get()).toBeNull();

      // A long run: the status carries the rounded duration and a notice appears.
      clock.by(0);
      const long = await harness();
      const longNotices = transientNotices(long.store);
      const longRun = await started(long);
      clock.by(8_400);
      long.worker.send({ type: 'done' });
      await longRun.done;
      expect(long.host.current?.durationMs).toBeGreaterThanOrEqual(8_400);
      expect(long.store.getState().statusMessage).toBe('Script "Append paragraph" finished in 8 s');
      expect(longNotices.get()).toMatchObject({
        text: 'Script "Append paragraph" finished in 8 s',
        kind: 'info',
        ttlMs: 6_000,
      });
      longNotices.dismiss();
      expect(longNotices.get()).toBeNull();

      // A cancelled run: the duration is recorded, nothing is announced as finished.
      clock.by(0);
      const cancelled = await harness();
      const cancelledRun = await started(cancelled);
      clock.by(9_000);
      cancelled.host.cancel();
      await cancelledRun.done;
      expect(cancelled.host.current?.durationMs).toBeGreaterThanOrEqual(9_000);
      expect(cancelled.store.getState().statusMessage).toBe(
        'Script "Append paragraph" was cancelled',
      );
      expect(transientNotices(cancelled.store).get()).toBeNull();
    } finally {
      clock.restore();
    }
  });

  it('keeps a sticky status of the script instead of "finished in N s"', async () => {
    const h = await harness();
    const { done } = await started(h);
    h.worker.send({
      type: 'call',
      id: 1,
      method: 'ui.status',
      args: ['Kept by the script', { sticky: true }],
    });
    await h.worker.waitFor('result');
    h.worker.send({ type: 'done' });
    await done;
    expect(h.store.getState().statusMessage).toBe('Kept by the script');
    expect(h.host.current?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('flags the run as waiting while the script holds one of its dialogs open', async () => {
    const h = await harness({ customAnswers: ['ok', new Promise(() => {})] });
    const changes: boolean[] = [];
    let last = false;
    h.host.subscribe(() => {
      const waiting = h.host.current?.waiting ?? false;
      if (waiting !== last) {
        last = waiting;
        changes.push(waiting);
      }
    });
    const { done } = await started(h);
    expect(h.host.current?.waiting).toBe(false);

    // A message box the fake answers at once: waiting goes up and back down.
    h.worker.send({ type: 'call', id: 1, method: 'ui.message', args: ['Quick'] });
    await waitUntil(
      () => h.worker.received.some((m) => m.type === 'result' && m.id === 1),
      'the first answer',
    );
    expect(h.host.current?.waiting).toBe(false);
    expect(changes).toEqual([true, false]);

    // One the user has not answered yet: the run waits until Cancel ends it.
    h.worker.send({ type: 'call', id: 2, method: 'ui.message', args: ['Waiting'] });
    await waitUntil(() => h.host.current?.waiting === true, 'the waiting flag');
    expect(h.dialogs.custom).toHaveLength(2);
    h.host.cancel();
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.host.current?.waiting).toBe(false);
  });

  it('ticks the elapsed time while running and stops ticking at the end', async () => {
    const h = await harness({ tickMs: 20 });
    let notified = 0;
    h.host.subscribe(() => {
      notified += 1;
    });
    const { done } = await started(h);
    expect(h.host.current?.elapsedMs).toBe(0);
    await waitUntil(() => (h.host.current?.elapsedMs ?? 0) > 0, 'an elapsed-time tick');
    const first = h.host.current!.elapsedMs;
    await waitUntil(() => h.host.current!.elapsedMs > first, 'the next tick');
    expect(h.host.current!.elapsedMs).toBeGreaterThanOrEqual(
      Date.now() - h.host.current!.startedAt - 50,
    );

    h.worker.send({ type: 'done' });
    await done;
    const afterEnd = notified;
    const finalElapsed = h.host.current!.elapsedMs;
    await new Promise((resolve) => setTimeout(resolve, 120));
    // No tick after the end: nothing notified, the elapsed time frozen at the duration.
    expect(notified).toBe(afterEnd);
    expect(h.host.current!.elapsedMs).toBe(finalElapsed);
    expect(h.host.current!.elapsedMs).toBe(h.host.current!.durationMs);
  });

  it('formats the banner texts: elapsed mm:ss, progress with a total, a bare count, a phase', async () => {
    const h = await harness();
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(999)).toBe('00:00');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(3_725_000)).toBe('62:05');
    expect(durationSeconds(0)).toBe(1);
    expect(durationSeconds(1_499)).toBe(1);
    expect(durationSeconds(1_500)).toBe(2);
    expect(durationSeconds(8_400)).toBe(8);
    const progress = (done: number, total: number, phase: string) => ({
      jobId: 'script',
      phase,
      done,
      total,
    });
    expect(formatRunProgress(h.t, progress(20, 40, 'Counting'))).toBe('Counting — 20/40 (50 %)');
    expect(formatRunProgress(h.t, progress(50, 40, 'Over'))).toBe('Over — 50/40 (100 %)');
    expect(formatRunProgress(h.t, progress(12, 0, 'Still working'))).toBe('Still working — 12');
    expect(formatRunProgress(h.t, progress(0, 0, 'Preparing'))).toBe('Preparing');
    expect(formatRunProgress(h.t, null)).toBeNull();
    expect(formatRunProgress(h.t, { ...progress(1, 2, 'Other'), jobId: 'job-7' })).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 005 T026: a run nested in an AI request (FR-080; data-model §6.6) */
/* ------------------------------------------------------------------------ */

describe('ScriptHost nested in an AI request', () => {
  /**
   * An AI request in progress: its session holds the lock (kind `ai`) and its working copy
   * carries a change the live view does not show yet (`n3` reads "Outer", the editor "Hello").
   */
  async function nestedHarness(options: { customAnswers?: unknown[]; cancelsHost?: boolean } = {}) {
    const h = await harness({ customAnswers: options.customAnswers });
    const onCancel = vi.fn(() => {
      // The assistant's cancel ends the nested run first (T076), then its own session.
      if (options.cancelsHost) h.host.cancel();
    });
    const session = startRunSession(
      { store: h.store, undo: h.services.undo, getController: () => getBodyController(h.store) },
      { kind: 'ai', label: 'Service · model', phase: 'running script Append paragraph', onCancel },
    )!;
    const copy = new WorkingCopy(h.store.getState().document!);
    copy.replace('n3', {
      type: 'p',
      attrs: { nodeId: 'n3' },
      content: [{ type: 'text', text: 'Outer' }],
    });
    const lock = h.store.getState().runLock;
    const start = async () => {
      const done = h.host.run(
        SCRIPT,
        { rpc: h.rpc, dialogs: h.dialogs, t: h.t, uiLanguage: 'en' },
        { nested: { workingCopy: copy, session } },
      );
      await tick();
      h.worker.send({ type: 'ready' });
      await h.worker.waitFor('run');
      // Wrapped: `await start()` must not wait for the run itself.
      return { done };
    };
    return { ...h, session, copy, onCancel, lock, start };
  }

  const texts = (document: { bodies: unknown[] }) => {
    const section = (document.bodies[0] as { content: unknown[] }).content[0] as {
      content: { type: string; content?: { text?: string }[] }[];
    };
    return section.content.filter((c) => c.type === 'p').map((c) => c.content?.[0]?.text ?? '');
  };

  it("starts from the request's working copy, takes no lock or banner of its own, publishes nothing and hands the result back", async () => {
    const n = await nestedHarness({ customAnswers: ['ok'] });
    const { done } = await n.start();
    // The request's lock stays as it is: the same object, kind `ai`; the host knows the run as nested.
    expect(n.store.getState().runLock).toBe(n.lock);
    expect(activeRunSession(n.store)).toBe(n.session);
    expect(n.host.isRunning).toBe(true);
    expect(n.host.current).toMatchObject({
      scriptId: 'test.append',
      status: 'running',
      nested: true,
    });
    expect(n.store.getState().statusMessage).toBeNull();
    // The script reads the request's state, not the live document.
    n.worker.send({ type: 'call', id: 1, method: 'doc.textOf', args: ['n3'] });
    const read = (await n.worker.waitFor('result')) as { value: string };
    expect(read.value).toBe('Outer');
    expect(paragraphTexts(n.store)).toEqual(['Hello']);
    n.worker.send({ ...APPEND_CALL, id: 2 });
    await waitUntil(
      () => n.worker.received.some((m) => m.type === 'result' && m.id === 2),
      'the append',
    );
    // A dialog shows nothing of the working copy and is captioned as run by the assistant.
    n.worker.send({ type: 'call', id: 3, method: 'ui.message', args: ['So far'] });
    await waitUntil(
      () => n.worker.received.some((m) => m.type === 'result' && m.id === 3),
      'the answer',
    );
    expect(n.dialogs.custom).toHaveLength(1);
    expect(n.dialogs.custom[0]!.props.options).toMatchObject({
      caption: 'Append paragraph — run by the AI assistant',
      text: 'So far',
    });
    expect(paragraphTexts(n.store)).toEqual(['Hello']);
    expect(n.store.getState().modified).toBe(false);
    // The script's own caption keeps the marker; so does a form's title.
    n.worker.send({ type: 'call', id: 4, method: 'ui.message', args: ['Hi', { caption: 'Mine' }] });
    n.dialogs.customAnswers.push('ok', { x: '1' });
    await waitUntil(
      () => n.worker.received.some((m) => m.type === 'result' && m.id === 4),
      'the answer',
    );
    expect(n.dialogs.custom[1]!.props.options).toMatchObject({
      caption: 'Mine — run by the AI assistant',
    });
    n.worker.send({
      type: 'call',
      id: 5,
      method: 'ui.form',
      args: [{ title: 'Form', fields: [] }],
    });
    await waitUntil(
      () => n.worker.received.some((m) => m.type === 'result' && m.id === 5),
      'the answer',
    );
    expect(n.dialogs.custom[2]!.props.spec).toMatchObject({
      title: 'Form — run by the AI assistant',
    });

    n.worker.send({ type: 'done' });
    const result = await done;
    expect(result.status).toBe('done');
    expect(result.document).toBeTruthy();
    expect(texts(result.document!)).toEqual(['Outer', 'Added']);
    // Nothing published, no undo entry, no "last script", no status, the request still running.
    expect(paragraphTexts(n.store)).toEqual(['Hello']);
    expect(n.store.getState().modified).toBe(false);
    expect(n.services.undo.undoDepth).toBe(0);
    expect(n.host.lastRunId).toBeNull();
    expect(n.calls.map((c) => c.method)).not.toContain('scripts.lastRun');
    expect(n.store.getState().statusMessage).toBeNull();
    expect(n.store.getState().runLock).toBe(n.lock);
    expect(n.session.ended).toBe(false);
    expect(n.session.cancelRequested).toBe(false);
    expect(n.onCancel).not.toHaveBeenCalled();
    expect(n.host.isRunning).toBe(false);
    expect(n.host.current).toMatchObject({ status: 'done', nested: true });
    // The request takes the result over and commits the whole as one change.
    n.copy.reset(result.document!);
    expect(n.session.commit(n.copy.release())).toBe('committed');
    expect(paragraphTexts(n.store)).toEqual(['Outer', 'Added']);
    expect(n.services.undo.undoDepth).toBe(1);
    expect(n.store.getState().runLock).toBeNull();
  });

  it('hands back null when the script changed nothing', async () => {
    const n = await nestedHarness();
    const { done } = await n.start();
    n.worker.send({ type: 'call', id: 1, method: 'doc.getNode', args: ['n3'] });
    await n.worker.waitFor('result');
    n.worker.send({ type: 'done' });
    await expect(done).resolves.toEqual({
      status: 'done',
      error: undefined,
      message: undefined,
      document: null,
    });
    expect(n.session.ended).toBe(false);
  });

  it('is refused while the request has ended, and refuses a user-started run while the request holds the lock', async () => {
    const n = await nestedHarness();
    // A user-started script cannot start during the request (the lock is the request's).
    await expect(n.run()).resolves.toEqual({ status: 'busy' });
    expect(n.host.isRunning).toBe(false);
    expect(n.store.getState().runLock).toBe(n.lock);
    n.session.discard();
    const late = await n.host.run(
      SCRIPT,
      { rpc: n.rpc, dialogs: n.dialogs, t: n.t, uiLanguage: 'en' },
      { nested: { workingCopy: n.copy, session: n.session } },
    );
    expect(late.status).toBe('unavailable');
  });

  it('cancelled from the banner: the request cancels it and it cancels the request', async () => {
    // The banner's Cancel reaches the request's session, whose owner ends the nested run.
    const banner = await nestedHarness({
      cancelsHost: true,
      customAnswers: [new Promise(() => {})],
    });
    const { done } = await banner.start();
    banner.worker.send({ ...APPEND_CALL, id: 1 });
    await banner.worker.waitFor('result');
    banner.worker.send({ type: 'call', id: 2, method: 'ui.message', args: ['Waiting'] });
    await waitUntil(() => banner.dialogs.custom.length === 1, 'the dialog');
    const runEnd = banner.dialogs.custom[0]!.props.runEnd as { ended: boolean };
    cancelActiveRun(banner.store);
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(banner.onCancel).toHaveBeenCalledTimes(1);
    expect(runEnd.ended).toBe(true);
    expect(banner.worker.terminated).toBe(1);
    expect(paragraphTexts(banner.store)).toEqual(['Hello']);
    expect(banner.store.getState().modified).toBe(false);
    expect(banner.store.getState().statusMessage).toBeNull();
    // The request's session is the request's to end: still holding the lock, cancel requested.
    expect(banner.session.cancelRequested).toBe(true);
    expect(banner.session.ended).toBe(false);
    expect(banner.store.getState().runLock).toBe(banner.lock);

    // The other direction: the nested run cancelled directly (the exit flow) cancels the request.
    const direct = await nestedHarness();
    const { done: directDone } = await direct.start();
    direct.host.cancel();
    await expect(directDone).resolves.toMatchObject({ status: 'cancelled' });
    expect(direct.onCancel).toHaveBeenCalledTimes(1);
    expect(direct.session.cancelRequested).toBe(true);
    expect(direct.session.ended).toBe(false);
  });

  it('a failure returns the error to the caller and leaves the request running; the log holds the id and the error name only', async () => {
    const n = await nestedHarness();
    actions.setModified(n.store, true);
    const { done } = await n.start();
    n.worker.send({ ...APPEND_CALL, id: 1 });
    await n.worker.waitFor('result');
    n.worker.send({
      type: 'fail',
      error: {
        name: 'TypeError',
        message: 'boom',
        line: 4,
        column: 9,
        stack: 'TypeError: boom\n at x',
      },
    });
    const result = await done;
    expect(result).toEqual({
      status: 'failed',
      error: {
        name: 'TypeError',
        message: 'boom',
        line: 4,
        column: 9,
        stack: 'TypeError: boom\n at x',
      },
      message: 'Script error: boom at line 4, column 9',
      document: undefined,
    });
    // No error dialog of the host's own: the caller reports it as the tool result.
    expect(n.dialogs.shown).toEqual([]);
    const logged = n.calls.find((c) => c.method === 'log.error')?.params as {
      message: string;
      stack?: string;
      context: { scriptId: string; line: string; column: string };
    };
    expect(logged.message).toBe('test.append: TypeError');
    expect(logged.stack).toBeUndefined();
    expect(logged.context).toMatchObject({ scriptId: 'test.append', line: '4', column: '9' });
    expect(n.calls.map((c) => c.method)).not.toContain('scripts.lastRun');
    expect(n.host.lastRunId).toBeNull();
    // The request goes on: its lock and session untouched, the live document as it was.
    expect(n.session.ended).toBe(false);
    expect(n.session.cancelRequested).toBe(false);
    expect(n.onCancel).not.toHaveBeenCalled();
    expect(n.store.getState().runLock).toBe(n.lock);
    expect(paragraphTexts(n.store)).toEqual(['Hello']);
    expect(n.store.getState().modified).toBe(true);
    expect(n.services.undo.canUndo).toBe(false);
  });

  it("ends as cancelled when the request's document is replaced, and cancels the request", async () => {
    const n = await nestedHarness();
    const { done } = await n.start();
    n.worker.send({ ...APPEND_CALL, id: 1 });
    await n.worker.waitFor('result');
    actions.setDocument(n.store, fakeDocument({ docId: 'doc-2' }));
    // The nested run has no watch of its own; a `done` on a replaced document is a cancel.
    n.worker.send({ type: 'done' });
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(n.onCancel).toHaveBeenCalledTimes(1);
    expect(n.store.getState().docId).toBe('doc-2');
    expect(paragraphTexts(n.store)).toEqual(['Hello']);
  });
});
