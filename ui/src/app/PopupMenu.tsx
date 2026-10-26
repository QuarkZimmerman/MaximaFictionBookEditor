/**
 * A context menu at the pointer (feature 002: the toolbars' "Customize toolbar...", the Source
 * view's and the Description fields' edit menus): entries with optional `&` accelerators and
 * separators, keyboard operable (arrows, Enter, accelerator letters, Escape), closed by a click
 * elsewhere, by scrolling outside it or by running an entry; kept inside the window, scrolling
 * when it is taller than the window. Closing without running an entry gives the focus back to
 * where it was.
 *
 * One level of submenus (feature 006, FR-040; data-model §9.3): an entry with `items` opens a
 * submenu instead of running - on hover, click, Enter, Space or ArrowRight -, ArrowLeft or
 * Escape closes it again, and the arrow keys and accelerator letters act on the open level.
 * The submenu's test ids derive from the entry's as the main menu derives its own
 * (`<testId>-<entry id>-popup`, `<testId>-<entry id>-<child id>`). A disabled entry with a
 * `title` (the reason it is unavailable, FR-043) carries it as `title` and `aria-description`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { parseAccelerator } from '@/i18n';

import { fitPopupInViewport } from './popupFit';

export interface PopupMenuEntry {
  id: string;
  /** Label with an optional `&` accelerator. */
  label: string;
  enabled?: boolean;
  /** Shortcut shown on the right. */
  hotkey?: string;
  /**
   * Shown as `title` and `aria-description` while the entry is disabled: why it is unavailable
   * ("Delete row: the table has only one row; use Delete table", feature 006 FR-043).
   */
  title?: string;
  /**
   * The entries of the submenu this entry opens instead of running (one level: the entries of
   * a submenu open nothing further).
   */
  items?: readonly PopupMenuItem[];
  /** Runs the entry; not called for an entry that opens a submenu. */
  run: () => void;
}

export type PopupMenuItem = PopupMenuEntry | 'separator';

export interface PopupMenuProps {
  items: readonly PopupMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
  testId: string;
  ariaLabel?: string;
}

const entriesOf = (items: readonly PopupMenuItem[]): PopupMenuEntry[] =>
  items.filter((item): item is PopupMenuEntry => item !== 'separator');

/** True for an entry of the top level that opens a submenu. */
const opensSubmenu = (entry: PopupMenuEntry | undefined): entry is PopupMenuEntry =>
  !!entry?.items && entry.enabled !== false;

/** The label with its accelerator letter underlined. */
function EntryLabel({ label }: { label: string }) {
  const parsed = parseAccelerator(label);
  if (parsed.index < 0) return <>{parsed.text}</>;
  return (
    <>
      {parsed.text.slice(0, parsed.index)}
      <u>{parsed.text[parsed.index]}</u>
      {parsed.text.slice(parsed.index + 1)}
    </>
  );
}

