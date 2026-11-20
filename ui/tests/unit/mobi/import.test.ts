// Feature 018 (T025, contracts/mobi-import.md §3): unit tests for foreign MOBI 7, KF8, and
// PalmDOC conversion to FB2, converter marks, CSS planning, SVG unwrap/draw, MathML, notes, EXTH.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { convertMobiToFb2 } from '@/features/mobi/import/convert';
import { buildForeignDescription, splitPersonName } from '@/features/mobi/import/metadata';
import type { GenreEntry } from '@/rpc/types';

const SAMPLE_GENRES: GenreEntry[] = [
  {
    code: 'sf_space',
    category: 'sf',
    source: 'standard',
    names: { en: 'Space Fiction', ru: 'Космическая фантастика', uk: 'Космічна фантастика' },
  },
  {
    code: 'prose_classic',
    category: 'prose',
    source: 'standard',
    names: { en: 'Classic Prose', ru: 'Классическая проза', uk: 'Класична проза' },
  },
];

describe('MOBI / KF8 / PalmDOC foreign import conversion (T025)', () => {
  it('maps EXTH metadata, FBD Maker roles, genres, keywords, and annotation', () => {
    expect(splitPersonName('Tolstoy, Leo Nikolayevich')).toEqual({
      lastName: 'Tolstoy',
      firstName: 'Leo',
      middleName: 'Nikolayevich',
    });
    expect(splitPersonName('Anonymous')).toEqual({ nickname: 'Anonymous' });

    const { description, summary } = buildForeignDescription(
      {
        title: 'Star Voyage',
        authors: ['Author, Jane A.'],
        contributors: [
          'Translator: John Smith',
          'Illustrator: Ivan Petrov',
          'Editor: Mary Lane',
          'Unknown Role Person',
        ],
        publisher: 'Orbit Press',
        description: '<p>First summary.</p><p>Second summary.</p>',
        isbn: 'urn:isbn:978-0-123456-78-9',
        subjects: ['Space Fiction', 'sf_space', 'deep space'],
        date: '2025-04-12',
        language: 'en-US',
        identifier: 'id-1',
        rights: 'CC-BY 4.0',
      },
      SAMPLE_GENRES,
      'Fallback',
    );

    expect(description.title).toBe('Star Voyage');
    expect(description.authors).toEqual([
      { lastName: 'Author', firstName: 'Jane', middleName: 'A.' },
    ]);
    expect(description.translators).toEqual([
      { firstName: 'John', lastName: 'Smith', middleName: undefined },
    ]);
    expect(description.genres).toEqual(['sf_space']);
    expect(description.keywords).toBe('deep space');
    expect(description.lang).toBe('en');
    expect(description.date).toBe('2025-04-12');
    expect(description.publish?.publisher).toBe('Orbit Press');
    expect(description.publish?.isbn).toBe('978-0-123456-78-9');
    expect(description.annotation).toEqual(['First summary.', 'Second summary.']);
    expect(description.custom).toEqual([
      { type: 'mlillustrator', text: 'Petrov Ivan' },
      { type: 'mleditor', text: 'Lane Mary' },
      { type: 'rights', text: 'CC-BY 4.0' },
    ]);
    expect(summary).toEqual([{ kind: 'listedData', detail: 'contributor: Unknown Role Person' }]);
  });

  it('converts MOBI 7 HTML with front-matter deduplication, converter marks, tables, lists, and bidirectional notes', () => {
    const html = `<html><body>
      <div id="fb2-cover"><img recindex="00001"/></div>
      <div id="fb2-toc"><a href="#ch1">Chapter One</a></div>
      <h2 id="ch1">Chapter One</h2>
      <div class="epigraph"><p>Wise words.</p><p class="text-author">Sage</p></div>
      <p>Body with <b>bold</b>, <i>italic</i>, <a id="r1" href="#n1">[1]</a>, and <a href="#missing">dead</a>.</p>
      <div class="poem"><div class="stanza"><p class="v">Line A</p><p class="v">Line B</p></div></div>
      <p><img recindex="00003" alt="Photo"/></p>
      <table><tr><th align="center">H</th><td colspan="2">V</td></tr></table>
      <ul><li>One</li><li>Two</li></ul>
      <h3 id="sub1">Sub</h3>
      <p>Nested paragraph.</p>
      <div id="n1"><p>Footnote text <a href="#r1">↩</a></p></div>
      <script>alert('xss')</script>
    </body></html>`;

    const res = convertMobiToFb2({
      activePart: 'mobi7',
      htmlOrText: html,
      cssFlows: [],
      metadata: {
        title: 'Test',
        authors: [],
        contributors: [],
        subjects: [],
        language: 'en',
        identifier: '',
      },
      navigation: [],
      guide: [],
      pictures: [
        {
          index: 1,
          contentType: 'image/jpeg',
          width: 600,
          height: 900,
          size: 1000,
          tooLarge: false,
        },
        {
          index: 2,
          contentType: 'image/jpeg',
          width: 120,
          height: 180,
          size: 500,
          tooLarge: false,
        },
        { index: 3, contentType: 'image/png', width: 100, height: 100, size: 300, tooLarge: false },
      ],
      coverIndex: 1,
      thumbnailIndex: 2,
    });

    // Cover goes to coverBinaryId only (not body); thumbnail index 2 skipped completely!
    expect(res.coverBinaryId).toBe('cover.jpg');
    expect(res.neededPictures.has(2)).toBe(false);
    expect(res.neededPictures.has(3)).toBe(true);
    // Front matter & scripts excluded
    expect(res.bodyXml).not.toContain('fb2-toc');
    expect(res.bodyXml).not.toContain('alert');
    // Converter structural marks restored
    expect(res.bodyXml).toContain(
      '<epigraph><p>Wise words.</p><text-author>Sage</text-author></epigraph>',
    );
    expect(res.bodyXml).toContain('<poem><stanza><v>Line A</v><v>Line B</v></stanza></poem>');
    expect(res.bodyXml).toContain('<th align="center">H</th><td colspan="2">V</td>');
    expect(res.bodyXml).toContain('<p>\u2022 One</p>');
    // Dead internal link degraded to plain text; bidirectional footnote moved to notes body
    expect(res.bodyXml).toContain('and dead.');
    expect(res.bodyXml).toContain('<a l:href="#n1" type="note">[1]</a>');
    expect(res.notesXml).toContain('<body name="notes">');
    expect(res.notesXml).toContain('Footnote text');
  });

  it('handles KF8 CSS class planning, SVG single-image unwrap vs vector rasterise, MathML, and pop-up footnotes', () => {
    const xhtml = `<html><body>
      <h1>KF8 Chapter</h1>
      <p class="bodytext">Paragraph with <span class="emph">italics</span> and <span class="highlight">boxed</span><a epub:type="noteref" href="#fn1">*</a>.</p>
      <svg viewBox="0 0 100 100"><image href="kindle:embed:0001"/></svg>
      <svg viewBox="0 0 50 50"><title>Star</title><circle cx="25" cy="25" r="20"/></svg>
      <math display="block"><mi>x</mi><mo>+</mo><mn>1</mn></math>
      <aside id="fn1" epub:type="footnote"><p>KF8 pop-up note.</p></aside>
    </body></html>`;
    const css = `
      .bodytext { text-indent: 1.5em; }
      .emph { font-style: italic; }
      .highlight { color: #aa0000; }
    `;

    const res = convertMobiToFb2({
      activePart: 'kf8',
      htmlOrText: xhtml,
      cssFlows: [css],
      metadata: {
        title: 'KF8',
        authors: [],
        contributors: [],
        subjects: [],
        language: 'en',
        identifier: '',
      },
      navigation: [],
      guide: [],
      pictures: [
        {
          index: 1,
          contentType: 'image/jpeg',
          width: 200,
          height: 200,
          size: 500,
          tooLarge: false,
        },
      ],
    });

    expect(res.bodyXml).toContain('<emphasis>italics</emphasis>');
    expect(res.bodyXml).toContain('<style name="highlight">boxed</style>');
    expect(res.stylesheets[0]?.text).toContain('.highlight');
    // Framed single-image SVG unwrapped directly to raster picture 1 (NOT put in drawings!)
    expect(res.neededPictures.has(1)).toBe(true);
    expect(res.drawings).toHaveLength(1);
    expect(res.drawings[0]!.alt).toBe('Star');
    expect(res.formulas).toHaveLength(1);
    expect(res.formulas[0]!.alt).toBe('x+1');
    expect(res.notesXml).toContain('KF8 pop-up note.');
  });

  it('converts plain PalmDOC text into valid FB2 paragraphs and empty lines', () => {
    const res = convertMobiToFb2({
      activePart: 'palmdoc',
      htmlOrText: 'First line\nwrapped line.\n\nSecond paragraph.\n\n\nAfter break.',
      cssFlows: [],
      metadata: {
        title: 'Plain',
        authors: [],
        contributors: [],
        subjects: [],
        language: 'en',
        identifier: '',
      },
      navigation: [],
      guide: [],
      pictures: [],
    });

    expect(res.bodyXml).toBe(
      '<body><section><p>First line wrapped line.</p><p>Second paragraph.</p><empty-line/><p>After break.</p></section></body>',
    );
  });
});
