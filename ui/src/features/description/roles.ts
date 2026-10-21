/**
 * The Maxima Library's role entries (feature 004, US3; FR-020 to FR-025; research R3.1,
 * data-model §3): illustrator, editor, compiler, designer, commentator and "about the author"
 * are one `custom-info` element per person directly under `description`, with the role as the
 * `info-type` and the text `Last_name First_name Middle_name` - the three parts in that order,
 * an empty part kept as empty, joined by single spaces, spaces inside a part written as `_`,
 * the whole trimmed. The library's site writes and reads that form
 * (`libraries/maxlib/src/BookFormats/FB2/FictionBook.php`); the requester's Maxima FBD Maker
 * writes it too (`CustomInfoEncoder.EncodePerson`) and adds no `.` to a one-letter name - the
 * rule this editor follows (requester, 2026-10-20); the site's reader adds that `.` itself.
 *
 * The derivation is the interface's alone: the core, the document model and the corpus gate
 * see `custom-info` rows only. This module is pure - the predicate and the reader
 * (`parseRoleRow`), the writer (`formatRoleText`, `roleEntryToRow`), the "unchanged" test the
 * fold-back of the Description form relies on and `splitRoleRows` for the description import
 * and export. Nothing here knows the library's record-number entries (`mlauthorid`,
 * `mlseriesid`...): they stay plain Custom info rows (FR-025).
 */

import type { CustomInfo } from '@/model/document';

/** The six roles in the order of the list and of the data model. */
export type Role =
  'illustrator' | 'editor' | 'compiler' | 'designer' | 'commentator' | 'aboutTheAuthor';

export const ROLES: readonly Role[] = [
  'illustrator',
  'editor',
  'compiler',
  'designer',
  'commentator',
  'aboutTheAuthor',
];

/** The library's `info-type` of each role (`ADDITIONAL_ROLE_LABELS` of its reader). */
export const INFO_TYPE_BY_ROLE: Readonly<Record<Role, string>> = {
  illustrator: 'mlillustrator',
  editor: 'mleditor',
  compiler: 'mlcompiler',
  designer: 'mldesigner',
  commentator: 'mlcommentator',
  aboutTheAuthor: 'mlabouttheauthor',
};

/**
 * The role of an `info-type`, matched by exact letters (the library's `array_search(..., true)`):
 * `MlEditor` is no role. A map, not an object, so that no prototype key ever matches.
 */
export const ROLE_BY_INFO_TYPE: ReadonlyMap<string, Role> = new Map(
  ROLES.map((role) => [INFO_TYPE_BY_ROLE[role], role]),
);

/** The `custom-info` row a role entry was read from (its characters, kept for the fold-back). */
export interface RoleSource {
  /** Identity of the row within the form (`r1`, `r2`...), assigned once at load. */
  key: string;
  infoType: string;
  text: string;
  lang?: string;
}

/** One entry of the "Other persons" list; the names raw, as typed. */
export interface RoleEntry {
  role: Role;
  lastName: string;
  firstName: string;
  middleName: string;
  source?: RoleSource;
}

/** The three names read from a row, with the role of its type. */
export interface ParsedRole {
  role: Role;
  lastName: string;
  firstName: string;
  middleName: string;
}

/** PHP `trim()` strips " \t\n\r\0\x0B"; NUL and VT cannot occur in XML 1.0 text. */
const ASCII_EDGES = /^[ \t\n\r]+|[ \t\n\r]+$/g;

/**
 * Reads a `custom-info` row as the library does (FR-022, data-model §3.3): a role type by exact
 * letters; the text trimmed of ASCII white space at both ends, non-empty, split on single
 * ordinary spaces (U+0020 - consecutive spaces give empty parts) into at most three parts, taken
 * by position as last, first and middle name with `_` turned back into a space. No `.` is added
 * on read: the file's text is shown as it is. Null for any other row - it stays a plain Custom
 * info row (the library would read the first three parts of a longer text and drop the rest; the
 * editor drops nothing).
 */
