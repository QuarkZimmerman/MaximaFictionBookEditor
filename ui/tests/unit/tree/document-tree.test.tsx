/**
 * T084 - the Document Tree panel inside the application shell: rows and captions, selection
 * sync tree -> Body (window move + caret) and Body -> tree, toolbar enable states, Move Right /
 * Delete through the commands (one undo entry each, Undo restores), context menu entries and
 * the View > Document Tree toggle persisted through `settings.set`.
 */

import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { createAppServices, type AppServices } from '@/app/services';
import type { ModelNodeJson } from '@/editor/fromModel';
import { getTreeFeature } from '@/features/tree';
import { changeLanguage, initI18n } from '@/i18n';
import type { BodyNode, Document } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';

configure({ asyncUtilTimeout: 5000 });

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

const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const p = (nodeId: string, value: string): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId },
  content: [text(value)],
});
const title = (nodeId: string, value: string): ModelNodeJson => ({
  type: 'title',
  attrs: { nodeId },
  content: [p(`${nodeId}p`, value)],
});

/** 50 top-level sections (windowed mode) with a nested pair in the first one. */
function largeBook(): Document {
  const sections: ModelNodeJson[] = [];
  for (let i = 1; i <= 50; i += 1) {
    const content: ModelNodeJson[] = [title(`t${i}`, `Chapter ${i}`)];
    if (i === 1) {
      content.push(
        {
          type: 'section',
          attrs: { nodeId: 's1a' },
          content: [title('t1a', 'Part 1a'), p('p1a', 'Nested 1a')],
        },
        {
          type: 'section',
          attrs: { nodeId: 's1b' },
          content: [title('t1b', 'Part 1b'), p('p1b', 'Nested 1b')],
        },
      );
    } else {
      content.push(p(`p${i}`, `Paragraph of chapter ${i}`));
    }
    sections.push({ type: 'section', attrs: { nodeId: `s${i}` }, content });
  }
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body1' },
    content: [title('tBody', 'Big book'), ...sections],
  };
  return fakeDocument({ bodies: [body as unknown as BodyNode] });
}

async function renderApp(doc: Document) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.get': new Error('no settings'),
    'settings.set': (params: unknown) => ({ settings: params, restartRequired: false }),
    'doc.recent': [],
    'doc.watch': {},
    'doc.caret': {},
    'doc.close': {},
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(<App services={services} startupSearch="" />);
  act(() => {
    actions.setConnection(store, 'connected');
    actions.setDocument(store, doc);
  });
  await screen.findByTestId('body-editor');
  return { store, services, rpc, user };
}

