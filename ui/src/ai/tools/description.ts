/**
 * The partial merge of `set_description` (feature 005 T054; ai-catalogue §3.3; data-model
 * §6.3; review C14; open point 1 of the contract): **one level deep** - a given top-level block
 * (`titleInfo`, `srcTitleInfo`, `documentInfo`, `publishInfo`) is merged member by member into
 * the existing block (members given replace the existing value, members absent stay; the lists
 * `genres`, `authors`, `translators`, `sequences`, `coverpage`, `srcUrls`, `homePages`, `emails`,
 * `publishers` replace whole); `customInfo` and `outputs` replace whole; `annotation` /
 * `history` are given as `{xml}` (parsed with `parent: {element: 'annotation' | 'history'}`) or
 * `null` to remove; `srcTitleInfo: null` / `publishInfo: null` remove the block; `titleInfo`
 * and `documentInfo` cannot be removed. Unknown members are refused with the valid ones named
 * (FR-054). The merge also lists the **dotted fields written** (`titleInfo.genres`,
 * `documentInfo.history`, …) for the activity entry - the fields, never their values (C14).
 * Validation of the merged description is the hook's (US4 scenario 5).
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import type {
  AnnotationNode,
  CustomInfo,
  DateValue,
  Description,
  DocumentInfo,
  GenreRef,
  ImageRef,
  Person,
  PublishInfo,
  RawXmlNode,
  Sequence,
  TitleInfo,
} from '@/model/document';

/** Refuses the patch: the caller throws its own error type (`invalidArguments`). */
export type PatchFailure = (
  message: string,
  extra?: { hint?: string; expected?: unknown },
) => never;

export interface MergeDeps {
  /** `doc.fragmentFromXml` with `parent: {element}`; the nodes come back without ids. */
  parseXml(xml: string, element: 'annotation' | 'history'): Promise<ModelNodeJson[]>;
  /** The request's `sc_<N>` allocator (review C12). */
  nextNodeId(): string;
  fail: PatchFailure;
}

export interface DescriptionMerge {
  description: Description;
  /** The dotted fields the patch writes, in the patch's order (`titleInfo.genres`, `outputs`, …). */
  fields: string[];
}

const TOP_MEMBERS = [
  'titleInfo',
  'srcTitleInfo',
  'documentInfo',
  'publishInfo',
  'customInfo',
  'outputs',
] as const;
const TITLE_INFO_MEMBERS = [
  'genres',
  'authors',
  'bookTitle',
  'annotation',
  'keywords',
  'date',
  'coverpage',
  'lang',
  'srcLang',
  'translators',
  'sequences',
] as const;
const DOCUMENT_INFO_MEMBERS = [
  'authors',
  'programUsed',
  'date',
  'srcUrls',
  'srcOcr',
  'id',
  'version',
  'history',
  'publishers',
] as const;
const PUBLISH_INFO_MEMBERS = [
  'bookName',
  'publisher',
  'city',
  'year',
  'isbn',
  'sequences',
] as const;
const PERSON_MEMBERS = [
  'firstName',
  'middleName',
  'lastName',
  'nickname',
  'homePages',
  'emails',
  'id',
] as const;

