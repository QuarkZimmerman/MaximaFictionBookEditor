/**
 * Feature 023 (T012; research.md §R4): OOXML twips, half-points, and EMU geometry conversions.
 */
import { pdfPageSize } from '@/features/pdf/pageSizes';

export const TWIPS_PER_INCH = 1440;
export const EMUS_PER_INCH = 914400;
export const EMUS_PER_TWIP = 635;
export const MM_PER_INCH = 25.4;

export function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

export function mmToTwips(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * TWIPS_PER_INCH);
}

export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2);
}

export function pxToEmu(px: number, dpi = 96): number {
  return Math.round((px / dpi) * EMUS_PER_INCH);
}

export interface DocxPageGeometry {
  widthTwips: number;
  heightTwips: number;
  marginTwips: number;
  contentWidthEmu: number;
  contentHeightEmu: number;
}

export function computeDocxPageGeometry(
  pageSizeId: string | undefined,
  marginMm: number,
): DocxPageGeometry {
  const size = pdfPageSize(pageSizeId);
  const widthTwips = inchesToTwips(size.widthIn);
  const heightTwips = inchesToTwips(size.heightIn);
  const marginTwips = mmToTwips(marginMm);
  const contentWidthTwips = Math.max(1440, widthTwips - marginTwips * 2);
  const contentHeightTwips = Math.max(1440, heightTwips - marginTwips * 2);
  return {
    widthTwips,
    heightTwips,
    marginTwips,
    contentWidthEmu: contentWidthTwips * EMUS_PER_TWIP,
    contentHeightEmu: contentHeightTwips * EMUS_PER_TWIP,
  };
}

/** Scales pixel dimensions proportionally to fit inside `(maxWidthEmu, maxHeightEmu)`. */
export function fitImageToBoxEmu(
  widthPx: number,
  heightPx: number,
  maxWidthEmu: number,
  maxHeightEmu: number,
  fillBox = false,
): { cx: number; cy: number } {
  const safeW = widthPx > 0 ? widthPx : 400;
  const safeH = heightPx > 0 ? heightPx : 300;
  let cx = pxToEmu(safeW);
  let cy = pxToEmu(safeH);
  const scaleW = maxWidthEmu / cx;
  const scaleH = maxHeightEmu / cy;
  const scale = fillBox ? Math.min(scaleW, scaleH) : Math.min(1, scaleW, scaleH);
  cx = Math.max(EMUS_PER_TWIP * 20, Math.round(cx * scale));
  cy = Math.max(EMUS_PER_TWIP * 20, Math.round(cy * scale));
  return { cx, cy };
}
