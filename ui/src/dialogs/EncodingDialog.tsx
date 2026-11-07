/**
 * Encoding chooser for Save As (the "Encoding:" extra control of the original save dialog,
 * IDS_ENCODINGS). Shown when the native file dialog did not return an encoding; lists the nine
 * supported encodings with the default preselected (`keepEncoding` ? source encoding : default
 * encoding). Open it with `showEncodingDialog()` (show.ts); resolves with the chosen encoding or
 * null.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from './Dialog';
import { ENCODING_CHOICES, normalizeEncoding } from './encodings';
import { tip } from '@/app/tooltips';

export interface EncodingDialogProps {
  defaultEncoding: string;
  /** Shown as a hint, e.g. the file being saved. */
  path?: string;
  /**
   * Feature 009 (DP-8): when set, the "save as ZIP archive" checkbox, starting in this state -
   * the window then stands in for a Save As dialog that could not carry it.
   */
  zip?: boolean;
  onClose: (encoding: string | null, zip: boolean) => void;
}

export function EncodingDialog({ defaultEncoding, path, zip, onClose }: EncodingDialogProps) {
  const { t } = useTranslation();
  const [encoding, setEncoding] = useState(
    normalizeEncoding(defaultEncoding) ?? ENCODING_CHOICES[0]!,
  );
  const [zipChecked, setZipChecked] = useState(zip ?? false);
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose(encoding, zipChecked) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null, zipChecked) },
  ];
  return (
    <Dialog
      title={t('cmd.file.saveAs.tooltip')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-encoding-select"
      testId="dialog-encoding"
      className="mfbe-encodingdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      {path ? (
        <div className="mfbe-encodingdialog-path" data-testid="dialog-encoding-path">
          {path}
        </div>
      ) : null}
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-encoding-select">
        {t('dialog.saveFile.encoding')}
      </label>
      <select
        {...tip(t('tip.saveFile.encoding'))}
        id="dialog-encoding-select"
        className="mfbe-encodingdialog-select"
        size={ENCODING_CHOICES.length}
        value={encoding}
        onChange={(event) => setEncoding(event.target.value)}
        onDoubleClick={() => onClose(encoding, zipChecked)}
        data-testid="dialog-encoding-select"
      >
        {ENCODING_CHOICES.map((choice) => (
          <option key={choice} value={choice} data-testid={`dialog-encoding-option-${choice}`}>
            {choice}
          </option>
        ))}
      </select>
      {zip !== undefined && (
        <label className="mfbe-checkbox-row">
          <input
            {...tip(t('tip.saveFile.zip'))}
            type="checkbox"
            checked={zipChecked}
            onChange={(event) => setZipChecked(event.target.checked)}
            data-testid="save-options-zip"
          />
          {t('dialog.saveFile.zip')}
        </label>
      )}
    </Dialog>
  );
}
