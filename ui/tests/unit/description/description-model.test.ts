/**
 * T071 - Description model rules (data-model.md §1.2, FR-052): empty optional fields are
 * omitted, a person is written only with first + last name or a nickname (completely empty
 * persons are dropped), nested sequences survive, genre `match` is omitted when 100, the
 * required fields are flagged, the extras note counts preserved elements, and the generic
 * path helpers / text-field enumeration used by the binding and the search target.
 */

import { createNodeIdGenerator } from '@/editor/schema';
import type { AnnotationNode, Description, Person, Sequence } from '@/model/document';
import {
  cleanDescription,
  cleanGenres,
  cleanMatch,
  cleanPerson,
  cleanPersons,
  cleanSequences,
  descriptionExtrasCount,
  formFromDescription,
  getAtPath,
  isIsoDate,
  newDocumentId,
  personComplete,
  personEmpty,
  requiredIssues,
  setAtPath,
  textFields,
} from '@/views/description/model';
import { createRichFieldState, richFieldModel } from '@/views/description/richFieldState';

function baseForm(): Description {
  return {
    titleInfo: {
      genres: [{ code: 'sf' }],
      authors: [{ firstName: 'Ivan', lastName: 'Petrov', homePages: [], emails: [] }],
      bookTitle: 'Alpha',
      coverpage: [],
      lang: 'ru',
      translators: [],
      sequences: [],
    },
    documentInfo: {
      authors: [{ nickname: 'maker', homePages: [], emails: [] }],
      date: { text: '2026' },
      srcUrls: [],
      id: 'id-1',
      version: '1.0',
      publishers: [],
    },
    customInfo: [],
    outputs: [],
  };
}

describe('empty optional fields are omitted', () => {
  it('drops empty strings, trims values and omits empty blocks', () => {
    const form = baseForm();
    form.titleInfo.keywords = '   ';
    form.titleInfo.srcLang = ' en ';
    form.titleInfo.date = { text: '  ', value: '' };
    form.titleInfo.bookTitle = '  Alpha  ';
    form.documentInfo.programUsed = '';
    form.documentInfo.srcOcr = ' OCR ';
    form.documentInfo.srcUrls = ['', ' https://a.example ', '  '];
    form.publishInfo = {
      bookName: '',
      publisher: '  ',
      city: '',
      year: '',
      isbn: '',
      sequences: [],
    };
    form.customInfo = [
      { infoType: '', text: '' },
      { infoType: ' kind ', text: ' note ' },
    ];
    const clean = cleanDescription(form);
    expect(clean.titleInfo.keywords).toBeUndefined();
    expect(clean.titleInfo.srcLang).toBe('en');
    expect(clean.titleInfo.date).toBeUndefined();
    expect(clean.titleInfo.bookTitle).toBe('Alpha');
    expect(clean.documentInfo.programUsed).toBeUndefined();
    expect(clean.documentInfo.srcOcr).toBe('OCR');
    expect(clean.documentInfo.srcUrls).toEqual(['https://a.example']);
    expect(clean.publishInfo).toBeUndefined();
    expect(clean.srcTitleInfo).toBeUndefined();
    expect(clean.customInfo).toEqual([{ infoType: 'kind', text: 'note' }]);
    expect('keywords' in clean.titleInfo).toBe(false);
  });

  it('keeps a publish-info block with any value and the date value without text', () => {
    const form = baseForm();
    form.publishInfo = { year: ' 2001 ', sequences: [] };
    form.titleInfo.date = { text: '', value: '2020-05-17' };
    const clean = cleanDescription(form);
    expect(clean.publishInfo).toEqual({ year: '2001', sequences: [] });
    expect(clean.titleInfo.date).toEqual({ text: '', value: '2020-05-17' });
  });

  it('omits an empty source title info but keeps a filled one', () => {
    const form = baseForm();
    form.srcTitleInfo = {
      genres: [],
      authors: [{ homePages: [], emails: [] }],
      bookTitle: ' ',
      coverpage: [],
      lang: '',
      translators: [],
      sequences: [],
    };
    expect(cleanDescription(form).srcTitleInfo).toBeUndefined();
    form.srcTitleInfo.bookTitle = 'A Modern Book';
    expect(cleanDescription(form).srcTitleInfo?.bookTitle).toBe('A Modern Book');
  });

  it('keeps a filled annotation / history', () => {
    const form = baseForm();
    form.documentInfo.history = {
      type: 'annotation',
      attrs: { nodeId: 'h' },
      content: [{ type: 'p', attrs: { nodeId: 'h1' }, content: [{ type: 'text', text: 'v1' }] }],
    };
    const clean = cleanDescription(form);
    expect(clean.titleInfo.annotation).toBeUndefined();
    expect(clean.documentInfo.history?.content).toHaveLength(1);
  });
});