/** The shape the model is told when a member is wrong (`expected` of the envelope). */
export const DESCRIPTION_SHAPE = {
  titleInfo: {
    genres: [{ code: 'sf', match: 100 }],
    authors: [
      { firstName: '', middleName: '', lastName: '', nickname: '', homePages: [], emails: [] },
    ],
    bookTitle: '',
    annotation: { xml: '<p>…</p>' },
    keywords: '',
    date: { text: '', value: 'YYYY-MM-DD' },
    coverpage: [{ href: '#cover.jpg' }],
    lang: 'en',
    srcLang: '',
    translators: [],
    sequences: [{ name: '', number: 1 }],
  },
  srcTitleInfo: '(as titleInfo) or null to remove',
  documentInfo: {
    authors: [{ nickname: '', homePages: [], emails: [] }],
    programUsed: '',
    date: { text: '', value: 'YYYY-MM-DD' },
    srcUrls: [''],
    srcOcr: '',
    id: '',
    version: '1.0',
    history: { xml: '<p>…</p>' },
    publishers: [],
  },
  publishInfo: {
    bookName: '',
    publisher: '',
    city: '',
    year: '',
    isbn: '',
    sequences: [{ name: '', number: 1 }],
  },
  customInfo: [{ infoType: '', text: '', lang: '' }],
  outputs: [{ xml: '<output …/>' }],
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merges `patch` (the tool's `description` argument) into `current`. Throws through
 * `deps.fail` for a wrong shape; the `{xml}` parses may throw the core's errors (the caller
 * maps them to `invalidXml` / `fragmentNotAllowed`).
 */
export async function mergeDescription(
  current: Description,
  patch: unknown,
  deps: MergeDeps,
): Promise<DescriptionMerge> {
  const fail: PatchFailure = deps.fail;
  if (!isObject(patch)) {
    fail('description must be an object holding the members to change', {
      expected: DESCRIPTION_SHAPE,
    });
  }
  const unknown = Object.keys(patch).filter(
    (key) => !(TOP_MEMBERS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    fail(`unknown description member(s): ${unknown.join(', ')}`, {
      hint: `The members are ${TOP_MEMBERS.join(', ')}; a title-info member such as bookTitle goes inside titleInfo.`,
      expected: DESCRIPTION_SHAPE,
    });
  }
  if (Object.keys(patch).length === 0) {
    fail('description holds nothing to change', { expected: DESCRIPTION_SHAPE });
  }
  const fields: string[] = [];
  let next: Description = { ...current };
  // The members in the patch's order: the `fields` list follows it (the activity entry).
  for (const [key, value] of Object.entries(patch)) {
    switch (key as (typeof TOP_MEMBERS)[number]) {
      case 'titleInfo':
        if (value === null) fail('titleInfo cannot be removed; give the members to change');
        next.titleInfo = await mergeTitleInfo(current.titleInfo, value, 'titleInfo', deps, fields);
        break;
      case 'srcTitleInfo':
        if (value === null) {
          const { srcTitleInfo: _removed, ...rest } = next;
          void _removed;
          next = rest;
          fields.push('srcTitleInfo');
        } else {
          const base: TitleInfo = current.srcTitleInfo ?? {
            genres: [],
            authors: [],
            bookTitle: '',
            coverpage: [],
            lang: '',
            translators: [],
            sequences: [],
          };
          next.srcTitleInfo = await mergeTitleInfo(base, value, 'srcTitleInfo', deps, fields);
        }
        break;
      case 'documentInfo':
        if (value === null) fail('documentInfo cannot be removed; give the members to change');
        next.documentInfo = await mergeDocumentInfo(current.documentInfo, value, deps, fields);
        break;
      case 'publishInfo':
        if (value === null) {
          const { publishInfo: _removed, ...rest } = next;
          void _removed;
          next = rest;
          fields.push('publishInfo');
        } else {
          next.publishInfo = mergePublishInfo(
            current.publishInfo ?? { sequences: [] },
            value,
            fail,
            fields,
          );
        }
        break;
      case 'customInfo':
        next.customInfo = customInfoList(value, fail);
        fields.push('customInfo');
        break;
      case 'outputs':
        next.outputs = outputsList(value, deps);
        fields.push('outputs');
        break;
    }
  }
  return { description: next, fields };
}

/* ------------------------------------------------------------------------ */
/* Blocks                                                                   */
/* ------------------------------------------------------------------------ */

function members(
  value: unknown,
  block: string,
  allowed: readonly string[],
  fail: PatchFailure,
): Json {
  if (!isObject(value)) {
    fail(`${block} must be an object holding the members to change`, {
      expected:
        (DESCRIPTION_SHAPE as Record<string, unknown>)[block] ?? DESCRIPTION_SHAPE.titleInfo,
    });
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(`unknown ${block} member(s): ${unknown.join(', ')}`, {
      hint: `The members of ${block} are ${allowed.join(', ')}.`,
    });
  }
  if (Object.keys(value).length === 0) fail(`${block} holds nothing to change`);
  return value;
}

async function mergeTitleInfo(
  current: TitleInfo,
  value: unknown,
  block: 'titleInfo' | 'srcTitleInfo',
  deps: MergeDeps,
  fields: string[],
): Promise<TitleInfo> {
  const fail: PatchFailure = deps.fail;
  const given = members(value, block, TITLE_INFO_MEMBERS, fail);
  const out: TitleInfo = { ...current };
  for (const [key, raw] of Object.entries(given)) {
    const field = `${block}.${key}`;
    switch (key as (typeof TITLE_INFO_MEMBERS)[number]) {
      case 'genres':
        out.genres = genreList(raw, field, fail);
        break;
      case 'authors':
        out.authors = personList(raw, field, fail);
        break;
      case 'translators':
        out.translators = personList(raw, field, fail);
        break;
      case 'bookTitle':
        out.bookTitle = requiredString(raw, field, fail);
        break;
      case 'lang':
        out.lang = requiredString(raw, field, fail);
        break;
      case 'keywords':
        setOptional(out, 'keywords', optionalString(raw, field, fail));
        break;
      case 'srcLang':
        setOptional(out, 'srcLang', optionalString(raw, field, fail));
        break;
      case 'date':
        setOptional(out, 'date', dateValue(raw, field, fail));
        break;
      case 'coverpage':
        out.coverpage = imageList(raw, field, fail);
        break;
      case 'sequences':
        out.sequences = sequenceList(raw, field, fail);
        break;
      case 'annotation':
        setOptional(
          out,
          'annotation',
          await xmlBlock(raw, field, 'annotation', current.annotation, deps),
        );
        break;
    }
    fields.push(field);
  }
  return out;
}

async function mergeDocumentInfo(
  current: DocumentInfo,
  value: unknown,
  deps: MergeDeps,
  fields: string[],
): Promise<DocumentInfo> {
  const fail: PatchFailure = deps.fail;
  const given = members(value, 'documentInfo', DOCUMENT_INFO_MEMBERS, fail);
  const out: DocumentInfo = { ...current };
  for (const [key, raw] of Object.entries(given)) {
    const field = `documentInfo.${key}`;
    switch (key as (typeof DOCUMENT_INFO_MEMBERS)[number]) {
      case 'authors':
        out.authors = personList(raw, field, fail);
        break;
      case 'publishers':
        out.publishers = personList(raw, field, fail);
        break;
      case 'programUsed':
        setOptional(out, 'programUsed', optionalString(raw, field, fail));
        break;
      case 'srcOcr':
        setOptional(out, 'srcOcr', optionalString(raw, field, fail));
        break;
      case 'date': {
        const date = dateValue(raw, field, fail);
        if (!date) fail(`${field} cannot be removed`);
        out.date = date;
        break;
      }
      case 'srcUrls':
        out.srcUrls = stringList(raw, field, fail);
        break;
      case 'id':
        out.id = requiredString(raw, field, fail);
        break;
      case 'version':
        out.version = requiredString(raw, field, fail);
        break;
      case 'history':
        setOptional(out, 'history', await xmlBlock(raw, field, 'history', current.history, deps));
        break;
    }
    fields.push(field);
  }
  return out;
}

function mergePublishInfo(
  current: PublishInfo,
  value: unknown,
  fail: PatchFailure,
  fields: string[],
): PublishInfo {
  const given = members(value, 'publishInfo', PUBLISH_INFO_MEMBERS, fail);
  const out: PublishInfo = { ...current };
  for (const [key, raw] of Object.entries(given)) {
    const field = `publishInfo.${key}`;
    if (key === 'sequences') out.sequences = sequenceList(raw, field, fail);
    else {
      setOptional(
        out,
        key as Exclude<(typeof PUBLISH_INFO_MEMBERS)[number], 'sequences'>,
        optionalString(raw, field, fail),
      );
    }
    fields.push(field);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Members                                                                  */
/* ------------------------------------------------------------------------ */

function setOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function requiredString(value: unknown, field: string, fail: PatchFailure): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(`${field} must be a string`);
}

/** A string member that `null` removes. */
function optionalString(value: unknown, field: string, fail: PatchFailure): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value, field, fail);
}

function stringList(value: unknown, field: string, fail: PatchFailure): string[] {
  if (!Array.isArray(value)) return fail(`${field} must be a list of strings`);
  return value.map((item, i) => requiredString(item, `${field}[${i}]`, fail));
}

function dateValue(value: unknown, field: string, fail: PatchFailure): DateValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { text, value: text } : { text };
  }
  if (!isObject(value)) return fail(`${field} must be {text, value?, lang?} or a string`);
  const out: DateValue = {
    text: requiredString(value.text ?? value.value ?? '', `${field}.text`, fail),
  };
  const iso = optionalString(value.value, `${field}.value`, fail);
  if (iso !== undefined) out.value = iso;
  const lang = optionalString(value.lang, `${field}.lang`, fail);
  if (lang !== undefined) out.lang = lang;
  return out;
}

