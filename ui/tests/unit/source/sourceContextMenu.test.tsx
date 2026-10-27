/**
 * The Source view's context menu after the requester's issue #8 (feature 006): *Table…* is not
 * offered there any more - inserting a table is an Add-menu operation (*Add → Table*, the
 * toolbar button and its hotkey) - so the menu holds today's entries only: Undo, Redo, Cut,
 * Copy, Paste, Delete and Select All, and *Ask AI...* after them while the assistant is on.
 */

import { render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { AppProvider } from '@/app/AppContext';
import { SourceContextMenu } from '@/views/source/SourceContextMenu';

import {
  removeSourceHosts,
  sourceHarness,
  stubRangeRects,
  type SourceHarness,
} from './sourceHarness';

beforeAll(() => {
  stubRangeRects();
});

afterEach(() => {
  removeSourceHosts();
});

function openMenu(h: SourceHarness) {
  const onClose = vi.fn();
  const view = render(
    <AppProvider services={h.services}>
      <SourceContextMenu controller={h.controller} position={{ x: 30, y: 40 }} onClose={onClose} />
    </AppProvider>,
  );
  return { menu: screen.getByTestId('source-context-menu'), onClose, view };
}

/** The menu's own children: entry test ids, `|` for a separator. */
function topLevel(menu: HTMLElement): string[] {
  return [...menu.children].map((child) =>
    child.getAttribute('role') === 'separator' ? '|' : (child.getAttribute('data-testid') ?? '?'),
  );
}

const TODAY = [
  'source-context-menu-undo',
  'source-context-menu-redo',
  '|',
  'source-context-menu-cut',
  'source-context-menu-copy',
  'source-context-menu-paste',
  'source-context-menu-delete',
  '|',
  'source-context-menu-selectAll',
];

describe('the Source context menu (issue #8: no Table… entry)', () => {
  it('holds today’s entries only, with their labels; with the assistant on, Ask AI follows Select All', async () => {
    const h = await sourceHarness();
    const { menu, view } = openMenu(h);
    expect(topLevel(menu)).toEqual(TODAY);
    expect(screen.queryByTestId('source-context-menu-insert.table')).toBeNull();
    for (const id of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']) {
      expect(screen.getByTestId(`source-context-menu-${id}`)).toHaveTextContent(
        i18next.t(`source.contextMenu.${id}`),
      );
    }
    view.unmount();

    h.store.setState({ ai: { ...h.store.getState().ai, on: true } });
    const again = openMenu(h);
    expect(topLevel(again.menu)).toEqual([...TODAY, '|', 'source-context-menu-ai.ask']);
    expect(screen.queryByTestId('source-context-menu-insert.table')).toBeNull();
  });
});
