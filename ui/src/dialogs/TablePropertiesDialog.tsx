/**
 * The Table properties dialog of *Add → Table* (feature 006, FR-001, FR-002; data-model §11.1;
 * research R2.9, R6.10): *Rows* (the normal rows, 1–999; a header row comes on top) and
 * *Columns* (1–64) with their range hints, then *Header row* and *Header column*. A number is
 * valid only as a whole number after trimming (`/^\d+$/`) within its range; an invalid one gets
 * `aria-invalid`, a message below the check boxes in a polite live region named by its
 * `aria-describedby`, and makes OK unavailable. The focus starts on *Rows*. OK gives the four
 * values, Cancel null; one dialog serves the Body view, the description fields and the Source
 * view. Opened by `openTableDialog()` (`features/tables/dialog.ts`) with the values last
 * confirmed (`session.tableDialog`).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseAccelerator } from '@/i18n';

import { Dialog, type DialogButton } from './Dialog';

import './editing.css';

export interface TableProperties {
  rows: number;
  columns: number;
  headerRow: boolean;
  headerColumn: boolean;
}

export interface TablePropertiesDialogProps {
  initial: TableProperties;
  onClose: (result: TableProperties | null) => void;
}

/** The ranges of FR-001 (`MAX_TABLE_ROWS`, `MAX_TABLE_COLUMNS` of `editor/table/ops.ts`). */
const ROWS = { min: 1, max: 999 };
const COLUMNS = { min: 1, max: 64 };

/** The number a field holds when it is a whole number within `range`, else null. */
function wholeNumber(value: string, range: { min: number; max: number }): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number >= range.min && number <= range.max ? number : null;
}

export function TablePropertiesDialog({ initial, onClose }: TablePropertiesDialogProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(String(initial.rows));
  const [columns, setColumns] = useState(String(initial.columns));
  const [headerRow, setHeaderRow] = useState(initial.headerRow);
  const [headerColumn, setHeaderColumn] = useState(initial.headerColumn);
  const rowCount = wholeNumber(rows, ROWS);
  const columnCount = wholeNumber(columns, COLUMNS);
  const valid = rowCount !== null && columnCount !== null;
  const label = (key: string) => parseAccelerator(t(key)).text;

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !valid,
      onClick: () => {
        if (rowCount === null || columnCount === null) return;
        onClose({ rows: rowCount, columns: columnCount, headerRow, headerColumn });
      },
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  const numberField = (
    id: string,
    labelKey: string,
    value: string,
    setValue: (value: string) => void,
    range: { min: number; max: number },
    invalid: boolean,
  ) => (
    <>
      <label htmlFor={id}>{label(labelKey)}</label>
      <input
        id={id}
        className="mfbe-inputdialog-input mfbe-number-input"
        type="number"
        min={range.min}
        max={range.max}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        data-testid={id}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
      />
      <span className="mfbe-field-hint">{t('dialog.table.range', range)}</span>
    </>
  );

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
      <div className="mfbe-tabledialog-grid">
        {numberField(
          'dialog-table-rows',
          'dialog.table.rowCount',
          rows,
          setRows,
          ROWS,
          rowCount === null,
        )}
        {numberField(
          'dialog-table-columns',
          'dialog.table.columns',
          columns,
          setColumns,
          COLUMNS,
          columnCount === null,
        )}
      </div>
      <label className="mfbe-check-field" htmlFor="dialog-table-header">
        <input
          id="dialog-table-header"
          type="checkbox"
          checked={headerRow}
          onChange={(event) => setHeaderRow(event.target.checked)}
          data-testid="dialog-table-header"
        />
        <span>{label('dialog.table.headerRow')}</span>
      </label>
      <label className="mfbe-check-field" htmlFor="dialog-table-header-column">
        <input
          id="dialog-table-header-column"
          type="checkbox"
          checked={headerColumn}
          onChange={(event) => setHeaderColumn(event.target.checked)}
          data-testid="dialog-table-header-column"
        />
        <span>{label('dialog.table.headerColumn')}</span>
      </label>
      <div
        className="mfbe-tabledialog-messages"
        aria-live="polite"
        data-testid="dialog-table-messages"
      >
        {rowCount === null ? (
          <div
            className="mfbe-inputdialog-error"
            id="dialog-table-rows-error"
            data-testid="dialog-table-rows-error"
          >
            {t('dialog.table.rowsInvalid', ROWS)}
          </div>
        ) : null}
        {columnCount === null ? (
          <div
            className="mfbe-inputdialog-error"
            id="dialog-table-columns-error"
            data-testid="dialog-table-columns-error"
          >
            {t('dialog.table.columnsInvalid', COLUMNS)}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
