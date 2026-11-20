// Feature 017 (T019; DP-13, clarify): words broken at a line's end, the rule the PDF and TXT imports share.
import { describe, expect, it, vi } from 'vitest';

import {
  JOIN_BATCH,
  brokenWordCandidate,
  joinLines,
  knownWords,
  lineJoin,
} from '@/features/text/joinWords';

const known = (word: string): boolean => ['program', 'государство'].includes(word);

describe('lineJoin', () => {
  it('drops a soft hyphen always', () => {
    expect(lineJoin('pro\u00ad', 'gram')).toBe('drop-hyphen');
    expect(joinLines('the pro\u00ad', 'gram runs')).toBe('the program runs');
  });

  it('drops a plain hyphen only when the dictionaries know the joined word', () => {
    expect(joinLines('a pro-', 'gram.', known)).toBe('a program.');
    expect(joinLines('государ-', 'ство', known)).toBe('государство');
  });

  it('keeps an unknown word hyphen and joins without a space', () => {
    expect(lineJoin('north-', 'east', known)).toBe('keep-hyphen');
    expect(joinLines('the north-', 'east wind', known)).toBe('the north-east wind');
  });

  it('joins any other line end with a space, a dash after a space included', () => {
    expect(joinLines('first line ', ' second')).toBe('first line second');
    expect(lineJoin('a pause -', 'then', known)).toBe('space');
  });

  it('gives the candidate word letters only', () => {
    expect(brokenWordCandidate('(pro-', 'gram),')).toBe('program');
    expect(brokenWordCandidate('word', 'next')).toBeNull();
  });
});

describe('knownWords', () => {
  it('asks the three dictionaries in batches, skipping words already known', async () => {
    const words = Array.from({ length: JOIN_BATCH + 10 }, (_, i) => `word${i}`);
    const ask = vi.fn(async (batch: string[], code: string) =>
      code === 'en' ? batch.filter((w) => w !== 'word1') : batch.filter((w) => w !== 'word2'),
    );
    const progress: number[] = [];
    const result = await knownWords(words, ask, (asked) => progress.push(asked));
    expect([...result].sort()).toEqual(['word1', 'word2']);
    expect(ask).toHaveBeenCalledTimes(6);
    expect(progress.at(-1)).toBe(6);
  });

  it('counts a failing dictionary as knowing nothing', async () => {
    const result = await knownWords(['program'], async () => Promise.reject(new Error('no core')));
    expect(result.size).toBe(0);
  });
});
