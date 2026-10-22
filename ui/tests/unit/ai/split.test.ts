// @vitest-environment node
/**
 * The size rule (feature 005 T041; ai-catalogue §3.7, §6.12 step 3; review C13; FR-035,
 * FR-053): a selection halved along block boundaries - never cut inside a paragraph, order
 * kept -, one oversize block → `tooLarge`, the estimate `ceil(UTF-16 units / 3)` with the 4096
 * reserve applied only with a known context length. US3's T056 extends this file (tool results,
 * the outline, history trimming).
 */

import {
  ANSWER_RESERVE_TOKENS,
  estimateTokens,
  fitsContext,
  halve,
  splitSelection,
  splitSelectionForContext,
} from '@/ai/split';

const block = (id: string, units: number) => ({ id, units });

describe('the token estimate', () => {
  it('is ceil(UTF-16 code units / 3)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    // Cyrillic letters are one UTF-16 unit each; an astral character two.
    expect(estimateTokens('Привет')).toBe(2);
    expect(estimateTokens('😀')).toBe(1);
  });

  it('applies the 4096 reserve only with a known context length', () => {
    expect(ANSWER_RESERVE_TOKENS).toBe(4096);
    expect(fitsContext(10_000_000, undefined)).toBe(true);
    expect(fitsContext(3 * (8192 - 4096), 8192)).toBe(true);
    expect(fitsContext(3 * (8192 - 4096) + 1, 8192)).toBe(false);
    expect(fitsContext(0, 0)).toBe(true); // an unusable length is no length
  });
});

describe('splitSelection', () => {
  const blocks = [
    block('a', 100),
    block('b', 100),
    block('c', 100),
    block('d', 100),
    block('e', 100),
  ];

  it('keeps a selection that fits as one part', () => {
    expect(splitSelection(blocks, () => true)).toEqual({ ok: true, parts: [blocks] });
    expect(splitSelection([], () => false)).toEqual({ ok: true, parts: [[]] });
  });

  it('halves along block boundaries, order kept, until every part fits', () => {
    const outcome = splitSelection(blocks, (units) => units <= 200);
    expect(outcome.ok).toBe(true);
    const parts = (outcome as { parts: { id: string; units: number }[][] }).parts;
    expect(parts.map((part) => part.map((b) => b.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
    expect(parts.flat().map((b) => b.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const part of parts)
      expect(part.reduce((s, b) => s + b.units, 0)).toBeLessThanOrEqual(200);
  });

  it('never cuts inside a block: one block that alone does not fit is tooLarge', () => {
    const outcome = splitSelection(
      [block('a', 50), block('big', 500), block('c', 50)],
      (units) => units <= 200,
    );
    expect(outcome).toEqual({ ok: false, code: 'tooLarge', block: block('big', 500) });
  });

  it('halve gives the first half the extra block', () => {
    expect(halve([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(halve([1])).toEqual([[1], []]);
  });
});

describe('splitSelectionForContext', () => {
  it('splits nothing without a known context length (FR-053)', () => {
    const blocks = [block('a', 1_000_000), block('b', 1_000_000)];
    expect(splitSelectionForContext(blocks, 5000, undefined)).toEqual({
      ok: true,
      parts: [blocks],
    });
  });

  it('splits against contextLength − 4096 tokens including the fixed cost of the exchange', () => {
    // 8192 tokens → 4096 for content → 12288 units; the fixed cost takes 3000 of them.
    const blocks = [block('a', 6000), block('b', 6000), block('c', 6000)];
    const outcome = splitSelectionForContext(blocks, 3000, 8192);
    expect(outcome.ok).toBe(true);
    expect((outcome as { parts: { id: string }[][] }).parts.map((p) => p.map((b) => b.id))).toEqual(
      [['a'], ['b'], ['c']],
    );
    expect(splitSelectionForContext([block('huge', 20_000)], 0, 8192)).toMatchObject({
      ok: false,
      code: 'tooLarge',
    });
  });
});
