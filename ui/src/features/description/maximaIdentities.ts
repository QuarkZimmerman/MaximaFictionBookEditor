/**
 * Pure FB2 Description `<custom-info>` identity codec and live binding projection for Maxima
 * Library Lookup Service v2 (feature 021, data-model.md §4, contracts/lookup-v2.md §5).
 *
 * Keeps `DescriptionForm.customInfo` as the single source of truth: `ml*id` entries remain visible
 * and editable in the Custom info list, unmatched pre-existing entries stay untouched, and live
 * edits/deletions in either the person/series rows or the Custom info table synchronize immediately
 * inside a single atomic `DescriptionController` update (single Undo/Redo step).
 */

import { INFO_TYPE_BY_ROLE, ROLES, type Role } from '@/features/description/roles';
import type { Person, Sequence } from '@/model/document';
import type { MaximaPersonRole } from '@/rpc/types';
import type { DescriptionForm, FormCustomInfo } from '@/views/description/model';

export const MAXIMA_IDENTITY_INFO_TYPE_BY_PERSON_ROLE: Readonly<Record<MaximaPersonRole, string>> =
  {
    author: 'mlauthorid',
    translator: 'mltranslatorid',
    illustrator: 'mlillustratorid',
    editor: 'mleditorid',
    compiler: 'mlcompilerid',
    designer: 'mldesignerid',
    commentator: 'mlcommentatorid',
    abouttheauthor: 'mlabouttheauthorid',
  };

export const MAXIMA_SERIES_IDENTITY_INFO_TYPE = 'mlseriesid';

export const MAXIMA_IDENTITY_INFO_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(MAXIMA_IDENTITY_INFO_TYPE_BY_PERSON_ROLE),
  MAXIMA_SERIES_IDENTITY_INFO_TYPE,
]);

/**
 * All 15 Maxima Library `<custom-info>` `info-type` markers (6 contributor role tags + 9 identity
 * tags), highlighted subtly in Source view as an editable visual hint (`FR-027`).
 */
export const MAXIMA_LIBRARY_CUSTOM_INFO_TYPES: ReadonlySet<string> = new Set([
  ...ROLES.map((role) => INFO_TYPE_BY_ROLE[role]),
  ...MAXIMA_IDENTITY_INFO_TYPES,
]);

export function roleToMaximaPersonRole(role: Role): MaximaPersonRole {
  return role === 'aboutTheAuthor' ? 'abouttheauthor' : role;
}

export function identityInfoTypeForRole(role: MaximaPersonRole): string {
  return MAXIMA_IDENTITY_INFO_TYPE_BY_PERSON_ROLE[role];
}

