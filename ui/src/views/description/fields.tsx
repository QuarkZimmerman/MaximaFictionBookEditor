/**
 * Building blocks of the Description forms: `TextField` bound to a form path (registers its
 * input with the controller for Find / Replace and caret restore), section frames, inline
 * rows, list row chrome (remove / add buttons as in the original `fb2.xsl` rows) and the
 * required-field marker.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { FormInput } from './binding';
import { useDescriptionForm, useFieldValue } from './formContext';
import type { FieldKey } from './model';

/* ------------------------------------------------------------------------ */
/* Text field                                                               */
/* ------------------------------------------------------------------------ */

export interface TextFieldProps {
  fieldKey: FieldKey;
  testId: string;
  /** Label shown before the input (omit for unlabeled list cells). */
  label?: string;
  required?: boolean;
  /** Marks the field as invalid (outline + tooltip) with the given message. */
  invalid?: string | null;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  rows?: number;
  /** Layout hint: `short` (numbers, years), `middle`, `wide`. */
  size?: 'short' | 'middle' | 'wide';
  maxLength?: number;
  readOnly?: boolean;
  title?: string;
  inputRef?: RefObject<FormInput | null>;
}

export function TextField({
  fieldKey,
  testId,
  label,
  required,
  invalid,
  placeholder,
  className,
  multiline,
  rows,
  size,
  maxLength,
  readOnly,
  title,
  inputRef,
}: TextFieldProps) {
  const { controller } = useDescriptionForm();
  const value = useFieldValue(fieldKey);
  const ref = useRef<FormInput | null>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    return controller.registerInput(fieldKey, input);
  }, [controller, fieldKey]);

  const setRef = (element: FormInput | null) => {
    ref.current = element;
    if (inputRef) inputRef.current = element;
  };
  const classes = [
    'mfbe-desc-input',
    size ? `mfbe-desc-input-${size}` : '',
    invalid ? 'mfbe-desc-input-invalid' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const shared = {
    className: classes,
    value,
    placeholder,
    maxLength,
    readOnly,
    title: invalid ?? title,
    'aria-invalid': invalid ? true : undefined,
    'aria-required': required || undefined,
    'data-testid': testId,
    'data-field': fieldKey,
    onChange: (event: React.ChangeEvent<FormInput>) =>
      controller.setField(fieldKey, event.target.value),
    onBlur: () => controller.closeEntry(),
  };
  const input = multiline ? (
    <textarea ref={setRef} rows={rows ?? 4} {...shared} />
  ) : (
    <input ref={setRef} type="text" {...shared} />
  );
  if (!label) return input;
  return (
    <label className="mfbe-desc-field" data-testid={`${testId}-row`}>
      <span className="mfbe-desc-label">
        {label}
        {required ? <RequiredMark missing={value.trim() === ''} /> : null}
      </span>
      {input}
    </label>
  );
}

/** The asterisk of a required field with an explanatory tooltip. */
export function RequiredMark({ missing = true }: { missing?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`mfbe-desc-required${missing ? ' mfbe-desc-required-missing' : ''}`}
      title={t('descriptionForm.required')}
      aria-label={t('descriptionForm.required')}
      data-testid="description-required-mark"
    >
      *
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Frames                                                                   */
/* ------------------------------------------------------------------------ */

export function Section({
  id,
  title,
  children,
  actions,
  note,
}: {
  id: string;
  title: string;
  children: ReactNode;
  /** Controls rendered in the heading row (toggle, add...). */
  actions?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="mfbe-desc-group" data-testid={id}>
      <div className="mfbe-desc-heading-row">
        <h2 className="mfbe-desc-heading">{title}</h2>
        {actions ? <div className="mfbe-desc-heading-actions">{actions}</div> : null}
      </div>
      {note ? <div className="mfbe-desc-note">{note}</div> : null}
      {children}
    </section>
  );
}

export function SubSection({
  id,
  title,
  required,
  missing,
  children,
  actions,
}: {
  id: string;
  title: string;
  required?: boolean;
  missing?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <fieldset className="mfbe-desc-sub" data-testid={id}>
      <legend className="mfbe-desc-legend">
        {title}
        {required ? <RequiredMark missing={missing ?? false} /> : null}
      </legend>
      {children}
      {actions ? <div className="mfbe-desc-sub-actions">{actions}</div> : null}
    </fieldset>
  );
}

/** Inline row of fields (label/input pairs side by side). */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mfbe-desc-row${className ? ` ${className}` : ''}`}>{children}</div>;
}

/* ------------------------------------------------------------------------ */
/* Buttons                                                                  */
/* ------------------------------------------------------------------------ */

export function SmallButton({
  testId,
  onClick,
  children,
  title,
  disabled,
  kind = 'default',
}: {
  testId: string;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  kind?: 'default' | 'remove';
}) {
  return (
    <button
      type="button"
      className={`mfbe-desc-button${kind === 'remove' ? ' mfbe-desc-button-remove' : ''}`}
      data-testid={testId}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function RemoveButton({ testId, onClick }: { testId: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <SmallButton
      testId={testId}
      onClick={onClick}
      title={t('descriptionForm.remove')}
      kind="remove"
    >
      {'\u2715'}
    </SmallButton>
  );
}

export function AddButton({
  testId,
  onClick,
  label,
}: {
  testId: string;
  onClick: () => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const text = label ?? t('descriptionForm.add');
  return (
    <SmallButton testId={testId} onClick={onClick} title={text}>
      {`+ ${text}`}
    </SmallButton>
  );
}

/** Empty-list hint. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return <div className="mfbe-desc-empty">{children}</div>;
}
