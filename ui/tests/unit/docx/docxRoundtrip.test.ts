/**
 * Feature 023 (T029): unit tests for reversible DOCX round-trip codec and external-edit recovery
 * (export -> Custom XML zlib+base64 -> SHA-256 untouched vs modified detection -> front/back-matter
 * stripping, skipped leading cover restoration, full description/stylesheets/custom-info/notes
 * restoration, external Word text edit preservation, and corrupted Custom XML fallback).
 */
import { describe, expect, it } from 'vitest';

import {
  buildDocxPackage,
  type StagedDocxPicture,
} from '@/features/docx/export/docxDocumentBuilder';
import { assembleDocxToFb2Xml } from '@/features/docx/import/docxFb2Assembler';
import { parseDocxOoxml } from '@/features/docx/import/docxOoxmlParser';
import { resolveDocxRoundtrip } from '@/features/docx/import/docxRoundtripRestorer';
import type { Document } from '@/model/document';

const TEMPLATE_XML = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>unrecognised</genre>
      <author><first-name/><last-name/></author>
      <book-title/>
      <lang>en</lang>
    </title-info>
    <document-info>
      <author><nickname>editor</nickname></author>
      <date>2026-11-28</date>
      <id>fallback-id</id>
      <version>1.0</version>
    </document-info>
  </description>
  <body><section><p/></section></body>
