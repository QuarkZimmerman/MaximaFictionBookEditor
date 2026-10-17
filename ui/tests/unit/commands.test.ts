import { createInstance } from 'i18next';

import {
  COMMAND_GROUPS,
  CommandRegistry,
  commandDescription,
  commandLabel,
  commandLabelRaw,
  commandTooltip,
  confirmDiscardChanges,
  createCommandRegistry,
  scriptCommandId,
  switchView,
  symbolCommandId,
  type Command,
  type CommandContext,
} from '@/app/commands';
import { DEFAULT_HOTKEYS, HotkeyMap } from '@/app/hotkeys';
import type { Dialogs, MessageBoxOptions } from '@/dialogs/types';
import { initI18n } from '@/i18n';
import en from '@/i18n/en.json';
import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { ArrayHistoryAdapter, UndoCoordinator } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import type { MessageButtonId } from '@/rpc/types';

function fakeDocument(): Document {
  return {
    modelVersion: 1,
    docId: 'doc-1',
    path: '/books/alpha.fb2',
    fileKind: 'fb2',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    stylesheets: [],
    description: {
      titleInfo: {
        genres: [],
        authors: [],
        bookTitle: 'Alpha',
        coverpage: [],
        lang: 'en',
        translators: [],
        sequences: [],
      },
      documentInfo: {
        authors: [],
        date: { text: '2026' },
        srcUrls: [],
        id: 'id',
        version: '1.0',
        publishers: [],
      },
      customInfo: [],
      outputs: [],
    },
    bodies: [],
    binaries: [],
    extras: [],
  };
}

interface FakeRpc {
  calls: { method: string; params: unknown }[];
  responses: Record<string, unknown>;
  client: RpcClient;
}

function fakeRpc(responses: Record<string, unknown> = {}): FakeRpc {
  const calls: { method: string; params: unknown }[] = [];
  const respond = (method: string, params: unknown) => {
    calls.push({ method, params });
    const response = responses[method];
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(typeof response === 'function' ? response(params) : response);
  };
  const client = {
    call: respond,
    runJob: respond,
    status: 'connected',
  } as unknown as RpcClient;
  return { calls, responses, client };
}

function fakeDialogs(
  answers: MessageButtonId[] = ['ok'],
): Dialogs & { shown: MessageBoxOptions[] } {
  const shown: MessageBoxOptions[] = [];
  const queue = [...answers];
  return {
    shown,
    showMessage: (options) => {
      shown.push(options);
      return Promise.resolve(queue.shift() ?? 'ok');
    },
    showMessageWithResult: (options) => {
      shown.push(options);
      return Promise.resolve({ button: queue.shift() ?? 'ok', dontAskAgain: false });
    },
    showInput: () => Promise.resolve({ button: 'cancel', value: '' }),
    openCustom: () => Promise.reject(new Error('no custom dialogs in this test')),
  };
}

async function makeContext(overrides: Partial<CommandContext> = {}): Promise<CommandContext> {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  return {
    store: createAppStore(),
    rpc: null,
    undo: new UndoCoordinator(),
    dialogs: fakeDialogs(),
    hotkeys: new HotkeyMap('linux'),
    t: i18n.t,
    version: '0.1.0-test',
    ...overrides,
  };
}

function hasKey(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    const record = node as Record<string, unknown>;
    if (part in record) {
      node = record[part];
    } else if (`${part}_one` in record && `${part}_other` in record) {
      return true; // plural family
    } else {
      return false;
    }
  }
  return typeof node === 'string';
}

