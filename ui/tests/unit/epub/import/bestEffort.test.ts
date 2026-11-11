/**
 * Feature 012 (T040; D23-D27, D29; contracts/epub-import.md §4, §8; SC-008): what FB2 cannot hold -
 * the picture rule, an SVG that only frames a picture, formulas and their text, the special
 * characters, the book's classes (the Calibre book: exactly three named styles), what is left out,
 * and nesting past the limit.
 */
import { describe, expect, it } from 'vitest';

import { convertPages, classUseOf, type ConvertPage } from '@/features/epub/import/convert';
import { planClasses } from '@/features/epub/import/css';
import { Dropped } from '@/features/epub/import/dropped';
import { MAX_NESTING } from '@/features/epub/import/limits';
import { parsePage } from '@/features/epub/import/parse';
import { framedPicture, pictureFormat } from '@/features/epub/import/pictures';

function page(path: string, body: string): ConvertPage {
  const xhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" ' +
    `xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>${body}</body></html>`;
  return { path, doc: parsePage(xhtml, 'xhtml').doc, linear: true };
}

const IMAGES = new Map([
  ['EPUB/cover.jpg', 'image/jpeg'],
  ['EPUB/poster.png', 'image/png'],
  ['EPUB/frame.svg', 'image/svg+xml'],
]);

function convert(pages: ConvertPage[], extra: Partial<Parameters<typeof convertPages>[0]> = {}) {
  return convertPages({
    pages,
    navigation: [],
    images: IMAGES,
    descriptionWords: new Set(),
    notesTitle: 'Notes',
    ...extra,
  });
}

// The stylesheet of tests/fixtures/epub/calibre-like.epub (make-fixtures.py).
const CALIBRE_CSS =
  Array.from({ length: 30 }, (_, n) => `.calibre${n + 1} { display: block; }`).join('\n') +
  '\n.calibre3 { text-indent: 1.2em; margin: 0 0 0.2em; }\n.calibre5 { font-style: italic; }' +
  '\n.calibre6 { font-weight: bold; }\n.calibre7 { font-variant: small-caps; }' +
  '\n.calibre8 { text-align: center; }\n.calibre9 { letter-spacing: 0.3em; }\n';
const CALIBRE_PAGE =
  '<h1 class="calibre2">Chapter 1</h1><p class="calibre3">Plain <span class="calibre5">italic</span> and ' +
  '<span class="calibre6">bold</span>.</p><p class="calibre3"><span class="calibre7">Small caps</span>.</p>' +
  '<p class="calibre3 calibre8">Centred.</p><p class="calibre3"><span class="calibre9">Spaced</span>.</p>' +
  '<p class="calibre3">Plain again.</p>';

describe('the pictures (D23)', () => {
  it('are PNG when transparent or of 256 colours or fewer, else JPEG', () => {
    const solid = new Uint8ClampedArray(64 * 4).fill(255);
    expect(pictureFormat(solid)).toBe('image/png');
    const transparent = solid.slice();
    transparent[63 * 4 + 3] = 0;
    expect(pictureFormat(transparent)).toBe('image/png');
    const many = new Uint8ClampedArray(1000 * 4);
    for (let n = 0; n < 1000; n++) many.set([n % 256, Math.floor(n / 256), 7, 255], n * 4);
    expect(pictureFormat(many)).toBe('image/jpeg');
  });

  it('take the one picture an SVG only frames, as cover pages do', () => {
    const frame =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">' +
      '<image width="10" height="10" xlink:href="cover.jpg"/></svg>';
    expect(framedPicture(frame, 'EPUB/frame.svg', IMAGES)).toBe('EPUB/cover.jpg');
    expect(
      framedPicture(
        frame.replace('<image', '<rect width="1" height="1"/><image'),
        'EPUB/frame.svg',
        IMAGES,
      ),
    ).toBeNull();
    expect(
      framedPicture(frame.replace('cover.jpg', 'frame.svg'), 'EPUB/frame.svg', IMAGES),
    ).toBeNull();
  });
});

