/**
 * The menu bar's menus within the user's reach (feature 007; FictionBook Editor 2.7.9's 27 script
 * groups make the Scripts menu taller than the window):
 *  - nothing opens under a pointer at rest: an item takes the highlight - and a group opens its
 *    submenu - when the pointer moves over it, not on the `mouseover` / `mouseenter` alone that
 *    Chromium sends to an item that appears under a pointer at rest (a menu opened from the
 *    keyboard; a menu moved up over its entry put its first group under the pointer that had
 *    opened it, and that group opened);
 *  - a submenu the pointer opened is marked `data-opened-by="hover"` until a key or a click takes
 *    it over: one of those that covers part of its item waits for the pointer to rest before it
 *    shows (popupFit.ts);
 *  - in a menu taller than the room below the bar, which scrolls (popupFit.ts), the keys scroll
 *    their highlight into view.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProvider } from '@/app/AppContext';
import { MenuBar } from '@/app/MenuBar';
import type { MenuSpec } from '@/app/menus';
import { createAppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { createAppStore } from '@/model/store';

/** The items of the long menu: 20 commands (unregistered: shown disabled, still navigable). */
const LONG = Array.from({ length: 20 }, (_, index) => `test.i${index}`);

const MENUS: readonly MenuSpec[] = [
  {
    id: 'test',
    labelKey: 'menu.add.caption',
    items: [
      { kind: 'command', commandId: 'test.first' },
      {
        kind: 'submenu',
        id: 'group',
        labelKey: 'menu.edit.tableStructure',
        items: [
          { kind: 'command', commandId: 'test.inner' },
          { kind: 'command', commandId: 'test.other' },
        ],
      },
    ],
  },
  {
    id: 'long',
    labelKey: 'menu.edit.caption',
    items: LONG.map((commandId) => ({ kind: 'command' as const, commandId })),
  },
];

async function setup() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const services = createAppServices({ store: createAppStore(), platform: 'linux' });
  const user = userEvent.setup();
  render(
    <AppProvider services={services}>
      <MenuBar menus={MENUS} />
    </AppProvider>,
  );
  return { user };
}

const highlighted = (testId: string) =>
  screen.getByTestId(testId).classList.contains('mfbe-menu-item-highlighted');

describe('the menu bar within reach (feature 007)', () => {
  it('an item under a pointer at rest opens nothing: the pointer moving over it does', async () => {
    const { user } = await setup();
    // Opened from the keyboard: its first item is highlighted.
    screen.getByTestId('menu-test').focus();
    await user.keyboard('{Enter}');
    expect(highlighted('menu-test-first')).toBe(true);
    const group = screen.getByTestId('menu-test-group');

    // What Chromium sends to an item that appears under a pointer at rest: `mouseover` and
    // `mouseenter` without a `mousemove`.
    fireEvent.mouseEnter(group);
    expect(screen.queryByTestId('menu-test-group-popup')).not.toBeInTheDocument();
    expect(highlighted('menu-test-group')).toBe(false);
    expect(highlighted('menu-test-first')).toBe(true);

    fireEvent.mouseMove(group);
    expect(screen.getByTestId('menu-test-group-popup')).toBeInTheDocument();
    expect(highlighted('menu-test-group')).toBe(true);
    // In the submenu the same; a move there keeps it open.
    const inner = screen.getByTestId('menu-test-group-inner');
    fireEvent.mouseEnter(inner);
    expect(highlighted('menu-test-group-inner')).toBe(false);
    fireEvent.mouseMove(inner);
    expect(highlighted('menu-test-group-inner')).toBe(true);
    expect(screen.getByTestId('menu-test-group-popup')).toBeInTheDocument();
    // A move over another item of the menu closes the submenu.
    fireEvent.mouseMove(screen.getByTestId('menu-test-first'));
    expect(screen.queryByTestId('menu-test-group-popup')).not.toBeInTheDocument();
    expect(highlighted('menu-test-first')).toBe(true);
  });

  it('a submenu the pointer opened is marked so until a key or a click takes it over', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('menu-test'));
    const group = screen.getByTestId('menu-test-group');
    fireEvent.mouseMove(group);
    expect(screen.getByTestId('menu-test-group-popup')).toHaveAttribute('data-opened-by', 'hover');
    // A key in it takes it over.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('menu-test-group-popup')).not.toHaveAttribute('data-opened-by');
    expect(highlighted('menu-test-group-inner')).toBe(true);

    // Opened by the pointer again, then a click on the group.
    fireEvent.mouseMove(screen.getByTestId('menu-test-first'));
    expect(screen.queryByTestId('menu-test-group-popup')).not.toBeInTheDocument();
    fireEvent.mouseMove(group);
    expect(screen.getByTestId('menu-test-group-popup')).toHaveAttribute('data-opened-by', 'hover');
    fireEvent.click(group);
    expect(screen.getByTestId('menu-test-group-popup')).not.toHaveAttribute('data-opened-by');

    // Opened by a key (Escape closes it, the group keeps the highlight): never marked.
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('menu-test-group-popup')).not.toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('menu-test-group-popup')).not.toHaveAttribute('data-opened-by');
    expect(highlighted('menu-test-group-inner')).toBe(true);
  });

  it('the keys scroll their highlight into view in a menu taller than the room below the bar', async () => {
    // A window 300 px tall: the 20 items of 25 px (500 px) below the bar (26 px) get 270 px.
    const root = document.documentElement;
    const original = HTMLElement.prototype.getBoundingClientRect;
    const rect = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        left: 0,
        top,
        width: 200,
        height,
        right: 200,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
    const isPopup = (element: Element) => element.getAttribute('data-testid') === 'menu-long-popup';
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (isPopup(this)) {
        return rect(
          26,
          this.style.maxHeight ? Math.min(500, parseFloat(this.style.maxHeight)) : 500,
        );
      }
      const popup = this.parentElement;
      if (popup && isPopup(popup)) {
        return rect(26 + 25 * Array.from(popup.children).indexOf(this) - popup.scrollTop, 25);
      }
      return original.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isPopup(this) ? parseFloat(this.style.maxHeight) || 500 : 0;
      },
    });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 300 });
    try {
      const { user } = await setup();
      screen.getByTestId('menu-long').focus();
      await user.keyboard('{Enter}');
      const popup = screen.getByTestId('menu-long-popup');
      expect(popup.style.maxHeight).toBe('270px');
      expect(popup.style.overflowY).toBe('auto');
      const last = screen.getByTestId('menu-long-i19');

      // End: the last item, its bottom at the menu's bottom (26 + 270).
      await user.keyboard('{End}');
      expect(highlighted('menu-long-i19')).toBe(true);
      expect(last.getBoundingClientRect().bottom).toBe(296);
      // Home: the first one, at the menu's top.
      await user.keyboard('{Home}');
      expect(highlighted('menu-long-i0')).toBe(true);
      expect(screen.getByTestId('menu-long-i0').getBoundingClientRect().top).toBe(26);
      // ArrowUp from the first wraps to the last, scrolled into view again.
      await user.keyboard('{ArrowUp}');
      expect(highlighted('menu-long-i19')).toBe(true);
      expect(last.getBoundingClientRect().bottom).toBe(296);
      // ArrowDown wraps to the first.
      await user.keyboard('{ArrowDown}');
      expect(screen.getByTestId('menu-long-i0').getBoundingClientRect().top).toBe(26);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
      delete (root as unknown as Record<string, unknown>).clientWidth;
      delete (root as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
