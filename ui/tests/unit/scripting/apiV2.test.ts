/**
 * Feature 007 (T039, contracts/script-api.md §2-§6, data-model §8): the powers of script API
 * version 2, performed by the editor at a script's request (constitution principle V).
 *
 * - Clipboard: plain text; reading is refused unless the chain's root was started by the user -
 *   what a script reads in an assistant-started chain would reach the AI service.
 * - Files: `files.saveText` and `files.saveBinaries` go through the core (its dialogs, its
 *   atomic writes); a cancelled dialog is no error; existing files are overwritten only when
 *   the user says so.
 * - Report: `ui.report` hands the report window its text or HTML (ReportWindow.test.tsx shows
 *   the sandbox).
 * - `scripts.run`: another script runs in a worker the host creates, in the same run - one undo
 *   step, one Cancel for every script of the chain - at most 8 deep; a reference is an id or
 *   the legacy FictionBook Editor path (separators and case not significant); the callee gets
 *   `ctx.startedBy === 'script'`, `ctx.caller` and `ctx.args`, and its return value comes back.
 */

import { createInstance } from 'i18next';

import { createAppServices } from '@/app/services';
import { initI18n } from '@/i18n';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { createScriptApi, ScriptApiError, type ScriptApiDeps } from '@/scripting/api-impl';
import { ScriptHost, type WorkerLike } from '@/scripting/host';
import { normaliseLegacyPath, resolveScriptRef } from '@/scripting/scriptRefs';
import type { HostMessage, InitMessage, ScriptInfo, WorkerMessage } from '@/scripting/types';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDialogs, fakeDocument, fakeRpc } from '../features/testUtils';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function script(id: string, overrides: Partial<ScriptInfo> = {}): ScriptInfo {
  return {
    manifestVersion: 1,
    id,
    name: { en: id },
    kind: 'menu',
    entry: 'index.js',
    needsSelection: false,
    group: '16_find-formatting',
    dir: `/scripts/${id}`,
    folder: id,
    source: 'bundled',
    origin: 'bundled',
    entryUrl: `/scripts/${encodeURIComponent(id)}/index.js`,
    warnings: [],
    ...overrides,
  };
}

async function apiWith(overrides: Partial<ScriptApiDeps> = {}) {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  actions.setDocument(store, fakeDocument());
  const rpc = fakeRpc((overrides as { responses?: Parameters<typeof fakeRpc>[0] }).responses ?? {});
  const dialogs = fakeDialogs();
  const api = createScriptApi({
    store,
    document: store.getState().document,
    controller: null,
    dialogs,
    rpc: rpc.client,
    t: i18n.t,
    scriptName: 'Test',
    uiLanguage: 'en',
    ...overrides,
  });
  return { api, store, rpc, dialogs };
}

/* ------------------------------------------------------------------------ */
/* Clipboard                                                                 */
/* ------------------------------------------------------------------------ */

describe('mfbe.clipboard', () => {
  const clipboard = () => {
    let text = 'from the clipboard';
    return {
      written: [] as string[],
      readText: vi.fn(async () => text),
      writeText: vi.fn(async (value: string) => {
        text = value;
      }),
    };
  };

  it('reads plain text in a chain the user started', async () => {
    const board = clipboard();
    const { api } = await apiWith({ rootStartedBy: 'user', clipboard: board });
    await expect(api.call('clipboard.readText', [])).resolves.toBe('from the clipboard');
  });

  it('refuses to read in a chain the assistant started', async () => {
    const board = clipboard();
    const { api } = await apiWith({ rootStartedBy: 'assistant', clipboard: board });
    const call = api.call('clipboard.readText', []);
    await expect(call).rejects.toBeInstanceOf(ScriptApiError);
    await expect(call).rejects.toMatchObject({ code: 'clipboard.readNotAllowed' });
    expect(board.readText).not.toHaveBeenCalled();
  });

  it('writes plain text, in any chain', async () => {
    const board = clipboard();
    const { api } = await apiWith({ rootStartedBy: 'assistant', clipboard: board });
    await expect(api.call('clipboard.writeText', ['Статистика'])).resolves.toBeUndefined();
    expect(board.writeText).toHaveBeenCalledWith('Статистика');
    await expect(api.call('clipboard.writeText', [5])).rejects.toBeInstanceOf(ScriptApiError);
  });
});