describe('formulas, drawings and characters (D24, D25)', () => {
  it('give formulas to draw with their text, inline or as blocks', async () => {
    const book = await convert([
      page(
        'EPUB/a.xhtml',
        '<h1>T</h1><p>Inline <math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>.</p>' +
          '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>y</mi></math>',
      ),
    ]);
    expect(book.formulas.map((f) => [f.id, f.alt, f.display])).toEqual([
      ['mathml_1', 'x squared', false],
      ['mathml_2', 'y', true],
    ]);
    expect(book.formulas[0]!.markup).toContain('<msup>');
    expect(book.bodyXml).toContain('<p>Inline <!--mfbe-math:0-->.</p><!--mfbe-math-block:1-->');
  });

  it('give drawings to draw, and an SVG that frames a picture that picture', async () => {
    const book = await convert([
      page(
        'EPUB/a.xhtml',
        '<h1>T</h1><p>A <svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg> drawing.</p>' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="cover.jpg"/></svg>',
      ),
    ]);
    expect(book.drawings).toHaveLength(1);
    expect(book.bodyXml).toContain('<p>A <!--mfbe-svg:0--> drawing.</p>');
    expect(book.bodyXml).toContain(`<image l:href="#${book.pictures.get('EPUB/cover.jpg')}"/>`);
  });

  it('carry emoji and symbols as pictures and list private-use characters (010 D37)', async () => {
    const book = await convert([page('EPUB/a.xhtml', '<h1>T</h1><p>Done \u2705 and \ue001.</p>')]);
    expect(book.bodyXml).toContain('<p>Done <image l:href="#ch-2705" alt="\u2705"/> and .</p>');
    expect([...book.chars.keys()]).toEqual(['ch-2705']);
    expect(book.summary).toContainEqual({ kind: 'droppedChar', detail: 'U+E001' });
  });
});

describe("the book's classes (D26, contracts §8, SC-008)", () => {
  const pages = [page('EPUB/ch01.xhtml', CALIBRE_PAGE)];

  it('give FB2 forms, exactly the three named styles, and the paragraph look', () => {
    const plan = planClasses([CALIBRE_CSS], classUseOf(pages));
    expect([...plan.named].sort()).toEqual(['calibre7', 'calibre8', 'calibre9']);
    expect(plan.paragraphClass).toBe('calibre3');
    expect(plan.forms.get('calibre5')).toEqual(['emphasis']);
    expect(plan.forms.get('calibre6')).toEqual(['strong']);
    expect(plan.stylesheet).toMatch(/^p \{\n\s+text-indent: 1\.2em;\n\s+margin: 0 0 0\.2em;\n\}/);
    expect(plan.stylesheet).toContain('.calibre7 {\n  font-variant: small-caps;\n}');
    expect(plan.stylesheet).not.toContain('.calibre3');
    expect(plan.stylesheet).not.toContain('.calibre1 ');
    expect(plan.stylesheet).not.toContain('display');
  });

  it('are applied to the text: no style on the paragraphs of the paragraph class', async () => {
    const book = await convert(pages, { classes: planClasses([CALIBRE_CSS], classUseOf(pages)) });
    expect(book.bodyXml).toContain(
      '<p>Plain <emphasis>italic</emphasis> and <strong>bold</strong>.</p>',
    );
    expect(book.bodyXml).toContain('<p><style name="calibre7">Small caps</style>.</p>');
    expect(book.bodyXml).toContain('<p style="calibre8">Centred.</p>');
    expect(book.bodyXml).toContain('<p><style name="calibre9">Spaced</style>.</p>');
    expect(book.bodyXml).toContain('<p>Plain again.</p>');
  });
});

describe('what is left out (D27) and the limits (D29)', () => {
  it('counts what FB2 has no place for, keeping the fallback text and the poster', async () => {
    const dropped = new Dropped();
    const book = await convert(
      [
        page(
          'EPUB/a.xhtml',
          '<h1>T</h1><p><audio src="s.mp3" controls="controls">The audio fallback.</audio></p>' +
            '<video src="v.mp4" poster="poster.png" controls="controls">The video fallback.</video>' +
            '<script>document.title = "never";</script><form action="#"><input type="text"/><button>x</button></form>' +
            '<p><span epub:type="pagebreak" id="pg5" title="5"/>After page 5.</p><canvas width="1" height="1"/>',
        ),
      ],
      { dropped },
    );
    expect(dropped.summary()).toEqual([
      { kind: 'droppedMedia', detail: 's.mp3, v.mp4' },
      { kind: 'droppedScripts', detail: '1' },
      { kind: 'droppedForms', detail: '1' },
      { kind: 'droppedEmbedded', detail: '1' },
      { kind: 'droppedPageMarkers', detail: '1' },
    ]);
    expect(book.bodyXml).toContain('<p>The audio fallback.</p>');
    expect(book.bodyXml).toContain(
      `<image l:href="#${book.pictures.get('EPUB/poster.png')}"/><p>The video fallback.</p>`,
    );
    expect(book.bodyXml).toContain('<p>After page 5.</p>');
    expect(book.bodyXml).not.toContain('never');
  });

  it('flattens nesting past the limit, and lists it once', async () => {
    const deep = '<div>'.repeat(500) + '<p>Deep.</p>' + '</div>'.repeat(500);
    const book = await convert([page('EPUB/a.xhtml', `<h1>T</h1>${deep}`)]);
    expect(book.bodyXml).toContain('Deep.');
    expect(book.summary).toEqual([{ kind: 'nestingFlattened', detail: String(MAX_NESTING) }]);
  });
});
