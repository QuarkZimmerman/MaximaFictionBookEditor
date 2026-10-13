import { createInstance } from 'i18next';

import { createCommandRegistry } from '@/app/commands';
import { ENCODING_CHOICES, normalizeEncoding } from '@/dialogs/encodings';
import {
  confirmSaveWithErrors,
  createIssueNavigator,
  issueMessage,
  issueMessageKey,
} from '@/dialogs/validation';
import {
  RecentFilesStore,
  applyCaret,
  recentCommandId,
  recentLabel,
  rememberCaret,
  restoreCaret,
} from '@/features/file/recent';
import { initI18n } from '@/i18n';
import type { ValidationIssue } from '@/model/document';
import { actions } from '@/model/store';
import { requestViewSwitch } from '@/views/source/sourceSession';

import {
  CLEAN_REPORT,
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  makeContext,
  rpcError,
} from './testUtils';

describe('Recent Files (T054)', () => {
  it('registers numbered commands, greys missing files and builds the submenu items', async () => {
    const registry = createCommandRegistry();
    const open = vi.fn(async () => true);
    const store = new RecentFilesStore(registry, open);
    const listener = vi.fn();
    store.subscribe(listener);
    const rpc = fakeRpc({
      'doc.clearRecent': {},
      'doc.recent': [
        { path: '/books/a.fb2', lastOpened: '2026-10-12T00:00:00Z' },
        { path: '/books/missing.fb2', lastOpened: '2026-10-11T00:00:00Z', exists: false },
      ],
    });
    await store.refresh(rpc.client);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.files).toHaveLength(2);
    expect(store.menuItems()).toEqual([
      { kind: 'command', commandId: 'file.recent1' },
      { kind: 'command', commandId: 'file.recent2' },
    ]);
    expect(recentCommandId(0)).toBe('file.recent1');
    expect(recentLabel(store.files[1]!, 1)).toBe('2. /books/missing.fb2');
    expect(registry.get('file.recent1')?.label).toBe('1. /books/a.fb2');

    const ctx = await makeContext({ rpc: rpc.client });
    actions.setConnection(ctx.store, 'connected');
    expect(registry.isEnabled('file.recent1', ctx)).toBe(true);
    expect(registry.isEnabled('file.recent2', ctx)).toBe(false); // missing file is greyed
    await registry.execute('file.recent1', ctx);
    expect(open).toHaveBeenCalledWith(ctx, '/books/a.fb2');

    // A shorter list unregisters the stale commands; failures keep the old list.
    rpc.responses['doc.recent'] = [{ path: '/books/b.fb2', lastOpened: 'x' }];
    await store.refresh(rpc.client);
    expect(registry.has('file.recent2')).toBe(false);
    expect(registry.get('file.recent1')?.label).toBe('1. /books/b.fb2');
    rpc.responses['doc.recent'] = new Error('boom');
    await store.refresh(rpc.client);
    expect(store.files).toHaveLength(1);
    await store.refresh(null);

    await store.clear(rpc.client);
    expect(rpc.calls.map((c) => c.method)).toContain('doc.clearRecent');
    expect(store.files).toEqual([]);
    expect(store.menuItems()).toEqual([]);
  });

  it('caps the list at ten entries', () => {
    const store = new RecentFilesStore(createCommandRegistry(), async () => true);
    store.set(Array.from({ length: 14 }, (_, i) => ({ path: `/b/${i}.fb2`, lastOpened: 'x' })));
    expect(store.files).toHaveLength(10);
    expect(store.menuItems().pop()).toEqual({ kind: 'command', commandId: 'file.recent10' });
  });
});

