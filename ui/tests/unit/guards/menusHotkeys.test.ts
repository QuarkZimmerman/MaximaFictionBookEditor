/**
 * Guard G9 (feature 010, research §2.4): the structure of the main menu and the default hotkey
 * table, kept as a file snapshot. Only the entries the specification adds may change it; every
 * change shows as a diff of `tests/inventory/menus-hotkeys.json`.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_HOTKEYS } from '@/app/hotkeys';
import { MAIN_MENU, type MenuItemSpec } from '@/app/menus';

function itemShape(item: MenuItemSpec): unknown {
  switch (item.kind) {
    case 'command':
      return item.commandId;
    case 'separator':
      return '---';
    case 'submenu':
      return { submenu: item.id, items: item.items.map(itemShape) };
    default:
      return { [item.kind]: (item as { id?: string }).id ?? '' };
  }
}

describe('guard G9: menus and hotkeys', () => {
  it('match the committed inventory', async () => {
    const menus = MAIN_MENU.map((menu) => ({ menu: menu.id, items: menu.items.map(itemShape) }));
    const hotkeys = DEFAULT_HOTKEYS.map((hotkey) => JSON.stringify(hotkey)).sort();
    await expect(`${JSON.stringify({ menus, hotkeys }, null, 2)}\n`).toMatchFileSnapshot(
      '../../../../tests/inventory/menus-hotkeys.json',
    );
  });
});
