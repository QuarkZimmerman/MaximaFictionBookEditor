/**
 * The Source view's right-click menu (feature 002 FR-064), as the original's source editor
 * (Scintilla) showed it: Undo, Redo, Cut, Copy, Paste, Delete and Select All. Undo and Redo are
 * the Edit menu's; the others act on the editor's selection.
 */

import { selectAll } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { useTranslation } from 'react-i18next';

import { PopupMenu, type PopupMenuEntry, type PopupMenuItem } from '@/app/PopupMenu';
import { useAppServices, useCommandContext } from '@/app/services';

import { pasteIntoSource } from './sourceClipboard';
import type { SourceEditorController } from './sourceEditor';

export interface SourceContextMenuProps {
  controller: SourceEditorController;
  position: { x: number; y: number };
  onClose: () => void;
}

export function SourceContextMenu({ controller, position, onClose }: SourceContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const view = controller.editorView;
  const state = controller.state;
  const selected = state.selection.ranges.some((range) => !range.empty);
  const writable = !!view && !state.readOnly;

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
  ];
  return (
    <PopupMenu items={items} position={position} onClose={onClose} testId="source-context-menu" />
  );
}