describe('command registry', () => {
  it('registers the complete FBE command set with stable ids', () => {
    const registry = createCommandRegistry();
    const ids = registry.all().map((c) => c.id);
    for (const id of [
      'file.new',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.validate',
      'file.exit',
      'edit.undo',
      'edit.redo',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.find',
      'edit.findNext',
      'edit.replace',
      'edit.gotoFootnote',
      'edit.gotoMatchTag',
      'edit.gotoWrongTag',
      'edit.clone',
      'edit.split',
      'edit.merge',
      'edit.removeOuter',
      'view.toolbarCommands',
      'view.toolbarScripts',
      'view.linksBar',
      'view.tableBar',
      'view.statusBar',
      'view.tree',
      'view.description',
      'view.body',
      'view.source',
      'view.fastMode',
      'insert.body',
      'insert.title',
      'insert.epigraph',
      'insert.annotation',
      'insert.textAuthor',
      'insert.image',
      'insert.inlineImage',
      'insert.poem',
      'insert.cite',
      'insert.table',
      'insert.sectionImage',
      'insert.binary',
      'style.normal',
      'style.textAuthor',
      'style.subtitle',
      'style.link',
      'style.footnote',
      'style.removeLink',
      'style.strong',
      'style.emphasis',
      'style.strikethrough',
      'style.sub',
      'style.sup',
      'style.code',
      'tools.words',
      'tools.settings',
      'tools.spellcheck',
      'scripts.last',
      'help.about',
      'source.collapse1',
      'source.expand9',
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(symbolCommandId(3)).toBe('symbol.3');
    expect(scriptCommandId('fbe.case.upper')).toBe('script.fbe.case.upper');
    for (const command of registry.all()) expect(COMMAND_GROUPS).toContain(command.group);
  });

  it('every label/tooltip/description key exists in en.json and every default hotkey targets a command', () => {
    const registry = createCommandRegistry();
    for (const command of registry.all()) {
      if (command.labelKey) expect(hasKey(command.labelKey), command.labelKey).toBe(true);
      if (command.tooltipKey) expect(hasKey(command.tooltipKey), command.tooltipKey).toBe(true);
      if (command.descriptionKey) {
        expect(hasKey(command.descriptionKey), command.descriptionKey).toBe(true);
      }
    }
    for (const { commandId } of DEFAULT_HOTKEYS) {
      expect(registry.has(commandId), commandId).toBe(true);
    }
  });

  it('resolves labels, tooltips and descriptions through i18n', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    const saveAs = registry.get('file.saveAs')!;
    expect(commandLabelRaw(saveAs, ctx.t)).toBe('Save &As...');
    expect(commandLabel(saveAs, ctx.t)).toBe('Save As...');
    expect(commandTooltip(saveAs, ctx.t)).toBe('Save As');
    expect(commandDescription(saveAs, ctx.t)).toBe('Save the active document with a new name');
    const collapse = registry.get('source.collapse3')!;
    expect(commandTooltip(collapse, ctx.t)).toBe('Collapse 3 tree levels');
    expect(commandLabel(collapse, ctx.t)).toBe('Collapse 3 tree levels');
    const dynamic: Command = {
      id: 'symbol.1',
      group: 'symbols',
      label: 'Non-breaking space',
      run: () => {},
    };
    expect(commandLabel(dynamic, ctx.t)).toBe('Non-breaking space');
    expect(commandTooltip(dynamic, ctx.t)).toBe('Non-breaking space');
  });

  it('computes enable and checked states from the context', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    expect(registry.isEnabled('file.new', ctx)).toBe(false); // no core
    expect(registry.isEnabled('edit.undo', ctx)).toBe(false); // nothing to undo
    expect(registry.isEnabled('edit.cut', ctx)).toBe(false); // stub
    expect(registry.isEnabled('view.body', ctx)).toBe(true);
    expect(registry.isChecked('view.body', ctx)).toBe(true);
    expect(registry.isChecked('view.source', ctx)).toBe(false);
    expect(registry.isChecked('view.statusBar', ctx)).toBe(true);
    expect(registry.isChecked('view.tree', ctx)).toBe(true);

    const rpc = fakeRpc();
    const connected = await makeContext({ rpc: rpc.client });
    actions.setConnection(connected.store, 'connected');
    expect(registry.isEnabled('file.new', connected)).toBe(true);
    expect(registry.isEnabled('file.save', connected)).toBe(false); // no document
    actions.setDocument(connected.store, fakeDocument());
    expect(registry.isEnabled('file.save', connected)).toBe(true);
    expect(registry.isEnabled('unknown.command', connected)).toBe(false);
  });

  it('view commands switch the view, record an undo boundary and respect Source-only mode', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    const boundary = vi.spyOn(ctx.undo, 'boundary');
    expect(await registry.execute('view.source', ctx)).toBe(true);
    expect(ctx.store.getState().activeView).toBe('source');
    expect(boundary).toHaveBeenCalledWith('source');
    switchView(ctx, 'source'); // no-op when already active
    expect(boundary).toHaveBeenCalledTimes(1);

    actions.setDocument(ctx.store, fakeDocument(), { sourceOnly: true });
    expect(registry.isEnabled('view.body', ctx)).toBe(false);
    expect(registry.isEnabled('view.description', ctx)).toBe(false);
    expect(registry.isEnabled('view.source', ctx)).toBe(true);
  });

  it('toggle commands flip store flags and report checked state', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    await registry.execute('view.linksBar', ctx);
    expect(ctx.store.getState().toolbars.links).toBe(false);
    expect(registry.isChecked('view.linksBar', ctx)).toBe(false);
    await registry.execute('view.tree', ctx);
    expect(ctx.store.getState().treeVisible).toBe(false);
    await registry.execute('view.fastMode', ctx);
    expect(registry.isChecked('view.fastMode', ctx)).toBe(true);
  });

  it('edit.undo / edit.redo drive the undo coordinator', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    const adapter = new ArrayHistoryAdapter<string>();
    ctx.undo.registerView('body', adapter);
    adapter.push('x');
    ctx.undo.record('body', 'typing');
    expect(registry.isEnabled('edit.undo', ctx)).toBe(true);
    expect(await registry.execute('edit.undo', ctx)).toBe(true);
    expect(ctx.undo.canUndo).toBe(false);
    expect(registry.isEnabled('edit.redo', ctx)).toBe(true);
    await registry.execute('edit.redo', ctx);
    expect(ctx.undo.canUndo).toBe(true);
  });

  it('file.new asks to save changes and loads the new document from the core', async () => {
    const newDoc = { ...fakeDocument(), docId: 'doc-2', path: undefined };
    const rpc = fakeRpc({ 'doc.new': newDoc });
    const dialogs = fakeDialogs(['no']);
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);
    const registry = createCommandRegistry();

    expect(await registry.execute('file.new', ctx)).toBe(true);
    expect(dialogs.shown[0]).toMatchObject({
      text: 'Save changes to alpha.fb2?',
      buttons: 'yesNoCancel',
    });
    expect(rpc.calls.map((c) => c.method)).toEqual(['doc.new']);
    expect(ctx.store.getState()).toMatchObject({ docId: 'doc-2', path: null, modified: false });
  });

  it('confirmDiscardChanges honours Cancel and saves on Yes', async () => {
    const rpc = fakeRpc({
      'doc.save': {
        path: '/books/alpha.fb2',
        encoding: 'utf-8',
        converted: [],
        validation: { issues: [], errorCount: 0, warningCount: 0, durationMs: 1 },
      },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs: fakeDialogs(['cancel', 'yes']) });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);
    expect(await confirmDiscardChanges(ctx)).toBe(false);
    expect(await confirmDiscardChanges(ctx)).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toEqual(['doc.save']);
    expect(ctx.store.getState().modified).toBe(false);
    expect(ctx.store.getState().statusMessage).toBe('Document saved - No errors found.');
    actions.setModified(ctx.store, false);
    expect(await confirmDiscardChanges(ctx)).toBe(true); // nothing to ask
  });

  it('file.open uses the native dialog, reports failures and clears progress', async () => {
    const error = Object.assign(new Error('ENOENT'), { code: 1002 });
    const rpc = fakeRpc({
      'dialog.openFile': { paths: ['/missing.fb2'] },
      'doc.open': error,
    });
    const dialogs = fakeDialogs();
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    const registry = createCommandRegistry();
    await registry.execute('file.open', ctx);
    expect(rpc.calls.map((c) => c.method)).toEqual(['dialog.openFile', 'doc.open']);
    expect(dialogs.shown[0]?.text).toContain('Cannot open /missing.fb2');
    expect(ctx.store.getState().progress).toBeNull();
  });

  it('file.save prompts when validation fails and forces the save on Yes', async () => {
    let attempt = 0;
    const rpc = fakeRpc({
      'doc.save': (params: { force?: boolean }) => {
        attempt += 1;
        if (!params.force) {
          return {
            needsConfirmation: true,
            validation: { issues: [], errorCount: 2, warningCount: 0, durationMs: 1 },
          };
        }
        return {
          path: '/books/alpha.fb2',
          encoding: 'utf-8',
          converted: [],
          validation: { issues: [], errorCount: 2, warningCount: 0, durationMs: 1 },
        };
      },
    });
    const dialogs = fakeDialogs(['yes']);
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);
    const registry = createCommandRegistry();
    await registry.execute('file.save', ctx);
    expect(attempt).toBe(2);
    expect(dialogs.shown[0]).toMatchObject({ caption: 'Validation failed', buttons: 'yesNo' });
    expect(dialogs.shown[0]?.text).toContain('2 errors found.');
    expect(ctx.store.getState().modified).toBe(false);
    expect(ctx.store.getState().statusMessage).toBe('2 errors found.');
  });

  it('help.about shows the product name and version', async () => {
    const dialogs = fakeDialogs();
    const ctx = await makeContext({ dialogs });
    const registry = createCommandRegistry();
    await registry.execute('help.about', ctx);
    expect(dialogs.shown[0]?.text).toContain('Maxima Fiction Book Editor');
    expect(dialogs.shown[0]?.text).toContain('Version 0.1.0-test');
  });

  it('reports command errors to the user and to the core log', async () => {
    const rpc = fakeRpc({ 'log.error': {} });
    const dialogs = fakeDialogs();
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    const registry = new CommandRegistry();
    registry.register({
      id: 'test.fail',
      group: 'tools',
      run: () => {
        throw new Error('kaboom');
      },
    });
    expect(await registry.execute('test.fail', ctx)).toBe(true);
    expect(dialogs.shown[0]).toMatchObject({ text: 'kaboom', caption: 'Error', icon: 'error' });
    expect(rpc.calls[0]).toMatchObject({
      method: 'log.error',
      params: { source: 'ui', code: 'command.test.fail', message: 'kaboom' },
    });
  });

  it('supports replace/unregister and notifies subscribers', () => {
    const registry = createCommandRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    expect(() => registry.register({ id: 'file.new', group: 'file', run: () => {} })).toThrow(
      /already registered/,
    );
    registry.replace({ id: 'edit.cut', group: 'edit', run: () => {} });
    expect(registry.get('edit.cut')?.stub).toBeUndefined();
    const off = registry.register({
      id: 'symbol.1',
      group: 'symbols',
      label: 'NBSP',
      run: () => {},
    });
    expect(registry.byGroup('symbols')).toHaveLength(1);
    off();
    expect(registry.has('symbol.1')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('dispatch() accepts enabled commands synchronously for keyboard handling', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    expect(registry.dispatch('view.source', ctx)).toBe(true);
    expect(registry.dispatch('edit.cut', ctx)).toBe(false);
    await Promise.resolve();
    expect(ctx.store.getState().activeView).toBe('source');
  });

  it('blocks a command while a script runs unless its policy allows it', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    let selectionAvailable = true;
    registry.register({
      id: 'test.copy',
      group: 'edit',
      duringScriptRun: 'allowed',
      enabled: () => selectionAvailable,
      run: () => {},
    });
    registry.register({
      id: 'test.replace',
      group: 'edit',
      duringScriptRun: 'blocked',
      run: () => {},
    });
    registry.register({
      id: 'test.later',
      group: 'edit',
      duringScriptRun: 'allowed',
      stub: true,
      run: () => {},
    });
    expect(registry.isEnabled('view.source', ctx)).toBe(true);
    expect(registry.isEnabled('test.copy', ctx)).toBe(true);
    expect(registry.isEnabled('test.replace', ctx)).toBe(true);

    actions.setScriptRunning(ctx.store, true);
    expect(registry.isEnabled('view.source', ctx)).toBe(false); // default policy: blocked
    expect(registry.isEnabled('test.replace', ctx)).toBe(false);
    expect(registry.isEnabled('test.copy', ctx)).toBe(true);
    selectionAvailable = false;
    expect(registry.isEnabled('test.copy', ctx)).toBe(false); // its own predicate still counts
    selectionAvailable = true;
    expect(registry.isEnabled('test.later', ctx)).toBe(false); // a stub is never enabled

    actions.setScriptRunning(ctx.store, false);
    expect(registry.isEnabled('view.source', ctx)).toBe(true);
    expect(registry.isEnabled('test.replace', ctx)).toBe(true);
    expect(registry.isEnabled('test.later', ctx)).toBe(false);
  });

  it('execute() and dispatch() refuse a blocked command during a run and accept an allowed one', async () => {
    const ctx = await makeContext();
    const registry = createCommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'test.copy', group: 'edit', duringScriptRun: 'allowed', run });
    actions.setScriptRunning(ctx.store, true);

    expect(await registry.execute('view.source', ctx)).toBe(false);
    expect(registry.dispatch('view.source', ctx)).toBe(false);
    await Promise.resolve();
    expect(ctx.store.getState().activeView).toBe('body');

    expect(await registry.execute('test.copy', ctx)).toBe(true);
    expect(registry.dispatch('test.copy', ctx)).toBe(true);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);

    actions.setScriptRunning(ctx.store, false);
    expect(await registry.execute('view.source', ctx)).toBe(true);
    expect(ctx.store.getState().activeView).toBe('source');
  });

  it('refresh() notifies the subscribers so the run policies are re-evaluated', () => {
    const registry = createCommandRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.all().length).toBeGreaterThan(0); // the set of commands is untouched
  });
});
