import type { CommandContext, CommandRegistry } from '@/app/commands';
import { installBodyEditor } from '@/features/editing';
import type { ValidationReport } from '@/model/document';
import {
  FileFeature,
  defaultSaveEncoding,
  documentFilters,
  leaveDocument,
  registerFileCommands,
  saveAsSelectedType,
  sourceOnlyDocument,
} from '@/features/file/fileCommands';
import { registerSettingsRuntime } from '@/features/settings/apply';
import { actions, isRunLocked } from '@/model/store';
import {
  commitPendingSource,
  setSourceOnlyText,
  sourceSession,
  updateSourceText,
} from '@/views/source/sourceSession';
import type { MessageButtonId, Settings } from '@/rpc/types';

import { mergeSettings } from '../settings/fixtures';

import {
  CLEAN_REPORT,
  createCommandRegistry,
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  fakeRunLock,
  flowCalls,
  makeContext,
  rpcError,
  type FakeRpc,
} from './testUtils';

const settings = (other: Partial<Settings['other']>): Settings =>
  ({
    schemaVersion: 1,
    view: {} as Settings['view'],
    other: {
      defaultEncoding: 'utf-8',
      keepEncoding: false,
      restorePosition: true,
      scriptsFolder: '',
      genresFolder: '',
      dictionariesFolder: '',
      templateFolder: '',
      askOnNonClearImage: true,
      insertClearImages: false,
      pasteImageFormat: 'jpeg',
      jpegQuality: 90,
      nbspDisplayChar: '\u00B0',
      versionCheck: 'monthly',
      switchKeyboardLayout: false,
      keyboardLayoutId: '',
      keyboardLayoutName: '',
      ...other,
    },
    words: { showExclusionsInWordsDialog: false },
    session: {
      windowGeometry: null,
      toolbars: { commands: true, scripts: true, links: true, table: true, status: true },
      treeVisible: true,
      treeWidth: 260,
      findHistory: [],
      replaceHistory: [],
      toolbarLayouts: {},
      lastFileDialogFolder: '',
    },
  }) as Settings;

function setup(
  responses: Record<string, unknown> = {},
  answers: Parameters<typeof fakeDialogs> = [],
) {
  const registry = createCommandRegistry();
  const feature = registerFileCommands(registry, { selfSaveGraceMs: 0 });
  const rpc = fakeRpc({
    'doc.watch': {},
    'doc.close': {},
    'doc.position': {},
    'doc.recent': [],
    ...responses,
  });
  const dialogs = fakeDialogs(...answers);
  return { registry, feature, rpc, dialogs };
}

/**
 * The Body controller of `ctx` (feature 004 US8: the remembered position is the Body
 * controller's caret, read whatever the active view), installed as the editing feature does.
 */
function withBodyEditor(ctx: CommandContext, registry: CommandRegistry, rpc: FakeRpc) {
  return installBodyEditor({
    commands: registry,
    rpc: rpc.client,
    undo: ctx.undo,
    carets: ctx.carets!,
    store: ctx.store,
    hotkeys: ctx.hotkeys,
  });
}

/** The `doc.position` calls of a flow (`params.position` present = a remember, absent = a get). */
function positionCalls(rpc: FakeRpc): unknown[] {
  return rpc.calls.filter((c) => c.method === 'doc.position').map((c) => c.params);
}

