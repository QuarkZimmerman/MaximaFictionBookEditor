/**
 * `fitPopupInViewport` and its helpers (feature 003, feature 007; `app/popupFit.ts`) keep every
 * menu and submenu inside the window and reachable:
 *  - a menu bar's menu taller than the room below the bar stays below its entry and scrolls, its
 *    padding and border inside the window - the `max-height` it takes sizes the content box, so a
 *    height that left them out made the menu end below the window's bottom and the page scroll.
 *    It never moves up over its entry, where the pointer that opened it rests: the Scripts menu
 *    of FictionBook Editor 2.7.9's 27 groups did, and its first group opened under that pointer.
 *    Fitted again on every render, it keeps its scroll position;
 *  - a submenu is placed in the window's coordinates from its item's rectangle, so the scrolling
 *    menu it opens from does not clip it (the groups' submenus of that Scripts menu were cut off
 *    by it), and follows its item when that menu scrolls;
 *  - a submenu that fits on neither side of its item lies inside the window against the edge of
 *    the side with more room, as close to its item as the window allows (it was moved from its
 *    item by the item's distance from the window's left edge, past the right edge);
 *  - a submenu moves up to stay above the window's bottom and scrolls when it is taller;
 *  - a submenu that covers part of its item, opened by the pointer, waits before it shows, so
 *    the pointer passing over the item on its way to another one is not caught by it (in Russian
 *    the one of the Quotes group, 792 px wide, covered the Titles group wherever it lay);
 *  - the entry the keyboard highlights is scrolled into view.
 */

