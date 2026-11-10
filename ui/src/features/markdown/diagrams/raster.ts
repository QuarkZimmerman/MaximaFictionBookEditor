/**
 * Features 011 (D49, D50) and 012 (D23, D24): an SVG drawing rasterised as the picture file the book
 * gets - Mermaid diagrams, TeX and MathML formulas, an EPUB's SVG pictures and drawings. FB2 readers
 * show JPEG and PNG, not SVG: the drawing is put on white and kept as the smallest of Chromium's PNG,
 * a JPEG and - at 256 colours or fewer - an indexed PNG, with its source inside the file (files.ts).
 * No library of its own: loading this module loads neither Mermaid nor MathJax.
 */
import { indexedPng, jpegWithSource, pngWithSource } from './files';

export const MAX_WIDTH = 1600;
export const MAX_HEIGHT = 4000;
const JPEG_QUALITY = 0.85;

export interface DrawnDiagram {
  blob: Blob;
  contentType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

/** The drawing with its own size in pixels (from its viewBox) and with explicit width and height. */
export function sized(svg: string, scale: (width: number, height: number) => number) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const box = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const natural = {
    width:
      box.length === 4 && box[2]! > 0
        ? box[2]!
        : Number.parseFloat(root.getAttribute('width') ?? '') || 400,
    height:
      box.length === 4 && box[3]! > 0
        ? box[3]!
        : Number.parseFloat(root.getAttribute('height') ?? '') || 300,
  };
  const factor = scale(natural.width, natural.height);
  const width = Math.max(1, Math.round(natural.width * factor));
  const height = Math.max(1, Math.round(natural.height * factor));
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.removeAttribute('style');
  return { text: new XMLSerializer().serializeToString(root), width, height };
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const image = new Image();
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('the drawing could not be read'));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function encoded(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error(`no ${type} picture`));
        else void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)));
      },
      type,
      quality,
    );
  });
}

/**
 * The picture file of an SVG drawing at `width` x `height` pixels, on white: the smallest of
 * Chromium's PNG, a JPEG and - at 256 colours or fewer - an indexed PNG, `source` inside it.
 */
export async function rasterise(
  svg: string,
  width: number,
  height: number,
  source: string,
  keyword: string,
): Promise<DrawnDiagram> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.removeAttribute('style');
  const image = await loadImage(new XMLSerializer().serializeToString(root));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const candidates: { bytes: Uint8Array; type: DrawnDiagram['contentType'] }[] = [
    {
      bytes: pngWithSource(await encoded(canvas, 'image/png'), source, keyword),
      type: 'image/png',
    },
    {
      bytes: jpegWithSource(await encoded(canvas, 'image/jpeg', JPEG_QUALITY), source, keyword),
      type: 'image/jpeg',
    },
  ];
  const palette = await indexedPng(pixels, width, height);
  if (palette)
    candidates.push({ bytes: pngWithSource(palette, source, keyword), type: 'image/png' });
  const best = candidates.reduce((a, b) => (b.bytes.length < a.bytes.length ? b : a));
  return {
    blob: new Blob([best.bytes as BlobPart], { type: best.type }),
    contentType: best.type,
    width,
    height,
  };
}
