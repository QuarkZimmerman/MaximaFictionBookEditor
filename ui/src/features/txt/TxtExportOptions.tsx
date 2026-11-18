/**
 * Feature 017 (D2, D10, DP-5): the TXT export's options, asked in the editor's own window when the
 * system Save dialog could not carry them (it answered without the encoding, the ZIP box or the
 * byte-order mark box), as the PDF export asks for its page size. *Cancel* writes nothing. Static:
 * the command asks before the export's part loads.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';

export interface TxtExportChoice {
  encoding: string;
  bom: boolean;
  zip: boolean;
}

export interface TxtExportOptionsProps extends TxtExportChoice {
  /** The encodings offered, each with its shown name. */
  encodings: { name: string; label: string }[];
  /** The file chosen, shown as a hint. */
  path?: string;
  onClose: (choice: TxtExportChoice | null) => void;
}

export function TxtExportOptions({ encodings, path, onClose, ...first }: TxtExportOptionsProps) {
  const { t } = useTranslation();
  const [encoding, setEncoding] = useState(first.encoding);
  const [bom, setBom] = useState(first.bom);
  const [zip, setZip] = useState(first.zip);
  const choice = (): TxtExportChoice => ({ encoding, bom, zip });
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose(choice()) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('cmd.file.exportTxt.tooltip')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-txt-export-encoding"
      testId="dialog-txt-export-options"
      className="mfbe-encodingdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      {path ? (
        <div className="mfbe-encodingdialog-path" data-testid="dialog-txt-export-path">
          {path}
        </div>
      ) : null}
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-txt-export-encoding">
        {t('txt.encodingLabel')}
      </label>
      <select
        id="dialog-txt-export-encoding"
        className="mfbe-encodingdialog-select"
        size={Math.min(12, encodings.length)}
        value={encoding}
        onChange={(event) => setEncoding(event.target.value)}
        onDoubleClick={() => onClose(choice())}
        {...tip(t('tip.txt.encoding'))}
        data-testid="dialog-txt-export-encoding"
      >
        {encodings.map((e) => (
          <option key={e.name} value={e.name} data-testid={`dialog-txt-export-encoding-${e.name}`}>
            {e.label}
          </option>
        ))}
      </select>
      <label className="mfbe-encodingdialog-zip" data-testid="dialog-txt-export-bom">
        <input
          type="checkbox"
          checked={bom}
          disabled={encoding !== 'utf-8'}
          onChange={(event) => setBom(event.target.checked)}
          data-testid="dialog-txt-export-bom-box"
          {...tip(t('tip.txt.bom'))}
        />
        {t('txt.bomChoice')}
      </label>
      <label className="mfbe-encodingdialog-zip" data-testid="dialog-txt-export-zip">
        <input
          type="checkbox"
          checked={zip}
          onChange={(event) => setZip(event.target.checked)}
          data-testid="dialog-txt-export-zip-box"
          {...tip(t('tip.txt.zip'))}
        />
        {t('txt.zipChoice')}
      </label>
    </Dialog>
  );
}
