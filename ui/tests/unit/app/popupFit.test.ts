/**
 * `fitPopupInViewport` (feature 003; `app/popupFit.ts`): a menu bar's menu taller than the room
 * below the bar moves up and scrolls with its padding and border inside the window - the
 * `max-height` it takes sizes the content box, so a height that left them out made the menu end
 * below the window's bottom and the page scroll while the menu was open (a Scripts menu with
 * more groups than the window has room for).
 */

import { fitPopupInViewport } from '@/app/popupFit';

describe('fitPopupInViewport', () => {
  const root = document.documentElement;
  let original: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    original = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 700 });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
    delete (root as unknown as Record<string, unknown>).clientWidth;
    delete (root as unknown as Record<string, unknown>).clientHeight;
    document.body.replaceChildren();
  });

  /**
   * A menu bar's popup of `natural` px (border box) opening 26 px from the top, with 4 px of
   * padding and a 1 px border; its box follows the `top` and `max-height` it is given.
   */
  function popupOf(natural: number, boxSizing: 'content-box' | 'border-box'): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'mfbe-menu-popup';
    popup.style.padding = '4px 0';
    popup.style.border = '1px solid black';
    popup.style.boxSizing = boxSizing;
    document.body.appendChild(popup);
    const chrome = boxSizing === 'border-box' ? 0 : 10;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this !== popup) return original.call(this);
      const top = this.style.top ? parseFloat(this.style.top) : 26;
      const height = this.style.maxHeight
        ? Math.min(natural, parseFloat(this.style.maxHeight) + chrome)
        : natural;
      return {
        x: 10,
        y: top,
        left: 10,
        top,
        width: 300,
        height,
        right: 310,
        bottom: top + height,
        toJSON: () => ({}),
      } as DOMRect;
    };
    return popup;
  }

  it('a menu taller than the window moves up to the margin and scrolls, its padding and border inside the window', () => {
    const popup = popupOf(900, 'content-box');
    fitPopupInViewport(popup);
    expect(popup.style.top).toBe('4px');
    expect(popup.style.overflowY).toBe('auto');
    // 700 - 4 (top) - 4 (margin) - 8 (padding) - 2 (border).
    expect(popup.style.maxHeight).toBe('682px');
    expect(popup.getBoundingClientRect().bottom).toBe(700 - 4);
  });

  it('a border-box menu takes the whole room as its max-height', () => {
    const popup = popupOf(900, 'border-box');
    fitPopupInViewport(popup);
    expect(popup.style.maxHeight).toBe('692px');
    expect(popup.getBoundingClientRect().bottom).toBe(700 - 4);
  });

  it('a menu that fits once moved up neither scrolls nor takes a max-height', () => {
    const popup = popupOf(680, 'content-box');
    fitPopupInViewport(popup);
    expect(popup.style.top).toBe('16px');
    expect(popup.style.maxHeight).toBe('');
    expect(popup.style.overflowY).toBe('');
    expect(popup.getBoundingClientRect().bottom).toBe(700 - 4);
  });
});