describe('present-but-empty annotation and history (feature 004, FR-010/FR-015)', () => {
  // The file's <annotation/> reads as a node with empty content; the Description view's clean
  // projection passes it through whatever its content, so an unrelated edit of the form never
  // drops it - the writer then writes <annotation/> back as read (document-model.md §1).
  const emptyAnnotation = (): AnnotationNode => ({
    type: 'annotation',
    attrs: { nodeId: 'a1' },
    content: [],
  });
  const emptyHistory = (): AnnotationNode => ({
    type: 'annotation',
    attrs: { nodeId: 'h1', lang: 'ru' },
    content: [],
  });

  it('is kept across an unrelated edit, attributes included', () => {
    const form = baseForm();
    form.titleInfo.annotation = emptyAnnotation();
    form.documentInfo.history = emptyHistory();
    form.titleInfo.bookTitle = '  Beta  '; // the unrelated edit
    const clean = cleanDescription(form);
    expect(clean.titleInfo.bookTitle).toBe('Beta');
    expect(clean.titleInfo.annotation).toEqual(emptyAnnotation());
    expect(clean.documentInfo.history).toEqual(emptyHistory());
    // The same node object is passed through (no copy that could lose unknown attributes).
    expect(clean.titleInfo.annotation).toBe(form.titleInfo.annotation);
    expect(clean.documentInfo.history).toBe(form.documentInfo.history);
    // A src-title-info annotation follows the same rule.
    form.srcTitleInfo = { ...baseForm().titleInfo, annotation: emptyAnnotation() };
    expect(cleanDescription(form).srcTitleInfo?.annotation).toEqual(emptyAnnotation());
  });

  it('becomes undefined once the user empties the rich field (richFieldModel)', () => {
    // The rich field shows an empty node as one empty paragraph; a document holding nothing but
    // empty paragraphs has no model - exactly what the user leaves behind after emptying it.
    const emptied = createRichFieldState(emptyAnnotation(), createNodeIdGenerator('ui_t_'));
    expect(emptied.doc.childCount).toBe(1);
    expect(richFieldModel(emptied)).toBeUndefined();
    const typed = createRichFieldState(
      {
        type: 'annotation',
        attrs: { nodeId: 'a1' },
        content: [{ type: 'p', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: 'x' }] }],
      },
      createNodeIdGenerator('ui_u_'),
    );
    expect(richFieldModel(typed)?.content).toHaveLength(1);
    // Fed back into the form, the emptied field is an absent node and the clean projection
    // writes nothing for it.
    const form = baseForm();
    form.titleInfo.annotation = richFieldModel(emptied);
    expect(cleanDescription(form).titleInfo.annotation).toBeUndefined();
    expect('annotation' in cleanDescription(form).titleInfo).toBe(false);
  });

  it('leaves an absent node absent', () => {
    const form = baseForm();
    const clean = cleanDescription(form);
    expect(clean.titleInfo.annotation).toBeUndefined();
    expect(clean.documentInfo.history).toBeUndefined();
    expect('history' in clean.documentInfo).toBe(false);
    // A form built from a description without the two nodes has none either.
    const built = formFromDescription(baseForm());
    expect(built.titleInfo.annotation).toBeUndefined();
    expect(built.documentInfo.history).toBeUndefined();
  });
});

