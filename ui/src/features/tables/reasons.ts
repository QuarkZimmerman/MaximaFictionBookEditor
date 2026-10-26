/**
 * The words of a table command's reason (feature 006, FR-043; data-model §4.2, §9.6;
 * resource-formats.md §9): the key `tables.reason.<code>` of the feature catalogue, its leaf
 * picked by the parameter that changes the text (`merged-crosses-border.<axis>`,
 * `no-neighbour.<direction>`, `not-merged.<selection>`, `span-past-edge.<axis>`) or, for
 * `noTarget`, by the command (`.insert` for `insert.table`, `.table` for the others);
 * `{{id}}` and `{{value}}` are filled for `duplicate-id` and `invalid-lang`, and a Source
 * verdict `source.<code>` reads `tables.reason.source.<code>` (US1).
 */

import type { TFunction } from 'i18next';

import type { HostRefusal } from '@/editor/table/commands';
import type { Refusal, RefusalCode } from '@/editor/table/edit';

/** Every code a table reason may have. */
export type ReasonCode =
  | RefusalCode
  | HostRefusal['refused']
  | 'noTarget'
  | 'noTablePlace'
  | 'cellInlineOnly'
  | `source.${string}`;

/** The parameter whose value names the leaf of a code's key. */
const LEAF_PARAMETER: Readonly<Partial<Record<string, string>>> = {
  'merged-crosses-border': 'axis',
  'no-neighbour': 'direction',
  'not-merged': 'selection',
  'span-past-edge': 'axis',
};

/** The text of a refusal (a plan's or the host's). */
export function reasonText(refusal: Refusal | HostRefusal, t: TFunction): string;
/** The text of a reason code with its parameters (`command` for `noTarget`). */
export function reasonText(
  code: ReasonCode,
  params: Record<string, unknown> | undefined,
  t: TFunction,
): string;
export function reasonText(
  first: Refusal | HostRefusal | ReasonCode,
  second: Record<string, unknown> | undefined | TFunction,
  third?: TFunction,
): string {
  let code: string;
  let params: Record<string, unknown>;
  let t: TFunction;
  if (typeof first === 'string') {
    code = first;
    params = (second as Record<string, unknown> | undefined) ?? {};
    t = third!;
  } else {
    code = first.refused;
    params = ('params' in first ? (first.params as Record<string, unknown>) : undefined) ?? {};
    t = second as TFunction;
  }
  if (code === 'noTarget') {
    return t(`tables.reason.noTarget.${params.command === 'insert.table' ? 'insert' : 'table'}`);
  }
  const leaf = LEAF_PARAMETER[code];
  if (leaf) return t(`tables.reason.${code}.${String(params[leaf])}`);
  return t(`tables.reason.${code}`, params);
}
