/**
 * T099 - the run lifecycle of the script host with a fake worker: the private port handshake,
 * one undo group per run, cancel = terminate + roll back the group, errors reported as
 * "Script error: <message> at line L, column C" (dialog + log.error), the Last-script memory
 * (`scripts.lastRun`), the "still running" prompt after the watchdog delay, and the busy guard.
 */

import { createInstance } from 'i18next';

import { createAppServices, type AppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { ScriptHost, formatScriptError, type RunResult, type WorkerLike } from '@/scripting/host';
import type { HostMessage, InitMessage, ScriptInfo, WorkerMessage } from '@/scripting/types';
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
  calls: { method: string; params: unknown }[];
  t: Awaited<ReturnType<typeof initI18n>>['t'];
  run(options?: { treeNode?: { nodeId: string; type: string } }): Promise<RunResult>;
}

async function harness(options: { watchdogMs?: number; customAnswers?: unknown[] } = {}) {
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
  });
  const h: Harness = {
    services,
    store,
    dialogs,
    worker,
    host,
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
    expect(paragraphTexts(h.store)).toEqual(['Hello', 'Added']);
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
    expect(h.store.getState().statusMessage).toBe('Script "Append paragraph" finished');
    // The whole run is one undo entry.
    expect(h.services.undo.undoDepth).toBe(1);
    expect(h.services.undo.peekUndo()?.label).toBe('Append');
    h.services.undo.undo();
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
  });

  it('cancel terminates the worker and rolls the undo group back', async () => {
    const h = await harness();
    const done = h.run();
    await tick();
    h.worker.send({ type: 'ready' });
    await h.worker.waitFor('run');
    h.worker.send(APPEND_CALL);
    await h.worker.waitFor('result');
    h.worker.send({ type: 'call', id: 2, method: 'doc.setText', args: ['n3', 'Changed'] });
    await tick();
    await tick();
    expect(paragraphTexts(h.store)).toEqual(['Changed', 'Added']);
    expect(h.services.undo.isGrouping).toBe(true);

    h.host.cancel();
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.worker.terminated).toBe(1);
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    expect(h.services.undo.canUndo).toBe(false);
    expect(h.services.undo.canRedo).toBe(false);
    expect(h.store.getState().statusMessage).toBe('Script "Append paragraph" was cancelled');
    expect(h.host.current?.status).toBe('cancelled');
    // Cancelling again is a no-op.
    h.host.cancel();
    expect(h.worker.terminated).toBe(1);
  });

  it('reports failures with line and column, logs them and keeps the partial edit undoable', async () => {
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
    // Partial changes stay (consistent document) as one undo entry.
    expect(paragraphTexts(h.store)).toEqual(['Hello', 'Added']);
    expect(h.services.undo.undoDepth).toBe(1);
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

  it('asks "wait / cancel" when the script is silent for too long', async () => {
    // Long enough for the fake worker's "ready" to be processed first on a loaded machine.
    const h = await harness({ watchdogMs: 200, customAnswers: ['cancel'] });
    const done = h.run();
    await tick();
    h.worker.send({ type: 'ready' });
    await h.worker.waitFor('run');
    const result = await done;
    expect(result.status).toBe('cancelled');
    expect(h.dialogs.custom.map((d) => d.name)).toEqual(['ScriptRunningPrompt']);
    expect(h.dialogs.custom[0]!.props.scriptName).toBe('Append paragraph');
    expect(h.worker.terminated).toBe(1);
  });

  it('"wait" re-arms the watchdog and the prompt is not shown while a dialog is open', async () => {
    // Generous intervals: timers drift on loaded CI machines, and the checkpoint below must
    // fall between the first prompt (t = 200 ms) and the re-armed one (t = 400 ms).
    const h = await harness({ watchdogMs: 200, customAnswers: ['wait', 'ok', 'cancel'] });
    const done = h.run();
    await tick();
    h.worker.send({ type: 'ready' });
    await h.worker.waitFor('run');
    // First prompt -> wait; then the script opens its own message box (no prompt meanwhile).
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(h.dialogs.custom.map((d) => d.name)).toEqual(['ScriptRunningPrompt']);
    h.worker.send({ type: 'call', id: 1, method: 'ui.message', args: ['Hi'] });
    await h.worker.waitFor('result');
    expect(h.dialogs.custom.map((d) => d.name)).toEqual([
      'ScriptRunningPrompt',
      'ScriptMessageDialog',
    ]);
    const result = await done;
    expect(result.status).toBe('cancelled');
    expect(h.dialogs.custom.map((d) => d.name)).toEqual([
      'ScriptRunningPrompt',
      'ScriptMessageDialog',
      'ScriptRunningPrompt',
    ]);
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
});
