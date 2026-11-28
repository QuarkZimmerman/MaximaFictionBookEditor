/**
 * Feature 023 (T020; contracts/settings.md): fallback modal shown when the platform Save dialog
 * could not carry the Page size list or Save in ZIP archive checkbox. Static: stays in the main
 * bundle and never imports `./export/`, `./import/`, or `./shared/`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { PDF_PAGE_SIZE_GROUPS, PDF_PAGE_SIZES } from '@/features/pdf/pageSizes';
import type { PdfPageSizeId } from '@/rpc/types';

export interface DocxExportOptionsChoice {
  pageSize: PdfPageSizeId;
  zip: boolean;
}

export interface DocxExportOptionsProps extends DocxExportOptionsChoice {
  path?: string;
  onClose: (choice: DocxExportOptionsChoice | null) => void;
}

const GROUPS = PDF_PAGE_SIZE_GROUPS;

export function DocxExportOptions({ path, onClose, ...initial }: DocxExportOptionsProps) {
  const { t } = useTranslation();
  const [pageSize, setPageSize] = useState<PdfPageSizeId>(initial.pageSize);
  const [zip, setZip] = useState<boolean>(initial.zip);

  const choice = (): DocxExportOptionsChoice => ({ pageSize, zip });
  const buttons: DialogButton[] = [
    { id: 'ok', label: t('dialog.buttons.ok'), onClick: () => onClose(choice()) },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  return (
    <Dialog
      title={t('docx.optionsCaption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-docx-export-page-size"
      testId="dialog-docx-export-options"
      className="mfbe-encodingdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      {path ? (
        <div className="mfbe-encodingdialog-path" data-testid="dialog-docx-export-path">
          {path}
        </div>
      ) : null}
      <label className="mfbe-inputdialog-prompt" htmlFor="dialog-docx-export-page-size">
        {t('docx.pageSizeLabel')}
      </label>
      <select
        id="dialog-docx-export-page-size"
        className="mfbe-encodingdialog-select"
        size={PDF_PAGE_SIZES.length + GROUPS.length}
        value={pageSize}
        onChange={(event) => setPageSize(event.target.value as PdfPageSizeId)}
        onDoubleClick={() => onClose(choice())}
        {...tip(t('tip.settings.docx.pageSize'))}
        data-testid="dialog-docx-export-page-size"
      >
        {GROUPS.map((group) => (
          <optgroup key={group.key} label={t(`pdf.sizeGroups.${group.key}`)}>
            {group.ids.map((id) => (
              <option key={id} value={id} data-testid={`dialog-docx-export-size-${id}`}>
                {t(`pdf.sizes.${id}`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <label className="mfbe-encodingdialog-zip" data-testid="dialog-docx-export-zip">
        <input
          type="checkbox"
          checked={zip}
          onChange={(event) => setZip(event.target.checked)}
          data-testid="dialog-docx-export-zip-box"
          {...tip(t('tip.settings.docx.zip'))}
        />
        {t('docx.zipChoice')}
      </label>
    </Dialog>
  );
}
