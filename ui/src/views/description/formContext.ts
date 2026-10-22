/**
 * React context of the Description forms: the controller, the raw form state, the
 * required-field issues, the genre / language catalogues, the document's binaries and the
 * quiet lock of a script run (`readOnly`: every field refuses edits, every add / remove /
 * choose control is unavailable, nothing is greyed - feature 003 FR-011).
 */

import { createContext, useContext, type ChangeEvent, type SelectHTMLAttributes } from 'react';

import type { BinaryMeta } from '@/model/document';
import type { UiLanguage } from '@/rpc/types';

import type { DescriptionController } from './binding';
import { getAtPath, type DescriptionForm, type FieldKey, type RequiredIssues } from './model';
import type { GenreCatalog, LanguageCatalog } from './resources';

export interface DescriptionFormContextValue {
  controller: DescriptionController;
  form: DescriptionForm;
  issues: RequiredIssues;
  language: UiLanguage;
  genres: GenreCatalog;
  languages: LanguageCatalog;
  reloadGenres: () => void;
  docId: string | null;
  binaries: BinaryMeta[];
  /** A script run or an AI request holds the document: the form is read-only (`store.runLock`). */
  readOnly: boolean;
}

export const DescriptionFormContext = createContext<DescriptionFormContextValue | null>(null);

export function useDescriptionForm(): DescriptionFormContextValue {
  const value = useContext(DescriptionFormContext);
  if (!value) throw new Error('useDescriptionForm must be used inside <DescriptionFormContext>');
  return value;
}

/** The string value at a form path ('' for undefined). */
export function useFieldValue(key: FieldKey): string {
  const { form } = useDescriptionForm();
  const value = getAtPath(form, key);
  if (typeof value === 'string') return value;
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The form's quiet lock, also for controls rendered outside the form (the picker dialogs open
 * in the dialog layer, where there is no form context): false there.
 */
export function useFormReadOnly(): boolean {
  return useContext(DescriptionFormContext)?.readOnly ?? false;
}

/** Keys that leave a `<select>` or its value alone (still allowed while it is read-only). */
const SELECT_NAVIGATION_KEYS = new Set(['Tab', 'Escape', 'F6', 'F10']);

/**
 * Props that make a `<select>` read-only (HTML has no `readonly` for it): the list does not
 * open, the keyboard cannot change the value and `onChange` is swallowed, while the control
 * keeps its focus, its look (nothing greyed) and its current value. Spread after `onChange`.
 */
export function readOnlySelectProps(
  readOnly: boolean,
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void,
): Pick<
  SelectHTMLAttributes<HTMLSelectElement>,
  'aria-readonly' | 'onChange' | 'onMouseDown' | 'onKeyDown'
> {
  if (!readOnly) return { onChange };
  return {
    'aria-readonly': true,
    onChange: () => {},
    onMouseDown: (event) => event.preventDefault(),
    onKeyDown: (event) => {
      if (!SELECT_NAVIGATION_KEYS.has(event.key)) event.preventDefault();
    },
  };
}
