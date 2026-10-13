/**
 * Body context menu (T067), after `CFBEView::OnContextMenu`: Undo, Cut, Copy, Paste, one
 * "Select <element>" entry per ancestor container of the caret (section, body...), plus the
 * extension slots other stories fill: `spelling` (suggestions / Add to dictionary, US6) and
 * `image` ("Save image as...", US7). Rendered as a popup positioned at the pointer; Escape,
 * a click elsewhere or running an entry closes it. Keyboard: arrows, Enter, Escape.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { commandLabel } from '@/app/commands';

import type { BodyEditorController } from './bodyEditor';
import {
  contextMenuExtensions,
  isSeparator,
  selectEntries,
  type ContextMenuEntry,
  type ContextMenuItem,
} from './contextMenuExtensions';

export interface ContextMenuProps {
  controller: BodyEditorController;
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ controller, position, onClose }: ContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(0);

  const command = (id: string, labelKey: string): ContextMenuEntry => {
    const spec = services.commands.get(id);
    return {
      id,
      label: spec ? commandLabel(spec, t) : t(labelKey),
      enabled: services.commands.isEnabled(id, ctx),
      run: () => void services.commands.execute(id, ctx),
    };
  };

  const items: ContextMenuItem[] = [
    command('edit.undo', 'menu.edit.undo'),
    { separator: true, id: 'sep-1' },
    command('edit.cut', 'editing.contextMenu.cut'),
    command('edit.copy', 'editing.contextMenu.copy'),
    command('edit.paste', 'editing.contextMenu.paste'),
    { separator: true, id: 'sep-2' },
    ...selectEntries(controller, (element) => t('editing.contextMenu.select', { element })),
  ];
  const spelling = contextMenuExtensions.spelling?.(controller) ?? [];
  if (spelling.length > 0) items.push({ separator: true, id: 'sep-spelling' }, ...spelling);
  const image = contextMenuExtensions.image?.(controller) ?? [];
  if (image.length > 0) items.push({ separator: true, id: 'sep-image' }, ...image);

  const entries = items.filter((item): item is ContextMenuEntry => !isSeparator(item));

  const activate = useCallback(
    (entry: ContextMenuEntry) => {
      if (entry.enabled === false) return;
      onClose();
      entry.run();
    },
    [onClose],
  );

  useEffect(() => {
    ref.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  // Keep the popup inside the viewport.
  const style: React.CSSProperties = {
    left: Math.min(position.x, Math.max(0, window.innerWidth - 240)),
    top: Math.min(position.y, Math.max(0, window.innerHeight - 24 * (items.length + 1))),
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        controller.focus();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setHighlighted((h) => (h + 1) % Math.max(1, entries.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlighted((h) => (h - 1 + entries.length) % Math.max(1, entries.length));
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const entry = entries[highlighted];
        if (entry) activate(entry);
        break;
      }
      default:
        break;
    }
  };

  let entryIndex = -1;
  const rendered: ReactNode[] = items.map((item) => {
    if (isSeparator(item)) {
      return <div key={item.id} className="mfbe-menu-separator" role="separator" />;
    }
    entryIndex += 1;
    const index = entryIndex;
    const disabled = item.enabled === false;
    return (
      <div
        key={item.id}
        role="menuitem"
        aria-disabled={disabled || undefined}
        className={`mfbe-menu-item${index === highlighted ? ' mfbe-menu-item-highlighted' : ''}${disabled ? ' mfbe-menu-item-disabled' : ''}`}
        data-testid={`context-menu-${item.id}`}
        onMouseEnter={() => setHighlighted(index)}
        onClick={() => activate(item)}
      >
        <span className="mfbe-menu-check" />
        <span>{item.label}</span>
        <span className="mfbe-menu-hotkey" />
        <span className="mfbe-menu-arrow" />
      </div>
    );
  });

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="mfbe-menu-popup mfbe-context-menu"
      style={style}
      data-testid="context-menu"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {rendered}
    </div>
  );
}
