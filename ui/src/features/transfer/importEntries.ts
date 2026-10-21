/**
 * The pure half of the description import (feature 004 US4; spec FR-032, FR-034, FR-035;
 * research R3.2, data-model §4.2 / §4.3):
 *
 *  - `importableEntries()` turns a `doc.readDescription` answer into the entries the import
 *    offers - one per field or list of the Description view present and non-empty in the
 *    file, in the FR-032 order: the eleven title-info entries, the role rows as one "Other
 *    persons" entry, the source title info as one entry, the nine document-info entries, the
 *    six publish-info entries and one line per plain `custom-info` row;
 *  - `entryLabel()` / `entryValueText()` render an entry for the confirmation dialog: the
 *    label "{{group}}: {{field}}" in the Description view's own words, the value as plain text
 *    (the paragraphs of an annotation or history and the items of a list joined by "; ", cut
 *    to 200 characters with an ellipsis; the cover as its image's name, size and type, or as
 *    "no data" when the file lacks the image);
 *  - `applyEntries()` replaces the chosen entries in a description: a field or list as a
 *    whole, the cover references rewritten through the binary map `#old -> #new`, the role
 *    rows replaced by the file's (verbatim - they count as read), the four document details
 *    taken from `documentDetails` (the fill-in of 002 FR-005 applied), a missing publish-info
 *    block created, the plain rows of one `info-type` replaced together. Everything else -
 *    unticked entries, the body, the images, the stylesheets - is left as it is.
 */

import type { TFunction } from 'i18next';

import { parseRoleRow, splitRoleRows } from '@/features/description/roles';
import type {
  AnnotationNode,
  BinaryMeta,
  CustomInfo,
  DateValue,
  Description,
  DocumentInfo,
  GenreRef,
  ImageRef,
  Person,
  PublishInfo,
  Sequence,
  TitleInfo,
} from '@/model/document';
import type { ReadDescriptionResult } from '@/rpc/types';

export type { ReadDescriptionResult } from '@/rpc/types';

/** The Description view's groups an entry belongs to. */
export type EntryGroup =
  'titleInfo' | 'srcTitleInfo' | 'documentInfo' | 'publishInfo' | 'customInfo';

/** A cover page image of a cover entry, with the file's binary when it carries the data. */
export interface CoverRef {
  href: string;
  binary: BinaryMeta | null;
}

export interface ImportableEntry {
  /** `titleInfo.authors`, `roles`, `srcTitleInfo`, `documentInfo.id`, `customInfo.<i>`... */
  key: string;
  group: EntryGroup;
  /** i18n key of the field name; absent when the group alone names the entry. */
  fieldKey?: string;
  /** A literal field name (the `info-type` of a custom row). */
  fieldText?: string;
  /** The value as plain text (empty for a cover entry, rendered by `entryValueText`). */
  text: string;
  /** The `#id` references of the entry's images the file carries (what `binary.copy` copies). */
  hrefs: string[];
  /** The cover page images of a cover entry. */
  covers?: CoverRef[];
}

/** FR-034: the value shown is cut to this many characters, an ellipsis added. */
export const VALUE_LIMIT = 200;
const SEPARATOR = '; ';

const GROUP_KEYS: Record<EntryGroup, string> = {
  titleInfo: 'description.titleInfo',
  srcTitleInfo: 'description.srcTitleInfo',
  documentInfo: 'description.documentInfo',
  publishInfo: 'description.publishInfo',
  customInfo: 'description.customInfo',
};

/* ------------------------------------------------------------------------ */
/* Plain text of values                                                      */
/* ------------------------------------------------------------------------ */

function truncate(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= VALUE_LIMIT) return text;
  return `${characters.slice(0, VALUE_LIMIT - 1).join('')}\u2026`;
}

function join(items: readonly string[]): string {
  return items.filter((item) => item.length > 0).join(SEPARATOR);
}

/** "Last First Middle", or the nickname when there is no name. */
export function personText(person: Person): string {
  const name = [person.lastName, person.firstName, person.middleName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
  if (name) return name;
  return (person.nickname ?? '').trim();
}

function sequenceTexts(sequences: readonly Sequence[]): string[] {
  const out: string[] = [];
  for (const sequence of sequences) {
    const name = sequence.name.trim();
    const own = sequence.number !== undefined ? `${name} ${sequence.number}`.trim() : name;
    if (own) out.push(own);
    out.push(...sequenceTexts(sequence.children));
  }
  return out;
}

/** The text of a block node and its descendants (marks and inline images contribute nothing). */
function nodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = node as { type?: string; text?: string; content?: unknown[] };
  if (value.type === 'text') return value.text ?? '';
  if (!Array.isArray(value.content)) return '';
  return value.content.map(nodeText).join('');
}

