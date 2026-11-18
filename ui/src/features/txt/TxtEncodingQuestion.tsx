/**
 * Feature 017 (D26): the encoding of a text file, asked when the judge cannot tell - the most plausible
 * encodings first, then every other the editor reads (29 in all). *Cancel* ends the import, nothing
 * changed. Static: asked before the import's part loads.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';

export interface TxtEncodingQuestionProps {
  /** The encodings in the order offered, each with its shown name. */
  encodings: { name: string; label: string }[];
  /** The file being imported, shown as a hint. */
  path?: string;
  onClose: (encoding: string | null) => void;
}

export function TxtEncodingQuestion({ encodings, path, onClose }: TxtEncodingQuestionProps) {
  const { t } = useTranslation();
  const [encoding, setEncoding] = useState(encodings[0]?.name ?? 'utf-8');
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose(encoding) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('cmd.file.importTxt.tooltip')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-txt-import-encoding"
      testId="dialog-txt-import-encoding-question"
      className="mfbe-encodingdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      {path ? (
        <div className="mfbe-encodingdialog-path" data-testid="dialog-txt-import-path">
          {path}
        </div>
      ) : null}
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-txt-import-encoding">
        {t('txt.encodingQuestion')}
      </label>
      <select
        id="dialog-txt-import-encoding"
        className="mfbe-encodingdialog-select"
        size={Math.min(12, encodings.length)}
        value={encoding}
        onChange={(event) => setEncoding(event.target.value)}
        onDoubleClick={() => onClose(encoding)}
        {...tip(t('tip.txt.importEncoding'))}
        data-testid="dialog-txt-import-encoding"
      >
        {encodings.map((e) => (
          <option key={e.name} value={e.name} data-testid={`dialog-txt-import-encoding-${e.name}`}>
            {e.label}
          </option>
        ))}
      </select>
    </Dialog>
  );
}
