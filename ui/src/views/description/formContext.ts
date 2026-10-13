/**
 * React context of the Description forms: the controller, the raw form state, the
 * required-field issues, the genre / language catalogues and the document's binaries.
 */

import { createContext, useContext } from 'react';

import type { BinaryMeta, Description } from '@/model/document';
import type { UiLanguage } from '@/rpc/types';

import type { DescriptionController } from './binding';
import { getAtPath, type FieldKey, type RequiredIssues } from './model';
import type { GenreCatalog, LanguageCatalog } from './resources';

export interface DescriptionFormContextValue {
  controller: DescriptionController;
  form: Description;
  issues: RequiredIssues;
  language: UiLanguage;
  genres: GenreCatalog;
  languages: LanguageCatalog;
  reloadGenres: () => void;
  docId: string | null;
  binaries: BinaryMeta[];
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