</FictionBook>`;

function makeRichBook(): { doc: Document; pics: Map<string, StagedDocxPicture> } {
  const doc: Document = {
    modelVersion: 1,
    docId: 'rt-1',
    fileKind: 'fb2',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    stylesheets: [
      { type: 'text/css', content: '.highlight { color: #0044aa; font-weight: bold; }' },
    ],
    description: {
      titleInfo: {
        genres: [{ code: 'sf_history' }],
        authors: [{ firstName: 'Stanislaw', lastName: 'Lem', homePages: [], emails: [] }],
        bookTitle: 'Solaris Chronicles',
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'ann-1' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'ann-p1' },
              content: [
                { type: 'text', text: 'Rich ' },
                { type: 'text', text: 'annotated', marks: [{ type: 'emphasis' }] },
                { type: 'text', text: ' blurb.' },
              ],
            },
          ],
        },
        coverpage: [{ href: '#cover.jpg', alt: 'Cover art' }],
        lang: 'en',
        translators: [],
        sequences: [{ name: 'Classics', number: 3, children: [] }],
      },
      documentInfo: {
        authors: [{ nickname: 'archivist', homePages: [], emails: [] }],
        date: { text: '2026-11-28', value: '2026-11-28' },
        srcUrls: [],
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        version: '2.0',
        history: {
          type: 'annotation',
          attrs: { nodeId: 'h-1' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'hp-1' },
              content: [{ type: 'text', text: 'v2.0 proofed.' }],
            },
          ],
        },
        publishers: [],
      },
      publishInfo: {
        publisher: 'Orbital Press',
        city: 'Warsaw',
        year: '2026',
        isbn: '978-0-00-000000-0',
        sequences: [],
      },
      customInfo: [
        { infoType: 'mleditor', text: 'Kowalski J.' },
        { infoType: 'maxima-book-id', text: '424242' },
      ],
      outputs: [],
    },
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b-main' },
        content: [
          // Exact-match duplicate leading body cover (same binaryId) — suppressed in DOCX, restored on round-trip!
          { type: 'image', attrs: { nodeId: 'lead-cov', href: '#cover.jpg', alt: 'Lead cover' } },
          {
            type: 'section',
            attrs: { nodeId: 's-1', id: 'sec_one' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 'st-1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'stp-1' },
                    content: [{ type: 'text', text: 'Arrival' }],
                  },
                ],
              },
              {
                type: 'epigraph',
                attrs: { nodeId: 'ep-1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'epp-1' },
                    content: [{ type: 'text', text: 'Look to the ocean.' }],
                  },
                  {
                    type: 'text-author',
                    attrs: { nodeId: 'epa-1' },
                    content: [{ type: 'text', text: 'Kelvin' }],
                  },
                ],
              },
              {
                type: 'p',
                attrs: { nodeId: 'p-1', style: 'highlight' },
                content: [
                  { type: 'text', text: 'First paragraph with ' },
                  {
                    type: 'text',
                    text: 'styled span',
                    marks: [{ type: 'style', attrs: { name: 'highlight' } }],
                  },
                  { type: 'text', text: ' and note' },
                  {
                    type: 'text',
                    text: '[1]',
                    marks: [{ type: 'link', attrs: { href: '#fn1', type: 'note' } }],
                  },
                  { type: 'text', text: '.' },
                ],
              },
              {
                type: 'poem',
                attrs: { nodeId: 'poem-1' },
                content: [
                  {
                    type: 'stanza',
                    attrs: { nodeId: 'stz-1' },
                    content: [
                      {
                        type: 'v',
                        attrs: { nodeId: 'v-1' },
                        content: [{ type: 'text', text: 'Waves of silver,' }],
                      },
                      {
                        type: 'v',
                        attrs: { nodeId: 'v-2' },
                        content: [{ type: 'text', text: 'Silent sky.' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'body',
        attrs: { nodeId: 'b-notes', name: 'notes' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'ng-1' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 'ngt-1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'ngtp-1' },
                    content: [{ type: 'text', text: 'Chapter Notes' }],
                  },
                ],
              },
              {
                type: 'section',
                attrs: { nodeId: 'ns-1', id: 'fn1' },
                content: [
                  {
                    type: 'title',
                    attrs: { nodeId: 'nst-1' },
                    content: [
                      {
                        type: 'p',
                        attrs: { nodeId: 'nstp-1' },
                        content: [{ type: 'text', text: '1' }],
                      },
                    ],
                  },
                  {
                    type: 'p',
                    attrs: { nodeId: 'nsp-1' },
                    content: [{ type: 'text', text: 'Solaris is a living planet.' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    binaries: [
      {
        id: 'cover.jpg',
        contentType: 'image/jpeg',
        size: 512,
        width: 800,
        height: 1200,
        decodable: true,
        willConvert: false,
        referenceCount: 2,
      },
    ],
    extras: [],
  };

  const pics = new Map<string, StagedDocxPicture>([
    [
      'cover.jpg',
      {
        binaryId: 'cover.jpg',
        mediaName: 'word/media/image1.jpg',
        contentType: 'image/jpeg',
        width: 800,
        height: 1200,
        bytes: 512,
        sha256: 'deadbeef',
        converted: false,
      },
    ],
  ]);

  return { doc, pics };
}

describe('DOCX reversible round-trip codec & external edit recovery', () => {
  it('restores untouched editor-exported DOCX with exact digests, full metadata, stylesheets, cover, epigraph, poem, and grouped notes', async () => {
    const { doc, pics } = makeRichBook();
    const exported = await buildDocxPackage({
      document: doc,
      pictures: pics,
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });

    const part = (name: string) => exported.parts.find((p) => p.name === name)?.content;
    const rt = await resolveDocxRoundtrip({
      customXmlParts: [part('customXml/item1.xml')!],
      documentXml: part('word/document.xml')!,
      documentRelsXml: part('word/_rels/document.xml.rels'),
      notesXml: part('word/footnotes.xml'),
      notesRelsXml: part('word/_rels/footnotes.xml.rels'),
      coreXml: part('docProps/core.xml'),
    });

    expect(rt.mode).toBe('exact');
    expect(rt.summary).toHaveLength(0);

    const parsed = parseDocxOoxml({
      documentXml: part('word/document.xml')!,
      documentRelsXml: part('word/_rels/document.xml.rels'),
      stylesXml: part('word/styles.xml'),
      footnotesXml: part('word/footnotes.xml'),
      footnotesRelsXml: part('word/_rels/footnotes.xml.rels'),
      coreXml: part('docProps/core.xml'),
      roundtrip: rt,
    });
    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: TEMPLATE_XML,
      fallbackTitle: 'Fallback',
    });

    expect(assembled.useEmbeddedMeta).toBe(true);
    // Restored full description + custom-info (FBD Maker + Maxima identity) + stylesheet
    expect(assembled.fb2Xml).toContain(
      '<custom-info info-type="mleditor">Kowalski J.</custom-info>',
    );
    expect(assembled.fb2Xml).toContain(
      '<custom-info info-type="maxima-book-id">424242</custom-info>',
    );
    expect(assembled.fb2Xml).toContain('.highlight { color: #0044aa; font-weight: bold; }');
    expect(assembled.fb2Xml).toContain('<isbn>978-0-00-000000-0</isbn>');
    // Restored skipped leading cover in main body AND coverpage in description + neededImages includes cover
    expect(assembled.fb2Xml).toContain('<body><image l:href="#cover.jpg" alt="Lead cover"/>');
    expect(assembled.neededImages.has('word/media/image1.jpg')).toBe(true);
    expect(assembled.neededImages.get('word/media/image1.jpg')?.suggestedBinaryId).toBe(
      'cover.jpg',
    );
    // Stripped generated title/TOC/colophon so they are NOT duplicated as body sections
    expect(assembled.fb2Xml).not.toContain('Table of Contents');
    expect(assembled.fb2Xml).not.toContain('Revision History');
    // Original section ID preserved without duplicate suffix, and synthetic round-trip bookmark IDs never leak
    expect(assembled.fb2Xml).toContain('<section id="sec_one">');
    expect(assembled.fb2Xml).not.toMatch(/\bid="(?:blk|el|dt|tbl|mfbe)_/);
    // Restored epigraph, poem/stanza/v, inline style, and grouped notes body
    expect(assembled.fb2Xml).toContain(
      '<epigraph><p>Look to the ocean.</p><text-author>Kelvin</text-author></epigraph>',
    );
    expect(assembled.fb2Xml).toContain(
      '<poem><stanza><v>Waves of silver,</v><v>Silent sky.</v></stanza></poem>',
    );
    expect(assembled.fb2Xml).toContain('<style name="highlight">styled span</style>');
    expect(assembled.fb2Xml).toContain(
      '<body name="notes"><section><title><p>Chapter Notes</p></title><section id="fn1">',
    );
  });

  it('detects external Word edits, keeps edited text while preserving embedded FB2 description, stylesheets, and undamaged block hints', async () => {
    const { doc, pics } = makeRichBook();
    const exported = await buildDocxPackage({
      document: doc,
      pictures: pics,
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });

    const part = (name: string) => exported.parts.find((p) => p.name === name)?.content;
    // Simulate an external edit in Microsoft Word / LibreOffice changing prose inside paragraph 1.
    const editedDocXml = part('word/document.xml')!.replace(
      'First paragraph with ',
      'Externally revised paragraph with ',
    );

    const rt = await resolveDocxRoundtrip({
      customXmlParts: [part('customXml/item1.xml')!],
      documentXml: editedDocXml,
      documentRelsXml: part('word/_rels/document.xml.rels'),
      notesXml: part('word/footnotes.xml'),
      coreXml: part('docProps/core.xml'),
    });

    expect(rt.mode).toBe('modified');
    expect(rt.summary.some((s) => s.kind === 'externallyModified')).toBe(true);

    const parsed = parseDocxOoxml({
      documentXml: editedDocXml,
      documentRelsXml: part('word/_rels/document.xml.rels'),
      stylesXml: part('word/styles.xml'),
      footnotesXml: part('word/footnotes.xml'),
      coreXml: part('docProps/core.xml'),
      roundtrip: rt,
    });
    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: TEMPLATE_XML,
      fallbackTitle: 'Fallback',
    });

    // External edit is preserved!
    expect(assembled.fb2Xml).toContain('Externally revised paragraph with');
    // Embedded FB2 description & stylesheets & untouched epigraph/poem survive!
    expect(assembled.fb2Xml).toContain(
      '<custom-info info-type="maxima-book-id">424242</custom-info>',
    );
    expect(assembled.fb2Xml).toContain(
      '<epigraph><p>Look to the ocean.</p><text-author>Kelvin</text-author></epigraph>',
    );
    expect(assembled.fb2Xml).toContain(
      '<poem><stanza><v>Waves of silver,</v><v>Silent sky.</v></stanza></poem>',
    );
  });

  it('falls back cleanly to foreign import when Custom XML payload is corrupted', async () => {
    const { doc, pics } = makeRichBook();
    const exported = await buildDocxPackage({
      document: doc,
      pictures: pics,
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });

    const part = (name: string) => exported.parts.find((p) => p.name === name)?.content;
    const corruptedCustomXml = part('customXml/item1.xml')!.replace(
      />[^<]+<\/mfbeRecord>/,
      '>NOT_VALID_BASE64!!!</mfbeRecord>',
    );

    const rt = await resolveDocxRoundtrip({
      customXmlParts: [corruptedCustomXml],
      documentXml: part('word/document.xml')!,
      documentRelsXml: part('word/_rels/document.xml.rels'),
      coreXml: part('docProps/core.xml'),
    });

    expect(rt.mode).toBe('foreignFallback');
    expect(rt.payload).toBeNull();
    expect(rt.summary.some((s) => s.kind === 'mfbeDamagedFallback')).toBe(true);
  });
});
