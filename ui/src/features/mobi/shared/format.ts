/**
 * Feature 018 (T014): MOBI/KF8 format definitions and third-party FB2 converter class maps
 * (this editor's `fb2-*`, Calibre, `fb2converter`, and `maxlibmobi`).
 */
import type { MobiFormat, MobiOpenAt, MobiSeriesInTitle, MobiTocPlacement } from '@/rpc/types';

export interface MobiFormatSpec {
  id: MobiFormat;
  extension: 'mobi' | 'azw3';
  labelKey: string;
}

export const MOBI_FORMATS: readonly MobiFormatSpec[] = [
  { id: 'mobi7', extension: 'mobi', labelKey: 'mobi.formats.mobi7' },
  { id: 'joint', extension: 'mobi', labelKey: 'mobi.formats.joint' },
  { id: 'kf8', extension: 'azw3', labelKey: 'mobi.formats.kf8' },
];

export const MOBI_TOC_PLACEMENTS: readonly { id: MobiTocPlacement; labelKey: string }[] = [
  { id: 'afterTitle', labelKey: 'mobi.tocPlacements.afterTitle' },
  { id: 'end', labelKey: 'mobi.tocPlacements.end' },
  { id: 'none', labelKey: 'mobi.tocPlacements.none' },
];

export const MOBI_SERIES_MODES: readonly { id: MobiSeriesInTitle; labelKey: string }[] = [
  { id: 'off', labelKey: 'mobi.seriesModes.off' },
  { id: 'numberBefore', labelKey: 'mobi.seriesModes.numberBefore' },
  { id: 'seriesAndNumber', labelKey: 'mobi.seriesModes.seriesAndNumber' },
];

export const MOBI_OPEN_AT_MODES: readonly { id: MobiOpenAt; labelKey: string }[] = [
  { id: 'titlePage', labelKey: 'mobi.openAtModes.titlePage' },
  { id: 'mainText', labelKey: 'mobi.openAtModes.mainText' },
];

export function extensionForMobiFormat(format: MobiFormat): 'mobi' | 'azw3' {
  return format === 'kf8' ? 'azw3' : 'mobi';
}

export type Fb2SemanticRole =
  | 'section'
  | 'title'
  | 'subtitle'
  | 'epigraph'
  | 'poem'
  | 'stanza'
  | 'verse'
  | 'text-author'
  | 'date'
  | 'cite'
  | 'annotation'
  | 'empty-line'
  | 'note'
  | 'note-title'
  | 'backlink'
  | 'cover'
  | 'title-page'
  | 'toc';

/**
 * Class names emitted by this editor (`fb2-*`), `fb2converter`, `maxlibmobi`, and Calibre FB2
 * converters mapped to their FB2 structural role (contracts/mobi-import.md §3).
 */
export const CONVERTER_CLASS_ROLE: Readonly<Record<string, Fb2SemanticRole>> = {
  // This editor + maxlibmobi (`fb2-*`)
  'fb2-section': 'section',
  'fb2-title': 'title',
  'fb2-subtitle': 'subtitle',
  'fb2-epigraph': 'epigraph',
  'fb2-poem': 'poem',
  'fb2-stanza': 'stanza',
  'fb2-stanza-title': 'title',
  'fb2-v': 'verse',
  'fb2-text-author': 'text-author',
  'fb2-date': 'date',
  'fb2-cite': 'cite',
  'fb2-annotation': 'annotation',
  'fb2-empty-line': 'empty-line',
  'fb2-note': 'note',
  'fb2-note-title': 'note-title',
  'fb2-backlink': 'backlink',
  'fb2-cover': 'cover',
  'fb2-title-page': 'title-page',
  'fb2-toc': 'toc',
  // fb2converter & common FB2->HTML conventions
  title: 'title',
  title1: 'title',
  title2: 'title',
  title3: 'title',
  title4: 'title',
  title5: 'title',
  title6: 'title',
  subtitle: 'subtitle',
  epigraph: 'epigraph',
  epigraph_main: 'epigraph',
  poem: 'poem',
  stanza: 'stanza',
  v: 'verse',
  verse: 'verse',
  'text-author': 'text-author',
  text_author: 'text-author',
  author_epigraph: 'text-author',
  date: 'date',
  cite: 'cite',
  citation: 'cite',
  annotation: 'annotation',
  'empty-line': 'empty-line',
  emptyline: 'empty-line',
  footnote: 'note',
  notes: 'note',
  // Calibre FB2 converter semantic classes
  calibre_title: 'title',
  calibre_subtitle: 'subtitle',
  calibre_epigraph: 'epigraph',
  calibre_poem: 'poem',
  calibre_stanza: 'stanza',
  calibre_cite: 'cite',
  calibre_annotation: 'annotation',
};

/** Returns the first recognisable FB2 structural role among an element's CSS classes. */
export function semanticRoleOfClasses(classList: Iterable<string>): Fb2SemanticRole | null {
  for (const raw of classList) {
    const key = raw.trim().toLowerCase();
    const role = CONVERTER_CLASS_ROLE[key];
    if (role) return role;
  }
  return null;
}

/** True when a class name belongs to a known FB2 structural converter rather than visual styling. */
export function isConverterStructuralClass(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    lower in CONVERTER_CLASS_ROLE ||
    lower.startsWith('fb2-') ||
    lower === 'mfbe-pagebreak' ||
    lower === 'fb-continued'
  );
}
