/**
 * Document Tree panel ("Document structure", T084, FR-022): a virtualised hierarchy of bodies,
 * sections and their titles / epigraphs / annotations / images / poems / cites / tables
 * (`treeModel.ts`) with the original `struct.bmp` icons, expand/collapse, two-way selection
 * sync with the Body view, keyboard navigation, the `IDR_DOCUMENT_TREE` context menu
 * (`TreeContextMenu.tsx`) and the tree toolbar (Right, Right smart, Left, Merge, Delete).
 *
 * Selection sync: clicking a row (or moving with the arrow keys) selects the element in the Body
 * editor - moving its section window when needed - without taking the focus away from the tree;
 * Enter / double-click / "View" switch to the Body view and focus it. When the Body caret moves,
 * the row of the innermost element shown in the tree is highlighted and scrolled into view. The
 * panel state (selection, collapsed rows) lives in the tree feature so the commands share it.
 *
 * Feature 006 (US8, FR-058; decision 8; C61; U33): the row of an irregular table draws the Body
 * mark's badge at its right with the Body mark's name and tooltip, and an entry that contains
 * irregular tables without rows of their own (a cite, an annotation, an epigraph, the Annotation
 * and History blocks) one "Contains an irregular table: …" line per table. The mark is not
 * interactive: a click selects the row and reveals the table, whose own mark offers the popover.
 */

import type { TFunction } from 'i18next';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { commandDescription, commandTooltip } from '@/app/commands';
import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { tableProblemsText } from '@/editor/table/problems';
import { bodyController } from '@/features/editing/common';
import { describeTableMark } from '@/features/tables/marks';
import { getTreeFeature, revealInBody, treeOpCommandId } from '@/features/tree';
import { useAppState } from '@/model/store';

import { TreeContextMenu } from './TreeContextMenu';
import {
  ancestorRows,
  buildTreeIndex,
  isRowWithin,
  ROW_ICONS,
  rowForSelection,
  TREE_ROW_HEIGHT,
  TREE_TOOLBAR,
  treeIconUrl,
  visibleRows,
  type TreeRow,
} from './treeModel';

import './tree.css';

const OVERSCAN = 8;
const DEFAULT_VIEWPORT = 600;

/** The texts of a row's mark: its accessible name and its tooltip. */
interface RowMark {
  label: string;
  title: string;
}

/**
 * The mark of a row (data-model §3.6): on a table's row the Body mark's name and tooltip; on a
 * containing entry one line per table, named or not (decision 8), as both texts; none otherwise.
 */
function rowMark(row: TreeRow, t: TFunction): RowMark | null {
  if (row.tableProblems) {
    const texts = describeTableMark(row.tableProblems, t);
    return { label: texts.name, title: texts.tooltip };
  }
  if (row.containedTables && row.containedTables.length > 0) {
    const lines = row.containedTables
      .map((summary) => {
        const problems = tableProblemsText(summary, t);
        return summary.id
          ? t('tables.mark.containsNamed', { id: summary.id, problems })
          : t('tables.mark.contains', { problems });
      })
      .join('\n');
    return { label: lines, title: lines };
  }
  return null;
}

