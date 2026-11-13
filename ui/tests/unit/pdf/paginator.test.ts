/**
 * Feature 014 (D10, tasks T019): the page breaks the planner decides from measured heights
 * (src/features/pdf/export/plan.ts).
 */
import { describe, expect, it } from 'vitest';

import { planPages, type PlanBlock } from '@/features/pdf/export/plan';

const paragraph = (lines: number, extra: Partial<PlanBlock> = {}): PlanBlock => ({
  lines: Array.from({ length: lines }, () => 10),
  spaceBefore: 0,
  splittable: true,
  keepWithNext: false,
  breakBefore: false,
  ...extra,
});
const picture = (height: number): PlanBlock => ({
  lines: [height],
  spaceBefore: 0,
  splittable: false,
  keepWithNext: false,
  breakBefore: false,
});
const title = (): PlanBlock => paragraph(1, { keepWithNext: true, splittable: false });

describe('planPages (D10)', () => {
  it('puts blocks that fit on one page', () => {
    expect(planPages([paragraph(3), paragraph(3)], 100)).toEqual([
      [
        { block: 0, fromLine: 0, toLine: 3 },
        { block: 1, fromLine: 0, toLine: 3 },
      ],
    ]);
  });

  it('starts top-level sections and other bodies on a new page', () => {
    const pages = planPages([paragraph(2), paragraph(2, { breakBefore: true })], 100);
    expect(pages).toHaveLength(2);
    expect(pages[1][0].block).toBe(1);
  });

  it('never leaves a title last on a page', () => {
    // 8 lines used; the title (1 line) fits, but the paragraph after it would not start there.
    const pages = planPages([paragraph(8), title(), paragraph(3)], 100);
    expect(pages[0]).toEqual([{ block: 0, fromLine: 0, toLine: 8 }]);
    expect(pages[1][0]).toEqual({ block: 1, fromLine: 0, toLine: 1 });
  });

  it('splits a paragraph of four lines or more between lines, two lines at least on each side', () => {
    const pages = planPages([paragraph(7), paragraph(6)], 100);
    // 3 lines fit after the first paragraph: 3 stay, 3 go.
    expect(pages[0]).toEqual([
      { block: 0, fromLine: 0, toLine: 7 },
      { block: 1, fromLine: 0, toLine: 3 },
    ]);
    expect(pages[1]).toEqual([{ block: 1, fromLine: 3, toLine: 6 }]);
  });

  it('keeps two lines for the next page rather than leaving one alone there', () => {
    const pages = planPages([paragraph(6), paragraph(5)], 100);
    // 4 lines would fit, but only 1 would be left: 3 stay, 2 go.
    expect(pages[0][1]).toEqual({ block: 1, fromLine: 0, toLine: 3 });
    expect(pages[1][0]).toEqual({ block: 1, fromLine: 3, toLine: 5 });
  });

  it('moves a paragraph of fewer than four lines whole', () => {
    const pages = planPages([paragraph(9), paragraph(3)], 100);
    expect(pages[0]).toEqual([{ block: 0, fromLine: 0, toLine: 9 }]);
    expect(pages[1]).toEqual([{ block: 1, fromLine: 0, toLine: 3 }]);
  });

  it('never splits a picture: it moves to the next page whole', () => {
    const pages = planPages([paragraph(5), picture(60)], 100);
    expect(pages[1]).toEqual([{ block: 1, fromLine: 0, toLine: 1 }]);
  });

  it('cuts only a block taller than a whole page', () => {
    const pages = planPages([paragraph(25)], 100);
    expect(pages.map((page) => page[0])).toEqual([
      { block: 0, fromLine: 0, toLine: 10 },
      { block: 0, fromLine: 10, toLine: 20 },
      { block: 0, fromLine: 20, toLine: 25 },
    ]);
  });

  it('drops the space above a block at the top of a page', () => {
    const pages = planPages([paragraph(10), paragraph(2, { spaceBefore: 30 })], 100);
    expect(pages).toHaveLength(2);
    expect(planPages([paragraph(2, { spaceBefore: 30 }), paragraph(8)], 100)).toHaveLength(1);
  });
});

describe('planPages with footnotes (D19)', () => {
  it("keeps a block's footnotes on the page of its first lines, taking their room", () => {
    // 6 lines of text plus a 30 px note and a 10 px rule fill the page: the next paragraph moves.
    const pages = planPages([paragraph(6, { foot: 30 }), paragraph(3)], 100, 10);
    expect(pages[0]).toEqual([{ block: 0, fromLine: 0, toLine: 6 }]);
    expect(pages[1]).toEqual([{ block: 1, fromLine: 0, toLine: 3 }]);
  });

  it('moves a paragraph whose note would not fit with it', () => {
    const pages = planPages([paragraph(5), paragraph(3, { foot: 30 })], 100, 10);
    expect(pages[0]).toEqual([{ block: 0, fromLine: 0, toLine: 5 }]);
    expect(pages[1]).toEqual([{ block: 1, fromLine: 0, toLine: 3 }]);
  });

  it('shares one rule between the notes of a page', () => {
    const pages = planPages([paragraph(2, { foot: 20 }), paragraph(2, { foot: 20 })], 100, 10);
    // 20 + 20 lines, 20 + 20 notes, one 10 px rule: 90 of 100.
    expect(pages).toHaveLength(1);
  });
});

describe('planPages with a repeated header (tables)', () => {
  it('counts the header row each continued part repeats', () => {
    // 25 rows of 10 px on 100 px pages: 10 rows, then the 20 px header and 8 rows, then the rest.
    const pages = planPages([paragraph(25, { repeat: 20 })], 100);
    expect(pages).toEqual([
      [{ block: 0, fromLine: 0, toLine: 10 }],
      [{ block: 0, fromLine: 10, toLine: 18 }],
      [{ block: 0, fromLine: 18, toLine: 25 }],
    ]);
  });

  it('takes a long note at half the page at most: its paragraph still starts there (D19)', () => {
    // A note taller than the page continues at the next page's foot (the paginator cuts it).
    const pages = planPages([paragraph(3, { foot: 400 }), paragraph(3)], 100, 10);
    expect(pages[0][0]).toEqual({ block: 0, fromLine: 0, toLine: 3 });
  });
});
