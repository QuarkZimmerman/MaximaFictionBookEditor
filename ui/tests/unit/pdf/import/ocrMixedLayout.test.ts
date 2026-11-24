/**
 * Feature 020 (T032, US2): Vitest unit tests for mixed PDF layout & FB2 emission:
 * - fixed `style="ocr-image"` strictly on `ocrImages[]` paragraphs beside kept `<image>` (never
 *   on ordinary scanned-page paragraphs, zero `<stylesheet>` injected)
 * - reading-order placement of kept embedded images and `ocrCrop: true` inline illustrations
 * - paragraph-level and section-level `xml:lang` promotion (omitted when matching book `<lang>`)
 */
import { describe, expect, it } from 'vitest';

import { layoutParts } from '@/features/pdf/import/layout';
import type { PdfPageModel, PdfWord } from '@/features/pdf/import/model';
import { textBody } from '@/features/pdf/import/text';

function makeWord(
  t: string,
  x: number,
  y: number,
  w: number,
  h = 11,
  lang?: string,
  f = 'ocr',
): PdfWord {
  return {
    t,
    box: [x, y, w, h],
    f,
    s: h,
    c: '#000000',
    base: y + h * 0.85,
    ...(lang ? { lang } : {}),
  };
}

describe('US2 mixed PDF layout and FB2 emission', () => {
  it('emits style="ocr-image" strictly on ocrImages[] paragraphs right after the kept <image> and never injects <stylesheet>', () => {
    const page: PdfPageModel = {
      n: 1,
      width: 420,
      height: 594,
      rotation: 0,
      kind: 'text',
      fonts: [{ id: 'f1', name: 'Times', bold: false, italic: false, mono: false }],
      words: [
        makeWord('Searchable', 42, 60, 60, 11, undefined, 'f1'),
        makeWord('opening', 108, 60, 46, 11, undefined, 'f1'),
        makeWord('paragraph.', 160, 60, 62, 11, undefined, 'f1'),
        makeWord('Closing', 42, 320, 48, 11, undefined, 'f1'),
        makeWord('line.', 96, 320, 32, 11, undefined, 'f1'),
      ],
      links: [],
      pictures: [{ id: 'x10-0', box: [42, 120, 320, 140], w: 640, h: 280, jpeg: true }],
      ocrImages: [
        {
          pictureId: 'x10-0',
          box: [42, 120, 320, 140],
          lang: 'en',
          meanConf: 92,
          paragraphs: [
            {
              text: 'Western channel lanterns shine brightly.',
              lang: 'en',
              words: [
                makeWord('Western', 50, 140, 42),
                makeWord('channel', 96, 140, 40),
                makeWord('lanterns', 140, 140, 44),
                makeWord('shine', 188, 140, 28),
                makeWord('brightly.', 220, 140, 42),
              ],
            },
          ],
        },
      ],
    };

    const { parts } = layoutParts([page]);
    const wanted: string[] = [];
    const { xml } = textBody(
      parts,
      () => null,
      (_p, _alt, readerId) => {
        wanted.push(readerId ?? '');
        return `pic-${wanted.length}`;
      },
      { bookLang: 'en' },
    );

    expect(xml).toContain('<image l:href="#pic-1"/>');
    expect(xml).toContain('<p style="ocr-image">Western channel lanterns shine brightly.</p>');
    // Immediately beside the kept <image>
    expect(xml).toMatch(
      /<image l:href="#pic-1"\/>\s*<p style="ocr-image">Western channel lanterns shine brightly\.<\/p>/,
    );
    // Searchable paragraphs must NOT get style="ocr-image" or redundant xml:lang="en"
    expect(xml).toContain('<p>Searchable opening paragraph.</p>');
    expect(xml).toContain('<p>Closing line.</p>');
    expect(xml).not.toContain('<stylesheet');
  });

  it('never adds style="ocr-image" to ordinary scanned-page paragraphs and places ocrCrop illustrations in reading order', () => {
    const page: PdfPageModel = {
      n: 1,
      width: 420,
      height: 594,
      rotation: 0,
      kind: 'pictureShowingText',
      ocrUsed: true,
      ocrLang: 'en',
      ocrLanguages: ['en'],
      fonts: [{ id: 'ocr', name: 'OCR', bold: false, italic: false, mono: false }],
      words: [
        makeWord('Top', 42, 70, 24, 11, 'en'),
        makeWord('paragraph', 70, 70, 56, 11, 'en'),
        makeWord('text.', 130, 70, 30, 11, 'en'),
        makeWord('Bottom', 42, 390, 40, 11, 'en'),
        makeWord('paragraph', 86, 390, 56, 11, 'en'),
        makeWord('text.', 146, 390, 30, 11, 'en'),
      ],
      links: [],
      pictures: [
        { id: 'ocr-p1-1', box: [80, 150, 260, 180], w: 660, h: 420, jpeg: true, ocrCrop: true },
      ],
    };

    const { parts } = layoutParts([page]);
    const { xml } = textBody(
      parts,
      () => null,
      (_p, _alt, readerId) => readerId ?? null,
      { bookLang: 'en' },
    );

    expect(xml).not.toContain('style="ocr-image"');
    const topIdx = xml.indexOf('Top paragraph text.');
    const imgIdx = xml.indexOf('<image l:href="#ocr-p1-1"/>');
    const botIdx = xml.indexOf('Bottom paragraph text.');
    expect(topIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeGreaterThan(topIdx);
    expect(botIdx).toBeGreaterThan(imgIdx);
  });

  it('tags foreign-language paragraphs with xml:lang and promotes uniform foreign sections to <section xml:lang>', () => {
    const page1: PdfPageModel = {
      n: 1,
      width: 420,
      height: 594,
      rotation: 0,
      kind: 'pictureShowingText',
      ocrUsed: true,
      ocrLang: 'en',
      ocrLanguages: ['en', 'ru'],
      fonts: [{ id: 'ocr', name: 'OCR', bold: false, italic: false, mono: false }],
      words: [
        makeWord('Chapter', 42, 60, 64, 18, 'en'),
        makeWord('One', 112, 60, 32, 18, 'en'),
        makeWord('English', 42, 120, 44, 11, 'en'),
        makeWord('primary', 90, 120, 44, 11, 'en'),
        makeWord('paragraph.', 138, 120, 58, 11, 'en'),
        makeWord('Русский', 42, 200, 52, 11, 'ru'),
        makeWord('абзац', 98, 200, 36, 11, 'ru'),
        makeWord('здесь.', 138, 200, 38, 11, 'ru'),
      ],
      links: [],
      pictures: [],
    };
    const page2: PdfPageModel = {
      n: 2,
      width: 420,
      height: 594,
      rotation: 0,
      kind: 'pictureShowingText',
      ocrUsed: true,
      ocrLang: 'de',
      ocrLanguages: ['de'],
      fonts: [{ id: 'ocr', name: 'OCR', bold: false, italic: false, mono: false }],
      words: [
        makeWord('Kapitel', 42, 60, 60, 18, 'de'),
        makeWord('Zwei', 108, 60, 40, 18, 'de'),
        makeWord('Deutscher', 42, 120, 58, 11, 'de'),
        makeWord('Absatz', 104, 120, 42, 11, 'de'),
        makeWord('hier.', 150, 120, 32, 11, 'de'),
      ],
      links: [],
      pictures: [],
    };

    const { parts } = layoutParts([page1, page2], {
      outline: [
        { title: 'Chapter One', page: 1, kids: [] },
        { title: 'Kapitel Zwei', page: 2, kids: [] },
      ],
    });
    const { xml } = textBody(parts, () => null, () => null, { bookLang: 'en' });

    // Primary language paragraph has NO xml:lang
    expect(xml).toContain('<p>English primary paragraph.</p>');
    // Mixed section keeps paragraph-level xml:lang="ru"
    expect(xml).toContain('<p xml:lang="ru">Русский абзац здесь.</p>');
    // Uniform foreign section promotes xml:lang="de" onto <section> and omits redundant child xml:lang
    expect(xml).toContain('<section xml:lang="de">');
    expect(xml).not.toContain('<p xml:lang="de">');
  });
});
