/**
 * Section window node budget (T150): huge sections shrink the mounted window so tree
 * navigation and the first paint of a 10 MB book stay within the SC-002 budgets.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WINDOW_SIZE,
  MAX_WINDOW_FACTOR,
  WHOLE_BOOK_NODE_BUDGET,
  WINDOW_NODE_BUDGET,
  createWindow,
  extendWindow,
  fitSections,
  isWholeBook,
  modelWeight,
  nodeWeight,
  windowAround,
} from '@/editor/virtualization';
import type { BodyNode, Document, SectionNode } from '@/model/document';

function section(id: number, paragraphs: number): SectionNode {
  return {
    type: 'section',
    attrs: { nodeId: `s${id}` },
    content: Array.from({ length: paragraphs }, (_, i) => ({
      type: 'p' as const,
      attrs: { nodeId: `s${id}p${i}` },
      content: [{ type: 'text' as const, text: `Paragraph ${i} of section ${id}` }],
    })),
  };
}

function book(sections: number, paragraphs: number): Pick<Document, 'bodies'> {
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'body' },
    content: Array.from({ length: sections }, (_, i) => section(i, paragraphs)),
  };
  return { bodies: [body] };
}

describe('section window node budget', () => {
  it('weighs element nodes only and memoises per object', () => {
    const s = section(1, 3);
    expect(nodeWeight(s)).toBe(4); // section + 3 paragraphs, text excluded
    expect(nodeWeight(s)).toBe(4);
    expect(modelWeight(book(2, 5))).toBe(1 + 2 * 6);
  });

  it('fits as many sections as the budget allows, at least one', () => {
    const heavy = book(50, 120); // 121 nodes per section
    const body = heavy.bodies[0];
    expect(fitSections(body, 0, DEFAULT_WINDOW_SIZE)).toBe(Math.floor(WINDOW_NODE_BUDGET / 121));
    expect(fitSections(body, 48, DEFAULT_WINDOW_SIZE)).toBe(2); // clamped at the end
    expect(fitSections(body, 10, DEFAULT_WINDOW_SIZE, 'before')).toBe(4);
    expect(fitSections(body, 0, DEFAULT_WINDOW_SIZE, 'before')).toBe(0);
    const giant = book(3, 5000);
    expect(fitSections(giant.bodies[0], 0, DEFAULT_WINDOW_SIZE)).toBe(1);
    const light = book(50, 3);
    expect(fitSections(light.bodies[0], 0, DEFAULT_WINDOW_SIZE)).toBe(DEFAULT_WINDOW_SIZE);
  });

  it('keeps whole-book mode for small books but not for huge ones', () => {
    expect(isWholeBook(book(30, 10))).toBe(true);
    expect(modelWeight(book(30, 1000))).toBeGreaterThan(WHOLE_BOOK_NODE_BUDGET);
    expect(isWholeBook(book(30, 1000))).toBe(false);
  });

  it('bounds fresh windows, extension steps and the trim limit by the budget', () => {
    const heavy = book(201, 120);
    const initial = createWindow(heavy);
    expect(initial.wholeBook).toBe(false);
    expect(initial.count).toBe(4);
    expect(initial.after).toBe(197);
    // An explicit count (the controller's current range) is honoured as before.
    expect(createWindow(heavy, { start: 0, count: 7 }).count).toBe(7);

    const once = extendWindow(heavy, initial, 'after');
    expect(once).toMatchObject({ start: 0, count: 8 });
    const twice = extendWindow(heavy, once, 'after');
    expect(twice).toMatchObject({ start: 0, count: 12 });
    // Beyond MAX_WINDOW_FACTOR fresh windows the far end is unmounted.
    const thrice = extendWindow(heavy, twice, 'after');
    expect(thrice).toMatchObject({ start: 4, count: 4 * MAX_WINDOW_FACTOR });
    const back = extendWindow(heavy, thrice, 'before');
    expect(back).toMatchObject({ start: 0, count: 12 });

    // Light books still mount windowSize sections per step.
    const light = book(100, 3);
    expect(createWindow(light).count).toBe(DEFAULT_WINDOW_SIZE);
    expect(extendWindow(light, createWindow(light), 'after').count).toBe(2 * DEFAULT_WINDOW_SIZE);
  });

  it('centres a budget-sized window on the navigation target', () => {
    const heavy = book(201, 120);
    const w = windowAround(heavy, 's150');
    expect(w).not.toBeNull();
    expect(w!.start).toBeLessThanOrEqual(150);
    expect(w!.start + w!.count).toBeGreaterThan(150);
    expect(w!.count).toBe(4);
    const first = windowAround(heavy, 's0')!;
    expect(first).toMatchObject({ start: 0, count: 4 });
    const last = windowAround(heavy, 's200')!;
    expect(last.start + last.count).toBe(201);
    // A single oversized section is mounted alone.
    const giant = book(5, 5000);
    expect(windowAround(giant, 's3', { forceWindowed: true })).toMatchObject({
      start: 3,
      count: 1,
    });
    // Light books keep the classic centred window.
    const light = book(100, 3);
    expect(windowAround(light, 's42')).toMatchObject({ start: 32, count: DEFAULT_WINDOW_SIZE });
  });
});
