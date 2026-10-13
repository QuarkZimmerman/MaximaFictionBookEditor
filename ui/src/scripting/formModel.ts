/**
 * Pure helpers of the `ui.form` renderer: field validation (malformed fields are dropped so a
 * sloppy spec still produces a dialog) and the initial values derived from a spec.
 */

import type { FormField, FormValues } from './types';

const FIELD_KINDS = new Set(['text', 'number', 'checkbox', 'select', 'radio', 'list', 'static']);

/** Drops malformed fields so a sloppy spec still produces a dialog. */
export function normaliseFields(fields: unknown): FormField[] {
  if (!Array.isArray(fields)) return [];
  const out: FormField[] = [];
  const seen = new Set<string>();
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue;
    const field = raw as Partial<FormField> & { kind?: string; id?: unknown };
    if (!field.kind || !FIELD_KINDS.has(field.kind)) continue;
    if (typeof field.id !== 'string' || !field.id || seen.has(field.id)) continue;
    if (
      (field.kind === 'select' || field.kind === 'radio' || field.kind === 'list') &&
      !Array.isArray((field as { options?: unknown }).options)
    ) {
      continue;
    }
    seen.add(field.id);
    out.push(field as FormField);
  }
  return out;
}

/** Initial values from the spec (defaults for every non-static field). */
export function initialValues(fields: readonly FormField[]): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    switch (field.kind) {
      case 'text':
        values[field.id] = field.value ?? '';
        break;
      case 'number':
        values[field.id] = typeof field.value === 'number' ? field.value : (field.min ?? 0);
        break;
      case 'checkbox':
        values[field.id] = !!field.value;
        break;
      case 'select':
      case 'radio':
        values[field.id] = field.value ?? field.options[0]?.value ?? '';
        break;
      case 'list':
        values[field.id] = Array.isArray(field.value)
          ? field.value
          : field.multiple
            ? []
            : field.options[0]
              ? [field.options[0].value]
              : [];
        break;
      case 'static':
        break;
    }
  }
  return values;
}
