/**
 * The context menu of a rich field of the Description view (feature 006, US10, T159; FR-044,
 * FR-040, FR-043; decision 2; C28, C29; U9, U12; data-model §9.3): Undo, Cut, Copy and Paste
 * first, then *Inline image…* with the caret in a cell of the field, then *Table…* always -
 * judged at the clicked point - and *Table structure ▸* for a click in a table, its popup the 24
 * table commands in FR-039's order with seven separators, no entry of the section with an
 * accelerator; the right-click rule on the field's target (`prepareTableClick`); Cut and Copy by
 * the field's own selection (a block although no text is selected in the page); *Paste* through
 * the field's router; and the plain field `description-book-title` with feature 002's four
 * entries.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextSelection } from 'prosemirror-state';

import { AppProvider } from '@/app/AppContext';
import { TABLE_STRUCTURE_ITEMS } from '@/app/menus';
import { hasSelectedText } from '@/app/textFields';
import { CellBlockSelection } from '@/editor/table/selection';
import { prepareTableClick } from '@/features/tables/contextMenu';
import { activateFieldTarget } from '@/features/tables/target';
import { actions } from '@/model/store';
import type { ContextMenuClick } from '@/views/body/contextMenuExtensions';
import { FieldContextMenu } from '@/views/description/FieldContextMenu';

import {
  fieldCaret,
  fieldHost,
  fieldPos,
  polyfillContentEditable,
  removeHarnessHosts,
  tablesHarness,
  type FieldHost,
  type TablesHarness,
} from '../features/tablesHarness';

beforeAll(() => {
  polyfillContentEditable();
});

afterEach(() => {
  cleanup();
  removeHarnessHosts();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

const KEY = 'documentInfo.history';
const ID = 'documentInfo-history';

/** The Description view with the history field's editor, its target active. */
async function setup(): Promise<{ harness: TablesHarness; field: FieldHost }> {
  const harness = await tablesHarness();
  actions.setActiveView(harness.store, 'description');
  const field = fieldHost(KEY);
  field.view.dom.focus();
  return { harness, field };
}

/** A click at the position `offset` into the node `nodeId` of the field. */
function clickAt(field: FieldHost, nodeId: string, offset = 1): ContextMenuClick {
  return { x: 20, y: 20, pos: fieldPos(field, nodeId) + 1 + offset };
}

