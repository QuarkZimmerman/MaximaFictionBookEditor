/**
 * Script dialog components (T104): the declarative form renderer behind `mfbe.ui.form(spec)`
 * (text, number, checkbox, select, radio, list, static and - feature 007 - regexp fields; OK
 * returns the values,
 * Cancel / Escape returns null), the message box with script-defined buttons behind
 * `mfbe.ui.message` and the input prompt behind `mfbe.ui.prompt`. They open through the
 * application's modal dialog stack: see `dialogs.ts` (`showScriptForm`, `showScriptMessage`,
 * `showScriptPrompt`); the pure field model lives in `formModel.ts`. A dialog still open when
 * its run ends (Cancel, a failure) closes itself.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { InputDialog } from '@/dialogs/InputDialog';
import type { InputDialogOptions, InputDialogResult } from '@/dialogs/types';

import { initialValues, invalidField, normaliseFields, regexpProblem } from './formModel';
import type { ButtonSpec, FormField, FormSpec, FormValue, FormValues, RunEnd } from './types';

import './scripting.css';

/** Calls `close` when the run ends while the dialog is open. */
function useCloseWhenRunEnds(runEnd: RunEnd | undefined, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!runEnd) return undefined;
    if (runEnd.ended) {
      closeRef.current();
      return undefined;
    }
    return runEnd.subscribe(() => {
      if (runEnd.ended) closeRef.current();
    });
  }, [runEnd]);
}

/* ------------------------------------------------------------------------ */
/* Form                                                                     */
/* ------------------------------------------------------------------------ */

export interface ScriptFormDialogProps {
  spec: FormSpec;
  onClose: (values: FormValues | null) => void;
  testId?: string;
  runEnd?: RunEnd;
}

export function ScriptFormDialog({
  spec,
  onClose,
  testId = 'dialog-script-form',
  runEnd,
}: ScriptFormDialogProps) {
  const { t } = useTranslation();
  useCloseWhenRunEnds(runEnd, () => onClose(null));
  const fields = normaliseFields(spec.fields);
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const idPrefix = useId();

  const set = (id: string, value: FormValue) => setValues((v) => ({ ...v, [id]: value }));

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: spec.okLabel ?? t('dialog.buttons.ok'),
      disabled: invalidField(fields, values) !== null,
      onClick: () => {
        if (invalidField(fields, values) === null) onClose(values);
      },
    },
    {
      id: 'cancel',
      label: spec.cancelLabel ?? t('dialog.buttons.cancel'),
      onClick: () => onClose(null),
    },
  ];

  const firstInput = fields.find((f) => f.kind !== 'static');

  return (
    <Dialog
      title={spec.title}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus={firstInput ? `[data-field-id="${firstInput.id}"]` : undefined}
      testId={testId}
      className="mfbe-script-form"
      closeLabel={t('dialog.buttons.close')}
    >
      <div
        className="mfbe-script-form-fields"
        style={spec.width ? { width: `${Math.max(200, Math.min(spec.width, 1200))}px` } : undefined}
      >
        {fields.map((field) => (
          <FormFieldView
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={(value) => set(field.id, value)}
            htmlId={`${idPrefix}-${field.id}`}
            testId={`${testId}-field-${field.id}`}
          />
        ))}
      </div>
    </Dialog>
  );
}

interface FormFieldViewProps {
  field: FormField;
  value: FormValue | undefined;
  onChange: (value: FormValue) => void;
  htmlId: string;
  testId: string;
}

