/**
 * Feature 018 (T030, contracts/mobi-import.md §3): MOBI/KF8 picture transfer, SVG unwrap/rasterise,
 * MathML rasterise, and Chromium fallback decoding (JPEG/PNG only into BinaryStore).
 */
import { uploadBinary } from '@/features/images/binaries';
import { mobiImportUrl } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';
import { isRpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import { pictureFormat, singleFramedImageHrefFromXml } from '../../ebookShared/svg';
import type { MobiImportSummaryItem } from './metadata';

const MAX_PICTURE_PIXELS = 100_000_000;

export interface MobiPictureInfo {
  index: number;
  contentType: string;
  width?: number;
  height?: number;
  size: number;
  tooLarge: boolean;
}

const FORMAT_LABELS: Readonly<Record<string, string>> = {
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/avif': 'AVIF',
  'image/jxl': 'JPEG XL',
  'image/svg+xml': 'SVG',
};

function formatLabel(ct: string): string {
  return FORMAT_LABELS[ct] ?? (ct || 'image');
}

/** Parses a `kindle:embed:NNNN` (base-32) or decimal `recindex` into a 1-based picture index. */
export function parsePictureIndexFromHref(href: string): number | null {
  const trimmed = href.trim();
  const embed = /^kindle:embed:([0-9A-Za-z]+)/i.exec(trimmed);
  if (embed) {
    const val = parseBase32(embed[1]!);
    return val !== null && val >= 1 ? val : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const val = Number.parseInt(trimmed, 10);
    return val >= 1 ? val : null;
  }
  return null;
}

export function parseBase32(raw: string): number | null {
  if (!raw || raw.length > 10) return null;
  let value = 0;
  for (const ch of raw.toUpperCase()) {
    const code = ch.charCodeAt(0);
    let digit: number;
    if (code >= 48 && code <= 57) digit = code - 48;
    else if (code >= 65 && code <= 86) digit = 10 + (code - 65);
    else return null;
    value = value * 32 + digit;
  }
  return value;
}

export async function fetchImportText(token: string, slot: 'html' | `css/${number}`): Promise<string> {
  const response = await fetch(mobiImportUrl(token, slot));
  if (!response.ok) {
    throw new Error(`${slot}: HTTP ${response.status}`);
  }
  return response.text();
}

export async function fetchImportPictureBytes(token: string, index: number): Promise<Uint8Array> {
  const response = await fetch(mobiImportUrl(token, `picture/${index}`));
  if (!response.ok) {
    throw new Error(`picture/${index}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Rasterises an SVG drawing to PNG/JPEG within diagram bounds via the lazy raster helper. */
export async function drawSvgMarkup(svg: string): Promise<{ blob: Blob; contentType: string }> {
  const { MAX_HEIGHT, MAX_WIDTH, rasterise, sized } =
    await import('@/features/markdown/diagrams/raster');
  const drawing = sized(svg, (width, height) =>
    Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height),
  );
  const drawn = await rasterise(drawing.text, drawing.width, drawing.height, '', 'svg');
  return { blob: drawn.blob, contentType: drawn.contentType };
}

/** Rasterises a `<math>` MathML element via the lazy MathJax formula helper. */
export async function drawMathMlMarkup(
  markup: string,
  display: boolean,
): Promise<{ blob: Blob; contentType: string }> {
  const { drawMathML } = await import('@/features/markdown/diagrams/formula');
  const drawn = await drawMathML(markup, display);
  return { blob: drawn.blob, contentType: drawn.contentType };
}

async function engineDecodeImage(
  bytes: Uint8Array,
  contentType: string,
  quality: number,
): Promise<{ blob: Blob; contentType: string } | 'tooLarge' | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: contentType }));
  } catch {
    return null;
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PICTURE_PIXELS) return 'tooLarge';
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const outType = pictureFormat(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? quality / 100 : undefined),
    );
    return blob ? { blob, contentType: outType } : null;
  } finally {
    bitmap.close();
  }
}

export interface TransferPicturesOptions {
  rpc: RpcClient;
  token: string;
  docId: string;
  pictureIndex: ReadonlyMap<number, MobiPictureInfo>;
  /** 1-based picture index -> suggested FB2 binary ID. */
  needed: ReadonlyMap<number, string>;
  quality: number;
  summary: MobiImportSummaryItem[];
  onStep?: () => Promise<void> | void;
}

/**
 * Transfers all referenced MOBI/KF8 pictures into `docId`'s BinaryStore as JPEG/PNG only.
 * Returns map: requested suggestedId -> actual stored BinaryMeta.id.
 */
export async function transferMobiPictures(
  options: TransferPicturesOptions,
): Promise<{ added: BinaryMeta[]; idRemap: Map<string, string> }> {
  const { rpc, token, docId, pictureIndex, needed, quality, summary, onStep } = options;
  const added: BinaryMeta[] = [];
  const idRemap = new Map<string, string>();

  const transferOne = async (
    picIdx: number,
    suggestedId: string,
    seen: Set<number>,
  ): Promise<BinaryMeta | null> => {
    const info = pictureIndex.get(picIdx);
    const label = suggestedId || `picture-${picIdx}`;
    if (!info) {
      summary.push({ kind: 'pictureLeftOut', detail: label });
      return null;
    }
    if (info.tooLarge) {
      summary.push({ kind: 'pictureTooLarge', detail: label });
      return null;
    }
    if (info.contentType === 'image/svg+xml') {
      seen.add(picIdx);
      let svgText: string;
      try {
        svgText = new TextDecoder('utf-8').decode(await fetchImportPictureBytes(token, picIdx));
      } catch {
        summary.push({ kind: 'pictureLeftOut', detail: label });
        return null;
      }
      const framed = singleFramedImageHrefFromXml(svgText);
      if (framed) {
        const framedIdx = parsePictureIndexFromHref(framed);
        if (framedIdx !== null && !seen.has(framedIdx) && pictureIndex.has(framedIdx)) {
          return transferOne(framedIdx, suggestedId, seen);
        }
      }
      try {
        const drawn = await drawSvgMarkup(svgText);
        summary.push({ kind: 'pictureConverted', detail: `${label} (SVG)` });
        return await uploadBinary(docId, drawn.blob, {
          contentType: drawn.contentType,
          suggestedId,
        });
      } catch {
        summary.push({ kind: 'pictureLeftOut', detail: label });
        return null;
      }
    }

    try {
      const res = await rpc.call('mobiImport.picture', {
        token,
        index: picIdx,
        docId,
        suggestedId,
      });
      if (res.converted) {
        summary.push({
          kind: 'pictureConverted',
          detail: `${label} (${formatLabel(res.from)})`,
        });
      }
      return res.binary;
    } catch (error) {
      if (isRpcError(error) && error.code === RpcErrorCode.mobiRefused) {
        const reason = (error.data as { reason?: string } | undefined)?.reason;
        if (reason === 'pictureTooLarge') {
          summary.push({ kind: 'pictureTooLarge', detail: label });
          return null;
        }
      }
      if (!isRpcError(error) || error.code !== RpcErrorCode.binaryNotImage) {
        summary.push({ kind: 'pictureLeftOut', detail: label });
        return null;
      }
    }

    // Core could not decode (e.g. AVIF / exotic raster): try Chromium fallback decode.
    const raw = await fetchImportPictureBytes(token, picIdx).catch(() => null);
    const decoded = raw ? await engineDecodeImage(raw, info.contentType, quality) : null;
    if (decoded === 'tooLarge') {
      summary.push({ kind: 'pictureTooLarge', detail: label });
      return null;
    }
    if (!decoded) {
      summary.push({ kind: 'pictureLeftOut', detail: label });
      return null;
    }
    summary.push({
      kind: 'pictureConverted',
      detail: `${label} (${formatLabel(info.contentType)})`,
    });
    try {
      return await uploadBinary(docId, decoded.blob, {
        contentType: decoded.contentType,
        suggestedId,
      });
    } catch {
      summary.push({ kind: 'pictureLeftOut', detail: label });
      return null;
    }
  };

  for (const [picIdx, suggestedId] of needed) {
    if (onStep) await onStep();
    const meta = await transferOne(picIdx, suggestedId, new Set());
    if (meta) {
      added.push(meta);
      if (meta.id !== suggestedId) {
        idRemap.set(suggestedId, meta.id);
      }
    }
  }

  return { added, idRemap };
}
