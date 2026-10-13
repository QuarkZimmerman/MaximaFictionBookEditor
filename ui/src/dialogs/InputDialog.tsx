/**
 * Prompt + single-line input, modelled on the original `IDD_INPUTBOX` ("Input" caption,
 * "Text:" prompt, Yes / No / Cancel buttons; also used by the legacy `InputBox` script helper).
 * The `okCancel` variant is the plain prompt.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from './Dialog';
import type { InputDialogOptions, InputDialogResult } from './types';

export interface InputDialogProps {
  options: InputDialogOptions;
  onClose: (result: InputDialogResult) => void;
}

export function InputDialog({ options, onClose }: InputDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(options.defaultValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const testId = options.testId ?? 'inputdialog';
  const variant = options.buttons ?? 'yesNoCancel';

  const confirm = (button: 'ok' | 'yes') => {
    const problem = options.validate ? options.validate(value) : null;
    if (problem) {
      setError(problem);
      return;
    }
    onClose({ button, value });
  };

  const buttons: DialogButton[] =
    variant === 'yesNoCancel'
      ? [
          { id: 'yes', label: t('dialog.buttons.yes'), onClick: () => confirm('yes') },
          {
            id: 'no',
            label: t('dialog.buttons.no'),
            onClick: () => onClose({ button: 'no', value }),
          },
          {
            id: 'cancel',
            label: t('dialog.buttons.cancel'),
            onClick: () => onClose({ button: 'cancel', value }),
          },
        ]
      : [
          { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => confirm('ok') },
          {
            id: 'cancel',
            label: t('dialog.buttons.cancel'),
            onClick: () => onClose({ button: 'cancel', value }),
          },
        ];

  const inputId = `${testId}-input`;

  return (
    <Dialog
      title={options.caption ?? t('dialog.input.caption')}
      buttons={buttons}
      defaultButtonId={variant === 'yesNoCancel' ? 'yes' : 'ok'}
      cancelButtonId="cancel"
      initialFocus={`#${inputId}`}
      testId={testId}
      className="mfbe-inputdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <label className="mfbe-inputdialog-prompt" htmlFor={inputId} data-testid={`${testId}-prompt`}>
        {options.prompt ?? t('dialog.input.prompt')}
      </label>
      <input
        id={inputId}
        className="mfbe-inputdialog-input"
        type="text"
        value={value}
        placeholder={options.placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        data-testid={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${testId}-error` : undefined}
      />
      {error ? (
        <div
          className="mfbe-inputdialog-error"
          id={`${testId}-error`}
          data-testid={`${testId}-error`}
        >
          {error}
        </div>
      ) : null}
    </Dialog>
  );
}
