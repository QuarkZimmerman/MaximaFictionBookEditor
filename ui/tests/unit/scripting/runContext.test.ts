/**
 * Feature 007 (T016, contracts/script-api.md §1, data-model §8): the run context of script API
 * version 2. `ctx.startedBy` says who started the run - a menu, toolbar, hotkey or tree command
 * ('user'), the AI assistant's `run_script` ('assistant'), another script through
 * `mfbe.scripts.run` ('script', with `ctx.caller`) - and `mfbe.version` is 3 (feature 011). A run the user or
 * the assistant starts has no caller.
 */

import { createInstance } from 'i18next';

import { createAppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';
import { ScriptHost, type RunOptions, type WorkerLike } from '@/scripting/host';
import { startRunSession } from '@/scripting/runSession';
import { createBridge, createContext, createMfbe } from '@/scripting/sandbox';
import type { HostMessage, InitMessage, ScriptInfo, WorkerMessage } from '@/scripting/types';
import { WorkingCopy } from '@/scripting/workingCopy';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDialogs, fakeDocument, fakeRpc } from '../features/testUtils';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeWorker implements WorkerLike {
  port: MessagePort | null = null;
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
  terminate() {}
  send(message: WorkerMessage) {
    this.port!.postMessage(message);
  }
  async waitFor(type: HostMessage['type']): Promise<HostMessage> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = this.received.find((m) => m.type === type);
      if (found) return found;
      await tick();
    }
    throw new Error(`no ${type} message received`);
  }
}

const SCRIPT: ScriptInfo = {
  manifestVersion: 1,
  id: 'test.append',
  name: { en: 'Append paragraph' },
  kind: 'menu',
  entry: 'index.js',
  needsSelection: false,
  group: '04_Model',
  dir: '/tmp/scripts/04_Model/01_Append',
  folder: '01_Append',
  source: 'bundled',
  origin: 'bundled',
  entryUrl: '/scripts/test.append/index.js',
  warnings: [],
};

/** Starts a run with `options` and returns the run context the worker received. */
async function runContextOf(
  options: Partial<RunOptions> = {},
  nested = false,
): Promise<Record<string, unknown>> {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'scripts.source': { entryUrl: SCRIPT.entryUrl, entry: 'index.js', files: [] },
    'scripts.lastRun': {},
    'log.error': {},
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  const worker = new FakeWorker();
  const host = new ScriptHost({
    store,
    undo: services.undo,
    createWorker: () => worker,
    getController: () => getBodyController(store),
    origin: () => 'http://127.0.0.1:4100',
  });
  let mode = {};
  if (nested) {
    // The assistant runs a script inside its request (feature 005): the request's session and
    // working copy.
    const session = startRunSession(
      { store, undo: services.undo, getController: () => getBodyController(store) },
      {
        kind: 'ai',
        label: 'AI',
        undoLabel: 'AI',
        onCancel: () => {},
        onDocumentReplaced: () => {},
      },
    )!;
    mode = { nested: { workingCopy: new WorkingCopy(store.getState().document!), session } };
  }
  const done = host.run(
    SCRIPT,
    { rpc: rpc.client, dialogs: fakeDialogs(), t: i18n.t, uiLanguage: 'en', ...options },
    mode,
  );
  await tick();
  worker.send({ type: 'ready' });
  const run = (await worker.waitFor('run')) as Extract<HostMessage, { type: 'run' }>;
  worker.send({ type: 'done' });
  await done;
  return run.context as unknown as Record<string, unknown>;
}

describe('the run context of script API version 2', () => {
  it('is started by the user from a menu, the toolbar, a hotkey or the tree, with no caller', async () => {
    const menu = await runContextOf();
    expect(menu.startedBy).toBe('user');
    expect(menu.caller).toBeUndefined();
    const tree = await runContextOf({ treeNode: { nodeId: 'n2', type: 'section' } });
    expect(tree.startedBy).toBe('user');
    expect(tree.caller).toBeUndefined();
  });

  it('is started by the assistant for the assistant’s run_script, with no caller', async () => {
    const context = await runContextOf({ startedBy: 'assistant' }, true);
    expect(context.startedBy).toBe('assistant');
    expect(context.caller).toBeUndefined();
  });

  it('reaches the script’s ctx in the worker, frozen', () => {
    const port = new MessageChannel().port1;
    const bridge = createBridge(port);
    const ctx = createContext(bridge, {
      script: { id: 'a', name: 'A', group: 'g', kind: 'menu' },
      uiLanguage: 'en',
      startedBy: 'script',
      caller: '01/caller',
    });
    expect(ctx.startedBy).toBe('script');
    expect(ctx.caller).toBe('01/caller');
    expect(Object.isFrozen(ctx)).toBe(true);
    const user = createContext(bridge, {
      script: { id: 'a', name: 'A', group: 'g', kind: 'menu' },
      uiLanguage: 'en',
      startedBy: 'user',
    });
    expect(user.startedBy).toBe('user');
    expect(user.caller).toBeUndefined();
    port.close();
  });

  it('is version 2 of the API', () => {
    const port = new MessageChannel().port1;
    // Script API version 3 (feature 011): the Document tree's rows (power (e)).
    expect(createMfbe(createBridge(port)).version).toBe(3);
    port.close();
  });
});
