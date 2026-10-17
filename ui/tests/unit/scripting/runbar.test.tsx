/**
 * Feature 002 T058 - the run bar in the status bar area: progress text and Cancel while a
 * script runs (also with the status bar hidden), the silent-run notice, every command
 * disabled during the run, and the script dialogs that close themselves when the run ends.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProvider } from '@/app/AppContext';
import { createCommandRegistry, type CommandContext } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { createAppServices } from '@/app/services';
import { StatusBar } from '@/app/StatusBar';
import { initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { installScriptsFeature } from '@/scripting/catalog';
import { ScriptFormDialog, ScriptMessageDialog, ScriptPromptDialog } from '@/scripting/forms';
import type { RunResult } from '@/scripting/host';
import type {
  HostMessage,
  InitMessage,
  RunEnd,
  ScriptInfo,
  WorkerMessage,
} from '@/scripting/types';

import { fakeDialogs, fakeDocument, fakeRpc } from '../features/testUtils';

class FakeWorker {
  port: MessagePort | null = null;
  terminated = 0;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: HostMessage[] = [];
  postMessage(message: unknown, transfer?: Transferable[]) {
    if ((message as InitMessage).type === 'init') {
      this.port = transfer?.[0] as MessagePort;
      this.port.onmessage = (event: MessageEvent<HostMessage>) => this.received.push(event.data);
    }
  }
  terminate() {
    this.terminated += 1;
  }
  send(message: WorkerMessage) {
    this.port!.postMessage(message);
  }
}

const SCRIPT: ScriptInfo = {
  manifestVersion: 1,
  id: 'test.long',
  name: { en: 'Long run', ru: 'Долгий' },
  kind: 'menu',
  entry: 'index.js',
  needsSelection: false,
  group: '05_Runs',
  dir: '/scripts/05_Runs/01_Long',
  folder: '01_Long',
  source: 'user',
  entryUrl: '/scripts/test.long/index.js',
  warnings: [],
};

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function setup(options: { watchdogMs?: number } = {}) {
  const i18n = await initI18n({ language: 'en' });
  const store = createAppStore();
  const commands = createCommandRegistry();
  const hotkeys = new HotkeyMap('linux');
  const undo = new UndoCoordinator();
  const worker = new FakeWorker();
  const feature = installScriptsFeature({
    store,
    commands,
    hotkeys,
    undo,
    createWorker: () => worker as unknown as Worker,
    watchdogMs: options.watchdogMs,
  });
  const rpc = fakeRpc({
    'scripts.source': { entryUrl: SCRIPT.entryUrl, entry: 'index.js', files: [] },
    'scripts.lastRun': {},
  });
  const services = createAppServices({
    store,
    rpc: rpc.client,
    commands,
    hotkeys,
    undo,
    platform: 'linux',
  });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  render(
    <AppProvider services={services}>
      <StatusBar />
    </AppProvider>,
  );
  const ctx = {
    store,
    rpc: rpc.client,
    undo,
    dialogs: fakeDialogs(),
    hotkeys,
    t: i18n.t,
    version: 'test',
  } as CommandContext;
  let done: Promise<RunResult> = Promise.resolve({ status: 'unavailable' });
  const start = async () => {
    await act(async () => {
      done = feature.host.run(SCRIPT, {
        rpc: rpc.client,
        dialogs: ctx.dialogs,
        t: i18n.t,
        uiLanguage: 'en',
      });
    });
    await waitFor(() => worker.port !== null, 'the worker port');
    worker.send({ type: 'ready' });
    await waitFor(() => worker.received.some((m) => m.type === 'run'), 'the run message');
    return () => done;
  };
  return { store, services, feature, worker, ctx, start };
}

describe('Run bar', () => {
  it('shows the progress and Cancel while a script runs, even with the status bar hidden', async () => {
    const { store, worker, start } = await setup();
    expect(screen.getByTestId('status-message')).toHaveTextContent('Ready');
    expect(screen.queryByTestId('script-run-bar')).not.toBeInTheDocument();

    const result = await start();
    expect(screen.queryByTestId('status-message')).not.toBeInTheDocument();
    expect(screen.getByTestId('script-run-text')).toHaveTextContent('Running script "Long run"...');
    // The status-bar line's Cancel; the banner above the document owns `script-run-cancel`.
    expect(screen.getByTestId('script-run-bar-cancel')).toHaveTextContent('Cancel');

    worker.send({ type: 'call', id: 1, method: 'ui.progress', args: [25, 100, 'Phase'] });
    await waitFor(
      () => screen.getByTestId('script-run-text').textContent === 'Phase: 25%',
      'progress',
    );
    worker.send({ type: 'call', id: 2, method: 'ui.progress', args: [7, 0, 'Counting'] });
    await waitFor(
      () => screen.getByTestId('script-run-text').textContent === 'Counting: 7',
      'a count without total',
    );

    await act(async () => actions.setToolbars(store, { status: false }));
    expect(screen.getByTestId('script-run-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('status-path')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('script-run-bar-cancel'));
    await expect(result()).resolves.toMatchObject({ status: 'cancelled' });
    expect(worker.terminated).toBe(1);
    expect(screen.queryByTestId('statusbar')).not.toBeInTheDocument();
  });

  it('says when the script has reported nothing for a while', async () => {
    const { worker, start } = await setup({ watchdogMs: 100 });
    const result = await start();
    await waitFor(() => screen.getByTestId('script-run-bar').dataset.silent === 'true', 'silence');
    expect(screen.getByTestId('script-run-text')).toHaveTextContent(
      'The script "Long run" has been running for a while without reporting progress.',
    );
    worker.send({ type: 'call', id: 1, method: 'ui.progress', args: [1, 2] });
    await waitFor(
      () => screen.getByTestId('script-run-bar').dataset.silent === undefined,
      'activity',
    );
    await act(async () => screen.getByTestId('script-run-bar-cancel').click());
    await result();
  });

  it('disables every command while a script runs', async () => {
    const { services, ctx, worker, start } = await setup();
    expect(services.commands.isEnabled('view.statusBar', ctx)).toBe(true);
    const result = await start();
    for (const id of ['view.statusBar', 'view.source', 'edit.undo', 'file.open', 'file.save']) {
      expect(services.commands.isEnabled(id, ctx), id).toBe(false);
    }
    worker.send({ type: 'done' });
    await act(async () => {
      await result();
    });
    expect(services.commands.isEnabled('view.statusBar', ctx)).toBe(true);
  });
});

describe('Script dialogs at the end of their run', () => {
  function runEnd(): RunEnd & { finish(): void } {
    const listeners = new Set<() => void>();
    let ended = false;
    return {
      get ended() {
        return ended;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      finish() {
        ended = true;
        for (const listener of listeners) listener();
      },
    };
  }

  it('close themselves with the result of Cancel', async () => {
    await initI18n({ language: 'en' });
    const closed: unknown[] = [];
    // One modal dialog at a time, as the dialog stack shows them.
    const dialogs = [
      (end: RunEnd) => (
        <ScriptMessageDialog
          options={{ text: 'Hi', caption: 'C', buttons: [{ id: 'ok', label: 'OK' }] }}
          onClose={(id) => closed.push(['message', id])}
          runEnd={end}
        />
      ),
      (end: RunEnd) => (
        <ScriptFormDialog
          spec={{ title: 'F', fields: [] }}
          onClose={(values) => closed.push(['form', values])}
          runEnd={end}
        />
      ),
      (end: RunEnd) => (
        <ScriptPromptDialog
          options={{ prompt: 'Text?', buttons: 'okCancel', testId: 'dialog-script-prompt' }}
          onClose={(result) => closed.push(['prompt', result])}
          runEnd={end}
        />
      ),
    ];
    for (const dialog of dialogs) {
      const end = runEnd();
      const view = render(dialog(end));
      expect(closed).toHaveLength(dialogs.indexOf(dialog));
      act(() => end.finish());
      view.unmount();
    }
    expect(closed).toEqual([
      ['message', ''],
      ['form', null],
      ['prompt', { button: 'cancel', value: '' }],
    ]);
  });
});
