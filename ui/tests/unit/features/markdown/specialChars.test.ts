// Feature 010, US8 (D37, contracts/markdown-mapping.md §3): which characters stay text, which
// become pictures from which font, which are dropped.

import { describe, expect, it } from 'vitest';

import {
  codePoints,
  expandEmojiCodes,
  graphemes,
  pictureId,
  specialChar,
  treatmentOf,
} from '@/features/markdown/specialChars';

describe('special characters', () => {
  it('keeps letters of every script and the safe symbols as text', () => {
    for (const text of [
      'A',
      'ж',
      'é',
      'ω',
      '中',
      'א',
      '7',
      ',',
      '—',
      '€',
      '№',
      '™',
      '©',
      '→',
      '±',
      '≤',
      '\u00a0',
      '\u2009',
    ]) {
      expect(treatmentOf(text), text).toBe('keep');
    }
  });

  it('draws emoji, with their modifiers, flags, keycaps and joined sequences, as one picture each', () => {
    for (const text of ['✅', '😀', '👍🏽', '🇺🇦', '1️⃣', '👨‍👩‍👧', '❤️', '☑️']) {
      expect(treatmentOf(text), text).toBe('emoji');
    }
    expect(graphemes('a👍🏽b🇺🇦')).toEqual(['a', '👍🏽', 'b', '🇺🇦']);
    expect(pictureId('✅')).toBe('ch-2705');
    expect(pictureId('❤️')).toBe('ch-2764');
    expect(pictureId('👍🏽')).toBe('ch-1f44d-1f3fd');
    expect(specialChar('✅')).toEqual({ id: 'ch-2705', text: '✅', font: 'emoji' });
  });

  it('draws check boxes, dingbats and shapes from the symbol fonts, mathematics from the math font', () => {
    for (const text of ['☐', '☑', '☒', '✓', '✔', '✗', '✘', '★', '■', '│', '⇒']) {
      expect(treatmentOf(text), text).toBe('symbol');
    }
    for (const text of ['∀', '∑', '⊂', '𝔸', 'ℝ']) {
      expect(treatmentOf(text), text).toBe('math');
    }
  });

  it('drops private-use characters and lone joiners and selectors', () => {
    expect(treatmentOf('\ue000')).toBe('drop');
    expect(treatmentOf('\u{f0001}')).toBe('drop');
    expect(treatmentOf('\u200d')).toBe('invisible');
    expect(treatmentOf('\ufe0f')).toBe('invisible');
    expect(codePoints('\ue000')).toBe('U+E000');
  });

  it('expands the known GitHub codes and leaves the others', () => {
    expect(expandEmojiCodes('Done :white_check_mark: :+1: :not_a_code:')).toBe(
      'Done ✅ 👍 :not_a_code:',
    );
  });
});
