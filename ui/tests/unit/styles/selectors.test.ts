// Feature 011 (US8; contracts/styles.md §1): the selectors the Styles view accepts.
import { describe, expect, it } from 'vitest';

import { checkSelector, classesOf } from '@/features/styles/selectors';

describe('Styles view selectors (contracts/styles.md §1)', () => {
  it('accepts FB2 elements, classes, ids, structural pseudo-classes and the four combinators', () => {
    for (const selector of [
      'p',
      'section > title',
      'p.letter',
      '.letter',
      '#chapter1',
      'epigraph text-author',
      'p + p',
      'title ~ p',
      'section:first-child',
      'p:nth-child(2n+1)',
      'p:not(.letter)',
      'p::first-letter',
      '*',
      'p, v, subtitle',
    ]) {
      expect(checkSelector(selector), selector).toEqual({ ok: true });
    }
  });

  it('refuses what matches nothing in an FB2 book, with the part that does not', () => {
    expect(checkSelector('div > span')).toEqual({
      ok: false,
      reason: 'matchesNothing',
      detail: 'div',
    });
    expect(checkSelector('p[lang]')).toMatchObject({ ok: false, reason: 'matchesNothing' });
    expect(checkSelector('a:hover')).toEqual({
      ok: false,
      reason: 'matchesNothing',
      detail: ':hover',
    });
    expect(checkSelector('p::before')).toEqual({
      ok: false,
      reason: 'matchesNothing',
      detail: '::before',
    });
  });

  it('refuses a selector that does not parse', () => {
    expect(checkSelector('p >')).toMatchObject({ ok: false, reason: 'syntax' });
    expect(checkSelector('')).toMatchObject({ ok: false, reason: 'syntax' });
  });

  it('lists the classes a selector defines, each once', () => {
    expect(classesOf('p.letter, .letter, .sign > .x')).toEqual(['letter', 'sign', 'x']);
  });
});
