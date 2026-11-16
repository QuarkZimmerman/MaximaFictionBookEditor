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
