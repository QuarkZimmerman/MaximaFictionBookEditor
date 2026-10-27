/**
 * Right-click menu of the Description view's text fields (feature 002 FR-064): the menu the
 * original showed there, the Body view's (one browser view held both) - Undo, Cut, Copy, Paste,
 * acting on the field under the pointer. Elsewhere in the view a right-click shows nothing.
 *
 * Feature 006, US10 (FR-044, FR-040, FR-043; decision 2; C28, C29; U9, U12; data-model §9.3): in
 * a rich field - the book annotation, the source book's annotation, the history - the menu goes
 * on, after Undo, Cut, Copy and Paste, with *Inline image…* while the caret lies in a cell of
 * the field, then the table section of the Body view (*Table…*, judged at the clicked point, and
 * *Table structure ▸* for a click in a table), its entries without accelerators. Cut and Copy
 * follow the field's own selection - a block of cells counts although no text of the page is
 * selected -, *Paste* routes the whole clipboard through the field's router. The opener
 * (`DescriptionView`) made the field the active table target and applied the right-click rule.
 * A plain field keeps its four entries.
 */

import { useTranslation } from 'react-i18next';

import { commandLabel, unavailableTitle } from '@/app/commands';
import { PopupMenu, type PopupMenuItem } from '@/app/PopupMenu';
import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { cutOrCopy, hasSelectedText, isWritable, pasteIntoField } from '@/app/textFields';
import { caretInCell } from '@/editor/commands/insert';
import { cutOrCopyTarget, pasteIntoTarget } from '@/features/clipboard';
import { tableSectionItems } from '@/features/tables/contextMenu';
import { fieldTargetFor } from '@/features/tables/target';
import {
  isSeparator,
  type ContextMenuClick,
  type ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

export interface FieldContextMenuProps {
  field: HTMLElement;
  position: { x: number; y: number };
  /** Where a rich field was clicked: the document position under the pointer (US10). */
  click?: ContextMenuClick;
  onClose: () => void;
}

/** A label shown as it is: a literal `&` stays one (the section carries no accelerators, U12). */
const literal = (label: string) => label.replace(/&/g, '&&');

/** The table section's items as `PopupMenu` items. */
function popupItems(items: readonly ContextMenuItem[]): PopupMenuItem[] {
  return items.map((item) =>
    isSeparator(item)
      ? 'separator'
      : {
          id: item.id,
          label: literal(item.label),
          enabled: item.enabled,
          title: item.title,
          items: item.items ? popupItems(item.items) : undefined,
          run: item.run,
        },
  );
}

export function FieldContextMenu({ field, position, click, onClose }: FieldContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const undo = services.commands.get('edit.undo');
  const undoEntry: PopupMenuItem = {
    id: 'edit.undo',
    label: undo ? commandLabel(undo, t) : '',
    enabled: services.commands.isEnabled('edit.undo', ctx),
    run: () => void services.commands.execute('edit.undo', ctx),
  };
  const target = fieldTargetFor(field);
  if (!target) {
    const selected = hasSelectedText(field);
    const writable = isWritable(field);
    const items: PopupMenuItem[] = [
      undoEntry,
      'separator',
      {
        id: 'edit.cut',
        label: t('editing.contextMenu.cut'),
        enabled: selected && writable,
        run: () => cutOrCopy(field, true),
      },
      {
        id: 'edit.copy',
        label: t('editing.contextMenu.copy'),
        enabled: selected,
        run: () => cutOrCopy(field, false),
      },
      {
        id: 'edit.paste',
        label: t('editing.contextMenu.paste'),
        enabled: writable,
        run: () => void pasteIntoField(field),
      },
    ];
    return <PopupMenu items={items} position={position} onClose={onClose} testId="context-menu" />;
  }

  // A rich field: its own selection decides Cut and Copy (a block is never empty; U9).
  const state = target.state;
  const selected = !!state && !state.selection.empty;
  const items: PopupMenuItem[] = [
    undoEntry,
    'separator',
    {
      id: 'edit.cut',
      label: t('editing.contextMenu.cut'),
      enabled: selected && target.editable,
      run: () => void cutOrCopyTarget(target, true),
    },
    {
      id: 'edit.copy',
      label: t('editing.contextMenu.copy'),
      enabled: selected,
      run: () => void cutOrCopyTarget(target, false),
    },
    {
      id: 'edit.paste',
      label: t('editing.contextMenu.paste'),
      enabled: target.editable,
      run: () => void pasteIntoTarget(ctx, target),
    },
  ];
  if (state && caretInCell(state)) {
    const spec = services.commands.get('insert.inlineImage');
    const enabled = services.commands.isEnabled('insert.inlineImage', ctx);
    const reason = enabled ? null : services.commands.unavailableReason('insert.inlineImage', ctx);
    items.push('separator', {
      id: 'insert.inlineImage',
      label: literal(t('tables.contextMenu.inlineImage')),
      enabled,
      title: spec && reason ? unavailableTitle(spec, reason, t) : undefined,
      run: () => void services.commands.execute('insert.inlineImage', ctx),
    });
  }
  const section = tableSectionItems(
    services.commands,
    target,
    click ?? { x: position.x, y: position.y, pos: null },
    ctx,
  );
  if (section.length > 0) items.push('separator', ...popupItems(section));
  return <PopupMenu items={items} position={position} onClose={onClose} testId="context-menu" />;
}
