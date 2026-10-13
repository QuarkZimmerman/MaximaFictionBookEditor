/**
 * T077 - form <-> model binding: edits reach `store.document.description` as a clean model
 * (modified flag), bursts in one field are one undo entry while another field or a pause
 * starts a new one, undo / redo replay through the coordinator, external model replacement
 * re-initialises the form, and the Find / Replace target works over the plain text fields.
 */

import type { Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { DescriptionController, DESCRIPTION_UNDO_VIEW } from '@/views/description/binding';

import { fakeDocument } from '../features/testUtils';

function setup(document: Document = fakeDocument()) {
  const store = createAppStore();
  const undo = new UndoCoordinator();
  actions.setDocument(store, document);
  let now = 1000;
  const controller = new DescriptionController({ store, undo, now: () => now });
  undo.registerView(DESCRIPTION_UNDO_VIEW, controller.undoAdapter);
  return { store, undo, controller, advance: (ms: number) => (now += ms) };
}

const description = (store: ReturnType<typeof createAppStore>) =>
  store.getState().document!.description;

describe('DescriptionController binding', () => {
  it('writes the clean model on every change and marks the document modified', () => {
    const { store, controller } = setup();
    expect(store.getState().modified).toBe(false);
    controller.setField('titleInfo.bookTitle', '  Beta ');
    expect(store.getState().modified).toBe(true);
    expect(description(store).titleInfo.bookTitle).toBe('Beta');
    // The raw form keeps what was typed (trailing spaces while typing).
    expect(controller.currentForm?.titleInfo.bookTitle).toBe('  Beta ');
    controller.setField('titleInfo.keywords', '');
    expect(description(store).titleInfo.keywords).toBeUndefined();
    controller.update((form) => ({
      ...form,
      titleInfo: {
        ...form.titleInfo,
        authors: [...form.titleInfo.authors, { firstName: 'Only', homePages: [], emails: [] }],
      },
    }));
    // The incomplete author is kept (flagged), empty persons would be dropped.
    expect(description(store).titleInfo.authors).toHaveLength(2);
    expect(controller.getSnapshot().issues?.incompletePersons.has('titleInfo.authors.1')).toBe(
      true,
    );
  });

  it('coalesces keystrokes of one field into one undo entry and splits on field / pause / blur', () => {
    const { controller, undo, advance } = setup();
    controller.setField('titleInfo.bookTitle', 'A');
    controller.setField('titleInfo.bookTitle', 'Al');
    controller.setField('titleInfo.bookTitle', 'Alp');
    expect(undo.undoDepth).toBe(1);
    controller.setField('titleInfo.keywords', 'k');
    expect(undo.undoDepth).toBe(2);
    advance(5000);
    controller.setField('titleInfo.keywords', 'ke');
    expect(undo.undoDepth).toBe(3);
    controller.closeEntry();
    controller.setField('titleInfo.keywords', 'key');
    expect(undo.undoDepth).toBe(4);
    controller.update((form) => ({ ...form, customInfo: [{ infoType: 'a', text: 'b' }] }));
    controller.update((form) => ({ ...form, customInfo: [] }));
    expect(undo.undoDepth).toBe(6);
  });

  it('undoes and redoes whole bursts through the coordinator', () => {
    const { store, controller, undo } = setup();
    controller.setField('titleInfo.bookTitle', 'Alpha 2');
    controller.setField('titleInfo.bookTitle', 'Alpha 23');
    controller.closeEntry();
    controller.setField('documentInfo.version', '2.0');
    expect(undo.undoDepth).toBe(2);
    expect(undo.undo()).toBe(true);
    expect(description(store).documentInfo.version).toBe('1.0');
    expect(description(store).titleInfo.bookTitle).toBe('Alpha 23');
    expect(undo.undo()).toBe(true);
    expect(description(store).titleInfo.bookTitle).toBe('Alpha');
    expect(undo.canUndo).toBe(false);
    expect(undo.redo()).toBe(true);
    expect(description(store).titleInfo.bookTitle).toBe('Alpha 23');
    expect(undo.redo()).toBe(true);
    expect(description(store).documentInfo.version).toBe('2.0');
    expect(store.getState().modified).toBe(true);
    // A new edit after undo drops the redo stack.
    undo.undo();
    controller.setField('documentInfo.version', '3.0');
    expect(undo.canRedo).toBe(false);
    expect(controller.canRedo).toBe(false);
  });

  it('re-initialises from the model when the document is replaced from outside', () => {
    const { store, controller, undo } = setup();
    controller.setField('titleInfo.bookTitle', 'Edited');
    expect(undo.undoDepth).toBe(1);
    const other = fakeDocument({ docId: 'doc-2' });
    other.description.titleInfo.bookTitle = 'Other';
    actions.setDocument(store, other);
    undo.clear();
    expect(controller.currentForm?.titleInfo.bookTitle).toBe('Other');
    expect(controller.currentDocId).toBe('doc-2');
    expect(controller.canUndo).toBe(false);
    // Same docId, description replaced (Source re-parse): the form follows the model.
    const reparsed = { ...other, description: { ...other.description } };
    reparsed.description.documentInfo = { ...reparsed.description.documentInfo, version: '9.9' };
    actions.replaceDocumentFromSource(store, reparsed);
    expect(controller.currentForm?.documentInfo.version).toBe('9.9');
    // Body edits (same description object) keep the form.
    controller.setField('titleInfo.bookTitle', 'Mine');
    const current = store.getState().document!;
    store.setState({ document: { ...current, bodies: [] } });
    expect(controller.currentForm?.titleInfo.bookTitle).toBe('Mine');
    actions.closeDocument(store);
    expect(controller.currentForm).toBeNull();
    expect(controller.getSnapshot().form).toBeNull();
  });

  it('finds, replaces and replaces all over the text fields', () => {
    const { store, controller } = setup();
    const input = document.createElement('input');
    const keywords = document.createElement('input');
    document.body.append(input, keywords);
    controller.registerInput('titleInfo.bookTitle', input);
    controller.registerInput('titleInfo.keywords', keywords);
    controller.setField('titleInfo.keywords', 'alpha beta alpha');
    input.value = 'Alpha';
    keywords.value = 'alpha beta alpha';
    const options = {
      query: 'alpha',
      wholeWord: false,
      matchCase: false,
      regex: false,
      direction: 'down' as const,
    };
    const target = controller.searchTarget;
    expect(target.view).toBe('description');
    expect(target.findNext(options)).toBe(true);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    expect(target.selectedText()).toBe('Alpha');
    expect(target.findNext(options)).toBe(true);
    expect(document.activeElement).toBe(keywords);
    expect([keywords.selectionStart, keywords.selectionEnd]).toEqual([0, 5]);
    expect(target.replaceCurrent(options, 'gamma')).toBe(true);
    expect(description(store).titleInfo.keywords).toBe('gamma beta alpha');
    expect(keywords.value).toBe('gamma beta alpha');
    expect([keywords.selectionStart, keywords.selectionEnd]).toEqual([0, 5]);
    expect(target.findNext(options)).toBe(true);
    expect([keywords.selectionStart, keywords.selectionEnd]).toEqual([11, 16]);
    // Wraps around to the title.
    expect(target.findNext(options)).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(target.replaceAll({ ...options, matchCase: true }, 'delta')).toBe(1);
    expect(description(store).titleInfo.keywords).toBe('gamma beta delta');
    expect(target.replaceAll({ ...options, regex: true, query: '(ga)mma' }, '$1p')).toBe(1);
    expect(description(store).titleInfo.keywords).toBe('gap beta delta');
    expect(target.findNext({ ...options, query: 'nowhere' })).toBe(false);
    input.remove();
    keywords.remove();
  });

  it('exposes a caret provider over the focused field', () => {
    const { controller } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    controller.registerInput('documentInfo.id', input);
    input.value = 'id';
    expect(
      controller.caretProvider.set({ view: 'description', nodeId: 'documentInfo.id', offset: 1 }),
    ).toBe(true);
    expect(controller.caretProvider.get()).toMatchObject({
      view: 'description',
      nodeId: 'documentInfo.id',
      offset: 1,
    });
    expect(controller.caretProvider.set({ view: 'description', nodeId: 'missing' })).toBe(false);
    input.remove();
  });
});
