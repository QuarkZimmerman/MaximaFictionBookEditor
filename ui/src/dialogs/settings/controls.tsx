/**
 * Small form controls shared by the Settings pages: a group box (the original dialogs'
 * GROUPBOX), a labelled row, a checkbox field and a number field with range feedback.
 */

import { useId, type ReactNode } from 'react';

import { parseAccelerator } from '@/i18n';

export function GroupBox({
  title,
  children,
  testId,
  className,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <fieldset
      className={`mfbe-settings-group${className ? ` ${className}` : ''}`}
      data-testid={testId}
    >
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function FieldRow({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mfbe-settings-row${className ? ` ${className}` : ''}`}>
      <label className="mfbe-settings-label" htmlFor={htmlFor}>
        {parseAccelerator(label).text}
      </label>
      {children}
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <label className="mfbe-check-field mfbe-settings-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
      />
      <span>{parseAccelerator(label).text}</span>
    </label>
  );
}

export function NumberField({
  id,
  value,
  min,
  max,
  onChange,
  testId,
  disabled,
  allowEmpty,
}: {
  id?: string;
  /** Current text of the field (kept as typed so an invalid value can be reported). */
  value: string;
  min: number;
  max: number;
  onChange: (text: string) => void;
  testId?: string;
  disabled?: boolean;
  /** An empty field means "default" instead of an error. */
  allowEmpty?: boolean;
}) {
  const number = Number(value);
  const invalid =
    allowEmpty && value.trim() === ''
      ? false
      : !/^\d+$/.test(value.trim()) || number < min || number > max;
  return (
    <input
      id={id}
      className={`mfbe-inputdialog-input mfbe-number-input${invalid ? ' mfbe-settings-invalid' : ''}`}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={value}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      data-testid={testId}
    />
  );
}

/** Text input with a `<datalist>` of suggestions (font family pickers). */
export function SuggestInput({
  id,
  value,
  suggestions,
  placeholder,
  onChange,
  testId,
  listId,
}: {
  id?: string;
  value: string;
  suggestions: readonly string[];
  placeholder?: string;
  onChange: (value: string) => void;
  testId?: string;
  listId: string;
}) {
  return (
    <>
      <input
        id={id}
        className="mfbe-inputdialog-input"
        type="text"
        value={value}
        list={listId}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </>
  );
}

/** Colour picker plus the `#rrggbb` text so the value can be typed and tested. */
export function ColorField({
  id,
  value,
  onChange,
  testId,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <span className="mfbe-settings-color">
      <input
        type="color"
        value={valid ? value.toLowerCase() : '#000000'}
        onChange={(event) => onChange(event.target.value)}
        aria-label={value}
        data-testid={testId ? `${testId}-picker` : undefined}
      />
      <input
        id={id}
        className={`mfbe-inputdialog-input mfbe-settings-color-text${valid ? '' : ' mfbe-settings-invalid'}`}
        type="text"
        value={value}
        maxLength={7}
        spellCheck={false}
        aria-invalid={!valid || undefined}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
    </span>
  );
}