describe('caret restore (FR-008)', () => {
  it('remembers the active caret through doc.caret only when Restore position is on', async () => {
    const rpc = fakeRpc({ 'doc.caret': {} });
    const ctx = await makeContext({ rpc: rpc.client });
    actions.setDocument(ctx.store, fakeDocument());
    ctx.carets!.register('body', {
      get: () => ({ view: 'body', nodeId: 'n3', offset: 4 }),
      set: () => true,
    });
    await rememberCaret(ctx, 'doc-1');
    expect(rpc.calls[0]).toEqual({
      method: 'doc.caret',
      params: { docId: 'doc-1', caret: { view: 'body', nodeId: 'n3', offset: 4 } },
    });
    ctx.store.setState({
      settings: { other: { restorePosition: false } } as never,
    });
    await rememberCaret(ctx, 'doc-1');
    expect(rpc.calls).toHaveLength(1);
  });

  it('restores the caret after switching to its view, retrying while the view mounts', async () => {
    vi.useFakeTimers();
    try {
      const rpc = fakeRpc({
        'doc.caret': { caret: { view: 'source', line: 7, column: 3 } },
      });
      const ctx = await makeContext({ rpc: rpc.client });
      actions.setDocument(ctx.store, fakeDocument());
      const set = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      const restored = restoreCaret(ctx, 'doc-1');
      await vi.advanceTimersByTimeAsync(5);
      // the Source view mounts "later": register its provider, then let the retry run
      ctx.carets!.register('source', { get: () => null, set });
      await vi.advanceTimersByTimeAsync(100);
      expect(await restored).toBe(true);
      expect(ctx.store.getState().activeView).toBe('source');
      expect(set).toHaveBeenCalledWith({ view: 'source', line: 7, column: 3 });

      // Nothing remembered, or the document changed meanwhile: false.
      rpc.responses['doc.caret'] = {};
      expect(await restoreCaret(ctx, 'doc-1')).toBe(false);
      rpc.responses['doc.caret'] = { caret: { view: 'body', nodeId: 'n3' } };
      expect(await restoreCaret(ctx, 'doc-other')).toBe(false);
      const pending = applyCaret(ctx, { view: 'body', nodeId: 'zzz' }, 2);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('validation helpers (T053)', () => {
  it('builds message keys and localises issues with a raw-message fallback', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    expect(issueMessageKey('schema')).toBe('validation.schema');
    expect(issueMessageKey('validation.genreUnknown')).toBe('validation.genreUnknown');
    expect(issueMessageKey('binary.unreferenced')).toBe('validation.binary.unreferenced');
    const known: ValidationIssue = {
      severity: 'warning',
      code: 'validation.genreUnknown',
      params: { code: 'sf_litrpg' },
    };
    expect(issueMessage(known, i18n.t, i18n)).toBe('Unknown genre "sf_litrpg"');
    const unknown: ValidationIssue = {
      severity: 'error',
      code: 'xsd.cvc-complex-type.2.4.a',
      params: { message: 'Element section is not allowed here' },
    };
    expect(issueMessage(unknown, i18n.t, i18n)).toBe('Element section is not allowed here');
    expect(issueMessage({ severity: 'error', code: 'weird', params: {} }, i18n.t, i18n)).toBe(
      'weird',
    );
    expect(
      issueMessage({ severity: 'error', code: 'weird', params: { detail: 'd' } }, i18n.t),
    ).toBe('d');
  });

  it('confirmSaveWithErrors shows the FBE warning and returns the answer', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    const dialogs = fakeDialogs(['yes', 'no']);
    expect(await confirmSaveWithErrors(dialogs, i18n.t, { ...CLEAN_REPORT, errorCount: 1 })).toBe(
      true,
    );
    expect(await confirmSaveWithErrors(dialogs, i18n.t, { ...CLEAN_REPORT, errorCount: 3 })).toBe(
      false,
    );
    expect(dialogs.shown[0]).toMatchObject({
      caption: 'Validation failed',
      buttons: 'yesNo',
      defaultButton: 'no',
      testId: 'dialog-validation-failed',
    });
    expect(dialogs.shown[0]!.text).toContain('1 error found.');
    expect(dialogs.shown[0]!.text).toContain('WARNING: Invalid files can be improperly displayed');
    expect(dialogs.shown[1]!.text).toContain('3 errors found.');
  });

  it('createIssueNavigator goes to the Body node or the Source line/column', async () => {
    const ctx = await makeContext();
    actions.setDocument(ctx.store, fakeDocument());
    const body = vi.fn(() => true);
    const source = vi.fn(() => true);
    ctx.carets!.register('body', { get: () => null, set: body });
    ctx.carets!.register('source', { get: () => null, set: source });
    const navigate = createIssueNavigator(ctx);

    expect(
      await navigate({ severity: 'error', code: 'x', params: {}, nodeId: 'n3', line: 5 }),
    ).toBe(true);
    expect(body).toHaveBeenCalledWith({ view: 'body', nodeId: 'n3' });
    expect(ctx.store.getState().activeView).toBe('body');

    expect(await navigate({ severity: 'error', code: 'x', params: {}, line: 5, column: 2 })).toBe(
      true,
    );
    expect(source).toHaveBeenCalledWith({ view: 'source', line: 5, column: 2 });
    expect(ctx.store.getState().activeView).toBe('source');

    // Source-only documents never navigate into the Body; issues without a position are ignored.
    ctx.store.setState({ sourceOnly: true });
    expect(
      await navigate({ severity: 'error', code: 'x', params: {}, nodeId: 'n3', line: 1 }),
    ).toBe(true);
    expect(source).toHaveBeenLastCalledWith({ view: 'source', line: 1, column: 1 });
    expect(await navigate({ severity: 'error', code: 'x', params: {} })).toBe(false);
  });
});

describe('encodings', () => {
  it('lists the nine encodings of the original and normalises spellings', () => {
    expect(ENCODING_CHOICES).toEqual([
      'utf-8',
      'utf-16',
      'windows-1251',
      'windows-1252',
      'iso-8859-1',
      'iso-8859-2',
      'iso-8859-5',
      'iso-8859-15',
      'koi8-r',
    ]);
    expect(normalizeEncoding('UTF8')).toBe('utf-8');
    expect(normalizeEncoding('cp1251')).toBe('windows-1251');
    expect(normalizeEncoding('Windows-1252')).toBe('windows-1252');
    expect(normalizeEncoding('ISO_8859-5')).toBe('iso-8859-5');
    expect(normalizeEncoding('koi8r')).toBe('koi8-r');
    expect(normalizeEncoding('utf-16le')).toBe('utf-16');
    expect(normalizeEncoding('latin1')).toBe('iso-8859-1');
    expect(normalizeEncoding('ebcdic')).toBeNull();
    expect(normalizeEncoding(undefined)).toBeNull();
  });
});

describe('view switching rules (FR-021)', () => {
  it('leaves the Source view only when the pending text parses', async () => {
    const rpc = fakeRpc({
      'doc.fromXml': (params: { text: string }) =>
        params.text === 'bad'
          ? rpcError(1001, 'parse', { line: 1, column: 2, message: 'm' })
          : { document: fakeDocument({ docId: 'doc-1' }) },
    });
    const dialogs = fakeDialogs();
    const ctx = await makeContext({ rpc: rpc.client, dialogs });
    actions.setDocument(ctx.store, fakeDocument());
    actions.setActiveView(ctx.store, 'source');
    const { setSourceOnlyText } = await import('@/views/source/sourceSession');
    setSourceOnlyText(ctx.store, 'doc-1', 'bad');
    ctx.store.setState({ sourceOnly: true });
    expect(await requestViewSwitch(ctx, 'body')).toBe(false);
    expect(ctx.store.getState().activeView).toBe('source');
    expect(ctx.store.getState().sourceParseError).toEqual({ line: 1, column: 2, message: 'm' });
    setSourceOnlyText(ctx.store, 'doc-1', 'good');
    ctx.store.setState({ sourceOnly: true });
    expect(await requestViewSwitch(ctx, 'body')).toBe(true);
    expect(ctx.store.getState()).toMatchObject({ activeView: 'body', sourceOnly: false });
    expect(await requestViewSwitch(ctx, 'body')).toBe(true); // already there
  });
});