describe('Document Tree panel', { timeout: 30_000 }, () => {
  it('renders the hierarchy with captions and section count; a click selects the element in the Body', async () => {
    const { store, user } = await renderApp(largeBook());
    const tree = screen.getByTestId('tree-content');
    expect(tree).toHaveAttribute('data-section-count', '52');
    expect(tree).toHaveAttribute('data-row-count', String(1 + 1 + 50 * 2 + 4));
    expect(screen.getByTestId('tree-row-body1')).toHaveTextContent('Big book');
    expect(screen.getByTestId('tree-row-s1')).toHaveTextContent('Chapter 1');
    expect(screen.getByTestId('tree-row-s1a')).toHaveAttribute('data-depth', '2');
    // Virtualised: not every row of the 50-section book is in the DOM.
    expect(screen.queryByTestId('tree-row-s50')).toBeNull();

    // The default window mounts the first sections only; clicking a row far below moves it.
    const controller = getBodyController(store);
    expect(controller.currentWindow?.wholeBook).toBe(false);
    const target = 's1b';
    await user.click(screen.getByTestId(`tree-row-${target}`));
    expect(screen.getByTestId(`tree-row-${target}`)).toHaveAttribute('data-selected', 'true');
    await waitFor(() =>
      expect(store.getState().selectionPath).toMatch(/^body\[1\]\/section\[1\]\/section\[2\]/),
    );
    expect(tree).toHaveAttribute('data-selected-id', target);
  });

  it('follows the Body caret (innermost row) and keyboard navigation moves the Body selection', async () => {
    const { store, user } = await renderApp(largeBook());
    const controller = getBodyController(store);
    act(() => {
      controller.setCaret({ view: 'body', nodeId: 'p3', offset: 2 });
    });
    await waitFor(() =>
      expect(screen.getByTestId('tree-row-s3')).toHaveAttribute('data-selected', 'true'),
    );
    // A caret inside a title selects the title row.
    act(() => {
      controller.setCaret({ view: 'body', nodeId: 't4p', offset: 1 });
    });
    await waitFor(() =>
      expect(screen.getByTestId('tree-row-t4')).toHaveAttribute('data-selected', 'true'),
    );
    const tree = screen.getByTestId('tree-content');
    tree.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('tree-row-s5')).toHaveAttribute('data-selected', 'true');
    await waitFor(() => expect(store.getState().selectionPath).toMatch(/^body\[1\]\/section\[5\]/));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('tree-row-s5')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tree-row-t5')).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('tree-row-t5')).toBeInTheDocument();
  });

  it('Move Right / Delete run through the toolbar as single undo entries', async () => {
    const { store, services, user } = await renderApp(largeBook());
    await user.click(screen.getByTestId('tree-row-s2'));
    expect(screen.getByTestId('tree-toolbar-right')).toBeEnabled();
    expect(screen.getByTestId('tree-toolbar-left')).toBeDisabled(); // top level
    expect(screen.getByTestId('tree-toolbar-merge')).toBeEnabled();
    const depthBefore = services.undo.undoDepth;
    await user.click(screen.getByTestId('tree-toolbar-right'));
    await waitFor(() =>
      expect(screen.getByTestId('tree-row-s2')).toHaveAttribute('data-depth', '2'),
    );
    expect(services.undo.undoDepth).toBe(depthBefore + 1);
    const body = store.getState().document!.bodies[0]!;
    const s1 = body.content.find((c) => c.attrs.nodeId === 's1')!;
    expect((s1 as unknown as ModelNodeJson).content!.map((c) => String(c.attrs?.nodeId))).toEqual([
      't1',
      's1a',
      's1b',
      's2',
    ]);
    expect(screen.getByTestId('status-message')).toHaveTextContent('Section moved.');

    // Undo restores the previous structure (one entry).
    act(() => {
      services.undo.undo();
    });
    await waitFor(() =>
      expect(screen.getByTestId('tree-row-s2')).toHaveAttribute('data-depth', '1'),
    );
    expect(services.undo.undoDepth).toBe(depthBefore);

    // Delete asks for confirmation; "Yes" removes the section.
    await user.click(screen.getByTestId('tree-row-s1a'));
    await user.click(screen.getByTestId('tree-toolbar-delete'));
    const prompt = await screen.findByTestId('tree-delete-confirm');
    expect(prompt).toHaveTextContent('Delete selected node?');
    await user.click(within(prompt).getByTestId('tree-delete-confirm-button-yes'));
    await waitFor(() => expect(screen.queryByTestId('tree-row-s1a')).toBeNull());
    expect(screen.getByTestId('tree-row-s1b')).toHaveAttribute('data-selected', 'true');
  });

  it('shows the IDR_DOCUMENT_TREE context menu with enable states', async () => {
    const { user } = await renderApp(largeBook());
    fireEvent.contextMenu(screen.getByTestId('tree-row-s1'), { clientX: 10, clientY: 10 });
    const menu = await screen.findByTestId('tree-menu');
    expect(within(menu).getByTestId('tree-menu-view')).toHaveTextContent('View');
    expect(within(menu).getByTestId('tree-menu-viewSource')).toHaveTextContent('View Source');
    expect(within(menu).getByTestId('tree-menu-moveRight')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menu).getByTestId('tree-menu-moveWithChildren')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menu).getByTestId('tree-menu-moveLeft')).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByTestId('tree-menu-merge')).not.toHaveAttribute('aria-disabled');
    expect(within(menu).getByTestId('tree-menu-delete')).not.toHaveAttribute('aria-disabled');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('tree-menu')).toBeNull();
  });

  it('View > Document Tree toggles the panel and persists session.treeVisible', async () => {
    const { rpc, user, store } = await renderApp(largeBook());
    await user.click(screen.getByTestId('menu-view'));
    await user.click(screen.getByTestId('menu-view-tree'));
    expect(screen.queryByTestId('tree-panel')).toBeNull();
    await waitFor(() =>
      expect(rpc.calls.find((call) => call.method === 'settings.set')?.params).toEqual({
        patch: { session: { treeVisible: false } },
      }),
    );
    // The selection state survives hiding the panel (the Body caret still has a row).
    expect(getTreeFeature(store).selectedId).toBe('tBody');
  });
});
