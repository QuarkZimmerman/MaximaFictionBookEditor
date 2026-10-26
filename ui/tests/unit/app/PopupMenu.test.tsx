/**
 * PopupMenu (feature 006, T042; FR-040, FR-043; U12, U13, U40; data-model §9.3, §9.6): one level
 * of submenus by mouse and by keyboard with the derived test ids, the highlight moving into a
 * submenu and back, accelerators acting on the open level only, a disabled entry's reason as
 * `title` and `aria-description`, the menu's own scrolling keeping it open while a page scroll
 * closes it, the focus given back on close, and a menu taller than the window scrolling.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Mock } from 'vitest';

import { PopupMenu, type PopupMenuItem } from '@/app/PopupMenu';

type Spy = Mock<() => void>;

interface Spies {
  cut: Spy;
  parent: Spy;
  first: Spy;
  second: Spy;
  nested: Spy;
  last: Spy;
}

function menuItems(spies: Spies): PopupMenuItem[] {
  return [
    { id: 'cut', label: 'Cu&t', run: spies.cut },
    { id: 'off', label: '&Off', enabled: false, title: 'Off: not now', run: () => {} },
    'separator',
    {
      id: 'structure',
      label: 'Table st&ructure',
      run: spies.parent,
      items: [
        { id: 'first', label: '&First entry', run: spies.first },
        'separator',
        { id: 'second', label: 'Second &table entry', run: spies.second },
        { id: 'blocked', label: '&Blocked', enabled: false, title: 'Blocked: why', run: () => {} },
        {
          id: 'nested',
          label: '&Nested',
          run: spies.nested,
          items: [{ id: 'deeper', label: 'Deeper', run: () => {} }],
        },
      ],
    },
    { id: 'last', label: '&Last', title: 'Last: ignored while enabled', run: spies.last },
  ];
}

function spies(): Spies {
  return {
    cut: vi.fn<() => void>(),
    parent: vi.fn<() => void>(),
    first: vi.fn<() => void>(),
    second: vi.fn<() => void>(),
    nested: vi.fn<() => void>(),
    last: vi.fn<() => void>(),
  };
}

/** The menu open over a focused button, closed (unmounted) through its `onClose`. */
function Harness({ items, onClose }: { items: PopupMenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="opener">
        opener
      </button>
      {open ? (
        <PopupMenu
          items={items}
          position={{ x: 10, y: 20 }}
          testId="pm"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function setup() {
  const calls = spies();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<Harness items={menuItems(calls)} onClose={onClose} />);
  return { calls, onClose, user };
}

const highlighted = (testId: string) =>
  screen.getByTestId(testId).classList.contains('mfbe-menu-item-highlighted');

describe('PopupMenu submenus (feature 006)', () => {
  it('opens a submenu on hover with the derived test ids, and runs its entry on click', async () => {
    const { calls, onClose, user } = setup();
    expect(screen.queryByTestId('pm-structure-popup')).not.toBeInTheDocument();
    const parent = screen.getByTestId('pm-structure');
    expect(parent).toHaveAttribute('aria-haspopup', 'menu');
    expect(parent).toHaveAttribute('aria-expanded', 'false');

    await user.hover(parent);
    const popup = screen.getByTestId('pm-structure-popup');
    expect(popup).toHaveAttribute('role', 'menu');
    expect(popup).toHaveClass('mfbe-menu-popup', 'mfbe-menu-submenu');
    expect(parent).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(popup)
        .getAllByRole('menuitem')
        .map((e) => e.dataset.testid),
    ).toEqual([
      'pm-structure-first',
      'pm-structure-second',
      'pm-structure-blocked',
      'pm-structure-nested',
    ]);
    expect(within(popup).getAllByRole('separator')).toHaveLength(1);
    expect(highlighted('pm-structure')).toBe(true);

    await user.hover(screen.getByTestId('pm-structure-second'));
    expect(highlighted('pm-structure-second')).toBe(true);
    expect(highlighted('pm-structure')).toBe(true); // the parent keeps its highlight

    // Hovering another top-level entry closes the submenu.
    await user.hover(screen.getByTestId('pm-cut'));
    expect(screen.queryByTestId('pm-structure-popup')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('pm-structure'));
    expect(calls.parent).not.toHaveBeenCalled(); // an entry with items opens, never runs
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('pm-structure-second'));
    expect(calls.second).toHaveBeenCalledTimes(1);
    expect(calls.parent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('pm')).not.toBeInTheDocument();
  });

  it('submenus do not nest: an entry with items inside a submenu runs', async () => {
    const { calls, user } = setup();
    await user.hover(screen.getByTestId('pm-structure'));
    const nested = screen.getByTestId('pm-structure-nested');
    expect(nested).not.toHaveAttribute('aria-haspopup');
    await user.hover(nested);
    expect(screen.queryByTestId('pm-structure-nested-popup')).not.toBeInTheDocument();
    await user.click(nested);
    expect(calls.nested).toHaveBeenCalledTimes(1);
  });

  it('is keyboard operable: ArrowRight, Enter and Space open the submenu, the highlight moves into it and back, Escape closes one level', async () => {
    const { calls, onClose, user } = setup();
    expect(document.activeElement).toBe(screen.getByTestId('pm'));
    expect(highlighted('pm-cut')).toBe(true);
    await user.keyboard('{ArrowDown}{ArrowDown}'); // Off (disabled), then Table structure
    expect(highlighted('pm-structure')).toBe(true);

    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('pm-structure-popup')).toBeInTheDocument();
    expect(highlighted('pm-structure-first')).toBe(true);
    await user.keyboard('{ArrowDown}');
    expect(highlighted('pm-structure-second')).toBe(true);
    expect(highlighted('pm-structure-first')).toBe(false);
    await user.keyboard('{ArrowUp}{ArrowUp}'); // wraps to the last entry of the submenu
    expect(highlighted('pm-structure-nested')).toBe(true);

    await user.keyboard('{ArrowLeft}'); // back to the top level, on the parent
    expect(screen.queryByTestId('pm-structure-popup')).not.toBeInTheDocument();
    expect(highlighted('pm-structure')).toBe(true);
    await user.keyboard('{Enter}');
    expect(highlighted('pm-structure-first')).toBe(true);
    await user.keyboard('{Escape}'); // closes the submenu only
    expect(screen.queryByTestId('pm-structure-popup')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard(' ');
    expect(screen.getByTestId('pm-structure-popup')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(calls.second).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowRight on an entry without items does nothing; Escape at the top level closes the menu', async () => {
    const { calls, onClose, user } = setup();
    await user.keyboard('{ArrowRight}');
    expect(screen.queryByTestId('pm-structure-popup')).not.toBeInTheDocument();
    expect(calls.cut).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('accelerator letters act on the open level only', async () => {
    const { calls, onClose, user } = setup();
    // Top level: "r" opens Table st&ructure; inside, "t" is the submenu's Second &table entry,
    // not the top level's Cu&t, and "l" (the top level's &Last) does nothing there.
    await user.keyboard('r');
    expect(screen.getByTestId('pm-structure-popup')).toBeInTheDocument();
    expect(calls.parent).not.toHaveBeenCalled();
    await user.keyboard('l');
    expect(calls.last).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('b'); // a disabled entry's letter runs nothing
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('t');
    expect(calls.second).toHaveBeenCalledTimes(1);
    expect(calls.cut).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a top-level accelerator runs its entry when no submenu is open', async () => {
    const { calls, user } = setup();
    await user.keyboard('t');
    expect(calls.cut).toHaveBeenCalledTimes(1);
  });

  it('a disabled entry with a title carries it as title and aria-description; an enabled one does not', async () => {
    const { user } = setup();
    const off = screen.getByTestId('pm-off');
    expect(off).toHaveAttribute('aria-disabled', 'true');
    expect(off).toHaveAttribute('title', 'Off: not now');
    expect(off).toHaveAttribute('aria-description', 'Off: not now');
    const last = screen.getByTestId('pm-last');
    expect(last).not.toHaveAttribute('title');
    expect(last).not.toHaveAttribute('aria-description');
    const cut = screen.getByTestId('pm-cut');
    expect(cut).not.toHaveAttribute('title');
    expect(cut).not.toHaveAttribute('aria-disabled');

    await user.hover(screen.getByTestId('pm-structure'));
    const blocked = screen.getByTestId('pm-structure-blocked');
    expect(blocked).toHaveAttribute('title', 'Blocked: why');
    expect(blocked).toHaveAttribute('aria-description', 'Blocked: why');
    expect(screen.getByTestId('pm-structure-first')).not.toHaveAttribute('title');
    await user.click(blocked);
    expect(screen.getByTestId('pm')).toBeInTheDocument(); // a disabled entry does not close
  });

  it('a disabled entry with items opens nothing', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        onClose={onClose}
        items={[
          { id: 'a', label: '&A', run: () => {} },
          {
            id: 'sub',
            label: '&Sub',
            enabled: false,
            run: () => {},
            items: [{ id: 'x', label: 'X', run: () => {} }],
          },
        ]}
      />,
    );
    await user.hover(screen.getByTestId('pm-sub'));
    expect(screen.queryByTestId('pm-sub-popup')).not.toBeInTheDocument();
    expect(highlighted('pm-sub')).toBe(true);
    await user.keyboard('{ArrowRight}{Enter} s');
    expect(screen.queryByTestId('pm-sub-popup')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a scroll inside the menu keeps it open, a scroll of the page closes it (U13)', async () => {
    const { onClose, user } = setup();
    fireEvent.scroll(screen.getByTestId('pm'));
    expect(onClose).not.toHaveBeenCalled();
    await user.hover(screen.getByTestId('pm-structure'));
    fireEvent.scroll(screen.getByTestId('pm-structure-popup'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click outside closes it and gives the focus back to where it was', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    try {
      render(<Harness items={menuItems(spies())} onClose={onClose} />);
      expect(document.activeElement).toBe(screen.getByTestId('pm'));
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(outside);

      render(<Harness items={menuItems(spies())} onClose={onClose} />);
      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      outside.remove();
    }
  });

  it('a menu taller than the window takes a max-height and scrolls; a submenu that does not fit to the right opens to the left (fitPopupInViewport)', async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
    const tall = window.innerHeight + 300;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.testid === 'pm') return rect(0, 0, 200, tall);
      if (this.dataset.testid === 'pm-structure-popup') {
        // To the right of its entry it would cross the window's right edge.
        return this.style.right === '100%' ? rect(500, 100, 200, 300) : rect(900, 100, 200, 300);
      }
      return original.call(this);
    };
    const root = document.documentElement;
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    const height = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 700 });
    try {
      const { user } = setup();
      const menu = screen.getByTestId('pm');
      expect(menu.style.overflowY).toBe('auto');
      expect(parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight);
      expect(menu.style.top).toBe('0px');
      expect(menu.style.left).toBe('10px');
      await user.hover(screen.getByTestId('pm-structure'));
      const popup = screen.getByTestId('pm-structure-popup');
      expect(popup.style.right).toBe('100%');
      expect(popup.style.left).toBe('auto');
      expect(popup.style.maxHeight).toBe('');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
      delete (root as unknown as Record<string, unknown>).clientWidth;
      delete (root as unknown as Record<string, unknown>).clientHeight;
      expect(Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')).toEqual(width);
      expect(Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')).toEqual(height);
    }
  });

  it('a menu that fits keeps no max-height and is clamped into the window', () => {
    render(
      <PopupMenu
        items={menuItems(spies())}
        position={{ x: window.innerWidth + 50, y: window.innerHeight + 50 }}
        testId="pm"
        onClose={() => {}}
      />,
    );
    const menu = screen.getByTestId('pm');
    expect(menu.style.maxHeight).toBe('');
    expect(menu.style.overflowY).toBe('');
    // jsdom measures 0 x 0: the menu is moved back to the window's edges.
    expect(menu.style.left).toBe(`${window.innerWidth}px`);
    expect(menu.style.top).toBe(`${window.innerHeight}px`);
  });
});
