// Feature 018 (T016, contracts/mobi-export.md): unit tests for MOBI 7 HTML 3.2 and KF8 HTML5+CSS
// export rendering, TOC placement, seriesInTitle, openAt, popup footnotes, added words, and gaps.
import { describe, expect, it } from 'vitest';

import { buildKf8 } from '@/features/mobi/export/kf8';
import {
  buildExportPlan,
  buildMfbeRoundTripRecord,
  formatShelfTitle,
  type MobiExportBuildOptions,
  type PlacedMobiPicture,
} from '@/features/mobi/export/metadata';
import { buildMobi7 } from '@/features/mobi/export/mobi7';
import type { Document } from '@/model/document';

function sampleDocument(overrides?: {
  title?: string;
  lang?: string;
  docId?: string;
  withSeries?: boolean;
  withNotes?: boolean;
  withCss?: boolean;
  emptyTitlePage?: boolean;
}): Document {
  const title = overrides?.emptyTitlePage ? '' : (overrides?.title ?? 'The Reference Book');
  const lang = overrides?.lang !== undefined ? overrides.lang : 'en';
  const docId = overrides?.docId !== undefined ? overrides.docId : 'doc-uuid-018';
  return {
    modelVersion: 1,
    docId: 'test-doc-1',
    fileKind: 'fb2',
    sourceEncoding: 'utf-8',
    schemaHint: '2.1',
    extras: [],
    description: {
      titleInfo: {
        genres: [{ code: 'sf_space' }],
        authors: overrides?.emptyTitlePage
          ? []
          : [{ firstName: 'Jane', middleName: '', lastName: 'Author', homePages: [], emails: [] }],
        bookTitle: title,
        annotation: overrides?.emptyTitlePage
          ? undefined
          : {
              type: 'annotation',
              attrs: { nodeId: 'ann1' },
              content: [
                {
                  type: 'p',
                  attrs: { nodeId: 'ap1' },
                  content: [{ type: 'text', text: 'Book summary.' }],
                },
              ],
            },
        keywords: 'space, adventure',
        date: { value: '2026-01-01', text: '2026' },
        coverpage: [{ href: '#cover.jpg' }],
        lang,
        translators: [],
        sequences: overrides?.withSeries ? [{ name: 'Star Saga', number: 3, children: [] }] : [],
      },
      documentInfo: {
        authors: [],
        id: docId,
        version: '1.0',
        date: { text: '' },
        srcUrls: [],
        publishers: [],
      },
      publishInfo: overrides?.emptyTitlePage
        ? undefined
        : {
            publisher: 'Galaxy Press',
            year: '2026',
            isbn: '978-0-00-000001-0',
            sequences: [],
          },
      customInfo: [{ infoType: 'mlillustrator', text: 'Artist Ivan' }],
      outputs: [],
    },
    stylesheets: overrides?.withCss
      ? [
          {
            type: 'text/css',
            content: 'p { color: #222; } .accent { font-weight: bold; } @import "http://bad/";',
          },
          { type: 'text/xsl', content: '<xsl/>' },
        ]
      : [],
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b0' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 's1', id: 'ch1' },
            content: [
              {
                type: 'title',
                attrs: { nodeId: 't1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'tp1' },
                    content: [{ type: 'text', text: 'Chapter One' }],
                  },
                ],
              },
              {
                type: 'epigraph',
                attrs: { nodeId: 'ep1' },
                content: [
                  {
                    type: 'p',
                    attrs: { nodeId: 'epp1' },
                    content: [{ type: 'text', text: 'To the stars.' }],
                  },
                  {
                    type: 'text-author',
                    attrs: { nodeId: 'ta1' },
                    content: [{ type: 'text', text: 'Poet' }],
                  },
                ],
              },
              {
                type: 'p',
                attrs: { nodeId: 'p1' },
                content: [
                  { type: 'text', text: 'Hello ' },
                  { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
                  { type: 'text', text: ' and ' },
                  { type: 'text', text: 'italic', marks: [{ type: 'emphasis' }] },
                  ...(overrides?.withNotes
                    ? [
                        {
                          type: 'text' as const,
                          text: '[1]',
                          marks: [
                            {
                              type: 'link' as const,
                              attrs: { href: '#n1', type: 'note' as const },
                            },
                          ],
                        },
                      ]
                    : []),
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
                        content: [{ type: 'text', text: 'Verse line one' }],
                      },
                    ],
                  },
                  {
                    type: 'date',
                    attrs: { nodeId: 'dt1', value: '1999-05-01' },
                    content: [{ type: 'text', text: 'May 1999' }],
                  },
                ],
              },
              {
                type: 'table',
                attrs: { nodeId: 'tb1' },
                content: [
                  {
                    type: 'tr',
                    attrs: { nodeId: 'tr1' },
                    content: [
                      {
                        type: 'th',
                        attrs: { nodeId: 'th1', align: 'center' },
                        content: [{ type: 'text', text: 'Col' }],
                      },
                      {
                        type: 'td',
                        attrs: { nodeId: 'td1', colspan: 2 },
                        content: [{ type: 'text', text: 'Val' }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'image',
                attrs: { nodeId: 'im1', href: '#fig1.png', alt: 'Diagram', title: 'Figure 1' },
              },
              {
                type: 'section',
                attrs: { nodeId: 's1a', id: 'ch1a' },
                content: [
                  {
                    type: 'title',
                    attrs: { nodeId: 't1a' },
                    content: [
                      {
                        type: 'p',
                        attrs: { nodeId: 'tp1a' },
                        content: [{ type: 'text', text: 'Subchapter A' }],
                      },
                    ],
                  },
                  {
                    type: 'p',
                    attrs: { nodeId: 'p1a' },
                    content: [{ type: 'text', text: 'Nested body text.' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      ...(overrides?.withNotes
        ? [
            {
              type: 'body' as const,
              attrs: { nodeId: 'b1', name: 'notes' },
              content: [
                {
                  type: 'section' as const,
                  attrs: { nodeId: 'ns1', id: 'n1' },
                  content: [
                    {
                      type: 'p' as const,
                      attrs: { nodeId: 'np1' },
                      content: [{ type: 'text' as const, text: 'Footnote explanation.' }],
                    },
                  ],
                },
              ],
            },
          ]
        : []),
    ],
    binaries: [
      {
        id: 'cover.jpg',
        contentType: 'image/jpeg',
        size: 100,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
      {
        id: 'fig1.png',
        contentType: 'image/png',
        size: 50,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
    ],
  };
}

const SAMPLE_PICTURES: ReadonlyMap<string, PlacedMobiPicture> = new Map([
  ['cover.jpg', { recindex: 1, mediaType: 'image/jpeg', width: 600, height: 900 }],
  ['fig1.png', { recindex: 3, mediaType: 'image/png', width: 200, height: 100 }],
]);

function makeOptions(
  doc: Document,
  extra?: Partial<MobiExportBuildOptions>,
): MobiExportBuildOptions {
  return {
    document: doc,
    pictures: SAMPLE_PICTURES,
    fallbackTitle: 'Fallback Stem',
    tocPlacement: 'afterTitle',
    seriesInTitle: 'off',
    openAt: 'titlePage',
    kf8PopupFootnotes: true,
    newId: () => '11111111-2222-3333-4444-555555555555',
    ...extra,
  };
}

describe('MOBI 7 and KF8 export builders (T016)', () => {
  it('renders MOBI 7 HTML 3.2 with recindex, filepos placeholders, classic notes, and nav tree', () => {
    const doc = sampleDocument({ withNotes: true, withSeries: true });
    const opts = makeOptions(doc, { tocPlacement: 'afterTitle', seriesInTitle: 'numberBefore' });
    const plan = buildExportPlan(opts);
    const m7 = buildMobi7(opts, plan);

    // Shelf title has series prefix; title page & description keep original title untouched
    expect(plan.metadata.updatedTitle).toBe('3_The Reference Book');
    expect(m7.html).toContain('<h1 class="fb2-book-title">The Reference Book</h1>');
    expect(m7.html).not.toContain('3_The Reference Book');
    // Inline TOC present after title page
    expect(m7.html).toContain('id="fb2-toc"');
    expect(m7.html.indexOf('id="fb2-title-page"')).toBeLessThan(m7.html.indexOf('id="fb2-toc"'));
    expect(m7.html.indexOf('id="fb2-toc"')).toBeLessThan(m7.html.indexOf('id="fb2-main-start"'));
    // Images use 5-digit recindex; cover not duplicated inline in MOBI 7
    expect(m7.html).toContain('recindex="00003"');
    expect(m7.html).not.toContain('id="fb2-cover"');
    // Classic jump-to-end notes with back-link
    expect(m7.html).toContain('data-target="n1"');
    expect(m7.html).toContain('class="fb2-backlink"');
    // Hierarchical native nav tree built (Annotation bookmarked at start when present)
    expect(m7.nav.map((n) => [n.label, n.depth])).toEqual([
      ['Annotation', 0],
      ['Chapter One', 0],
      ['Subchapter A', 1],
      ['Notes', 0],
    ]);
    // Dedicated annotation page placed after title page and before TOC
    expect(m7.html).toContain('id="fb2-annotation"');
    expect(m7.html.indexOf('id="fb2-title-page"')).toBeLessThan(
      m7.html.indexOf('id="fb2-annotation"'),
    );
    expect(m7.html.indexOf('id="fb2-annotation"')).toBeLessThan(m7.html.indexOf('id="fb2-toc"'));
    expect(m7.counts).toEqual({ sections: 2, pictures: 2, tables: 1, notes: 1 });
    // MFBE round-trip record captures original binary IDs, date/@value, image/@title
    const mfbe = buildMfbeRoundTripRecord(doc, SAMPLE_PICTURES, plan.attrs);
    expect(mfbe.v).toBe(1);
    expect(mfbe.binaries['0001']).toBe('cover.jpg');
    expect(mfbe.binaries['0003']).toBe('fig1.png');
    expect(Object.values(mfbe.attrs.dates)).toContain('1999-05-01');
    expect(Object.values(mfbe.attrs.imageTitles)).toContain('Figure 1');
  });

  it('honours tocPlacement (afterTitle, end, none) while always emitting native nav tree', () => {
    const doc = sampleDocument({ withNotes: true });

    const endOpts = makeOptions(doc, { tocPlacement: 'end' });
    const endPlan = buildExportPlan(endOpts);
    const m7End = buildMobi7(endOpts, endPlan);
    expect(m7End.html.indexOf('id="fb2-notes"')).toBeLessThan(m7End.html.indexOf('id="fb2-toc"'));

    const noneOpts = makeOptions(doc, { tocPlacement: 'none' });
    const nonePlan = buildExportPlan(noneOpts);
    const m7None = buildMobi7(noneOpts, nonePlan);
    expect(m7None.html).not.toContain('id="fb2-toc"');
    // Native nav tree is STILL built when inline TOC is none!
    expect(m7None.nav.length).toBeGreaterThanOrEqual(2);
  });

  it('renders KF8 XHTML5 + translated CSS, single cover via EXTH 201 (no duplicate inline cover), and pop-up footnotes toggle', () => {
    const doc = sampleDocument({ withNotes: true, withCss: true });

    const popupOpts = makeOptions(doc, { kf8PopupFootnotes: true });
    const popupPlan = buildExportPlan(popupOpts);
    const kf8Popup = buildKf8(popupOpts, popupPlan);
    // Cover is rendered natively via EXTH 201 — no duplicate inline fb2-cover page
    expect(kf8Popup.html).not.toContain('id="fb2-cover"');
    expect(kf8Popup.html).not.toContain('kindle:embed:0001?mime=image/jpeg');
    expect(kf8Popup.html).toContain('kindle:embed:0003?mime=image/png');
    expect(kf8Popup.html).toContain('id="fb2-annotation"');
    expect(kf8Popup.html).toContain('epub:type="noteref"');
    expect(kf8Popup.html).toContain('<aside id="n1" class="fb2-note" epub:type="footnote"');
    expect(kf8Popup.css).toContain('.accent');
    // Disallowed @import and non-CSS stylesheet reported in summary
    expect(popupPlan.summary.some((s) => s.kind === 'cssDropped' && s.detail === '@import')).toBe(
      true,
    );
    expect(
      popupPlan.summary.some((s) => s.kind === 'stylesheetDropped' && s.detail === 'text/xsl'),
    ).toBe(true);

    const plainOpts = makeOptions(doc, { kf8PopupFootnotes: false });
    const plainPlan = buildExportPlan(plainOpts);
    const kf8Plain = buildKf8(plainOpts, plainPlan);
    expect(kf8Plain.html).not.toContain('epub:type="noteref"');
    expect(kf8Plain.html).not.toContain('epub:type="footnote"');
    expect(kf8Plain.html).toContain('<div id="n1" class="fb2-note"');
  });

  it('supports all seriesInTitle modes, openAt fallback, book-language words, and missing gaps', () => {
    expect(formatShelfTitle('Dune', [{ name: 'Chronicles', number: 2, children: [] }], 'off')).toBe(
      'Dune',
    );
    expect(
      formatShelfTitle('Dune', [{ name: 'Chronicles', number: 2, children: [] }], 'numberBefore'),
    ).toBe('2_Dune');
    expect(
      formatShelfTitle(
        'Dune',
        [{ name: 'Chronicles', number: 2, children: [] }],
        'seriesAndNumber',
      ),
    ).toBe('Chronicles #2 \u2014 Dune');
    expect(
      formatShelfTitle('Dune', [{ name: 'Chronicles', children: [] }], 'seriesAndNumber'),
    ).toBe('Chronicles \u2014 Dune');

    // Russian added words & openAt = mainText
    const ruDoc = sampleDocument({ lang: 'ru-RU', withNotes: true });
    const ruPlan = buildExportPlan(makeOptions(ruDoc, { openAt: 'mainText' }));
    expect(ruPlan.words.contents).toBe('Содержание');
    expect(ruPlan.words.notes).toBe('Примечания');
    expect(ruPlan.openAtAnchorId).toBe('fb2-main-start');

    // German book falls back to English added words
    const deDoc = sampleDocument({ lang: 'de', withNotes: true });
    const dePlan = buildExportPlan(makeOptions(deDoc));
    expect(dePlan.words.contents).toBe('Contents');
    expect(dePlan.metadata.language).toBe('de');

    // Invalid book missing title, lang, id + empty title page falls back openAt to mainText
    const badDoc = sampleDocument({ emptyTitlePage: true, lang: '', docId: '' });
    const badPlan = buildExportPlan(makeOptions(badDoc, { openAt: 'titlePage' }));
    expect(badPlan.hasTitlePage).toBe(false);
    expect(badPlan.openAtAnchorId).toBe('fb2-main-start');
    expect(badPlan.metadata.title).toBe('Fallback Stem');
    expect(badPlan.metadata.language).toBe('');
    expect(
      badPlan.summary
        .filter((s) => s.kind === 'gapFilled')
        .map((s) => s.detail)
        .sort(),
    ).toEqual(['identifier', 'language', 'title']);
  });
});