/** The paragraphs (top-level blocks) of an annotation or history, each as its text. */
function blockTexts(node: AnnotationNode): string[] {
  return node.content.map((block) => nodeText(block).trim()).filter((text) => text.length > 0);
}

function dateText(date: DateValue | undefined): string {
  if (!date) return '';
  return date.text.trim() || (date.value ?? '').trim();
}

/** Every `#id` href inside a block node (inline images of an annotation or history). */
function imageHrefs(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  const value = node as { type?: string; attrs?: { href?: unknown }; content?: unknown[] };
  if ((value.type === 'image' || value.type === 'inline-image') && value.attrs) {
    const href = value.attrs.href;
    if (typeof href === 'string' && href.startsWith('#') && href.length > 1) out.push(href);
  }
  if (Array.isArray(value.content)) for (const child of value.content) imageHrefs(child, out);
}

function present<T>(list: readonly T[] | undefined): list is readonly T[] {
  return !!list && list.length > 0;
}

function hasText(value: string | undefined): value is string {
  return !!value && value.trim().length > 0;
}

/* ------------------------------------------------------------------------ */
/* importableEntries                                                         */
/* ------------------------------------------------------------------------ */

/** The ids of the file's binaries: a cover with data is one the file carries. */
function binaryById(result: ReadDescriptionResult): Map<string, BinaryMeta> {
  return new Map(result.binaries.map((meta) => [meta.id, meta]));
}

function coverRefs(images: readonly ImageRef[], binaries: Map<string, BinaryMeta>): CoverRef[] {
  return images
    .filter((image) => image.href.trim().length > 0)
    .map((image) => {
      const href = image.href.trim();
      const binary = href.startsWith('#') ? (binaries.get(href.slice(1)) ?? null) : null;
      return { href, binary };
    });
}

function carried(refs: readonly CoverRef[]): string[] {
  return refs.filter((ref) => ref.binary !== null).map((ref) => ref.href);
}

/** The `#id` hrefs of an annotation's images the file carries. */
function carriedImages(node: AnnotationNode | undefined, binaries: Map<string, BinaryMeta>) {
  const hrefs: string[] = [];
  if (node) imageHrefs(node, hrefs);
  return hrefs.filter((href) => binaries.has(href.slice(1)));
}

function titleInfoEntries(
  info: TitleInfo,
  binaries: Map<string, BinaryMeta>,
  roleRows: CustomInfo[],
): ImportableEntry[] {
  const entries: ImportableEntry[] = [];
  const add = (field: string, fieldKey: string, text: string, hrefs: string[] = []) =>
    entries.push({ key: `titleInfo.${field}`, group: 'titleInfo', fieldKey, text, hrefs });
  if (present(info.genres)) {
    add('genres', 'descriptionForm.genres.title', join(info.genres.map((g: GenreRef) => g.code)));
  }
  if (present(info.authors)) {
    add('authors', 'descriptionForm.authors', join(info.authors.map(personText)));
  }
  if (hasText(info.bookTitle)) add('bookTitle', 'description.fields.bookTitle', info.bookTitle);
  if (info.annotation && blockTexts(info.annotation).length > 0) {
    add(
      'annotation',
      'description.fields.annotation',
      join(blockTexts(info.annotation)),
      carriedImages(info.annotation, binaries),
    );
  }
  if (hasText(info.keywords)) add('keywords', 'descriptionForm.keywords', info.keywords);
  if (dateText(info.date)) add('date', 'description.fields.date', dateText(info.date));
  const covers = coverRefs(info.coverpage, binaries);
  if (covers.length > 0) {
    entries.push({
      key: 'titleInfo.coverpage',
      group: 'titleInfo',
      fieldKey: 'description.fields.coverpage',
      text: '',
      hrefs: carried(covers),
      covers,
    });
  }
  if (hasText(info.lang)) add('lang', 'description.fields.lang', info.lang);
  if (hasText(info.srcLang)) add('srcLang', 'description.fields.srcLang', info.srcLang);
  if (present(info.translators)) {
    add('translators', 'descriptionForm.translators', join(info.translators.map(personText)));
  }
  if (present(info.sequences)) {
    add('sequences', 'descriptionForm.sequences', join(sequenceTexts(info.sequences)));
  }
  if (roleRows.length > 0) {
    entries.push({
      key: 'roles',
      group: 'titleInfo',
      fieldKey: 'descriptionForm.roles.title',
      text: join(
        roleRows.map((row) => {
          const parsed = parseRoleRow(row);
          return parsed
            ? [parsed.lastName, parsed.firstName, parsed.middleName]
                .filter((part) => part.length > 0)
                .join(' ')
            : row.text.trim();
        }),
      ),
      hrefs: [],
    });
  }
  return entries;
}