describe('person rule', () => {
  const person = (p: Partial<Person>): Person => ({ homePages: [], emails: [], ...p });

  it('is complete with first + last name or with a nickname alone (the authorType choice)', () => {
    expect(personComplete(person({ firstName: 'Ivan', lastName: 'Petrov' }))).toBe(true);
    expect(personComplete(person({ firstName: 'Ivan', lastName: 'Petrov', nickname: 'ip' }))).toBe(
      true,
    );
    expect(personComplete(person({ nickname: 'maker' }))).toBe(true);
    expect(personComplete(person({ nickname: 'maker', emails: ['m@x.y'] }))).toBe(true);
    expect(personComplete(person({ firstName: 'Ivan' }))).toBe(false);
    expect(personComplete(person({ firstName: 'Ivan', nickname: 'ip' }))).toBe(false);
    expect(personComplete(person({ lastName: 'Petrov', middleName: 'P.' }))).toBe(false);
    expect(personComplete(person({ middleName: 'P.', nickname: 'ip' }))).toBe(false);
    expect(personComplete(person({ emails: ['a@b.c'] }))).toBe(false);
  });

  it('drops completely empty persons and trims / omits empty fields of the others', () => {
    expect(personEmpty(person({ firstName: ' ', homePages: [''] }))).toBe(true);
    expect(cleanPerson(person({ firstName: ' ', emails: [' '] }))).toBeNull();
    expect(
      cleanPerson(
        person({
          firstName: ' Anna ',
          middleName: '',
          lastName: 'Ivanova',
          nickname: '  ',
          homePages: ['', 'https://example.org/anna '],
          emails: ['anna@example.org'],
          id: '',
        }),
      ),
    ).toEqual({
      firstName: 'Anna',
      lastName: 'Ivanova',
      homePages: ['https://example.org/anna'],
      emails: ['anna@example.org'],
    });
    expect(
      cleanPersons([
        person({}),
        person({ nickname: 'nick' }),
        person({ firstName: 'Solo' }),
        person({ homePages: [' '] }),
      ]),
    ).toEqual([
      { nickname: 'nick', homePages: [], emails: [] },
      { firstName: 'Solo', homePages: [], emails: [] },
    ]);
  });

  it('flags incomplete persons and a missing author in the required issues', () => {
    const form = baseForm();
    form.titleInfo.authors = [person({ firstName: 'Solo' }), person({})];
    form.titleInfo.translators = [person({ lastName: 'Only' })];
    const issues = requiredIssues(form);
    expect(issues.missing.has('titleInfo.authors')).toBe(true);
    expect(issues.incompletePersons.has('titleInfo.authors.0')).toBe(true);
    expect(issues.incompletePersons.has('titleInfo.authors.1')).toBe(false); // empty, not incomplete
    expect(issues.incompletePersons.has('titleInfo.translators.0')).toBe(true);
    form.titleInfo.authors.push(person({ nickname: 'Соавтор' }));
    expect(requiredIssues(form).missing.has('titleInfo.authors')).toBe(false);
  });
});

describe('sequences', () => {
  it('keeps nesting, drops nameless leaves and normalises numbers', () => {
    const sequences: Sequence[] = [
      {
        name: ' Серия ',
        number: 3,
        children: [
          { name: 'Подсерия', number: 1, children: [] },
          { name: '', children: [] },
          { name: 'Third', number: -2, children: [{ name: 'Deep', children: [] }] },
        ],
      },
      { name: '', children: [] },
      { name: '  ', children: [{ name: 'Orphan', number: 7, children: [] }] },
    ];
    expect(cleanSequences(sequences)).toEqual([
      {
        name: 'Серия',
        number: 3,
        children: [
          { name: 'Подсерия', number: 1, children: [] },
          { name: 'Third', children: [{ name: 'Deep', children: [] }] },
        ],
      },
      { name: '', children: [{ name: 'Orphan', number: 7, children: [] }] },
    ]);
    const form = baseForm();
    form.titleInfo.sequences = sequences;
    expect(requiredIssues(form).unnamedSequences.has('titleInfo.sequences.2')).toBe(true);
  });
});

describe('genres', () => {
  it('omits match when it is 100 or invalid and drops empty codes', () => {
    expect(cleanMatch(100)).toBeUndefined();
    expect(cleanMatch('100')).toBeUndefined();
    expect(cleanMatch(30)).toBe(30);
    expect(cleanMatch('45')).toBe(45);
    expect(cleanMatch(0)).toBeUndefined();
    expect(cleanMatch(150)).toBeUndefined();
    expect(cleanMatch('abc')).toBeUndefined();
    expect(cleanMatch(undefined)).toBeUndefined();
    expect(
      cleanGenres([
        { code: 'sf', match: 100 },
        { code: ' adventure ', match: 30 },
        { code: '' },
        { code: 'poetry', match: 0 },
      ]),
    ).toEqual([{ code: 'sf' }, { code: 'adventure', match: 30 }, { code: 'poetry' }]);
  });

  it('keeps unknown codes as they are and flags a missing genre', () => {
    const form = baseForm();
    form.titleInfo.genres = [{ code: 'my_custom_genre' }];
    expect(cleanDescription(form).titleInfo.genres).toEqual([{ code: 'my_custom_genre' }]);
    form.titleInfo.genres = [{ code: '  ' }];
    expect(requiredIssues(form).missing.has('titleInfo.genres')).toBe(true);
  });
});

