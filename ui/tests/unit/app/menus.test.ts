/**
 * *Edit → Table structure* (feature 006, T043; FR-039, SC-008; U12, C32; data-model §9.1, §9.2):
 * the one list of the 24 table commands in the eight groups of FR-039, the Add menu's submenu
 * right after *Table*, its derived test ids, its English labels, its disabled stubs and the
 * accelerator letters live inside the open submenu. US10 (T159; C30; data-model §6.2): the Add
 * menu follows the active description field - *Table*, the live table commands and *Inline
 * image* with the caret in a field cell, no *Inline image* in a field paragraph.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

import { App } from '@/app/App';
import { createCommandRegistry } from '@/app/commands';
import { MAIN_MENU, TABLE_STRUCTURE_ITEMS, type MenuItemSpec } from '@/app/menus';
import { createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';

import {
  fieldCaret,
  fieldHost,
  removeHarnessHosts,
  tablesHarness,
} from '../features/tablesHarness';

/** The groups of FR-039 (data-model §9.1), in order. */
const GROUPS: readonly (readonly string[])[] = [
  ['table.insertRowAbove', 'table.insertRowBelow', 'table.deleteRow'],
  ['table.insertColumnLeft', 'table.insertColumnRight', 'table.deleteColumn'],
  ['table.mergeCells', 'table.splitCell'],
  [
    'table.toggleHeaderCell',
    'table.makeHeaderCells',
    'table.makeNormalCells',
    'table.toggleHeaderRow',
    'table.toggleHeaderColumn',
  ],
  ['table.repair'],
  ['table.select', 'table.delete'],
  [
    'table.moveRowUp',
    'table.moveRowDown',
    'table.moveColumnLeft',
    'table.moveColumnRight',
    'table.duplicateRow',
    'table.duplicateColumn',
  ],
  ['table.paragraphBefore', 'table.paragraphAfter'],
];

const ENGLISH_LABELS = [
  'Insert row above',
  'Insert row below',
  'Delete row',
  'Insert column to the left',
  'Insert column to the right',
  'Delete column',
  'Merge cells',
  'Split cell',
  'Toggle header cell',
  'Make header cells',
  'Make normal cells',
  'Toggle header row',
  'Toggle header column',
  'Repair table',
  'Select table',
  'Delete table',
  'Move row up',
  'Move row down',
  'Move column left',
  'Move column right',
  'Duplicate row',
  'Duplicate column',
  'Paragraph before table',
  'Paragraph after table',
];

/** The command ids of a list, split at its separators. */
function groupsOf(items: readonly MenuItemSpec[]): string[][] {
  const groups: string[][] = [[]];
  for (const item of items) {
    if (item.kind === 'separator') groups.push([]);
    else if (item.kind === 'command') groups[groups.length - 1]!.push(item.commandId);
    else throw new Error(`unexpected ${item.kind} in TABLE_STRUCTURE_ITEMS`);
  }
  return groups;
}

