/**
 * The file name proposed for a never-saved document (feature 004, FR-050 to FR-053; research
 * R6.1; data-model §6): "Last name First name - Book title" in the book's own letters,
 * sanitised so that the name is saveable on every supported platform, "Untitled" in the
 * interface language when the description has neither. Pure functions shared by Save As
 * (`fileCommands.ts`) and Export as FBD (`features/transfer`); the caller passes
 * `t('app.untitled')` and the extension of the file type selected when the dialog opens. The
 * name travels as a bare `defaultPath` (no folder) - after sanitising it holds no separator and
 * no `:`, so it can never read as a relative path.
 */

import type { Description, Person } from '@/model/document';

/** FR-052 limits of the stem (the extension is not counted). */
export const MAX_STEM_CODE_POINTS = 120;
export const MAX_STEM_UTF8_BYTES = 200;

/** `\ / : * ? " < > |` and the control characters U+0000-U+001F, U+007F-U+009F. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F\u007F-\u009F]/g;
/** Windows device names, letter case ignored; superscript digits count like digits. */
const DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])$/i;

function trimEdges(part: string): string {
  // Leading and trailing spaces and dots (FR-052); every other character stays.
  return part.replace(/^[ .]+/, '').replace(/[ .]+$/, '');
}

/** One name part sanitised on its own; '' when nothing usable remains (dropped by the caller). */
function sanitisePart(part: string): string {
  const cleaned = trimEdges(part.replace(FORBIDDEN, '_'));
  return /^_*$/.test(cleaned) ? '' : cleaned;
}

/** The author part of FR-050: last and first name, else the nickname; the middle name never. */
export function authorPart(authors: readonly Person[]): string {
  for (const author of authors) {
    const last = (author.lastName ?? '').trim();
    const first = (author.firstName ?? '').trim();
    const nickname = (author.nickname ?? '').trim();
    const names = [last, first].filter((name) => name.length > 0).join(' ');
    if (names) return names;
    if (nickname) return nickname;
  }
  return '';
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Cuts at a code-point boundary to the FR-052 limits; surrogate pairs stay whole. */
export function cutStem(stem: string): string {
  let bytes = 0;
  let count = 0;
  let out = '';
  for (const character of stem) {
    const size = utf8Length(character.codePointAt(0)!);
    if (count + 1 > MAX_STEM_CODE_POINTS || bytes + size > MAX_STEM_UTF8_BYTES) break;
    out += character;
    count += 1;
    bytes += size;
  }
  return out;
}

/** A stem whose first dot-separated segment is a Windows device name gets `_` after it. */
function guardDeviceName(stem: string): string {
  const dot = stem.indexOf('.');
  const head = dot < 0 ? stem : stem.slice(0, dot);
  if (!DEVICE_NAME.test(head)) return stem;
  return `${head}_${dot < 0 ? '' : stem.slice(dot)}`;
}

/**
 * The stem (name without extension) proposed for `description`: the sanitised parts joined by
 * " - ", cut to 120 code points and 200 UTF-8 bytes, device names guarded, `untitled` when
 * nothing remains.
 */
export function proposedStem(description: Description, untitled: string): string {
  const parts = [
    sanitisePart(authorPart(description.titleInfo.authors)),
    sanitisePart((description.titleInfo.bookTitle ?? '').trim()),
  ].filter((part) => part.length > 0);
  const stem = guardDeviceName(trimEdges(cutStem(parts.join(' - '))));
  return stem.length > 0 ? stem : untitled;
}

/** `proposedStem` with the extension of the selected file type (`fb2`, `fbd`), without a dot. */
export function proposedFileName(
  description: Description,
  untitled: string,
  extension: string,
): string {
  const ext = extension.replace(/^\.+/, '');
  return ext
    ? `${proposedStem(description, untitled)}.${ext}`
    : proposedStem(description, untitled);
}

/**
 * The file name of `path` without its last extension, whatever its case (`book.FB2` -> `book`,
 * `archive.tar.fb2` -> `archive.tar`, a name without extension unchanged); both separators are
 * understood, so a Windows path works on every platform.
 */
export function exportStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