/** As the Description view opens the menu: the field activated, the right-click rule applied. */
function openMenu(harness: TablesHarness, field: FieldHost, click: ContextMenuClick) {
  activateFieldTarget(field.key);
  prepareTableClick(field.target, click);
  const onClose = vi.fn();
  render(
    <AppProvider services={harness.services}>
      <FieldContextMenu field={field.view.dom} position={click} click={click} onClose={onClose} />
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

const EDIT_ENTRIES = [
  'context-menu-edit.undo',
  '|',
  'context-menu-edit.cut',
  'context-menu-edit.copy',
  'context-menu-edit.paste',
];

describe('the context menu of a rich field (feature 006, US10)', () => {
  it('in a paragraph: the four edit entries, then Table…; in a cell also Inline image… and Table structure', async () => {
    const { harness, field } = await setup();
    const paragraph = openMenu(harness, field, clickAt(field, `${ID}-p`, 2));
    expect(topLevel(paragraph.menu)).toEqual([...EDIT_ENTRIES, '|', 'context-menu-insert.table']);
    expect(screen.getByTestId('context-menu-insert.table')).toHaveTextContent('Table...');
    expect(screen.getByTestId('context-menu-insert.table')).not.toHaveAttribute('aria-disabled');
    cleanup();
    const cell = openMenu(harness, field, clickAt(field, `${ID}-t-1-0`, 2));
    expect(topLevel(cell.menu)).toEqual([
      ...EDIT_ENTRIES,
      '|',
      'context-menu-insert.inlineImage',
      '|',
      'context-menu-insert.table',
      'context-menu-tableStructure',
    ]);
    expect(screen.getByTestId('context-menu-insert.inlineImage')).toHaveTextContent(
      'Inline image...',
    );
    expect(screen.getByTestId('context-menu-insert.inlineImage')).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByTestId('context-menu-tableStructure')).toHaveTextContent('Table structure');
  });

  it('Table… is judged at the clicked point and says why it is unavailable: the field read-only gives noTarget', async () => {
    const { harness, field } = await setup();
    field.lock.readOnly = true;
    openMenu(harness, field, clickAt(field, `${ID}-p`, 1));
    const table = screen.getByTestId('context-menu-insert.table');
    expect(table).toHaveAttribute('aria-disabled', 'true');
    expect(table).toHaveAttribute(
      'title',
      'Insert table: place the caret in the Body view, in an annotation or history field, or in the Source view',
    );
  });

  it('Table structure lists the 24 table commands in FR-039’s order with seven separators; no entry of the section carries an accelerator (U12)', async () => {
    const { harness, field } = await setup();
    const user = userEvent.setup();
    openMenu(harness, field, clickAt(field, `${ID}-t-0-0`, 1));
    await user.hover(screen.getByTestId('context-menu-tableStructure'));
    const popup = screen.getByTestId('context-menu-tableStructure-popup');
    const entries = within(popup).getAllByRole('menuitem');
    expect(entries.map((entry) => entry.dataset.testid)).toEqual(
      TABLE_STRUCTURE_ITEMS.flatMap((item) =>
        item.kind === 'command'
          ? [`context-menu-tableStructure-${item.commandId.slice(item.commandId.indexOf('.') + 1)}`]
          : [],
      ),
    );
    expect(entries).toHaveLength(24);
    expect(within(popup).getAllByRole('separator')).toHaveLength(7);
    for (const id of [
      'context-menu-insert.inlineImage',
      'context-menu-insert.table',
      'context-menu-tableStructure',
    ]) {
      expect(screen.getByTestId(id).querySelector('u'), id).toBeNull();
    }
    for (const entry of entries) expect(entry.querySelector('u')).toBeNull();
    // A live command acts on the field's table.
    expect(screen.getByTestId('context-menu-tableStructure-insertRowBelow')).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.click(screen.getByTestId('context-menu-tableStructure-insertRowBelow'));
    expect(field.view.state.doc.nodeAt(fieldPos(field, `${ID}-t`))!.childCount).toBe(3);
  });

  it('the right-click rule (C28): a click in another cell takes the caret there before the menu shows; one inside the block keeps the block', async () => {
    const { field } = await setup();
    fieldCaret(field, `${ID}-p`, 2);
    const click = clickAt(field, `${ID}-t-1-1`, 2);
    prepareTableClick(field.target, click);
    expect(field.view.state.selection.head).toBe(click.pos);
    const { view } = field;
    view.dispatch(
      view.state.tr.setSelection(
        CellBlockSelection.create(
          view.state.doc,
          fieldPos(field, `${ID}-t-0-0`),
          fieldPos(field, `${ID}-t-1-1`),
        ),
      ),
    );
    const block = view.state.selection;
    prepareTableClick(field.target, clickAt(field, `${ID}-t-0-1`, 1));
    expect(view.state.selection).toBe(block);
    // A click outside any cell moves nothing.
    prepareTableClick(field.target, clickAt(field, `${ID}-p`, 1));
    expect(view.state.selection).toBe(block);
  });

  it('Cut and Copy follow the field’s own selection: enabled for a block although no text of the page is selected (U9)', async () => {
    const { harness, field } = await setup();
    const { view } = field;
    view.dispatch(
      view.state.tr.setSelection(
        CellBlockSelection.create(
          view.state.doc,
          fieldPos(field, `${ID}-t-0-0`),
          fieldPos(field, `${ID}-t-1-0`),
        ),
      ),
    );
    expect(hasSelectedText(view.dom)).toBe(false);
    openMenu(harness, field, clickAt(field, `${ID}-t-0-0`, 1));
    expect(screen.getByTestId('context-menu-edit.copy')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByTestId('context-menu-edit.cut')).not.toHaveAttribute('aria-disabled');
    cleanup();
    // A caret: nothing to cut or copy.
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, fieldPos(field, `${ID}-p`) + 2),
      ),
    );
    openMenu(harness, field, clickAt(field, `${ID}-p`, 1));
    expect(screen.getByTestId('context-menu-edit.copy')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('context-menu-edit.cut')).toHaveAttribute('aria-disabled', 'true');
  });

  it('Paste routes the whole clipboard through the field’s router: an HTML table goes after the paragraph', async () => {
    const { harness, field } = await setup();
    // user-event puts a clipboard stub of its own on `navigator`: set up first, then replace it.
    const user = userEvent.setup();
    const html = '<table><tr><td>x</td><td>y</td></tr><tr><td>z</td><td>w</td></tr></table>';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => [
          {
            types: ['text/html', 'text/plain'],
            getType: async (type: string) =>
              new Blob([type === 'text/html' ? html : 'x\ty\nz\tw'], { type }),
          },
        ],
        readText: async () => 'x\ty\nz\tw',
      },
    });
    fieldCaret(field, `${ID}-p`, 4);
    openMenu(harness, field, clickAt(field, `${ID}-p`, 4));
    await user.click(screen.getByTestId('context-menu-edit.paste'));
    await waitFor(() => {
      const types: string[] = [];
      field.view.state.doc.forEach((child) => types.push(child.type.name));
      expect(types).toEqual(['p', 'table', 'table']);
    });
    expect(field.view.state.doc.child(1).textContent).toBe('xyzw');
  });

  it('the plain field description-book-title keeps exactly feature 002’s four entries', async () => {
    const harness = await tablesHarness();
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'description-book-title');
    document.body.appendChild(input);
    try {
      render(
        <AppProvider services={harness.services}>
          <FieldContextMenu field={input} position={{ x: 10, y: 10 }} onClose={() => {}} />
        </AppProvider>,
      );
      expect(topLevel(screen.getByTestId('context-menu'))).toEqual(EDIT_ENTRIES);
    } finally {
      input.remove();
    }
  });
});
