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

import { layoutParts } from '@/features/pdf/import/layout';
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
