/**
 * Pure helpers of the Description forms (T071/T077, data-model.md §1.2):
 *
 *  - `cleanDescription()` turns the raw form state (what the user typed, untrimmed, with empty
 *    rows) into the clean model the core serialises: strings trimmed, empty optional fields
 *    dropped (`undefined`), empty persons / sequences / genres / custom rows removed, genre
 *    `match` omitted when 100 (or invalid), `publishInfo` / `srcTitleInfo` omitted when empty;
 *  - the person rule: a person is valid only with (first + last name) or a nickname alone;
 *    completely empty persons are dropped, incomplete ones are kept and flagged;
 *  - `requiredIssues()` lists the required fields that are still empty (genre, author, book
 *    title, language, document author, date, id, version) for the form markers (FR-052);
 *  - `newDocumentId()` (UUID v4 for the "new" ID button), `descriptionExtrasCount()` (preserved
 *    `<output>` elements and unknown description-level elements shown as a read-only note);
 *  - generic path access (`getAtPath` / `setAtPath`) and the ordered list of plain text fields
 *    (`textFields()`) the Find / Replace target works on.
 */

import type {
  CustomInfo,
  DateValue,
  Description,
  Document,
  DocumentInfo,
  GenreRef,
  Person,
  PublishInfo,
  Sequence,
  TitleInfo,
} from '@/model/document';

/* ------------------------------------------------------------------------ */
/* Scalars                                                                  */
/* ------------------------------------------------------------------------ */

/** Trimmed string, or undefined when empty. */
export function cleanText(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : undefined;
}

/** Trimmed list without empty entries. */
export function cleanList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => v.length > 0);
}

