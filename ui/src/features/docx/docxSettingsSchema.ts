/**
 * Feature 023 (T011; data-model.md §1, contracts/settings.md): static DOCX export settings schema,
 * curated cross-platform font family list, default values, and PDF-shared proportional margin math.
 * Lives outside `docx/export/` so Settings, Batch Converter, and the static export command stay in
 * the main bundle without pulling lazy DOCX chunks.
 */
import { PDF_PAGE_SIZES } from '@/features/pdf/pageSizes';
import type { DocxFontFamilyPreset, PdfPageSizeId, Settings } from '@/rpc/types';

export type DocxSettings = NonNullable<Settings['docx']>;

export const DOCX_FONT_FAMILIES: readonly Exclude<DocxFontFamilyPreset, 'custom'>[] = [
  'Georgia',
  'Times New Roman',
  'Cambria',
  'Garamond',
  'Noto Serif',
  'DejaVu Serif',
  'Liberation Serif',
  'Calibri',
  'Arial',
] as const;

export const DOCX_TEXT_SIZES_PT: readonly number[] = [10, 11, 12, 13, 14] as const;

export const DOCX_DEFAULTS: DocxSettings = {
  defaultPageSize: 'a4',
  margins: 'standard',
  customMargin: 22,
  fontFamily: 'Georgia',
  customFontFamily: '',
  textSizePt: 12,
  tocPlacement: 'afterTitle',
  notesPlacement: 'footnotes',
  zip: false,
};

const STANDARD_MARGIN_MM: Record<PdfPageSizeId, number> = {
  a4: 22,
  letter: 24,
  legal: 24,
  b5: 18,
  executive: 18,
  a5: 15,
  statement: 15,
  b6: 12,
  a6: 8,
};

export function isDocxPageSizeId(value: string | undefined): value is PdfPageSizeId {
  return PDF_PAGE_SIZES.some((size) => size.id === value);
}

/** Reuses PDF export's page-size-aware proportional margin presets (narrow 0.7x, wide 1.3x). */
export function docxMarginMm(
  pageSizeId: string | undefined,
  settings: Partial<DocxSettings> | undefined,
): number {
  const sizeKey: PdfPageSizeId = isDocxPageSizeId(pageSizeId) ? pageSizeId : 'a4';
  const base = STANDARD_MARGIN_MM[sizeKey];
  if (settings?.margins === 'custom') {
    return Math.min(50, Math.max(5, Math.round(settings.customMargin ?? 22)));
  }
  const factor = settings?.margins === 'narrow' ? 0.7 : settings?.margins === 'wide' ? 1.3 : 1;
  return Math.round(base * factor * 10) / 10;
}

/** Resolves the effective Word font family name; blank custom input falls back to Georgia. */
export function resolveDocxFontFamily(settings: Partial<DocxSettings> | undefined): string {
  const preset = settings?.fontFamily ?? DOCX_DEFAULTS.fontFamily;
  if (preset === 'custom') {
    const cleaned = (settings?.customFontFamily ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 80);
    return cleaned.length > 0 ? cleaned : DOCX_DEFAULTS.fontFamily;
  }
  return preset;
}

export function resolveDocxSettings(raw: Partial<DocxSettings> | undefined): DocxSettings {
  return {
    ...DOCX_DEFAULTS,
    ...raw,
  };
}
