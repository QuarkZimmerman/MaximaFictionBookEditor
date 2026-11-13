/**
 * Feature 014 (D7, FR-006, research R5; tasks T030): the fonts the book's stylesheets name keep
 * their kind.
 */
import { describe, expect, it } from 'vitest';

import { kindOf, replaceBookFonts, type TextFont } from '@/features/pdf/export/fontKinds';

const SERIF_TEXT: TextFont = { id: 'noto-serif', kind: 'serif' };
const SANS_TEXT: TextFont = { id: 'noto-sans', kind: 'sans-serif' };

describe('font kinds (D7)', () => {
  it('takes the generic family first, then the known list, else serif', () => {
    expect(kindOf('Georgia, sans-serif')).toBe('sans-serif');
    expect(kindOf('"Fancy Book", monospace')).toBe('monospace');
    expect(kindOf('Verdana')).toBe('sans-serif');
    expect(kindOf("'Courier New'")).toBe('monospace');
    expect(kindOf('Times New Roman')).toBe('serif');
    expect(kindOf('Some Unknown Face')).toBe('serif');
  });

  it('replaces each named font by the text font of its kind, else the shipped family of its kind', async () => {
    const replaced = new Set<string>();
    const css = await replaceBookFonts(
      'p { font-family: Arial, sans-serif; } h1 { font-family: "Times New Roman"; } code { font-family: Consolas; }',
      SERIF_TEXT,
      replaced,
    );
    expect(css).toContain(
      "p{font-family:'mfbe-noto-sans', 'mfbe-noto-sans-georgian', 'mfbe-noto-sans-armenian', 'mfbe-dejavu-sans-mono'}",
    );
    expect(css).toContain("h1{font-family:'mfbe-noto-serif', 'mfbe-noto-serif-georgian'");
    expect(css).toContain("code{font-family:'mfbe-dejavu-sans-mono'");
    expect([...replaced].sort()).toEqual(['Arial', 'Consolas', 'Times New Roman']);

    // With a sans-serif text font, sans-serif declarations take it and serif ones Noto Serif.
    const sans = await replaceBookFonts(
      '.title { font-family: Helvetica } p { font-family: Georgia }',
      SANS_TEXT,
      new Set(),
    );
    expect(sans).toContain(".title{font-family:'mfbe-noto-sans'");
    expect(sans).toContain("p{font-family:'mfbe-noto-serif'");
  });

  it('replaces the family of the font shorthand and keeps its size', async () => {
    const replaced = new Set<string>();
    const css = await replaceBookFonts(
      'h2 { font: bold 1.2em/1.4 "Gill Sans", sans-serif; }',
      SERIF_TEXT,
      replaced,
    );
    expect(css).toContain("h2{font:bold 1.2em/1.4 'mfbe-noto-sans'");
    expect([...replaced]).toEqual(['Gill Sans']);
  });

  it('keeps a stylesheet it cannot read, and keywords such as inherit', async () => {
    expect(await replaceBookFonts('p { font-family: inherit }', SERIF_TEXT, new Set())).toContain(
      'font-family:inherit',
    );
    // An unclosed block is closed at the end of the sheet, as browsers read it; a stray brace is
    // unreadable.
    expect(await replaceBookFonts('p { font-family: Arial', SERIF_TEXT, new Set())).toContain(
      "'mfbe-noto-sans'",
    );
    const broken = 'p { font-family: Arial; } }';
    expect(await replaceBookFonts(broken, SERIF_TEXT, new Set())).toBe(broken);
  });
});
