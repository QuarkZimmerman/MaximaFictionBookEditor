/**
 * *Add → Table structure* (feature 006, T043; FR-039, SC-008; U12, C32; data-model §9.1, §9.2):
 * the one list of the 24 table commands in the eight groups of FR-039, the Add menu's submenu
 * right after *Table*, its derived test ids, its English labels, its disabled stubs and the
 * accelerator letters live inside the open submenu.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

import { App } from '@/app/App';
import { createCommandRegistry } from '@/app/commands';
import { MAIN_MENU, TABLE_STRUCTURE_ITEMS, type MenuItemSpec } from '@/app/menus';
import { createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { createAppStore } from '@/model/store';

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

describe('Add → Table structure (feature 006)', () => {
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

  it("the Add menu's item after insert.table is the submenu; Table keeps its label key", () => {
    const add = MAIN_MENU.find((menu) => menu.id === 'add')!;
    const index = add.items.findIndex(
      (item) => item.kind === 'command' && item.commandId === 'insert.table',
    );
    expect(index).toBeGreaterThan(0);
    expect(add.items[index + 1]).toEqual({
      kind: 'submenu',
      id: 'tableStructure',
      labelKey: 'menu.add.tableStructure',
      items: TABLE_STRUCTURE_ITEMS,
    });
    expect(add.items[index + 2]).toEqual({ kind: 'command', commandId: 'insert.sectionImage' });
    const registry = createCommandRegistry();
    expect(registry.get('insert.table')!.labelKey).toBe('menu.add.table'); // C32
  });

  it('renders the submenu with its test ids, English labels, disabled stubs and separators; an accelerator acts inside it', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const services = createAppServices({ store: createAppStore(), platform: 'linux' });
    const user = userEvent.setup();
    render(createElement(App, { services }));

    await user.click(screen.getByTestId('menu-add'));
    const entry = within(screen.getByTestId('menu-add-popup')).getByTestId(
      'menu-add-tableStructure',
    );
    expect(entry).toHaveTextContent('Table structure');
    expect(entry.querySelector('u')).toHaveTextContent('r'); // Table st&ructure
    expect(entry).toHaveAttribute('aria-haspopup', 'true');
    await user.hover(entry);
    const popup = screen.getByTestId('menu-add-tableStructure-popup');
    const entries = within(popup).getAllByRole('menuitem');
    expect(entries.map((item) => item.dataset.testid)).toEqual(
      GROUPS.flat().map((id) => `menu-add-tableStructure-${id.slice('table.'.length)}`),
    );
    expect(entries.map((item) => item.querySelector('.mfbe-menu-label')!.textContent)).toEqual(
      ENGLISH_LABELS,
    );
    for (const item of entries) expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(popup).getByTestId('menu-add-tableStructure-insertRowBelow')).toBeInTheDocument();
    const separators = within(popup).getAllByRole('separator');
    expect(separators).toHaveLength(7);
    expect(separators.map((separator) => separator.dataset.testid)).toEqual(
      [3, 7, 10, 16, 18, 21, 28].map((index) => `menu-add-tableStructure-separator-${index}`),
    );
    // 21 of the 24 labels carry a letter (resource-formats §9): Duplicate row, Duplicate
    // column and Paragraph before table none.
    const lettered = entries.filter((item) => item.querySelector('u'));
    expect(lettered).toHaveLength(21);
    await user.keyboard('{Escape}{Escape}');

    // A live entry runs by its letter inside the open submenu ("p", Re&pair table), not the
    // Add menu's own "p" (&Poem).
    const run = vi.fn();
    act(() => {
      services.commands.replace({
        id: 'table.repair',
        group: 'table',
        labelKey: 'menu.tableStructure.repair',
        run,
      });
    });
    await user.click(screen.getByTestId('menu-add'));
    await user.keyboard('r'); // opens Table st&ructure
    expect(screen.getByTestId('menu-add-tableStructure-popup')).toBeInTheDocument();
    expect(screen.getByTestId('menu-add-tableStructure-repair')).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.keyboard('p');
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-add-popup')).not.toBeInTheDocument();
  });
});
