/**
 * Neutral shared SVG single-image unwrapper and RGBA JPEG/PNG classifier used by EPUB and MOBI
 * imports (feature 018 T013).
 */

export const SVG_GRAPHICS: ReadonlySet<string> = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'use',
]);

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** D23: PNG when any pixel is transparent or image has <= 256 colours, else JPEG. */
export function pictureFormat(rgba: Uint8ClampedArray): 'image/png' | 'image/jpeg' {
  const colours = new Set<number>();
  let many = false;
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    if (rgba[at + 3]! < 255) return 'image/png';
    if (!many) {
      colours.add((rgba[at]! << 16) | (rgba[at + 1]! << 8) | rgba[at + 2]!);
      many = colours.size > 256;
    }
  }
  return many ? 'image/jpeg' : 'image/png';
}

/**
 * If an `<svg>` element merely frames a single `<image>` (with no drawing primitives), return its
 * `href` / `xlink:href` attribute; otherwise null.
 */
export function singleFramedImageHref(svgElement: Element): string | null {
  const all = Array.from(svgElement.getElementsByTagName('*'));
  const images = all.filter((el) => el.localName === 'image');
  if (images.length !== 1 || all.some((el) => SVG_GRAPHICS.has(el.localName))) return null;
  const href =
    images[0]!.getAttributeNS(XLINK_NS, 'href') ??
    images[0]!.getAttribute('xlink:href') ??
    images[0]!.getAttribute('href') ??
    '';
  return href.trim() || null;
}

/** Parses standalone SVG XML and returns the single framed `<image>` href if pure framing. */
export function singleFramedImageHrefFromXml(svgXml: string): string | null {
  const doc = new DOMParser().parseFromString(svgXml, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) return null;
  return singleFramedImageHref(doc.documentElement);
}
