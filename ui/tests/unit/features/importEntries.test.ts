/**
 * Feature 004, User Story 4 (T037) - the pure half of the description import (research R3.2,
 * data-model §4.2 / §4.3): `importableEntries()` offers exactly the present, non-empty entries
 * of a `doc.readDescription` answer in the FR-032 order with their "{{group}}: {{field}}"
 * labels and plain-text values; `applyEntries()` replaces the ticked entries as wholes, maps
 * the cover references through the binary map, replaces the role rows and the plain rows of
 * one `info-type` together and takes the four document details from `documentDetails`; the
 * untouched baseline (`equalDescriptions`, T041) ignores node ids and key order. The full
 * fixture `tests/fixtures/books/import-full.fbd` (T003) is read here with the DOM parser into
 * the Document JSON the core answers, so the "31 entries" count stays bound to the file.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstance } from 'i18next';

import { initI18n } from '@/i18n';
import type {
  AnnotationNode,
  BinaryMeta,
  CustomInfo,
  Description,
  DocumentInfo,
  Person,
  PublishInfo,
  Sequence,
  TitleInfo,
} from '@/model/document';
import { createAppStore } from '@/model/store';
import {
  applyEntries,
  entryLabel,
  entryValueText,
  importableEntries,
  type ImportableEntry,
  type ReadDescriptionResult,
} from '@/features/transfer/importEntries';
import { equalDescriptions, isUntouchedNewDocument } from '@/features/transfer/untouched';
import { cleanDescription, formFromDescription } from '@/views/description/model';

import { fakeDocument } from './testUtils';

const BOOKS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/books',
);

/* ------------------------------------------------------------------------ */
/* A reader of the description of a fixture file (the shape the core answers) */
/* ------------------------------------------------------------------------ */

const XLINK = 'http://www.w3.org/1999/xlink';
let nextId = 1000;

function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === name);
}

function child(parent: Element, name: string): Element | undefined {
  return children(parent, name)[0];
}

function text(parent: Element, name: string): string | undefined {
  const node = child(parent, name);
  return node ? (node.textContent ?? '') : undefined;
}

function person(el: Element): Person {
  const out: Person = {
    homePages: children(el, 'home-page').map((n) => n.textContent ?? ''),
    emails: children(el, 'email').map((n) => n.textContent ?? ''),
  };
  const first = text(el, 'first-name');
  const middle = text(el, 'middle-name');
  const last = text(el, 'last-name');
  const nick = text(el, 'nickname');
  const id = text(el, 'id');
  if (first !== undefined) out.firstName = first;
  if (middle !== undefined) out.middleName = middle;
  if (last !== undefined) out.lastName = last;
  if (nick !== undefined) out.nickname = nick;
  if (id !== undefined) out.id = id;
  return out;
}

function sequence(el: Element): Sequence {
  const out: Sequence = {
    name: el.getAttribute('name') ?? '',
    children: children(el, 'sequence').map(sequence),
  };
  const number = el.getAttribute('number');
  if (number !== null) out.number = Number(number);
  return out;
}

function annotation(el: Element): AnnotationNode {
  return {
    type: 'annotation',
    attrs: { nodeId: `n${nextId++}` },
    content: children(el, 'p').map((p) => ({
      type: 'p' as const,
      attrs: { nodeId: `n${nextId++}` },
      content: [{ type: 'text' as const, text: p.textContent ?? '' }],
    })),
  };
}

function titleInfo(el: Element): TitleInfo {
  const out: TitleInfo = {
    genres: children(el, 'genre').map((g) => {
      const match = g.getAttribute('match');
      return match
        ? { code: g.textContent ?? '', match: Number(match) }
        : { code: g.textContent ?? '' };
    }),
    authors: children(el, 'author').map(person),
    bookTitle: text(el, 'book-title') ?? '',
    coverpage: (child(el, 'coverpage') ? children(child(el, 'coverpage')!, 'image') : []).map(
      (image) => ({ href: image.getAttributeNS(XLINK, 'href') ?? '' }),
    ),
    lang: text(el, 'lang') ?? '',
    translators: children(el, 'translator').map(person),
    sequences: children(el, 'sequence').map(sequence),
  };
  const ann = child(el, 'annotation');
  if (ann) out.annotation = annotation(ann);
  const keywords = text(el, 'keywords');
  if (keywords !== undefined) out.keywords = keywords;
  const date = child(el, 'date');
  if (date) {
    out.date = { text: date.textContent ?? '' };
    const value = date.getAttribute('value');
    if (value) out.date.value = value;
  }
  const srcLang = text(el, 'src-lang');
  if (srcLang !== undefined) out.srcLang = srcLang;
  return out;
}

