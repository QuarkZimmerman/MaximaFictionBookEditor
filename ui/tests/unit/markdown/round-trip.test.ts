// Feature 011 (US7; D29, D45; SC-008): a book exported as Markdown and imported again comes back as
// itself, apart from D29's list - its description from the header, its stylesheets and named styles
// included; the cover and title page are not text.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { convertMarkdown } from '@/features/markdown/convert';
import { buildBook } from '@/features/markdown/describe';
import { serializeMarkdown } from '@/features/markdown/export/serialize';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

// The template File > New and the import use (Vite rewrites `new URL(…, import.meta.url)`, so
// the path is built from the test's own folder, as goldens.test.ts does).
const TEMPLATE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../resources/blank.fb2'),
  'utf8',
);

const text = (value: string, marks?: ModelNodeJson['marks']): ModelNodeJson => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
let ids = 0;
const node = (
  type: string,
  content: ModelNodeJson[] = [],
  attrs: Record<string, unknown> = {},
): ModelNodeJson => ({
  type,
  attrs: { nodeId: `r${(ids += 1)}`, ...attrs },
  content,
});

function book(): Document {
  const main = node('body', [
    node('title', [node('p', [text('Round Trip')])]),
    node('section', [
      node('title', [node('p', [text('Chapter One')])]),
      node('p', [text('Dear friend', [{ type: 'style', attrs: { name: 'letter' } }])]),
      node('empty-line'),
      node('p', [text('Signed')], { style: 'sign' }),
      node('table', [
        node('tr', [node('th', [text('Room')]), node('th', [text('Count')])]),
        node('tr', [node('td', [text('Hall')]), node('td', [text('1')])]),
      ]),
      node('p', [
        text('A note'),
        text('1', [{ type: 'link', attrs: { href: '#n1', type: 'note' } }]),
        text('.'),
      ]),
    ]),
    node('section', [node('p', [text('An untitled section.')])]),
  ]);
  const notes = node(
    'body',
    [
      node('title', [node('p', [text('Notes')])]),
      node('section', [node('title', [node('p', [text('1')])]), node('p', [text('The note.')])], {
        id: 'n1',
      }),
    ],
    { name: 'notes' },
  );
  const document = fakeDocument({ bodies: [main, notes] as unknown as BodyNode[] });
  document.description.titleInfo.bookTitle = 'Round Trip';
  document.description.titleInfo.authors = [
    { firstName: 'Ann', lastName: 'Writer', homePages: [], emails: [] },
  ];
  document.description.titleInfo.sequences = [{ name: 'Saga', number: 2, children: [] }];
  document.description.titleInfo.lang = 'en';
  document.description.documentInfo.id = 'round-trip-1';
  document.description.documentInfo.version = '1.2';
  document.stylesheets = [
    { type: 'text/css', content: '.letter { font-style: italic; }\n.sign { text-align: right; }' },
  ];
  return document;
}

function roundTrip(form: 'md' | 'zip') {
  const exported = serializeMarkdown(book(), { form, includePictures: true });
  const result = convertMarkdown(exported.text, {
    fileName: 'round',
    baseDir: '',
    notesTitle: 'Notes',
  });
  return { exported, result, xml: buildBook(TEMPLATE, result) };
}

describe('export and import again (SC-008)', () => {
  for (const form of ['md', 'zip'] as const) {
    it(`${form}: the description comes back from the header, not from the title page`, () => {
      const { result, xml } = roundTrip(form);
      expect(result.description).toMatchObject({
        title: 'Round Trip',
        authors: [{ firstName: 'Ann', lastName: 'Writer' }],
        sequences: [{ name: 'Saga', number: 2 }],
        lang: 'en',
      });
      expect(result.description.document).toMatchObject({ id: 'round-trip-1', version: '1.2' });
      expect(xml).toContain('<book-title>Round Trip</book-title>');
      expect(xml).toContain('<sequence name="Saga" number="2"/>');
      expect(xml).toContain('<id>round-trip-1</id>');
      // The title page is the description, not text.
      expect(xml).not.toContain('<p><emphasis>Saga #2</emphasis></p>');
      expect(xml).not.toContain('<p><strong>Ann Writer</strong></p>');
    });

    it(`${form}: the stylesheets, the named styles and the blocks come back`, () => {
      const { xml } = roundTrip(form);
      expect(xml).toContain(
        '<stylesheet type="text/css">.letter { font-style: italic; }\n.sign { text-align: right; }</stylesheet>',
      );
      // The span's imitated italic is gone: the named style alone carries the look.
      expect(xml).toContain('<style name="letter">Dear friend</style>');
      expect(xml).toContain('<p style="sign">Signed</p>');
      expect(xml).toContain('<empty-line/>');
      expect(xml).toContain('<th>Room</th>');
      expect(xml).toContain('<td>Hall</td>');
      expect(xml.match(/<section/g)!.length).toBeGreaterThanOrEqual(3);
      expect(xml).toContain('An untitled section.');
      expect(xml).toContain('The note.');
    });
  }
});