export function parseRoleRow(row: Pick<CustomInfo, 'infoType' | 'text'>): ParsedRole | null {
  const role = ROLE_BY_INFO_TYPE.get(row.infoType);
  if (!role) return null;
  const text = row.text.replace(ASCII_EDGES, '');
  if (text === '') return null;
  const parts = text.split(' ');
  if (parts.length > 3) return null;
  const [lastName = '', firstName = '', middleName = ''] = parts.map((part) =>
    part.replace(/_/g, ' '),
  );
  return { role, lastName, firstName, middleName };
}

/** True when the row is read into the "Other persons" list (and hidden from Custom info). */
export function isRoleRow(row: Pick<CustomInfo, 'infoType' | 'text'>): boolean {
  return parseRoleRow(row) !== null;
}

/** The list entry of a row that passes `parseRoleRow`, carrying the row as its source. */
export function roleEntryFromRow(row: CustomInfo, key: string): RoleEntry | null {
  const parsed = parseRoleRow(row);
  if (!parsed) return null;
  const source: RoleSource = { key, infoType: row.infoType, text: row.text };
  if (row.lang !== undefined) source.lang = row.lang;
  return { ...parsed, source };
}

/** A new, empty entry for the Add control (the first role, no names). */
export function emptyRoleEntry(role: Role = ROLES[0]!): RoleEntry {
  return { role, lastName: '', firstName: '', middleName: '' };
}

/** True when every name of the entry is empty (such an entry is not written). */
export function roleEntryEmpty(
  entry: Pick<RoleEntry, 'lastName' | 'firstName' | 'middleName'>,
): boolean {
  return !entry.lastName.trim() && !entry.firstName.trim() && !entry.middleName.trim();
}

/**
 * The text of an entry as the Maxima FBD Maker writes it (FR-021, data-model §3.4): each part
 * trimmed, a space inside a part written as `_`, the three parts joined by single spaces (an
 * empty part kept, so a missing first name gives two spaces in a row, as the library writes and
 * reads), the result trimmed at both ends. No `.` is added to a one-letter name: the FBD Maker
 * adds none and the library's reader adds its own when it reads one.
 */
export function formatRoleText(
  entry: Pick<RoleEntry, 'lastName' | 'firstName' | 'middleName'>,
): string {
  return [entry.lastName, entry.firstName, entry.middleName]
    .map((part) => part.trim().replace(/ /g, '_'))
    .join(' ')
    .replace(/^ +| +$/g, '');
}

/**
 * True while the entry still says what its row said: read from a row, the same role, and the
 * trimmed names equal to the names read (data-model §3.5). Such an entry is written back
 * character for character from its source (FR-023).
 */
export function unchanged(entry: RoleEntry): boolean {
  if (!entry.source) return false;
  const parsed = parseRoleRow(entry.source);
  if (!parsed || parsed.role !== entry.role) return false;
  return (
    parsed.lastName === entry.lastName.trim() &&
    parsed.firstName === entry.firstName.trim() &&
    parsed.middleName === entry.middleName.trim()
  );
}

/**
 * The `custom-info` row an entry is written as: an unchanged entry verbatim from its source, a
 * new or changed one in the library's format with the role's `info-type`; `lang` - the only
 * attribute the model carries - is kept either way (FR-023).
 */
export function roleEntryToRow(entry: RoleEntry): CustomInfo {
  if (entry.source && unchanged(entry)) {
    const row: CustomInfo = { infoType: entry.source.infoType, text: entry.source.text };
    if (entry.source.lang !== undefined) row.lang = entry.source.lang;
    return row;
  }
  const row: CustomInfo = { infoType: INFO_TYPE_BY_ROLE[entry.role], text: formatRoleText(entry) };
  if (entry.source?.lang !== undefined) row.lang = entry.source.lang;
  return row;
}

/**
 * Splits the rows of a description into the role rows and the plain rows, in their order - the
 * "Other persons" entry of the description import and the export reuse the predicate (FR-024).
 */
export function splitRoleRows(customInfo: readonly CustomInfo[]): {
  roleRows: CustomInfo[];
  plainRows: CustomInfo[];
} {
  const roleRows: CustomInfo[] = [];
  const plainRows: CustomInfo[] = [];
  for (const row of customInfo) (isRoleRow(row) ? roleRows : plainRows).push(row);
  return { roleRows, plainRows };
}
