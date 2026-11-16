/**
 * Feature 014 (D2, D3; tasks T029): the page size, asked in the editor's own window when the system
 * Save dialog could not carry the *Page size* list (it answered without `encoding`), as Save As asks
 * for the encoding (dialogs/EncodingDialog.tsx). The nine sizes in their two groups, each with its
 * dimensions; *Cancel* writes nothing. Static: the command asks before the export's part loads.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type { PdfPageSizeId } from '@/rpc/types';

import { PDF_PAGE_SIZE_GROUPS, PDF_PAGE_SIZES } from './pageSizes';
import { tip } from '@/app/tooltips';

const GROUPS = PDF_PAGE_SIZE_GROUPS;

export interface PageSizeDialogProps {
  defaultSize: PdfPageSizeId;
  /** The file chosen, shown as a hint. */
  path?: string;
  /** Feature 016 (D25): the *Save in ZIP archive* box, unticked every time, when the system's dialog lacked it. */
  zip?: boolean;
  onClose: (choice: { size: PdfPageSizeId; zip: boolean } | null) => void;
}

export function PageSizeDialog({
  defaultSize,
  path,
  zip: zipAtFirst = false,
  onClose,
}: PageSizeDialogProps) {
  const { t } = useTranslation();
  const [size, setSize] = useState<PdfPageSizeId>(defaultSize);
  const [zip, setZip] = useState(zipAtFirst);
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose({ size, zip }) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('cmd.file.exportPdf.tooltip')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-pdf-page-size-select"
      testId="dialog-pdf-page-size"
      className="mfbe-encodingdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      {path ? (
        <div className="mfbe-encodingdialog-path" data-testid="dialog-pdf-page-size-path">
          {path}
        </div>
      ) : null}
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-pdf-page-size-select">
        {t('pdf.pageSizeLabel')}
      </label>
      <select
        id="dialog-pdf-page-size-select"
        className="mfbe-encodingdialog-select"
        size={PDF_PAGE_SIZES.length + GROUPS.length}
        value={size}
        onChange={(event) => setSize(event.target.value as PdfPageSizeId)}
        onDoubleClick={() => onClose({ size, zip })}
        {...tip(t('tip.pdf.pageSize'))}
        data-testid="dialog-pdf-page-size-select"
      >
        {GROUPS.map((group) => (
          <optgroup key={group.key} label={t(`pdf.sizeGroups.${group.key}`)}>
            {group.ids.map((id) => (
              <option key={id} value={id} data-testid={`dialog-pdf-page-size-option-${id}`}>
                {t(`pdf.sizes.${id}`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <label className="mfbe-encodingdialog-zip" data-testid="dialog-pdf-page-size-zip">
        <input
          type="checkbox"
          checked={zip}
          onChange={(event) => setZip(event.target.checked)}
          data-testid="dialog-pdf-page-size-zip-box"
        />
        {t('pdf.zipChoice')}
      </label>
    </Dialog>
  );
}
