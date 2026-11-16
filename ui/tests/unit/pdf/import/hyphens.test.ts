/**
 * Feature 016 (D12; tasks T035): words broken at a line's end. A soft hyphen always joins; a plain hyphen
 * joins when the dictionaries know the word it makes, else it stays a hyphen with the word's halves; a line
 * ending with a hyphen never ends a paragraph.
 */
import { describe, expect, it } from 'vitest';

import { layoutParts } from '@/features/pdf/import/layout';
import type { PdfPageModel, PdfWord } from '@/features/pdf/import/model';
import { partText } from '@/features/pdf/import/parts';

/** A page of lines of words, 12 points apart, every line starting at the margin. */
function page(lines: string[]): PdfPageModel {
  const words: PdfWord[] = [];
  lines.forEach((line, row) => {
    let x = 40;
    for (const t of line.split(' ')) {
      const width = t.length * 5;
      words.push({
        t,
        box: [x, 40 + row * 12, width, 10],
        f: 'f1',
        s: 10,
        c: '#000000',
        base: 48 + row * 12,
      });
      x += width + 3;
    }
  });
  return {
    n: 1,
    width: 420,
    height: 595,
    rotation: 0,
    kind: 'text',
    fonts: [],
    words,
    links: [],
    pictures: [],
  };
}

const text = (lines: string[], known?: (word: string) => boolean): string =>
  layoutParts([page(lines)], { known })
    .parts.map((part) => partText(part.runs))
    .join(' | ');

describe('words broken at the end of a line (D12)', () => {
  const full = 'a line of text that reaches the right edge of the page as lines do';
  it('joins a soft hyphen always', () => {
    expect(text([`${full} hy\u00ad`, 'phenated words go on here as the line does'])).toContain(
      'hyphenated words',
    );
  });
  it('joins a plain hyphen when the word is known, and keeps it when it is not', () => {
    const lines = [`${full} hy-`, 'phenated words go on here as the line does'];
    expect(text(lines, (w) => w === 'hyphenated')).toContain('hyphenated words');
    expect(text(lines, () => false)).toContain('hy- phenated');
  });
  it('never ends a paragraph at a line ending with a hyphen', () => {
    // The first line ends short, which in a book of block paragraphs ends one - not with a hyphen.
    expect(text(['short line hy-', 'phenated words go on'], () => true)).not.toContain(' | ');
  });
});

describe('a drop cap (D11, D32)', () => {
  it('begins the first word of the first line beside it, whatever line its baseline falls on', () => {
    const word = (t: string, x: number, row: number): PdfWord => ({
      t,
      box: [x, 40 + row * 12, t.length * 5, 10],
      f: 'f1',
      s: 10,
      c: '#000000',
      base: 48 + row * 12,
    });
    const lines = [
      [
        'алеко-далеко,',
        'рассекая',
        'пространство,',
        'как',
        'огромная',
        'резная',
        'фигура',
        'на',
        'носу',
        'корабля',
      ],
      [
        'простирается',
        'Край.',
        'Со',
        'скалы,',
        'нависающей',
        'над',
        'бездной,',
        'льётся',
        'водопад',
        'вниз',
      ],
      ['и', 'так', 'далее', 'до', 'самого', 'конца', 'этой', 'длинной', 'строки', 'текста'],
    ];
    const words: PdfWord[] = [];
    lines.forEach((line, row) => {
      let x = 70;
      for (const t of line) {
        words.push(word(t, x, row));
        x += t.length * 5 + 3;
      }
    });
    // The letter spans the first two lines; its baseline is the second line's.
    // Its box starts above the first line's words, as the library's drop caps do.
    words.push({ t: 'Д', box: [40, 36, 26, 30], f: 'f1', s: 26, c: '#000000', base: 62 });
    const model: PdfPageModel = {
      n: 1,
      width: 420,
      height: 595,
      rotation: 0,
      kind: 'text',
      fonts: [],
      words,
      links: [],
      pictures: [],
    };
    const text = layoutParts([model])
      .parts.map((part) => partText(part.runs))
      .join(' | ');
    expect(text.startsWith('Далеко-далеко, рассекая')).toBe(true);
    expect(text).not.toContain(' Д ');
  });
});
