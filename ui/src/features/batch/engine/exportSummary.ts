/**
 * Feature 019 (T028; FR-005): formats a compact, localised one-line summary of the active
 * Settings -> Exports defaults for the chosen target format.
 */

import type { TFunction } from 'i18next';

import { resolveDocxFontFamily, resolveDocxSettings } from '@/features/docx/docxSettingsSchema';
import { pdfValues } from '@/features/pdf/printValues';
import type { Settings } from '@/rpc/types';

import type { BatchBookFormat } from './types';

function formatPdfFontId(fontId: string): string {
  const known: Record<string, string> = {
    'noto-serif': 'Noto Serif',
    'noto-sans': 'Noto Sans',
    'noto-sans-mono': 'Noto Sans Mono',
    'dejavu-serif': 'DejaVu Serif',
    'dejavu-sans': 'DejaVu Sans',
    'dejavu-sans-mono': 'DejaVu Sans Mono',
    'eb-garamond': 'EB Garamond',
    'pt-serif': 'PT Serif',
    'pt-sans': 'PT Sans',
    'liberation-serif': 'Liberation Serif',
    'liberation-sans': 'Liberation Sans',
    'liberation-mono': 'Liberation Mono',
  };
  return known[fontId] ?? fontId;
}

export function formatActiveExportSummary(
  format: BatchBookFormat,
  settings: Settings | null,
  zipOutput: boolean,
  t: TFunction,
  customFontName?: string,
): string {
  switch (format) {
    case 'epub':
      return t('batch.export.epubDefaults');

    case 'pdf': {
      const pdf = settings?.pdf;
      const pageId = pdf?.defaultPageSize ?? 'a4';
      const page = t(`pdf.sizes.${pageId}`);
      const font = customFontName ?? formatPdfFontId(pdf?.textFont ?? 'noto-serif');
      const textSize = pdf?.textSize ?? 'standard';
      const resolved = pdfValues(pageId, pdf);
      const size = `${t(`pdf.settings.textSizes.${textSize}`)} (${resolved.textPt} pt)`;
      const marginsId = pdf?.margins ?? 'standard';
      const margins = t(`pdf.settings.marginSizes.${marginsId}`);
      return t('batch.export.pdfSummary', { page, font, size, margins });
    }

    case 'txt': {
      const txt = settings?.txt;
      const mode = txt?.encodingMode ?? 'utf-8';
      const base = mode === 'language' ? t('batch.export.txtByLang') : t('batch.export.txtUtf8');
      if (mode === 'utf-8' && txt?.bom) {
        return `${base}, ${t('batch.export.txtBom')}`;
      }
      return base;
    }

    case 'mobi': {
      const mobi = settings?.mobi;
      const fmt = mobi?.format ?? 'joint';
      const toc = mobi?.tocPlacement ?? 'afterTitle';
      const openAt = mobi?.openAt ?? 'titlePage';
      return t('batch.export.mobiSummary', {
        format: t(`mobi.formats.${fmt}`),
        toc: t(`mobi.tocPlacements.${toc}`),
        openAt: t(`mobi.openAtModes.${openAt}`),
      });
    }

    case 'markdown': {
      if (zipOutput) {
        return t('batch.export.markdownZipSummary');
      }
      const includePictures = settings?.markdown?.includePictures ?? true;
      return includePictures
        ? t('batch.export.markdownPicturesOn')
        : t('batch.export.markdownPicturesOff');
    }

    case 'docx': {
      const docx = resolveDocxSettings(settings?.docx);
      const page = t(`pdf.sizes.${docx.defaultPageSize}`);
      const font = resolveDocxFontFamily(docx);
      const size = t('docx.settings.textSizeValue', { pt: docx.textSizePt });
      const margins =
        docx.margins === 'custom'
          ? `${docx.customMargin} mm`
          : t(`docx.settings.marginPresets.${docx.margins}`);
      const notes = t(`docx.settings.notesPlacements.${docx.notesPlacement}`);
      return t('batch.export.docxSummary', { page, font, size, margins, notes });
    }
  }
}
