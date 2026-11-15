import { describe, expect, it } from 'vitest';

import { pdfValues } from '@/features/pdf/printValues';

describe('pdfValues: the numbers behind the PDF settings (requester, rc.3)', () => {
  it('gives the standard of each page size, a point smaller or larger, margins 0.7 or 1.3 times', () => {
    expect(pdfValues('a4', { textSize: 'standard', margins: 'standard' })).toEqual({
      textPt: 11.5,
      marginMm: 22,
    });
    expect(pdfValues('a6', { textSize: 'larger', margins: 'narrow' }).textPt).toBe(10);
    expect(pdfValues('a4', { textSize: 'smaller', margins: 'wide' }).marginMm).toBeCloseTo(28.6, 6);
  });
  it('uses the custom values, in tenths of a point and whole millimetres, on every page size', () => {
    const custom = {
      textSize: 'custom',
      margins: 'custom',
      customTextSize: 125,
      customMargin: 30,
    } as const;
    expect(pdfValues('a4', custom)).toEqual({ textPt: 12.5, marginMm: 30 });
    expect(pdfValues('a6', custom)).toEqual({ textPt: 12.5, marginMm: 30 });
  });
});
