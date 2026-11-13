/**
 * Feature 014 (D7, FR-006, research R5; tasks T030): the fonts the book's stylesheets name keep
 * their kind.
 */
import { describe, expect, it } from 'vitest';

import { kindOf, replaceBookFonts, type TextFont } from '@/features/pdf/export/fontKinds';
import { layoutFor, printCss } from '@/features/pdf/export/layout';
import { pdfPageSize } from '@/features/pdf/pageSizes';

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

describe('an added text font (D7(c))', () => {
  const added: TextFont = { id: 'a'.repeat(64), kind: 'sans-serif', added: true };

  it('comes first, followed by the shipped family of its kind, for what it does not draw', async () => {
    const css = await replaceBookFonts('p { font-family: Arial, sans-serif; }', added, new Set());
    expect(css).toContain(`'mfbe-${'a'.repeat(64)}', 'mfbe-noto-sans', 'mfbe-noto-sans-georgian'`);
  });

  it('has its own @font-face, and the body uses it before the shipped family', () => {
    const layout = layoutFor(pdfPageSize('a5'), undefined, { id: 'b'.repeat(64), kind: 'serif' });
    expect(layout.fontId).toBe('b'.repeat(64));
    const css = printCss(
      layout,
      (id, style) => `/shipped/${id}/${style}`,
      (id) => `/added/${id}`,
    );
    expect(css).toContain(
      `@font-face { font-family: 'mfbe-${'b'.repeat(64)}'; src: url('/added/${'b'.repeat(64)}'); }`,
    );
    expect(css).toContain(
      `font-family: 'mfbe-${'b'.repeat(64)}', 'mfbe-noto-serif', 'mfbe-noto-serif-georgian'`,
    );
  });

  it('reads as Noto Serif when the setting names a font that is not there', () => {
    expect(
      layoutFor(pdfPageSize('a5'), {
        defaultPageSize: 'a4',
        textFont: 'gone',
        textSize: 'standard',
        margins: 'standard',
      }).fontId,
    ).toBe('noto-serif');
  });
});
