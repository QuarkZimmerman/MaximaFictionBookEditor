/**
 * Feature 018 (T023, DP-5): fallback modal shown when the platform Save dialog could not carry
 * `selects` or `zip` (Format, Table of contents, Save in ZIP archive). Static: stays in the main
 * bundle and never imports `./export/`, `./import/`, or `./shared/`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type { MobiFormat, MobiTocPlacement } from '@/rpc/types';

export interface MobiExportOptionsChoice {
  format: MobiFormat;
  tocPlacement: MobiTocPlacement;
  zip: boolean;
}

export interface MobiExportOptionsProps extends MobiExportOptionsChoice {
  path?: string;
  onClose: (choice: MobiExportOptionsChoice | null) => void;
}

const FORMAT_VALUES: readonly { value: MobiFormat; labelKey: string }[] = [
  { value: 'mobi7', labelKey: 'mobi.formats.mobi7' },
  { value: 'joint', labelKey: 'mobi.formats.joint' },
  { value: 'kf8', labelKey: 'mobi.formats.kf8' },
];

const TOC_VALUES: readonly { value: MobiTocPlacement; labelKey: string }[] = [
  { value: 'afterTitle', labelKey: 'mobi.tocPlacements.afterTitle' },
  { value: 'end', labelKey: 'mobi.tocPlacements.end' },
  { value: 'none', labelKey: 'mobi.tocPlacements.none' },
];

export function MobiExportOptions({ path, onClose, ...initial }: MobiExportOptionsProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<MobiFormat>(initial.format);
  const [tocPlacement, setTocPlacement] = useState<MobiTocPlacement>(initial.tocPlacement);
  const [zip, setZip] = useState<boolean>(initial.zip);

  const choice = (): MobiExportOptionsChoice => ({ format, tocPlacement, zip });
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose(choice()) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  return (
    <Dialog
      title={t('mobi.optionsCaption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-mobi-export-format"
      testId="dialog-mobi-export-options"
      className="mfbe-encodingdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      {path ? (
        <div className="mfbe-encodingdialog-path" data-testid="dialog-mobi-export-path">
          {path}
        </div>
      ) : null}
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-mobi-export-format">
        {t('mobi.formatLabel')}
      </label>
      <select
        id="dialog-mobi-export-format"
        className="mfbe-encodingdialog-select"
        value={format}
        onChange={(event) => setFormat(event.target.value as MobiFormat)}
        {...tip(t('tip.mobi.format'))}
        data-testid="dialog-mobi-export-format"
      >
        {FORMAT_VALUES.map((item) => (
          <option
            key={item.value}
            value={item.value}
            data-testid={`dialog-mobi-export-format-${item.value}`}
          >
            {t(item.labelKey)}
          </option>
        ))}
      </select>

      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-mobi-export-toc">
        {t('mobi.tocLabel')}
      </label>
      <select
        id="dialog-mobi-export-toc"
        className="mfbe-encodingdialog-select"
        value={tocPlacement}
        onChange={(event) => setTocPlacement(event.target.value as MobiTocPlacement)}
        {...tip(t('tip.mobi.tocPlacement'))}
        data-testid="dialog-mobi-export-toc"
      >
        {TOC_VALUES.map((item) => (
          <option
            key={item.value}
            value={item.value}
            data-testid={`dialog-mobi-export-toc-${item.value}`}
          >
            {t(item.labelKey)}
          </option>
        ))}
      </select>

      <label className="mfbe-encodingdialog-zip" data-testid="dialog-mobi-export-zip">
        <input
          type="checkbox"
          checked={zip}
          onChange={(event) => setZip(event.target.checked)}
          data-testid="dialog-mobi-export-zip-box"
          {...tip(t('tip.mobi.zip'))}
        />
        {t('mobi.zipChoice')}
      </label>
    </Dialog>
  );
}
