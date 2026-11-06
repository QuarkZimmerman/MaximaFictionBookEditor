/**
 * Feature 009, User Story 5 (T060): word counting, long selections counted in chunks, the
 * encoding text, the validity from the last check, and the panes the setting shows
 * (data-model §8).
 */
import { describe, expect, it } from 'vitest';

import {
  countChars,
  countWords,
  countWordsInChunks,
  encodingText,
  STATUS_PANES,
  validityOf,
  visiblePanes,
} from '@/app/statusInfo';

describe('selection counts', () => {
  it('words are runs of letters and digits; an inner hyphen or apostrophe does not split one', () => {
    expect(countWords('Война и мир')).toBe(3);
    expect(countWords("well-known rock’n’roll isn't 2024")).toBe(4);
    expect(countWords(' - — , ')).toBe(0);
    expect(countWords('one,two;three')).toBe(3);
  });

  it('characters are code points, a pair beyond the basic plane counting once', () => {
    expect(countChars('a\u{1F600}b')).toBe(3);
    expect(countChars('')).toBe(0);
  });

  it('a selection over 200,000 characters is counted in chunks, never cutting a word', () => {
    const text = 'слово '.repeat(60_000); // 360,000 characters
    const steps: (() => void)[] = [];
    let result = -1;
    countWordsInChunks(
      text,
      (words) => {
        result = words;
      },
      (step) => steps.push(step),
    );
    let chunks = 0;
    while (steps.length > 0) {
      steps.shift()!();
      chunks += 1;
    }
    expect(chunks).toBeGreaterThan(1);
    expect(result).toBe(60_000);
  });
});

describe('the encoding pane', () => {
  it('shows the file encoding, and the next Save’s when it differs', () => {
    expect(encodingText('utf-8', 'utf-8')).toBe('UTF-8');
    expect(encodingText('windows-1251', 'utf-8')).toBe('WINDOWS-1251 \u2192 UTF-8');
    expect(encodingText(undefined, 'utf-8')).toBe('UTF-8');
  });
});

describe('the validity pane (FR-055)', () => {
  it('shows the last check while nothing changed since, "not checked" otherwise', () => {
    expect(validityOf(null, 0)).toEqual({ state: 'unchecked' });
    expect(validityOf({ problems: 0, revision: 3 }, 3)).toEqual({ state: 'valid' });
    expect(validityOf({ problems: 2, revision: 3 }, 3)).toEqual({ state: 'problems', count: 2 });
    expect(validityOf({ problems: 0, revision: 3 }, 4)).toEqual({ state: 'unchecked' });
  });
});

describe('view.statusBarPanes', () => {
  it('shows the setting’s panes in the bar’s order, all of them without a setting', () => {
    expect(visiblePanes(undefined)).toEqual([...STATUS_PANES]);
    expect(visiblePanes(['validity', 'path', 'unknown'])).toEqual(['path', 'validity']);
    expect(visiblePanes([])).toEqual([]);
  });
});
