/**
 * Feature 002 T057 - `BodyEditorController.showModel` (a script run's result, its undo and
 * redo, shown through one editor transaction kept out of the editor history) and the lock of
 * a running script (`setLocked`).
 */

import { TextSelection } from 'prosemirror-state';

import { createAppServices } from '@/app/services';
import { docFromModel } from '@/editor/fromModel';
import type { BodyNode, Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController, type BodyEditorController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';

function paragraph(nodeId: string, text: string) {
  return {
    type: 'p' as const,
    attrs: { nodeId },
    content: [{ type: 'text' as const, text }],
  } as SectionNode['content'][number];
}

function sectionNode(id: string, text: string): SectionNode {
  return { type: 'section', attrs: { nodeId: id }, content: [paragraph(`${id}p`, text)] };
}

function book(sections: number): Document {
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: Array.from({ length: sections }, (_, i) => sectionNode(`s${i}`, `Section ${i}`)),
  };
  return { ...fakeDocument(), bodies: [body] };
}

/** `document` with its main body's sections changed by `edit`. */
function withSections(document: Document, edit: (sections: SectionNode[]) => SectionNode[]) {
  const body = document.bodies[0]!;
  const sections = edit([...(body.content as SectionNode[])]);
  return { ...document, bodies: [{ ...body, content: sections }, ...document.bodies.slice(1)] };
}

function setup(document: Document): {
  controller: BodyEditorController;
  store: ReturnType<typeof createAppStore>;
  services: ReturnType<typeof createAppServices>;
} {
  const store = createAppStore();
  const services = createAppServices({ store, rpc: fakeRpc().client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, document);
  return { controller: getBodyController(store), store, services };
}

function typeAt(controller: BodyEditorController, nodeId: string, text: string) {
  const state = controller.editorState!;
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (node.attrs.nodeId === nodeId) pos = at + 1;
    return pos < 0;
  });
  controller.apply(state.tr.insertText(text, pos));
}

describe('BodyEditorController.showModel', () => {
  it('shows a changed model through one transaction kept out of the editor history', () => {
    const { controller, store, services } = setup(book(3));
    typeAt(controller, 's0p', 'typed ');
    expect(services.undo.undoDepth).toBe(1);
    const current = store.getState().document!;
    const next = withSections(current, (sections) => [
      ...sections.slice(0, 2),
      sectionNode('s2', 'Changed by the run'),
      sectionNode('s3', 'Added by the run'),
    ]);
    controller.showModel(next);
    expect(store.getState().document).toBe(next);
    expect(controller.editorState!.doc.eq(docFromModel(next).node)).toBe(true);
    // Nothing was recorded; the typing before is still undoable and keeps the run's change.
    expect(services.undo.undoDepth).toBe(1);
    services.undo.undo();
    const text = controller.editorState!.doc.textContent;
    expect(text).not.toContain('typed');
    expect(text).toContain('Changed by the run');
    expect(text).toContain('Added by the run');
  });

  it('turns the editor into the window of the new model for any change', () => {
    const { controller } = setup(book(4));
    const start = controller.currentModel!;
    const changes: ((sections: SectionNode[]) => SectionNode[])[] = [
      (s) => [sectionNode('n0', 'First'), ...s],
      (s) => s.slice(1),
      (s) => [...s.slice(0, 1), ...s.slice(2)],
      (s) => s.map((x, i) => (i === 1 ? { ...x, attrs: { ...x.attrs, id: 'anchor' } } : x)),
      (s) => [...s].reverse(),
      () => [sectionNode('only', 'Only')],
    ];
    for (const change of changes) {
      const next = withSections(start, change);
      controller.showModel(next);
      expect(controller.editorState!.doc.eq(docFromModel(next).node)).toBe(true);
      controller.showModel(start);
      expect(controller.editorState!.doc.eq(docFromModel(start).node)).toBe(true);
    }
  });

  it('keeps a section window on its body and first section, the caret on its block', () => {
    const { controller, store } = setup(book(60));
    expect(controller.currentWindow!.wholeBook).toBe(false);
    controller.setCaret({ view: 'body', nodeId: 's30p', offset: 3 });
    const window = controller.currentWindow!;
    const firstId = (store.getState().document!.bodies[0]!.content[window.start] as SectionNode)
      .attrs.nodeId;
    const inserted = withSections(store.getState().document!, (sections) => [
      ...Array.from({ length: 5 }, (_, i) => sectionNode(`new${i}`, `New ${i}`)),
      ...sections,
    ]);
    const extra: BodyNode = {
      type: 'body',
      attrs: { nodeId: 'b0', name: 'extra' },
      content: [sectionNode('e0', 'E')],
    };
    const next = { ...inserted, bodies: [extra, ...inserted.bodies] };
    controller.showModel(next);
    const after = controller.currentWindow!;
    expect(after.bodyIndex).toBe(1);
    expect(after.start).toBe(window.start + 5);
    expect((next.bodies[1]!.content[after.start] as SectionNode).attrs.nodeId).toBe(firstId);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 's30p', offset: 3 });
  });

  it('follows the caret when its block left the window', () => {
    const { controller, store } = setup(book(60));
    controller.setCaret({ view: 'body', nodeId: 's2p', offset: 1 });
    const moved = withSections(store.getState().document!, (sections) => {
      const rest = sections.filter((s) => s.attrs.nodeId !== 's2');
      return [...rest.slice(0, 50), sections[2]!, ...rest.slice(50)];
    });
    controller.showModel(moved);
    expect(controller.getCaret()).toEqual({ view: 'body', nodeId: 's2p', offset: 1 });
  });

  it('keeps a text selection on the same blocks and offsets', () => {
    const { controller, store } = setup(book(3));
    const state = controller.editorState!;
    let base = -1;
    state.doc.descendants((node, at) => {
      if (node.attrs.nodeId === 's1p') base = at + 1;
      return base < 0;
    });
    controller.apply(state.tr.setSelection(TextSelection.create(state.doc, base + 2, base + 5)));
    const next = withSections(store.getState().document!, (sections) => [
      sectionNode('s0', 'A much longer first section than before'),
      ...sections.slice(1),
    ]);
    controller.showModel(next);
    const selection = controller.editorState!.selection;
    const $from = selection.$from;
    expect($from.parent.attrs.nodeId).toBe('s1p');
    expect($from.parentOffset).toBe(2);
    expect(selection.$to.parentOffset).toBe(5);
  });
});

describe('BodyEditorController lock (a running script)', () => {
  it('refuses the user edits but shows the run changes', () => {
    const { controller, store, services } = setup(book(2));
    controller.setLocked(true);
    expect(controller.isEditable).toBe(false);
    typeAt(controller, 's0p', 'typed ');
    expect(controller.editorState!.doc.textContent).not.toContain('typed');
    const step = { apply: (m: Document) => m, revert: (m: Document) => m };
    expect(controller.applyModelStep(step)).toBeNull();
    expect(services.undo.canUndo).toBe(false);

    const next = withSections(store.getState().document!, (sections) => [
      sectionNode('s0', 'Run'),
      ...sections.slice(1),
    ]);
    controller.showModel(next);
    expect(controller.editorState!.doc.textContent).toContain('Run');
    controller.setLocked(false);
    expect(controller.isEditable).toBe(true);
    typeAt(controller, 's0p', 'typed ');
    expect(controller.editorState!.doc.textContent).toContain('typed Run');
  });
});
