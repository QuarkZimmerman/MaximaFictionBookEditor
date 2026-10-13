/**
 * "Save changes to <name>?" prompt (IDS_SAVE_DLG_MSG) with Yes / No / Cancel, shown whenever
 * unsaved work would be discarded (New, Open, Recent, Exit, reload after an external change).
 * Open it with `showSaveChangesPrompt()` (show.ts); the result is `yes` (save first), `no` (discard) or
 * `cancel` (keep the document and abort the action).
 */

import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from './Dialog';

export type SaveChangesAnswer = 'yes' | 'no' | 'cancel';

export interface SaveChangesPromptProps {
  /** File name (or "Untitled") shown in the question. */
  name: string;
  onClose: (answer: SaveChangesAnswer) => void;
}

export function SaveChangesPrompt({ name, onClose }: SaveChangesPromptProps) {
  const { t } = useTranslation();
  const buttons: DialogButton[] = [
    { id: 'yes', label: t('dialog.buttons.yes'), onClick: () => onClose('yes') },
    { id: 'no', label: t('dialog.buttons.no'), onClick: () => onClose('no') },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose('cancel') },
  ];
  return (
    <Dialog
      title={t('app.name')}
      buttons={buttons}
      defaultButtonId="yes"
      cancelButtonId="cancel"
      testId="dialog-save-changes"
      className="mfbe-messagebox"
      closeLabel={t('dialog.buttons.close')}
      icon={
        <span className="mfbe-messagebox-glyph mfbe-messagebox-glyph-question" aria-hidden="true">
          ?
        </span>
      }
    >
      <div className="mfbe-messagebox-text" data-testid="dialog-save-changes-text">
        {t('msg.saveChanges', { name })}
      </div>
    </Dialog>
  );
}
