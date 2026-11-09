/**
 * Feature 011 (D49, DP-24): draws a Mermaid diagram as the picture file the book gets. Loaded by the
 * Markdown import only when the file holds a diagram, so Mermaid is a lazy chunk; nothing is fetched.
 *
 * The drawing is rasterised on white (FB2 readers show JPEG and PNG, not SVG), at most twice its own
 * size and within MAX_WIDTH x MAX_HEIGHT, and kept as the smallest of Chromium's PNG, a JPEG and - at
 * 256 colours or fewer - an indexed PNG. The source goes into the file (files.ts).
 */
import mermaid from 'mermaid';

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

let initialised = false;

function initialise(): void {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    // Text and links are sanitised, clicks and scripts of a diagram do nothing.
    securityLevel: 'strict',
    theme: 'default',
    // Mermaid's own layout: its optional ELK layout is not shipped (EPL-2.0, D49).
    layout: 'dagre',
    // SVG text instead of HTML labels: a foreignObject would make the canvas unreadable.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    deterministicIds: true,
    fontFamily: 'sans-serif',
  });
  initialised = true;
}

/** The drawing with its own size in pixels (from its viewBox) and with explicit width and height. */
function sized(svg: string, scale: (width: number, height: number) => number) {
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

/** Draws `source`; rejects with Mermaid's reason when it cannot be drawn. */
export async function drawDiagram(source: string, index: number): Promise<DrawnDiagram> {
  initialise();
  const { svg } = await mermaid.render(`mfbe-diagram-${index}`, source);
  const drawing = sized(svg, (width, height) =>
    Math.min(2, MAX_WIDTH / width, MAX_HEIGHT / height),
  );
  const image = await loadImage(drawing.text);
  const canvas = document.createElement('canvas');
  canvas.width = drawing.width;
  canvas.height = drawing.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, drawing.width, drawing.height);
  context.drawImage(image, 0, 0, drawing.width, drawing.height);
  const pixels = context.getImageData(0, 0, drawing.width, drawing.height).data;
  const candidates: { bytes: Uint8Array; type: DrawnDiagram['contentType'] }[] = [
    { bytes: pngWithSource(await encoded(canvas, 'image/png'), source), type: 'image/png' },
    {
      bytes: jpegWithSource(await encoded(canvas, 'image/jpeg', JPEG_QUALITY), source),
      type: 'image/jpeg',
    },
  ];
  const palette = await indexedPng(pixels, drawing.width, drawing.height);
  if (palette) candidates.push({ bytes: pngWithSource(palette, source), type: 'image/png' });
  const best = candidates.reduce((a, b) => (b.bytes.length < a.bytes.length ? b : a));
  return {
    blob: new Blob([best.bytes as BlobPart], { type: best.type }),
    contentType: best.type,
    width: drawing.width,
    height: drawing.height,
  };
}
