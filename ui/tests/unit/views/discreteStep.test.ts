/**
 * One undo step per command in the Body view (feature 006, T035; FR-045, SC-007; data-model
 * §1.6, §6.3): a document change that carries `DISCRETE_STEP` - a table plan's commit, a paste,
 * a cleared block, dispatched by a plugin's handler rather than through `execute` - is one
 * ProseMirror history event and one undo-coordinator entry between two typing bursts, which
 * Undo takes back exactly and Redo applies again; and a node stamped with the controller's
 * public `nextNodeId` keeps its id through `nodeIdPlugin`.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { undoDepth } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { createAppServices, type AppServices } from '@/app/services';
import { DISCRETE_STEP, N } from '@/editor/commands/util';
import { fb2Schema, findNodeById } from '@/editor/schema';
import { initI18n } from '@/i18n';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { getBodyController, type BodyEditorController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';

interface Harness {
  store: AppStore;
  services: AppServices;
  controller: BodyEditorController;
  view: EditorView;
}

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** The editing feature's Body controller over `fakeDocument()`, mounted, the caret after "Hello". */
async function harness(): Promise<Harness> {
  await initI18n({ language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.set': (params: unknown) => ({ settings: null, restartRequired: false, params }),
  });
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, fakeDocument());
  const controller = getBodyController(store);
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  controller.mount(host);
  const view = controller.editorView!;
  // A selection change alone, without `scrollIntoView` (jsdom measures nothing).
  const paragraph = findNodeById(view.state.doc, 'n3')!;
  const end = paragraph.pos + 1 + paragraph.node.content.size;
  controller.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
  return { store, services, controller, view };
}

/** Typing as the view reports it: an insertion at the caret, dispatched by the view itself. */
function type(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.insertText(text));
}

/** A plugin handler's change (a paste, a Tab row): dispatched by the view, `DISCRETE_STEP` or not. */
function insertDirectly(view: EditorView, text: string, discrete: boolean): void {
  const tr = view.state.tr.insertText(text);
  view.dispatch(discrete ? tr.setMeta(DISCRETE_STEP, true) : tr);
}

function paragraphText(doc: PMNode, nodeId: string): string {
  return findNodeById(doc, nodeId)?.node.textContent ?? '';
}

function bodyEntries(services: AppServices): number {
  return services.undo.entries().filter((entry) => entry.view === 'body').length;
}

describe('DISCRETE_STEP in the Body view (feature 006, T035)', () => {
  it('is a string meta key', () => {
    expect(DISCRETE_STEP).toBe('mfbe-discrete-step');
  });

  it('typing, a DISCRETE_STEP transaction and typing again are three history events and three undo entries', async () => {
    const { services, controller, view } = await harness();
    type(view, 'a');
    insertDirectly(view, 'X', true);
    type(view, 'b');
    const state = controller.editorState!;
    expect(paragraphText(state.doc, 'n3')).toBe('HelloaXb');
    expect(undoDepth(state)).toBe(3);
    expect(bodyEntries(services)).toBe(3);
  });

  it('the same transactions without the meta merge into one event and one entry', async () => {
    const { services, controller, view } = await harness();
    type(view, 'a');
    insertDirectly(view, 'X', false);
    type(view, 'b');
    const state = controller.editorState!;
    expect(paragraphText(state.doc, 'n3')).toBe('HelloaXb');
    expect(undoDepth(state)).toBe(1);
    expect(bodyEntries(services)).toBe(1);
  });

  it('one Undo restores the exact document before the step and one Redo reapplies it', async () => {
    const { services, controller, store, view } = await harness();
    type(view, 'a');
    const beforeStep = controller.editorState!.doc;
    insertDirectly(view, 'X', true);
    const afterStep = controller.editorState!.doc;
    type(view, 'b');
    const afterTyping = controller.editorState!.doc;

    expect(services.undo.undo()).toBe(true); // the second typing burst
    expect(controller.editorState!.doc.eq(afterStep)).toBe(true);
    expect(services.undo.undo()).toBe(true); // the step, and nothing else
    expect(controller.editorState!.doc.eq(beforeStep)).toBe(true);
    expect(paragraphText(controller.editorState!.doc, 'n3')).toBe('Helloa');
    // The model follows the editor (the window is written back after every change).
    const p = store.getState().document!.bodies[0]!.content[0]!;
    expect(JSON.stringify(p)).toContain('"text":"Helloa"');

    expect(services.undo.redo()).toBe(true);
    expect(controller.editorState!.doc.eq(afterStep)).toBe(true);
    expect(services.undo.redo()).toBe(true);
    expect(controller.editorState!.doc.eq(afterTyping)).toBe(true);
  });

  it('a step after a command closes the group as well, and the meta on a selection alone changes nothing', async () => {
    const { services, controller, view } = await harness();
    // A selection-only transaction carrying the meta neither adds an event nor closes the
    // group of the typing around it.
    type(view, 'a');
    view.dispatch(view.state.tr.setMeta(DISCRETE_STEP, true));
    type(view, 'b');
    expect(undoDepth(controller.editorState!)).toBe(1);
    // Two steps in a row are two events.
    insertDirectly(view, 'X', true);
    insertDirectly(view, 'Y', true);
    expect(undoDepth(controller.editorState!)).toBe(3);
    expect(bodyEntries(services)).toBe(3);
  });

  it('a node created with controller.nextNodeId() keeps its id through nodeIdPlugin', async () => {
    const { store, controller, view } = await harness();
    const id = controller.nextNodeId();
    expect(id).toMatch(/^ui_\d+$/);
    const found = findNodeById(view.state.doc, 'n3')!;
    const after = found.pos + found.node.nodeSize;
    const stamped = N.p!.create({ nodeId: id }, fb2Schema.text('New'));
    view.dispatch(view.state.tr.insert(after, stamped).setMeta(DISCRETE_STEP, true));

    const doc = controller.editorState!.doc;
    expect(paragraphText(doc, id)).toBe('New');
    const ids: string[] = [];
    doc.descendants((node) => {
      if (node.type.spec.attrs?.nodeId) ids.push(String(node.attrs.nodeId));
    });
    expect(ids).toContain(id);
    expect(ids.every((nodeId) => nodeId.length > 0)).toBe(true);
    // The written-back model holds the paragraph under the same id.
    expect(JSON.stringify(store.getState().document!.bodies[0])).toContain(`"nodeId":"${id}"`);

    // A node without an id still gets one from the plugin - from the same generator, so the
    // two never collide.
    const unstamped = N.p!.create(null, fb2Schema.text('Plain'));
    const next = findNodeById(view.state.doc, id)!;
    view.dispatch(
      view.state.tr.insert(next.pos + next.node.nodeSize, unstamped).setMeta(DISCRETE_STEP, true),
    );
    const assigned: string[] = [];
    controller.editorState!.doc.descendants((node) => {
      if (node.type === N.p && node.textContent === 'Plain') assigned.push(node.attrs.nodeId);
    });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toMatch(/^ui_\d+$/);
    expect(assigned[0]).not.toBe(id);
    expect(controller.nextNodeId()).not.toBe(assigned[0]);
  });
});
