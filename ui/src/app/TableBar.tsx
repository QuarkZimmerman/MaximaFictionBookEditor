/**
 * Table bar (T062/T063, FR-023/FR-036): attributes of the table around the caret - Table ID,
 * Table Style, cell ID and style, colspan, rowspan, tr align, th/td align and valign - bound
 * two-way to the Body selection as the original's two table toolbars. Fields are disabled
 * outside a table and while a script runs. Text fields apply on Enter / blur, the alignment
 * lists immediately.
 */

import { useTranslation } from 'react-i18next';

import { ALIGN_VALUES, VALIGN_VALUES, parseSpan, setNodeAttr } from '@/editor/commands/table';
import type { NodeRef } from '@/editor/plugins/selectionPath';
import { isRunLocked, useAppState } from '@/model/store';

import { useBodySelectionContext } from '@/views/body/useBodySelection';

import { BarTextField } from './LinksBar';
import { useAppServices } from './services';

interface BarSelectProps {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
}

function BarSelect({ id, label, value, options, disabled, onChange }: BarSelectProps) {
  return (
    <label className="mfbe-bar-field" htmlFor={`${id}-input`}>
      <span className="mfbe-bar-label">{label}</span>
      <select
        id={`${id}-input`}
        className="mfbe-bar-input mfbe-bar-select"
        value={disabled ? '' : value}
        disabled={disabled}
        data-testid={id}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option || '-'} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TableBar() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const activeView = useAppState((s) => s.activeView, store);
  const runLocked = useAppState(isRunLocked, store);
  const { controller, context } = useBodySelectionContext();
  const inTable = activeView === 'body' && !runLocked && !!controller && !!context?.table;
  const table = context?.table ?? null;
  const row = context?.row ?? null;
  const cell = context?.cell ?? null;

  const attr = (ref: NodeRef | null, name: string): string => {
    const value = ref?.node.attrs[name];
    return value === null || value === undefined ? '' : String(value);
  };

  const setAttr = (pos: number | undefined, name: string, value: string | number | null) => {
    if (!controller || pos === undefined) return;
    controller.execute(setNodeAttr(pos, name, typeof value === 'string' ? value.trim() : value));
  };

  return (
    <div
      className="mfbe-toolbar mfbe-bar mfbe-tablebar"
      role="toolbar"
      aria-label={t('toolbar.table')}
      data-testid="tablebar"
      data-in-table={inTable ? 'true' : 'false'}
    >
      <BarTextField
        id="table-bar-table-id"
        label={t('tableBar.tableId')}
        value={attr(table, 'id')}
        disabled={!inTable}
        focusKey="tableId"
        onCommit={(value) => setAttr(table?.pos, 'id', value)}
      />
      <BarTextField
        id="table-bar-table-style"
        label={t('tableBar.tableStyle')}
        value={attr(table, 'style')}
        disabled={!inTable}
        width={100}
        onCommit={(value) => setAttr(table?.pos, 'style', value)}
      />
      <BarTextField
        id="table-bar-cell-id"
        label={t('linksBar.id')}
        value={attr(cell, 'id')}
        disabled={!inTable || !cell}
        onCommit={(value) => setAttr(cell?.pos, 'id', value)}
      />
      <BarTextField
        id="table-bar-style"
        label={t('tableBar.style')}
        value={attr(cell, 'style')}
        disabled={!inTable || !cell}
        width={90}
        onCommit={(value) => setAttr(cell?.pos, 'style', value)}
      />
      <BarTextField
        id="table-bar-colspan"
        label={t('tableBar.colspan')}
        value={attr(cell, 'colspan')}
        disabled={!inTable || !cell}
        width={40}
        onCommit={(value) => setAttr(cell?.pos, 'colspan', parseSpan(value))}
      />
      <BarTextField
        id="table-bar-rowspan"
        label={t('tableBar.rowspan')}
        value={attr(cell, 'rowspan')}
        disabled={!inTable || !cell}
        width={40}
        onCommit={(value) => setAttr(cell?.pos, 'rowspan', parseSpan(value))}
      />
      <BarSelect
        id="table-bar-tr-align"
        label={t('tableBar.trAlign')}
        value={attr(row, 'align')}
        options={ALIGN_VALUES}
        disabled={!inTable || !row}
        onChange={(value) => setAttr(row?.pos, 'align', value)}
      />
      <BarSelect
        id="table-bar-td-align"
        label={t('tableBar.tdAlign')}
        value={attr(cell, 'align')}
        options={ALIGN_VALUES}
        disabled={!inTable || !cell}
        onChange={(value) => setAttr(cell?.pos, 'align', value)}
      />
      <BarSelect
        id="table-bar-td-valign"
        label={t('tableBar.tdValign')}
        value={attr(cell, 'valign')}
        options={VALIGN_VALUES}
        disabled={!inTable || !cell}
        onChange={(value) => setAttr(cell?.pos, 'valign', value)}
      />
    </div>
  );
}
