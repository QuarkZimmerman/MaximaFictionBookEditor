/**
 * "Open «name» in this window or in a new window?" (feature 008, FR-007, FR-008): asked when a
 * book opened from outside the editor reaches a copy that holds a book. *New window* is the
 * default answer (Enter), Escape cancels; *Don't ask again* stores the answer, never Cancel.
 * Open it with `showOpenElsewhereDialog()` (show.ts).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from './Dialog';

export type OpenElsewhereChoice = 'thisWindow' | 'newWindow' | 'cancel';

export interface OpenElsewhereAnswer {
  choice: OpenElsewhereChoice;
  remember: boolean;
}

export interface OpenElsewhereDialogProps {
  /** The book's file name. */
  name: string;
  onClose: (answer: OpenElsewhereAnswer) => void;
}

export function OpenElsewhereDialog({ name, onClose }: OpenElsewhereDialogProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  const buttons: DialogButton[] = [
    {
      id: 'this',
      label: t('openElsewhere.thisWindow'),
      onClick: () => onClose({ choice: 'thisWindow', remember }),
    },
    {
      id: 'new',
      label: t('openElsewhere.newWindow'),
      onClick: () => onClose({ choice: 'newWindow', remember }),
    },
    {
      id: 'cancel',
      label: t('dialog.buttons.cancel'),
      onClick: () => onClose({ choice: 'cancel', remember: false }),
    },
  ];
  return (
    <Dialog
      title={t('app.name')}
      buttons={buttons}
      defaultButtonId="new"
      cancelButtonId="cancel"
      testId="open-elsewhere-dialog"
      className="mfbe-messagebox"
      closeLabel={t('dialog.buttons.close')}
      icon={
        <span className="mfbe-messagebox-glyph mfbe-messagebox-glyph-question" aria-hidden="true">
          ?
        </span>
      }
    >
      <div className="mfbe-messagebox-text" data-testid="open-elsewhere-text">
        {t('openElsewhere.question', { name })}
      </div>
      <label className="mfbe-checkbox-row">
        <input
          type="checkbox"
          data-testid="open-elsewhere-remember"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        {t('openElsewhere.remember')}
      </label>
    </Dialog>
  );
}
