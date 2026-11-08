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
 * An entry's `icon` shows left of its label as in the menu bar (feature 007, `MenuItemSlot`).
 *
 * As in the menu bar (feature 007): an entry answers the pointer when the pointer moves over it,
 * so nothing opens under a pointer at rest; a submenu is placed in the window from its entry's
 * rectangle and follows it when the menu scrolls, and one the pointer opened that covers part of
 * its entry waits a moment before it shows (`popupFit.ts`); the keys scroll their highlight into
 * view.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { parseAccelerator } from '@/i18n';

import { MenuItemSlot } from './MenuIcon';
import type { MenuIcon } from './menus';
import { fitPopupInViewport, refitSubmenus, revealItem } from './popupFit';

export interface PopupMenuEntry {
  id: string;
  /** Label with an optional `&` accelerator. */
  label: string;
  enabled?: boolean;
  /** Shortcut shown on the right. */
  hotkey?: string;
  /** The icon left of the label (feature 007, User Story 8). */
  icon?: MenuIcon;
  /**
   * Shown as `title` and `aria-description` while the entry is disabled: why it is unavailable
   * ("Delete row: the table has only one row; use Delete table", feature 006 FR-043).
   */
  title?: string;
  /**
   * Feature 011 (D34): shown as `title` while the entry is enabled - what it does (the tree bar's
   * *Elements* entries name their FB2 element).
   */
  tooltip?: string;
  /**
   * The entries of the submenu this entry opens instead of running (one level: the entries of
   * a submenu open nothing further).
   */
  items?: readonly PopupMenuItem[];
  /** Runs the entry; not called for an entry that opens a submenu. */
  run: () => void;
  /** A ticked or unticked entry (feature 009: the status bar's panes); absent for others. */
  checked?: boolean;
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
  /** The open submenu was opened by the pointer moving over its entry (not a key or a click). */
  const [submenuByHover, setSubmenuByHover] = useState(false);
  const submenuEntry = entries.find((entry) => entry.id === openSubmenu);
  const subEntries = submenuEntry?.items ? entriesOf(submenuEntry.items) : [];
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  /** Set by a key that moved a highlight: the highlighted entry is scrolled into view. */
  const revealHighlight = useRef(false);
  const close = useCallback(() => onCloseRef.current(), []);

  /** Opens the submenu of `entry`: by a key or a click with its first entry highlighted. */
  const openSubmenuOf = useCallback((entry: PopupMenuEntry, highlightFirst: boolean) => {
    setOpenSubmenu(entry.id);
    setSubHighlighted(highlightFirst ? 0 : -1);
    setSubmenuByHover(!highlightFirst);
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

  // Kept inside the window, measured once rendered - again whenever the entries change, since a
  // menu may grow while it is open (the Body context menu's spelling suggestions arrive after
  // it opened); a menu taller than the window scrolls (its submenus are fitted to their entries
  // by `fitPopupInViewport`, again below after every change).
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
  }, [position, items]);

  // The open submenu placed again after every change - one a key or a click took over shows at
  // once (`popupFit.ts`).
  useLayoutEffect(() => {
    if (ref.current) refitSubmenus(ref.current);
  });

  // The entry a key highlighted, in a menu or submenu taller than the window, is scrolled into
  // view.
  useLayoutEffect(() => {
    if (!revealHighlight.current) return;
    revealHighlight.current = false;
    const menu = ref.current;
    const level = openSubmenu ? menu?.querySelector<HTMLElement>('.mfbe-menu-submenu') : menu;
    const entry = level?.querySelector<HTMLElement>(':scope > .mfbe-menu-item-highlighted');
    if (level && entry) revealItem(level, entry);
  });

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
    // A key takes the open submenu over: one that waited for the pointer shows at once.
    setSubmenuByHover(false);
    const level = inSubmenu ? subEntries : entries;
    const move = (step: number) => {
      event.preventDefault();
      if (level.length === 0) return;
      revealHighlight.current = true;
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
    const title = enabled ? entry.tooltip : entry.title;
    return (
      <div
        key={entry.id}
        role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={entry.checked}
        aria-disabled={!enabled || undefined}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? open : undefined}
        title={title}
        aria-description={title}
        className={`mfbe-menu-item${highlight ? ' mfbe-menu-item-highlighted' : ''}${enabled ? '' : ' mfbe-menu-item-disabled'}`}
        data-testid={entryTestId}
        // On a move only: an entry that appears under a pointer at rest gets `mouseover` /
        // `mouseenter` from Chromium without a move, and opens nothing (feature 007).
        onMouseMove={onHover}
        onClick={() => activate(entry, inSubmenu)}
      >
        <MenuItemSlot
          checked={entry.checked === true}
          checkable={entry.checked !== undefined}
          icon={entry.icon}
        />
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
            data-opened-by={submenuByHover ? 'hover' : undefined}
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
                  () => {
                    const index = subEntries.indexOf(child);
                    if (index !== subHighlighted) setSubHighlighted(index);
                  },
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
      // Taller than the window, the menu scrolls: its open submenu follows its entry.
      onScroll={(event) => refitSubmenus(event.currentTarget)}
    >
      {items.map((item, index) => {
        if (item === 'separator') {
          return <div key={`sep-${index}`} className="mfbe-menu-separator" role="separator" />;
        }
        const current = entries.indexOf(item);
        return renderEntry(item, `${testId}-${item.id}`, current === highlighted, false, () => {
          // A move inside the open submenu reaches its entry too, which changes nothing there.
          if (current !== highlighted) setHighlighted(current);
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
