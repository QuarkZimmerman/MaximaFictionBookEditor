/**
 * The Table properties dialog of *Add → Table* (feature 006, T053; FR-001, FR-002; US1 sc.8;
 * data-model §11.1; research R2.9, R6.10; resource-formats.md §9): *Rows*, *Columns*, *Header
 * row* and *Header column* with their labels and range hints, the values given, the focus on
 * *Rows*; a value that is not a whole number in its range gives its message in the live region,
 * `aria-invalid`, `aria-describedby` and no OK; OK gives the four values, Cancel null.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance, type i18n as I18n } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { DialogHost, DialogService, createDialogs } from '@/dialogs';
import { TablePropertiesDialog, type TableProperties } from '@/dialogs/TablePropertiesDialog';
import { initI18n, parseAccelerator } from '@/i18n';

let instance: I18n;

beforeAll(async () => {
  instance = createInstance();
  await initI18n({ instance, language: 'en' });
});

/** Opens the dialog with `initial`; resolves the dialog's result through `result`. */
async function openDialog(initial: TableProperties) {
  const service = new DialogService();
  const dialogs = createDialogs(service);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  );
  render(<DialogHost service={service} />, { wrapper });
  let result!: Promise<TableProperties | null>;
  await act(async () => {
    result = dialogs.openCustom<TableProperties | null>((close) => (
      <TablePropertiesDialog initial={initial} onClose={close} />
    ));
  });
  return { result, user: userEvent.setup() };
}

const DEFAULTS: TableProperties = { rows: 2, columns: 2, headerRow: false, headerColumn: false };

const t = (key: string, params?: Record<string, unknown>) => instance.t(key, params ?? {});
const label = (key: string) => parseAccelerator(t(key)).text;

const rows = () => screen.getByTestId('dialog-table-rows') as HTMLInputElement;
const columns = () => screen.getByTestId('dialog-table-columns') as HTMLInputElement;
const ok = () => screen.getByTestId('dialog-table-button-ok');

function setValue(input: HTMLInputElement, value: string): void {
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
}

/** The input's message: its id named by `aria-describedby`, inside the live region. */
function expectInvalid(input: HTMLInputElement, testId: string, text: string): void {
  const message = screen.getByTestId(testId);
  expect(message).toHaveTextContent(text);
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input.getAttribute('aria-describedby')).toBe(message.id);
  expect(message.id).not.toBe('');
  const region = screen.getByTestId('dialog-table-messages');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toContainElement(message);
}

function expectValid(input: HTMLInputElement, testId: string): void {
  expect(screen.queryByTestId(testId)).toBeNull();
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(input).not.toHaveAttribute('aria-describedby');
}

describe('TablePropertiesDialog', () => {
  it('shows Rows, Columns, Header row and Header column with their labels, hints and given values; the focus on Rows', async () => {
    await openDialog({ rows: 4, columns: 3, headerRow: true, headerColumn: false });
    const dialog = screen.getByTestId('dialog-table');
    expect(screen.getByTestId('dialog-table-title')).toHaveTextContent(t('dialog.table.caption'));
    expect(screen.getByLabelText(label('dialog.table.rowCount'))).toBe(rows());
    expect(screen.getByLabelText(label('dialog.table.columns'))).toBe(columns());
    expect(screen.getByLabelText(label('dialog.table.headerRow'))).toBe(
      screen.getByTestId('dialog-table-header'),
    );
    expect(screen.getByLabelText(label('dialog.table.headerColumn'))).toBe(
      screen.getByTestId('dialog-table-header-column'),
    );
    for (const key of ['rowCount', 'columns', 'headerRow', 'headerColumn']) {
      expect(dialog.textContent).not.toContain('&');
      expect(dialog).toHaveTextContent(label(`dialog.table.${key}`));
    }
    expect(dialog).toHaveTextContent(t('dialog.table.range', { min: 1, max: 999 }));
    expect(dialog).toHaveTextContent(t('dialog.table.range', { min: 1, max: 64 }));
    expect(rows()).toHaveValue(4);
    expect(columns()).toHaveValue(3);
    expect(rows()).toHaveAttribute('min', '1');
    expect(rows()).toHaveAttribute('max', '999');
    expect(columns()).toHaveAttribute('min', '1');
    expect(columns()).toHaveAttribute('max', '64');
    expect(screen.getByTestId('dialog-table-header')).toBeChecked();
    expect(screen.getByTestId('dialog-table-header-column')).not.toBeChecked();
    expect(document.activeElement).toBe(rows());
    expect(screen.queryByTestId('dialog-table-rows-error')).toBeNull();
    expect(screen.queryByTestId('dialog-table-columns-error')).toBeNull();
    expect(ok()).toBeEnabled();
  });

  it('refuses rows that are not a whole number from 1 to 999 and columns outside 1 to 64, both at once', async () => {
    await openDialog(DEFAULTS);
    const rowsText = t('dialog.table.rowsInvalid', { min: 1, max: 999 });
    const columnsText = t('dialog.table.columnsInvalid', { min: 1, max: 64 });
    for (const value of ['0', '1000', '2.5', '1e3', 'abc', '']) {
      setValue(rows(), value);
      expectInvalid(rows(), 'dialog-table-rows-error', rowsText);
      expect(ok(), `rows "${value}"`).toBeDisabled();
      setValue(rows(), '999');
      expectValid(rows(), 'dialog-table-rows-error');
      expect(ok()).toBeEnabled();
    }
    for (const value of ['0', '65']) {
      setValue(columns(), value);
      expectInvalid(columns(), 'dialog-table-columns-error', columnsText);
      expect(ok(), `columns "${value}"`).toBeDisabled();
      setValue(columns(), '64');
      expectValid(columns(), 'dialog-table-columns-error');
    }
    // Both wrong: both messages.
    setValue(rows(), '1000');
    setValue(columns(), '0');
    expectInvalid(rows(), 'dialog-table-rows-error', rowsText);
    expectInvalid(columns(), 'dialog-table-columns-error', columnsText);
    expect(ok()).toBeDisabled();
    // Valid again: no message.
    setValue(rows(), '1');
    setValue(columns(), '1');
    expectValid(rows(), 'dialog-table-rows-error');
    expectValid(columns(), 'dialog-table-columns-error');
    expect(ok()).toBeEnabled();
  });

  it('gives the four values as numbers and booleans on OK', async () => {
    const { result, user } = await openDialog(DEFAULTS);
    setValue(rows(), '4');
    setValue(columns(), '3');
    await user.click(screen.getByTestId('dialog-table-header'));
    await user.click(screen.getByTestId('dialog-table-header-column'));
    await user.click(ok());
    await expect(result).resolves.toEqual({
      rows: 4,
      columns: 3,
      headerRow: true,
      headerColumn: true,
    });
  });

  it('gives null on Cancel', async () => {
    const { result, user } = await openDialog(DEFAULTS);
    setValue(rows(), '9');
    await user.click(screen.getByTestId('dialog-table-button-cancel'));
    await expect(result).resolves.toBeNull();
  });
});
