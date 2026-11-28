/**
 * Feature 023 (T016): unit tests for DOCX export (`docxCssMapper.ts`, `docxDocumentBuilder.ts`,
 * page sizes/margins, named fonts, native TOC without `w:updateFields`, front-matter vs body
 * section breaks & footer page numbers, exact-match leading cover suppression, footnotes/endnotes
 * + unreferenced notes, CSS translation & summary, Dublin Core properties, invalid FB2 repairs).
 */
import { describe, expect, it } from 'vitest';

import {
  buildDocxPackage,
  type StagedDocxPicture,
} from '@/features/docx/export/docxDocumentBuilder';
import {
  DOCX_DEFAULTS,
  docxMarginMm,
  resolveDocxFontFamily,
} from '@/features/docx/docxSettingsSchema';
import { PDF_PAGE_SIZES } from '@/features/pdf/pageSizes';
import type { Document } from '@/model/document';

function makeBaseDoc(overrides: Partial<Document> = {}): Document {
  return {
    modelVersion: 1,
    docId: 'doc-1',
    fileKind: 'fb2',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    stylesheets: [],
    description: {
      titleInfo: {
        genres: [{ code: 'sf' }],
        authors: [{ firstName: 'Ada', lastName: 'Lovelace', homePages: [], emails: [] }],
        bookTitle: 'The Analytical Book',
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'ann-1' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'ann-p1' },
              content: [{ type: 'text', text: 'A concise summary of the book.' }],
            },
          ],
        },
        keywords: 'engines, poetry',
        coverpage: [{ href: '#cover.jpg', alt: 'Book cover' }],
        lang: 'en',
        translators: [],
        sequences: [{ name: 'Engines', number: 1, children: [] }],
      },
      documentInfo: {
        authors: [{ nickname: 'editor', homePages: [], emails: [] }],
        date: { text: '2026-11-28', value: '2026-11-28' },
        srcUrls: [],
        id: '11111111-2222-4333-8444-555555555555',
        version: '1.2',
        history: {
          type: 'annotation',
          attrs: { nodeId: 'hist-1' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'hist-p1' },
              content: [{ type: 'text', text: 'First edition prepared.' }],
            },
          ],
        },
        publishers: [],
      },
      publishInfo: {
        publisher: 'Maxima Press',
        city: 'Kyiv',
        year: '2026',
        sequences: [],
      },
      customInfo: [],
      outputs: [],
    },
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'body-1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'sec-1', id: 'ch1' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 't-1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'tp-1' },
                    content: [{ type: 'text', text: 'Chapter One' }],
                  },
                ],
              },
              {
                type: 'p',
                attrs: { nodeId: 'p-1' },
                content: [
                  { type: 'text', text: 'Hello ' },
                  { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
                  { type: 'text', text: ' world' },
                  {
                    type: 'text',
                    text: '[1]',
                    marks: [{ type: 'link', attrs: { href: '#n1', type: 'note' } }],
                  },
                  { type: 'text', text: '.' },
                ],
              },
              {
                type: 'table',
                attrs: { nodeId: 'tbl-1', id: 't1' },
                content: [
                  {
                    type: 'tr',
                    attrs: { nodeId: 'tr-1' },
                    content: [
                      {
                        type: 'th',
                        attrs: { nodeId: 'th-1', colspan: 2, align: 'center' },
                        content: [{ type: 'text', text: 'Header Span' }],
                      },
                    ],
                  },
                  {
                    type: 'tr',
                    attrs: { nodeId: 'tr-2' },
                    content: [
                      {
                        type: 'td',
                        attrs: { nodeId: 'td-1', rowspan: 2, valign: 'middle' },
                        content: [{ type: 'text', text: 'Tall Cell' }],
                      },
                      {
                        type: 'td',
                        attrs: { nodeId: 'td-2', align: 'right' },
                        content: [{ type: 'text', text: 'R1C2' }],
                      },
                    ],
                  },
                  {
                    type: 'tr',
                    attrs: { nodeId: 'tr-3' },
                    content: [
                      {
                        type: 'td',
                        attrs: { nodeId: 'td-3' },
                        content: [{ type: 'text', text: 'R2C2' }],
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
        attrs: { nodeId: 'body-notes', name: 'notes' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'n-sec-1', id: 'n1' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 'nt-1' },
                content: [
                  { type: 'p', attrs: { nodeId: 'ntp-1' }, content: [{ type: 'text', text: '1' }] },
                ],
              },
              {
                type: 'p',
                attrs: { nodeId: 'np-1' },
                content: [{ type: 'text', text: 'Referenced footnote explanation.' }],
              },
            ],
          },
          {
            type: 'section',
            attrs: { nodeId: 'n-sec-2', id: 'n2' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 'nt-2' },
                content: [
                  { type: 'p', attrs: { nodeId: 'ntp-2' }, content: [{ type: 'text', text: '2' }] },
                ],
              },
              {
                type: 'p',
                attrs: { nodeId: 'np-2' },
                content: [
                  { type: 'text', text: 'Unreferenced note kept in closing Notes section.' },
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
        size: 120,
        width: 600,
        height: 900,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
    ],
    extras: [],
    ...overrides,
  };
}

function makePictures(entries: StagedDocxPicture[]): Map<string, StagedDocxPicture> {
  return new Map(entries.map((p) => [p.binaryId, p]));
}

describe('DOCX export builder', () => {
  it('supports all 9 portrait page sizes with proportional margins in twips', async () => {
    const doc = makeBaseDoc();
    const pics = makePictures([
      {
        binaryId: 'cover.jpg',
        mediaName: 'word/media/image1.jpg',
        contentType: 'image/jpeg',
        width: 600,
        height: 900,
        bytes: 120,
        sha256: 'aaaa',
        converted: false,
      },
    ]);

    for (const sz of PDF_PAGE_SIZES) {
      const built = await buildDocxPackage({
        document: doc,
        pictures: pics,
        settings: { ...DOCX_DEFAULTS, defaultPageSize: sz.id, margins: 'wide' },
        fallbackTitle: 'Fallback',
        appVersion: '0.0.16',
      });
      const documentXml = built.parts.find((p) => p.name === 'word/document.xml')!.content;
      const expectedW = Math.round(sz.widthIn * 1440);
      const expectedH = Math.round(sz.heightIn * 1440);
      const expectedMargin = Math.round((docxMarginMm(sz.id, { margins: 'wide' }) / 25.4) * 1440);
      expect(documentXml).toContain(`w:pgSz w:w="${expectedW}" w:h="${expectedH}"`);
      expect(documentXml).toContain(`w:top="${expectedMargin}"`);
    }
  });

  it('writes curated or custom named fonts without embedding and falls back to Georgia when blank', async () => {
    expect(resolveDocxFontFamily({ fontFamily: 'custom', customFontFamily: '   ' })).toBe(
      'Georgia',
    );
    expect(resolveDocxFontFamily({ fontFamily: 'custom', customFontFamily: 'Palatino' })).toBe(
      'Palatino',
    );

    const built = await buildDocxPackage({
      document: makeBaseDoc(),
      pictures: new Map(),
      settings: {
        ...DOCX_DEFAULTS,
        fontFamily: 'custom',
        customFontFamily: 'Palatino',
        textSizePt: 14,
      },
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });
    const stylesXml = built.parts.find((p) => p.name === 'word/styles.xml')!.content;
    expect(stylesXml).toContain('w:ascii="Palatino"');
    expect(stylesXml).toContain('<w:sz w:val="28"/>');
    expect(built.parts.some((p) => p.name.includes('fontTable') || p.name.includes('.ttf'))).toBe(
      false,
    );
  });

  it('emits pre-populated clickable native TOC without updateFields popup and suppresses footer on front matter', async () => {
    const built = await buildDocxPackage({
      document: makeBaseDoc(),
      pictures: makePictures([
        {
          binaryId: 'cover.jpg',
          mediaName: 'word/media/image1.jpg',
          contentType: 'image/jpeg',
          width: 600,
          height: 900,
          bytes: 120,
          sha256: 'aaaa',
          converted: false,
        },
      ]),
      settings: { ...DOCX_DEFAULTS, tocPlacement: 'afterTitle' },
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });

    const documentXml = built.parts.find((p) => p.name === 'word/document.xml')!.content;
    const settingsXml = built.parts.find((p) => p.name === 'word/settings.xml')!.content;
    const footerXml = built.parts.find((p) => p.name === 'word/footer1.xml')!.content;

    expect(settingsXml).not.toContain('updateFields');
    expect(documentXml).toContain('TOC \\o "1-6" \\h \\z \\u');
    expect(documentXml).toContain('<w:pStyle w:val="TOC1"/>');
    expect(documentXml).toContain('Chapter One');

    // Front matter sectPr has NO footerReference; final body sectPr has footerReference & start=1.
    const sectPrMatches = documentXml.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g) ?? [];
    expect(sectPrMatches.length).toBe(2);
    expect(sectPrMatches[0]).not.toContain('footerReference');
    expect(sectPrMatches[1]).toContain('footerReference w:type="default" r:id="rIdFooter1"');
    expect(sectPrMatches[1]).toContain('<w:pgNumType w:start="1"/>');
    expect(footerXml).toContain('<w:jc w:val="center"/>');
    expect(footerXml).toContain(' PAGE ');
  });

  it('places referenced notes in footnotes or endnotes and prints unreferenced notes in a closing Notes section', async () => {
    const fnBuilt = await buildDocxPackage({
      document: makeBaseDoc(),
      pictures: new Map(),
      settings: { ...DOCX_DEFAULTS, notesPlacement: 'footnotes' },
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });
    const footnotesXml = fnBuilt.parts.find((p) => p.name === 'word/footnotes.xml')?.content ?? '';
    const fnDocXml = fnBuilt.parts.find((p) => p.name === 'word/document.xml')!.content;
    expect(footnotesXml).toContain('w:type="separator" w:id="-1"');
    expect(footnotesXml).toContain('w:type="continuationSeparator" w:id="0"');
    expect(footnotesXml).toContain('Referenced footnote explanation.');
    expect(fnDocXml).toContain('<w:footnoteReference w:id="1"/>');
    expect(fnDocXml).toContain('Unreferenced note kept in closing Notes section.');
    expect(fnBuilt.parts.some((p) => p.name === 'word/endnotes.xml')).toBe(false);

    const enBuilt = await buildDocxPackage({
      document: makeBaseDoc(),
      pictures: new Map(),
      settings: { ...DOCX_DEFAULTS, notesPlacement: 'endnotes' },
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });
    const endnotesXml = enBuilt.parts.find((p) => p.name === 'word/endnotes.xml')?.content ?? '';
    const enDocXml = enBuilt.parts.find((p) => p.name === 'word/document.xml')!.content;
    expect(endnotesXml).toContain('Referenced footnote explanation.');
    expect(enDocXml).toContain('<w:endnoteReference w:id="1"/>');
    expect(enBuilt.parts.some((p) => p.name === 'word/footnotes.xml')).toBe(false);
  });

  it('suppresses exact-match duplicate leading body cover (by ID or SHA-256) but retains distinct frontispiece', async () => {
    const dupByShaDoc = makeBaseDoc();
    dupByShaDoc.bodies[0]!.content.unshift({
      type: 'image',
      attrs: { nodeId: 'lead-img', href: '#cover-copy.jpg', alt: 'Dup cover' },
    });
    const dupPics = makePictures([
      {
        binaryId: 'cover.jpg',
        mediaName: 'word/media/image1.jpg',
        contentType: 'image/jpeg',
        width: 600,
        height: 900,
        bytes: 120,
        sha256: 'same-digest-1234',
        converted: false,
      },
      {
        binaryId: 'cover-copy.jpg',
        mediaName: 'word/media/image2.jpg',
        contentType: 'image/jpeg',
        width: 600,
        height: 900,
        bytes: 120,
        sha256: 'same-digest-1234',
        converted: false,
      },
    ]);
    const dupBuilt = await buildDocxPackage({
      document: dupByShaDoc,
      pictures: dupPics,
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });
    const dupDocXml = dupBuilt.parts.find((p) => p.name === 'word/document.xml')!.content;
    // Only 1 drawing (the cover page), not 2!
    expect((dupDocXml.match(/<w:drawing>/g) ?? []).length).toBe(1);

    const distinctPics = makePictures([
      {
        binaryId: 'cover.jpg',
        mediaName: 'word/media/image1.jpg',
        contentType: 'image/jpeg',
        width: 600,
        height: 900,
        bytes: 120,
        sha256: 'cover-digest',
        converted: false,
      },
      {
        binaryId: 'cover-copy.jpg',
        mediaName: 'word/media/image2.jpg',
        contentType: 'image/jpeg',
        width: 500,
        height: 500,
        bytes: 150,
        sha256: 'different-frontispiece-digest',
        converted: false,
      },
    ]);
    const distinctBuilt = await buildDocxPackage({
      document: dupByShaDoc,
      pictures: distinctPics,
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });
    const distinctDocXml = distinctBuilt.parts.find((p) => p.name === 'word/document.xml')!.content;
    expect((distinctDocXml.match(/<w:drawing>/g) ?? []).length).toBe(2);
  });

  it('translates FB2 CSS rules into Word styles, reports unsupported CSS rules, and repairs blank titles without mutating input', async () => {
    const doc = makeBaseDoc({
      stylesheets: [
        {
          type: 'text/css',
          content:
            '.accent { color: #cc0000; font-weight: bold; text-align: center; float: left; } @media print { p { color: black; } }',
        },
        { type: 'text/xsl', content: '<xsl:stylesheet/>' },
      ],
    });
    doc.description.titleInfo.bookTitle = '   ';
    (doc.bodies[0]!.content[0] as { content: unknown[] }).content.push({
      type: 'p',
      attrs: { nodeId: 'p-styled', style: 'accent' },
      content: [{ type: 'text', text: 'Styled paragraph' }],
    });

    const built = await buildDocxPackage({
      document: doc,
      pictures: new Map(),
      fallbackTitle: 'Fallback Stem Title',
      appVersion: '0.0.16',
    });

    // Open document must never be mutated.
    expect(doc.description.titleInfo.bookTitle).toBe('   ');

    const stylesXml = built.parts.find((p) => p.name === 'word/styles.xml')!.content;
    const coreXml = built.parts.find((p) => p.name === 'docProps/core.xml')!.content;
    const customXml = built.parts.find((p) => p.name === 'customXml/item1.xml')!.content;

    expect(stylesXml).toContain('w:styleId="MfbeStyle_1"');
    expect(stylesXml).toContain('<w:color w:val="CC0000"/>');
    expect(stylesXml).toContain('<w:jc w:val="center"/>');
    expect(coreXml).toContain('<dc:title>Fallback Stem Title</dc:title>');
    expect(coreXml).toContain('<dc:creator>Ada Lovelace</dc:creator>');
    expect(coreXml).toContain('<dc:language>en</dc:language>');
    expect(customXml).toContain('urn:maxima-fbeditor:docx-roundtrip:v1');
    expect(customXml).toContain('bodyDigest="');

    expect(built.summary.some((s) => s.kind === 'repairedTitle')).toBe(true);
    expect(built.summary.some((s) => s.kind === 'unsupportedCssRule' && s.detail === 'float')).toBe(
      true,
    );
    expect(
      built.summary.some((s) => s.kind === 'nonCssStylesheet' && s.detail === 'text/xsl'),
    ).toBe(true);
  });

  it('emits valid colspan, rowspan vMerge continuation cells, and header row flags for FB2 tables', async () => {
    const built = await buildDocxPackage({
      document: makeBaseDoc(),
      pictures: new Map(),
      fallbackTitle: 'Fallback',
      appVersion: '0.0.16',
    });
    const documentXml = built.parts.find((p) => p.name === 'word/document.xml')!.content;
    expect(documentXml).toContain('<w:tblHeader/>');
    expect(documentXml).toContain('<w:gridSpan w:val="2"/>');
    expect(documentXml).toContain('<w:vMerge w:val="restart"/>');
    expect(documentXml).toContain('<w:vMerge/>');
    expect(built.counts.tables).toBe(1);
  });
});