function FormFieldView({ field, value, onChange, htmlId, testId }: FormFieldViewProps) {
  switch (field.kind) {
    case 'regexp':
      return (
        <RegexpFieldView
          field={field}
          value={String(value ?? '')}
          onChange={onChange}
          htmlId={htmlId}
          testId={testId}
        />
      );
    case 'static':
      return (
        <div className="mfbe-script-form-static" data-testid={testId}>
          {field.text}
        </div>
      );
    case 'text':
      return (
        <div className="mfbe-script-form-row">
          <label htmlFor={htmlId} className="mfbe-script-form-label">
            {field.label}
          </label>
          {field.multiline ? (
            <textarea
              id={htmlId}
              className="mfbe-script-form-input mfbe-script-form-textarea"
              value={String(value ?? '')}
              placeholder={field.placeholder}
              rows={4}
              data-field-id={field.id}
              data-testid={testId}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <input
              id={htmlId}
              type="text"
              className="mfbe-script-form-input"
              value={String(value ?? '')}
              placeholder={field.placeholder}
              data-field-id={field.id}
              data-testid={testId}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      );
    case 'number':
      return (
        <div className="mfbe-script-form-row">
          <label htmlFor={htmlId} className="mfbe-script-form-label">
            {field.label}
          </label>
          <input
            id={htmlId}
            type="number"
            className="mfbe-script-form-input mfbe-script-form-number"
            value={typeof value === 'number' ? value : Number(value ?? 0)}
            min={field.min}
            max={field.max}
            data-field-id={field.id}
            data-testid={testId}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange(Number.isFinite(n) ? n : (field.min ?? 0));
            }}
          />
        </div>
      );
    case 'checkbox':
      return (
        <div className="mfbe-script-form-row mfbe-script-form-row-check">
          <label className="mfbe-script-form-check">
            <input
              id={htmlId}
              type="checkbox"
              checked={!!value}
              data-field-id={field.id}
              data-testid={testId}
              onChange={(e) => onChange(e.target.checked)}
            />
            {field.label}
          </label>
        </div>
      );
    case 'select':
      return (
        <div className="mfbe-script-form-row">
          <label htmlFor={htmlId} className="mfbe-script-form-label">
            {field.label}
          </label>
          <select
            id={htmlId}
            className="mfbe-script-form-input"
            value={String(value ?? '')}
            data-field-id={field.id}
            data-testid={testId}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    case 'radio':
      return (
        <fieldset className="mfbe-script-form-row mfbe-script-form-group" data-testid={testId}>
          <legend className="mfbe-script-form-label">{field.label}</legend>
          {field.options.map((option, index) => (
            <label key={option.value} className="mfbe-script-form-check">
              <input
                type="radio"
                name={htmlId}
                value={option.value}
                checked={value === option.value}
                data-field-id={index === 0 ? field.id : undefined}
                data-testid={`${testId}-${option.value}`}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    case 'list': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="mfbe-script-form-row">
          <label htmlFor={htmlId} className="mfbe-script-form-label">
            {field.label}
          </label>
          <select
            id={htmlId}
            multiple={field.multiple}
            size={Math.min(Math.max(field.options.length, 3), 8)}
            className="mfbe-script-form-input mfbe-script-form-list"
            value={field.multiple ? selected : (selected[0] ?? '')}
            data-field-id={field.id}
            data-testid={testId}
            onChange={(e) =>
              onChange(Array.from(e.target.selectedOptions, (option) => option.value))
            }
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
  }
}

/** A pattern with named presets and a validity check (contracts/script-api.md §4, feature 007). */
function RegexpFieldView({
  field,
  value,
  onChange,
  htmlId,
  testId,
}: {
  field: Extract<FormField, { kind: 'regexp' }>;
  value: string;
  onChange: (value: FormValue) => void;
  htmlId: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const presets = Array.isArray(field.presets) ? field.presets : [];
  const problem = regexpProblem(value, field.flags);
  const preset = presets.some((p) => p.value === value) ? value : '';
  const errorId = `${htmlId}-error`;
  return (
    <div className="mfbe-script-form-row mfbe-script-form-regexp">
      {presets.length > 0 && (
        <>
          <label htmlFor={`${htmlId}-presets`} className="mfbe-script-form-label">
            {field.presetsLabel ?? t('scripting.form.regexpPresets')}
          </label>
          <select
            id={`${htmlId}-presets`}
            className="mfbe-script-form-input"
            value={preset}
            data-testid={`${testId}-presets`}
            onChange={(e) => {
              if (e.target.value !== '') onChange(e.target.value);
            }}
          >
            <option value="" />
            {presets.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={htmlId} className="mfbe-script-form-label">
        {field.label}
      </label>
      <input
        id={htmlId}
        type="text"
        spellCheck={false}
        className="mfbe-script-form-input mfbe-script-form-pattern"
        value={value}
        aria-invalid={problem !== null}
        aria-describedby={problem !== null ? errorId : undefined}
        data-field-id={field.id}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
      {problem !== null && (
        <div
          id={errorId}
          className="mfbe-script-form-error"
          role="alert"
          data-testid={`${testId}-error`}
        >
          {t('scripting.form.regexpInvalid', { message: problem })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Message box with script-defined buttons                                   */
/* ------------------------------------------------------------------------ */

export interface ScriptMessageOptions {
  text: string;
  caption: string;
  buttons: ButtonSpec[];
  icon?: 'info' | 'warning' | 'error' | 'question';
}

const ICON_GLYPHS = { info: 'i', question: '?', warning: '!', error: '\u00D7' } as const;

export function ScriptMessageDialog({
  options,
  onClose,
  runEnd,
}: {
  options: ScriptMessageOptions;
  onClose: (buttonId: string) => void;
  runEnd?: RunEnd;
}) {
  const { t } = useTranslation();
  useCloseWhenRunEnds(runEnd, () => onClose(''));
  const testId = 'dialog-script-message';
  const buttons: DialogButton[] = options.buttons.map((b) => ({
    id: b.id,
    label: b.label || b.id,
    onClick: () => onClose(b.id),
  }));
  const defaultId = options.buttons.find((b) => b.default)?.id ?? options.buttons[0]?.id;
  const cancelId = options.buttons.find((b) => b.cancel)?.id;
  return (
    <Dialog
      title={options.caption}
      buttons={buttons}
      defaultButtonId={defaultId}
      cancelButtonId={cancelId}
      testId={testId}
      className="mfbe-messagebox"
      closeLabel={t('dialog.buttons.close')}
      icon={
        options.icon ? (
          <span
            className={`mfbe-messagebox-glyph mfbe-messagebox-glyph-${options.icon}`}
            aria-hidden="true"
          >
            {ICON_GLYPHS[options.icon]}
          </span>
        ) : undefined
      }
    >
      <div className="mfbe-messagebox-text" data-testid={`${testId}-text`}>
        {options.text}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Input prompt                                                              */
/* ------------------------------------------------------------------------ */

export function ScriptPromptDialog({
  options,
  onClose,
  runEnd,
}: {
  options: InputDialogOptions;
  onClose: (result: InputDialogResult) => void;
  runEnd?: RunEnd;
}) {
  useCloseWhenRunEnds(runEnd, () => onClose({ button: 'cancel', value: '' }));
  return <InputDialog options={options} onClose={onClose} />;
}
