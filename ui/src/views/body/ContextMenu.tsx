/**
 * Body context menu (T067), after `CFBEView::OnContextMenu`: Undo, Cut, Copy, Paste, one
 * "Select <element>" entry per ancestor container of the caret (section, body...), plus the
 * extension slots other stories fill: `spelling` (suggestions / Add to dictionary, US6),
 * `image` ("Save image as...", US7), `ai` ("Ask AI...", feature 005) and, after a separator,
 * the tables feature's section (*Table…* and *Table structure ▸*, feature 006, FR-040).
 *
 * Rendered by `PopupMenu` (feature 006, C29; kept by the requester at `/speckit-analyze`,
 * analyze decision 1): the position is measured once rendered, the command entries' accelerator
 * letters run them (their labels come with `&`), one submenu level opens on hover, click,
 * Enter or ArrowRight, a disabled entry shows why it is unavailable, and the focus returns as
 * `PopupMenu` returns it. The entries keep their ids, so `context-menu-<id>` stays.
 */

import { useTranslation } from 'react-i18next';

import { commandLabelRaw } from '@/app/commands';
import { PopupMenu, type PopupMenuItem } from '@/app/PopupMenu';
import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';

import type { BodyEditorController } from './bodyEditor';
import {
  contextMenuExtensions,
  isSeparator,
  selectEntries,
  type ContextMenuClick,
  type ContextMenuEntry,
  type ContextMenuItem,
} from './contextMenuExtensions';

export interface ContextMenuProps {
  controller: BodyEditorController;
  /** Where the menu was asked for: the pointer and the document position under it. */
  click: ContextMenuClick;
  onClose: () => void;
}

/** A label shown as it is: a literal `&` stays one (no accelerator from a slot's text). */
const literal = (label: string) => label.replace(/&/g, '&&');

/** The menu's items as `PopupMenu` items; `raw` marks the labels that carry `&` accelerators. */
function popupItems(items: readonly ContextMenuItem[], raw: ReadonlySet<string>): PopupMenuItem[] {
  return items.map((item) =>
    isSeparator(item)
      ? 'separator'
      : {
          id: item.id,
          label: raw.has(item.id) ? item.label : literal(item.label),
          enabled: item.enabled,
          title: item.title,
          items: item.items ? popupItems(item.items, raw) : undefined,
          run: item.run,
        },
  );
}

export function ContextMenu({ controller, click, onClose }: ContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();

  const command = (id: string, labelKey: string): ContextMenuEntry => {
    const spec = services.commands.get(id);
    return {
      id,
      label: spec ? commandLabelRaw(spec, t) : t(labelKey),
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
  // The command entries' labels carry their `&` letters; every other label is shown as it is.
  const accelerated = new Set(['edit.undo', 'edit.cut', 'edit.copy', 'edit.paste']);
  const spelling = contextMenuExtensions.spelling?.(controller) ?? [];
  if (spelling.length > 0) items.push({ separator: true, id: 'sep-spelling' }, ...spelling);
  const image = contextMenuExtensions.image?.(controller) ?? [];
  if (image.length > 0) items.push({ separator: true, id: 'sep-image' }, ...image);
  const ai = contextMenuExtensions.ai?.(controller) ?? [];
  if (ai.length > 0) items.push({ separator: true, id: 'sep-ai' }, ...ai);
  const table = contextMenuExtensions.table?.(controller, click, ctx) ?? [];
  if (table.length > 0) items.push({ separator: true, id: 'sep-table' }, ...table);

  return (
    <PopupMenu
      items={popupItems(items, accelerated)}
      position={click}
      onClose={onClose}
      testId="context-menu"
    />
  );
}
