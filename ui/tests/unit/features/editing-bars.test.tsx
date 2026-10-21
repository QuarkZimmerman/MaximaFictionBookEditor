/**
 * Links bar / Table bar (T062) and Body view chrome (T057/T067): the bars follow the Body
 * selection and write attributes back; the Body view is editable, shows the context menu with
 * Cut / Copy / Paste / Select entries and publishes the selected text.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { LinksBar } from '@/app/LinksBar';
import { TableBar } from '@/app/TableBar';
import { AppProvider } from '@/app/AppContext';
import { createAppServices, type AppServices } from '@/app/services';
import { insertTable } from '@/editor/commands/table';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from './testUtils';

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  document.elementFromPoint = () => null;
});

function bookWithLink(): Document {
  const base = fakeDocument();
  const section: SectionNode = {
    type: 'section',
    attrs: { nodeId: 's1', id: 'chapter-1' },
    content: [
      {
        type: 'p',
        attrs: { nodeId: 'p1', id: 'para-1' },
        content: [
          { type: 'text', text: 'See ' },
          {
            type: 'text',
            text: 'the site',
            marks: [{ type: 'link', attrs: { href: 'http://a.example/' } }],
          },
          { type: 'text', text: ' now.' },
        ],
      },
      { type: 'image', attrs: { nodeId: 'img1', href: '#pic.jpg', title: 'A picture' } },
    ] as SectionNode['content'],
  };
  return { ...base, bodies: [{ type: 'body', attrs: { nodeId: 'b1' }, content: [section] }] };
}

async function renderShell(document: Document) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.get': new Error('none'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.position': {},
    'doc.close': {},
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(
    <AppProvider services={services}>
      <App services={services} startupSearch="" />
      <LinksBar />
      <TableBar />
    </AppProvider>,
  );
  actions.setConnection(store, 'connected');
  // The shell still renders the T062 placeholder bars: hide them, the real ones are above.
  act(() => actions.setToolbars(store, { links: false, table: false }));
  act(() => actions.setDocument(store, document));
  await screen.findByTestId('body-editor');
  return { store, services, user };
}

describe('Links bar and Table bar (T062)', () => {
  it('shows the ids / href / image title of the selection and writes edits back', async () => {
    const { store } = await renderShell(bookWithLink());
    const controller = getBodyController(store);
    expect(screen.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');

    // Caret in the paragraph: paragraph id, section id, no link, no image.
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('links-bar-id')).toHaveValue('para-1'));
    expect(screen.getByTestId('links-bar-section-id')).toHaveValue('chapter-1');
    expect(screen.getByTestId('links-bar-href')).toBeDisabled();
    expect(screen.getByTestId('links-bar-image-title')).toBeDisabled();
    expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'false');

    // Inside the link: the href is editable; a bare host gets http://.
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 6 }));
    await waitFor(() =>
      expect(screen.getByTestId('links-bar-href')).toHaveValue('http://a.example/'),
    );
    const href = screen.getByTestId('links-bar-href') as HTMLInputElement;
    fireEvent.focus(href);
    fireEvent.change(href, { target: { value: 'b.example/page' } });
    fireEvent.keyDown(href, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('links-bar-href')).toHaveValue('http://b.example/page'),
    );
    const paragraph = (store.getState().document!.bodies[0]!.content[0] as SectionNode)
      .content[0] as {
      content: { text: string; marks?: { attrs: { href: string } }[] }[];
    };
    expect(paragraph.content.find((c) => c.text === 'the site')!.marks![0]!.attrs.href).toBe(
      'http://b.example/page',
    );

    // The section id field renames the section.
    const sectionId = screen.getByTestId('links-bar-section-id');
    fireEvent.focus(sectionId);
    fireEvent.change(sectionId, { target: { value: 'ch1' } });
    fireEvent.blur(sectionId);
    await waitFor(() =>
      expect((store.getState().document!.bodies[0]!.content[0] as SectionNode).attrs.id).toBe(
        'ch1',
      ),
    );
  });

  it('binds the Table bar to the table / row / cell at the caret', async () => {
    const { store } = await renderShell(bookWithLink());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 2 }));
    act(() => void controller.execute(insertTable(1, true)));
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/table[1]/tr[1]/th[1]');
    const colspan = screen.getByTestId('table-bar-colspan');
    fireEvent.focus(colspan);
    fireEvent.change(colspan, { target: { value: '3' } });
    fireEvent.keyDown(colspan, { key: 'Enter' });
    fireEvent.change(screen.getByTestId('table-bar-td-align'), { target: { value: 'center' } });
    fireEvent.change(screen.getByTestId('table-bar-tr-align'), { target: { value: 'right' } });
    const tableId = screen.getByTestId('table-bar-table-id');
    fireEvent.focus(tableId);
    fireEvent.change(tableId, { target: { value: 't1' } });
    fireEvent.blur(tableId);
    await waitFor(() => {
      const section = store.getState().document!.bodies[0]!.content[0] as SectionNode;
      const table = section.content.find((c) => c.type === 'table') as {
        attrs: { id?: string };
        content: { attrs: { align?: string }; content: { attrs: Record<string, unknown> }[] }[];
      };
      expect(table.attrs.id).toBe('t1');
      expect(table.content[0]!.attrs.align).toBe('right');
      expect(table.content[0]!.content[0]!.attrs).toMatchObject({ colspan: 3, align: 'center' });
    });
    expect(screen.getByTestId('table-bar-colspan')).toHaveValue('3');
    // Clearing the span removes the attribute.
    fireEvent.focus(colspan);
    fireEvent.change(colspan, { target: { value: '' } });
    fireEvent.keyDown(colspan, { key: 'Enter' });
    await waitFor(() => {
      const section = store.getState().document!.bodies[0]!.content[0] as SectionNode;
      const table = section.content.find((c) => c.type === 'table') as {
        content: { content: { attrs: Record<string, unknown> }[] }[];
      };
      expect(table.content[0]!.content[0]!.attrs.colspan).toBeUndefined();
    });
  });
});

describe('Body view chrome (T057/T067)', () => {
  it('opens the context menu with Cut / Copy / Paste and Select entries and publishes the selection', async () => {
    const { store } = await renderShell(bookWithLink());
    const controller = getBodyController(store);
    act(() => void controller.selectRange('p1', 0, 3));
    await waitFor(() =>
      expect(screen.getByTestId('body-view')).toHaveAttribute('data-selected-text', 'See'),
    );
    fireEvent.contextMenu(screen.getByTestId('body-view'), { clientX: 10, clientY: 10 });
    const menu = await screen.findByTestId('context-menu');
    expect(menu).toHaveTextContent('Undo');
    expect(screen.getByTestId('context-menu-edit.cut')).toHaveTextContent('Cut');
    expect(screen.getByTestId('context-menu-edit.copy')).toHaveTextContent('Copy');
    expect(screen.getByTestId('context-menu-edit.paste')).toHaveTextContent('Paste');
    expect(screen.getByTestId('context-menu-select-3')).toHaveTextContent('Select p');
    expect(screen.getByTestId('context-menu-select-2')).toHaveTextContent('Select section');
    expect(screen.getByTestId('context-menu-select-1')).toHaveTextContent('Select body');
    const selected: string[] = [];
    const off = controller.subscribeContext(() =>
      selected.push(controller.getContext().selectedText),
    );
    fireEvent.click(screen.getByTestId('context-menu-select-2'));
    await waitFor(() => expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument());
    off();
    // The section's text got selected (jsdom's focus handling may move the caret afterwards).
    expect(selected.some((text) => text.includes('See the site now.'))).toBe(true);
    // Escape closes it too.
    fireEvent.contextMenu(screen.getByTestId('body-view'), { clientX: 10, clientY: 10 });
    fireEvent.keyDown(await screen.findByTestId('context-menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument());
  });

  it('renders images and unknown elements through their node views', async () => {
    const doc = bookWithLink();
    (doc.bodies[0]!.content[0] as SectionNode).content.push({
      type: 'raw-xml',
      attrs: { nodeId: 'raw1', xml: '<weird a="1"/>', inline: false },
    } as SectionNode['content'][number]);
    await renderShell(doc);
    const image = screen.getByTestId('body-image');
    expect(image).toHaveAttribute('data-href', '#pic.jpg');
    expect(image.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/binary/doc-1/pic.jpg/preview'),
    );
    expect(image.querySelector('figcaption')).toHaveTextContent('A picture');
    const unknown = screen.getByTestId('body-unknown');
    expect(unknown).toHaveTextContent('weird');
    expect(unknown).toHaveAttribute('contenteditable', 'false');
  });
});
