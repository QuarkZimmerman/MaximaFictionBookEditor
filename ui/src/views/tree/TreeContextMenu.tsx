/**
 * Context menu of the Document Tree (T084), after `IDR_DOCUMENT_TREE` of the original: View,
 * View Source | Move Right, Move With Children, Move Left | Merge, Delete (`TREE_MENU` in
 * treeModel.ts). Entries run the `tree.*` commands; disabled entries reflect the commands'
 * enable state. Keyboard: arrows, Enter, accelerator letters, Escape; a click elsewhere closes
 * the menu.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { parseAccelerator } from '@/i18n';
import { useAppState } from '@/model/store';
import { getTreeScriptCommands } from '@/scripting/tree';

import { TREE_MENU, type TreeMenuEntry } from './treeModel';

export interface TreeContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
}

const ENTRIES: readonly TreeMenuEntry[] = TREE_MENU.filter(
  (item): item is TreeMenuEntry => item !== 'separator',
);

export function TreeContextMenu({ position, onClose }: TreeContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Tree-command scripts (US12) for the selected node, appended after the built-in entries.
  const selectionNodeId = useAppState((s) => s.selectionNodeId, services.store);
  const scriptEntries = selectionNodeId
    ? getTreeScriptCommands(services.store, selectionNodeId)
    : [];

  const activate = useCallback(
    (entry: TreeMenuEntry) => {
      if (!services.commands.isEnabled(entry.commandId, ctx)) return;
      onClose();
      void services.commands.execute(entry.commandId, ctx);
    },
    [ctx, onClose, services.commands],
  );

  useEffect(() => {
    ref.current?.focus();
    const openedAt = Date.now();
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    // Scrolling closes the menu - except the scroll the opening itself may have triggered
    // (the Body editor revealing the selected element).
    const onScroll = () => {
      if (Date.now() - openedAt > 250) onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    left: Math.min(position.x, Math.max(0, window.innerWidth - 240)),
    top: Math.min(position.y, Math.max(0, window.innerHeight - 24 * (TREE_MENU.length + 1))),
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setHighlighted((h) => (h + 1) % ENTRIES.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlighted((h) => (h - 1 + ENTRIES.length) % ENTRIES.length);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const entry = ENTRIES[highlighted];
        if (entry) activate(entry);
        break;
      }
      default: {
        const key = event.key.toLowerCase();
        const match = ENTRIES.find((entry) => parseAccelerator(t(entry.labelKey)).key === key);
        if (match) {
          event.preventDefault();
          activate(match);
        }
        break;
      }
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={t('tree.a11y.contextMenu')}
      className="mfbe-menu-popup mfbe-context-menu mfbe-tree-menu"
      style={style}
      data-testid="tree-menu"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {TREE_MENU.map((item, index) => {
        if (item === 'separator') {
          return <div key={`sep-${index}`} className="mfbe-menu-separator" role="separator" />;
        }
        const current = ENTRIES.indexOf(item);
        const enabled = services.commands.isEnabled(item.commandId, ctx);
        const label = parseAccelerator(t(item.labelKey));
        return (
          <div
            key={item.id}
            role="menuitem"
            aria-disabled={!enabled || undefined}
            className={`mfbe-menu-item${current === highlighted ? ' mfbe-menu-item-highlighted' : ''}${enabled ? '' : ' mfbe-menu-item-disabled'}`}
            data-testid={`tree-menu-${item.id}`}
            onMouseEnter={() => setHighlighted(current)}
            onClick={() => activate(item)}
          >
            <span className="mfbe-menu-check" />
            <span>
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
            <span className="mfbe-menu-hotkey">
              {services.hotkeys.display(item.commandId) ?? ''}
            </span>
            <span className="mfbe-menu-arrow" />
          </div>
        );
      })}
      {scriptEntries.length > 0 ? (
        <>
          <div className="mfbe-menu-separator" role="separator" />
          <div className="mfbe-menu-section" data-testid="tree-menu-scripts">
            {t('treeMenu.scripts')}
          </div>
          {scriptEntries.map((entry) => (
            <div
              key={entry.id}
              role="menuitem"
              className="mfbe-menu-item"
              title={entry.description}
              data-testid={`tree-menu-script-${entry.scriptId}`}
              onClick={() => {
                onClose();
                void entry.run(ctx);
              }}
            >
              <span className="mfbe-menu-check" />
              <span>{entry.label}</span>
              <span className="mfbe-menu-hotkey" />
              <span className="mfbe-menu-arrow" />
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
