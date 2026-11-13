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

import { PDF_PAGE_SIZES } from './pageSizes';

const GROUPS: { key: 'iso' | 'american'; ids: PdfPageSizeId[] }[] = [
  { key: 'iso', ids: ['a4', 'b5', 'a5', 'b6', 'a6'] },
  { key: 'american', ids: ['legal', 'letter', 'executive', 'statement'] },
];

export interface PageSizeDialogProps {
  defaultSize: PdfPageSizeId;
  /** The file chosen, shown as a hint. */
  path?: string;
  onClose: (size: PdfPageSizeId | null) => void;
}

export function PageSizeDialog({ defaultSize, path, onClose }: PageSizeDialogProps) {
  const { t } = useTranslation();
  const [size, setSize] = useState<PdfPageSizeId>(defaultSize);
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose(size) },
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
        onDoubleClick={() => onClose(size)}
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
    </Dialog>
  );
}
