// Feature 018 (T033, contracts/mobi-import.md §2): unit tests for verified MFBE EXTH 59901
// round-trip restoration, partial external-edit fallback, corrupt MFBE fallback, and FBD equality.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { buildKf8 } from '@/features/mobi/export/kf8';
import {
  buildExportPlan,
  buildMfbeRoundTripRecord,
  type MobiExportBuildOptions,
  type PlacedMobiPicture,
} from '@/features/mobi/export/metadata';
import { buildMobi7 } from '@/features/mobi/export/mobi7';
import { convertMobiToFb2 } from '@/features/mobi/import/convert';
import {
  descriptionsCanonicallyEqual,
  resolveMfbeMode,
  serializeDescriptionXml,
  serializeStylesheetsXml,
} from '@/features/mobi/import/roundtrip';
import type { Description, Document } from '@/model/document';

function richDocument(): Document {
  return {
    modelVersion: 1,
    docId: 'doc-rt',
    fileKind: 'fb2',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    extras: [],
    stylesheets: [{ type: 'text/css', content: '.letter { font-style: italic; }' }],
    description: {
      titleInfo: {
        genres: [{ code: 'sf_space', match: 90 }],
        authors: [
          {
            firstName: 'Anna',
            middleName: 'B.',
            lastName: 'Example',
            homePages: ['https://example.org'],
            emails: ['a@b.c'],
          },
        ],
        bookTitle: 'Round Trip Title',
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'a1' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'ap1' },
              content: [
                { type: 'text', text: 'Rich ' },
                { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
              ],
            },
          ],
        },
        keywords: 'alpha, beta',
        date: { value: '2026-03-15', text: '15 March 2026' },
        coverpage: [{ href: '#orig-cover.jpg', alt: 'Cover' }],
        lang: 'en',
        srcLang: 'ru',
        translators: [{ firstName: 'Tr', lastName: 'One', homePages: [], emails: [] }],
        sequences: [{ name: 'Trilogy', number: 2, children: [] }],
      },
      srcTitleInfo: {
        genres: [{ code: 'sf_space' }],
        authors: [{ firstName: 'Анна', lastName: 'Пример', homePages: [], emails: [] }],
        bookTitle: 'Оригинал',
        coverpage: [],
        lang: 'ru',
        translators: [],
        sequences: [],
      },
      documentInfo: {
        authors: [{ nickname: 'editor', homePages: [], emails: [] }],
        programUsed: 'Maxima Fiction Book Editor',
        date: { value: '2026-03-15', text: '2026' },
        srcUrls: ['https://src.example/1'],
        srcOcr: 'OCR Team',
        id: '5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10',
        version: '2.1',
        history: {
          type: 'annotation',
          attrs: { nodeId: 'h1' },
          content: [
            { type: 'p', attrs: { nodeId: 'hp1' }, content: [{ type: 'text', text: 'v2.1 fix' }] },
          ],
        },
        publishers: [],
      },
      publishInfo: {
        bookName: 'Printed Edition',
        publisher: 'Press',
        city: 'Kyiv',
        year: '2026',
        isbn: '978-0-00-000001-2',
        sequences: [],
      },
      customInfo: [{ infoType: 'mlillustrator', text: 'Van_Gogh V.' }],
      outputs: [],
    },
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b0' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 's1', id: 'chap1', lang: 'fr' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 't1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'tp1' },
                    content: [{ type: 'text', text: 'First Chapter' }],
                  },
                ],
              },
              {
                type: 'p',
                attrs: { nodeId: 'p1', style: 'letter' },
                content: [
                  { type: 'text', text: 'Text with ' },
                  {
                    type: 'text',
                    text: 'named',
                    marks: [{ type: 'style', attrs: { name: 'special' } }],
                  },
                  {
                    type: 'text',
                    text: '[1]',
                    marks: [{ type: 'link', attrs: { href: '#n1', type: 'note' } }],
                  },
                ],
              },
              {
                type: 'poem',
                attrs: { nodeId: 'pm1' },
                content: [
                  {
                    type: 'stanza',
                    attrs: { nodeId: 'st1' },
                    content: [
                      {
                        type: 'v',
                        attrs: { nodeId: 'v1' },
                        content: [{ type: 'text', text: 'Ode line' }],
                      },
                    ],
                  },
                  {
                    type: 'date',
                    attrs: { nodeId: 'dt1', value: '1899-12-31' },
                    content: [{ type: 'text', text: 'Dec 1899' }],
                  },
                ],
              },
              {
                type: 'image',
                attrs: { nodeId: 'im1', href: '#orig-fig.png', alt: 'Fig', title: 'Caption Title' },
              },
            ],
          },
          {
            type: 'section',
            attrs: { nodeId: 's2' }, // untitled section preserved!
            content: [
              {
                type: 'p',
                attrs: { nodeId: 'p2' },
                content: [{ type: 'text', text: 'Untitled section text.' }],
              },
            ],
          },
        ],
      },
      {
        type: 'body',
        attrs: { nodeId: 'b1', name: 'notes' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'ns1', id: 'n1' },
            content: [
              {
                type: 'p',
                attrs: { nodeId: 'np1' },
                content: [{ type: 'text', text: 'My note.' }],
              },
            ],
          },
        ],
      },
    ],
    binaries: [
      {
        id: 'orig-cover.jpg',
        contentType: 'image/jpeg',
        size: 100,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
      {
        id: 'orig-fig.png',
        contentType: 'image/png',
        size: 50,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
    ],
  };
}