describe('Edit → Table structure (feature 006)', () => {
  it('TABLE_STRUCTURE_ITEMS holds exactly the 24 ids of the group table, in FR-039 order, with seven separators between the eight groups', () => {
    expect(groupsOf(TABLE_STRUCTURE_ITEMS)).toEqual(GROUPS);
    expect(TABLE_STRUCTURE_ITEMS.filter((item) => item.kind === 'separator')).toHaveLength(7);
    const registry = createCommandRegistry();
    const ids = TABLE_STRUCTURE_ITEMS.flatMap((item) =>
      item.kind === 'command' ? [item.commandId] : [],
    );
    expect(ids).toEqual(registry.byGroup('table').map((command) => command.id));
    expect(ids).toHaveLength(24);
  });

  it('the Edit menu ends with the submenu after a separator, the Add menu has none (issue #6); Table keeps its label key', () => {
    const edit = MAIN_MENU.find((menu) => menu.id === 'edit')!;
    expect(edit.items.at(-2)).toEqual({ kind: 'separator' });
    expect(edit.items.at(-1)).toEqual({
      kind: 'submenu',
      id: 'tableStructure',
      labelKey: 'menu.edit.tableStructure',
      items: TABLE_STRUCTURE_ITEMS,
    });
    const add = MAIN_MENU.find((menu) => menu.id === 'add')!;
    expect(add.items.some((item) => item.kind === 'submenu' && item.id === 'tableStructure')).toBe(
      false,
    );
    const index = add.items.findIndex(
      (item) => item.kind === 'command' && item.commandId === 'insert.table',
    );
    expect(index).toBeGreaterThan(0);
    expect(add.items[index + 1]).toEqual({ kind: 'command', commandId: 'insert.sectionImage' });
    const registry = createCommandRegistry();
    expect(registry.get('insert.table')!.labelKey).toBe('menu.add.table'); // C32
  });

  it('renders the submenu with its test ids, English labels, disabled stubs and separators; an accelerator acts inside it', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const services = createAppServices({ store: createAppStore(), platform: 'linux' });
    const user = userEvent.setup();
    render(createElement(App, { services }));

    await user.click(screen.getByTestId('menu-edit'));
    const entry = within(screen.getByTestId('menu-edit-popup')).getByTestId(
      'menu-edit-tableStructure',
    );
    expect(entry).toHaveTextContent('Table structure');
    expect(entry.querySelector('u')).toHaveTextContent('b'); // Ta&ble structure
    expect(entry).toHaveAttribute('aria-haspopup', 'true');
    await user.hover(entry);
    const popup = screen.getByTestId('menu-edit-tableStructure-popup');
    const entries = within(popup).getAllByRole('menuitem');
    expect(entries.map((item) => item.dataset.testid)).toEqual(
      GROUPS.flat().map((id) => `menu-edit-tableStructure-${id.slice('table.'.length)}`),
    );
    expect(entries.map((item) => item.querySelector('.mfbe-menu-label')!.textContent)).toEqual(
      ENGLISH_LABELS,
    );
    for (const item of entries) expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(popup).getByTestId('menu-edit-tableStructure-insertRowBelow'),
    ).toBeInTheDocument();
    const separators = within(popup).getAllByRole('separator');
    expect(separators).toHaveLength(7);
    expect(separators.map((separator) => separator.dataset.testid)).toEqual(
      [3, 7, 10, 16, 18, 21, 28].map((index) => `menu-edit-tableStructure-separator-${index}`),
    );
    // 21 of the 24 labels carry a letter (resource-formats §9): Duplicate row, Duplicate
    // column and Paragraph before table none.
    const lettered = entries.filter((item) => item.querySelector('u'));
    expect(lettered).toHaveLength(21);
    await user.keyboard('{Escape}{Escape}');

    // A live entry runs by its letter inside the open submenu ("p", Re&pair table), not the
    // Edit menu's own "p" (&Paste).
    const run = vi.fn();
    act(() => {
      services.commands.replace({
        id: 'table.repair',
        group: 'table',
        labelKey: 'menu.tableStructure.repair',
        run,
      });
    });
    await user.click(screen.getByTestId('menu-edit'));
    await user.keyboard('b'); // opens Ta&ble structure
    expect(screen.getByTestId('menu-edit-tableStructure-popup')).toBeInTheDocument();
    expect(screen.getByTestId('menu-edit-tableStructure-repair')).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.keyboard('p');
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-edit-popup')).not.toBeInTheDocument();
  });
});

describe('the Add menu follows a description field (feature 006, US10, C30)', () => {
  afterEach(() => removeHarnessHosts());

  it('with the caret in a field cell Table, the live table commands and Inline image are enabled; in a field paragraph Inline image is not', async () => {
    const { services, ctx, store } = await tablesHarness();
    actions.setActiveView(store, 'description');
    const field = fieldHost('srcTitleInfo.annotation');
    field.view.dom.focus();
    const enabled = (id: string) => services.commands.isEnabled(id, ctx);
    fieldCaret(field, 'srcTitleInfo-annotation-t-0-1', 2);
    expect(enabled('insert.table')).toBe(true);
    expect(enabled('insert.inlineImage')).toBe(true);
    for (const id of [
      'table.insertRowAbove',
      'table.insertRowBelow',
      'table.deleteRow',
      'table.insertColumnLeft',
      'table.insertColumnRight',
      'table.deleteColumn',
      'table.toggleHeaderCell',
      'table.makeHeaderCells',
      'table.toggleHeaderRow',
      'table.toggleHeaderColumn',
      'table.select',
      'table.delete',
      'table.duplicateRow',
      'table.duplicateColumn',
      'table.paragraphBefore',
      'table.paragraphAfter',
    ]) {
      expect(enabled(id), id).toBe(true);
    }
    // Unavailable at a caret in a regular table: with their reasons, as in the Body view.
    for (const id of ['table.mergeCells', 'table.splitCell', 'table.repair']) {
      expect(enabled(id), id).toBe(false);
    }
    expect(enabled('insert.image')).toBe(false);
    expect(services.commands.unavailableReason('insert.image', ctx)).toBe(
      'a cell takes inline images only',
    );
    fieldCaret(field, 'srcTitleInfo-annotation-p', 2);
    expect(enabled('insert.inlineImage')).toBe(false);
    expect(enabled('insert.table')).toBe(true);
    expect(enabled('table.insertRowBelow')).toBe(false);
  });
});