function documentInfo(el: Element | undefined): DocumentInfo {
  const out: DocumentInfo = {
    authors: el ? children(el, 'author').map(person) : [],
    date: { text: '' },
    srcUrls: el ? children(el, 'src-url').map((n) => n.textContent ?? '') : [],
    id: (el && text(el, 'id')) ?? '',
    version: (el && text(el, 'version')) ?? '',
    publishers: el ? children(el, 'publisher').map(person) : [],
  };
  if (!el) return out;
  const program = text(el, 'program-used');
  if (program !== undefined) out.programUsed = program;
  const date = child(el, 'date');
  if (date) {
    out.date = { text: date.textContent ?? '' };
    const value = date.getAttribute('value');
    if (value) out.date.value = value;
  }
  const ocr = text(el, 'src-ocr');
  if (ocr !== undefined) out.srcOcr = ocr;
  const history = child(el, 'history');
  if (history) out.history = annotation(history);
  return out;
}

function publishInfo(el: Element | undefined): PublishInfo | undefined {
  if (!el) return undefined;
  const out: PublishInfo = { sequences: children(el, 'sequence').map(sequence) };
  const bookName = text(el, 'book-name');
  const publisher = text(el, 'publisher');
  const city = text(el, 'city');
  const year = text(el, 'year');
  const isbn = text(el, 'isbn');
  if (bookName !== undefined) out.bookName = bookName;
  if (publisher !== undefined) out.publisher = publisher;
  if (city !== undefined) out.city = city;
  if (year !== undefined) out.year = year;
  if (isbn !== undefined) out.isbn = isbn;
  return out;
}

/** The `doc.readDescription` answer for a fixture file, as far as the fixtures go. */
function readFixture(name: string): ReadDescriptionResult {
  const xml = readFileSync(path.join(BOOKS, name), 'utf8');
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  const description = child(root, 'description')!;
  const title = child(description, 'title-info')!;
  const src = child(description, 'src-title-info');
  const out: Description = {
    titleInfo: titleInfo(title),
    documentInfo: documentInfo(child(description, 'document-info')),
    customInfo: children(description, 'custom-info').map((row) => ({
      infoType: row.getAttribute('info-type') ?? '',
      text: row.textContent ?? '',
    })),
    outputs: [],
  };
  if (src) out.srcTitleInfo = titleInfo(src);
  const publish = publishInfo(child(description, 'publish-info'));
  if (publish) out.publishInfo = publish;
  const binaries: BinaryMeta[] = children(root, 'binary').map((binary) => ({
    id: binary.getAttribute('id') ?? '',
    contentType: binary.getAttribute('content-type') ?? '',
    size: Math.floor(((binary.textContent ?? '').replace(/\s+/g, '').length * 3) / 4),
    decodable: true,
    willConvert: false,
    referenceCount: 1,
  }));
  const details: DocumentInfo = {
    ...out.documentInfo,
    id: out.documentInfo.id || 'FILLED-IN-ID',
    version: out.documentInfo.version || '1.0',
    programUsed: `${out.documentInfo.programUsed ?? ''}, Maxima Fiction Book Editor 0.0.4`.replace(
      /^, /,
      '',
    ),
  };
  return { importId: 'd9', description: out, documentDetails: details, binaries, warnings: [] };
}

const FULL_KEYS = [
  'titleInfo.genres',
  'titleInfo.authors',
  'titleInfo.bookTitle',
  'titleInfo.annotation',
  'titleInfo.keywords',
  'titleInfo.date',
  'titleInfo.coverpage',
  'titleInfo.lang',
  'titleInfo.srcLang',
  'titleInfo.translators',
  'titleInfo.sequences',
  'roles',
  'srcTitleInfo',
  'documentInfo.authors',
  'documentInfo.programUsed',
  'documentInfo.date',
  'documentInfo.srcUrls',
  'documentInfo.srcOcr',
  'documentInfo.id',
  'documentInfo.version',
  'documentInfo.history',
  'documentInfo.publishers',
  'publishInfo.bookName',
  'publishInfo.publisher',
  'publishInfo.city',
  'publishInfo.year',
  'publishInfo.isbn',
  'publishInfo.sequences',
  'customInfo.2',
  'customInfo.3',
  'customInfo.4',
];

