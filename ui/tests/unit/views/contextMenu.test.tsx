/**
 * The Body context menu on `PopupMenu` with the table section (feature 006, T045; FR-040,
 * FR-043; decision 2; C28, C29; U12, U13; data-model §9.3): today's entries in today's order
 * with today's test ids, then *Table…* everywhere and *Table structure ▸* for a click in a
 * table, whose submenu lists the 24 table commands in FR-039's order without accelerators; the
 * right-click rule; and an Edit letter running its entry.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextSelection } from 'prosemirror-state';

import { AppProvider } from '@/app/AppContext';
import { TABLE_COMMAND_NAMES } from '@/editor/table/commands';
import { tableEditingKey } from '@/editor/table/plugin';
import { CellBlockSelection } from '@/editor/table/selection';
import { ContextMenu } from '@/views/body/ContextMenu';
import { contextMenuExtensions, type ContextMenuClick } from '@/views/body/contextMenuExtensions';

import {
  modelTable,
  posOf,
  removeHarnessHosts,
  select,
  tableDocument,
  tablesHarness,
  type TablesHarness,
} from '../features/tablesHarness';

afterEach(() => {
  removeHarnessHosts();
});

/** A book with two tables, t1 (3 × 3) and t2 (2 × 2), between paragraphs. */
function twoTables() {
  const doc = tableDocument();
  const section = doc.bodies[0]!.content[0] as unknown as { content: unknown[] };
  section.content.push(modelTable('t2', 2, 2));
  return doc;
}

function clickAt(harness: TablesHarness, nodeId: string, offset = 1): ContextMenuClick {
  return { x: 20, y: 20, pos: posOf(harness, nodeId) + 1 + offset };
}

function openMenu(harness: TablesHarness, click: ContextMenuClick) {
  const onClose = vi.fn();
  render(
    <AppProvider services={harness.services}>
      <ContextMenu controller={harness.controller} click={click} onClose={onClose} />
    </AppProvider>,
  );
  return { menu: screen.getByTestId('context-menu'), onClose };
}

/** The menu's own children: entry test ids, `|` for a separator. */
function topLevel(menu: HTMLElement): string[] {
  return [...menu.children].map((child) =>
    child.getAttribute('role') === 'separator' ? '|' : (child.getAttribute('data-testid') ?? '?'),
  );
}

