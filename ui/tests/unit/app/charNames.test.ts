/**
 * Feature 009, User Story 5 (T059): every character of SC-010's reference list is named, or its
 * script given; codes beyond the basic plane and combining marks are shown right.
 */
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import { characterKey, characterReference, codePointLabel } from '@/app/charNames';
import { initI18n } from '@/i18n';

const REFERENCE: readonly [number, string][] = [
  [0x00a0, 'No-break space'],
  [0x202f, 'Narrow no-break space'],
  [0x00ad, 'Soft hyphen'],
  [0x200b, 'Zero-width space'],
  [0x200c, 'Zero-width non-joiner'],
  [0x200d, 'Zero-width joiner'],
  [0x2060, 'Word joiner'],
  [0xfeff, 'Zero-width no-break space (BOM)'],
  [0x2002, 'En space'],
  [0x2003, 'Em space'],
  [0x2009, 'Thin space'],
  [0x200a, 'Hair space'],
  [0x2007, 'Figure space'],
  [0x2010, 'Hyphen'],
  [0x2011, 'Non-breaking hyphen'],
  [0x2012, 'Figure dash'],
  [0x2013, 'En dash'],
  [0x2014, 'Em dash'],
  [0x2212, 'Minus sign'],
];

describe('the character pane (SC-010, data-model §8)', () => {
  it('names every space, invisible character, hyphen and dash of the reference list', async () => {
    const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
    for (const [cp, name] of REFERENCE) {
      const key = characterKey(cp);
      expect(key, codePointLabel(cp)).not.toBeNull();
      expect(i18n.t(key!), codePointLabel(cp)).toBe(name);
    }
  });

  it('tells a Latin a from a Cyrillic а by their scripts', () => {
    expect(characterKey('a'.codePointAt(0)!)).toBe('status.char.script.latin');
    expect(characterKey('\u0430'.codePointAt(0)!)).toBe('status.char.script.cyrillic');
    expect(characterKey('\u05D0'.codePointAt(0)!)).toBe('status.char.script.hebrew');
    expect(characterKey('\u03B1'.codePointAt(0)!)).toBe('status.char.script.greek');
  });

  it('shows a code beyond the basic plane in full, and a combining mark as such', () => {
    expect(codePointLabel(0x1f600)).toBe('U+1F600');
    expect(characterReference(0x1f600)).toBe('&#128512;');
    expect(codePointLabel(0x00a0)).toBe('U+00A0');
    expect(characterReference(0x00a0)).toBe('&#160;');
    expect(characterKey(0x0306)).toBe('status.char.combining');
    expect(characterKey('5'.codePointAt(0)!)).toBeNull();
  });
});
