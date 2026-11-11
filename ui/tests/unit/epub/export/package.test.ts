/**
 * Feature 012 (T018; D4, D6, D7, D43; contracts/epub-export.md §2): the package's data of an exported
 * book - people by role (the FBD Maker's labels as contributors), identifiers, series, the
 * accessibility data as the book shows it, and D4's gaps filled in the file only.
 */
import { describe, expect, it } from 'vitest';

import { buildEpub, verifyEpub } from '@/features/epub/export/build';
import type { PlacedPicture } from '@/features/epub/export/render';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../../features/testUtils';

const MODIFIED = new Date('2026-11-10T12:34:56.789Z');

function opfOf(document: Document, pictures = new Map<string, PlacedPicture>()): string {
  return buildEpub({
    document,
    pictures,
    modified: MODIFIED,
    fallbackTitle: 'Fallback',
  }).files.find((file) => file.name === 'EPUB/package.opf')!.text;
}

function bookWith(overrides: Partial<Document['description']['titleInfo']> = {}): Document {
  const document = fakeDocument();
  document.description.titleInfo = { ...document.description.titleInfo, ...overrides };
  document.description.documentInfo.id = '5B0E8A52-3C1D-4F6E-9A7B-2C8D4E6F8A10';
  return document;
}

describe('the EPUB package', () => {
  it('names the people by their roles, the FBD Maker labels included (D6)', () => {
    const document = bookWith({
      authors: [
        { firstName: 'Anna', middleName: 'B.', lastName: 'Example', homePages: [], emails: [] },
      ],
      translators: [{ firstName: 'Peter', lastName: 'Translator', homePages: [], emails: [] }],
    });
    document.description.customInfo = [
      { infoType: 'mlillustrator', text: 'Van_Gogh Vincent' },
      { infoType: 'mleditor', text: 'Редактор Ю.' },
      { infoType: 'mlabouttheauthor', text: 'Somebody Else' },
    ];
    const opf = opfOf(document);
    expect(opf).toContain('>Anna B. Example</dc:creator>');
    expect(opf).toContain('property="file-as">Example, Anna B.</meta>');
    expect(opf).toContain('>Peter Translator</dc:contributor>');
    expect(opf).toContain('>Vincent Van Gogh</dc:contributor>');
    expect(opf).toContain('property="file-as">Van Gogh, Vincent</meta>');
    expect(opf).toContain('>Ю. Редактор</dc:contributor>');
    for (const role of ['aut', 'trl', 'ill', 'edt']) {
      expect(opf).toContain(`scheme="marc:relators">${role}</meta>`);
    }
    // The person the book is about has no role in EPUB: only in the editor's own data (D7).
    expect(opf).not.toContain('>Somebody Else</dc:contributor>');
  });

  it('keeps one identifier across exports, with series, ISBN and the modification time', () => {
    const document = bookWith({ sequences: [{ name: 'The Series', number: 3, children: [] }] });
    document.description.publishInfo = {
      publisher: 'Example Press',
      isbn: '978 0 00 000000 2',
      year: '2026',
      sequences: [],
    };
    const first = opfOf(document);
    expect(opfOf(document)).toBe(first);
    expect(first).toContain(
      '<dc:identifier id="uid">urn:uuid:5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10</dc:identifier>',
    );
    expect(first).toContain('<dc:identifier id="isbn">urn:isbn:9780000000002</dc:identifier>');
    expect(first).toContain('<dc:publisher>Example Press</dc:publisher>');
    expect(first).toContain('<dc:date>2026</dc:date>');
    expect(first).toContain('<meta refines="#series1" property="group-position">3</meta>');
    expect(first).toContain('<meta name="calibre:series_index" content="3"/>');
    expect(first).toContain('<meta property="dcterms:modified">2026-11-10T12:34:56Z</meta>');
    expect(first).toContain('<meta property="mfbe:fb2-description">');
  });

  it('describes the accessibility as the book shows it, and claims no conformance (D43)', () => {
    const textOnly = opfOf(bookWith());
    expect(textOnly).toContain('<meta property="schema:accessMode">textual</meta>');
    expect(textOnly).not.toContain('>visual</meta>');
    expect(textOnly).toContain('<meta property="schema:accessModeSufficient">textual</meta>');
    expect(textOnly).toContain('<meta property="schema:accessibilityHazard">none</meta>');
    expect(textOnly).toContain('The book is text only.');
    expect(textOnly).not.toContain('conformsTo');

    const pictured = bookWith();
    const body = pictured.bodies[0] as BodyNode;
    (body.content[0] as { content: unknown[] }).content.push(
      { type: 'image', attrs: { nodeId: 'i1', href: '#a', alt: 'A' } },
      { type: 'p', attrs: { nodeId: 'p9' }, content: [{ type: 'text', text: 'x' }] },
      { type: 'image', attrs: { nodeId: 'i2', href: '#b' } },
    );
    const pictures = new Map<string, PlacedPicture>([
      ['a', { name: 'EPUB/images/a.png', mediaType: 'image/png' }],
      ['b', { name: 'EPUB/images/b.jpg', mediaType: 'image/jpeg' }],
    ]);
    const someAlt = opfOf(pictured, pictures);
    expect(someAlt).toContain('<meta property="schema:accessMode">visual</meta>');
    expect(someAlt).toContain('<meta property="schema:accessModeSufficient">textual,visual</meta>');
    expect(someAlt).not.toContain('alternativeText');
    (body.content[0] as { content: Array<{ attrs: { alt?: string } }> }).content.at(-1)!.attrs.alt =
      'B';
    const allAlt = opfOf(pictured, pictures);
    expect(allAlt).toContain('<meta property="schema:accessibilityFeature">alternativeText</meta>');
    expect(allAlt).toContain('every picture has a text alternative');
  });

  it('fills the gaps of a book that fails validation, in the file only, and lists them (D4)', () => {
    const document = bookWith({ bookTitle: '', lang: '' });
    document.description.documentInfo.id = '';
    const built = buildEpub({
      document,
      pictures: new Map(),
      modified: MODIFIED,
      fallbackTitle: 'Fallback',
      newId: () => '11111111-2222-4333-8444-555555555555',
    });
    const opf = built.files.find((file) => file.name === 'EPUB/package.opf')!.text;
    expect(opf).toContain('<dc:title>Fallback</dc:title>');
    expect(opf).toContain('<dc:language>und</dc:language>');
    expect(opf).toContain('urn:uuid:11111111-2222-4333-8444-555555555555');
    expect(
      built.summary.filter((item) => item.kind === 'gapFilled').map((item) => item.detail),
    ).toEqual(['language', 'title', 'identifier']);
    expect(document.description.titleInfo.bookTitle).toBe('');
    expect(verifyEpub(built.files, [])).toEqual([]);
  });
});