/** `match` as the model wants it: an integer 1..99; 100 (the default) or garbage is omitted. */
export function cleanMatch(match: number | string | undefined | null): number | undefined {
  if (match === undefined || match === null || match === '') return undefined;
  const n = typeof match === 'number' ? match : Number.parseInt(String(match), 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return undefined;
  return n === 100 ? undefined : Math.trunc(n);
}

/** Sequence number: a non-negative integer or undefined. */
export function cleanNumber(value: number | string | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.trunc(n);
}

/* ------------------------------------------------------------------------ */
/* Persons                                                                  */
/* ------------------------------------------------------------------------ */

/** True when every field of the person is empty (such a person is dropped). */
export function personEmpty(person: Person): boolean {
  return (
    !cleanText(person.firstName) &&
    !cleanText(person.middleName) &&
    !cleanText(person.lastName) &&
    !cleanText(person.nickname) &&
    cleanList(person.homePages).length === 0 &&
    cleanList(person.emails).length === 0 &&
    !cleanText(person.id)
  );
}

/**
 * The FB2 `authorType` choice: either first name + last name (middle name and nickname
 * optional) or a nickname alone (no name parts).
 */
export function personComplete(person: Person): boolean {
  const first = !!cleanText(person.firstName);
  const middle = !!cleanText(person.middleName);
  const last = !!cleanText(person.lastName);
  const nick = !!cleanText(person.nickname);
  return (first && last) || (nick && !first && !middle && !last);
}

/** Trimmed person without empty fields, or null when the person is completely empty. */
export function cleanPerson(person: Person): Person | null {
  if (personEmpty(person)) return null;
  const out: Person = { homePages: cleanList(person.homePages), emails: cleanList(person.emails) };
  const first = cleanText(person.firstName);
  const middle = cleanText(person.middleName);
  const last = cleanText(person.lastName);
  const nick = cleanText(person.nickname);
  const id = cleanText(person.id);
  if (first) out.firstName = first;
  if (middle) out.middleName = middle;
  if (last) out.lastName = last;
  if (nick) out.nickname = nick;
  if (id) out.id = id;
  return out;
}

export function cleanPersons(list: readonly Person[] | undefined): Person[] {
  const out: Person[] = [];
  for (const person of list ?? []) {
    const cleaned = cleanPerson(person);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** An empty person row for the forms. */
export function emptyPerson(): Person {
  return { homePages: [], emails: [] };
}

/* ------------------------------------------------------------------------ */
/* Sequences, genres, dates, custom info                                    */
/* ------------------------------------------------------------------------ */

/**
 * Trimmed sequence with cleaned children; null when it has no name and no (non-empty)
 * children. A named-less sequence that still has children is kept so nothing is lost (the
 * form flags its missing name).
 */
export function cleanSequence(sequence: Sequence): Sequence | null {
  const name = (sequence.name ?? '').trim();
  const children = cleanSequences(sequence.children);
  if (!name && children.length === 0) return null;
  const out: Sequence = { name, children };
  const number = cleanNumber(sequence.number);
  if (number !== undefined) out.number = number;
  const lang = cleanText(sequence.lang);
  if (lang) out.lang = lang;
  return out;
}

export function cleanSequences(list: readonly Sequence[] | undefined): Sequence[] {
  const out: Sequence[] = [];
  for (const sequence of list ?? []) {
    const cleaned = cleanSequence(sequence);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

export function emptySequence(): Sequence {
  return { name: '', children: [] };
}

export function cleanGenre(genre: GenreRef): GenreRef | null {
  const code = (genre.code ?? '').trim();
  if (!code) return null;
  const out: GenreRef = { code };
  const match = cleanMatch(genre.match);
  if (match !== undefined) out.match = match;
  return out;
}

export function cleanGenres(list: readonly GenreRef[] | undefined): GenreRef[] {
  const out: GenreRef[] = [];
  for (const genre of list ?? []) {
    const cleaned = cleanGenre(genre);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Trimmed date; undefined when both the text and the ISO value are empty. */
export function cleanDate(date: DateValue | undefined): DateValue | undefined {
  if (!date) return undefined;
  const text = (date.text ?? '').trim();
  const value = cleanText(date.value);
  const lang = cleanText(date.lang);
  if (!text && !value) return undefined;
  const out: DateValue = { text };
  if (value) out.value = value;
  if (lang) out.lang = lang;
  return out;
}

/** `YYYY-MM-DD` of a local date (the "Today" button). */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO `YYYY-MM-DD` check for the date value field marker. */
export function isIsoDate(value: string | undefined): boolean {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export function cleanCustomInfo(list: readonly CustomInfo[] | undefined): CustomInfo[] {
  const out: CustomInfo[] = [];
  for (const info of list ?? []) {
    const infoType = (info.infoType ?? '').trim();
    const text = (info.text ?? '').trim();
    if (!infoType && !text) continue;
    const cleaned: CustomInfo = { infoType, text };
    const lang = cleanText(info.lang);
    if (lang) cleaned.lang = lang;
    out.push(cleaned);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Info blocks                                                              */
/* ------------------------------------------------------------------------ */

export function cleanTitleInfo(info: TitleInfo): TitleInfo {
  const out: TitleInfo = {
    genres: cleanGenres(info.genres),
    authors: cleanPersons(info.authors),
    bookTitle: (info.bookTitle ?? '').trim(),
    coverpage: (info.coverpage ?? [])
      .filter((ref) => (ref.href ?? '').trim().length > 0)
      .map((ref) => {
        const image: TitleInfo['coverpage'][number] = { href: ref.href.trim() };
        const alt = cleanText(ref.alt);
        const title = cleanText(ref.title);
        const id = cleanText(ref.id);
        if (alt) image.alt = alt;
        if (title) image.title = title;
        if (id) image.id = id;
        return image;
      }),
    lang: (info.lang ?? '').trim(),
    translators: cleanPersons(info.translators),
    sequences: cleanSequences(info.sequences),
  };
  if (info.annotation && info.annotation.content.length > 0) out.annotation = info.annotation;
  const keywords = cleanText(info.keywords);
  if (keywords) out.keywords = keywords;
  const date = cleanDate(info.date);
  if (date) out.date = date;
  const srcLang = cleanText(info.srcLang);
  if (srcLang) out.srcLang = srcLang;
  return out;
}

/** True when nothing at all was entered in a title-info block (src-title-info is then omitted). */
export function titleInfoEmpty(info: TitleInfo): boolean {
  const cleaned = cleanTitleInfo(info);
  return (
    cleaned.genres.length === 0 &&
    cleaned.authors.length === 0 &&
    !cleaned.bookTitle &&
    !cleaned.annotation &&
    !cleaned.keywords &&
    !cleaned.date &&
    cleaned.coverpage.length === 0 &&
    !cleaned.lang &&
    !cleaned.srcLang &&
    cleaned.translators.length === 0 &&
    cleaned.sequences.length === 0
  );
}

export function cleanDocumentInfo(info: DocumentInfo): DocumentInfo {
  const out: DocumentInfo = {
    authors: cleanPersons(info.authors),
    date: cleanDate(info.date) ?? { text: '' },
    srcUrls: cleanList(info.srcUrls),
    id: (info.id ?? '').trim(),
    version: (info.version ?? '').trim(),
    publishers: cleanPersons(info.publishers),
  };
  const programUsed = cleanText(info.programUsed);
  if (programUsed) out.programUsed = programUsed;
  const srcOcr = cleanText(info.srcOcr);
  if (srcOcr) out.srcOcr = srcOcr;
  if (info.history && info.history.content.length > 0) out.history = info.history;
  return out;
}

export function cleanPublishInfo(info: PublishInfo | undefined): PublishInfo | undefined {
  if (!info) return undefined;
  const out: PublishInfo = { sequences: cleanSequences(info.sequences) };
  const bookName = cleanText(info.bookName);
  const publisher = cleanText(info.publisher);
  const city = cleanText(info.city);
  const year = cleanText(info.year);
  const isbn = cleanText(info.isbn);
  if (bookName) out.bookName = bookName;
  if (publisher) out.publisher = publisher;
  if (city) out.city = city;
  if (year) out.year = year;
  if (isbn) out.isbn = isbn;
  if (!bookName && !publisher && !city && !year && !isbn && out.sequences.length === 0) {
    return undefined;
  }
  return out;
}

/** The clean model of a raw form state (what is handed to `actions.updateDocument`). */
export function cleanDescription(form: Description): Description {
  const out: Description = {
    titleInfo: cleanTitleInfo(form.titleInfo),
    documentInfo: cleanDocumentInfo(form.documentInfo),
    customInfo: cleanCustomInfo(form.customInfo),
    outputs: form.outputs ?? [],
  };
  if (form.srcTitleInfo && !titleInfoEmpty(form.srcTitleInfo)) {
    out.srcTitleInfo = cleanTitleInfo(form.srcTitleInfo);
  }
  const publishInfo = cleanPublishInfo(form.publishInfo);
  if (publishInfo) out.publishInfo = publishInfo;
  return out;
}

/* ------------------------------------------------------------------------ */
/* Form state                                                               */
/* ------------------------------------------------------------------------ */

export function emptyTitleInfo(): TitleInfo {
  return {
    genres: [],
    authors: [],
    bookTitle: '',
    coverpage: [],
    lang: '',
    translators: [],
    sequences: [],
  };
}

export function emptyPublishInfo(): PublishInfo {
  return { sequences: [] };
}

/**
 * Form state from the model: every optional block/array present so the forms can bind to it
 * (`srcTitleInfo` stays undefined until the user opens the block; `publishInfo` is created).
 */
export function formFromDescription(description: Description): Description {
  const title = description.titleInfo;
  const doc = description.documentInfo;
  return {
    titleInfo: {
      ...emptyTitleInfo(),
      ...title,
      genres: [...title.genres],
      authors: title.authors.map(copyPerson),
      coverpage: title.coverpage.map((ref) => ({ ...ref })),
      translators: title.translators.map(copyPerson),
      sequences: title.sequences.map(copySequence),
    },
    srcTitleInfo: description.srcTitleInfo
      ? {
          ...emptyTitleInfo(),
          ...description.srcTitleInfo,
          genres: [...description.srcTitleInfo.genres],
          authors: description.srcTitleInfo.authors.map(copyPerson),
          coverpage: description.srcTitleInfo.coverpage.map((ref) => ({ ...ref })),
          translators: description.srcTitleInfo.translators.map(copyPerson),
          sequences: description.srcTitleInfo.sequences.map(copySequence),
        }
      : undefined,
    documentInfo: {
      ...doc,
      authors: doc.authors.map(copyPerson),
      date: { ...doc.date },
      srcUrls: [...doc.srcUrls],
      publishers: doc.publishers.map(copyPerson),
    },
    publishInfo: {
      ...emptyPublishInfo(),
      ...description.publishInfo,
      sequences: (description.publishInfo?.sequences ?? []).map(copySequence),
    },
    customInfo: description.customInfo.map((info) => ({ ...info })),
    outputs: description.outputs,
  };
}

function copyPerson(person: Person): Person {
  return { ...person, homePages: [...person.homePages], emails: [...person.emails] };
}

function copySequence(sequence: Sequence): Sequence {
  return { ...sequence, children: sequence.children.map(copySequence) };
}

/* ------------------------------------------------------------------------ */
/* Required fields (FR-052)                                                 */
/* ------------------------------------------------------------------------ */

export type RequiredField =
  | 'titleInfo.genres'
  | 'titleInfo.authors'
  | 'titleInfo.bookTitle'
  | 'titleInfo.lang'
  | 'documentInfo.authors'
  | 'documentInfo.date'
  | 'documentInfo.id'
  | 'documentInfo.version';

export interface RequiredIssues {
  /** Required fields that are empty. */
  missing: Set<RequiredField>;
  /** Field keys of persons that are neither empty nor complete (first+last or nickname). */
  incompletePersons: Set<string>;
  /** Field keys of sequences without a name (but with children). */
  unnamedSequences: Set<string>;
  /** Field keys of custom-info rows without a type. */
  untypedCustomInfo: Set<string>;
  /** Field keys of date values that are not `YYYY-MM-DD`. */
  invalidDates: Set<string>;
}

export function requiredIssues(form: Description): RequiredIssues {
  const missing = new Set<RequiredField>();
  const incompletePersons = new Set<string>();
  const unnamedSequences = new Set<string>();
  const untypedCustomInfo = new Set<string>();
  const invalidDates = new Set<string>();
  const title = form.titleInfo;
  const doc = form.documentInfo;

  if (cleanGenres(title.genres).length === 0) missing.add('titleInfo.genres');
  if (cleanPersons(title.authors).filter(personComplete).length === 0) {
    missing.add('titleInfo.authors');
  }
  if (!title.bookTitle.trim()) missing.add('titleInfo.bookTitle');
  if (!title.lang.trim()) missing.add('titleInfo.lang');
  if (cleanPersons(doc.authors).filter(personComplete).length === 0) {
    missing.add('documentInfo.authors');
  }
  if (!cleanDate(doc.date)) missing.add('documentInfo.date');
  if (!doc.id.trim()) missing.add('documentInfo.id');
  if (!doc.version.trim()) missing.add('documentInfo.version');

  const persons = (key: string, list: Person[]) => {
    list.forEach((person, index) => {
      if (!personEmpty(person) && !personComplete(person)) incompletePersons.add(`${key}.${index}`);
    });
  };
  const sequences = (key: string, list: Sequence[]) => {
    list.forEach((sequence, index) => {
      const own = `${key}.${index}`;
      if (!sequence.name.trim() && cleanSequences(sequence.children).length > 0) {
        unnamedSequences.add(own);
      }
      sequences(`${own}.children`, sequence.children);
    });
  };
  const titleBlock = (key: string, info: TitleInfo) => {
    persons(`${key}.authors`, info.authors);
    persons(`${key}.translators`, info.translators);
    sequences(`${key}.sequences`, info.sequences);
    if (info.date && !isIsoDate(info.date.value)) invalidDates.add(`${key}.date.value`);
  };
  titleBlock('titleInfo', title);
  if (form.srcTitleInfo) titleBlock('srcTitleInfo', form.srcTitleInfo);
  persons('documentInfo.authors', doc.authors);
  persons('documentInfo.publishers', doc.publishers);
  if (!isIsoDate(doc.date.value)) invalidDates.add('documentInfo.date.value');
  sequences('publishInfo.sequences', form.publishInfo?.sequences ?? []);
  form.customInfo.forEach((info, index) => {
    if (!info.infoType.trim() && info.text.trim()) untypedCustomInfo.add(`customInfo.${index}`);
  });

  return { missing, incompletePersons, unnamedSequences, untypedCustomInfo, invalidDates };
}

/* ------------------------------------------------------------------------ */
/* Ids and extras                                                           */
/* ------------------------------------------------------------------------ */

/** UUID v4 (the id format of new documents, data-model.md §1.2). */
export function newDocumentId(random: () => number = Math.random): string {
  const cryptoApi = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function' && random === Math.random) {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Description-level slots of preserved unknown elements (`extras[].attrs.slot`). */
const DESCRIPTION_SLOTS = new Set([
  'description',
  'title-info',
  'src-title-info',
  'document-info',
  'publish-info',
]);

/** Preserved `<output>` elements plus unknown description-level elements (read-only note). */
export function descriptionExtrasCount(document: Pick<Document, 'description' | 'extras'>): number {
  const outputs = document.description.outputs?.length ?? 0;
  const extras = (document.extras ?? []).filter((node) => {
    const slot = (node.attrs as { slot?: unknown } | undefined)?.slot;
    return typeof slot === 'string' && DESCRIPTION_SLOTS.has(slot);
  }).length;
  return outputs + extras;
}

/* ------------------------------------------------------------------------ */
/* Paths and text fields                                                    */
/* ------------------------------------------------------------------------ */

/** A field key is a dot path into the form state, e.g. `titleInfo.authors.0.firstName`. */
export type FieldKey = string;

type Indexable = Record<string, unknown> | unknown[];

function isIndexable(value: unknown): value is Indexable {
  return typeof value === 'object' && value !== null;
}

export function getAtPath(root: unknown, key: FieldKey): unknown {
  let current: unknown = root;
  for (const part of key.split('.')) {
    if (!isIndexable(current)) return undefined;
    current = Array.isArray(current) ? current[Number(part)] : current[part];
  }
  return current;
}

/** Immutable update: copies every container along the path, creating missing objects. */
export function setAtPath<T>(root: T, key: FieldKey, value: unknown): T {
  const parts = key.split('.');
  const update = (node: unknown, index: number): unknown => {
    if (index === parts.length) return value;
    const part = parts[index]!;
    const nextIsIndex = /^\d+$/.test(parts[index + 1] ?? '');
    if (Array.isArray(node)) {
      const copy = [...node];
      copy[Number(part)] = update(node[Number(part)], index + 1);
      return copy;
    }
    const object = isIndexable(node) ? { ...(node as Record<string, unknown>) } : {};
    const child = isIndexable(node) ? (node as Record<string, unknown>)[part] : undefined;
    object[part] = update(child ?? (nextIsIndex ? [] : undefined), index + 1);
    return object;
  };
  return update(root, 0) as T;
}

export interface TextField {
  key: FieldKey;
  value: string;
}

function personFields(key: string, person: Person, out: TextField[]): void {
  out.push({ key: `${key}.firstName`, value: person.firstName ?? '' });
  out.push({ key: `${key}.middleName`, value: person.middleName ?? '' });
  out.push({ key: `${key}.lastName`, value: person.lastName ?? '' });
  out.push({ key: `${key}.nickname`, value: person.nickname ?? '' });
  person.homePages.forEach((value, i) => out.push({ key: `${key}.homePages.${i}`, value }));
  person.emails.forEach((value, i) => out.push({ key: `${key}.emails.${i}`, value }));
}

function sequenceFields(key: string, sequence: Sequence, out: TextField[]): void {
  out.push({ key: `${key}.name`, value: sequence.name });
  sequence.children.forEach((child, i) => sequenceFields(`${key}.children.${i}`, child, out));
}

function titleInfoFields(key: string, info: TitleInfo, out: TextField[]): void {
  info.authors.forEach((person, i) => personFields(`${key}.authors.${i}`, person, out));
  out.push({ key: `${key}.bookTitle`, value: info.bookTitle });
  out.push({ key: `${key}.keywords`, value: info.keywords ?? '' });
  out.push({ key: `${key}.date.text`, value: info.date?.text ?? '' });
  info.translators.forEach((person, i) => personFields(`${key}.translators.${i}`, person, out));
  info.sequences.forEach((sequence, i) => sequenceFields(`${key}.sequences.${i}`, sequence, out));
}

/**
 * Every plain text field of the form in document order (the Find / Replace scope of the
 * Description view, FR-035). Rich fields (annotation, history) and codes (genres, languages)
 * are not part of it.
 */
export function textFields(form: Description): TextField[] {
  const out: TextField[] = [];
  titleInfoFields('titleInfo', form.titleInfo, out);
  if (form.srcTitleInfo) titleInfoFields('srcTitleInfo', form.srcTitleInfo, out);
  const doc = form.documentInfo;
  doc.authors.forEach((person, i) => personFields(`documentInfo.authors.${i}`, person, out));
  out.push({ key: 'documentInfo.programUsed', value: doc.programUsed ?? '' });
  out.push({ key: 'documentInfo.date.text', value: doc.date.text });
  doc.srcUrls.forEach((value, i) => out.push({ key: `documentInfo.srcUrls.${i}`, value }));
  out.push({ key: 'documentInfo.srcOcr', value: doc.srcOcr ?? '' });
  out.push({ key: 'documentInfo.id', value: doc.id });
  out.push({ key: 'documentInfo.version', value: doc.version });
  doc.publishers.forEach((person, i) => personFields(`documentInfo.publishers.${i}`, person, out));
  const pub = form.publishInfo;
  if (pub) {
    out.push({ key: 'publishInfo.bookName', value: pub.bookName ?? '' });
    out.push({ key: 'publishInfo.publisher', value: pub.publisher ?? '' });
    out.push({ key: 'publishInfo.city', value: pub.city ?? '' });
    out.push({ key: 'publishInfo.year', value: pub.year ?? '' });
    out.push({ key: 'publishInfo.isbn', value: pub.isbn ?? '' });
    pub.sequences.forEach((sequence, i) =>
      sequenceFields(`publishInfo.sequences.${i}`, sequence, out),
    );
  }
  form.customInfo.forEach((info, i) => {
    out.push({ key: `customInfo.${i}.infoType`, value: info.infoType });
    out.push({ key: `customInfo.${i}.text`, value: info.text });
  });
  return out;
}
