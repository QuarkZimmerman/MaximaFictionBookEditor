/**
 * Feature 014 (SC-014, plan DP-2; tasks T032): at the standard settings a line holds 50 to 90
 * characters in every page size. The check reads the layout table the export uses (layout.ts) and
 * the shipped text font's own advance widths (resources/fonts/NotoSerif-Regular.ttf), averaged over
 * running English and Russian text.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { layoutFor } from '@/features/pdf/export/layout';
import { PDF_PAGE_SIZES } from '@/features/pdf/pageSizes';

const FONT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../resources/fonts/NotoSerif-Regular.ttf',
);

/** The advance width of each character, in em, from the font's cmap (format 4) and hmtx tables. */
function advances(file: string): (char: string) => number {
  const font = readFileSync(file);
  const tables = new Map<string, number>();
  const count = font.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tables.set(font.toString('latin1', at, at + 4), font.readUInt32BE(at + 8));
  }
  const head = tables.get('head')!;
  const unitsPerEm = font.readUInt16BE(head + 18);
  const metrics = font.readUInt16BE(tables.get('hhea')! + 34);
  const hmtx = tables.get('hmtx')!;
  const cmap = tables.get('cmap')!;
  let format4 = -1;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + i * 8;
    const offset = cmap + font.readUInt32BE(record + 4);
    if (font.readUInt16BE(offset) === 4) format4 = offset;
  }
  const segments = font.readUInt16BE(format4 + 6) / 2;
  const ends = format4 + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  const glyph = (code: number): number => {
    for (let s = 0; s < segments; s++) {
      if (code > font.readUInt16BE(ends + s * 2)) continue;
      const start = font.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = font.readInt16BE(deltas + s * 2);
      const range = font.readUInt16BE(ranges + s * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const at = ranges + s * 2 + range + (code - start) * 2;
      const id = font.readUInt16BE(at);
      return id === 0 ? 0 : (id + delta) & 0xffff;
    }
    return 0;
  };
  return (char: string) => {
    const id = glyph(char.codePointAt(0)!);
    const index = Math.min(id, metrics - 1);
    return font.readUInt16BE(hmtx + index * 4) / unitsPerEm;
  };
}

const ENGLISH =
  'It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his ' +
  'chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly through the ' +
  'glass doors of Victory Mansions, though not quickly enough to prevent a swirl of gritty dust ' +
  'from entering along with him.';
const RUSSIAN =
  'Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему. ' +
  'Всё смешалось в доме Облонских. Жена узнала, что муж был в связи с бывшею в их доме ' +
  'француженкою-гувернанткой, и объявила мужу, что не может жить с ним в одном доме.';

describe('line length at the standard settings (SC-014)', () => {
  const advance = advances(FONT);
  const averageEm = (text: string): number =>
    [...text].reduce((sum, char) => sum + advance(char), 0) / [...text].length;

  for (const size of PDF_PAGE_SIZES) {
    it(`${size.id}: 50 to 90 characters a line in English and Russian`, () => {
      const layout = layoutFor(size, undefined);
      const fontPx = (layout.textPt * 96) / 72;
      for (const text of [ENGLISH, RUSSIAN]) {
        const perLine = layout.contentWidth / (averageEm(text) * fontPx);
        expect(perLine).toBeGreaterThanOrEqual(50);
        expect(perLine).toBeLessThanOrEqual(90);
      }
    });
  }
});
