/**
 * Feature 020 (T026, contracts/rpc-api.md §3): lightweight fallback PDF import options modal shown
 * only when the native `dialog.openFile` omits `checks` (e.g., headless fallback or platform dialog
 * without custom checkboxes). Mirrors EncodingDialog / Dialog patterns.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';

export interface PdfImportOptionsAnswer {
  useOcr: boolean;
}

export interface PdfImportOptionsDialogProps {
  initialUseOcr: boolean;
  onClose: (answer: PdfImportOptionsAnswer | null) => void;
}

export function PdfImportOptionsDialog({ initialUseOcr, onClose }: PdfImportOptionsDialogProps) {
  const { t } = useTranslation();
  const [useOcr, setUseOcr] = useState(initialUseOcr);

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('pdfImport.optionsDialog.ok'),
      onClick: () => onClose({ useOcr }),
    },
    {
      id: 'cancel',
      label: t('pdfImport.optionsDialog.cancel'),
      onClick: () => onClose(null),
    },
  ];

  return (
    <Dialog
      title={t('pdfImport.optionsDialog.title')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#pdf-import-options-use-ocr"
      testId="dialog-pdf-import-options"
      closeLabel={t('dialog.buttons.close')}
    >
      <p className="mfbe-inputdialog-prompt">{t('pdfImport.optionsDialog.description')}</p>
      <label className="mfbe-checkbox-row" htmlFor="pdf-import-options-use-ocr">
        <input
          id="pdf-import-options-use-ocr"
          type="checkbox"
          checked={useOcr}
          onChange={(event) => setUseOcr(event.target.checked)}
          data-testid="pdf-import-options-use-ocr"
          {...tip(t('imports.settings.pdf.useOcrHint'))}
        />
        {t('pdfImport.useOcrLabel')}
      </label>
    </Dialog>
  );
}