/* ------------------------------------------------------------------------ */
/* Files                                                                     */
/* ------------------------------------------------------------------------ */

describe('mfbe.files', () => {
  it('saves text through the core: the name alone comes back; a cancelled dialog is no error', async () => {
    const answers = [{ saved: true, name: 'stat.txt' }, { saved: false }];
    const { api, rpc } = await apiWith({
      responses: { 'files.saveText': () => answers.shift() },
    } as Partial<ScriptApiDeps>);
    await expect(
      api.call('files.saveText', [{ suggestedName: 'stat.txt', text: 'x', encoding: 'utf-16' }]),
    ).resolves.toEqual({ saved: true, name: 'stat.txt' });
    expect(rpc.calls.at(-1)).toEqual({
      method: 'files.saveText',
      params: { suggestedName: 'stat.txt', text: 'x', encoding: 'utf-16' },
    });
    await expect(
      api.call('files.saveText', [{ suggestedName: 'a.txt', text: 'x' }]),
    ).resolves.toEqual({ saved: false });
    // The encodings of the contract only; a name and a text are required.
    for (const bad of [
      { suggestedName: 'a.txt', text: 'x', encoding: 'koi8-r' },
      { suggestedName: 'a.txt' },
      { text: 'x' },
    ]) {
      await expect(api.call('files.saveText', [bad])).rejects.toBeInstanceOf(ScriptApiError);
    }
  });

  it('saves the book’s binaries and asks before overwriting existing files', async () => {
    const answers = [
      { saved: 2, skipped: ['a.jpg', 'b.png', 'c.gif'], folderToken: 'tok' },
      { saved: 2, skipped: [], folderToken: 'tok' },
    ];
    const { api, rpc, dialogs } = await apiWith({
      responses: { 'files.saveBinaries': () => answers.shift() },
    } as Partial<ScriptApiDeps>);
    // a.jpg: Overwrite; b.png: Skip; c.gif onwards: Overwrite all.
    dialogs.customAnswers.push('overwrite', 'skip', 'overwriteAll');
    await expect(api.call('files.saveBinaries', [])).resolves.toEqual({ saved: 4, skipped: 1 });
    const saves = rpc.calls.filter((c) => c.method === 'files.saveBinaries');
    expect(saves[0]!.params).toEqual({ docId: 'doc-1' });
    expect(saves[1]!.params).toEqual({
      docId: 'doc-1',
      ids: ['a.jpg', 'c.gif'],
      folderToken: 'tok',
      overwrite: true,
    });
    expect(dialogs.custom).toHaveLength(3);
  });

  it('Cancel in the overwrite question writes nothing more', async () => {
    const { api, rpc, dialogs } = await apiWith({
      responses: {
        'files.saveBinaries': { saved: 1, skipped: ['a.jpg', 'b.png'], folderToken: 'tok' },
      },
    } as Partial<ScriptApiDeps>);
    dialogs.customAnswers.push('cancel');
    await expect(
      api.call('files.saveBinaries', [{ ids: ['x.jpg', 'a.jpg', 'b.png'] }]),
    ).resolves.toEqual({
      saved: 1,
      skipped: 2,
    });
    expect(rpc.calls.filter((c) => c.method === 'files.saveBinaries')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* Report                                                                    */
/* ------------------------------------------------------------------------ */

describe('mfbe.ui.report', () => {
  it('opens a report window with the text or the HTML', async () => {
    const openReport = vi.fn();
    const { api } = await apiWith({ openReport });
    await expect(
      api.call('ui.report', [{ title: 'Статистика', html: '<b>1</b>' }]),
    ).resolves.toBeUndefined();
    expect(openReport).toHaveBeenCalledWith({ title: 'Статистика', html: '<b>1</b>' });
    await api.call('ui.report', [{ title: 'Plain', text: 'a\nb' }]);
    expect(openReport).toHaveBeenLastCalledWith({ title: 'Plain', text: 'a\nb' });
    await expect(api.call('ui.report', [{ text: 'no title' }])).rejects.toBeInstanceOf(
      ScriptApiError,
    );
    await expect(api.call('ui.report', [{ title: 'Neither' }])).rejects.toBeInstanceOf(
      ScriptApiError,
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Script references                                                         */
/* ------------------------------------------------------------------------ */

describe('script references (data-model §7.3)', () => {
  const scripts = [
    script('16/next-cite', {
      legacy: {
        source: '16_Поиск форматирования/52_Перейти на следующую цитату.js',
        fbeVersion: '2.7.9',
      },
    }),
    script('06/latin-in-cyrillic', {
      legacy: { source: '06_Чистка/03_Латиница в Кириллице.js', fbeVersion: '2.7.9' },
    }),
    // Unchanged since 2.7beta1: its source is 2.7beta1's path, its 2.7.9 path an alias.
    script('01/upper-case', {
      legacy: {
        source: '01_Регистр/01_Верхний регистр.js',
        fbeVersion: '2.7',
        aliases: ['01_Регистр/01_В верхний регистр.js'],
      },
    }),
  ];

  it('normalises a legacy path: separators, a leading Scripts folder, ".js" and case', () => {
    expect(normaliseLegacyPath('16_Поиск форматирования\\52_Перейти на следующую цитату.js')).toBe(
      '16_поиск форматирования/52_перейти на следующую цитату',
    );
    expect(normaliseLegacyPath('\\Scripts\\06_Чистка\\03_Латиница в Кириллице.JS')).toBe(
      '06_чистка/03_латиница в кириллице',
    );
  });

  it('resolves an id first, then a legacy path', () => {
    expect(resolveScriptRef('16/next-cite', scripts)?.id).toBe('16/next-cite');
    expect(
      resolveScriptRef('16_Поиск форматирования\\52_Перейти на следующую цитату.js', scripts)?.id,
    ).toBe('16/next-cite');
    expect(
      resolveScriptRef('16_ПОИСК ФОРМАТИРОВАНИЯ/52_перейти на следующую цитату', scripts)?.id,
    ).toBe('16/next-cite');
    // A full path of the original's installation names the script by its Scripts folder part.
    expect(
      resolveScriptRef(
        'C:\\Program Files (x86)\\FictionBook Editor_2.7.4\\Scripts\\06_Чистка\\03_Латиница в Кириллице.js',
        scripts,
      )?.id,
    ).toBe('06/latin-in-cyrillic');
    expect(resolveScriptRef('16/no-such-script', scripts)).toBeNull();
    expect(resolveScriptRef('', scripts)).toBeNull();
  });

  it('resolves the 2.7.9 path of a package unchanged since 2.7beta1 through its aliases (feature 007)', () => {
    expect(resolveScriptRef('01_Регистр\\01_В верхний регистр.js', scripts)?.id).toBe(
      '01/upper-case',
    );
    expect(resolveScriptRef('01_Регистр/01_Верхний регистр.js', scripts)?.id).toBe('01/upper-case');
  });
});

/* ------------------------------------------------------------------------ */
/* Run chains (host)                                                         */
/* ------------------------------------------------------------------------ */

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
  send(message: WorkerMessage) {
    this.port!.postMessage(message);
  }
  async waitFor(predicate: (message: HostMessage) => boolean, what: string): Promise<HostMessage> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = this.received.find(predicate);
      if (found) return found;
      await tick();
    }
    throw new Error(`no ${what} received`);
  }
}

async function chainHarness(catalogue: ScriptInfo[]) {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store: AppStore = createAppStore();
  const rpc = fakeRpc({
    'scripts.source': (params: unknown) => {
      const id = (params as { scriptId: string }).scriptId;
      return {
        entryUrl: `/scripts/${encodeURIComponent(id)}/index.js`,
        entry: 'index.js',
        files: [],
      };
    },
    'scripts.lastRun': {},
    'log.error': {},
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  const workers: FakeWorker[] = [];
  const host = new ScriptHost({
    store,
    undo: services.undo,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    getController: () => getBodyController(store),
    origin: () => 'http://127.0.0.1:4100',
    scripts: () => catalogue,
  });
  const run = (root: ScriptInfo) =>
    host.run(root, { rpc: rpc.client, dialogs: fakeDialogs(), t: i18n.t, uiLanguage: 'en' });
  /** The worker number `index`, started: `ready` sent, its `run` message returned. */
  const startedWorker = async (index: number) => {
    const deadline = Date.now() + 10_000;
    while (!workers[index] && Date.now() < deadline) await tick();
    const worker = workers[index]!;
    while (!worker.port && Date.now() < deadline) await tick();
    worker.send({ type: 'ready' });
    const message = (await worker.waitFor((m) => m.type === 'run', 'run')) as Extract<
      HostMessage,
      { type: 'run' }
    >;
    return { worker, context: message.context as unknown as Record<string, unknown> };
  };
  return { host, store, services, workers, run, startedWorker };
}

const APPEND = (id: number, text: string): WorkerMessage => ({
  type: 'call',
  id,
  method: 'doc.insertNode',
  args: ['append', 'n2', { type: 'p', attrs: {}, content: [{ type: 'text', text }] }],
});

function paragraphTexts(store: AppStore): string[] {
  const section = store.getState().document!.bodies[0]!.content[0] as {
    content: { type: string; content?: { text?: string }[] }[];
  };
  return section.content.filter((c) => c.type === 'p').map((c) => c.content?.[0]?.text ?? '');
}

describe('mfbe.scripts.run', () => {
  const root = script('31/combo', { name: { en: 'Combo' }, undoLabel: { en: 'Combo' } });
  const callee = script('16/next-cite', {
    legacy: {
      source: '16_Поиск форматирования/52_Перейти на следующую цитату.js',
      fbeVersion: '2.7.9',
    },
  });

  it('runs the callee in a worker of its own, in the same run: one undo step; its value comes back', async () => {
    const h = await chainHarness([root, callee]);
    const done = h.run(root);
    const first = await h.startedWorker(0);
    expect(first.context.startedBy).toBe('user');
    first.worker.send(APPEND(1, 'from the combo'));
    await first.worker.waitFor((m) => m.type === 'result' && m.id === 1, 'result 1');
    first.worker.send({
      type: 'call',
      id: 2,
      method: 'scripts.run',
      args: ['16_Поиск форматирования\\52_Перейти на следующую цитату.js', { count: 3 }],
    });
    const second = await h.startedWorker(1);
    expect(second.context).toMatchObject({
      script: { id: '16/next-cite' },
      startedBy: 'script',
      caller: '31/combo',
      args: { count: 3 },
    });
    second.worker.send(APPEND(1, 'from the callee'));
    await second.worker.waitFor((m) => m.type === 'result' && m.id === 1, 'callee result');
    second.worker.send({ type: 'done', value: { found: 42 } });
    const value = await first.worker.waitFor((m) => m.type === 'result' && m.id === 2, 'result 2');
    expect((value as { value: unknown }).value).toEqual({ found: 42 });
    expect(second.worker.terminated).toBe(1);
    first.worker.send({ type: 'done' });
    await expect(done).resolves.toMatchObject({ status: 'done' });
    expect(paragraphTexts(h.store)).toEqual(['Hello', 'from the combo', 'from the callee']);
    // One undo step for the whole chain, under the root's label.
    expect(h.services.undo.undoDepth).toBe(1);
    expect(h.services.undo.peekUndo()?.label).toBe('Combo');
    h.services.undo.undo();
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
  });

  it('an unknown reference and a failing callee reject in the caller, which may go on', async () => {
    const failing = script('16/fails');
    const h = await chainHarness([root, failing]);
    const done = h.run(root);
    const first = await h.startedWorker(0);
    first.worker.send({ type: 'call', id: 1, method: 'scripts.run', args: ['16/nope'] });
    const notFound = await first.worker.waitFor((m) => m.type === 'error' && m.id === 1, 'error 1');
    expect(notFound).toMatchObject({ code: 'scripts.notFound' });
    first.worker.send({ type: 'call', id: 2, method: 'scripts.run', args: ['16/fails'] });
    const second = await h.startedWorker(1);
    second.worker.send({
      type: 'fail',
      error: { name: 'TypeError', message: 'x is not a function' },
    });
    const failed = await first.worker.waitFor((m) => m.type === 'error' && m.id === 2, 'error 2');
    expect((failed as { message: string }).message).toContain('x is not a function');
    first.worker.send({ type: 'done' });
    await expect(done).resolves.toMatchObject({ status: 'done' });
  });

  it('runs at most 8 scripts deep', async () => {
    const chain = Array.from({ length: 10 }, (_, i) => script(`99/level-${i}`));
    const h = await chainHarness(chain);
    const done = h.run(chain[0]!);
    let current = await h.startedWorker(0);
    for (let depth = 1; depth <= 8; depth += 1) {
      current.worker.send({
        type: 'call',
        id: 1,
        method: 'scripts.run',
        args: [`99/level-${depth}`],
      });
      current = await h.startedWorker(depth);
    }
    // The script at depth 8 may run no other.
    current.worker.send({ type: 'call', id: 1, method: 'scripts.run', args: ['99/level-9'] });
    const refused = await current.worker.waitFor(
      (m) => m.type === 'error' && m.id === 1,
      'depth error',
    );
    expect(refused).toMatchObject({ code: 'scripts.depthExceeded' });
    expect((refused as { message: string }).message).toContain('at most 8');
    expect(h.workers).toHaveLength(9);
    h.host.cancel();
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('Cancel stops every script of the chain and restores the document', async () => {
    const h = await chainHarness([root, callee]);
    const done = h.run(root);
    const first = await h.startedWorker(0);
    first.worker.send(APPEND(1, 'from the combo'));
    await first.worker.waitFor((m) => m.type === 'result' && m.id === 1, 'result 1');
    first.worker.send({ type: 'call', id: 2, method: 'scripts.run', args: ['16/next-cite'] });
    const second = await h.startedWorker(1);
    second.worker.send(APPEND(1, 'from the callee'));
    await second.worker.waitFor((m) => m.type === 'result' && m.id === 1, 'callee result');
    h.host.cancel();
    await expect(done).resolves.toMatchObject({ status: 'cancelled' });
    expect(first.worker.terminated).toBe(1);
    expect(second.worker.terminated).toBe(1);
    expect(paragraphTexts(h.store)).toEqual(['Hello']);
    expect(h.services.undo.undoDepth).toBe(0);
  });

  it('a callee that needs a selection is refused without one', async () => {
    const needy = script('16/needs-selection', { needsSelection: true });
    const h = await chainHarness([root, needy]);
    const done = h.run(root);
    const first = await h.startedWorker(0);
    first.worker.send({ type: 'call', id: 1, method: 'scripts.run', args: ['16/needs-selection'] });
    const refused = await first.worker.waitFor((m) => m.type === 'error' && m.id === 1, 'error');
    expect(refused).toMatchObject({ code: 'scripts.needsSelection' });
    first.worker.send({ type: 'done' });
    await done;
  });
});