import {
  COVERING_SUBMENU_DELAY,
  fitPopupInViewport,
  refitSubmenus,
  revealItem,
} from '@/app/popupFit';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectOf({ left, top, width, height }: Box): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('fitPopupInViewport', () => {
  const root = document.documentElement;
  let original: typeof HTMLElement.prototype.getBoundingClientRect;
  /** The boxes of the test's elements, worked out from their styles when measured. */
  const boxes = new Map<Element, () => Box>();

  beforeEach(() => {
    original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const box = boxes.get(this);
      return box ? rectOf(box()) : original.call(this);
    };
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 700 });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
    boxes.clear();
    delete (root as unknown as Record<string, unknown>).clientWidth;
    delete (root as unknown as Record<string, unknown>).clientHeight;
    document.body.replaceChildren();
  });

  /**
   * A menu bar's menu of `natural` px (border box) opening below its entry, 26 px from the top,
   * with 4 px of padding and a 1 px border; its box follows the `top` and `max-height` it is
   * given. As in a browser, a layout without its overflow forgets its scroll position.
   */
  function menuOf(natural: number, boxSizing: 'content-box' | 'border-box'): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'mfbe-menu-popup';
    popup.style.padding = '4px 0';
    popup.style.border = '1px solid black';
    popup.style.boxSizing = boxSizing;
    document.body.appendChild(popup);
    const chrome = boxSizing === 'border-box' ? 0 : 10;
    let scrolled = 0;
    Object.defineProperty(popup, 'scrollTop', {
      configurable: true,
      get: () => scrolled,
      set: (value: number) => {
        scrolled = popup.style.overflowY === 'auto' ? value : 0;
      },
    });
    boxes.set(popup, () => {
      if (popup.style.overflowY !== 'auto') scrolled = 0;
      const top = popup.style.top ? parseFloat(popup.style.top) : 26;
      const height = popup.style.maxHeight
        ? Math.min(natural, parseFloat(popup.style.maxHeight) + chrome)
        : natural;
      return { left: 10, top, width: 300, height };
    });
    return popup;
  }

  /**
   * A scrolling menu with an item at `item` (its place while the menu is not scrolled) and that
   * item's open submenu of `natural` size (border box), with 4 px of padding and a 1 px border:
   * the item moves up as the menu scrolls, the submenu's box follows the `left`, `top` and
   * `max-height` it is given.
   */
  function submenuOf(item: Box, natural: { width: number; height: number }) {
    const menu = document.createElement('div');
    menu.className = 'mfbe-menu-popup';
    menu.style.maxHeight = '500px';
    menu.style.overflowY = 'auto';
    const entry = document.createElement('div');
    entry.className = 'mfbe-menu-item';
    const submenu = document.createElement('div');
    submenu.className = 'mfbe-menu-popup mfbe-menu-submenu';
    submenu.style.padding = '4px 0';
    submenu.style.border = '1px solid black';
    entry.appendChild(submenu);
    menu.appendChild(entry);
    document.body.appendChild(menu);
    boxes.set(entry, () => ({ ...item, top: item.top - menu.scrollTop }));
    boxes.set(submenu, () => ({
      left: parseFloat(submenu.style.left) || 0,
      top: parseFloat(submenu.style.top) || 0,
      width: natural.width,
      height: submenu.style.maxHeight
        ? Math.min(natural.height, parseFloat(submenu.style.maxHeight) + 10)
        : natural.height,
    }));
    return { menu, submenu };
  }

  /** The box of `popup`, checked to lie whole inside the window, 4 px from its edges. */
  function insideWindow(popup: HTMLElement): DOMRect {
    const rect = popup.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(4);
    expect(rect.right).toBeLessThanOrEqual(1000 - 4);
    expect(rect.top).toBeGreaterThanOrEqual(4);
    expect(rect.bottom).toBeLessThanOrEqual(700 - 4);
    return rect;
  }

  it('a menu taller than the room below its entry stays below it and scrolls, its padding and border inside the window - it never moves up over its entry', () => {
    const popup = menuOf(900, 'content-box');
    fitPopupInViewport(popup);
    expect(popup.style.top).toBe('');
    expect(popup.style.overflowY).toBe('auto');
    // 700 - 26 (top) - 4 (margin) - 8 (padding) - 2 (border).
    expect(popup.style.maxHeight).toBe('660px');
    expect(popup.getBoundingClientRect().top).toBe(26);
    expect(popup.getBoundingClientRect().bottom).toBe(700 - 4);
  });

  it('a border-box menu takes the whole room below its entry as its max-height', () => {
    const popup = menuOf(900, 'border-box');
    fitPopupInViewport(popup);
    expect(popup.style.top).toBe('');
    expect(popup.style.maxHeight).toBe('670px');
    expect(popup.getBoundingClientRect().bottom).toBe(700 - 4);
  });

  it('a menu that fits below its entry neither moves, scrolls nor takes a max-height', () => {
    const popup = menuOf(660, 'content-box');
    fitPopupInViewport(popup);
    expect(popup.style.top).toBe('');
    expect(popup.style.maxHeight).toBe('');
    expect(popup.style.overflowY).toBe('');
    expect(popup.getBoundingClientRect().bottom).toBe(26 + 660);
  });

  it('fitted again (on every render), a scrolled menu keeps its scroll position', () => {
    const popup = menuOf(900, 'content-box');
    fitPopupInViewport(popup);
    popup.scrollTop = 120;
    fitPopupInViewport(popup);
    expect(popup.style.overflowY).toBe('auto');
    expect(popup.scrollTop).toBe(120);
  });

  it("a submenu is placed in the window's coordinates from its item's rectangle, right of it with its first entry level with it, so the scrolling menu it opens from does not clip it; it follows its item when that menu scrolls", () => {
    const { menu, submenu } = submenuOf(
      { left: 300, top: 200, width: 300, height: 25 },
      { width: 250, height: 300 },
    );
    fitPopupInViewport(submenu);
    expect(submenu.style.position).toBe('fixed');
    expect(submenu.style.left).toBe('600px');
    // Its border and padding above its first entry: 200 - 1 - 4.
    expect(submenu.style.top).toBe('195px');
    expect(submenu.style.maxHeight).toBe('');
    expect(submenu.style.overflowY).toBe('');
    insideWindow(submenu);

    menu.scrollTop = 100;
    refitSubmenus(menu);
    expect(submenu.style.left).toBe('600px');
    expect(submenu.style.top).toBe('95px');
  });

  it('a submenu that does not fit right of its item opens left of it', () => {
    const { submenu } = submenuOf(
      { left: 500, top: 200, width: 300, height: 25 },
      { width: 250, height: 300 },
    );
    fitPopupInViewport(submenu);
    expect(submenu.style.left).toBe('250px');
    expect(submenu.style.top).toBe('195px');
    insideWindow(submenu);
  });

  it('a submenu that fits on neither side of its item lies inside the window against the edge of the side with more room, as close to its item as it can be', () => {
    // 316 px of room right of the item, 276 left of it: it covers the item's right end by 134
    // px, the least it can.
    const right = submenuOf(
      { left: 280, top: 200, width: 400, height: 25 },
      { width: 450, height: 300 },
    ).submenu;
    fitPopupInViewport(right);
    expect(right.style.left).toBe('546px');
    expect(insideWindow(right).right).toBe(1000 - 4);

    // 266 px of room right of the item, 326 left of it.
    const left = submenuOf(
      { left: 330, top: 200, width: 400, height: 25 },
      { width: 450, height: 300 },
    ).submenu;
    fitPopupInViewport(left);
    expect(left.style.left).toBe('4px');
    expect(insideWindow(left).right).toBe(454);
  });

  it("a submenu that would pass the window's bottom moves up; one taller than the window starts at its top and scrolls, its padding and border inside it", () => {
    const low = submenuOf(
      { left: 300, top: 600, width: 300, height: 25 },
      { width: 250, height: 300 },
    ).submenu;
    fitPopupInViewport(low);
    expect(low.style.top).toBe('396px');
    expect(low.style.maxHeight).toBe('');
    expect(low.style.overflowY).toBe('');
    insideWindow(low);

    const tall = submenuOf(
      { left: 300, top: 600, width: 300, height: 25 },
      { width: 250, height: 900 },
    ).submenu;
    fitPopupInViewport(tall);
    expect(tall.style.top).toBe('4px');
    expect(tall.style.overflowY).toBe('auto');
    // 700 - 4 - 4 (margins) - 8 (padding) - 2 (border).
    expect(tall.style.maxHeight).toBe('682px');
    expect(insideWindow(tall).bottom).toBe(700 - 4);
  });

  it('a submenu the pointer opened that covers part of its item waits, hidden, before it shows; one a key or a click opened or took over shows at once, as does one beside its item', () => {
    const covering = () =>
      submenuOf({ left: 280, top: 200, width: 400, height: 25 }, { width: 450, height: 300 })
        .submenu;
    const waits = (submenu: HTMLElement) => submenu.dataset.waiting !== undefined;
    vi.useFakeTimers();
    try {
      const hovered = covering();
      hovered.dataset.openedBy = 'hover';
      fitPopupInViewport(hovered);
      expect(waits(hovered)).toBe(true);
      // Placed again (on every render of its menu) while it waits: the wait goes on.
      vi.advanceTimersByTime(COVERING_SUBMENU_DELAY - 1);
      refitSubmenus(hovered.parentElement!.parentElement!);
      expect(waits(hovered)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(waits(hovered)).toBe(false);
      // Placed again once shown, it stays shown.
      fitPopupInViewport(hovered);
      expect(waits(hovered)).toBe(false);

      // A key or a click takes it over while it waits: it shows at once.
      const taken = covering();
      taken.dataset.openedBy = 'hover';
      fitPopupInViewport(taken);
      expect(waits(taken)).toBe(true);
      delete taken.dataset.openedBy;
      fitPopupInViewport(taken);
      expect(waits(taken)).toBe(false);

      // Opened by a key or a click: at once.
      const keyed = covering();
      fitPopupInViewport(keyed);
      expect(waits(keyed)).toBe(false);

      // Beside its item, opened by the pointer: at once.
      const beside = submenuOf(
        { left: 300, top: 200, width: 300, height: 25 },
        { width: 250, height: 300 },
      ).submenu;
      beside.dataset.openedBy = 'hover';
      fitPopupInViewport(beside);
      expect(waits(beside)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('revealItem scrolls a menu so that the entry the keyboard highlighted is whole in view', () => {
    const menu = document.createElement('div');
    const item = document.createElement('div');
    menu.appendChild(item);
    document.body.appendChild(menu);
    Object.defineProperty(menu, 'clientTop', { configurable: true, value: 1 });
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 660 });
    /** The item's top while the menu is not scrolled. */
    let itemTop = 700;
    boxes.set(menu, () => ({ left: 10, top: 26, width: 300, height: 670 }));
    boxes.set(item, () => ({ left: 11, top: itemTop - menu.scrollTop, width: 298, height: 25 }));

    // Below the menu's visible part: its bottom at the inner bottom edge (26 + 1 + 660).
    revealItem(menu, item);
    expect(menu.scrollTop).toBe(725 - 687);
    // Above it: its top at the inner top edge.
    itemTop = 50;
    revealItem(menu, item);
    expect(item.getBoundingClientRect().top).toBe(27);
    expect(menu.scrollTop).toBe(23);
    // In view: nothing moves.
    revealItem(menu, item);
    expect(menu.scrollTop).toBe(23);
  });
});
