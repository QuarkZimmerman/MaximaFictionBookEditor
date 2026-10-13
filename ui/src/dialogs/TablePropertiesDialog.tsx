/**
 * Table properties (T063), modelled on the original `IDD_TABLE`: "Add table header
 * <tr><th></th></tr>" checkbox and "Number of table cells <tr><td></td></tr>:" spin field,
 * OK / Cancel. Opened by `showTablePropertiesDialog()` (features/editing/bodyCommands.ts).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from './Dialog';

import './editing.css';

export interface TableProperties {
  rows: number;
  header: boolean;
}

export interface TablePropertiesDialogProps {
  initial?: Partial<TableProperties>;
  onClose: (result: TableProperties | null) => void;
}

const MAX_TABLE_ROWS = 999;

export function TablePropertiesDialog({ initial, onClose }: TablePropertiesDialogProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(String(initial?.rows ?? 1));
  const [header, setHeader] = useState(initial?.header ?? false);
  const parsed = Number.parseInt(rows, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_TABLE_ROWS;

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !valid,
      onClick: () => onClose({ rows: parsed, header }),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  return (
    <Dialog
      title={t('dialog.table.caption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus="#dialog-table-rows"
      testId="dialog-table"
      className="mfbe-tabledialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <label className="mfbe-check-field" htmlFor="dialog-table-header">
        <input
          id="dialog-table-header"
          type="checkbox"
          checked={header}
          onChange={(event) => setHeader(event.target.checked)}
          data-testid="dialog-table-header"
        />
        <span>{t('dialog.table.addHeader')}</span>
      </label>
      <label className="mfbe-field-row" htmlFor="dialog-table-rows">
        <span>{t('dialog.table.rows')}</span>
        <input
          id="dialog-table-rows"
          className="mfbe-inputdialog-input mfbe-number-input"
          type="number"
          min={1}
          max={MAX_TABLE_ROWS}
          value={rows}
          onChange={(event) => setRows(event.target.value)}
          data-testid="dialog-table-rows"
          aria-invalid={valid ? undefined : true}
        />
      </label>
    </Dialog>
  );
}
