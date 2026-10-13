import { act, renderHook } from '@testing-library/react';

import type { Document } from '@/model/document';
import {
  actions,
  createAppStore,
  createStore,
  documentFileName,
  kindFromPath,
  useAppState,
} from '@/model/store';

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