export function formatPersonDisplayName(
  person: Pick<Person, 'lastName' | 'firstName' | 'middleName'>,
): string {
  return [person.lastName, person.firstName, person.middleName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

export function formatIdentityText(libraryId: number, displayName: string): string {
  return `${libraryId} ${displayName.trim()}`;
}

export interface ParsedIdentityRow {
  infoType: string;
  libraryId: number;
  displayName: string;
}

const IDENTITY_TEXT_PATTERN = /^([1-9]\d*)\s+(.+)$/s;

export function parseIdentityRow(
  row: Pick<FormCustomInfo, 'infoType' | 'text' | 'roleRow'>,
): ParsedIdentityRow | null {
  if (row.roleRow) return null;
  if (!MAXIMA_IDENTITY_INFO_TYPES.has(row.infoType)) return null;
  const trimmed = (row.text ?? '').trim();
  const match = IDENTITY_TEXT_PATTERN.exec(trimmed);
  if (!match) return null;
  const libraryId = Number.parseInt(match[1]!, 10);
  const displayName = match[2]!.trim();
  if (!Number.isSafeInteger(libraryId) || libraryId <= 0 || displayName.length === 0) {
    return null;
  }
  return { infoType: row.infoType, libraryId, displayName };
}

export interface MaximaRowBinding {
  /** Positive Maxima Library database identity. */
  libraryId: number;
  /** Index inside `DescriptionForm.customInfo` of the paired `ml*id` row. */
  customInfoIndex: number;
}

export interface MaximaDescriptionBindings {
  /** Keyed by row path: `titleInfo.authors.0`, `titleInfo.translators.1`, `roles.0`, `titleInfo.sequences.0`, `titleInfo.sequences.0.children.1`. */
  byRowPath: ReadonlyMap<string, MaximaRowBinding>;
  /** Indices in `form.customInfo` paired with a live person or author-series row. */
  pairedCustomInfoIndices: ReadonlySet<number>;
}

interface RowCandidate {
  rowPath: string;
  displayName: string;
}

function collectSeriesCandidates(
  sequences: readonly Sequence[] | undefined,
  prefix: string,
  out: RowCandidate[],
): void {
  if (!sequences) return;
  for (let i = 0; i < sequences.length; i += 1) {
    const seq = sequences[i]!;
    const path = `${prefix}.${i}`;
    const name = (seq.name ?? '').trim();
    if (name.length > 0) {
      out.push({ rowPath: path, displayName: name });
    }
    if (seq.children && seq.children.length > 0) {
      collectSeriesCandidates(seq.children, `${path}.children`, out);
    }
  }
}

function collectRowCandidatesByMarker(form: DescriptionForm): Map<string, RowCandidate[]> {
  const byMarker = new Map<string, RowCandidate[]>();
  const push = (marker: string, rowPath: string, displayName: string) => {
    if (!displayName) return;
    let list = byMarker.get(marker);
    if (!list) {
      list = [];
      byMarker.set(marker, list);
    }
    list.push({ rowPath, displayName });
  };

  const authors = form.titleInfo.authors ?? [];
  for (let i = 0; i < authors.length; i += 1) {
    push('mlauthorid', `titleInfo.authors.${i}`, formatPersonDisplayName(authors[i]!));
  }

  const translators = form.titleInfo.translators ?? [];
  for (let i = 0; i < translators.length; i += 1) {
    push('mltranslatorid', `titleInfo.translators.${i}`, formatPersonDisplayName(translators[i]!));
  }

  const roles = form.roles ?? [];
  for (let i = 0; i < roles.length; i += 1) {
    const entry = roles[i]!;
    const marker = identityInfoTypeForRole(roleToMaximaPersonRole(entry.role));
    push(marker, `roles.${i}`, formatPersonDisplayName(entry));
  }

  const seriesCandidates: RowCandidate[] = [];
  collectSeriesCandidates(form.titleInfo.sequences, 'titleInfo.sequences', seriesCandidates);
  if (seriesCandidates.length > 0) {
    byMarker.set(MAXIMA_SERIES_IDENTITY_INFO_TYPE, seriesCandidates);
  }

  return byMarker;
}

/**
 * Derives live person and author-series bindings by order-preserving subsequence matching against
 * `form.customInfo`. Unmatched `ml*id` entries (e.g. externally edited names) stay unpaired and
 * untouched.
 */
export function deriveMaximaBindings(form: DescriptionForm): MaximaDescriptionBindings {
  const byRowPath = new Map<string, MaximaRowBinding>();
  const pairedCustomInfoIndices = new Set<number>();
  const candidatesByMarker = collectRowCandidatesByMarker(form);
  const nextCandidateIndex = new Map<string, number>();

  for (let ci = 0; ci < form.customInfo.length; ci += 1) {
    const parsed = parseIdentityRow(form.customInfo[ci]!);
    if (!parsed) continue;
    const candidates = candidatesByMarker.get(parsed.infoType);
    if (!candidates || candidates.length === 0) continue;

    const start = nextCandidateIndex.get(parsed.infoType) ?? 0;
    for (let j = start; j < candidates.length; j += 1) {
      if (candidates[j]!.displayName === parsed.displayName) {
        byRowPath.set(candidates[j]!.rowPath, {
          libraryId: parsed.libraryId,
          customInfoIndex: ci,
        });
        pairedCustomInfoIndices.add(ci);
        nextCandidateIndex.set(parsed.infoType, j + 1);
        break;
      }
    }
  }

  return { byRowPath, pairedCustomInfoIndices };
}

/**
 * Atomically binds (inserts or updates) the `ml*id` `<custom-info>` entry for `rowPath` in
 * document order inside `form.customInfo`. Expects `form` to already reflect the updated name for
 * `rowPath`.
 */
export function bindRowIdentity(
  form: DescriptionForm,
  rowPath: string,
  markerInfoType: string,
  libraryId: number,
  displayName: string,
  previousBindings?: MaximaDescriptionBindings,
): DescriptionForm {
  const trimmedName = displayName.trim();
  if (!trimmedName || !Number.isSafeInteger(libraryId) || libraryId <= 0) {
    return form;
  }
  const text = formatIdentityText(libraryId, trimmedName);
  const prev = previousBindings ?? deriveMaximaBindings(form);
  const existing = prev.byRowPath.get(rowPath);

  if (existing && form.customInfo[existing.customInfoIndex]) {
    const nextCustom = form.customInfo.slice();
    nextCustom[existing.customInfoIndex] = {
      ...nextCustom[existing.customInfoIndex]!,
      infoType: markerInfoType,
      text,
    };
    return { ...form, customInfo: nextCustom };
  }

  // Insert in document order among already-paired entries of the same marker type.
  const candidates = collectRowCandidatesByMarker(form).get(markerInfoType) ?? [];
  const targetOrder = candidates.findIndex((c) => c.rowPath === rowPath);
  const currentBindings = deriveMaximaBindings(form);

  let insertAt = form.customInfo.length;
  if (targetOrder >= 0) {
    // Prefer right after the nearest preceding bound sibling of the same marker.
    let afterPrev = -1;
    for (let i = targetOrder - 1; i >= 0; i -= 1) {
      const b = currentBindings.byRowPath.get(candidates[i]!.rowPath);
      if (b) {
        afterPrev = b.customInfoIndex + 1;
        break;
      }
    }
    if (afterPrev >= 0) {
      insertAt = afterPrev;
    } else {
      // Otherwise right before the nearest following bound sibling of the same marker.
      for (let i = targetOrder + 1; i < candidates.length; i += 1) {
        const b = currentBindings.byRowPath.get(candidates[i]!.rowPath);
        if (b) {
          insertAt = b.customInfoIndex;
          break;
        }
      }
    }
  }

  const nextCustom = form.customInfo.slice();
  nextCustom.splice(insertAt, 0, { infoType: markerInfoType, text });
  return { ...form, customInfo: nextCustom };
}

/**
 * Removes ONLY the paired `ml*id` `<custom-info>` entries belonging to `rowPaths` (as resolved
 * against `previousBindings` captured before the edit or deletion). Unmatched pre-existing `ml*id`
 * rows and unrelated `<custom-info>` rows remain untouched.
 */
export function unbindRowIdentities(
  form: DescriptionForm,
  rowPaths: readonly string[],
  previousBindings: MaximaDescriptionBindings,
): DescriptionForm {
  if (rowPaths.length === 0) return form;
  const toRemove = new Set<number>();
  for (const path of rowPaths) {
    const binding = previousBindings.byRowPath.get(path);
    if (binding) {
      toRemove.add(binding.customInfoIndex);
    }
  }
  if (toRemove.size === 0) return form;
  return {
    ...form,
    customInfo: form.customInfo.filter((_, index) => !toRemove.has(index)),
  };
}

/**
 * Collects `rowPath` plus every descendant `rowPath.children.*` present in `bindings`, used when
 * deleting a parent author series so its nested sub-series `mlseriesid` rows are removed cleanly.
 */
export function collectSubtreeRowPaths(
  rootRowPath: string,
  bindings: MaximaDescriptionBindings,
): string[] {
  const prefix = `${rootRowPath}.children.`;
  const paths: string[] = [];
  if (bindings.byRowPath.has(rootRowPath)) {
    paths.push(rootRowPath);
  }
  for (const key of bindings.byRowPath.keys()) {
    if (key.startsWith(prefix)) {
      paths.push(key);
    }
  }
  return paths;
}
