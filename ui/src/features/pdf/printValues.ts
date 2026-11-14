/**
 * The PDF export's text size and margins (feature 014, DP-2): the numbers the export lays its pages
 * out with, and that Settings > PDF export shows beside each choice. A module of its own, outside
 * the export's lazy chunk, so the settings page can read it (guard G20).
 */
import type { Settings } from '@/rpc/types';

type PdfSettings = NonNullable<Settings['pdf']>;

/**
 * DP-2: the standard text size (pt) and margin (mm) of each page size. Letter and Legal have wider
 * margins than A4, and A6 a smaller text, so that a line holds 50 to 90 characters of English and
 * Russian text in every size (SC-014, checked by tests/unit/pdf/lineLength.test.ts).
 */
const STANDARD: Record<string, { textPt: number; marginMm: number }> = {
  a4: { textPt: 11.5, marginMm: 22 },
  letter: { textPt: 11.5, marginMm: 24 },
  legal: { textPt: 11.5, marginMm: 24 },
  b5: { textPt: 11, marginMm: 18 },
  executive: { textPt: 11, marginMm: 18 },
  a5: { textPt: 10.5, marginMm: 15 },
  statement: { textPt: 10.5, marginMm: 15 },
  b6: { textPt: 10, marginMm: 12 },
  a6: { textPt: 9, marginMm: 8 },
};

/**
 * The text size (pt) and the margin (mm) a page size gets with these settings: its DP-2 standard,
 * 1 pt smaller or larger, margins 0.7 or 1.3 times, or the custom values. The settings page shows
 * these same numbers beside each choice.
 */
export function pdfValues(
  sizeId: string,
  settings: Partial<PdfSettings> | undefined,
): { textPt: number; marginMm: number } {
  const standard = STANDARD[sizeId] ?? STANDARD.a4!;
  const textPt =
    settings?.textSize === 'custom'
      ? (settings.customTextSize ?? 115) / 10
      : standard.textPt +
        (settings?.textSize === 'smaller' ? -1 : settings?.textSize === 'larger' ? 1 : 0);
  const marginMm =
    settings?.margins === 'custom'
      ? (settings.customMargin ?? 22)
      : standard.marginMm *
        (settings?.margins === 'narrow' ? 0.7 : settings?.margins === 'wide' ? 1.3 : 1);
  return { textPt, marginMm };
}