function emptyDescription(): Description {
  return {
    titleInfo: {
      genres: [],
      authors: [],
      bookTitle: '',
      coverpage: [],
      lang: '',
      translators: [],
      sequences: [],
    },
    documentInfo: {
      authors: [],
      date: { text: '' },
      srcUrls: [],
      id: '',
      version: '',
      publishers: [],
    },
    customInfo: [],
    outputs: [],
  };
}

function entry(entries: ImportableEntry[], key: string): ImportableEntry {
  const found = entries.find((e) => e.key === key);
  if (!found) throw new Error(`no entry ${key}`);
  return found;
}

let t: Awaited<ReturnType<typeof initI18n>>['t'];

beforeAll(async () => {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  t = i18n.t;
});

/* ------------------------------------------------------------------------ */
/* importableEntries                                                         */
/* ------------------------------------------------------------------------ */

describe('importableEntries (FR-032)', () => {
  it('offers every entry of import-full.fbd - 31 entries in the FR-032 order', () => {
    const result = readFixture('import-full.fbd');
    const entries = importableEntries(result);
    expect(entries.map((e) => e.key)).toEqual(FULL_KEYS);
    expect(entries).toHaveLength(31);
  });

  it('labels entries "{{group}}: {{field}}" and the source title info by its group alone', () => {
    const entries = importableEntries(readFixture('import-full.fbd'));
    expect(entryLabel(entry(entries, 'titleInfo.authors'), t)).toBe('Title info: Authors');
    expect(entryLabel(entry(entries, 'titleInfo.bookTitle'), t)).toBe('Title info: Book title');
    expect(entryLabel(entry(entries, 'titleInfo.coverpage'), t)).toBe('Title info: Cover page');
    expect(entryLabel(entry(entries, 'roles'), t)).toBe('Title info: Other persons');
    expect(entryLabel(entry(entries, 'srcTitleInfo'), t)).toBe('Source Title Info');
    expect(entryLabel(entry(entries, 'documentInfo.date'), t)).toBe('Document Info: Date');
    expect(entryLabel(entry(entries, 'documentInfo.id'), t)).toBe('Document Info: ID');
    expect(entryLabel(entry(entries, 'publishInfo.isbn'), t)).toBe('Publish Info: ISBN');
    expect(entryLabel(entry(entries, 'customInfo.2'), t)).toBe('Custom Info: mlseriesid');
  });

  it('renders the values as plain text: lists joined by "; ", the cover by name, size and type', () => {
    const result = readFixture('import-full.fbd');
    const entries = importableEntries(result);
    const value = (key: string) => entryValueText(entry(entries, key), t);
    expect(value('titleInfo.genres')).toBe('sf; adventure');
    expect(value('titleInfo.authors')).toBe('Полнова Полина Петровна');
    expect(value('titleInfo.bookTitle')).toBe('Полное описание');
    expect(value('titleInfo.annotation')).toBe(
      'Аннотация полного описания.; Второй абзац аннотации.',
    );
    expect(value('titleInfo.keywords')).toBe('импорт, описание, проверка');
    expect(value('titleInfo.date')).toBe('17 мая 2020');
    expect(value('titleInfo.lang')).toBe('ru');
    expect(value('titleInfo.srcLang')).toBe('en');
    expect(value('titleInfo.translators')).toBe('Переводов Тимофей');
    expect(value('titleInfo.sequences')).toBe('Полные серии 3; Подсерия 1');
    expect(value('roles')).toBe('Илюстраторов Илья Ильич; Редакторов Роман Романович');
    expect(value('srcTitleInfo')).toBe('The Full Description');
    expect(value('documentInfo.authors')).toBe('maker');
    expect(value('documentInfo.srcUrls')).toBe(
      'https://example.org/source; https://example.org/mirror',
    );
    expect(value('documentInfo.history')).toBe('v1.0 — создание файла; v1.5 — вычитка');
    expect(value('documentInfo.publishers')).toBe('Publisher Nick');
    expect(value('publishInfo.sequences')).toBe('Бумажная серия 7');
    expect(value('customInfo.3')).toBe('last position 12%');
    // The document details are offered as read: the fill-in applies when they are imported.
    expect(value('documentInfo.id')).toBe('import-full-0001');
    expect(value('documentInfo.programUsed')).toBe('Maxima FBD Maker');
    // The cover: its image's name, size and type, with the data the file carries.
    const cover = entry(entries, 'titleInfo.coverpage');
    expect(cover.hrefs).toEqual(['#cover.jpg']);
    expect(cover.covers).toHaveLength(1);
    expect(cover.covers![0]!.binary?.id).toBe('cover.jpg');
    expect(value('titleInfo.coverpage')).toBe(
      t('transfer.import.coverValue', {
        id: 'cover.jpg',
        type: 'image/jpeg',
        size: result.binaries[0]!.size,
      }),
    );
    // The source title info brings its own cover's data along.
    expect(entry(entries, 'srcTitleInfo').hrefs).toEqual(['#cover.jpg']);
  });

  it('offers a cover the file has no data for, without data; cuts long values at 200 characters', () => {
    const result = readFixture('descriptor.fbd');
    result.description.titleInfo.coverpage = [{ href: '#missing.jpg' }];
    result.description.titleInfo.annotation!.content[0] = {
      type: 'p',
      attrs: { nodeId: 'n1' },
      content: [{ type: 'text', text: 'Я'.repeat(260) }],
    };
    const entries = importableEntries(result);
    const cover = entry(entries, 'titleInfo.coverpage');
    expect(cover.covers).toEqual([{ href: '#missing.jpg', binary: null }]);
    expect(cover.hrefs).toEqual([]);
    expect(entryValueText(cover, t)).toBe(t('transfer.import.coverNoData', { id: 'missing.jpg' }));
    const annotation = entryValueText(entry(entries, 'titleInfo.annotation'), t);
    expect([...annotation]).toHaveLength(200);
    expect(annotation.endsWith('…')).toBe(true);
  });

  it('offers nothing for an empty description and skips empty fields, rows and lists', () => {
    const empty: ReadDescriptionResult = {
      importId: 'd9',
      description: emptyDescription(),
      documentDetails: { ...emptyDescription().documentInfo, id: 'X', version: '1.0' },
      binaries: [],
      warnings: [],
    };
    expect(importableEntries(empty)).toEqual([]);
    const sparse = readFixture('maxlib-roles-edge.fbd');
    const keys = importableEntries(sparse).map((e) => e.key);
    // Five title-info entries, the roles, the version; the empty mlcommentator row is not
    // offered; the five-part and the `MlEditor` rows are plain rows; the empty publish-info
    // offers nothing.
    expect(keys).toEqual([
      'titleInfo.genres',
      'titleInfo.authors',
      'titleInfo.bookTitle',
      'titleInfo.coverpage',
      'titleInfo.lang',
      'roles',
      'documentInfo.version',
      'customInfo.4',
      'customInfo.10',
    ]);
    expect(entryValueText(entry(importableEntries(sparse), 'roles'), t)).toContain(
      'Де Голль Шарль',
    );
  });
});

