/**
 * The Source view's right-click menu (feature 002 FR-064), as the original's source editor
 * (Scintilla) showed it: Undo, Redo, Cut, Copy, Paste, Delete and Select All. Undo and Redo are
 * the Edit menu's; the others act on the editor's selection. After them, *Table…*
 * (`insert.table`; feature 006, FR-061, U35), judged at the clicked point - the `point` the view
 * takes with `controller.pointAt` at the right-click (C28) -: enabled where the table rule's
 * verdict there is `ok` and the editor is writable, otherwise disabled with its reason (FR-043);
 * opening the menu moves nothing, running the entry first moves the cursor to the clicked point
 * (unless the click lay in a selection, which is kept) and then executes `insert.table`. While
 * the AI assistant is on the menu ends with *Ask AI...* (`ai.ask`; feature 005 US5, FR-030),
 * which opens the popup for the selected XML text - a selection over a binary, the stylesheet
 * or the prolog is refused by the popup itself before any request (review C11).
 */

import { selectAll } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { useTranslation } from 'react-i18next';

import { unavailableTitle } from '@/app/commands';
import { PopupMenu, type PopupMenuEntry, type PopupMenuItem } from '@/app/PopupMenu';
import { useAppServices, useCommandContext } from '@/app/services';
import { sourceTableReason } from '@/features/tables/sourceTable';
import { isRunLocked, useAppState } from '@/model/store';

import { pasteIntoSource } from './sourceClipboard';
import type { SourceEditorController, SourcePointAt } from './sourceEditor';

export interface SourceContextMenuProps {
  controller: SourceEditorController;
  position: { x: number; y: number };
  /** The table rule at the right-click (`controller.pointAt`): where *Table…* is judged. */
  point: SourcePointAt;
  onClose: () => void;
}

export function SourceContextMenu({
  controller,
  position,
  point,
  onClose,
}: SourceContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const view = controller.editorView;
  const state = controller.state;
  const selected = state.selection.ranges.some((range) => !range.empty);
  const writable = !!view && !state.readOnly;
  // The assistant's entry exists while it is on (FR-030); `ai.ask` decides whether it is enabled.
  const assistantOn = useAppState((s) => s.ai.on, services.store);

  const history = (id: 'undo' | 'redo'): PopupMenuEntry => ({
    id,
    label: t(`source.contextMenu.${id}`),
    enabled: services.commands.isEnabled(`edit.${id}`, ctx),
    run: () => void services.commands.execute(`edit.${id}`, ctx),
  });
  const onView = (run: (view: EditorView) => void) => () => {
    if (!view) return;
    view.focus();
    run(view);
  };

  // *Table…*: the run lock's text first (the registry's), then the verdict at the clicked point.
  const tableEntry = (): PopupMenuEntry => {
    const command = services.commands.get('insert.table');
    const available = !!command && !command.stub;
    const locked = isRunLocked(services.store.getState()) && command?.duringScriptRun !== 'allowed';
    const enabled = available && !locked && writable && point.verdict.code === 'ok';
    let reason: string | null = null;
    if (available && !enabled) {
      reason = locked
        ? services.commands.unavailableReason('insert.table', ctx)
        : sourceTableReason(point.verdict, ctx.t);
    }
    return {
      id: 'insert.table',
      label: t('tables.contextMenu.table'),
      enabled,
      title: command && reason ? unavailableTitle(command, reason, ctx.t) : undefined,
      run: () => {
        const target = controller.target;
        if (point.moveTo !== null) {
          const at = Math.min(Math.max(point.moveTo, 0), target.state.doc.length);
          target.dispatch({ selection: { anchor: at } });
        }
        void services.commands.execute('insert.table', ctx);
      },
    };
  };

  const items: PopupMenuItem[] = [
    history('undo'),
    history('redo'),
    'separator',
    {
      id: 'cut',
      label: t('source.contextMenu.cut'),
      enabled: selected && writable,
      run: onView(() => document.execCommand('cut')),
    },
    {
      id: 'copy',
      label: t('source.contextMenu.copy'),
      enabled: selected && !!view,
      run: onView(() => document.execCommand('copy')),
    },
    {
      id: 'paste',
      label: t('source.contextMenu.paste'),
      enabled: writable,
      run: () => {
        if (view) void pasteIntoSource(view);
      },
    },
    {
      id: 'delete',
      label: t('source.contextMenu.delete'),
      enabled: selected && writable,
      run: onView((target) =>
        target.dispatch({
          ...target.state.replaceSelection(''),
          scrollIntoView: true,
          userEvent: 'delete.selection',
        }),
      ),
    },
    'separator',
    {
      id: 'selectAll',
      label: t('source.contextMenu.selectAll'),
      enabled: !!view,
      run: onView((target) => selectAll(target)),
    },
    'separator',
    tableEntry(),
    ...(assistantOn
      ? ([
          'separator',
          {
            id: 'ai.ask',
            label: t('ai.ask.label'),
            enabled: services.commands.isEnabled('ai.ask', ctx),
            run: () => void services.commands.execute('ai.ask', ctx),
          },
        ] satisfies PopupMenuItem[])
      : []),
  ];
  return (
    <PopupMenu items={items} position={position} onClose={onClose} testId="source-context-menu" />
  );
}
