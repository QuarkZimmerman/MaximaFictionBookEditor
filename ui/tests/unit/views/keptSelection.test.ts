/**
 * A selection the Body controller keeps while its view is unmounted (another view visited): a
 * picture selected before is drawn selected as soon as the view mounts again, without the view
 * taking the focus - ProseMirror draws a node selection only when an update changes it, and the
 * commands (the Links bar's Href and Alt text, Cut) act on that selection meanwhile.
 */

import { NodeSelection } from 'prosemirror-state';

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

function host(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

describe('a node selection kept across an unmount of the Body view', () => {
  it('is drawn when the view mounts again, and the focus stays where it was', async () => {
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
                  {
                    type: 'p',
                    attrs: { nodeId: 'n3' },
                    content: [{ type: 'text', text: 'Hello' }],
                  },
                  { type: 'image', attrs: { nodeId: 'n4', href: '#pic.png' } },
                ],
              },
            ],
          },
        ],
      }),
    );
    const controller = getBodyController(store);
    const first = host();
    controller.mount(first);
    const view = controller.editorView!;
    const picture = findNodeById(view.state.doc, 'n4')!;
    controller.apply(view.state.tr.setSelection(NodeSelection.create(view.state.doc, picture.pos)));
    const figure = (element: HTMLElement) =>
      element.querySelector<HTMLElement>('[data-testid="body-image"]')!;
    expect(figure(first).classList.contains('fb-selected')).toBe(true);

    controller.unmount();
    const second = host();
    controller.mount(second);
    const selection = controller.editorState!.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.attrs.nodeId).toBe('n4');
    expect(figure(second).classList.contains('fb-selected')).toBe(true);
    expect(document.activeElement).not.toBe(controller.editorView!.dom);
  });
});
