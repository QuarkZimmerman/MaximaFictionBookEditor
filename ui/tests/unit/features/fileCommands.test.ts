import type { ValidationReport } from '@/model/document';
import {
  FileFeature,
  defaultSaveEncoding,
  documentFilters,
  registerFileCommands,
  saveAsEncodingChoices,
  saveAsSelectedType,
  sourceOnlyDocument,
} from '@/features/file/fileCommands';
import { actions } from '@/model/store';
import {
  commitPendingSource,
  setSourceOnlyText,
  sourceSession,
  updateSourceText,
} from '@/views/source/sourceSession';
import type { Settings } from '@/rpc/types';

import {
  CLEAN_REPORT,
  createCommandRegistry,
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  makeContext,
  rpcError,
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
      templateFolder: '',
      askOnNonClearImage: true,
      insertClearImages: false,
      pasteImageFormat: 'jpeg',
      jpegQuality: 90,
      nbspDisplayChar: '\u00B0',
      ...other,
    },
    words: { showExclusionsInWordsDialog: false },
    session: {
      windowGeometry: null,
      toolbars: { commands: true, scripts: true, links: true, table: true, status: true },
      treeVisible: true,
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
    'doc.caret': {},
    'doc.recent': [],
    ...responses,
  });
  const dialogs = fakeDialogs(...answers);
  return { registry, feature, rpc, dialogs };
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

  it('Open: native dialog, doc.open, watch, recent refresh and caret restore', async () => {
    const document = fakeDocument();
    const { feature, rpc, dialogs } = setup({
      'dialog.openFile': { paths: ['/books/alpha.fb2'] },
      'doc.open': { document, warnings: [] },
      'doc.recent': [{ path: '/books/alpha.fb2', lastOpened: 'now' }],
      'doc.caret': (params: { caret?: unknown }) =>
        params.caret ? {} : { caret: { view: 'body', nodeId: 'n3', offset: 2 } },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setConnection(ctx.store, 'connected');
    const setCaret = vi.fn(() => true);
    ctx.carets!.register('body', { get: () => null, set: setCaret });

    expect(await feature.openWithDialog(ctx)).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toEqual([
      'dialog.openFile',
      'doc.open',
      'doc.watch',
      'doc.recent',
      'doc.caret',
    ]);
    expect(rpc.calls[0]!.params).toEqual({
      title: 'Open',
      filters: [
        { name: 'FictionBook files (*.fb2)', extensions: ['fb2'] },
        { name: 'FictionBook descriptors (*.fbd)', extensions: ['fbd'] },
        { name: 'All files (*.*)', extensions: ['*'] },
      ],
      selectedFilter: 0,
    });
    expect(ctx.store.getState()).toMatchObject({
      docId: 'doc-1',
      path: '/books/alpha.fb2',
      modified: false,
      sourceOnly: false,
      activeView: 'body',
    });
    await vi.waitFor(() =>
      expect(setCaret).toHaveBeenCalledWith({ view: 'body', nodeId: 'n3', offset: 2 }),
    );
    expect(feature.recent.files).toHaveLength(1);
    expect(dialogs.shown).toEqual([]);
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
      encodingChoices: [
        'windows-1251',
        'utf-8',
        'utf-16',
        'windows-1252',
        'iso-8859-1',
        'iso-8859-2',
        'iso-8859-5',
        'iso-8859-15',
        'koi8-r',
      ],
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
    // A document never saved: no file proposed, FictionBook files selected.
    actions.setDocument(ctx.store, fakeDocument({ path: undefined }));

    expect(await feature.saveDocument(ctx, { saveAs: true })).toBe(true);
    const dialog = rpc.calls.find((c) => c.method === 'dialog.saveFile')!;
    expect(dialog.params).not.toHaveProperty('defaultPath', expect.anything());
    expect(dialog.params).toMatchObject({ selectedFilter: 0 });
    expect((dialog.params as { encodingChoices: string[] }).encodingChoices[0]).toBe('utf-8');
    expect(dialogs.custom).toEqual([]);
    expect(rpc.calls.find((c) => c.method === 'doc.save')!.params).toMatchObject({
      path: '/books/new.fb2',
      encoding: 'koi8-r',
    });
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

  it('?new=1 creates a blank document at start-up; helpers build filters and placeholders', async () => {
    const { feature, rpc } = setup({
      'doc.new': fakeDocument({ docId: 'doc-7', path: undefined }),
    });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    await feature.handleStartup(ctx, '?token=abc');
    expect(ctx.store.getState().document).toBeNull();
    await feature.handleStartup(ctx, '?new=1&token=abc');
    expect(ctx.store.getState().docId).toBe('doc-7');

    expect(documentFilters(ctx).map((f) => f.extensions)).toEqual([['fb2'], ['fbd'], ['*']]);
    expect(saveAsSelectedType('fb2')).toBe(0);
    expect(saveAsSelectedType(null)).toBe(0);
    expect(saveAsSelectedType('fbd')).toBe(1);
    expect(saveAsSelectedType('xml')).toBe(2);
    expect(saveAsEncodingChoices('utf-8').slice(0, 3)).toEqual(['utf-8', 'utf-16', 'windows-1251']);
    expect(saveAsEncodingChoices('koi8-r')).toHaveLength(9);
    expect(saveAsEncodingChoices('koi8-r')[0]).toBe('koi8-r');
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
