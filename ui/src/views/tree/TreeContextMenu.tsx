/**
 * Context menu of the Document Tree (T084; feature 010, US7): the actions of the right-clicked
 * row's kind (`treeMenuFor`, treeMenuModel.ts) - Go To and Go To Source on every row, the section
 * operations named after the section they involve, the picture actions, Delete with the kind's
 * name - and the tree-command scripts of a body or section row, run on that row. Entries run
 * their commands; an entry the registry refuses is greyed with its reason as tooltip. Keyboard:
 * arrows, Enter, accelerator letters, Escape; a click elsewhere closes the menu.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { getTreeFeature } from '@/features/tree';
import { parseAccelerator } from '@/i18n';
import { useAppState } from '@/model/store';
import { getTreeScriptCommands } from '@/scripting/tree';

import { buildTreeIndex } from './treeModel';
import { treeMenuFor, type TreeMenuItem } from './treeMenuModel';

export interface TreeContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
}

export function TreeContextMenu({ position, onClose }: TreeContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(0);
  const document = useAppState((s) => s.document, services.store);
  const captions = useMemo(
    () => ({ annotation: t('tree.node.annotation'), history: t('tree.node.history') }),
    [t],
  );
  const index = useMemo(() => buildTreeIndex(document, captions), [document, captions]);
  // The right-clicked row (the tree selects it before the menu opens).
  const rowId = getTreeFeature(services.store).selectedId;
  const lines = useMemo(() => treeMenuFor(index, rowId, t), [index, rowId, t]);
  const entries = lines.filter((line): line is TreeMenuItem => line !== 'separator');
  // Tree-command scripts (US12) of the right-clicked body or section row (feature 010, D23).
  const rowKind = rowId ? index.rows.get(rowId)?.kind : undefined;
  const scriptEntries =
    rowId && (rowKind === 'body' || rowKind === 'section')
      ? getTreeScriptCommands(services.store, rowId)
      : [];

  const activate = useCallback(
    (entry: TreeMenuItem) => {
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
    window.document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    left: Math.min(position.x, Math.max(0, window.innerWidth - 320)),
    top: Math.min(position.y, Math.max(0, window.innerHeight - 24 * (lines.length + 1))),
  };

  // Kept inside the window by its measured size (the estimate above only places the first
  // paint): longer labels make the menu taller and wider.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(position.x, window.innerWidth - width))}px`;
    menu.style.top = `${Math.max(0, Math.min(position.y, window.innerHeight - height))}px`;
  }, [position]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
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
      default: {
        const key = event.key.toLowerCase();
        const match = entries.find((entry) => parseAccelerator(entry.label).key === key);
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
      {lines.map((item, lineIndex) => {
        if (item === 'separator') {
          return <div key={`sep-${lineIndex}`} className="mfbe-menu-separator" role="separator" />;
        }
        const current = entries.indexOf(item);
        const enabled = services.commands.isEnabled(item.commandId, ctx);
        const label = parseAccelerator(item.label);
        const title = enabled ? undefined : item.reason;
        return (
          <div
            key={item.id}
            role="menuitem"
            aria-disabled={!enabled || undefined}
            title={title}
            aria-description={title}
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