function srcTitleInfoEntry(
  info: TitleInfo | undefined,
  binaries: Map<string, BinaryMeta>,
): ImportableEntry[] {
  if (!info) return [];
  const covers = coverRefs(info.coverpage, binaries);
  const empty =
    !present(info.genres) &&
    !present(info.authors) &&
    !hasText(info.bookTitle) &&
    !(info.annotation && blockTexts(info.annotation).length > 0) &&
    !hasText(info.keywords) &&
    !dateText(info.date) &&
    covers.length === 0 &&
    !hasText(info.lang) &&
    !hasText(info.srcLang) &&
    !present(info.translators) &&
    !present(info.sequences);
  if (empty) return [];
  return [
    {
      key: 'srcTitleInfo',
      group: 'srcTitleInfo',
      text: info.bookTitle.trim() || join(info.authors.map(personText)),
      hrefs: [...carried(covers), ...carriedImages(info.annotation, binaries)],
    },
  ];
}

function documentInfoEntries(
  info: DocumentInfo,
  binaries: Map<string, BinaryMeta>,
): ImportableEntry[] {
  const entries: ImportableEntry[] = [];
  const add = (field: string, fieldKey: string, text: string, hrefs: string[] = []) =>
    entries.push({ key: `documentInfo.${field}`, group: 'documentInfo', fieldKey, text, hrefs });
  if (present(info.authors)) {
    add('authors', 'descriptionForm.authors', join(info.authors.map(personText)));
  }
  if (hasText(info.programUsed)) {
    add('programUsed', 'description.fields.programUsed', info.programUsed);
  }
  if (dateText(info.date)) add('date', 'description.fields.date', dateText(info.date));
  if (present(info.srcUrls) && info.srcUrls.some(hasText)) {
    add('srcUrls', 'description.fields.srcUrls', join(info.srcUrls.map((url) => url.trim())));
  }
  if (hasText(info.srcOcr)) add('srcOcr', 'description.fields.srcOcr', info.srcOcr);
  if (hasText(info.id)) add('id', 'description.id', info.id);
  if (hasText(info.version)) add('version', 'description.fields.version', info.version);
  if (info.history && blockTexts(info.history).length > 0) {
    add(
      'history',
      'description.fields.history',
      join(blockTexts(info.history)),
      carriedImages(info.history, binaries),
    );
  }
  if (present(info.publishers)) {
    add('publishers', 'descriptionForm.publishers', join(info.publishers.map(personText)));
  }
  return entries;
}

function publishInfoEntries(info: PublishInfo | undefined): ImportableEntry[] {
  if (!info) return [];
  const entries: ImportableEntry[] = [];
  const add = (field: string, fieldKey: string, text: string) =>
    entries.push({ key: `publishInfo.${field}`, group: 'publishInfo', fieldKey, text, hrefs: [] });
  if (hasText(info.bookName)) add('bookName', 'description.fields.bookName', info.bookName);
  if (hasText(info.publisher)) add('publisher', 'description.fields.publisher', info.publisher);
  if (hasText(info.city)) add('city', 'description.fields.city', info.city);
  if (hasText(info.year)) add('year', 'description.fields.year', info.year);
  if (hasText(info.isbn)) add('isbn', 'description.fields.isbn', info.isbn);
  if (present(info.sequences)) {
    add('sequences', 'descriptionForm.sequences', join(sequenceTexts(info.sequences)));
  }
  return entries;
}

function customInfoEntries(rows: readonly CustomInfo[]): ImportableEntry[] {
  const entries: ImportableEntry[] = [];
  rows.forEach((row, index) => {
    // Role rows belong to the "Other persons" entry; an empty row is nothing to import.
    if (parseRoleRow(row) !== null || !hasText(row.text)) return;
    entries.push({
      key: `customInfo.${index}`,
      group: 'customInfo',
      fieldText: row.infoType.trim(),
      text: row.text.trim(),
      hrefs: [],
    });
  });
  return entries;
}

/**
 * The entries a `doc.readDescription` answer offers, in the FR-032 order; empty when the
 * file's description has nothing importable.
 */