describe('required fields (FR-052)', () => {
  it('reports every empty required field and nothing for a complete description', () => {
    const complete = requiredIssues(baseForm());
    expect(complete.missing.size).toBe(0);
    const form = baseForm();
    form.titleInfo.genres = [];
    form.titleInfo.authors = [];
    form.titleInfo.bookTitle = ' ';
    form.titleInfo.lang = '';
    form.documentInfo.authors = [];
    form.documentInfo.date = { text: ' ', value: '' };
    form.documentInfo.id = '';
    form.documentInfo.version = '';
    expect([...requiredIssues(form).missing].sort()).toEqual([
      'documentInfo.authors',
      'documentInfo.date',
      'documentInfo.id',
      'documentInfo.version',
      'titleInfo.authors',
      'titleInfo.bookTitle',
      'titleInfo.genres',
      'titleInfo.lang',
    ]);
  });

  it('flags malformed date values and untyped custom info', () => {
    const form = baseForm();
    form.documentInfo.date = { text: 'today', value: '2026-13-45' };
    form.titleInfo.date = { text: 'May', value: '2020-05-17' };
    form.customInfo = [{ infoType: '', text: 'note' }];
    const issues = requiredIssues(form);
    expect(issues.invalidDates.has('documentInfo.date.value')).toBe(true);
    expect(issues.invalidDates.has('titleInfo.date.value')).toBe(false);
    expect(issues.untypedCustomInfo.has('customInfo.0')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate(undefined)).toBe(true);
  });
});

describe('ids, extras and paths', () => {
  it('generates UUID v4 document ids', () => {
    const id = newDocumentId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newDocumentId(() => 0.5)).toMatch(/^[0-9a-f-]{36}$/);
    expect(newDocumentId()).not.toBe(id);
  });

  it('counts preserved outputs and description-level unknown elements', () => {
    const description = baseForm();
    description.outputs = [
      { type: 'raw-xml', attrs: { nodeId: 'o1', xml: '<output/>', inline: false } },
    ];
    expect(
      descriptionExtrasCount({
        description,
        extras: [
          {
            type: 'raw-xml',
            attrs: { nodeId: 'x1', xml: '<x/>', inline: false, slot: 'title-info' },
          },
          {
            type: 'raw-xml',
            attrs: { nodeId: 'x2', xml: '<y/>', inline: false, slot: 'FictionBook' },
          },
          { type: 'raw-xml', attrs: { nodeId: 'x3', xml: '<z/>', inline: false } },
        ] as never,
      }),
    ).toBe(2);
  });

  it('reads and writes dot paths immutably', () => {
    const form = baseForm();
    expect(getAtPath(form, 'titleInfo.authors.0.lastName')).toBe('Petrov');
    expect(getAtPath(form, 'titleInfo.authors.5.lastName')).toBeUndefined();
    const next = setAtPath(form, 'titleInfo.authors.0.lastName', 'Sidorov');
    expect(next).not.toBe(form);
    expect(next.titleInfo.authors[0]!.lastName).toBe('Sidorov');
    expect(form.titleInfo.authors[0]!.lastName).toBe('Petrov');
    expect(next.documentInfo).toBe(form.documentInfo); // untouched branches are shared
    const withDate = setAtPath(form, 'titleInfo.date.text', 'May');
    expect(withDate.titleInfo.date).toEqual({ text: 'May' });
  });

  it('enumerates the plain text fields in document order', () => {
    const form = formFromDescription(baseForm());
    form.titleInfo.sequences = [{ name: 'Saga', children: [{ name: 'Sub', children: [] }] }];
    form.customInfo = [{ infoType: 'kind', text: 'note' }];
    const keys = textFields(form).map((f) => f.key);
    expect(keys.indexOf('titleInfo.authors.0.firstName')).toBeLessThan(
      keys.indexOf('titleInfo.bookTitle'),
    );
    expect(keys).toContain('titleInfo.sequences.0.children.0.name');
    expect(keys).toContain('documentInfo.id');
    expect(keys).toContain('publishInfo.isbn');
    expect(keys.at(-1)).toBe('customInfo.0.text');
    expect(textFields(form).find((f) => f.key === 'titleInfo.bookTitle')?.value).toBe('Alpha');
  });

  it('builds a form with every optional block present and copies arrays', () => {
    const description = baseForm();
    const form = formFromDescription(description);
    expect(form.publishInfo).toEqual({ sequences: [] });
    expect(form.srcTitleInfo).toBeUndefined();
    expect(form.titleInfo.authors).not.toBe(description.titleInfo.authors);
    expect(form.titleInfo.authors[0]).toEqual(description.titleInfo.authors[0]);
  });
});
