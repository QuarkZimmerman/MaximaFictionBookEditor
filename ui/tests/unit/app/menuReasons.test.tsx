/**
 * The menu bar shows why a command is unavailable (feature 006, T042; FR-043, U40; data-model
 * §9.6): a disabled item whose command gives a reason carries "{{command}}: {{reason}}" as
 * `title` and `aria-description`, in submenus too; an item without a reason, an enabled one
 * and a stub carry neither; the run lock's text replaces the command's own while it blocks it.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProvider } from '@/app/AppContext';
import { MenuBar } from '@/app/MenuBar';
import type { MenuSpec } from '@/app/menus';
import { createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';

const MENUS: readonly MenuSpec[] = [
  {
    id: 'test',
    labelKey: 'menu.add.caption',
    items: [
      { kind: 'command', commandId: 'test.reasoned' },
      { kind: 'command', commandId: 'test.plain' },
      { kind: 'command', commandId: 'test.enabled' },
      { kind: 'command', commandId: 'table.mergeCells' },
      { kind: 'command', commandId: 'test.stub' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        id: 'sub',
        labelKey: 'menu.add.tableStructure',
        items: [{ kind: 'command', commandId: 'test.nested' }],
      },
    ],
  },
];

async function setup() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const services = createAppServices({ store, platform: 'linux' });
  const askedWhileEnabled = vi.fn((): string | null => 'never shown');
  services.commands.register({
    id: 'test.reasoned',
    group: 'table',
    tooltip: 'Delete row',
    enabled: () => false,
    unavailableReason: () => 'the table has only one row; use Delete table',
    run: () => {},
  });
  services.commands.register({
    id: 'test.plain',
    group: 'edit',
    tooltip: 'Plain',
    enabled: () => false,
    run: () => {},
  });
  services.commands.register({
    id: 'test.enabled',
    group: 'edit',
    tooltip: 'Enabled',
    unavailableReason: askedWhileEnabled,
    run: () => {},
  });
  services.commands.register({
    id: 'test.nested',
    group: 'table',
    tooltip: 'Merge cells',
    enabled: () => false,
    unavailableReason: () => 'select a block of at least two cells',
    run: () => {},
  });
  // A stub, registered for parity and not implemented: `table.mergeCells` was one until user
  // story 5 of feature 006 made it live (T105).
  services.commands.register({
    id: 'test.stub',
    group: 'table',
    tooltip: 'Stub',
    stub: true,
    unavailableReason: () => 'never shown',
    run: () => {},
  });
  const user = userEvent.setup();
  render(
    <AppProvider services={services}>
      <MenuBar menus={MENUS} />
    </AppProvider>,
  );
  return { store, user, askedWhileEnabled };
}

describe('menu bar reasons (feature 006)', () => {
  it('a disabled item whose command gives a reason carries "command: reason" as title and aria-description; others carry neither', async () => {
    const { user, askedWhileEnabled } = await setup();
    await user.click(screen.getByTestId('menu-test'));
    const popup = screen.getByTestId('menu-test-popup');

    const reasoned = within(popup).getByTestId('menu-test-reasoned');
    expect(reasoned).toHaveAttribute('aria-disabled', 'true');
    expect(reasoned).toHaveAttribute(
      'title',
      'Delete row: the table has only one row; use Delete table',
    );
    expect(reasoned).toHaveAttribute(
      'aria-description',
      'Delete row: the table has only one row; use Delete table',
    );

    for (const id of ['menu-test-plain', 'menu-test-enabled', 'menu-test-stub']) {
      const item = within(popup).getByTestId(id);
      expect(item, id).not.toHaveAttribute('title');
      expect(item, id).not.toHaveAttribute('aria-description');
    }
    expect(within(popup).getByTestId('menu-test-plain')).toHaveAttribute('aria-disabled', 'true');
    expect(within(popup).getByTestId('menu-test-stub')).toHaveAttribute('aria-disabled', 'true'); // a stub: disabled, without a reason
    expect(within(popup).getByTestId('menu-test-enabled')).not.toHaveAttribute('aria-disabled');
    expect(askedWhileEnabled).not.toHaveBeenCalled();
    // Merge cells, live since feature 006's user story 5: without a table target, its reason.
    const merge = within(popup).getByTestId('menu-test-mergeCells');
    expect(merge).toHaveAttribute('aria-disabled', 'true');
    expect(merge).toHaveAttribute(
      'title',
      'Merge cells: place the caret in a table of the Body view or of an annotation or history field',
    );

    // Inside a submenu as well.
    await user.hover(within(popup).getByTestId('menu-test-sub'));
    const nested = screen.getByTestId('menu-test-sub-nested');
    expect(nested).toHaveAttribute('title', 'Merge cells: select a block of at least two cells');
    expect(nested).toHaveAttribute(
      'aria-description',
      'Merge cells: select a block of at least two cells',
    );
  });

  it('while the run lock blocks the command, the reason is the lock text of its kind', async () => {
    const { store, user } = await setup();
    act(() => {
      actions.setRunLock(store, { kind: 'script', label: 'Script', startedAt: Date.now() });
    });
    await user.click(screen.getByTestId('menu-test'));
    expect(screen.getByTestId('menu-test-reasoned')).toHaveAttribute(
      'title',
      'Delete row: a script is running; wait until it ends',
    );
    expect(screen.getByTestId('menu-test-plain')).not.toHaveAttribute('title');
    act(() => {
      actions.setRunLock(store, { kind: 'ai', label: 'Service', startedAt: Date.now() });
    });
    expect(screen.getByTestId('menu-test-reasoned')).toHaveAttribute(
      'aria-description',
      'Delete row: a request to the AI assistant is running; wait until it ends',
    );
    // The enabled command is blocked by the lock too, but defines its own reason only for its
    // own state: the lock's text is what it shows.
    expect(screen.getByTestId('menu-test-enabled')).toHaveAttribute(
      'title',
      'Enabled: a request to the AI assistant is running; wait until it ends',
    );
  });
});
