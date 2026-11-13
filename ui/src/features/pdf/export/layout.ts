/**
 * Feature 014 (D8, D9, plan DP-2): the page's geometry and the print stylesheet. Text size and margins
 * follow the page size (DP-2's standard values), changed by the settings' text size (1 pt smaller or
 * larger) and margins (0.7 or 1.3 times); the line height is Preview's 1.5. Pages are fixed-size
 * boxes the paginator fills (research R7); the browser engine prints one box on each PDF page.
 */
import type { Settings } from '@/rpc/types';

import type { PdfPageSize } from '../pageSizes';

type PdfSettings = NonNullable<Settings['pdf']>;

/** DP-2: the standard text size (pt) and margin (mm) of each page size. */
const STANDARD: Record<string, { textPt: number; marginMm: number }> = {
  a4: { textPt: 11.5, marginMm: 22 },
  letter: { textPt: 11.5, marginMm: 22 },
  legal: { textPt: 11.5, marginMm: 22 },
  b5: { textPt: 11, marginMm: 18 },
  executive: { textPt: 11, marginMm: 18 },
  a5: { textPt: 10.5, marginMm: 15 },
  statement: { textPt: 10.5, marginMm: 15 },
  b6: { textPt: 10, marginMm: 12 },
  a6: { textPt: 9.5, marginMm: 9 },
};

export interface PrintLayout {
  /** The page, in CSS pixels (96 per inch). */
  pageWidth: number;
  pageHeight: number;
  /** The margin on each side, in CSS pixels; the foot margin holds the page number. */
  margin: number;
  /** The text area. */
  contentWidth: number;
  contentHeight: number;
  textPt: number;
  /** The text font family's id (a shipped family or an added font). */
  fontId: string;
}

const PX_PER_IN = 96;
const PX_PER_MM = 96 / 25.4;

export function layoutFor(size: PdfPageSize, settings: PdfSettings | undefined): PrintLayout {
  const standard = STANDARD[size.id] ?? STANDARD.a4;
  const textPt =
    standard.textPt +
    (settings?.textSize === 'smaller' ? -1 : settings?.textSize === 'larger' ? 1 : 0);
  const factor = settings?.margins === 'narrow' ? 0.7 : settings?.margins === 'wide' ? 1.3 : 1;
  const pageWidth = size.widthIn * PX_PER_IN;
  const pageHeight = size.heightIn * PX_PER_IN;
  const margin = standard.marginMm * factor * PX_PER_MM;
  return {
    pageWidth,
    pageHeight,
    margin,
    contentWidth: pageWidth - 2 * margin,
    contentHeight: pageHeight - 2 * margin,
    textPt,
    fontId: settings?.textFont || 'noto-serif',
  };
}

/** The shipped families' files (resources/fonts/fonts.json), as the core serves them. */
const SHIPPED_STYLES: Record<string, string[]> = {
  'noto-serif': ['Regular', 'Italic', 'Bold', 'BoldItalic'],
  'noto-sans': ['Regular', 'Italic', 'Bold', 'BoldItalic'],
  'dejavu-sans-mono': ['Regular', 'Italic', 'Bold', 'BoldItalic'],
  'noto-serif-georgian': ['Regular', 'Bold'],
  'noto-sans-georgian': ['Regular', 'Bold'],
  'noto-serif-armenian': ['Regular', 'Bold'],
  'noto-sans-armenian': ['Regular', 'Bold'],
};

/** The CSS family name each shipped family gets in the paged document. */
export function familyName(id: string): string {
  return `mfbe-${id}`;
}

function fontFaces(fontUrl: (id: string, style: string) => string): string {
  const faces: string[] = [];
  for (const [id, styles] of Object.entries(SHIPPED_STYLES)) {
    for (const style of styles) {
      const weight = style.startsWith('Bold') ? 700 : 400;
      const italic = style.endsWith('Italic');
      faces.push(
        `@font-face { font-family: '${familyName(id)}'; src: url('${fontUrl(id, style)}'); ` +
          `font-weight: ${weight}; font-style: ${italic ? 'italic' : 'normal'}; }`,
      );
    }
  }
  return faces.join('\n');
}

/**
 * The print stylesheet, after Preview's base sheet and the book's stylesheets: white paper (D8), the
 * text font (D7: Georgian and Armenian from their families, code in the monospace one), page boxes of
 * the page's size, no margins of the engine's own.
 */
export function printCss(
  layout: PrintLayout,
  fontUrl: (id: string, style: string) => string,
): string {
  const text = familyName(layout.fontId);
  const sans = layout.fontId === 'noto-sans';
  const georgian = familyName(sans ? 'noto-sans-georgian' : 'noto-serif-georgian');
  const armenian = familyName(sans ? 'noto-sans-armenian' : 'noto-serif-armenian');
  const mono = familyName('dejavu-sans-mono');
  return `${fontFaces(fontUrl)}
@page { size: ${layout.pageWidth}px ${layout.pageHeight}px; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: '${text}', '${georgian}', '${armenian}', '${mono}'; font-size: ${layout.textPt}pt; }
.mfbe-page { position: relative; box-sizing: border-box; width: ${layout.pageWidth}px;
  height: ${layout.pageHeight}px; padding: ${layout.margin}px; overflow: hidden;
  break-after: page; page-break-after: always; }
.mfbe-page:last-child { break-after: auto; page-break-after: auto; }
.mfbe-content { position: relative; width: ${layout.contentWidth}px; height: ${layout.contentHeight}px;
  overflow: hidden; }
.mfbe-number { position: absolute; left: 0; right: 0; bottom: ${layout.margin / 3}px; text-align: center;
  font-size: ${(layout.textPt * 0.85).toFixed(2)}pt; }
.mfbe-picture { display: block; margin: 0 auto; }
.mfbe-continued { text-indent: 0 !important; }
code, [lang|="x-code"] { font-family: '${mono}'; }
`;
}
