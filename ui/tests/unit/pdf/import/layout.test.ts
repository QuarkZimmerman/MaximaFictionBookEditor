/**
 * Feature 016 (User Story 2 and 3; D11, D12, D14, D17; tasks T035): the layout analysis of PDFs without
 * structure, on the page models the reader gives of the generated fixtures (fixtures/*.json, from
 * tests/fixtures/pdf/import/): page furniture left out, chapters by the bookmarks, paragraphs, words broken at a
 * line's end, bold and italic, pictures, the cover of a scan.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { furnitureOf, layoutParts, linesOf } from '@/features/pdf/import/layout';
import type { PdfDocumentModel, PdfPageModel } from '@/features/pdf/import/model';
import { partText, type Part } from '@/features/pdf/import/parts';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(HERE, file), 'utf8')) as T;
const pagesOf = (name: string, count: number): PdfPageModel[] =>
  Array.from({ length: count }, (_, i) => read<PdfPageModel>(`${name}.page-${i + 1}.json`));
const texts = (parts: Part[], kind: Part['kind']): string[] =>
  parts.filter((part) => part.kind === kind).map((part) => partText(part.runs).trim());

describe('a PDF made from text (US2)', () => {
  const doc = read<PdfDocumentModel>('text-untagged.document.json');
  const result = layoutParts(pagesOf('text-untagged', 2), {
    outline: doc.outline,
    known: (word) => word === 'hyphenated',
  });
  const paragraphs = texts(result.parts, 'p');

  it('leaves out the running heads and the page numbers (D12)', () => {
    expect(result.furniture).toBe(4);
    expect(paragraphs).not.toContain('The Generated Book');
    expect(paragraphs.some((p) => /^\d+$/.test(p))).toBe(false);
  });

  it('finds the chapters by the bookmarks, their lines as titles (D11)', () => {
    expect(texts(result.parts, 'title')).toEqual(['Chapter One', 'Chapter Two']);
  });

  it('makes paragraphs of the lines, joining a word broken with a hyphen when it is a word (D12)', () => {
    expect(paragraphs[0]).toMatch(/^The first paragraph of the generated book/);
    expect(paragraphs.some((p) => p.includes('hyphenated at the end of a line'))).toBe(true);
    expect(paragraphs.some((p) => p.includes('hyphen-'))).toBe(false);
  });

  it('keeps bold and italic runs (D11)', () => {
    const runs = result.parts.flatMap((part) => part.runs);
    expect(runs.find((run) => run.text.trim() === 'Bold')?.bold).toBe(true);
    expect(runs.find((run) => run.text.trim() === 'italic')?.italic).toBe(true);
  });

  it('puts the picture among the parts of its page (D11)', () => {
    const figures = result.parts.filter((part) => part.kind === 'figure');
    expect(figures).toHaveLength(1);
    expect(figures[0].page).toBe(1);
    expect(result.cover).toBeNull();
  });

  it('keeps a plain hyphen the dictionary does not join', () => {
    const kept = layoutParts(pagesOf('text-untagged', 2), {
      outline: doc.outline,
      known: () => false,
    });
    expect(texts(kept.parts, 'p').some((p) => p.includes('hyphen- ated'))).toBe(true);
  });
});

describe('a scan with an invisible text layer (US3)', () => {
  const result = layoutParts(pagesOf('scan-invisible', 4));
  const paragraphs = texts(result.parts, 'p');

  it('reads the layer, the soft hyphen always joined (D12, D17)', () => {
    expect(paragraphs.some((p) => p.includes('hyphenated'))).toBe(true);
    expect(paragraphs.join(' ')).toContain('harbour town');
  });

  it('takes the first page as the cover and no page picture into the book (D14, D17)', () => {
    expect(result.cover).toBe(pagesOf('scan-invisible', 1)[0].pictures[0].id);
    expect(result.parts.filter((part) => part.kind === 'figure')).toHaveLength(0);
    // The blank last page is no plate: the read's page kinds count it.
    expect(result.skippedPictures).toBe(0);
  });

  it('leaves out the running heads and page numbers of the layer, and keeps its errors (D12, D17)', () => {
    expect(paragraphs).not.toContain('The Generated Book');
    expect(paragraphs.join(' ')).toContain('earIy');
  });
});

describe('two columns (D32)', () => {
  // Two columns of 24 lines with a gutter of 6 points between them, and one line across both in the middle;
  // the words of a line vary in width, as a text's do, so that no free band runs down inside a column.
  const word = (t: string, x: number, y: number, w: number) => ({
    t,
    box: [x, y - 9, w, 11],
    base: y,
    s: 11,
    f: 0,
    c: 0,
  });
  const words: ReturnType<typeof word>[] = [];
  const line = (name: string, from: number, to: number, y: number, i: number): void => {
    let x = from;
    for (let k = 0; x < to - 10; k++) {
      const w = Math.min(to - x, 18 + ((i * 7 + k * 13) % 23));
      words.push(word(`${name}${i}${'abcdefghij'[k]}`, x, y, w));
      x += w + 3;
    }
  };
  for (let i = 0; i < 24; i++) {
    const y = 60 + i * 13 + (i >= 12 ? 26 : 0);
    line('l', 32, 262, y, i);
    line('r', 268, 498, y, i);
  }
  words.push(word('Across', 120, 60 + 12 * 13 + 10, 300));
  const page = {
    n: 1,
    width: 527,
    height: 700,
    rotation: 0,
    kind: 'text',
    words,
  } as unknown as PdfPageModel;

  it('reads each column top to bottom, in stretches between the lines across them', () => {
    const lines = linesOf(page).map((l) => l.words[0].t);
    expect(lines.slice(0, 2)).toEqual(['l0a', 'l1a']);
    expect(lines[12]).toBe('r0a');
    expect(lines[24]).toBe('Across');
    expect(lines[25]).toBe('l12a');
    expect(lines[37]).toBe('r12a');
  });
});

describe('a note that cites one book on every page (D32)', () => {
  // Pages of body text, a note of two lines at the foot citing the same book, and the page number below.
  const line = (text: string, y: number, s: number, x = 40) =>
    text
      .split(' ')
      .map((t, i) => ({ t, box: [x + i * 50, y - s, 45, s + 2], base: y, s, f: 0, c: 0 }));
  const page = (n: number) =>
    ({
      n,
      width: 400,
      height: 600,
      rotation: 0,
      kind: 'text',
      words: [
        ...Array.from({ length: 20 }, (_, i) =>
          line(`body ${n} line ${i} text`, 60 + i * 14, 10.5),
        ).flat(),
        ...line(`${n} Hist. eccl. book`, 520, 8),
        ...line('Ed. Smith. Vol 1. 1999.', 529, 8),
        ...line(`${n}`, 560, 10.5, 190),
      ],
    }) as unknown as PdfPageModel;

  it('keeps the note, and leaves out the page number', () => {
    const pages = [1, 2, 3, 4].map((n) => linesOf(page(n)));
    const furniture = furnitureOf(pages);
    const citation = pages[1].find((l) => l.text.startsWith('Ed.'))!;
    const number = pages[1].find((l) => l.text === '2')!;
    expect(furniture.has(citation)).toBe(false);
    expect(furniture.has(number)).toBe(true);
  });
});

describe('two columns around a column of pictures (D32)', () => {
  // Two pictures in the middle of the page, a caption between them, the columns either side; under the
  // pictures the columns widen into the middle - no gutter runs down the whole page.
  const word = (t: string, x: number, y: number, w: number) => ({
    t,
    box: [x, y - 9, w, 11],
    base: y,
    s: 11,
    f: 0,
    c: 0,
  });
  const words: ReturnType<typeof word>[] = [];
  const line = (name: string, from: number, to: number, y: number, i: number): void => {
    let x = from;
    for (let k = 0; x < to - 10; k++) {
      const w = Math.min(to - x, 16 + ((i * 7 + k * 13) % 19));
      words.push(word(`${name}${i}${'abcdefghijklmnop'[k]}`, x, y, w));
      x += w + 3;
    }
  };
  for (let i = 0; i < 20; i++) {
    line('l', 40, 200, 50 + i * 13, i);
    line('r', 380, 540, 50 + i * 13, i);
  }
  for (let i = 20; i < 24; i++) {
    line('l', 40, 284, 50 + i * 13, i);
    line('r', 296, 540, 50 + i * 13, i);
  }
  line('c', 222, 358, 172, 0);
  const page = {
    n: 1,
    width: 580,
    height: 700,
    rotation: 0,
    kind: 'text',
    words,
    pictures: [
      { id: 'a', box: [215, 40, 150, 120] },
      { id: 'b', box: [215, 180, 150, 120] },
    ],
  } as unknown as PdfPageModel;

  it('reads the left column down past the pictures, then the right one, then the caption', () => {
    const firsts = linesOf(page).map((l) => l.words[0].t);
    expect(firsts.slice(0, 2)).toEqual(['l0a', 'l1a']);
    expect(firsts[23]).toBe('l23a');
    expect(firsts[24]).toBe('r0a');
    expect(firsts[47]).toBe('r23a');
    expect(firsts[48]).toBe('c0a');
  });
});