describe('file flows (T052)', () => {
  it('replaces the stub commands and keeps their ids, icons and enable rules', async () => {
    const { registry } = setup();
    const ctx = await makeContext();
    for (const id of [
      'file.new',
      'file.open',
      'file.save',
      'file.saveAs',
      'file.validate',
      'file.exit',
    ]) {
      expect(registry.get(id)?.stub).toBeUndefined();
    }
    expect(registry.get('file.new')?.icon).toBe('id_file_new');
    expect(registry.isEnabled('file.new', ctx)).toBe(false); // no core
    expect(registry.isEnabled('file.exit', ctx)).toBe(true);
  });

  it('Open: native dialog, doc.open, watch, recent refresh and the position restored', async () => {
    const document = fakeDocument();
    const { feature, rpc, dialogs, registry } = setup({
      'dialog.openFile': { paths: ['/books/alpha.fb2'] },
      'doc.open': { document, warnings: [] },
      'doc.recent': [{ path: '/books/alpha.fb2', lastOpened: 'now' }],
      'doc.position': (params: { position?: unknown }) =>
        params.position ? {} : { position: { path: 'body[1]/section[1]/p[1]', offset: 2 } },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    const controller = withBodyEditor(ctx, registry, rpc);
    actions.setActiveView(ctx.store, 'description');

    expect(await feature.openWithDialog(ctx)).toBe(true);
    expect(flowCalls(rpc).map((c) => c.method)).toEqual([
      'dialog.openFile',
      'doc.open',
      'doc.watch',
      'doc.recent',
      'doc.position',
    ]);
    expect(flowCalls(rpc)[0]!.params).toEqual({
      title: 'Open',
      filters: [
        { name: 'FictionBook files (*.fb2)', extensions: ['fb2'] },
        { name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] },
        { name: 'All files (*.*)', extensions: ['*'] },
      ],
      selectedFilter: 0,
    });
    // The view a file opens in follows the rule of 0.0.3 (the active view is kept unless it is
    // the Source view); the remembered caret is placed in the Body controller without a view
    // switch and shows in the status bar path (FR-101).
    expect(ctx.store.getState()).toMatchObject({
      docId: 'doc-1',
      path: '/books/alpha.fb2',
      modified: false,
      sourceOnly: false,
      activeView: 'description',
    });
    await vi.waitFor(() =>
      expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n3', offset: 2 }),
    );
    expect(ctx.store.getState().selectionPath).toBe('body[1]/section[1]/p[1]');
    expect(feature.recent.files).toHaveLength(1);
    expect(dialogs.shown).toEqual([]);
  });

  /**
   * The leaving routes of FR-100 remember the Body caret of a document with a file as a
   * structural path through `doc.position` (feature 004 US8): File > New, Open, every save
   * (under the saved path), Exit / the window's close request and the restart share
   * `leaveDocument`; a never-saved document and a Body view never shown remember nothing.
   */
  describe('Restore position - the leaving routes (feature 004 US8)', () => {
    async function openWithCaret(responses: Record<string, unknown> = {}) {
      const document = fakeDocument();
      const { feature, rpc, dialogs, registry } = setup({
        'doc.open': { document, warnings: [] },
        'doc.new': fakeDocument({ docId: 'doc-2', path: undefined }),
        'app.quit': {},
        ...responses,
      });
      const ctx = await makeContext({ rpc: rpc.client, dialogs });
      actions.setConnection(ctx.store, 'connected');
      const controller = withBodyEditor(ctx, registry, rpc);
      expect(await feature.openDocument(ctx, '/books/alpha.fb2')).toBe(true);
      expect(controller.setCaret({ view: 'body', nodeId: 'n3', offset: 3 })).toBe(true);
      rpc.calls.length = 0;
      return { ctx, feature, rpc, controller, dialogs };
    }
    const remembered = { docId: 'doc-1', position: { path: 'body[1]/section[1]/p[1]', offset: 3 } };

    it('File > New remembers before the document is closed', async () => {
      const { ctx, feature, rpc } = await openWithCaret();
      expect(await feature.newDocument(ctx)).toBe(true);
      const methods = flowCalls(rpc).map((c) => c.method);
      expect(methods.indexOf('doc.position')).toBeGreaterThanOrEqual(0);
      expect(methods.indexOf('doc.position')).toBeLessThan(methods.indexOf('doc.close'));
      expect(positionCalls(rpc)[0]).toEqual(remembered);
    });

    it('opening another file remembers the one that is left, from any view', async () => {
      const { ctx, feature, rpc } = await openWithCaret();
      actions.setActiveView(ctx.store, 'description');
      expect(await feature.openDocument(ctx, '/books/beta.fb2')).toBe(true);
      const methods = flowCalls(rpc).map((c) => c.method);
      expect(methods.slice(0, 3)).toEqual(['doc.position', 'doc.watch', 'doc.close']);
      expect(positionCalls(rpc)[0]).toEqual(remembered);
      // ... and asks for the new document's position after the open (a get, no view switch).
      expect(positionCalls(rpc)[1]).toEqual({ docId: 'doc-1' });
      expect(ctx.store.getState().activeView).toBe('description');
    });

    it('every save remembers under the saved path, after the write', async () => {
      const { ctx, feature, rpc } = await openWithCaret({
        'doc.save': (params: { path: string }) => ({
          path: params.path,
          encoding: 'utf-8',
          converted: [],
          validation: CLEAN_REPORT,
        }),
        'dialog.saveFile': { path: '/books/renamed.fb2', encoding: 'utf-8' },
      });
      expect(await feature.saveDocument(ctx, {})).toBe(true);
      let methods = flowCalls(rpc).map((c) => c.method);
      expect(methods.indexOf('doc.save')).toBeLessThan(methods.indexOf('doc.position'));
      expect(positionCalls(rpc)).toEqual([remembered]);
      expect(methods).not.toContain('doc.close');
      rpc.calls.length = 0;
      // Save As: the core records under the session's new path; the UI remembers again.
      expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(true);
      methods = flowCalls(rpc).map((c) => c.method);
      expect(methods.indexOf('doc.save')).toBeLessThan(methods.indexOf('doc.position'));
      expect(ctx.store.getState().path).toBe('/books/renamed.fb2');
      expect(positionCalls(rpc)).toEqual([remembered]);
    });

    it('Exit and the window-close request remember before app.quit', async () => {
      const { ctx, feature, rpc } = await openWithCaret();
      await feature.exitApplication(ctx);
      let methods = flowCalls(rpc).map((c) => c.method);
      expect(methods.indexOf('doc.position')).toBeLessThan(methods.indexOf('app.quit'));
      expect(positionCalls(rpc)).toEqual([remembered]);
      rpc.calls.length = 0;
      await feature.handleCloseRequested(ctx);
      methods = flowCalls(rpc).map((c) => c.method);
      expect(methods.indexOf('doc.position')).toBeLessThan(methods.indexOf('app.quit'));
      expect(rpc.calls.find((c) => c.method === 'app.quit')?.params).toEqual({ force: true });
    });

    it('leaveDocument (the restart) remembers and stops watching; nothing for a never-saved document', async () => {
      const { ctx, rpc, controller } = await openWithCaret();
      await leaveDocument(ctx);
      expect(flowCalls(rpc).map((c) => c.method)).toEqual(['doc.position', 'doc.watch']);
      expect(positionCalls(rpc)).toEqual([remembered]);
      expect(rpc.calls.find((c) => c.method === 'doc.watch')?.params).toEqual({
        docId: 'doc-1',
        enabled: false,
      });
      rpc.calls.length = 0;
      // A never-saved document: no position; a Body view never shown: the record stays.
      actions.setDocument(ctx.store, fakeDocument({ docId: 'doc-3', path: undefined }));
      controller.setCaret({ view: 'body', nodeId: 'n3', offset: 1 });
      await leaveDocument(ctx);
      expect(positionCalls(rpc)).toEqual([]);
      actions.setDocument(ctx.store, fakeDocument({ docId: 'doc-4', path: '/books/gamma.fb2' }));
      await leaveDocument(ctx);
      expect(positionCalls(rpc)).toEqual([]);
      // The setting off: nothing either.
      controller.setCaret({ view: 'body', nodeId: 'n3', offset: 1 });
      ctx.store.setState({ settings: settings({ restorePosition: false }) });
      await leaveDocument(ctx);
      expect(positionCalls(rpc)).toEqual([]);
    });

    it('the changed-on-disk reload keeps the view and the in-session caret, even with the setting off', async () => {
      const { ctx, feature, rpc, controller, dialogs } = await openWithCaret();
      ctx.store.setState({ settings: settings({ restorePosition: false }) });
      actions.setActiveView(ctx.store, 'description');
      dialogs.messageAnswers.push('yes');
      await feature.handleChangedOnDisk(ctx, 'doc-1', '/books/alpha.fb2');
      expect(dialogs.shown.map((m) => m.testId)).toEqual(['dialog-file-changed']);
      // Reloaded: the caret where it was, the view untouched, no record consulted.
      expect(flowCalls(rpc).map((c) => c.method)).toContain('doc.open');
      expect(positionCalls(rpc)).toEqual([]);
      expect(ctx.store.getState().activeView).toBe('description');
      await vi.waitFor(() =>
        expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n3', offset: 3 }),
      );
    });
  });

  it('Open: a cancelled dialog does nothing; an I/O error shows "Cannot open"', async () => {
    const { feature, rpc, dialogs } = setup({
      'dialog.openFile': { paths: [] },
      'doc.open': rpcError(1002, 'io', { path: '/missing.fb2', reason: 'No such file' }),
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    expect(await feature.openWithDialog(ctx)).toBe(false);
    expect(rpc.calls.map((c) => c.method)).toEqual(['dialog.openFile']);

    expect(await feature.openDocument(ctx, '/missing.fb2')).toBe(false);
    expect(dialogs.shown[0]).toMatchObject({ testId: 'dialog-open-failed', icon: 'error' });
    expect(dialogs.shown[0]!.text).toContain('Cannot open /missing.fb2');
    expect(dialogs.shown[0]!.text).toContain('No such file');
    expect(ctx.store.getState().document).toBeNull();
    expect(ctx.store.getState().progress).toBeNull();
  });

  it('Open: a file that is not a FictionBook document is refused with a message', async () => {
    const { feature, rpc, dialogs } = setup({
      'doc.open': rpcError(1004, 'doc.notFictionBook', { path: '/notes.txt', reason: 'notXml' }),
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    expect(await feature.openDocument(ctx, '/notes.txt')).toBe(false);
    expect(dialogs.shown[0]).toMatchObject({ testId: 'dialog-not-fictionbook', icon: 'error' });
    expect(dialogs.shown[0]!.text).toContain('/notes.txt');
    expect(dialogs.shown[0]!.text).toContain('not a FictionBook');
    // No Source-only fallback: the raw text is never requested.
    expect(rpc.calls.map((c) => c.method)).not.toContain('doc.openSource');
    expect(ctx.store.getState().document).toBeNull();
  });

  it('Open: malformed XML reports line/column and opens the raw text in Source-only mode', async () => {
    const { feature, rpc, dialogs } = setup({
      'doc.open': rpcError(1001, 'parse', { line: 20, column: 3, message: 'mismatch' }),
      'doc.openSource': {
        docId: 'doc-9',
        text: '<FictionBook><p>broken</FictionBook>',
        encoding: 'utf-8',
        error: { line: 20, column: 3, message: 'mismatch' },
      },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    expect(await feature.openDocument(ctx, '/books/bad.fb2')).toBe(true);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'dialog-parse-error',
      caption: 'XML Parse Error',
    });
    expect(dialogs.shown[0]!.text).toBe('At bad.fb2, line 20, column 3: mismatch');
    const state = ctx.store.getState();
    expect(state).toMatchObject({
      docId: 'doc-9',
      sourceOnly: true,
      activeView: 'source',
      fileKind: 'fb2',
      sourceParseError: { line: 20, column: 3, message: 'mismatch' },
    });
    expect(state.document?.schemaHint).toBe('unknown');
    expect(sourceSession(ctx.store).text).toBe('<FictionBook><p>broken</FictionBook>');
    expect(sourceSession(ctx.store).pendingCaret).toEqual({ line: 20, column: 3 });
    expect(rpc.calls.map((c) => c.method)).toContain('doc.watch');
  });

  it('Save: plain save sends the explicit encoding (default / keep) and marks the document clean', async () => {
    const { feature, rpc } = setup({
      'doc.save': (params: { encoding?: string; path?: string }) => ({
        path: params.path,
        encoding: params.encoding,
        converted: [],
        validation: CLEAN_REPORT,
      }),
    });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    actions.setSettings(ctx.store, settings({ defaultEncoding: 'utf-8', keepEncoding: false }));
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);

    expect(await feature.saveDocument(ctx, {})).toBe(true);
    const save = rpc.calls.find((c) => c.method === 'doc.save')!;
    expect(save.params).toMatchObject({
      docId: 'doc-1',
      path: '/books/alpha.fb2',
      encoding: 'utf-8',
      force: false,
    });
    expect((save.params as { document: unknown }).document).toBeDefined();
    expect(ctx.store.getState()).toMatchObject({
      modified: false,
      statusMessage: 'Document saved - No errors found.',
    });
    expect(ctx.store.getState().document?.sourceEncoding).toBe('utf-8');

    actions.setSettings(ctx.store, settings({ keepEncoding: true }));
    actions.setDocument(ctx.store, fakeDocument({ sourceEncoding: 'koi8-r' }));
    expect(defaultSaveEncoding(ctx.store)).toBe('koi8-r');
    await feature.saveDocument(ctx, {});
    expect(rpc.calls.filter((c) => c.method === 'doc.save').pop()!.params).toMatchObject({
      encoding: 'koi8-r',
    });
  });

  it('Save As: the document kind selected, the Save encoding first, the chooser when the dialog gives none', async () => {
    const { feature, rpc, dialogs } = setup({
      'dialog.saveFile': { path: '/books/out.fbd' },
      'doc.save': (params: { encoding?: string; path?: string }) => ({
        path: params.path,
        encoding: params.encoding,
        converted: [],
        validation: CLEAN_REPORT,
      }),
    });
    dialogs.customAnswers.push('windows-1252');
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setSettings(ctx.store, settings({ keepEncoding: true }));
    actions.setDocument(ctx.store, fakeDocument({ fileKind: 'fbd', path: '/books/alpha.fbd' }));

    expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(true);
    const dialog = rpc.calls.find((c) => c.method === 'dialog.saveFile')!;
    expect(dialog.params).toMatchObject({
      defaultPath: '/books/alpha.fbd',
      filters: [{ extensions: ['fb2'] }, { extensions: ['fbd'] }, { extensions: ['*'] }],
      selectedFilter: 1,
      // The original's list in its order, "Keep encoding" selecting the file's encoding.
      encodingChoices: [
        'utf-8',
        'utf-16',
        'windows-1251',
        'windows-1252',
        'iso-8859-1',
        'iso-8859-2',
        'iso-8859-5',
        'iso-8859-15',
        'koi8-r',
      ],
      selectedEncoding: 'windows-1251',
      encodingLabel: 'Encoding:',
    });
    expect(dialogs.custom[0]).toMatchObject({
      name: 'EncodingDialog',
      props: { defaultEncoding: 'windows-1251', path: '/books/out.fbd' },
    });
    expect(rpc.calls.find((c) => c.method === 'doc.save')!.params).toMatchObject({
      path: '/books/out.fbd',
      encoding: 'windows-1252',
    });
    expect(ctx.store.getState()).toMatchObject({
      path: '/books/out.fbd',
      fileKind: 'fbd',
      modified: false,
    });

    // Cancelling the chooser cancels the save.
    dialogs.customAnswers.push(null);
    const before = rpc.calls.length;
    expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(false);
    expect(rpc.calls.slice(before).map((c) => c.method)).toEqual(['dialog.saveFile']);
  });

  it('Save As: the encoding chosen inside the native dialog is used without the chooser', async () => {
    const { feature, rpc, dialogs } = setup({
      'dialog.saveFile': { path: '/books/new.fb2', encoding: 'KOI8-R' },
      'doc.save': (params: { encoding?: string; path?: string }) => ({
        path: params.path,
        encoding: params.encoding,
        converted: [],
        validation: CLEAN_REPORT,
      }),
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setSettings(ctx.store, settings({ defaultEncoding: 'utf-8', keepEncoding: false }));
    // A document never saved: the name composed from its description proposed (feature 004,
    // FR-050), FictionBook files selected.
    actions.setDocument(ctx.store, fakeDocument({ path: undefined }));

    expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(true);
    const dialog = rpc.calls.find((c) => c.method === 'dialog.saveFile')!;
    expect(dialog.params).toMatchObject({
      defaultPath: 'Petrov Ivan - Alpha.fb2',
      selectedFilter: 0,
    });
    expect(dialog.params).toMatchObject({ selectedEncoding: 'utf-8', encodingLabel: 'Encoding:' });
    expect((dialog.params as { encodingChoices: string[] }).encodingChoices[0]).toBe('utf-8');
    expect(dialogs.custom).toEqual([]);
    expect(rpc.calls.find((c) => c.method === 'doc.save')!.params).toMatchObject({
      path: '/books/new.fb2',
      encoding: 'koi8-r',
    });
  });

  it('Save As: a never-saved document proposes the bare "Last First - Title" with the selected type\'s extension, a saved one its full path (feature 004, FR-050, FR-053)', async () => {
    const { feature, rpc, dialogs } = setup({
      'dialog.saveFile': {},
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setSettings(ctx.store, settings({}));
    const defaultPathOf = async (): Promise<unknown> => {
      const before = rpc.calls.length;
      expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(false);
      const dialog = rpc.calls.slice(before).find((c) => c.method === 'dialog.saveFile')!;
      return (dialog.params as { defaultPath?: unknown }).defaultPath;
    };

    // Never saved: the bare name in the book's own letters - no folder, so the dialog opens
    // in the folder it remembers; the middle name is never used.
    const description = fakeDocument().description;
    actions.setDocument(
      ctx.store,
      fakeDocument({
        path: undefined,
        description: {
          ...description,
          titleInfo: {
            ...description.titleInfo,
            authors: [
              {
                lastName: 'Толстой',
                firstName: 'Лев',
                middleName: 'Николаевич',
                homePages: [],
                emails: [],
              },
            ],
            bookTitle: 'Война и мир',
          },
        },
      }),
    );
    expect(await defaultPathOf()).toBe('Толстой Лев - Война и мир.fb2');

    // Neither title nor author: the interface language's "Untitled" (English here).
    actions.setDocument(
      ctx.store,
      fakeDocument({
        path: undefined,
        description: {
          ...description,
          titleInfo: {
            ...description.titleInfo,
            authors: [{ homePages: [], emails: [] }],
            bookTitle: '',
          },
        },
      }),
    );
    expect(await defaultPathOf()).toBe('Untitled.fb2');

    // A saved document: its own path, whatever the description says.
    actions.setDocument(ctx.store, fakeDocument({ path: '/books/alpha.fb2' }));
    expect(await defaultPathOf()).toBe('/books/alpha.fb2');
    actions.setDocument(
      ctx.store,
      fakeDocument({ path: 'C:\\Книги\\Война и мир.fbd', fileKind: 'fbd' }),
    );
    expect(await defaultPathOf()).toBe('C:\\Книги\\Война и мир.fbd');
  });

  it('Save: validation failure asks "Do you still want to save" and retries with force', async () => {
    const report: ValidationReport = { issues: [], errorCount: 2, warningCount: 0, durationMs: 1 };
    const { feature, rpc, dialogs } = setup({
      'doc.save': (params: { force?: boolean; path?: string }) =>
        params.force
          ? { path: params.path, encoding: 'utf-8', converted: [], validation: report }
          : { needsConfirmation: true, validation: report },
    });
    dialogs.messageAnswers.push('no', 'yes');
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);

    expect(await feature.saveDocument(ctx, {})).toBe(false);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'dialog-validation-failed',
      buttons: 'yesNo',
    });
    expect(dialogs.shown[0]!.text).toContain('2 errors found.');
    expect(dialogs.shown[0]!.text).toContain('Do you still want to save the file?');
    expect(ctx.store.getState().modified).toBe(true);

    expect(await feature.saveDocument(ctx, {})).toBe(true);
    const saves = rpc.calls.filter((c) => c.method === 'doc.save');
    expect(saves.map((c) => (c.params as { force: boolean }).force)).toEqual([false, false, true]);
    expect(ctx.store.getState()).toMatchObject({
      modified: false,
      statusMessage: '2 errors found.',
    });
  });

  it('Save: an I/O error shows "Cannot save" and keeps the document modified', async () => {
    const { feature, rpc, dialogs } = setup({
      'doc.save': rpcError(1002, 'io', { path: '/books/alpha.fb2', reason: 'Disk full' }),
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);
    expect(await feature.saveDocument(ctx, {})).toBe(false);
    expect(dialogs.shown[0]).toMatchObject({ testId: 'dialog-save-failed', icon: 'error' });
    expect(dialogs.shown[0]!.text).toBe('Cannot save /books/alpha.fb2.\nDisk full');
    expect(ctx.store.getState().modified).toBe(true);
    expect(ctx.store.getState().progress).toBeNull();
  });

  it('Save: pending Source text is parsed first; malformed text refuses the save', async () => {
    const parsed = fakeDocument({ docId: 'doc-1' });
    const { feature, rpc, dialogs } = setup({
      'doc.fromXml': (params: { text: string }) =>
        params.text.includes('broken')
          ? rpcError(1001, 'parse', { line: 2, column: 5, message: 'not closed' })
          : { document: parsed },
      'doc.save': {
        path: '/books/alpha.fb2',
        encoding: 'utf-8',
        converted: [],
        validation: CLEAN_REPORT,
      },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    sourceSession(ctx.store).docId = 'doc-1';
    sourceSession(ctx.store).baseline = '<ok/>';
    updateSourceText(ctx.store, '<broken>');
    expect(ctx.store.getState()).toMatchObject({ sourceDirty: true, modified: true });

    expect(await feature.saveDocument(ctx, {})).toBe(false);
    expect(rpc.calls.map((c) => c.method)).toEqual(['doc.fromXml']);
    expect(dialogs.shown[0]).toMatchObject({ testId: 'dialog-bad-xml' });
    expect(dialogs.shown[0]!.text).toContain('You have opened an invalid XML document.');
    expect(ctx.store.getState().sourceParseError).toEqual({
      line: 2,
      column: 5,
      message: 'not closed',
    });
    expect(ctx.store.getState().statusMessage).toBe('At Source, line 2, column 5: not closed');

    updateSourceText(ctx.store, '<ok><fixed/></ok>');
    expect(await feature.saveDocument(ctx, {})).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toEqual([
      'doc.fromXml',
      'doc.fromXml',
      'doc.save',
      'doc.watch',
      'doc.recent',
    ]);
    expect(ctx.store.getState()).toMatchObject({
      sourceDirty: false,
      sourceParseError: null,
      modified: false,
    });
  });

  it('New / Exit: "Save changes to X?" honours Cancel, No and Yes', async () => {
    const { feature, rpc, dialogs } = setup({
      'doc.new': fakeDocument({ docId: 'doc-2', path: undefined }),
      'doc.save': {
        path: '/books/alpha.fb2',
        encoding: 'utf-8',
        converted: [],
        validation: CLEAN_REPORT,
      },
      'app.quit': {},
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setModified(ctx.store, true);

    dialogs.customAnswers.push('cancel');
    expect(await feature.newDocument(ctx)).toBe(false);
    expect(dialogs.custom[0]).toMatchObject({
      name: 'SaveChangesPrompt',
      props: { name: 'alpha.fb2' },
    });
    expect(ctx.store.getState().docId).toBe('doc-1');

    dialogs.customAnswers.push('cancel');
    await feature.exitApplication(ctx);
    expect(rpc.calls.map((c) => c.method)).not.toContain('app.quit');

    dialogs.customAnswers.push('yes');
    expect(await feature.newDocument(ctx)).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(['doc.save', 'doc.close', 'doc.new']),
    );
    expect(ctx.store.getState()).toMatchObject({ docId: 'doc-2', path: null, modified: false });
    expect(document.title).toBeDefined();

    actions.setModified(ctx.store, true);
    dialogs.customAnswers.push('no');
    await feature.exitApplication(ctx);
    expect(rpc.calls.map((c) => c.method)).toContain('app.quit');
  });

  it('doc.changedOnDisk asks to reload (not right after our own save) and app.openPaths opens the file', async () => {
    const reloaded = fakeDocument({ docId: 'doc-5' });
    const { feature, rpc, dialogs } = setup({
      'doc.open': { document: reloaded, warnings: [] },
    });
    dialogs.messageAnswers.push('no', 'yes');
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    const off = feature.subscribeNotifications(rpc.client, () => ctx);

    rpc.notify('doc.changedOnDisk', { docId: 'other', path: '/x', mtime: '' });
    await Promise.resolve();
    expect(dialogs.shown).toHaveLength(0);

    rpc.notify('doc.changedOnDisk', { docId: 'doc-1', path: '/books/alpha.fb2', mtime: '' });
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(1));
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'dialog-file-changed',
      caption: 'File changed',
    });
    expect(dialogs.shown[0]!.text).toBe(
      'alpha.fb2 has been changed by another application.\nDo you want to reload it?',
    );
    await vi.waitFor(() => expect(ctx.store.getState().docId).toBe('doc-1'));

    rpc.notify('doc.changedOnDisk', { docId: 'doc-1', path: '/books/alpha.fb2', mtime: '' });
    await vi.waitFor(() => expect(ctx.store.getState().docId).toBe('doc-5'));
    expect(rpc.calls.filter((c) => c.method === 'doc.open')).toHaveLength(1);

    dialogs.customAnswers.push('no');
    actions.setModified(ctx.store, true);
    rpc.notify('app.openPaths', { paths: ['/books/beta.fb2'] });
    await vi.waitFor(() =>
      expect(rpc.calls.filter((c) => c.method === 'doc.open').pop()!.params).toEqual({
        path: '/books/beta.fb2',
      }),
    );
    off();
  });

  it('Validate uses the document (or the pending Source text) and shows the panel', async () => {
    const report: ValidationReport = {
      issues: [
        {
          severity: 'error',
          code: 'validation.schema',
          params: { element: 'p', detail: 'x' },
          line: 3,
          column: 1,
        },
      ],
      errorCount: 1,
      warningCount: 0,
      durationMs: 2,
    };
    const { feature, rpc } = setup({ 'doc.validate': report });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    expect(await feature.validateDocument(ctx)).toBe(report);
    expect(rpc.calls[0]!.params).toMatchObject({ docId: 'doc-1', document: expect.anything() });
    expect(ctx.store.getState()).toMatchObject({
      validation: report,
      statusMessage: '1 error found.',
    });

    setSourceOnlyText(ctx.store, 'doc-1', '<broken>');
    ctx.store.setState({ sourceOnly: true });
    await feature.validateDocument(ctx);
    expect(rpc.calls[1]!.params).toEqual({ docId: 'doc-1', text: '<broken>' });
  });

  it('start-up: a new document from the template, not marked modified by the filled-in details', async () => {
    const { feature, rpc } = setup({
      'app.info': {},
      'doc.new': {
        ...fakeDocument({ docId: 'doc-7', path: undefined }),
        filledIn: ['documentInfo.id', 'documentInfo.version'],
      },
    });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    await feature.handleStartup(ctx);
    expect(ctx.store.getState()).toMatchObject({ docId: 'doc-7', modified: false });
    expect(ctx.store.getState().document).not.toHaveProperty('filledIn');

    expect(documentFilters(ctx).map((f) => f.extensions)).toEqual([['fb2'], ['fbd'], ['*']]);
    expect(saveAsSelectedType('fb2')).toBe(0);
    expect(saveAsSelectedType(null)).toBe(0);
    expect(saveAsSelectedType('fbd')).toBe(1);
    expect(saveAsSelectedType('xml')).toBe(2);
    const stub = sourceOnlyDocument('doc-x', '/a/b.fbd', 'koi8-r');
    expect(stub).toMatchObject({
      docId: 'doc-x',
      path: '/a/b.fbd',
      fileKind: 'fbd',
      sourceEncoding: 'koi8-r',
      schemaHint: 'unknown',
    });
    expect(stub.bodies).toEqual([]);
  });

  it('start-up: a file that cannot be opened is reported, then a new document is shown', async () => {
    const { feature, rpc, dialogs } = setup({
      'app.info': {},
      'doc.open': rpcError(1002, 'doc.ioError', {
        path: '/books/missing.fb2',
        reason: 'file not found',
      }),
      'doc.new': fakeDocument({ docId: 'doc-8', path: undefined }),
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    const off = feature.subscribeNotifications(rpc.client, () => ctx);
    rpc.notify('app.openPaths', { paths: ['/books/missing.fb2'] });
    await feature.handleStartup(ctx);
    off();
    expect(dialogs.shown.map((m) => m.testId)).toEqual(['dialog-open-failed']);
    expect(ctx.store.getState()).toMatchObject({ docId: 'doc-8', modified: false });
  });

  it('start-up: ?open=<path> (the browser-mode restart) opens the document before anything else', async () => {
    const { feature, rpc } = setup({
      'app.info': {},
      'doc.open': {
        document: fakeDocument({ docId: 'doc-20', path: '/books/again.fb2' }),
        warnings: [],
      },
      'doc.watch': {},
      'doc.new': fakeDocument({ docId: 'doc-21', path: undefined }),
    });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    await feature.handleStartup(ctx, '/books/again.fb2');
    expect(ctx.store.getState()).toMatchObject({ docId: 'doc-20', path: '/books/again.fb2' });
    const methods = rpc.calls.map((c) => c.method);
    expect(methods[0]).toBe('doc.open');
    expect(rpc.calls[0]!.params).toEqual({ path: '/books/again.fb2' });
    expect(methods).not.toContain('doc.new');

    // A document that cannot be opened any more: reported, then the usual start (template).
    const failing = setup({
      'app.info': {},
      'doc.open': rpcError(1002, 'doc.ioError', { path: '/books/gone.fb2', reason: 'missing' }),
      'doc.new': fakeDocument({ docId: 'doc-22', path: undefined }),
    });
    const ctx2 = await makeContext({ rpc: failing.rpc.client, dialogs: failing.dialogs });
    actions.setConnection(ctx2.store, 'connected');
    await failing.feature.handleStartup(ctx2, '/books/gone.fb2');
    expect(failing.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-open-failed']);
    expect(ctx2.store.getState()).toMatchObject({ docId: 'doc-22', modified: false });
  });

  it('start-up: a malformed file opens in the Source view, without a new document', async () => {
    const { feature, rpc, dialogs } = setup({
      'app.info': {},
      'doc.open': rpcError(1001, 'doc.parseError', { line: 2, column: 3, message: 'mismatch' }),
      'doc.openSource': { docId: 'doc-9', text: '<FictionBook>', encoding: 'utf-8' },
      'doc.new': fakeDocument({ docId: 'doc-10', path: undefined }),
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    const off = feature.subscribeNotifications(rpc.client, () => ctx);
    rpc.notify('app.openPaths', { paths: ['/books/broken.fb2'] });
    await feature.handleStartup(ctx);
    off();
    expect(ctx.store.getState()).toMatchObject({ docId: 'doc-9', sourceOnly: true });
    expect(rpc.calls.map((c) => c.method)).not.toContain('doc.new');
  });

  it('File > New names a user template that could not be used', async () => {
    const { feature, rpc, dialogs } = setup({
      'doc.new': {
        ...fakeDocument({ docId: 'doc-11', path: undefined }),
        templateIssue: { path: '/data/blank.fb2', reason: 'notWellFormed', detail: 'mismatch' },
      },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    expect(await feature.newDocument(ctx)).toBe(true);
    expect(ctx.store.getState().document).not.toHaveProperty('templateIssue');
    expect(dialogs.shown.at(-1)).toMatchObject({
      testId: 'dialog-template-issue',
      text: 'The template /data/blank.fb2 cannot be used: it is not well-formed XML. The built-in template was used for the new document.',
    });
  });

  it('commitPendingSource replaces the model after a successful parse and clears the Body history', async () => {
    const parsed = fakeDocument({ docId: 'doc-1', bodies: [] });
    const rpc = fakeRpc({ 'doc.fromXml': { document: parsed } });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setDocument(ctx.store, fakeDocument());
    expect(await commitPendingSource(ctx)).toBe('clean');
    setSourceOnlyText(ctx.store, 'doc-1', '<a/>');
    ctx.store.setState({ sourceOnly: true, activeView: 'source' });
    expect(await commitPendingSource(ctx)).toBe('committed');
    expect(ctx.store.getState()).toMatchObject({
      sourceOnly: false,
      sourceDirty: false,
      modified: false,
    });
    expect(ctx.store.getState().document).toBe(parsed);
    expect(sourceSession(ctx.store).baseline).toBe('<a/>');
    expect(new FileFeature(createCommandRegistry()).recent.files).toEqual([]);
  });
});

/**
 * The keyboard layout switch when a document is opened (feature 004 US11, FR-091, SC-011): one
 * `system.activateKeyboardLayout({id})` per document opened by any route - the start-up
 * document, File > New, Open, Recent Files, a forwarded file (`app.openPaths`), the `?open=`
 * restart, the changed-on-disk reload, a malformed file in the Source view, the new document
 * after a failed start-up open - none with the option off or without a chosen layout, never
 * from the Settings dialog; the answer and any error are swallowed.
 */
describe('Keyboard layout on open (feature 004 US11)', () => {
  const RUSSIAN_ON = {
    switchKeyboardLayout: true,
    keyboardLayoutId: 'test-ru',
    keyboardLayoutName: 'Russian',
  };

  const switches = (rpc: FakeRpc) =>
    rpc.calls.filter((c) => c.method === 'system.activateKeyboardLayout').map((c) => c.params);

  async function layoutSetup(
    other: Partial<Settings['other']>,
    responses: Record<string, unknown> = {},
  ) {
    const { registry, feature, rpc, dialogs } = setup({
      'app.info': {},
      'doc.open': { document: fakeDocument(), warnings: [] },
      'doc.new': fakeDocument({ docId: 'doc-2', path: undefined }),
      'system.activateKeyboardLayout': { activated: true },
      ...responses,
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setSettings(ctx.store, settings(other));
    return { registry, feature, rpc, dialogs, ctx };
  }

  it('makes exactly one request per open route with the option on', async () => {
    const { registry, feature, rpc, ctx } = await layoutSetup(RUSSIAN_ON, {
      'dialog.openFile': { paths: ['/books/alpha.fb2'] },
      'doc.recent': [{ path: '/books/alpha.fb2', lastOpened: 'now' }],
    });
    // The start-up document.
    await feature.handleStartup(ctx);
    await vi.waitFor(() => expect(switches(rpc)).toEqual([{ id: 'test-ru' }]));
    // File > New.
    expect(await feature.newDocument(ctx)).toBe(true);
    await vi.waitFor(() => expect(switches(rpc)).toHaveLength(2));
    // Open through the dialog.
    expect(await feature.openWithDialog(ctx)).toBe(true);
    await vi.waitFor(() => expect(switches(rpc)).toHaveLength(3));
    // Recent Files (the submenu's command of the first entry).
    await vi.waitFor(() => expect(feature.recent.files).toHaveLength(1));
    await registry.get('file.recent1')!.run(ctx);
    await vi.waitFor(() => expect(switches(rpc)).toHaveLength(4));
    // A forwarded file (the command line, a double-click, a dropped file: app.openPaths).
    const off = feature.subscribeNotifications(rpc.client, () => ctx);
    rpc.notify('app.openPaths', { paths: ['/books/beta.fb2'] });
    await vi.waitFor(() => expect(switches(rpc)).toHaveLength(5));
    off();
    // The changed-on-disk reload answered Yes.
    ctx.dialogs.messageAnswers.push('yes');
    await feature.handleChangedOnDisk(ctx, 'doc-1', '/books/beta.fb2');
    await vi.waitFor(() => expect(switches(rpc)).toHaveLength(6));
    expect(switches(rpc).every((params) => (params as { id: string }).id === 'test-ru')).toBe(true);
    // Nothing else of the flow changed: every open still watches, lists and restores.
    expect(rpc.calls.filter((c) => c.method === 'doc.open')).toHaveLength(4);
  });

  it('the ?open= restart, a malformed file in the Source view and the new document after a failed start-up open each count', async () => {
    const restart = await layoutSetup(RUSSIAN_ON);
    await restart.feature.handleStartup(restart.ctx, '/books/again.fb2');
    await vi.waitFor(() => expect(switches(restart.rpc)).toEqual([{ id: 'test-ru' }]));

    const malformed = await layoutSetup(RUSSIAN_ON, {
      'doc.open': rpcError(1001, 'doc.parseError', { line: 2, column: 3, message: 'mismatch' }),
      'doc.openSource': { docId: 'doc-9', text: '<FictionBook>', encoding: 'utf-8' },
    });
    expect(await malformed.feature.openDocument(malformed.ctx, '/books/broken.fb2')).toBe(true);
    expect(malformed.ctx.store.getState().sourceOnly).toBe(true);
    await vi.waitFor(() => expect(switches(malformed.rpc)).toEqual([{ id: 'test-ru' }]));

    const failed = await layoutSetup(RUSSIAN_ON, {
      'doc.open': rpcError(1002, 'doc.ioError', { path: '/books/missing.fb2', reason: 'gone' }),
    });
    const off = failed.feature.subscribeNotifications(failed.rpc.client, () => failed.ctx);
    failed.rpc.notify('app.openPaths', { paths: ['/books/missing.fb2'] });
    await failed.feature.handleStartup(failed.ctx);
    off();
    expect(failed.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-open-failed']);
    expect(failed.ctx.store.getState().docId).toBe('doc-2');
    // The failed open made no request; the new document shown instead made one.
    await vi.waitFor(() => expect(switches(failed.rpc)).toEqual([{ id: 'test-ru' }]));
  });

  it('makes no request with the option off or without a chosen layout', async () => {
    const off = await layoutSetup({ ...RUSSIAN_ON, switchKeyboardLayout: false });
    await off.feature.handleStartup(off.ctx);
    expect(await off.feature.newDocument(off.ctx)).toBe(true);
    expect(await off.feature.openDocument(off.ctx, '/books/alpha.fb2')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switches(off.rpc)).toEqual([]);

    const noId = await layoutSetup({ switchKeyboardLayout: true, keyboardLayoutId: '' });
    expect(await noId.feature.openDocument(noId.ctx, '/books/alpha.fb2')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switches(noId.rpc)).toEqual([]);
  });

  it('waits for the settings of a start-up open and gives up quietly when they do not come', async () => {
    // The file named on the command line opens before settings.get answered (research R5.1 H6):
    // the request is made as soon as the settings arrive, once.
    const { feature, rpc, ctx } = await layoutSetup(RUSSIAN_ON);
    ctx.store.setState({ settings: null });
    expect(await feature.openDocument(ctx, '/books/alpha.fb2')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switches(rpc)).toEqual([]);
    actions.setSettings(ctx.store, settings(RUSSIAN_ON));
    await vi.waitFor(() => expect(switches(rpc)).toEqual([{ id: 'test-ru' }]));
    // A later settings change opens nothing: the subscription ended with the first answer.
    actions.setSettings(ctx.store, settings(RUSSIAN_ON));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(switches(rpc)).toHaveLength(1);
  });

  it('swallows the answer and any error: a missing layout, a refusal, an older core', async () => {
    for (const answer of [
      { activated: false, reason: 'notInstalled' },
      { activated: false, reason: 'refused' },
      rpcError(-32601, 'Method not found'),
    ]) {
      const { feature, rpc, ctx, dialogs } = await layoutSetup(RUSSIAN_ON, {
        'system.activateKeyboardLayout': answer,
      });
      expect(await feature.openDocument(ctx, '/books/alpha.fb2')).toBe(true);
      await vi.waitFor(() => expect(switches(rpc)).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(dialogs.shown).toEqual([]);
      expect(ctx.store.getState()).toMatchObject({ docId: 'doc-1', statusMessage: null });
    }
  });
});

describe('Exit and window close while a script runs (feature 003 FR-013)', () => {
  /** A quit flow started while the run lock is held; the fake "host" ends the run on cancel. */
  async function runningSetup() {
    const { registry, feature, rpc, dialogs } = setup({ 'app.quit': {} });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    actions.setRunLock(ctx.store, fakeRunLock());
    return { registry, feature, rpc, dialogs, ctx };
  }

  const methods = (rpc: ReturnType<typeof fakeRpc>) => rpc.calls.map((c) => c.method);

  it('keeps Exit available while every file command is blocked', async () => {
    const { registry, ctx } = await runningSetup();
    expect(registry.get('file.exit')?.duringScriptRun).toBe('allowed');
    expect(registry.isEnabled('file.exit', ctx)).toBe(true);
    for (const id of ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.validate']) {
      expect(registry.isEnabled(id, ctx), id).toBe(false);
    }
  });

  it('Exit: "A script is running. Cancel it and exit?" - No keeps the run and the editor', async () => {
    const { feature, rpc, dialogs, ctx } = await runningSetup();
    actions.setModified(ctx.store, true);
    dialogs.messageAnswers.push('no');
    await feature.exitApplication(ctx);
    expect(dialogs.shown).toHaveLength(1);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'cancel-run-prompt',
      buttons: 'yesNo',
      icon: 'question',
      text: 'A script is running. Cancel it and exit?',
    });
    expect(dialogs.custom).toHaveLength(0); // no save prompt
    expect(isRunLocked(ctx.store.getState())).toBe(true);
    expect(methods(rpc)).not.toContain('app.quit');
  });

  it('Exit: Yes waits for the run to end, then the usual save prompt follows', async () => {
    const { feature, rpc, dialogs, ctx } = await runningSetup();
    actions.setModified(ctx.store, true);
    dialogs.messageAnswers.push('yes');
    // No script host in this test: the run "ends" when the flag drops (as the host does on
    // cancel, restoring the document first).
    dialogs.customAnswers.push('cancel');
    const exiting = feature.exitApplication(ctx);
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(1));
    expect(dialogs.custom).toHaveLength(0); // the save prompt waits for the run to end
    actions.setRunLock(ctx.store, null);
    await exiting;
    expect(dialogs.custom[0]).toMatchObject({
      name: 'SaveChangesPrompt',
      props: { name: 'alpha.fb2' },
    });
    expect(methods(rpc)).not.toContain('app.quit'); // Cancel in the save prompt abandons Exit

    // A clean document: Yes cancels the run and quits without a save prompt.
    actions.setModified(ctx.store, false);
    actions.setRunLock(ctx.store, fakeRunLock());
    dialogs.messageAnswers.push('yes');
    const quitting = feature.exitApplication(ctx);
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(2));
    actions.setRunLock(ctx.store, null);
    await quitting;
    expect(dialogs.custom).toHaveLength(1);
    expect(rpc.calls.filter((c) => c.method === 'app.quit')).toEqual([
      { method: 'app.quit', params: {} },
    ]);
  });

  it('Exit without a running script shows no cancel-run prompt', async () => {
    const { feature, rpc, dialogs, ctx } = await runningSetup();
    actions.setRunLock(ctx.store, null);
    await feature.exitApplication(ctx);
    expect(dialogs.shown).toHaveLength(0);
    expect(methods(rpc)).toContain('app.quit');
  });

  it('Exit writes a pending session save before app.quit (feature 004 US1, FR-003)', async () => {
    let current = settings({});
    const { feature, rpc, dialogs } = setup({
      'app.quit': {},
      'settings.set': (params: unknown) => {
        current = mergeSettings(current, (params as { patch: unknown }).patch);
        return { settings: current, restartRequired: false };
      },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    actions.setDocument(ctx.store, fakeDocument());
    const runtime = registerSettingsRuntime({ store: ctx.store, hotkeys: ctx.hotkeys });
    actions.setSettings(ctx.store, current);
    await runtime.attach(rpc.client);

    // The divider was dragged a moment ago; the delayed save has not gone out yet.
    actions.setTreeWidth(ctx.store, 388);
    await feature.exitApplication(ctx);
    const order = methods(rpc).filter((m) => m === 'settings.set' || m === 'app.quit');
    expect(order).toEqual(['settings.set', 'app.quit']);
    expect(rpc.calls.find((c) => c.method === 'settings.set')!.params).toEqual({
      patch: { session: { treeWidth: 388 } },
    });
    expect(current.session.treeWidth).toBe(388);
  });

  it('app.closeRequested runs the same flow and ends in app.quit({force: true})', async () => {
    const { feature, rpc, dialogs, ctx } = await runningSetup();
    actions.setModified(ctx.store, true);
    const off = feature.subscribeNotifications(rpc.client, () => ctx);

    // No: nothing closes, the run goes on.
    dialogs.messageAnswers.push('no');
    rpc.notify('app.closeRequested', {});
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(1));
    expect(dialogs.shown[0]!.testId).toBe('cancel-run-prompt');
    await new Promise((resolve) => setTimeout(resolve, 0)); // the declined flow has ended
    expect(isRunLocked(ctx.store.getState())).toBe(true);
    expect(methods(rpc)).not.toContain('app.quit');

    // Yes, then Don't save: the shell is told to close for real.
    dialogs.messageAnswers.push('yes');
    dialogs.customAnswers.push('no');
    rpc.notify('app.closeRequested', {});
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(2));
    actions.setRunLock(ctx.store, null);
    await vi.waitFor(() =>
      expect(rpc.calls.filter((c) => c.method === 'app.quit')).toEqual([
        { method: 'app.quit', params: { force: true } },
      ]),
    );
    expect(dialogs.custom).toHaveLength(1);
    off();
  });

  it('a second close request while the prompts are up is ignored', async () => {
    const { feature, rpc, dialogs, ctx } = await runningSetup();
    const off = feature.subscribeNotifications(rpc.client, () => ctx);
    const prompt: { answer?: (button: MessageButtonId) => void } = {};
    dialogs.showMessage = (options) => {
      dialogs.shown.push(options);
      return new Promise((resolve) => {
        prompt.answer = resolve;
      });
    };
    rpc.notify('app.closeRequested', {});
    rpc.notify('app.closeRequested', {});
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialogs.shown).toHaveLength(1);
    prompt.answer?.('no');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(methods(rpc)).not.toContain('app.quit');
    // Answered: the next request asks again.
    rpc.notify('app.closeRequested', {});
    await vi.waitFor(() => expect(dialogs.shown).toHaveLength(2));
    prompt.answer?.('no');
    off();
  });
});
