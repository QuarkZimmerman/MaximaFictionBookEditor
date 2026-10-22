/**
 * Customize Toolbar (feature 002 FR-062): the Windows dialog the original opened from a
 * toolbar's right-click menu. Left, the buttons the toolbar offers and does not show, headed by
 * a separator that is always there; right, the toolbar's buttons and separators, each by its
 * tooltip text, ending with a separator entry that stands for the end of the toolbar and cannot
 * be removed or moved. Add inserts the chosen button before the selected one (at the end when
 * the end entry is selected), Remove gives a button back to the left list, Move Up / Move Down
 * reorder, Reset restores the original layout. Every change applies at once and is kept for the
 * next start. Keyboard: Tab between the lists and the buttons, arrows in the lists, the buttons'
 * accelerators, Enter and Escape close.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { commandTooltip } from '@/app/commands';
import { useAppServices } from '@/app/services';
import {
  SEPARATOR,
  availableButtons,
  saveLayout,
  shownLayout,
  type CustomizableToolbar,
} from '@/app/toolbarLayouts';
import { useAppState } from '@/model/store';

import { Dialog, type DialogButton } from './Dialog';

export interface CustomizeToolbarDialogProps {
  ctx: CommandContext;
  toolbar: CustomizableToolbar;
  /** Command ids of the scripts the Scripts toolbar can show (menu scripts with an icon). */
  scriptButtons: readonly string[];
  onClose: () => void;
}

export function CustomizeToolbarDialog({
  ctx,
  toolbar,
  scriptButtons,
  onClose,
}: CustomizeToolbarDialogProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const settings = useAppState((s) => s.settings, ctx.store);
  const current = shownLayout(settings, toolbar, scriptButtons);
  // An invisible command (the AI assistant's button while the assistant is disabled, feature
  // 005 FR-096) is not offered; the layout keeps it where a stored layout has it.
  const available = [
    SEPARATOR,
    ...availableButtons(toolbar, scriptButtons).filter(
      (item) =>
        !current.includes(item) &&
        (!services.commands.has(item) || services.commands.isVisible(item, ctx)),
    ),
  ];
  const [availableIndex, setAvailableIndex] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const selectedAvailable = Math.min(availableIndex, available.length - 1);
  // `current.length` is the end entry.
  const selectedCurrent = Math.min(currentIndex, current.length);
  const atEnd = selectedCurrent === current.length;

  const label = (item: string): string => {
    if (item === SEPARATOR) return t('dialog.customizeToolbar.separator');
    const command = services.commands.get(item);
    return command ? commandTooltip(command, t) : item;
  };
  const apply = (items: string[] | null) => void saveLayout(ctx, toolbar, items);

  const add = () => {
    const item = available[selectedAvailable];
    if (item === undefined) return;
    apply([...current.slice(0, selectedCurrent), item, ...current.slice(selectedCurrent)]);
    // The selected button stays selected, so further additions follow this one.
    setCurrentIndex(selectedCurrent + 1);
  };
  const remove = () => {
    if (atEnd) return;
    apply(current.filter((_, index) => index !== selectedCurrent));
  };
  const move = (step: -1 | 1) => {
    const target = selectedCurrent + step;
    if (atEnd || target < 0 || target >= current.length) return;
    const next = [...current];
    [next[selectedCurrent], next[target]] = [next[target]!, next[selectedCurrent]!];
    apply(next);
    setCurrentIndex(target);
  };

  const buttons: DialogButton[] = [
    { id: 'add', label: t('dialog.customizeToolbar.add'), onClick: add },
    {
      id: 'remove',
      label: t('dialog.customizeToolbar.remove'),
      disabled: atEnd,
      onClick: remove,
    },
    {
      id: 'moveUp',
      label: t('dialog.customizeToolbar.moveUp'),
      disabled: atEnd || selectedCurrent === 0,
      onClick: () => move(-1),
    },
    {
      id: 'moveDown',
      label: t('dialog.customizeToolbar.moveDown'),
      disabled: selectedCurrent >= current.length - 1,
      onClick: () => move(1),
    },
    {
      id: 'reset',
      label: t('dialog.customizeToolbar.reset'),
      onClick: () => {
        apply(null);
        setCurrentIndex(0);
      },
    },
    { id: 'close', label: t('dialog.customizeToolbar.close'), onClick: onClose },
  ];

  return (
    <Dialog
      title={t('dialog.customizeToolbar.caption')}
      buttons={buttons}
      defaultButtonId="close"
      cancelButtonId="close"
      initialFocus="#customize-toolbar-available"
      testId="dialog-customize-toolbar"
      className="mfbe-customize-toolbar"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-customize-toolbar-lists">
        <label className="mfbe-customize-toolbar-list" htmlFor="customize-toolbar-available">
          <span>{t('dialog.customizeToolbar.available')}</span>
          <select
            id="customize-toolbar-available"
            size={12}
            value={String(selectedAvailable)}
            onChange={(event) => setAvailableIndex(Number(event.target.value))}
            onDoubleClick={add}
            data-testid="customize-toolbar-available"
          >
            {available.map((item, index) => (
              <option key={`${item}-${index}`} value={String(index)} data-item={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="mfbe-customize-toolbar-list" htmlFor="customize-toolbar-current">
          <span>{t('dialog.customizeToolbar.current')}</span>
          <select
            id="customize-toolbar-current"
            size={12}
            value={String(selectedCurrent)}
            onChange={(event) => setCurrentIndex(Number(event.target.value))}
            onDoubleClick={remove}
            data-testid="customize-toolbar-current"
          >
            {current.map((item, index) => (
              <option key={`${item}-${index}`} value={String(index)} data-item={item}>
                {label(item)}
              </option>
            ))}
            <option value={String(current.length)} data-item="end">
              {t('dialog.customizeToolbar.separator')}
            </option>
          </select>
        </label>
      </div>
    </Dialog>
  );
}
