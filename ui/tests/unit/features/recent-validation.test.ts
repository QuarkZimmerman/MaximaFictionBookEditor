import { createInstance } from 'i18next';

import { createCommandRegistry, type CommandContext } from '@/app/commands';
import { ENCODING_CHOICES, normalizeEncoding } from '@/dialogs/encodings';
import {
  confirmSaveWithErrors,
  createIssueNavigator,
  issueMessage,
  issueMessageKey,
} from '@/dialogs/validation';
import { installBodyEditor } from '@/features/editing';
import {
  RecentFilesStore,
  recentCommandId,
  recentLabel,
  rememberPosition,
  restorePosition,
} from '@/features/file/recent';
import { initI18n } from '@/i18n';
import type { Document, ValidationIssue } from '@/model/document';
import { actions } from '@/model/store';
import { getBodyController, type BodyEditorController } from '@/views/body/bodyEditor';
import { requestViewSwitch } from '@/views/source/sourceSession';

import { defaultSettings, mergeSettings } from '../settings/fixtures';

import {
  CLEAN_REPORT,
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  flowCalls,
  makeContext,
  rpcError,
  type FakeRpc,
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

/**
 * Restore position (feature 004 US8, FR-100 / FR-101; research R5.6, R5.7): the Body
 * controller's caret - whatever the active view - as a structural path through
 * `doc.position`; restored through `resolvePosition` without a view switch.
 */
describe('Restore position (feature 004 US8)', () => {
  /** A two-paragraph book: p[1] "Hello" (n3), p[2] "World, wide" (n4); `null` = never saved. */
  function book(path: string | null = '/books/alpha.fb2'): Document {
    const document = fakeDocument({ path: path ?? undefined });
    const section = document.bodies[0]!.content[0] as {
      content: { type: string; attrs: { nodeId: string }; content: unknown[] }[];
    };
    section.content.push({
      type: 'p',
      attrs: { nodeId: 'n4' },
      content: [{ type: 'text', text: 'World, wide' }],
    });
    return document;
  }

  async function setup(
    responses: Record<string, unknown> = {},
  ): Promise<{ ctx: CommandContext; rpc: FakeRpc; controller: BodyEditorController }> {
    const rpc = fakeRpc({ 'doc.position': {}, ...responses });
    const ctx = await makeContext({ rpc: rpc.client });
    installBodyEditor({
      commands: createCommandRegistry(),
      rpc: rpc.client,
      undo: ctx.undo,
      carets: ctx.carets!,
      store: ctx.store,
      hotkeys: ctx.hotkeys,
    });
    actions.setConnection(ctx.store, 'connected');
    return { ctx, rpc, controller: getBodyController(ctx.store) };
  }

  const positionCalls = (rpc: FakeRpc) =>
    flowCalls(rpc).filter((call) => call.method === 'doc.position');

  /** The settings with "Restore position" switched `on` or off (the rest the defaults). */
  const settingsWith = (on: boolean) =>
    mergeSettings(defaultSettings(), { other: { restorePosition: on } });

  it('remembers the Body caret as a structural path whatever the active view', async () => {
    const { ctx, rpc, controller } = await setup();
    actions.setDocument(ctx.store, book());
    // The caret placed in the second paragraph (the Body view counts as shown).
    expect(controller.setCaret({ view: 'body', nodeId: 'n4', offset: 7 })).toBe(true);
    actions.setActiveView(ctx.store, 'description');
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toEqual([
      {
        method: 'doc.position',
        params: { docId: 'doc-1', position: { path: 'body[1]/section[1]/p[2]', offset: 7 } },
      },
    ]);
    // From the Source view as well: still the Body caret, never the active view's.
    actions.setActiveView(ctx.store, 'source');
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toHaveLength(2);
    expect(positionCalls(rpc)[1]!.params).toEqual({
      docId: 'doc-1',
      position: { path: 'body[1]/section[1]/p[2]', offset: 7 },
    });
  });

  it('skips when the setting is off, the document has no file, is Source-only or the Body view was never shown', async () => {
    const { ctx, rpc, controller } = await setup();
    // A fresh document whose Body view was never shown and whose caret was never placed:
    // the previous record for its path must stay (FR-100).
    actions.setDocument(ctx.store, book());
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toEqual([]);
    expect(controller.setCaret({ view: 'body', nodeId: 'n3', offset: 2 })).toBe(true);
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toHaveLength(1);

    // The setting known to be off.
    ctx.store.setState({ settings: settingsWith(false) });
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toHaveLength(1);
    ctx.store.setState({ settings: settingsWith(true) });
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toHaveLength(2);

    // A never-saved document remembers nothing.
    actions.setDocument(ctx.store, book(null));
    controller.setCaret({ view: 'body', nodeId: 'n3', offset: 1 });
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toHaveLength(2);

    // A Source-only session takes no Body caret.
    actions.setDocument(ctx.store, book(), { sourceOnly: true });
    controller.setCaret({ view: 'body', nodeId: 'n3', offset: 1 });
    await rememberPosition(ctx, 'doc-1');
    expect(positionCalls(rpc)).toHaveLength(2);

    // Mounting the view counts as showing it: the editor's start - the annotation block above
    // the bodies (feature 004 US2) - is then a position too. (The file flows close a document
    // before they show the next one; the controller then starts from a fresh state.)
    actions.closeDocument(ctx.store);
    actions.setDocument(ctx.store, { ...book(), docId: 'doc-2' });
    controller.mount(document.createElement('div'));
    await rememberPosition(ctx, 'doc-2');
    expect(positionCalls(rpc)).toHaveLength(3);
    expect(positionCalls(rpc)[2]!.params).toEqual({
      docId: 'doc-2',
      position: { path: 'title-info/annotation[1]/p[1]', offset: 0 },
    });
    controller.unmount();
  });

  it('restores through resolvePosition and setCaret without switching the view', async () => {
    const { ctx, rpc, controller } = await setup({
      'doc.position': { position: { path: 'body[1]/section[1]/p[2]', offset: 3 } },
    });
    actions.setActiveView(ctx.store, 'description');
    actions.setDocument(ctx.store, book());
    expect(await restorePosition(ctx, 'doc-1')).toBe(true);
    expect(positionCalls(rpc)).toEqual([{ method: 'doc.position', params: { docId: 'doc-1' } }]);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n4', offset: 3 });
    expect(ctx.store.getState().selectionPath).toBe('body[1]/section[1]/p[2]');
    expect(ctx.store.getState().activeView).toBe('description'); // no view switch

    // FR-101 fallback: a paragraph that no longer exists -> the one now at that place,
    // clamped; the offset clamped to its length.
    rpc.responses['doc.position'] = {
      position: { path: 'body[1]/section[1]/p[5]', offset: 99 },
    };
    expect(await restorePosition(ctx, 'doc-1')).toBe(true);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n4', offset: 11 });
    // A body index beyond the last body clamps to the last body; a root the document does
    // not have (no annotation) -> the document's start.
    rpc.responses['doc.position'] = { position: { path: 'body[3]/section[1]/p[1]', offset: 2 } };
    expect(await restorePosition(ctx, 'doc-1')).toBe(true);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n3', offset: 2 });
    rpc.responses['doc.position'] = {
      position: { path: 'title-info/annotation[1]/p[1]', offset: 2 },
    };
    expect(await restorePosition(ctx, 'doc-1')).toBe(true);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n3', offset: 0 });

    // Nothing remembered, another document meanwhile, Source-only: false, caret untouched.
    controller.setCaret({ view: 'body', nodeId: 'n4', offset: 1 });
    rpc.responses['doc.position'] = {};
    expect(await restorePosition(ctx, 'doc-1')).toBe(false);
    rpc.responses['doc.position'] = { position: { path: 'body[1]/section[1]/p[1]', offset: 0 } };
    expect(await restorePosition(ctx, 'doc-other')).toBe(false);
    ctx.store.setState({ sourceOnly: true });
    expect(await restorePosition(ctx, 'doc-1')).toBe(false);
    ctx.store.setState({ sourceOnly: false });
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n4', offset: 1 });
    // The setting known to be off: no call at all (the core gates as well).
    const calls = positionCalls(rpc).length;
    ctx.store.setState({ settings: settingsWith(false) });
    expect(await restorePosition(ctx, 'doc-1')).toBe(false);
    expect(positionCalls(rpc)).toHaveLength(calls);
  });

  it('a pending position (the changed-on-disk reload) wins over the record', async () => {
    const { ctx, rpc, controller } = await setup({
      'doc.position': { position: { path: 'body[1]/section[1]/p[1]', offset: 0 } },
    });
    actions.setDocument(ctx.store, book());
    // Even with the setting off: the reload keeps the in-session caret (FR-101).
    ctx.store.setState({ settings: settingsWith(false) });
    expect(
      await restorePosition(ctx, 'doc-1', { path: 'body[1]/section[1]/p[2]', offset: 4 }),
    ).toBe(true);
    expect(positionCalls(rpc)).toEqual([]);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 'n4', offset: 4 });
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
