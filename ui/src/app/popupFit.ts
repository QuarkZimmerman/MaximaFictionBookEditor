/**
 * Keeps a popup inside the window (feature 003: the longer Ukrainian labels push the Scripts
 * submenus past the right edge, tall menus past the bottom). Called through a ref on every
 * render of an open popup: the inline overrides are cleared first, so the measurement is of the
 * natural position; a submenu that does not fit to the right opens to the left of its item, a
 * popup that does not fit below moves up and, when the window is too small, scrolls. Shared by
 * the menu bar and the popup menus' submenus (feature 006, `PopupMenu.tsx`).
 */
export function fitPopupInViewport(popup: HTMLElement | null): void {
  if (!popup) return;
  const submenu = popup.classList.contains('mfbe-menu-submenu');
  popup.style.left = '';
  popup.style.right = '';
  popup.style.top = '';
  popup.style.maxHeight = '';
  popup.style.overflowY = '';
  const margin = 4;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  let rect = popup.getBoundingClientRect();
  if (rect.right > viewportWidth - margin) {
    if (submenu) {
      popup.style.left = 'auto';
      popup.style.right = '100%';
      rect = popup.getBoundingClientRect();
      if (rect.left < margin) {
        popup.style.left = `${Math.round(-rect.left + margin)}px`;
        popup.style.right = 'auto';
      }
    } else {
      popup.style.left = `${Math.round(-(rect.right - viewportWidth + margin))}px`;
    }
    rect = popup.getBoundingClientRect();
  }
  if (rect.bottom > viewportHeight - margin) {
    const parentTop = popup.offsetParent?.getBoundingClientRect().top ?? 0;
    const shift = Math.min(rect.bottom - viewportHeight + margin, rect.top - margin);
    if (shift > 0) {
      popup.style.top = `${Math.round(rect.top - shift - parentTop)}px`;
      rect = popup.getBoundingClientRect();
    }
    if (rect.bottom > viewportHeight - margin) {
      popup.style.maxHeight = `${Math.floor(viewportHeight - rect.top - margin)}px`;
      popup.style.overflowY = 'auto';
    }
  }
}
