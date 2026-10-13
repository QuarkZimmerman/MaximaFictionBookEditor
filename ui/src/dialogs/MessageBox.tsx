/**
 * Message box with the classic button sets (OK, OK/Cancel, Yes/No, Yes/No/Cancel,
 * Abort/Retry/Ignore, Close) and icons. Open it through `showMessage()` (show.ts).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BUTTON_SETS } from './buttonSets';
import { Dialog, type DialogButton } from './Dialog';
import type { MessageBoxOptions, MessageBoxResult, MessageIcon } from './types';

const ICON_GLYPHS: Record<Exclude<MessageIcon, 'none'>, string> = {
  info: 'i',
  question: '?',
  warning: '!',
  error: '\u00D7',
};

export interface MessageBoxProps {
  options: MessageBoxOptions;
  onClose: (result: MessageBoxResult) => void;
}

export function MessageBox({ options, onClose }: MessageBoxProps) {
  const { t } = useTranslation();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const set = BUTTON_SETS[options.buttons ?? 'ok'];
  const testId = options.testId ?? 'messagebox';
  const icon = options.icon ?? 'none';

  const buttons: DialogButton[] = set.buttons.map((id) => ({
    id,
    label: t(`dialog.buttons.${id}`),
    onClick: () => onClose({ button: id, dontAskAgain }),
  }));

  return (
    <Dialog
      title={options.caption ?? t('app.name')}
      buttons={buttons}
      defaultButtonId={options.defaultButton ?? set.buttons[0]}
      cancelButtonId={set.cancel}
      testId={testId}
      className="mfbe-messagebox"
      closeLabel={t('dialog.buttons.close')}
      icon={
        icon !== 'none' ? (
          <span
            className={`mfbe-messagebox-glyph mfbe-messagebox-glyph-${icon}`}
            aria-hidden="true"
            data-testid={`${testId}-icon-${icon}`}
          >
            {ICON_GLYPHS[icon]}
          </span>
        ) : undefined
      }
    >
      <div className="mfbe-messagebox-text" data-testid={`${testId}-text`}>
        {options.text}
      </div>
      {options.dontAskAgain ? (
        <label className="mfbe-messagebox-dontask">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
            data-testid={`${testId}-dontask`}
          />
          {t('dialog.dontAskAgain')}
        </label>
      ) : null}
    </Dialog>
  );
}