export function DocumentTree() {
  const { t } = useTranslation();
  const services = useAppServices();
  const { store } = services;
  const ctx = useCommandContext();
  useAppRevision();
  const document = useAppState((s) => s.document, store);
  const selectionNodeId = useAppState((s) => s.selectionNodeId, store);
  const selectionPath = useAppState((s) => s.selectionPath, store);
  const sourceDirty = useAppState((s) => s.sourceDirty || s.sourceOnly, store);
  const feature = getTreeFeature(store);
  const panel = useSyncExternalStore(feature.subscribe, feature.getState);
  const { selection, collapsed } = panel;

  // The Annotation / History rows carry the tree node texts of the interface language.
  const captions = useMemo(
    () => ({ annotation: t('tree.node.annotation'), history: t('tree.node.history') }),
    [t],
  );
  const index = useMemo(() => buildTreeIndex(document, captions), [document, captions]);
  const rows = useMemo(() => visibleRows(index, collapsed), [index, collapsed]);
  const selectedId = selection.id && index.rows.has(selection.id) ? selection.id : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const scrollToSelected = useRef(false);

  /* ------------------------------------------------------------ feature */

  useEffect(() => {
    feature.registerFocus(() => {
      const container = containerRef.current;
      if (!container) return false;
      container.focus({ preventScroll: true });
      return true;
    });
    return () => feature.registerFocus(null);
  }, [feature]);

  // Viewport height for the virtualised list.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      if (container.clientHeight > 0) setViewportHeight(container.clientHeight);
    };
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  /* --------------------------------------------------------- Body -> tree */

  useEffect(() => {
    if (!document || !selectionNodeId) return;
    const rowId = rowForSelection(index, document, selectionNodeId, selectionPath);
    if (!rowId) return;
    const pending = feature.takePendingNavigation();
    if (pending && (rowId === pending || isRowWithin(index, rowId, pending))) {
      // Echo of a navigation started from the tree: keep the clicked row selected.
      return;
    }
    feature.expand(ancestorRows(index, rowId));
    feature.select(rowId, 'body');
    scrollToSelected.current = true;
  }, [selectionNodeId, selectionPath, document, index, feature]);

  useLayoutEffect(() => {
    if (!scrollToSelected.current || !selectedId) return;
    const container = containerRef.current;
    const position = rows.findIndex((row) => row.id === selectedId);
    if (!container || position < 0) return;
    scrollToSelected.current = false;
    const top = position * TREE_ROW_HEIGHT;
    const height = container.clientHeight || viewportHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (top + TREE_ROW_HEIGHT > container.scrollTop + height) {
      container.scrollTop = top + TREE_ROW_HEIGHT - height;
    }
    setScrollTop(container.scrollTop);
  }, [rows, selectedId, viewportHeight]);

  /* --------------------------------------------------------- tree -> Body */

  const selectRow = useCallback(
    (rowId: string, scroll = false) => {
      feature.markNavigation(rowId);
      feature.select(rowId, 'tree');
      if (scroll) scrollToSelected.current = true;
      if (sourceDirty) return;
      const controller = bodyController(store);
      if (controller) revealInBody(controller, rowId);
    },
    [feature, sourceDirty, store],
  );

  const runCommand = useCallback(
    (id: string) => {
      void services.commands.execute(id, ctx);
    },
    [services.commands, ctx],
  );

  const openMenuAt = useCallback((x: number, y: number) => setMenu({ x, y }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const current = selectedId ? rows.findIndex((row) => row.id === selectedId) : -1;
    const moveTo = (position: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, position))];
      if (target) selectRow(target.id, true);
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveTo(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(current <= 0 ? 0 : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(rows.length - 1);
        break;
      case 'ArrowRight': {
        event.preventDefault();
        const row = rows[current];
        if (!row) moveTo(0);
        else if (row.childIds.length > 0 && collapsed.has(row.id)) feature.toggleCollapsed(row.id);
        else if (row.childIds.length > 0) moveTo(current + 1);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        const row = rows[current];
        if (!row) break;
        if (row.childIds.length > 0 && !collapsed.has(row.id)) {
          feature.toggleCollapsed(row.id);
        } else if (row.parentId) {
          const parent = rows.findIndex((candidate) => candidate.id === row.parentId);
          if (parent >= 0) moveTo(parent);
        }
        break;
      }
      case 'Enter':
        event.preventDefault();
        if (selectedId) runCommand('tree.view');
        break;
      case '*':
        event.preventDefault();
        feature.expandAll();
        break;
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) break;
        event.preventDefault();
        const container = containerRef.current;
        if (!container) break;
        const rect = container.getBoundingClientRect();
        const top = rect.top + Math.max(0, current) * TREE_ROW_HEIGHT - container.scrollTop;
        openMenuAt(rect.left + 40, Math.min(rect.bottom, top + TREE_ROW_HEIGHT));
        break;
      }
      default:
        break;
    }
  };

  /* ------------------------------------------------------------- render */

  if (!document) {
    return (
      <div className="mfbe-tree" data-testid="panel-tree">
        <div className="mfbe-tree-caption" data-testid="panel-tree-caption">
          {t('tree.caption')}
        </div>
        <div className="mfbe-tree-content" role="tree" aria-label={t('tree.caption')}>
          <div className="mfbe-view-placeholder" data-testid="panel-tree-empty">
            {t('tree.empty')}
          </div>
        </div>
      </div>
    );
  }

  const first = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / TREE_ROW_HEIGHT) + OVERSCAN,
  );
  const rendered = rows.slice(first, last);

  return (
    <div className="mfbe-tree" data-testid="panel-tree">
      <div className="mfbe-tree-caption" data-testid="panel-tree-caption">
        {t('tree.caption')}
      </div>
      <div
        className="mfbe-tree-toolbar"
        role="toolbar"
        aria-label={t('tree.a11y.toolbar')}
        data-testid="tree-toolbar"
      >
        {TREE_TOOLBAR.map((button) => {
          const commandId = treeOpCommandId(button.op);
          const command = services.commands.get(commandId);
          const enabled = services.commands.isEnabled(commandId, ctx);
          const tooltip = command ? commandTooltip(command, t) : t(button.labelKey);
          return (
            <button
              key={button.op}
              type="button"
              className="mfbe-toolbar-button mfbe-tree-toolbar-button"
              data-testid={button.testId}
              data-command={commandId}
              title={t(button.labelKey)}
              aria-label={tooltip}
              aria-description={command ? commandDescription(command, t) : undefined}
              disabled={!enabled}
              onClick={() => runCommand(commandId)}
            >
              <img src={treeIconUrl(button.icon)} width={24} height={24} alt="" draggable={false} />
            </button>
          );
        })}
      </div>
      <div
        ref={containerRef}
        className="mfbe-tree-content"
        role="tree"
        tabIndex={0}
        aria-label={t('tree.caption')}
        aria-activedescendant={selectedId ? `tree-row-${selectedId}` : undefined}
        data-testid="tree-content"
        data-row-count={index.order.length}
        data-visible-count={rows.length}
        data-section-count={index.sectionCount}
        data-selected-id={selectedId ?? undefined}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          // A right-click below the items shows nothing, as in the original; the keyboard's
          // menu key (button -1) opens the selected item's menu.
          if (event.button === 2) return;
          openMenuAt(event.clientX, event.clientY);
        }}
      >
        <div
          className="mfbe-tree-rows"
          style={{ height: rows.length * TREE_ROW_HEIGHT }}
          data-testid="tree-rows"
        >
          {rendered.map((row, offset) => (
            <TreeRowView
              key={row.id}
              row={row}
              mark={rowMark(row, t)}
              top={(first + offset) * TREE_ROW_HEIGHT}
              selected={row.id === selectedId}
              expanded={row.childIds.length > 0 ? !collapsed.has(row.id) : undefined}
              onSelect={selectRow}
              onToggle={feature.toggleCollapsed.bind(feature)}
              onActivate={() => runCommand('tree.view')}
              onContextMenu={(x, y) => {
                // Right-click selects the row without moving the Body (the Body would scroll
                // and close the menu); View / the operations reveal the element afterwards.
                if (row.id !== selectedId) {
                  feature.markNavigation(row.id);
                  feature.select(row.id, 'tree');
                }
                openMenuAt(x, y);
              }}
              expandLabel={t('tree.a11y.expand')}
              collapseLabel={t('tree.a11y.collapse')}
            />
          ))}
        </div>
      </div>
      {menu ? <TreeContextMenu position={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

interface TreeRowViewProps {
  row: TreeRow;
  /** The irregular-table mark of the row (feature 006 US8), or null. */
  mark: RowMark | null;
  top: number;
  selected: boolean;
  /** undefined for leaf rows. */
  expanded: boolean | undefined;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onActivate: () => void;
  onContextMenu: (x: number, y: number) => void;
  expandLabel: string;
  collapseLabel: string;
}

function TreeRowView({
  row,
  mark,
  top,
  selected,
  expanded,
  onSelect,
  onToggle,
  onActivate,
  onContextMenu,
  expandLabel,
  collapseLabel,
}: TreeRowViewProps) {
  return (
    <div
      id={`tree-row-${row.id}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={expanded}
      className={`mfbe-tree-row${selected ? ' mfbe-tree-row-selected' : ''}`}
      style={{ top, height: TREE_ROW_HEIGHT, paddingLeft: 4 + row.depth * 16 }}
      data-testid={`tree-row-${row.id}`}
      data-kind={row.kind}
      data-row-kind={row.kind}
      data-depth={row.depth}
      data-selected={selected ? 'true' : undefined}
      data-irregular={mark ? 'true' : undefined}
      onClick={() => onSelect(row.id)}
      onDoubleClick={(event) => {
        event.preventDefault();
        onActivate();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      {expanded === undefined ? (
        <span className="mfbe-tree-toggle mfbe-tree-toggle-leaf" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="mfbe-tree-toggle"
          tabIndex={-1}
          aria-label={expanded ? collapseLabel : expandLabel}
          data-testid={`tree-toggle-${row.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(row.id);
          }}
        >
          {expanded ? '\u25BE' : '\u25B8'}
        </button>
      )}
      <img
        className="mfbe-tree-icon"
        src={treeIconUrl(ROW_ICONS[row.kind])}
        width={16}
        height={16}
        alt=""
        draggable={false}
      />
      <span className="mfbe-tree-row-caption" title={row.caption}>
        {row.caption}
      </span>
      {mark ? (
        <span
          className="mfbe-table-mark-badge mfbe-tree-mark"
          role="img"
          aria-label={mark.label}
          title={mark.title}
          data-testid={`tree-row-${row.id}-mark`}
        >
          !
        </span>
      ) : null}
    </div>
  );
}
