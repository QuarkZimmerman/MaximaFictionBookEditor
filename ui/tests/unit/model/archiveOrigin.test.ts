/**
 * Feature 009 (D8, FR-016, the requester's smoke test of rc.5): a book from a ZIP archive keeps
 * its origin while it is edited - also when its model is parsed back from the Source text - so
 * every save asks Save As; a plain save drops it (DP-5).
 */
import { describe, expect, it } from 'vitest';

import { actions, createAppStore } from '@/model/store';

import { fakeDocument } from '../features/testUtils';

const SOURCE = { archive: '/books/one.fb2.zip', entry: 'book.fb2' };

describe('the archive a book came from', () => {
  it('stays with the book when its model is parsed back or edited', () => {
    const store = createAppStore();
    actions.setDocument(store, { ...fakeDocument(), source: SOURCE });
    const docId = store.getState().document!.docId;
    actions.replaceDocumentFromSource(store, { ...fakeDocument(), docId });
    expect(store.getState().document!.source).toEqual(SOURCE);
    actions.updateDocument(store, { ...fakeDocument(), docId });
    expect(store.getState().document!.source).toEqual(SOURCE);
  });

  it('goes with a plain save, and an edit after it does not bring it back', () => {
    const store = createAppStore();
    actions.setDocument(store, { ...fakeDocument(), source: SOURCE });
    const saved = { ...store.getState().document! };
    delete saved.source;
    store.setState({ document: saved });
    actions.updateDocument(store, { ...saved });
    expect(store.getState().document!.source).toBeUndefined();
  });
});
