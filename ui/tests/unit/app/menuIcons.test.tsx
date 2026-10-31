/**
 * Feature 007, User Story 8 (T122; FR-040, FR-043; data-model §6, plan DP-6): the menus' icon
 * slot. `MenuBar` and `PopupMenu` draw an item's `icon` as a 16 × 16 `<img>` in the 22 px left
 * column - the column every item has, so the names stay aligned whether an item has an icon or
 * not -, a checkable item shows its check mark and never an icon, and an image that cannot be
 * loaded is removed and leaves the empty column, without an error.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProvider } from '@/app/AppContext';
import { MenuBar } from '@/app/MenuBar';
import type { MenuSpec } from '@/app/menus';
import { PopupMenu } from '@/app/PopupMenu';
import { createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { createAppStore } from '@/model/store';

const ICON = '/scripts/test.with-icon/icon.png?token=t';
const GROUP_ICON = '/script-groups/01_Case/icon?token=t';
const BROKEN = '/scripts/test.broken/icon.png?token=t';

const MENUS: readonly MenuSpec[] = [
  {
    id: 'test',
    labelKey: 'menu.scripts.caption',
    items: [
      { kind: 'command', commandId: 'test.withIcon', icon: { url: ICON } },
      { kind: 'command', commandId: 'test.plain' },
      { kind: 'command', commandId: 'test.toggle', icon: { url: ICON } },
      { kind: 'command', commandId: 'test.broken', icon: { url: BROKEN } },
      { kind: 'separator' },
      {
        kind: 'submenu',
        id: 'group',
        labelKey: 'menu.edit.tableStructure',
        icon: { url: GROUP_ICON },
        items: [{ kind: 'command', commandId: 'test.nested', icon: { url: ICON } }],
      },
      {
        kind: 'submenu',
        id: 'bare',
        labelKey: 'menu.edit.caption',
        items: [{ kind: 'command', commandId: 'test.plain' }],
      },
    ],
  },
];

async function setup() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const services = createAppServices({ store, platform: 'linux' });
  for (const id of ['test.withIcon', 'test.plain', 'test.broken', 'test.nested']) {
    services.commands.register({ id, group: 'scripts', tooltip: id, run: () => {} });
  }
  services.commands.register({
    id: 'test.toggle',
    group: 'view',
    tooltip: 'Toggle',
    checked: () => true,
    run: () => {},
  });
  const user = userEvent.setup();
  render(
    <AppProvider services={services}>
      <MenuBar menus={MENUS} />
    </AppProvider>,
  );
  await user.click(screen.getByTestId('menu-test'));
  return { user, popup: screen.getByTestId('menu-test-popup') };
}

/** The left column of an item: its first child, the 22 px slot of the check mark or icon. */
function slotOf(item: HTMLElement): HTMLElement {
  const slot = item.firstElementChild as HTMLElement;
  expect(slot).toHaveClass('mfbe-menu-check');
  return slot;
}

describe('the menu icon slot (feature 007, US8)', () => {
  it('MenuBar: an item with an icon shows it as a 16 px image in the left column, the others none', async () => {
    const { popup } = await setup();
    const withIcon = within(popup).getByTestId('menu-test-withIcon');
    const img = slotOf(withIcon).querySelector('img')!;
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', ICON);
    expect(img).toHaveAttribute('width', '16');
    expect(img).toHaveAttribute('height', '16');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('mfbe-menu-icon');
    const plain = within(popup).getByTestId('menu-test-plain');
    expect(slotOf(plain).querySelector('img')).toBeNull();
    expect(slotOf(plain)).toBeEmptyDOMElement();
    // Every item keeps the column, so the names line up: the label is always the second cell.
    const items = [...popup.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]')];
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(slotOf(item).nextElementSibling).toHaveClass('mfbe-menu-label');
    }
    expect(within(popup).getByTestId('menu-test-withIcon')).toHaveTextContent('test.withIcon');
  });

  it('MenuBar: a submenu shows its icon, its items theirs', async () => {
    const { user, popup } = await setup();
    const group = within(popup).getByTestId('menu-test-group');
    expect(slotOf(group).querySelector('img')).toHaveAttribute('src', GROUP_ICON);
    expect(slotOf(within(popup).getByTestId('menu-test-bare')).querySelector('img')).toBeNull();
    await user.hover(group);
    const submenu = screen.getByTestId('menu-test-group-popup');
    const nested = within(submenu).getByTestId('menu-test-group-nested');
    expect(slotOf(nested).querySelector('img')).toHaveAttribute('src', ICON);
  });

  it('MenuBar: a checkable item shows its check mark, never an icon', async () => {
    const { popup } = await setup();
    const toggle = within(popup).getByTestId('menu-test-toggle');
    expect(toggle).toHaveAttribute('role', 'menuitemcheckbox');
    expect(slotOf(toggle).querySelector('img')).toBeNull();
    expect(slotOf(toggle)).toHaveTextContent('✓');
  });

  it('MenuBar: an image that cannot be loaded is removed, the column stays, no error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { popup } = await setup();
      const broken = within(popup).getByTestId('menu-test-broken');
      const img = slotOf(broken).querySelector('img')!;
      expect(img).not.toBeNull();
      act(() => {
        fireEvent.error(img);
      });
      expect(slotOf(broken).querySelector('img')).toBeNull();
      expect(slotOf(broken).nextElementSibling).toHaveClass('mfbe-menu-label');
      expect(within(popup).getByTestId('menu-test-broken')).toHaveTextContent('test.broken');
      // The other images stay.
      expect(
        slotOf(within(popup).getByTestId('menu-test-withIcon')).querySelector('img'),
      ).not.toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('PopupMenu: entries with an icon show it in the same slot, the others none; a broken one goes', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <PopupMenu
          testId="popup"
          position={{ x: 10, y: 10 }}
          onClose={() => {}}
          items={[
            { id: 'icon', label: '&Icon', icon: { url: ICON }, run: () => {} },
            { id: 'plain', label: '&Plain', run: () => {} },
            'separator',
            {
              id: 'group',
              label: '&Group',
              icon: { url: GROUP_ICON },
              run: () => {},
              items: [{ id: 'child', label: 'Child', icon: { url: BROKEN }, run: () => {} }],
            },
          ]}
        />,
      );
      const menu = screen.getByTestId('popup');
      const icon = within(menu).getByTestId('popup-icon');
      const img = slotOf(icon).querySelector('img')!;
      expect(img).toHaveAttribute('src', ICON);
      expect(img).toHaveAttribute('width', '16');
      expect(img).toHaveAttribute('height', '16');
      expect(img).toHaveClass('mfbe-menu-icon');
      expect(slotOf(within(menu).getByTestId('popup-plain')).querySelector('img')).toBeNull();
      const group = within(menu).getByTestId('popup-group');
      expect(slotOf(group).querySelector('img')).toHaveAttribute('src', GROUP_ICON);
      fireEvent.mouseEnter(group);
      const child = within(screen.getByTestId('popup-group-popup')).getByTestId(
        'popup-group-child',
      );
      const broken = slotOf(child).querySelector('img')!;
      act(() => {
        fireEvent.error(broken);
      });
      expect(slotOf(child).querySelector('img')).toBeNull();
      expect(slotOf(child).nextElementSibling).toHaveClass('mfbe-menu-label');
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
