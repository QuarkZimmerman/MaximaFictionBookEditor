/**
 * Feature 012 (US3; D23, D29; contracts/rpc-api.md §1 `epub.picture`): the EPUB's pictures put into
 * the new book, as JPEG or PNG only.
 *
 * - JPEG and PNG as they are; GIF, WebP, BMP and TIFF converted by the core, inside it
 *   (`epub.picture`), so their bytes never cross to the interface;
 * - what the core does not decode: an SVG drawn here as 011 D49 draws diagrams - or, when it only
 *   frames one picture, that picture itself; AVIF (and JPEG XL where the engine reads it) decoded by
 *   the engine;
 * - each in the rule of D23: PNG when transparent or of 256 colours or fewer, else JPEG at the
 *   settings' quality; nothing past 100 megapixels;
 * - what cannot be read or drawn is listed, and the book's reference names the missing picture.
 */

import { uploadBinary } from '@/features/images/binaries';
import { epubEntryUrl } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';
import { isRpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import { GRAPHICS, type ImportSummaryItem } from './convert';
import { MAX_PICTURE_PIXELS, type Yielder } from './limits';
import { resolvePath } from './package';
import { decodePage } from './parse';

export interface PictureSource {
  token: string;
  docId: string;
  /** The package's image items: their media types by path. */
  images: ReadonlyMap<string, string>;
  /** JPEG quality, 1..100 (Settings > Other). */
  quality: number;
  yielder?: Yielder;
}

const XLINK = 'http://www.w3.org/1999/xlink';

const FORMAT_NAMES: Readonly<Record<string, string>> = {
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/avif': 'AVIF',
  'image/jxl': 'JPEG XL',
  'image/svg+xml': 'SVG',
};

export function formatName(type: string): string {
  return FORMAT_NAMES[type] ?? type;
}

/** The bytes of an entry of the opened EPUB (`GET /epub/{token}/{entry}`). */
export async function entryBytes(token: string, name: string): Promise<Uint8Array> {
  const response = await fetch(epubEntryUrl(token, name));
  if (!response.ok) {
    throw new Error(
      `${name}: ${response.status} ${response.headers.get('X-MFBE-Reason') ?? ''}`.trim(),
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** D23: PNG when a pixel is transparent or the picture has 256 colours or fewer, else JPEG. */
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

/** D23: the path of the one picture an SVG does nothing but frame, as cover pages often do. */
export function framedPicture(
  svg: string,
  svgPath: string,
  images: ReadonlyMap<string, string>,
): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const all = Array.from(doc.getElementsByTagName('*'));
  const framed = all.filter((element) => element.localName === 'image');
  if (framed.length !== 1 || all.some((element) => GRAPHICS.has(element.localName))) return null;
  const href = framed[0]!.getAttributeNS(XLINK, 'href') ?? framed[0]!.getAttribute('href') ?? '';
  const path = resolvePath(svgPath, href);
  const type = images.get(path);
  return type && type !== 'image/svg+xml' ? path : null;
}

/** An SVG drawing as a JPEG or PNG at its own size, within the diagrams' limits (011 D49). */
export async function drawSvg(svg: string): Promise<{ blob: Blob; contentType: string }> {
  const { MAX_HEIGHT, MAX_WIDTH, rasterise, sized } =
    await import('@/features/markdown/diagrams/raster');
  const drawing = sized(svg, (width, height) =>
    Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height),
  );
  const drawn = await rasterise(drawing.text, drawing.width, drawing.height, '', 'svg');
  return { blob: drawn.blob, contentType: drawn.contentType };
}

type Decoded = { blob: Blob; contentType: string } | 'tooLarge' | null;

/** A picture the engine decodes and the core does not (AVIF), as JPEG or PNG by D23's rule. */
async function engineDecode(bytes: Uint8Array, type: string, quality: number): Promise<Decoded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  } catch {
    return null;
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PICTURE_PIXELS) return 'tooLarge';
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const contentType = pictureFormat(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, contentType, contentType === 'image/jpeg' ? quality / 100 : undefined),
    );
    return blob ? { blob, contentType } : null;
  } finally {
    bitmap.close();
  }
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

async function addOne(
  rpc: RpcClient,
  source: PictureSource,
  path: string,
  id: string,
  summary: ImportSummaryItem[],
  seen: Set<string>,
): Promise<BinaryMeta | null> {
  const type = source.images.get(path) ?? '';
  const name = nameOf(path);
  if (type === 'image/svg+xml') {
    let svg: string;
    try {
      svg = decodePage(await entryBytes(source.token, path));
    } catch {
      summary.push({ kind: 'pictureLeftOut', detail: name });
      return null;
    }
    seen.add(path);
    const framed = framedPicture(svg, path, source.images);
    if (framed && !seen.has(framed)) return addOne(rpc, source, framed, id, summary, seen);
    try {
      const drawn = await drawSvg(svg);
      summary.push({ kind: 'pictureConverted', detail: `${name} (SVG)` });
      return await uploadBinary(source.docId, drawn.blob, {
        contentType: drawn.contentType,
        suggestedId: id,
      });
    } catch {
      summary.push({ kind: 'pictureLeftOut', detail: name });
      return null;
    }
  }
  try {
    const result = await rpc.call('epub.picture', {
      token: source.token,
      entry: path,
      docId: source.docId,
      suggestedId: id,
    });
    if (result.converted) {
      summary.push({ kind: 'pictureConverted', detail: `${name} (${formatName(result.from)})` });
    }
    return result.binary;
  } catch (error) {
    const reason = isRpcError(error)
      ? (error.data as { reason?: string } | undefined)?.reason
      : undefined;
    if (isRpcError(error) && reason === 'epub.pictureTooLarge') {
      summary.push({ kind: 'pictureTooLarge', detail: name });
      return null;
    }
    if (!isRpcError(error) || error.code !== RpcErrorCode.binaryNotImage) {
      summary.push({ kind: 'pictureLeftOut', detail: name });
      return null;
    }
  }
  // Not a picture the core decodes: the engine, where it can (D23).
  const bytes = await entryBytes(source.token, path).catch(() => null);
  const decoded = bytes ? await engineDecode(bytes, type, source.quality) : null;
  if (decoded === 'tooLarge') {
    summary.push({ kind: 'pictureTooLarge', detail: name });
    return null;
  }
  if (!decoded) {
    summary.push({ kind: 'pictureLeftOut', detail: name });
    return null;
  }
  summary.push({ kind: 'pictureConverted', detail: `${name} (${formatName(type)})` });
  try {
    return await uploadBinary(source.docId, decoded.blob, {
      contentType: decoded.contentType,
      suggestedId: id,
    });
  } catch {
    summary.push({ kind: 'pictureLeftOut', detail: name });
    return null;
  }
}

/** Every picture the book names, put into the document `source.docId`; the failures listed. */
export async function addPictures(
  rpc: RpcClient,
  source: PictureSource,
  pictures: ReadonlyMap<string, string>,
  summary: ImportSummaryItem[],
): Promise<BinaryMeta[]> {
  const added: BinaryMeta[] = [];
  for (const [path, id] of pictures) {
    await source.yielder?.step();
    const meta = await addOne(rpc, source, path, id, summary, new Set());
    if (meta) added.push(meta);
  }
  return added;
}
