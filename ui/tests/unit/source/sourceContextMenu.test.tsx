/**
 * *Table…* in the Source view's context menu (feature 006, T055 for T068; FR-061, FR-040,
 * FR-043; C28; U35; data-model §9.3): `source-context-menu-insert.table`, labelled
 * `tables.contextMenu.table` without an accelerator, after *Select All* and before the
 * assistant's separator and entry, with the assistant on and off; judged at the clicked point
 * - the `point` the view takes with `controller.pointAt` at the right-click -, enabled for an
 * `ok` verdict while the editor is writable, otherwise disabled with `title` and
 * `aria-description` = `unavailableTitle` of the `tables.reason.source.<code>` text or of the
 * registry's run-lock text; opening the menu moves no cursor, running the entry moves the
 * cursor to the clicked point first (unless the click kept a selection) and then executes
 * `insert.table`; the other entries are unchanged.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

import { AppProvider } from '@/app/AppContext';
import { unavailableTitle } from '@/app/commands';
import { actions } from '@/model/store';
import { SourceContextMenu } from '@/views/source/SourceContextMenu';
import type { SourcePointAt } from '@/views/source/sourceEditor';

import { fakeRunLock } from '../features/testUtils';
import {
  POINTS,
  SOURCE_BOOK,
  offsetIn,
  removeSourceHosts,
  selectSource,
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

/** The point a right-click at `offset` gives (the view's `posAtCoords` there). */
function pointAt(h: SourceHarness, offset: number): SourcePointAt {
  vi.spyOn(h.controller.editorView!, 'posAtCoords').mockReturnValue(offset);
  return h.controller.pointAt({ x: 30, y: 40 });
}

function openMenu(h: SourceHarness, point: SourcePointAt) {
  const onClose = vi.fn();
  const view = render(
    <AppProvider services={h.services}>
      <SourceContextMenu
        controller={h.controller}
        position={{ x: 30, y: 40 }}
        point={point}
        onClose={onClose}
      />
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

const entry = () => screen.getByTestId('source-context-menu-insert.table');

function titleOf(h: SourceHarness, reason: string): string {
  return unavailableTitle(h.services.commands.get('insert.table')!, reason, i18next.t);
}

describe('the Source context menu’s Table… entry', () => {
  it('comes after Select All, labelled Table... without an accelerator; the assistant’s entry stays last', async () => {
    const h = await sourceHarness();
    const { menu, view } = openMenu(h, pointAt(h, POINTS.between));
    expect(topLevel(menu)).toEqual([...TODAY, '|', 'source-context-menu-insert.table']);
    expect(entry()).toHaveTextContent(i18next.t('tables.contextMenu.table'));
    expect(entry()).toHaveTextContent('Table...');
    expect(within(entry()).queryByText((_, el) => el?.tagName === 'U')).toBeNull();
    // The other entries are today's: labels and letters unchanged.
    for (const id of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']) {
      expect(screen.getByTestId(`source-context-menu-${id}`)).toHaveTextContent(
        i18next.t(`source.contextMenu.${id}`),
      );
    }
    view.unmount();

    h.store.setState({ ai: { ...h.store.getState().ai, on: true } });
    const again = openMenu(h, pointAt(h, POINTS.between));
    expect(topLevel(again.menu)).toEqual([
      ...TODAY,
      '|',
      'source-context-menu-insert.table',
      '|',
      'source-context-menu-ai.ask',
    ]);
  });

  it('is enabled for an ok verdict at the clicked point, although the cursor is elsewhere', async () => {
    const h = await sourceHarness();
    selectSource(h.controller, POINTS.inText);
    expect(h.controller.tablePoint().code).toBe('inText');
    openMenu(h, pointAt(h, POINTS.between));
    expect(entry()).not.toHaveAttribute('aria-disabled');
    expect(entry()).not.toHaveAttribute('title');
    // Opening the menu moved nothing.
    expect(h.controller.state.selection.main.head).toBe(POINTS.inText);
  });

  it.each([
    ['inText', POINTS.inText, {}],
    ['inTag', POINTS.inTag, {}],
    ['notAllowed', POINTS.titleEpigraph, { element: 'section' }],
    ['outsideRoot', POINTS.outside, {}],
  ] as const)(
    'is disabled with the reason of the verdict at the clicked point: %s',
    async (code, offset, params) => {
      const h = await sourceHarness();
      selectSource(h.controller, POINTS.between);
      const point = pointAt(h, offset);
      expect(point.verdict.code).toBe(code);
      openMenu(h, point);
      expect(entry()).toHaveAttribute('aria-disabled', 'true');
      const title = titleOf(h, i18next.t(`tables.reason.source.${code}`, params));
      expect(entry()).toHaveAttribute('title', title);
      expect(entry()).toHaveAttribute('aria-description', title);
      expect(title).toContain(i18next.t('cmd.insert.table.tooltip'));
    },
  );

  it('is disabled with the run lock’s text while a script or a request runs', async () => {
    const h = await sourceHarness();
    actions.setRunLock(h.store, fakeRunLock('script'));
    openMenu(h, pointAt(h, POINTS.between));
    expect(entry()).toHaveAttribute('aria-disabled', 'true');
    expect(entry()).toHaveAttribute(
      'title',
      titleOf(h, i18next.t('commands.unavailable.runLock.script')),
    );
  });

  it('moves the cursor to the clicked point first, then executes insert.table', async () => {
    const h = await sourceHarness();
    const user = userEvent.setup();
    selectSource(h.controller, POINTS.inText);
    const seen: { id: string; head: number; empty: boolean }[] = [];
    vi.spyOn(h.services.commands, 'execute').mockImplementation((id) => {
      const main = h.controller.state.selection.main;
      seen.push({ id, head: main.head, empty: main.empty });
      return Promise.resolve(true);
    });
    const { onClose } = openMenu(h, pointAt(h, POINTS.between2));
    await user.click(entry());
    expect(seen).toEqual([{ id: 'insert.table', head: POINTS.between2, empty: true }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a selection the click lay in and judges its end', async () => {
    const h = await sourceHarness();
    const user = userEvent.setup();
    const start = offsetIn(SOURCE_BOOK, '\t\t\t<p>First');
    selectSource(h.controller, start, POINTS.between);
    const point = pointAt(h, offsetIn(SOURCE_BOOK, 'First'));
    expect(point.moveTo).toBeNull();
    expect(point.verdict.code).toBe('ok');
    const seen: { anchor: number; head: number }[] = [];
    vi.spyOn(h.services.commands, 'execute').mockImplementation(() => {
      const { anchor, head } = h.controller.state.selection.main;
      seen.push({ anchor, head });
      return Promise.resolve(true);
    });
    openMenu(h, point);
    expect(entry()).not.toHaveAttribute('aria-disabled');
    await user.click(entry());
    expect(seen).toEqual([{ anchor: start, head: POINTS.between }]);
  });

  it('runs nothing when disabled', async () => {
    const h = await sourceHarness();
    const user = userEvent.setup();
    const execute = vi.spyOn(h.services.commands, 'execute');
    openMenu(h, pointAt(h, POINTS.inText));
    await user.click(entry());
    expect(execute).not.toHaveBeenCalledWith('insert.table', expect.anything());
    expect(h.controller.state.selection.main.head).not.toBe(POINTS.inText);
  });
});