export function importableEntries(result: ReadDescriptionResult): ImportableEntry[] {
  const { description } = result;
  const binaries = binaryById(result);
  const { roleRows } = splitRoleRows(description.customInfo);
  const entries = [
    ...titleInfoEntries(description.titleInfo, binaries, roleRows),
    ...srcTitleInfoEntry(description.srcTitleInfo, binaries),
    ...documentInfoEntries(description.documentInfo, binaries),
    ...publishInfoEntries(description.publishInfo),
    ...customInfoEntries(description.customInfo),
  ];
  return entries.map((entry) => ({ ...entry, text: truncate(entry.text) }));
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                 */
/* ------------------------------------------------------------------------ */

/** "{{group}}: {{field}}" in the interface language; the group alone when there is no field. */
export function entryLabel(entry: ImportableEntry, t: TFunction): string {
  const group = t(GROUP_KEYS[entry.group]) as string;
  const field =
    entry.fieldText ?? (entry.fieldKey ? (t(entry.fieldKey) as string).replace(/:$/, '') : '');
  if (!field) return group;
  return t('transfer.import.entryLabel', { group, field }) as string;
}

/** The value as plain text (FR-034); a cover as its image's name, size and type, or "no data". */
export function entryValueText(entry: ImportableEntry, t: TFunction): string {
  if (!entry.covers) return entry.text;
  return truncate(
    join(
      entry.covers.map((cover) => {
        const id = cover.href.startsWith('#') ? cover.href.slice(1) : cover.href;
        if (!cover.binary) return t('transfer.import.coverNoData', { id }) as string;
        return t('transfer.import.coverValue', {
          id,
          type: cover.binary.contentType,
          size: cover.binary.size,
        }) as string;
      }),
    ),
  );
}

/* ------------------------------------------------------------------------ */
/* applyEntries                                                              */
/* ------------------------------------------------------------------------ */

type HrefMap = ReadonlyMap<string, string>;

function mapHref(href: string, map: HrefMap): string {
  return map.get(href) ?? href;
}

function mapImages<T>(node: T, map: HrefMap): T {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((child) => mapImages(child, map)) as T;
  const value = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if ((value.type === 'image' || value.type === 'inline-image') && value.attrs) {
    const href = value.attrs.href;
    if (typeof href === 'string') out.attrs = { ...value.attrs, href: mapHref(href, map) };
  }
  if (Array.isArray(value.content)) out.content = value.content.map((c) => mapImages(c, map));
  return out as T;
}

function copyPerson(person: Person): Person {
  return { ...person, homePages: [...person.homePages], emails: [...person.emails] };
}

function copySequence(sequence: Sequence): Sequence {
  return { ...sequence, children: sequence.children.map(copySequence) };
}

function copyCovers(images: readonly ImageRef[], map: HrefMap): ImageRef[] {
  return images.map((image) => ({ ...image, href: mapHref(image.href, map) }));
}

function copyTitleInfo(info: TitleInfo, map: HrefMap): TitleInfo {
  const out: TitleInfo = {
    ...info,
    genres: info.genres.map((genre) => ({ ...genre })),
    authors: info.authors.map(copyPerson),
    coverpage: copyCovers(info.coverpage, map),
    translators: info.translators.map(copyPerson),
    sequences: info.sequences.map(copySequence),
  };
  if (info.annotation) out.annotation = mapImages(info.annotation, map);
  if (info.date) out.date = { ...info.date };
  return out;
}

type TitleField = Exclude<keyof TitleInfo, never>;

function titleValue(info: TitleInfo, field: TitleField, map: HrefMap): unknown {
  switch (field) {
    case 'genres':
      return info.genres.map((genre) => ({ ...genre }));
    case 'authors':
      return info.authors.map(copyPerson);
    case 'translators':
      return info.translators.map(copyPerson);
    case 'sequences':
      return info.sequences.map(copySequence);
    case 'coverpage':
      return copyCovers(info.coverpage, map);
    case 'annotation':
      return info.annotation ? mapImages(info.annotation, map) : undefined;
    case 'date':
      return info.date ? { ...info.date } : undefined;
    default:
      return info[field];
  }
}

const DETAIL_FIELDS = new Set<keyof DocumentInfo>(['id', 'version', 'programUsed', 'date']);

function documentValue(
  info: DocumentInfo,
  details: DocumentInfo,
  field: keyof DocumentInfo,
  map: HrefMap,
): unknown {
  // The four document details come from the filled-in copy (FR-035, 002 FR-005).
  const source = DETAIL_FIELDS.has(field) ? details : info;
  switch (field) {
    case 'authors':
      return source.authors.map(copyPerson);
    case 'publishers':
      return source.publishers.map(copyPerson);
    case 'srcUrls':
      return [...source.srcUrls];
    case 'date':
      return { ...source.date };
    case 'history':
      return source.history ? mapImages(source.history, map) : undefined;
    default:
      return source[field];
  }
}

function publishValue(info: PublishInfo, field: keyof PublishInfo): unknown {
  return field === 'sequences' ? info.sequences.map(copySequence) : info[field];
}

/**
 * Replaces the chosen `keys` of `description` with the file's data (FR-035); unchosen entries
 * keep their very objects. `hrefMap` maps the file's `#id` cover and image references to the
 * ids `binary.copy` stored them under in the document (a reference without a mapping stays).
 */
export function applyEntries(
  description: Description,
  result: ReadDescriptionResult,
  keys: Iterable<string>,
  hrefMap: HrefMap,
): Description {
  const chosen = new Set(keys);
  const source = result.description;
  const out: Description = { ...description };
  let titleInfo: TitleInfo | null = null;
  let documentInfo: DocumentInfo | null = null;
  let publishInfo: PublishInfo | null = null;
  let customInfo: CustomInfo[] | null = null;
  let roles = false;
  const customGroups = new Map<string, CustomInfo[]>();

  for (const key of chosen) {
    if (key.startsWith('titleInfo.')) {
      const field = key.slice('titleInfo.'.length) as TitleField;
      titleInfo ??= { ...description.titleInfo };
      const value = titleValue(source.titleInfo, field, hrefMap);
      if (value === undefined) delete titleInfo[field];
      else (titleInfo as unknown as Record<string, unknown>)[field] = value;
    } else if (key === 'srcTitleInfo') {
      if (source.srcTitleInfo) out.srcTitleInfo = copyTitleInfo(source.srcTitleInfo, hrefMap);
    } else if (key.startsWith('documentInfo.')) {
      const field = key.slice('documentInfo.'.length) as keyof DocumentInfo;
      documentInfo ??= { ...description.documentInfo };
      const value = documentValue(source.documentInfo, result.documentDetails, field, hrefMap);
      if (value === undefined) delete documentInfo[field];
      else (documentInfo as unknown as Record<string, unknown>)[field] = value;
    } else if (key.startsWith('publishInfo.')) {
      const field = key.slice('publishInfo.'.length) as keyof PublishInfo;
      if (!source.publishInfo) continue;
      publishInfo ??= { ...(description.publishInfo ?? { sequences: [] }) };
      const value = publishValue(source.publishInfo, field);
      if (value === undefined) delete publishInfo[field];
      else (publishInfo as unknown as Record<string, unknown>)[field] = value;
    } else if (key === 'roles') {
      roles = true;
    } else if (key.startsWith('customInfo.')) {
      const row = source.customInfo[Number(key.slice('customInfo.'.length))];
      if (!row) continue;
      const type = row.infoType;
      if (!customGroups.has(type)) customGroups.set(type, []);
      customGroups.get(type)!.push({ ...row });
    }
  }

  if (customGroups.size > 0) {
    // The ticked lines of one type together take the place of the document's plain rows of
    // that type (the first row's place, the others dropped); a type the document has not is
    // added after its rows. Role rows of a role type stay: they belong to "Other persons".
    const placed = new Set<string>();
    const next: CustomInfo[] = [];
    for (const row of description.customInfo) {
      const group = customGroups.get(row.infoType);
      if (!group || parseRoleRow(row) !== null) {
        next.push(row);
        continue;
      }
      if (!placed.has(row.infoType)) {
        placed.add(row.infoType);
        next.push(...group);
      }
    }
    for (const [type, group] of customGroups) if (!placed.has(type)) next.push(...group);
    customInfo = next;
  }
  if (roles) {
    // The document's role rows go, the file's come in verbatim - they count as read - after
    // the plain rows, where the library itself puts them (FR-021).
    const { plainRows } = splitRoleRows(customInfo ?? description.customInfo);
    const { roleRows } = splitRoleRows(source.customInfo);
    customInfo = [...plainRows, ...roleRows.map((row) => ({ ...row }))];
  }

  if (titleInfo) out.titleInfo = titleInfo;
  if (documentInfo) out.documentInfo = documentInfo;
  if (publishInfo) out.publishInfo = publishInfo;
  if (customInfo) out.customInfo = customInfo;
  return out;
}
