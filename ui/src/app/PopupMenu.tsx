/**
 * A context menu at the pointer (feature 002: the toolbars' "Customize toolbar...", the Source
 * view's and the Description fields' edit menus): entries with optional `&` accelerators and
 * separators, keyboard operable (arrows, Enter, accelerator letters, Escape), closed by a click
 * elsewhere, by scrolling or by running an entry; kept inside the window. Closing without running
 * an entry gives the focus back to where it was.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { parseAccelerator } from '@/i18n';

export interface PopupMenuEntry {
  id: string;
  /** Label with an optional `&` accelerator. */
  label: string;
  enabled?: boolean;
  /** Shortcut shown on the right. */
  hotkey?: string;
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

export function PopupMenu({ items, position, onClose, testId, ariaLabel }: PopupMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = items.filter((item): item is PopupMenuEntry => item !== 'separator');
  const [highlighted, setHighlighted] = useState(() =>
    Math.max(
      0,
      entries.findIndex((entry) => entry.enabled !== false),
    ),
  );
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => onCloseRef.current(), []);

  const activate = useCallback(
    (entry: PopupMenuEntry) => {
      if (entry.enabled === false) return;
      close();
      entry.run();
    },
    [close],
  );

  // Kept inside the window, measured once rendered.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(position.x, window.innerWidth - width))}px`;
    menu.style.top = `${Math.max(0, Math.min(position.y, window.innerHeight - height))}px`;
  }, [position]);

  useEffect(() => {
    const menu = ref.current;
    const previous = document.activeElement;
    menu?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (menu && !menu.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
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
    const move = (step: number) => {
      event.preventDefault();
      setHighlighted((current) => (current + step + entries.length) % entries.length);
    };
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const entry = entries[highlighted];
        if (entry) activate(entry);
        break;
      }
      default: {
        const key = event.key.toLowerCase();
        const match = entries.find((entry) => parseAccelerator(entry.label).key === key);
        if (match) {
          event.preventDefault();
          activate(match);
        }
      }
    }
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
        const enabled = item.enabled !== false;
        const label = parseAccelerator(item.label);
        return (
          <div
            key={item.id}
            role="menuitem"
            aria-disabled={!enabled || undefined}
            className={`mfbe-menu-item${current === highlighted ? ' mfbe-menu-item-highlighted' : ''}${enabled ? '' : ' mfbe-menu-item-disabled'}`}
            data-testid={`${testId}-${item.id}`}
            onMouseEnter={() => setHighlighted(current)}
            onClick={() => activate(item)}
          >
            <span className="mfbe-menu-check" />
            <span className="mfbe-menu-label">
              {label.index >= 0 ? (
                <>
                  {label.text.slice(0, label.index)}
                  <u>{label.text[label.index]}</u>
                  {label.text.slice(label.index + 1)}
                </>
              ) : (
                label.text
              )}
            </span>
            <span className="mfbe-menu-hotkey">{item.hotkey ?? ''}</span>
            <span className="mfbe-menu-arrow" />
          </div>
        );
      })}
    </div>
  );
}