export function PopupMenu({ items, position, onClose, testId, ariaLabel }: PopupMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = entriesOf(items);
  const [highlighted, setHighlighted] = useState(() =>
    Math.max(
      0,
      entries.findIndex((entry) => entry.enabled !== false),
    ),
  );
  /** The id of the top-level entry whose submenu is open. */
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  /** The highlighted entry of the open submenu (-1: none). */
  const [subHighlighted, setSubHighlighted] = useState(-1);
  const submenuEntry = entries.find((entry) => entry.id === openSubmenu);
  const subEntries = submenuEntry?.items ? entriesOf(submenuEntry.items) : [];
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => onCloseRef.current(), []);

  const openSubmenuOf = useCallback((entry: PopupMenuEntry, highlightFirst: boolean) => {
    setOpenSubmenu(entry.id);
    setSubHighlighted(highlightFirst ? 0 : -1);
  }, []);

  const closeSubmenu = useCallback(() => {
    setOpenSubmenu(null);
    setSubHighlighted(-1);
  }, []);

  /** Runs an entry of the open level, or opens the submenu of a top-level entry. */
  const activate = (entry: PopupMenuEntry, inSubmenu: boolean) => {
    if (entry.enabled === false) return;
    if (!inSubmenu && entry.items) {
      const index = entries.indexOf(entry);
      if (index >= 0) setHighlighted(index);
      openSubmenuOf(entry, true);
      return;
    }
    close();
    entry.run();
  };

  // Kept inside the window, measured once rendered; a menu taller than the window scrolls (its
  // submenus are fitted to their entries by `fitPopupInViewport`).
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    menu.style.maxHeight = '';
    menu.style.overflowY = '';
    const { width, height } = menu.getBoundingClientRect();
    let shown = height;
    if (height > window.innerHeight) {
      // `max-height` sizes the content box: the padding and the border come on top.
      const style = window.getComputedStyle(menu);
      const chrome = ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']
        .map((property) => parseFloat(style.getPropertyValue(property)) || 0)
        .reduce((sum, value) => sum + value, 0);
      menu.style.maxHeight = `${Math.max(0, window.innerHeight - chrome)}px`;
      menu.style.overflowY = 'auto';
      shown = window.innerHeight;
    }
    menu.style.left = `${Math.max(0, Math.min(position.x, window.innerWidth - width))}px`;
    menu.style.top = `${Math.max(0, Math.min(position.y, window.innerHeight - shown))}px`;
  }, [position]);

  useEffect(() => {
    const menu = ref.current;
    const previous = document.activeElement;
    menu?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (menu && !menu.contains(event.target as Node)) close();
    };
    // Scrolling the page closes the menu; the menu's own scrolling (a long menu or submenu)
    // does not (U13).
    const onScroll = (event: Event) => {
      if (menu && event.target instanceof Node && menu.contains(event.target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      // Only when the focus was left with the menu: an entry may have moved it (a dialog).
      const active = document.activeElement;
      const leftWithMenu = !active || active === document.body || !!menu?.contains(active);
      if (leftWithMenu && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [close]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const inSubmenu = submenuEntry !== undefined;
    const level = inSubmenu ? subEntries : entries;
    const move = (step: number) => {
      event.preventDefault();
      if (level.length === 0) return;
      if (inSubmenu) {
        setSubHighlighted((current) =>
          current < 0
            ? step > 0
              ? 0
              : level.length - 1
            : (current + step + level.length) % level.length,
        );
      } else {
        setHighlighted((current) => (current + step + level.length) % level.length);
      }
    };
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (inSubmenu) closeSubmenu();
        else close();
        break;
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'ArrowRight': {
        event.preventDefault();
        const entry = entries[highlighted];
        if (!inSubmenu && opensSubmenu(entry)) openSubmenuOf(entry, true);
        break;
      }
      case 'ArrowLeft':
        event.preventDefault();
        if (inSubmenu) closeSubmenu();
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const entry = inSubmenu ? subEntries[subHighlighted] : entries[highlighted];
        if (entry) activate(entry, inSubmenu);
        break;
      }
      default: {
        const key = event.key.toLowerCase();
        const match = level.find((entry) => parseAccelerator(entry.label).key === key);
        if (match) {
          event.preventDefault();
          activate(match, inSubmenu);
        }
      }
    }
  };

  const renderEntry = (
    entry: PopupMenuEntry,
    entryTestId: string,
    highlight: boolean,
    inSubmenu: boolean,
    onHover: () => void,
  ) => {
    const enabled = entry.enabled !== false;
    const submenu = !inSubmenu && !!entry.items;
    const open = submenu && openSubmenu === entry.id;
    const title = enabled ? undefined : entry.title;
    return (
      <div
        key={entry.id}
        role="menuitem"
        aria-disabled={!enabled || undefined}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? open : undefined}
        title={title}
        aria-description={title}
        className={`mfbe-menu-item${highlight ? ' mfbe-menu-item-highlighted' : ''}${enabled ? '' : ' mfbe-menu-item-disabled'}`}
        data-testid={entryTestId}
        onMouseEnter={onHover}
        onClick={() => activate(entry, inSubmenu)}
      >
        <span className="mfbe-menu-check" />
        <span className="mfbe-menu-label">
          <EntryLabel label={entry.label} />
        </span>
        <span className="mfbe-menu-hotkey">{entry.hotkey ?? ''}</span>
        <span className="mfbe-menu-arrow" aria-hidden="true">
          {submenu ? '\u25B8' : ''}
        </span>
        {open && entry.items ? (
          <div
            ref={fitPopupInViewport}
            role="menu"
            aria-label={parseAccelerator(entry.label).text}
            className="mfbe-menu-popup mfbe-menu-submenu"
            data-testid={`${entryTestId}-popup`}
            onMouseLeave={() => setSubHighlighted(-1)}
            // The submenu sits inside its parent entry: a click in it is not the parent's.
            onClick={(event) => event.stopPropagation()}
          >
            {entry.items.map((child, index) =>
              child === 'separator' ? (
                <div key={`sep-${index}`} className="mfbe-menu-separator" role="separator" />
              ) : (
                renderEntry(
                  child,
                  `${entryTestId}-${child.id}`,
                  subEntries.indexOf(child) === subHighlighted,
                  true,
                  () => setSubHighlighted(subEntries.indexOf(child)),
                )
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
      className="mfbe-menu-popup mfbe-context-menu mfbe-popup-menu"
      style={{ left: position.x, top: position.y }}
      data-testid={testId}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item === 'separator') {
          return <div key={`sep-${index}`} className="mfbe-menu-separator" role="separator" />;
        }
        const current = entries.indexOf(item);
        return renderEntry(item, `${testId}-${item.id}`, current === highlighted, false, () => {
          setHighlighted(current);
          if (opensSubmenu(item)) {
            if (openSubmenu !== item.id) openSubmenuOf(item, false);
          } else if (openSubmenu !== null) {
            closeSubmenu();
          }
        });
      })}
    </div>
  );
}
