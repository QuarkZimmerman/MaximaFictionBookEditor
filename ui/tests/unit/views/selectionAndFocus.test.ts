/**
 * The Body controller's own updates and the browser's focus and selection:
 *
 * - A command run through `BodyEditorController.execute` while another element holds the focus
 *   (a menu, a bar's text field, a dialog) gives the editor the focus before its transaction
 *   reaches the view. ProseMirror scrolls to a selection only while it owns the DOM selection,
 *   which it writes on focus, and a focus taken after the transaction does not scroll - a
 *   command that moved the caret out of sight left it there (as `setCaret` and `selectRange`
 *   did before they focused first).
 * - A repaint the user did not cause (a changed setting) reads the browser selection before it
 *   builds its transaction: a click whose `selectionchange` event has not arrived yet - a task
 *   of its own, late on a loaded machine - is kept, where ProseMirror wrote the selection from
 *   before the click back into the page (`selectionSync.ts`).
 */

import { TextSelection, type Command } from 'prosemirror-state';

import { createAppServices } from '@/app/services';
import { findNodeById } from '@/editor/schema';
import { initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function attach<T extends HTMLElement>(element: T): T {
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

/** A mounted Body controller showing the paragraphs `n3` and `n4` with these texts. */
async function mountedController(first: string, last: string) {
  await initI18n({ language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.set': (params: unknown) => ({ settings: null, restartRequired: false, params }),
  });
  createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(
    store,
    fakeDocument({
      bodies: [
        {
          type: 'body',
          attrs: { nodeId: 'n1' },
          content: [
            {
              type: 'section',
              attrs: { nodeId: 'n2' },
              content: [
                { type: 'p', attrs: { nodeId: 'n3' }, content: [{ type: 'text', text: first }] },
                { type: 'p', attrs: { nodeId: 'n4' }, content: [{ type: 'text', text: last }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  const controller = getBodyController(store);
  controller.mount(attach(document.createElement('div')));
  return controller;
}

describe('a command run through execute while another element has the focus', () => {
  it('gives the editor the focus before its transaction is applied, so that it scrolls', async () => {
    const controller = await mountedController('First', 'Last');
    const view = controller.editorView!;
    const field = attach(document.createElement('input'));
    field.focus();
    expect(document.activeElement).toBe(field);

    // ProseMirror asks this prop to scroll only when the DOM selection is in the editor - when
    // it scrolls at all (`EditorView.scrollToSelection`); handled here, as jsdom has no layout.
    let scrolled = 0;
    view.setProps({
      handleScrollToSelection: () => {
        scrolled += 1;
        return true;
      },
    });

    const toLast: Command = (state, dispatch) => {
      const last = findNodeById(state.doc, 'n4')!;
      const end = last.pos + 1 + last.node.content.size;
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, end)).scrollIntoView());
      return true;
    };
    expect(controller.execute(toLast)).toBe(true);

    expect(scrolled).toBe(1);
    expect(document.activeElement).toBe(view.dom);
    expect(controller.editorState!.selection.$head.parent.attrs.nodeId).toBe('n4');
  });

  it('leaves the focus where it is when the command does not apply', async () => {
    const controller = await mountedController('First', 'Last');
    const field = attach(document.createElement('input'));
    field.focus();

    expect(controller.execute(() => false)).toBe(false);

    expect(document.activeElement).toBe(field);
  });
});

describe('a repaint the user did not cause', () => {
  it('keeps a click whose selectionchange has not arrived yet (a changed NBSP marker)', async () => {
    const controller = await mountedController('A\u00a0B', 'Last');
    const view = controller.editorView!;
    controller.focus();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the focus's own selectionchange
    const start = controller.editorState!.selection.head;

    // The click into "Last" (after "La"); its selectionchange is queued as a task.
    const paragraph = view.dom.querySelector('[data-node-id="n4"]')!;
    const last = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode()!;
    expect(last.textContent).toBe('Last');
    document.getSelection()!.collapse(last, 2);
    // Settings > Other: the NBSP shown as a square - the markers are drawn anew, at once.
    controller.setNbspChar('□');
    expect(view.dom.querySelectorAll('.fb-nbsp')).toHaveLength(1);

    const found = findNodeById(controller.editorState!.doc, 'n4')!;
    expect(start).not.toBe(found.pos + 3);
    expect(controller.editorState!.selection.head).toBe(found.pos + 3);
    expect(document.getSelection()!.focusNode).toBe(last);
    expect(document.getSelection()!.focusOffset).toBe(2);
  });
});