/* ------------------------------------------------------------------------ */
/* applyEntries                                                              */
/* ------------------------------------------------------------------------ */

describe('applyEntries (FR-035)', () => {
  const result = readFixture('import-full.fbd');

  function target(): Description {
    const base = fakeDocument().description;
    return {
      ...base,
      titleInfo: {
        ...base.titleInfo,
        translators: [{ nickname: 'tr', homePages: [], emails: [] }],
        coverpage: [{ href: '#old-cover.png' }],
      },
      customInfo: [
        { infoType: 'mlauthorid', text: '1 Старый Автор' },
        { infoType: 'mleditor', text: 'Старый Редактор' },
        { infoType: 'fbreader', text: 'old position' },
        { infoType: 'mlauthorid', text: '2 Второй Автор' },
      ],
    };
  }

  it('replaces a list as a whole and leaves unticked entries alone', () => {
    const before = target();
    const after = applyEntries(before, result, ['titleInfo.authors'], new Map());
    expect(after.titleInfo.authors).toEqual(result.description.titleInfo.authors);
    expect(after.titleInfo.authors).not.toBe(result.description.titleInfo.authors);
    expect(after.titleInfo.translators).toBe(before.titleInfo.translators);
    expect(after.titleInfo.bookTitle).toBe('Alpha');
    expect(after.documentInfo).toBe(before.documentInfo);
    expect(after.customInfo).toBe(before.customInfo);
    expect(after.publishInfo).toBeUndefined();
    expect(after.outputs).toBe(before.outputs);
  });

  it('maps the cover references through the binary map', () => {
    const map = new Map([['#cover.jpg', '#cover_2.jpg']]);
    const after = applyEntries(target(), result, ['titleInfo.coverpage', 'srcTitleInfo'], map);
    expect(after.titleInfo.coverpage).toEqual([{ href: '#cover_2.jpg' }]);
    expect(after.srcTitleInfo?.coverpage).toEqual([{ href: '#cover_2.jpg' }]);
    expect(after.srcTitleInfo?.bookTitle).toBe('The Full Description');
    // A reference the map does not know stays as it is (no data in the file).
    const unmapped = applyEntries(target(), result, ['titleInfo.coverpage'], new Map());
    expect(unmapped.titleInfo.coverpage).toEqual([{ href: '#cover.jpg' }]);
  });

  it('replaces the role rows and keeps the plain rows; imported entries count as read', () => {
    const after = applyEntries(target(), result, ['roles'], new Map());
    expect(after.customInfo).toEqual([
      { infoType: 'mlauthorid', text: '1 Старый Автор' },
      { infoType: 'fbreader', text: 'old position' },
      { infoType: 'mlauthorid', text: '2 Второй Автор' },
      { infoType: 'mlillustrator', text: 'Илюстраторов Илья Ильич' },
      { infoType: 'mleditor', text: 'Редакторов Роман Романович' },
    ]);
  });

  it('takes the four document details from documentDetails and the rest as read', () => {
    const after = applyEntries(
      target(),
      result,
      [
        'documentInfo.id',
        'documentInfo.version',
        'documentInfo.programUsed',
        'documentInfo.date',
        'documentInfo.srcOcr',
      ],
      new Map(),
    );
    expect(after.documentInfo.id).toBe(result.documentDetails.id);
    expect(after.documentInfo.version).toBe(result.documentDetails.version);
    expect(after.documentInfo.programUsed).toBe(
      'Maxima FBD Maker, Maxima Fiction Book Editor 0.0.4',
    );
    expect(after.documentInfo.date).toEqual(result.documentDetails.date);
    expect(after.documentInfo.srcOcr).toBe('OCR by hand');
    expect(after.documentInfo.authors).toEqual(target().documentInfo.authors);
  });

  it('creates a missing publishInfo block for a ticked publish entry', () => {
    const after = applyEntries(
      target(),
      result,
      ['publishInfo.city', 'publishInfo.sequences'],
      new Map(),
    );
    expect(after.publishInfo).toEqual({
      city: 'Москва',
      sequences: [{ name: 'Бумажная серия', number: 7, children: [] }],
    });
  });

  it('replaces the plain rows of one info-type together with the ticked lines of that type', () => {
    const source: ReadDescriptionResult = {
      ...result,
      description: {
        ...result.description,
        customInfo: [
          { infoType: 'mlauthorid', text: '10 Новый Автор' },
          { infoType: 'mleditor', text: 'Новый Редактор' },
          { infoType: 'mlauthorid', text: '11 Ещё Автор' },
          { infoType: 'calibre', text: 'tag' },
        ],
      },
    };
    const entries = importableEntries(source);
    expect(entries.filter((e) => e.key.startsWith('customInfo.')).map((e) => e.key)).toEqual([
      'customInfo.0',
      'customInfo.2',
      'customInfo.3',
    ]);
    // Both mlauthorid lines ticked: they take the place of the document's mlauthorid rows,
    // none is lost; the role row and the fbreader row stay; the calibre row is added.
    const after = applyEntries(
      target(),
      source,
      ['customInfo.0', 'customInfo.2', 'customInfo.3'],
      new Map(),
    );
    expect(after.customInfo).toEqual([
      { infoType: 'mlauthorid', text: '10 Новый Автор' },
      { infoType: 'mlauthorid', text: '11 Ещё Автор' },
      { infoType: 'mleditor', text: 'Старый Редактор' },
      { infoType: 'fbreader', text: 'old position' },
      { infoType: 'calibre', text: 'tag' },
    ]);
    // One line of a type the document has not: added after the rows.
    const added = applyEntries(target(), source, ['customInfo.3'], new Map());
    expect(added.customInfo).toEqual([
      ...target().customInfo,
      { infoType: 'calibre', text: 'tag' },
    ]);
  });

  it('applies the whole fixture (the silent case) and leaves nothing of the file out', () => {
    const after = applyEntries(emptyDescription(), result, FULL_KEYS, new Map());
    expect(after.titleInfo.bookTitle).toBe('Полное описание');
    expect(after.titleInfo.annotation?.content).toHaveLength(2);
    expect(after.srcTitleInfo?.lang).toBe('en');
    expect(after.documentInfo.history?.content).toHaveLength(2);
    expect(after.publishInfo?.isbn).toBe('978-5-00000-000-1');
    expect(after.customInfo.map((row) => row.infoType)).toEqual([
      'mlseriesid',
      'fbreader',
      'coolreader',
      'mlillustrator',
      'mleditor',
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* The untouched baseline (T041)                                            */
/* ------------------------------------------------------------------------ */

describe('equalDescriptions / isUntouchedNewDocument (FR-033)', () => {
  it('ignores node ids and key order, sees an edit and its undo', () => {
    const base = readFixture('descriptor.fbd').description;
    const reordered: Description = JSON.parse(
      JSON.stringify({
        outputs: base.outputs,
        customInfo: base.customInfo,
        documentInfo: base.documentInfo,
        titleInfo: { ...base.titleInfo, annotation: { ...base.titleInfo.annotation! } },
      }),
    ) as Description;
    reordered.titleInfo.annotation!.attrs = { nodeId: 'ui_77' };
    (reordered.titleInfo.annotation!.content[0] as { attrs: { nodeId: string } }).attrs = {
      nodeId: 'ui_78',
    };
    expect(equalDescriptions(base, reordered)).toBe(true);

    const form = formFromDescription(base);
    const edited = cleanDescription({
      ...form,
      titleInfo: { ...form.titleInfo, bookTitle: 'Другое' },
    });
    expect(equalDescriptions(base, edited)).toBe(false);
    const undone = cleanDescription({
      ...formFromDescription(edited),
      titleInfo: { ...form.titleInfo, bookTitle: base.titleInfo.bookTitle },
    });
    expect(equalDescriptions(base, undone)).toBe(true);
    // The clean projection is what counts: trailing spaces the form would trim are no edit.
    expect(
      equalDescriptions(base, {
        ...base,
        titleInfo: { ...base.titleInfo, bookTitle: `${base.titleInfo.bookTitle}  ` },
      }),
    ).toBe(true);
    // A block edit of the Body view changes the same datum and counts.
    const annotated: Description = {
      ...base,
      titleInfo: {
        ...base.titleInfo,
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'n1' },
          content: [
            { type: 'p', attrs: { nodeId: 'n2' }, content: [{ type: 'text', text: 'Новый' }] },
          ],
        },
      },
    };
    expect(equalDescriptions(base, annotated)).toBe(false);
  });

  it('is untouched only for a never-saved document whose description equals the baseline', () => {
    const base = readFixture('descriptor.fbd').description;
    const document = { ...fakeDocument(), path: undefined, description: base };
    const store = createAppStore({
      document,
      docId: document.docId,
      path: null,
      newDocumentBaseline: base,
    });
    expect(isUntouchedNewDocument(store.getState())).toBe(true);
    store.setState({ path: '/books/saved.fb2' });
    expect(isUntouchedNewDocument(store.getState())).toBe(false);
    store.setState({ path: null, newDocumentBaseline: null });
    expect(isUntouchedNewDocument(store.getState())).toBe(false);
    store.setState({
      newDocumentBaseline: base,
      document: {
        ...document,
        description: { ...base, titleInfo: { ...base.titleInfo, lang: 'en' } },
      },
    });
    expect(isUntouchedNewDocument(store.getState())).toBe(false);
    store.setState({ document: null });
    expect(isUntouchedNewDocument(store.getState())).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* Row-type sanity: the custom-info helpers are typed as the model is         */
/* ------------------------------------------------------------------------ */

it('custom rows keep their lang through applyEntries', () => {
  const source: ReadDescriptionResult = {
    ...readFixture('descriptor.fbd'),
    description: {
      ...emptyDescription(),
      customInfo: [{ infoType: 'note', text: 'Текст', lang: 'ru' } satisfies CustomInfo],
    },
  };
  const after = applyEntries(emptyDescription(), source, ['customInfo.0'], new Map());
  expect(after.customInfo).toEqual([{ infoType: 'note', text: 'Текст', lang: 'ru' }]);
});