describe('the Body context menu', () => {
  it('is a PopupMenu with today’s entries, order and test ids, then the table section', async () => {
    const harness = await tablesHarness();
    const click = clickAt(harness, 't1-1-1');
    contextMenuExtensions.prepare!(harness.controller, click);
    const { menu } = openMenu(harness, click);
    expect(menu).toHaveClass('mfbe-popup-menu');
    const ids = topLevel(menu);
    expect(ids.slice(0, 6)).toEqual([
      'context-menu-edit.undo',
      '|',
      'context-menu-edit.cut',
      'context-menu-edit.copy',
      'context-menu-edit.paste',
      '|',
    ]);
    // One "Select <element>" entry per ancestor of the caret, innermost first: td … body.
    expect(ids.slice(6, 11)).toEqual([
      'context-menu-select-5',
      'context-menu-select-4',
      'context-menu-select-3',
      'context-menu-select-2',
      'context-menu-select-1',
    ]);
    expect(screen.getByTestId('context-menu-select-5')).toHaveTextContent('Select td');
    // The table section comes last, after a separator, and holds nothing else.
    expect(ids.slice(-3)).toEqual([
      '|',
      'context-menu-insert.table',
      'context-menu-tableStructure',
    ]);
    expect(screen.getByTestId('context-menu-insert.table')).toHaveTextContent('Table...');
    expect(screen.getByTestId('context-menu-tableStructure')).toHaveTextContent('Table structure');
    // The Edit entries' letters are live (underlined); the section's entries carry none.
    expect(within(screen.getByTestId('context-menu-edit.cut')).getByText('t').tagName).toBe('U');
    expect(
      within(screen.getByTestId('context-menu-insert.table')).queryByText(
        (_, el) => el?.tagName === 'U',
      ),
    ).toBeNull();
  });

  it('shows Table… for a click outside a table, without Table structure', async () => {
    const harness = await tablesHarness();
    const click = clickAt(harness, 'p1');
    contextMenuExtensions.prepare!(harness.controller, click);
    const { menu } = openMenu(harness, click);
    const ids = topLevel(menu);
    expect(ids.slice(-2)).toEqual(['|', 'context-menu-insert.table']);
    expect(screen.queryByTestId('context-menu-tableStructure')).toBeNull();
  });

  it('lists the 24 table commands in FR-039’s order with seven separators, without letters, disabled as stubs', async () => {
    const harness = await tablesHarness();
    const user = userEvent.setup();
    const click = clickAt(harness, 't1-0-0');
    contextMenuExtensions.prepare!(harness.controller, click);
    openMenu(harness, click);
    await user.click(screen.getByTestId('context-menu-tableStructure'));
    const popup = screen.getByTestId('context-menu-tableStructure-popup');
    const entries = within(popup).getAllByRole('menuitem');
    expect(entries.map((entry) => entry.getAttribute('data-testid'))).toEqual(
      TABLE_COMMAND_NAMES.map((name) => `context-menu-tableStructure-${name}`),
    );
    expect(within(popup).getAllByRole('separator')).toHaveLength(7);
    expect(popup.querySelector('u')).toBeNull();
    for (const entry of entries) expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('context-menu-tableStructure-insertRowBelow')).toHaveTextContent(
      'Insert row below',
    );
  });

  it('moves the caret into a clicked cell that does not hold the selection, also of another table', async () => {
    const harness = await tablesHarness(twoTables());
    const { controller } = harness;
    const state = () => controller.editorState!;
    // A caret in t1's first cell; a right-click in another cell of t1.
    select(harness, TextSelection.create(state().doc, posOf(harness, 't1-0-0') + 2));
    const entries = harness.services.undo.entries().length;
    let click = clickAt(harness, 't1-2-1', 3);
    contextMenuExtensions.prepare!(controller, click);
    expect(state().selection.head).toBe(click.pos);
    expect(state().selection.empty).toBe(true);
    // In a cell of the other table.
    click = clickAt(harness, 't2-1-0', 2);
    contextMenuExtensions.prepare!(controller, click);
    expect(state().selection.head).toBe(click.pos);
    // A selection change only: no undo step.
    expect(harness.services.undo.entries().length).toBe(entries);
    // In the cell that holds the selection: nothing changes.
    select(
      harness,
      TextSelection.create(state().doc, posOf(harness, 't2-1-0') + 1, posOf(harness, 't2-1-0') + 4),
    );
    const kept = state().selection;
    contextMenuExtensions.prepare!(controller, clickAt(harness, 't2-1-0', 2));
    expect(state().selection.eq(kept)).toBe(true);
  });

  it('keeps a block for a click inside it, and the caret for a click in a paragraph', async () => {
    const harness = await tablesHarness();
    const { controller, view } = harness;
    const block = CellBlockSelection.create(
      controller.editorState!.doc,
      posOf(harness, 't1-0-0'),
      posOf(harness, 't1-1-1'),
    );
    select(harness, block);
    contextMenuExtensions.prepare!(controller, clickAt(harness, 't1-1-0', 1));
    expect(controller.editorState!.selection.eq(block)).toBe(true);
    // The table plugin keeps the browser from moving its caret on a right-click - in the block
    // and anywhere else (C28: the menu's rules move it, `prepare` and *Table…*).
    const plugin = tableEditingKey.get(view.state)!;
    const mousedown = plugin.props.handleDOMEvents!.mousedown!;
    view.posAtCoords = () => ({ pos: posOf(harness, 't1-0-1') + 2, inside: -1 });
    const inside = new MouseEvent('mousedown', { button: 2, cancelable: true });
    expect(mousedown.call(plugin, view, inside)).toBe(true);
    expect(inside.defaultPrevented).toBe(true);
    view.posAtCoords = () => ({ pos: posOf(harness, 't1-2-2') + 2, inside: -1 });
    const outside = new MouseEvent('mousedown', { button: 2, cancelable: true });
    expect(mousedown.call(plugin, view, outside)).toBe(true);
    expect(outside.defaultPrevented).toBe(true);
    view.posAtCoords = () => ({ pos: posOf(harness, 'p1') + 2, inside: -1 });
    const inParagraph = new MouseEvent('mousedown', { button: 2, cancelable: true });
    expect(mousedown.call(plugin, view, inParagraph)).toBe(true);
    expect(inParagraph.defaultPrevented).toBe(true);
    expect(controller.editorState!.selection.eq(block)).toBe(true);
    // A click in a paragraph leaves the selection as it is.
    const caret = TextSelection.create(controller.editorState!.doc, posOf(harness, 'p2') + 2);
    select(harness, caret);
    contextMenuExtensions.prepare!(controller, clickAt(harness, 'p1', 3));
    expect(controller.editorState!.selection.eq(caret)).toBe(true);
  });

  it('runs an Edit entry by its letter', async () => {
    const harness = await tablesHarness();
    const user = userEvent.setup();
    const doc = harness.controller.editorState!.doc;
    select(harness, TextSelection.create(doc, posOf(harness, 'p1') + 1, posOf(harness, 'p1') + 4));
    const execute = vi.spyOn(harness.services.commands, 'execute').mockResolvedValue(true);
    const { menu, onClose } = openMenu(harness, clickAt(harness, 'p1', 2));
    expect(screen.getByTestId('context-menu-edit.copy')).not.toHaveAttribute('aria-disabled');
    menu.focus();
    await user.keyboard('c');
    expect(onClose).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith('edit.copy', expect.anything());
  });

  /** The harness's book with a body title (`btp`), where no table may stand. */
  function bookWithTitle() {
    const doc = tableDocument();
    (doc.bodies[0]!.content as unknown[]).unshift({
      type: 'title',
      attrs: { nodeId: 'bt' },
      content: [{ type: 'p', attrs: { nodeId: 'btp' }, content: [{ type: 'text', text: 'Book' }] }],
    });
    return doc;
  }

  it('judges Table… at the clicked point: enabled in a paragraph with the caret in the body title, disabled with its reason in the title', async () => {
    const harness = await tablesHarness(bookWithTitle());
    const { controller } = harness;
    const doc = controller.editorState!.doc;
    act(() => select(harness, TextSelection.create(doc, posOf(harness, 'btp') + 2)));
    const caret = controller.editorState!.selection;
    const click = clickAt(harness, 'p1', 3);
    contextMenuExtensions.prepare!(controller, click);
    openMenu(harness, click);
    const entry = screen.getByTestId('context-menu-insert.table');
    expect(entry).not.toHaveAttribute('aria-disabled');
    // Opening the menu moves nothing.
    expect(controller.editorState!.selection.eq(caret)).toBe(true);
  });

  it('shows Table… disabled with the noTablePlace title for a click in the body title', async () => {
    const harness = await tablesHarness(bookWithTitle());
    const { controller } = harness;
    act(() =>
      select(harness, TextSelection.create(controller.editorState!.doc, posOf(harness, 'p1') + 2)),
    );
    const click = clickAt(harness, 'btp', 2);
    contextMenuExtensions.prepare!(controller, click);
    openMenu(harness, click);
    const entry = screen.getByTestId('context-menu-insert.table');
    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(entry).toHaveAttribute('title', 'Insert table: no table may stand here');
    expect(entry).toHaveAttribute('aria-description', 'Insert table: no table may stand here');
  });

  it('running Table… moves the caret to the click first and opens the dialog', async () => {
    const harness = await tablesHarness(bookWithTitle());
    const user = userEvent.setup();
    const { controller } = harness;
    act(() =>
      select(harness, TextSelection.create(controller.editorState!.doc, posOf(harness, 'btp') + 2)),
    );
    const openCustom = vi.spyOn(harness.services.dialogs, 'openCustom').mockResolvedValue(null);
    const entries = harness.services.undo.entries().length;
    const click = clickAt(harness, 'p1', 3);
    contextMenuExtensions.prepare!(controller, click);
    openMenu(harness, click);
    await user.click(screen.getByTestId('context-menu-insert.table'));
    expect(openCustom).toHaveBeenCalledTimes(1);
    const selection = controller.editorState!.selection;
    expect(selection.empty).toBe(true);
    expect(selection.head).toBe(click.pos);
    // A selection change only: no undo step (the dialog was cancelled).
    expect(harness.services.undo.entries().length).toBe(entries);
  });

  it('keeps a non-empty selection for a click inside it and judges its end', async () => {
    const harness = await tablesHarness(bookWithTitle());
    const user = userEvent.setup();
    const { controller } = harness;
    const doc = controller.editorState!.doc;
    // From the body title into p1: the click in the title lies inside the selection, whose end
    // in p1 takes a table.
    const kept = TextSelection.create(doc, posOf(harness, 'btp') + 2, posOf(harness, 'p1') + 3);
    act(() => select(harness, kept));
    const openCustom = vi.spyOn(harness.services.dialogs, 'openCustom').mockResolvedValue(null);
    const click = clickAt(harness, 'btp', 3);
    contextMenuExtensions.prepare!(controller, click);
    openMenu(harness, click);
    const entry = screen.getByTestId('context-menu-insert.table');
    expect(entry).not.toHaveAttribute('aria-disabled');
    await user.click(entry);
    expect(openCustom).toHaveBeenCalledTimes(1);
    expect(controller.editorState!.selection.eq(kept)).toBe(true);
  });
});
