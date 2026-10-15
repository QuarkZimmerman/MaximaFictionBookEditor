/**
 * Right-click menu of the Description view's text fields (feature 002 FR-064): the menu the
 * original showed there, the Body view's (one browser view held both) - Undo, Cut, Copy, Paste,
 * acting on the field under the pointer. Elsewhere in the view a right-click shows nothing.
 */

import { useTranslation } from 'react-i18next';

import { commandLabel } from '@/app/commands';
import { PopupMenu, type PopupMenuItem } from '@/app/PopupMenu';
import { useAppServices, useCommandContext } from '@/app/services';
import { cutOrCopy, hasSelectedText, isWritable, pasteIntoField } from '@/app/textFields';

export interface FieldContextMenuProps {
  field: HTMLElement;
  position: { x: number; y: number };
  onClose: () => void;
}

export function FieldContextMenu({ field, position, onClose }: FieldContextMenuProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const undo = services.commands.get('edit.undo');
  const selected = hasSelectedText(field);
  const writable = isWritable(field);
  const items: PopupMenuItem[] = [
    {
      id: 'edit.undo',
      label: undo ? commandLabel(undo, t) : '',
      enabled: services.commands.isEnabled('edit.undo', ctx),
      run: () => void services.commands.execute('edit.undo', ctx),
    },
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
