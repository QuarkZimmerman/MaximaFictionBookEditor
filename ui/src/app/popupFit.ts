/**
 * Keeps the menus inside the window and within the user's reach (feature 003: the longer
 * Ukrainian labels pushed the Scripts submenus past the right edge, tall menus past the bottom;
 * feature 007: FictionBook Editor 2.7.9's 27 script groups make the Scripts menu taller than the
 * window). Called through a ref on every render of an open popup - the inline overrides are
 * cleared first, so the measurement is of the natural size -, by a menu that scrolls
 * (`refitSubmenus`) and for the entry the keyboard highlights (`revealItem`). Shared by the menu
 * bar and the popup menus' submenus (feature 006, `PopupMenu.tsx`).
 *
 * - A menu of the menu bar opens below its entry and stays there: taller than the room below the
 *   bar, it takes that room and scrolls, its padding and border inside the window. It never moves
 *   up over its entry, where the pointer that opened it rests (a menu moved up put its first
 *   group under that pointer, which opened the group's submenu). It moves left when it passes
 *   the window's right edge. Fitted again, it keeps its scroll position.
 * - A submenu is placed in the window's coordinates (`position: fixed`) from its item's
 *   rectangle, so the menu it opens from does not clip it when that menu scrolls (a submenu
 *   positioned inside it was cut off by it): right of its item, left of it when it does not fit
 *   there, and when it fits on neither side, inside the window against the edge of the side with
 *   more room - as close to its item as the window allows. Its first entry is level with its
 *   item; it moves up when it would pass the window's bottom and scrolls when it is taller than
 *   the window.
 * - A submenu that has to cover part of its item (it fits on neither side) and that the pointer
 *   opened (`data-opened-by="hover"`, set by the menu) waits `COVERING_SUBMENU_DELAY` ms, hidden
 *   (`data-waiting`), before it shows: a pointer passing over the item on its way to another one
 *   is not caught by it. In Russian and Ukrainian most of 2.7.9's script groups have submenus
 *   wider than the room beside the Scripts menu, and the one of a group the pointer passed
 *   covered the group it was heading for - wherever in the window it lay. One that a key or a
 *   click opened, or took over, shows at once, and so does one that fits beside its item.
 *
 * Nothing in the window may scroll for a popup: a popup that ended below the window's bottom made
 * the page scrollable, and focusing it scrolled the whole window.
 */

/** The room kept between a popup and the window's edges. */
const MARGIN = 4;

/**
 * How long a submenu that covers part of its item, opened by the pointer, waits before it shows
 * (ms): longer than the pointer takes to pass over an item, about what desktop menus wait before
 * they open any submenu.
 */
export const COVERING_SUBMENU_DELAY = 250;

/** The submenus placed once: whether one waits is decided when it is first placed. */
const placed = new WeakSet<HTMLElement>();

export function fitPopupInViewport(popup: HTMLElement | null): void {
  if (!popup) return;
  if (popup.classList.contains('mfbe-menu-submenu')) fitSubmenu(popup);
  else fitMenu(popup);
}

/**
 * Places the open submenus of `menu` again from their items: called when `menu` scrolls, which
 * moves the items they belong to.
 */
export function refitSubmenus(menu: HTMLElement): void {
  menu.querySelectorAll<HTMLElement>('.mfbe-menu-submenu').forEach(fitSubmenu);
}

/**
 * Scrolls `menu` so that its entry `item` is whole in view: the entry the keyboard highlighted in
 * a menu taller than the window. Not for the pointer's highlight, which is in view already -
 * scrolling for it would move other entries under the pointer.
 */
export function revealItem(menu: HTMLElement, item: HTMLElement): void {
  const top = menu.getBoundingClientRect().top + menu.clientTop;
  const bottom = top + menu.clientHeight;
  const rect = item.getBoundingClientRect();
  if (rect.top < top) menu.scrollTop -= top - rect.top;
  else if (rect.bottom > bottom) menu.scrollTop += rect.bottom - bottom;
}

function windowSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  };
}

