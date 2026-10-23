import { act, renderHook } from '@testing-library/react';

import type { Document } from '@/model/document';
import {
  actions,
  createAppStore,
  createStore,
  documentFileName,
  isRunLocked,
  kindFromPath,
  useAppState,
} from '@/model/store';

import { defaultSettings } from './settings/fixtures';

function fakeDocument(overrides: Partial<Document> = {}): Document {
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
    ...overrides,
  };
}

describe('store', () => {
  it('notifies subscribers only when a field actually changes', () => {
    const store = createStore({ a: 1, b: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ a: 1 });
    expect(listener).not.toHaveBeenCalled();
    store.setState({ a: 2 });
    expect(listener).toHaveBeenCalledWith({ a: 2, b: 'x' }, { a: 1, b: 'x' });
    store.setState((s) => ({ b: s.b + 'y' }));
    expect(store.getState()).toEqual({ a: 2, b: 'xy' });
  });

  it('setDocument / updateDocument / markSaved / closeDocument manage the document fields', () => {
    const store = createAppStore();
    const doc = fakeDocument();
    actions.setDocument(store, doc);
    expect(store.getState()).toMatchObject({
      docId: 'doc-1',
      path: '/books/alpha.fb2',
      fileKind: 'fb2',
      modified: false,
      activeView: 'body',
    });

    actions.updateDocument(store, { ...doc, bodies: [] });
    expect(store.getState().modified).toBe(true);

    actions.markSaved(store, '/books/beta.fbd');
    expect(store.getState()).toMatchObject({
      path: '/books/beta.fbd',
      fileKind: 'fb2', // kind preserved on Save (only Save As with a kind changes it)
      modified: false,
    });
    expect(store.getState().document?.path).toBe('/books/beta.fbd');

    actions.markSaved(store, '/books/beta.fbd', 'fbd');
    expect(store.getState().fileKind).toBe('fbd');

    actions.closeDocument(store);
    expect(store.getState()).toMatchObject({ document: null, docId: null, path: null });
  });

  it('opens malformed files in Source-only mode', () => {
    const store = createAppStore();
    actions.setDocument(store, fakeDocument({ schemaHint: 'unknown' }), { sourceOnly: true });
    expect(store.getState().sourceOnly).toBe(true);
    expect(store.getState().activeView).toBe('source');
  });

  it('toggles view-state flags', () => {
    const store = createAppStore();
    actions.toggleToolbar(store, 'links');
    expect(store.getState().toolbars.links).toBe(false);
    actions.toggleTree(store);
    expect(store.getState().treeVisible).toBe(false);
    actions.toggleInsertMode(store);
    expect(store.getState().insertMode).toBe('overwrite');
    actions.toggleFastMode(store);
    expect(store.getState().fastMode).toBe(true);
    actions.setActiveView(store, 'source');
    expect(store.getState().activeView).toBe('source');
    actions.setSelection(store, 'body[1]/section[2]/p[3]', 'n12');
    expect(store.getState()).toMatchObject({
      selectionPath: 'body[1]/section[2]/p[3]',
      selectionNodeId: 'n12',
    });
  });

  it('holds the run lock of a script run or an AI request; isRunLocked derives the flag', () => {
    // Feature 005 T025 (data-model §4.1): `runLock` replaces the `scriptRunning` boolean.
    const store = createAppStore();
    expect(store.getState().runLock).toBeNull();
    expect(isRunLocked(store.getState())).toBe(false);

    const script = { kind: 'script' as const, label: 'Append paragraph', startedAt: 1_000 };
    actions.setRunLock(store, script);
    expect(store.getState().runLock).toBe(script);
    expect(isRunLocked(store.getState())).toBe(true);

    const ai = {
      kind: 'ai' as const,
      label: 'OVHcloud AI Endpoints · gpt-oss-120b',
      startedAt: 2_000,
      phase: 'waiting for the answer',
    };
    actions.setRunLock(store, ai);
    expect(store.getState().runLock).toEqual(ai);
    expect(isRunLocked(store.getState())).toBe(true);
    // The phase changes through a new lock object; the holder stays the same.
    actions.setRunLock(store, { ...ai, phase: 'running replace_node' });
    expect(store.getState().runLock?.phase).toBe('running replace_node');
    expect(store.getState().runLock?.startedAt).toBe(2_000);

    actions.setRunLock(store, null);
    expect(store.getState().runLock).toBeNull();
    expect(isRunLocked(store.getState())).toBe(false);
    // The selector works on a bare state slice too (non-React consumers).
    expect(isRunLocked({ runLock: null })).toBe(false);
    expect(isRunLocked({ runLock: script })).toBe(true);
  });

  it('adopts the toolbar and tree flags from the first settings snapshot only', () => {
    const store = createAppStore();
    const stored = defaultSettings();
    stored.session.toolbars.status = false;
    stored.session.treeVisible = false;
    // The start-up read: the stored session applies.
    actions.setSettings(store, stored);
    expect(store.getState().toolbars.status).toBe(false);
    expect(store.getState().treeVisible).toBe(false);

    // The user shows both again; the core reports the settings meanwhile (after a settings.set
    // of another key, before the delayed save of the flags): the window's own flags stay, the
    // rest of the snapshot applies.
    actions.toggleToolbar(store, 'status');
    actions.toggleTree(store);
    const reported = defaultSettings();
    reported.session.toolbars.status = false;
    reported.session.treeVisible = false;
    reported.session.lastVersionCheck = '2026-10-17T12:00:00.000Z';
    reported.view.fastMode = true;
    actions.setSettings(store, reported);
    expect(store.getState().toolbars.status).toBe(true);
    expect(store.getState().treeVisible).toBe(true);
    expect(store.getState().settings).toBe(reported);
    expect(store.getState().fastMode).toBe(true);
  });

  it('carries the feature 005 settings (the ai group, session.aiPanelWidth, session.aiPanelVisible) in the snapshot', () => {
    // resource-formats.md §B: the `ai` group and the panel's width and visibility travel with
    // every settings snapshot like the other groups - nothing of them is kept apart. (The
    // fixture keeps a service mode for the tests' sake; the stored default is `disabled`.)
    const store = createAppStore();
    const stored = defaultSettings();
    expect(stored.ai).toEqual({
      mode: 'free',
      freeServiceId: 'ovhcloud',
      custom: { address: 'https://api.openai.com/v1', key: '', model: '' },
      customVerified: { fingerprint: '', model: '', at: '' },
      agreements: [],
    });
    expect(stored.session.aiPanelWidth).toBe(360);
    expect(stored.session.aiPanelVisible).toBe(true);
    stored.ai = {
      ...stored.ai,
      mode: 'custom',
      custom: { address: 'http://127.0.0.1:11434/v1', key: 'sk-local', model: 'standin-chat' },
      agreements: [
        {
          service: 'ovhcloud',
          host: 'oai.endpoints.kepler.ai.cloud.ovh.net',
          at: '2026-10-22T10:00:00Z',
        },
      ],
    };
    stored.session.aiPanelWidth = 480;
    actions.setSettings(store, stored);
    expect(store.getState().settings?.ai.mode).toBe('custom');
    expect(store.getState().settings?.ai.custom.model).toBe('standin-chat');
    expect(store.getState().settings?.ai.agreements).toHaveLength(1);
    expect(store.getState().settings?.session.aiPanelWidth).toBe(480);
  });

  it('keeps the Document Tree pane width: default 260, the first snapshot, setTreeWidth', () => {
    const store = createAppStore();
    expect(store.getState().treeWidth).toBe(260);

    // The start-up read: the stored width applies.
    const stored = defaultSettings();
    stored.session.treeWidth = 420;
    actions.setSettings(store, stored);
    expect(store.getState().treeWidth).toBe(420);

    // A drag ends: the window's own width; a snapshot the core reports meanwhile (before the
    // delayed save) still says 420 and must not undo the drag.
    actions.setTreeWidth(store, 333);
    expect(store.getState().treeWidth).toBe(333);
    const reported = defaultSettings();
    reported.session.treeWidth = 420;
    actions.setSettings(store, reported);
    expect(store.getState().treeWidth).toBe(333);
    expect(store.getState().settings).toBe(reported);

    // A first snapshot without the key (an older core) leaves the default.
    const older = createAppStore();
    const legacy = defaultSettings();
    delete (legacy.session as Partial<typeof legacy.session>).treeWidth;
    actions.setSettings(older, legacy);
    expect(older.getState().treeWidth).toBe(260);
  });

  it("keeps the AI panel width and visibility like the tree pane's and never takes the live state from the settings (feature 005)", () => {
    const store = createAppStore();
    // Not live at start, nothing loaded, an empty conversation, the panel open (FR-040 as
    // amended: the default of `session.aiPanelVisible`) at the default width.
    expect(store.getState().ai).toEqual({
      visible: true,
      on: false,
      width: 360,
      loaded: false,
      catalogue: null,
      request: null,
      conversation: { docId: null, messages: [], activity: [], droppedTurns: 0 },
      panelFocus: false,
      contextLengthHint: null,
      customModels: null,
    });

    // The start-up read: the stored width and visibility apply; nothing else of `ai` changes.
    const stored = defaultSettings();
    stored.session.aiPanelWidth = 520;
    stored.session.aiPanelVisible = false;
    actions.setSettings(store, stored);
    expect(store.getState().ai.width).toBe(520);
    expect(store.getState().ai.visible).toBe(false);
    expect(store.getState().ai.on).toBe(false);

    // A drag ends: the window's own width; a later snapshot (before the delayed save) still
    // says 520 and must not undo the drag. The same for the visibility.
    actions.setAiPanelWidth(store, 444);
    expect(store.getState().ai.width).toBe(444);
    const before = store.getState().ai;
    actions.setAiPanelWidth(store, 444); // the same width: no new state object
    expect(store.getState().ai).toBe(before);
    actions.setAiPanelVisible(store, true);
    expect(store.getState().ai.visible).toBe(true);
    const shown = store.getState().ai;
    actions.setAiPanelVisible(store, true); // the same visibility: no new state object
    expect(store.getState().ai).toBe(shown);
    const reported = defaultSettings();
    reported.session.aiPanelWidth = 520;
    reported.session.aiPanelVisible = false;
    actions.setSettings(store, reported);
    expect(store.getState().ai.width).toBe(444);
    expect(store.getState().ai.visible).toBe(true);

    // The other fields change through `updateAi`; `width` and `visible` are not among them.
    actions.updateAi(store, { on: true, loaded: true, contextLengthHint: 131072 });
    expect(store.getState().ai).toMatchObject({
      visible: true,
      on: true,
      loaded: true,
      width: 444,
      contextLengthHint: 131072,
    });
    // A settings snapshot - even the first one - never turns the assistant on or off: the
    // live state is the feature's, derived from the visibility and the mode.
    const fresh = createAppStore();
    actions.updateAi(fresh, { on: true });
    actions.setSettings(fresh, defaultSettings());
    expect(fresh.getState().ai.on).toBe(true);
    expect(fresh.getState().ai.width).toBe(360);
    expect(fresh.getState().ai.visible).toBe(true);

    // A first snapshot without the keys (a core before API minor 4, or before the visibility
    // key) leaves the defaults: the default width, the panel open.
    const older = createAppStore();
    const legacy = defaultSettings();
    delete (legacy.session as Partial<typeof legacy.session>).aiPanelWidth;
    delete (legacy.session as Partial<typeof legacy.session>).aiPanelVisible;
    actions.setSettings(older, legacy);
    expect(older.getState().ai.width).toBe(360);
    expect(older.getState().ai.visible).toBe(true);
  });

  it('useAppState re-renders on selected changes only', () => {
    const store = createAppStore();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useAppState((s) => s.activeView, store);
    });
    expect(result.current).toBe('body');
    act(() => actions.setStatusMessage(store, 'hello'));
    expect(renders).toBe(1);
    act(() => actions.setActiveView(store, 'description'));
    expect(result.current).toBe('description');
    expect(renders).toBe(2);
  });

  it('derives file kind and file name from paths', () => {
    expect(kindFromPath('/a/b.FB2')).toBe('fb2');
    expect(kindFromPath('C:\\books\\x.fbd')).toBe('fbd');
    expect(kindFromPath('/a/b.xml')).toBe('xml');
    expect(kindFromPath('/a/noext')).toBe('fb2');
    expect(documentFileName({ path: 'C:\\books\\x.fbd' })).toBe('x.fbd');
    expect(documentFileName({ path: '/a/b.fb2' })).toBe('b.fb2');
    expect(documentFileName({ path: null })).toBeNull();
  });
});
