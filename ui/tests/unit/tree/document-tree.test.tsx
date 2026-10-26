/**
 * T084 - the Document Tree panel inside the application shell: rows and captions, selection
 * sync tree -> Body (window move + caret) and Body -> tree, toolbar enable states, Move Right /
 * Delete through the commands (one undo entry each, Undo restores), context menu entries and
 * the View > Document Tree toggle persisted through `settings.set`. Feature 006 (US8, T126;
 * FR-058; decision 8; C61; U33): the row of an irregular table draws the Body mark's badge with
 * its name and tooltip, an entry that contains irregular tables one line per table.
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
    'doc.position': {},
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
    // Two block rows (feature 004), the body, its title, 50 sections with a title each, the
    // nested pair with their titles.
    expect(tree).toHaveAttribute('data-row-count', String(2 + 1 + 1 + 50 * 2 + 4));
    const rows = within(screen.getByTestId('tree-rows')).getAllByRole('treeitem');
    expect(rows[0]).toHaveAttribute('data-testid', 'tree-row-desc:annotation');
    expect(rows[0]).toHaveAttribute('data-row-kind', 'annotationBlock');
    expect(rows[0]).toHaveAttribute('data-depth', '0');
    expect(rows[0]).toHaveTextContent('Annotation');
    expect(rows[1]).toHaveAttribute('data-testid', 'tree-row-desc:history');
    expect(rows[1]).toHaveAttribute('data-row-kind', 'historyBlock');
    expect(rows[1]).toHaveTextContent('History');
    expect(rows[2]).toHaveAttribute('data-testid', 'tree-row-body1');
    expect(rows[2]).toHaveAttribute('data-row-kind', 'body');
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
    // The selection state survives hiding the panel (the Body caret still has a row: the editor
    // starts in the annotation block above the first body - feature 004).
    expect(getTreeFeature(store).selectedId).toBe('desc:annotation');
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006, US8 (T126): the tree marks                                  */
/* ------------------------------------------------------------------------ */

describe('Document Tree marks (feature 006, US8)', { timeout: 30_000 }, () => {
  const td = (nodeId: string, attrs: Record<string, unknown> = {}): ModelNodeJson => ({
    type: 'td',
    attrs: { nodeId, ...attrs },
    content: [text(nodeId)],
  });
  const tr = (nodeId: string, cells: ModelNodeJson[]): ModelNodeJson => ({
    type: 'tr',
    attrs: { nodeId },
    content: cells,
  });
  /** `[a, b] / [c]`. */
  const shortRow = (id: string, attrs: Record<string, unknown> = {}): ModelNodeJson => ({
    type: 'table',
    attrs: { nodeId: id, ...attrs },
    content: [tr(`${id}r0`, [td(`${id}a`), td(`${id}b`)]), tr(`${id}r1`, [td(`${id}c`)])],
  });
  /** `[a, b rowspan 2] / [c colspan 2]`. */
  const overlap = (id: string): ModelNodeJson => ({
    type: 'table',
    attrs: { nodeId: id },
    content: [
      tr(`${id}r0`, [td(`${id}a`), td(`${id}b`, { rowspan: 2 })]),
      tr(`${id}r1`, [td(`${id}c`, { colspan: 2 })]),
    ],
  });

  function marksBook(): Document {
    const body: ModelNodeJson = {
      type: 'body',
      attrs: { nodeId: 'body1' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 'S1' },
          content: [
            title('tS1', 'Tables'),
            p('pS1', 'Text'),
            shortRow('T1'),
            {
              type: 'table',
              attrs: { nodeId: 'T2' },
              content: [tr('T2r0', [td('T2a'), td('T2b')])],
            },
            {
              type: 'cite',
              attrs: { nodeId: 'C1' },
              content: [p('pC1', 'Cited'), overlap('T3'), shortRow('T4', { id: 'named' })],
            },
          ],
        },
      ],
    };
    return fakeDocument({ bodies: [body as unknown as BodyNode] });
  }

  it('a table row with problems draws the Body mark’s badge, name and tooltip and carries data-irregular; a containing entry lists one line per table, the named variant included; other rows draw none', async () => {
    await renderApp(marksBook());
    const tableRow = await screen.findByTestId('tree-row-T1');
    expect(tableRow).toHaveAttribute('data-irregular', 'true');
    const mark = screen.getByTestId('tree-row-T1-mark');
    expect(mark).toHaveAttribute('role', 'img');
    expect(mark).toHaveClass('mfbe-table-mark-badge');
    expect(mark).toHaveClass('mfbe-tree-mark');
    expect(mark).toHaveTextContent('!');
    expect(mark).toHaveAttribute('aria-label', 'Irregular table: row 2 covers 1 of 2 columns');
    expect(mark).toHaveAttribute(
      'title',
      'Row 2 covers 1 of 2 columns. Repair table makes the table regular.',
    );
    // The cite contains two irregular tables: one line each, in document order.
    const cite = screen.getByTestId('tree-row-C1');
    expect(cite).toHaveAttribute('data-irregular', 'true');
    const lines = [
      'Contains an irregular table: 1 overlapping span',
      'Contains an irregular table "named": row 2 covers 1 of 2 columns',
    ].join('\n');
    expect(screen.getByTestId('tree-row-C1-mark')).toHaveAttribute('title', lines);
    expect(screen.getByTestId('tree-row-C1-mark')).toHaveAttribute('aria-label', lines);
    // Every other row: no mark.
    for (const id of ['T2', 'S1', 'body1', 'desc:annotation', 'desc:history']) {
      expect(screen.getByTestId(`tree-row-${id}`), id).not.toHaveAttribute('data-irregular');
      expect(screen.queryByTestId(`tree-row-${id}-mark`), id).toBeNull();
    }
  });
});