/** A menu of the menu bar, below its entry (`top: 100%` of it). */
function fitMenu(popup: HTMLElement): void {
  // A layout without the overflow forgets the scroll position: it is put back.
  const scrollTop = popup.scrollTop;
  const style = popup.style;
  style.left = '';
  style.right = '';
  style.top = '';
  style.maxHeight = '';
  style.overflowY = '';
  const viewport = windowSize();
  let rect = popup.getBoundingClientRect();
  // Left by what passes the right edge, never past the left one.
  const shift = Math.min(rect.right - (viewport.width - MARGIN), rect.left - MARGIN);
  if (shift > 0) {
    style.left = `${Math.round(popup.offsetLeft - shift)}px`;
    rect = popup.getBoundingClientRect();
  }
  if (rect.bottom > viewport.height - MARGIN) {
    const room = viewport.height - MARGIN - rect.top - verticalChrome(popup);
    style.maxHeight = `${Math.max(0, Math.floor(room))}px`;
    style.overflowY = 'auto';
    popup.scrollTop = scrollTop;
  }
  refitSubmenus(popup);
}

/** A submenu, beside the item it is the child of. */
function fitSubmenu(popup: HTMLElement): void {
  const item = popup.parentElement;
  if (!item) return;
  const scrollTop = popup.scrollTop;
  const style = popup.style;
  // Measured at the window's top left corner, where nothing narrows it.
  style.position = 'fixed';
  style.left = '0px';
  style.top = '0px';
  style.right = 'auto';
  style.bottom = 'auto';
  style.maxHeight = '';
  style.overflowY = '';
  const viewport = windowSize();
  const anchor = item.getBoundingClientRect();
  const { width, height } = popup.getBoundingClientRect();
  const left = submenuLeft(anchor, width, viewport.width);
  // Its first entry level with the item: its border and padding start above the item.
  const level = anchor.top - edge(popup, 'border-top-width') - edge(popup, 'padding-top');
  const top = Math.max(MARGIN, Math.min(level, viewport.height - MARGIN - height));
  style.left = `${Math.round(left)}px`;
  style.top = `${Math.round(top)}px`;
  if (top + height > viewport.height - MARGIN) {
    const room = viewport.height - MARGIN - top - verticalChrome(popup);
    style.maxHeight = `${Math.max(0, Math.floor(room))}px`;
    style.overflowY = 'auto';
    popup.scrollTop = scrollTop;
  }
  // Over its item beyond the border they share: it fits on neither side.
  settle(popup, left < anchor.right - 1 && left + width > anchor.left + 1);
}

/**
 * Lets a submenu that covers part of its item and that the pointer opened wait, hidden, before
 * it shows; shows at once one that a key or a click opened or took over.
 */
function settle(popup: HTMLElement, covers: boolean): void {
  if (popup.dataset.openedBy !== 'hover') {
    delete popup.dataset.waiting;
  } else if (covers && !placed.has(popup)) {
    popup.dataset.waiting = '';
    setTimeout(() => {
      delete popup.dataset.waiting;
    }, COVERING_SUBMENU_DELAY);
  }
  placed.add(popup);
}

/**
 * The left edge of a submenu `width` wide beside `item`: right of the item, else left of it;
 * when it fits on neither side, against the window's edge on the side with more room, where it
 * covers the least of its menu - as close to its item as the window allows.
 */
function submenuLeft(item: DOMRect, width: number, windowWidth: number): number {
  const roomRight = windowWidth - MARGIN - item.right;
  const roomLeft = item.left - MARGIN;
  if (width <= roomRight) return item.right;
  if (width <= roomLeft) return item.left - width;
  return roomRight >= roomLeft ? Math.max(MARGIN, windowWidth - MARGIN - width) : MARGIN;
}

/** A length of `element`'s computed style in px (0 when it has none). */
function edge(element: HTMLElement, property: string): number {
  return parseFloat(window.getComputedStyle(element).getPropertyValue(property)) || 0;
}

/**
 * The padding and border above and below the content box of `element`, which `max-height`
 * does not include (nothing for `box-sizing: border-box`).
 */
function verticalChrome(element: HTMLElement): number {
  if (window.getComputedStyle(element).boxSizing === 'border-box') return 0;
  return ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']
    .map((property) => edge(element, property))
    .reduce((sum, value) => sum + value, 0);
}
