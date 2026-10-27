/**
 * The Body context menu on `PopupMenu` with the table section (feature 006, T045; FR-040,
 * FR-043; decision 2; C28, C29; U12, U13; data-model §9.3): today's entries in today's order
 * with today's test ids, then *Table…* everywhere and *Table structure ▸* for a click in a
 * table, whose submenu lists the 24 table commands in FR-039's order without accelerators; the
 * right-click rule; and an Edit letter running its entry.
 */

import { act, cleanup, render, screen, within } from '@testing-library/react';
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
    // The table section comes last, after a separator: Table structure only (issue #8: no
    // Table…, inserting a table is an Add-menu operation).
    expect(ids.slice(-2)).toEqual(['|', 'context-menu-tableStructure']);
    expect(screen.queryByTestId('context-menu-insert.table')).toBeNull();
    expect(screen.getByTestId('context-menu-tableStructure')).toHaveTextContent('Table structure');
    // The Edit entries' letters are live (underlined); the section's entry carries none.
    expect(within(screen.getByTestId('context-menu-edit.cut')).getByText('t').tagName).toBe('U');
    expect(
      within(screen.getByTestId('context-menu-tableStructure')).queryByText(
        (_, el) => el?.tagName === 'U',
      ),
    ).toBeNull();
  });

  it('has no table section for a click outside a table (issue #8: no Table…)', async () => {
    const harness = await tablesHarness();
    const click = clickAt(harness, 'p1');
    contextMenuExtensions.prepare!(harness.controller, click);
    const { menu } = openMenu(harness, click);
    const ids = topLevel(menu);
    expect(ids).not.toContain('context-menu-insert.table');
    expect(ids.at(-1)).not.toBe('|');
    expect(screen.queryByTestId('context-menu-tableStructure')).toBeNull();
  });

  it('lists the 24 table commands in FR-039’s order with seven separators, without letters; live ones by their availability, stubs disabled', async () => {
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
    // US2's twelve commands are live (T075): enabled in the first cell of the 3 × 3 table but
    // the moves up and to the left, which have no neighbour there; US5's Merge cells and Split
    // cell are live too (T105) and refuse a single unmerged cell with their reasons; US6's five
    // header commands are live (T110) and take any cell; US8's Repair table is live (T128) and
    // refuses this regular table with its reason; US9's Select table, Delete table and the two
    // paragraph commands are live (T149) and take the caret's table.
    const live = new Set([
      'insertRowAbove',
      'insertRowBelow',
      'deleteRow',
      'insertColumnLeft',
      'insertColumnRight',
      'deleteColumn',
      'toggleHeaderCell',
      'makeHeaderCells',
      'makeNormalCells',
      'toggleHeaderRow',
      'toggleHeaderColumn',
      'moveRowDown',
      'moveColumnRight',
      'duplicateRow',
      'duplicateColumn',
      'select',
      'delete',
      'paragraphBefore',
      'paragraphAfter',
    ]);
    entries.forEach((entry, index) => {
      const name = TABLE_COMMAND_NAMES[index]!;
      if (live.has(name)) expect(entry, name).not.toHaveAttribute('aria-disabled');
      else expect(entry, name).toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.getByTestId('context-menu-tableStructure-moveRowUp')).toHaveAttribute(
      'title',
      'Move row up: there is no row above',
    );
    expect(screen.getByTestId('context-menu-tableStructure-mergeCells')).toHaveAttribute(
      'title',
      'Merge cells: select a block of at least two cells',
    );
    expect(screen.getByTestId('context-menu-tableStructure-splitCell')).toHaveAttribute(
      'title',
      'Split cell: the cell is not merged',
    );
    expect(screen.getByTestId('context-menu-tableStructure-repair')).toHaveAttribute(
      'title',
      'Repair table: the table has nothing to repair',
    );
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

  it('offers Table… nowhere (issue #8): not in a paragraph, not in a cell, not with a selection', async () => {
    const harness = await tablesHarness();
    const { controller } = harness;
    for (const [id, offset] of [
      ['p1', 3],
      ['t1-1-1', 0],
    ] as const) {
      const click = clickAt(harness, id, offset);
      contextMenuExtensions.prepare!(controller, click);
      const { menu } = openMenu(harness, click);
      expect(topLevel(menu)).not.toContain('context-menu-insert.table');
      cleanup();
    }
    const doc = controller.editorState!.doc;
    act(() =>
      select(
        harness,
        TextSelection.create(doc, posOf(harness, 'p1') + 1, posOf(harness, 'p1') + 4),
      ),
    );
    const click = clickAt(harness, 'p1', 2);
    contextMenuExtensions.prepare!(controller, click);
    openMenu(harness, click);
    expect(screen.queryByTestId('context-menu-insert.table')).toBeNull();
  });
});