function genreList(value: unknown, field: string, fail: PatchFailure): GenreRef[] {
  if (!Array.isArray(value)) {
    return fail(`${field} must be a list of {code, match?} (or genre codes)`, {
      expected: DESCRIPTION_SHAPE.titleInfo.genres,
    });
  }
  return value.map((item, i) => {
    if (typeof item === 'string') return { code: item };
    if (!isObject(item) || typeof item.code !== 'string') {
      return fail(`${field}[${i}] must be {code, match?} or a genre code`, {
        expected: DESCRIPTION_SHAPE.titleInfo.genres,
      });
    }
    const genre: GenreRef = { code: item.code };
    if (item.match !== undefined && item.match !== null) {
      const match = Number(item.match);
      if (!Number.isFinite(match)) return fail(`${field}[${i}].match must be a number 1–100`);
      genre.match = match;
    }
    return genre;
  });
}

function person(value: unknown, field: string, fail: PatchFailure): Person {
  if (!isObject(value)) {
    return fail(`${field} must be a person object`, {
      expected: DESCRIPTION_SHAPE.titleInfo.authors[0],
    });
  }
  const unknown = Object.keys(value).filter(
    (key) => !(PERSON_MEMBERS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    return fail(`unknown ${field} member(s): ${unknown.join(', ')}`, {
      hint: `A person has ${PERSON_MEMBERS.join(', ')}.`,
      expected: DESCRIPTION_SHAPE.titleInfo.authors[0],
    });
  }
  const out: Person = {
    homePages:
      value.homePages === undefined ? [] : stringList(value.homePages, `${field}.homePages`, fail),
    emails: value.emails === undefined ? [] : stringList(value.emails, `${field}.emails`, fail),
  };
  for (const key of ['firstName', 'middleName', 'lastName', 'nickname', 'id'] as const) {
    const text = optionalString(value[key], `${field}.${key}`, fail);
    if (text !== undefined) out[key] = text;
  }
  return out;
}

function personList(value: unknown, field: string, fail: PatchFailure): Person[] {
  if (!Array.isArray(value)) {
    return fail(`${field} must be a list of persons`, {
      expected: DESCRIPTION_SHAPE.titleInfo.authors,
    });
  }
  return value.map((item, i) => person(item, `${field}[${i}]`, fail));
}

function sequence(value: unknown, field: string, fail: PatchFailure): Sequence {
  if (!isObject(value) || typeof value.name !== 'string') {
    return fail(`${field} must be {name, number?, lang?, children?}`, {
      expected: DESCRIPTION_SHAPE.titleInfo.sequences[0],
    });
  }
  const out: Sequence = {
    name: value.name,
    children:
      value.children === undefined ? [] : sequenceList(value.children, `${field}.children`, fail),
  };
  if (value.number !== undefined && value.number !== null) {
    const number = Number(value.number);
    if (!Number.isFinite(number)) return fail(`${field}.number must be a number`);
    out.number = number;
  }
  const lang = optionalString(value.lang, `${field}.lang`, fail);
  if (lang !== undefined) out.lang = lang;
  return out;
}

function sequenceList(value: unknown, field: string, fail: PatchFailure): Sequence[] {
  if (!Array.isArray(value)) {
    return fail(`${field} must be a list of sequences`, {
      expected: DESCRIPTION_SHAPE.titleInfo.sequences,
    });
  }
  return value.map((item, i) => sequence(item, `${field}[${i}]`, fail));
}

function imageList(value: unknown, field: string, fail: PatchFailure): ImageRef[] {
  if (!Array.isArray(value)) {
    return fail(`${field} must be a list of {href, alt?, title?, id?}`, {
      expected: DESCRIPTION_SHAPE.titleInfo.coverpage,
    });
  }
  return value.map((item, i) => {
    if (typeof item === 'string') return { href: item };
    if (!isObject(item) || typeof item.href !== 'string') {
      return fail(`${field}[${i}] must be {href, alt?, title?, id?}`, {
        expected: DESCRIPTION_SHAPE.titleInfo.coverpage,
      });
    }
    const out: ImageRef = { href: item.href };
    for (const key of ['alt', 'title', 'id'] as const) {
      const text = optionalString(item[key], `${field}[${i}].${key}`, fail);
      if (text !== undefined) out[key] = text;
    }
    return out;
  });
}

function customInfoList(value: unknown, fail: PatchFailure): CustomInfo[] {
  if (!Array.isArray(value)) {
    return fail('customInfo must be a list of {infoType, text, lang?}', {
      expected: DESCRIPTION_SHAPE.customInfo,
    });
  }
  return value.map((item, i) => {
    if (!isObject(item) || typeof item.infoType !== 'string') {
      return fail(`customInfo[${i}] must be {infoType, text, lang?}`, {
        expected: DESCRIPTION_SHAPE.customInfo,
      });
    }
    const out: CustomInfo = {
      infoType: item.infoType,
      text: requiredString(item.text ?? '', `customInfo[${i}].text`, fail),
    };
    const lang = optionalString(item.lang, `customInfo[${i}].lang`, fail);
    if (lang !== undefined) out.lang = lang;
    return out;
  });
}

function outputsList(value: unknown, deps: MergeDeps): RawXmlNode[] {
  if (!Array.isArray(value)) {
    return deps.fail('outputs must be a list of {xml}', { expected: DESCRIPTION_SHAPE.outputs });
  }
  return value.map((item, i) => {
    const xml = typeof item === 'string' ? item : isObject(item) ? item.xml : undefined;
    if (typeof xml !== 'string' || !xml.trim()) {
      return deps.fail(`outputs[${i}] must be {xml} holding an <output> element`, {
        expected: DESCRIPTION_SHAPE.outputs,
      });
    }
    return {
      type: 'raw-xml',
      attrs: { nodeId: deps.nextNodeId(), xml: xml.trim(), inline: false },
    };
  });
}

/**
 * An `annotation` / `history` member: `{xml}` parsed as the element's children (blocks), the
 * node keeping the existing node's id and attributes (data-model §6.3) or getting a fresh
 * `sc_<N>` id; `{xml: ''}` = present and empty; `null` removes the element.
 */
async function xmlBlock(
  value: unknown,
  field: string,
  element: 'annotation' | 'history',
  existing: AnnotationNode | undefined,
  deps: MergeDeps,
): Promise<AnnotationNode | undefined> {
  if (value === null || value === undefined) return undefined;
  const xml = typeof value === 'string' ? value : isObject(value) ? value.xml : undefined;
  if (typeof xml !== 'string') {
    return deps.fail(
      `${field} must be {xml} (FictionBook XML of its content) or null to remove it`,
      {
        expected: { xml: '<p>…</p>' },
      },
    );
  }
  const nodes = xml.trim() ? await deps.parseXml(xml, element) : [];
  const attrs = { ...(existing?.attrs ?? {}) };
  if (typeof attrs.nodeId !== 'string' || !attrs.nodeId) attrs.nodeId = deps.nextNodeId();
  return {
    type: 'annotation',
    attrs,
    content: nodes as AnnotationNode['content'],
  } as AnnotationNode;
}

/** The dotted fields a patch names (what the activity entry shows - C14), without merging it. */
export function descriptionFields(patch: unknown): string[] {
  if (!isObject(patch)) return [];
  const fields: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (
      (key === 'titleInfo' ||
        key === 'srcTitleInfo' ||
        key === 'documentInfo' ||
        key === 'publishInfo') &&
      isObject(value)
    ) {
      for (const member of Object.keys(value)) fields.push(`${key}.${member}`);
    } else {
      fields.push(key);
    }
  }
  return fields;
}