const PLACED: ReadonlyMap<string, PlacedMobiPicture> = new Map([
  ['orig-cover.jpg', { recindex: 1, mediaType: 'image/jpeg', width: 400, height: 600 }],
  ['orig-fig.png', { recindex: 3, mediaType: 'image/png', width: 200, height: 100 }],
]);

describe('MFBE EXTH 59901 round-trip & external-edit fallback (T033)', () => {
  it('restores complete description, stylesheets, binary IDs, attributes, untitled sections, and notes across MOBI 7 & KF8', () => {
    const doc = richDocument();
    const opts: MobiExportBuildOptions = {
      document: doc,
      pictures: PLACED,
      fallbackTitle: 'Fallback',
      tocPlacement: 'afterTitle',
      seriesInTitle: 'seriesAndNumber',
      openAt: 'titlePage',
      kf8PopupFootnotes: true,
    };
    const plan = buildExportPlan(opts);
    const m7 = buildMobi7(opts, plan);
    const kf8 = buildKf8(opts, plan);
    const mfbe = buildMfbeRoundTripRecord(doc, PLACED, plan.attrs);

    // Serialize description & stylesheets from MFBE record
    const descXml = serializeDescriptionXml(mfbe.description);
    expect(descXml).toContain('<book-title>Round Trip Title</book-title>');
    expect(descXml).not.toContain('Trilogy #2');
    expect(descXml).toContain('<src-title-info>');
    expect(descXml).toContain('<history><p>v2.1 fix</p></history>');
    expect(descXml).toContain('<city>Kyiv</city>');
    expect(descXml).toContain('<custom-info info-type="mlillustrator">Van_Gogh V.</custom-info>');
    expect(descXml).toContain('<annotation><p>Rich <strong>bold</strong></p></annotation>');
    expect(serializeStylesheetsXml(mfbe.stylesheets)).toContain('.letter { font-style: italic; }');

    // Convert both MOBI 7 and KF8 HTML back using MFBE body restoration
    for (const [part, html] of [
      ['mobi7', m7.html.replace(/filepos="0000000000" data-target="([^"]+)"/g, 'href="#$1"')],
      ['kf8', kf8.html],
    ] as const) {
      const imported = convertMobiToFb2({
        activePart: part,
        htmlOrText: html,
        cssFlows: part === 'kf8' ? [kf8.css] : [],
        metadata: plan.metadata,
        navigation: [],
        guide: [],
        pictures: [
          {
            index: 1,
            contentType: 'image/jpeg',
            width: 400,
            height: 600,
            size: 100,
            tooLarge: false,
          },
          {
            index: 2,
            contentType: 'image/jpeg',
            width: 120,
            height: 180,
            size: 50,
            tooLarge: false,
          },
          {
            index: 3,
            contentType: 'image/png',
            width: 200,
            height: 100,
            size: 50,
            tooLarge: false,
          },
        ],
        coverIndex: 1,
        thumbnailIndex: 2,
        mfbeBodyRecord: mfbe,
      });

      // Generated cover/title-page/TOC suppressed
      expect(imported.bodyXml).not.toContain('fb2-title-page');
      expect(imported.bodyXml).not.toContain('fb2-toc');
      // Original binary IDs restored!
      expect(imported.neededPictures.get(1)).toBe('orig-cover.jpg');
      expect(imported.neededPictures.get(3)).toBe('orig-fig.png');
      // Section ID, xml:lang, untitled section, style, date/@value, image/@title restored!
      expect(imported.bodyXml).toContain('<section id="chap1" xml:lang="fr">');
      expect(imported.bodyXml).toContain('<style name="special">named</style>');
      expect(imported.bodyXml).toContain('value="1899-12-31"');
      expect(imported.bodyXml).toContain('title="Caption Title"');
      expect(imported.bodyXml).toContain('Untitled section text.');
      expect(imported.notesXml).toContain('My note.');
    }
  });

  it('handles independent HTML vs metadata external-edit fallback and corrupt MFBE cleanly', () => {
    const doc = richDocument();
    const mfbe = buildMfbeRoundTripRecord(doc, PLACED, {
      bodies: [],
      dates: {},
      imageTitles: {},
      styleNames: {},
      untitledSections: [],
      nodeLangs: {},
    });

    // Metadata externally patched (e.g. ebook-meta), HTML untouched -> keep MFBE body, read EXTH meta
    const metaOnlyEdit = resolveMfbeMode({
      mfbeStatus: 'externallyModified',
      mfbeHtmlMatches: true,
      mfbeMetaMatches: false,
      mfbe,
    });
    expect(metaOnlyEdit.mode).toBe('partial');
    expect(metaOnlyEdit.useBody).toBe(true);
    expect(metaOnlyEdit.useMeta).toBe(false);
    expect(metaOnlyEdit.summary).toEqual([{ kind: 'externallyModified', detail: '' }]);

    // HTML externally patched, metadata untouched -> keep MFBE meta, parse edited HTML as foreign
    const htmlOnlyEdit = resolveMfbeMode({
      mfbeStatus: 'externallyModified',
      mfbeHtmlMatches: false,
      mfbeMetaMatches: true,
      mfbe,
    });
    expect(htmlOnlyEdit.mode).toBe('partial');
    expect(htmlOnlyEdit.useBody).toBe(false);
    expect(htmlOnlyEdit.useMeta).toBe(true);

    // Corrupt MFBE -> foreign import + listedData: MFBE
    const corrupt = resolveMfbeMode({
      mfbeStatus: 'corrupt',
      mfbeHtmlMatches: false,
      mfbeMetaMatches: false,
    });
    expect(corrupt.mode).toBe('foreign');
    expect(corrupt.summary).toEqual([{ kind: 'listedData', detail: 'MFBE' }]);
  });

  it('compares Description values canonically ignoring session nodeIds', () => {
    const a: Description = richDocument().description;
    const b: Description = JSON.parse(JSON.stringify(a));
    b.titleInfo.annotation!.attrs.nodeId = 'different-session-id';
    expect(descriptionsCanonicallyEqual(a, b)).toBe(true);
    b.titleInfo.bookTitle = 'Edited Elsewhere';
    expect(descriptionsCanonicallyEqual(a, b)).toBe(false);
  });
});
