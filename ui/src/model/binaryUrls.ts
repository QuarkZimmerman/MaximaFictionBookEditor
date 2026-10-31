/**
 * The one builder of the addresses of a book's binaries (feature 007, data-model §3, DP-3): the
 * preview the core scales (`GET /binary/:docId/:id/preview?w=&h=`), the original bytes
 * (`GET /binary/:docId/:id`) and the upload (`POST /binary/:docId`), each with the session
 * token, and the size such a preview has. Every caller - the image node view, Binary objects,
 * the cover picker, the import of a description, the picture view and the image upload -
 * imports these; none writes the routes itself.
 */

import type { BinaryMeta } from '@/model/document';
import { resolveToken } from '@/rpc/client';

/** The width of the pictures the Body view shows (contracts/rpc-api.md §2 of feature 006). */
export const PREVIEW_WIDTH = 800;

/** The formats the browser engine shows from the original bytes; the core previews the rest. */
const ENGINE_FORMATS = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);

/**
 * The size `preview?w=&h=` serves, as the core's `scale_to_fit` computes it
 * (`core/src/images/converter.cpp`): the factor is the smaller of 1, `maxWidth / width` and
 * `maxHeight / height`; each side is rounded half away from zero and at least 1 px - it never
 * upscales. Null for a binary the core does not decode and for one without both dimensions.
 */
export function previewSize(
  meta: BinaryMeta,
  maxWidth = PREVIEW_WIDTH,
  maxHeight?: number,
): [number, number] | null {
  if (!meta.decodable || !meta.width || !meta.height) return null;
  let factor = 1;
  if (maxWidth > 0) factor = Math.min(factor, maxWidth / meta.width);
  if (maxHeight !== undefined && maxHeight > 0) factor = Math.min(factor, maxHeight / meta.height);
  if (factor >= 1) return [meta.width, meta.height];
  return [
    Math.max(1, Math.round(meta.width * factor)),
    Math.max(1, Math.round(meta.height * factor)),
  ];
}

/** The binary id of a book reference `#id`; null for an external, empty or broken one. */
function binaryId(href: string): string | null {
  if (!href.startsWith('#') || href.length < 2 || href === '#undefined') return null;
  return href.slice(1);
}

function binaryBase(docId: string | null, href: string): string | null {
  const id = docId ? binaryId(href) : null;
  if (!docId || id === null) return null;
  return `${import.meta.env.BASE_URL}binary/${encodeURIComponent(docId)}/${encodeURIComponent(id)}`;
}

function withToken(url: string, separator: '?' | '&'): string {
  const token = resolveToken();
  return token ? `${url}${separator}token=${encodeURIComponent(token)}` : url;
}

/**
 * The core's preview of the binary `href` ("#id") of the document `docId`: `width` wide at
 * most, and `height` high at most when given. Null without a document or for a reference that
 * names no binary.
 */
export function binaryPreviewUrl(
  docId: string | null,
  href: string,
  width = PREVIEW_WIDTH,
  height?: number,
): string | null {
  const base = binaryBase(docId, href);
  if (base === null) return null;
  const size = height === undefined ? `w=${width}` : `w=${width}&h=${height}`;
  return withToken(`${base}/preview?${size}`, '&');
}

/** The original bytes of the binary `href` ("#id") of the document `docId`. */
export function binaryOriginalUrl(docId: string | null, href: string): string | null {
  const base = binaryBase(docId, href);
  return base === null ? null : withToken(base, '?');
}

/** The core's upload route of the document `docId` (`POST`, the bytes as the body). */
export function binaryUploadUrl(
  docId: string,
  baseUrl: string = import.meta.env.BASE_URL ?? '/',
): string {
  return withToken(`${baseUrl}binary/${encodeURIComponent(docId)}`, '?');
}

/** Whether the engine shows a picture of this content type from its original bytes. */
export function displayableInEngine(contentType: string): boolean {
  return ENGINE_FORMATS.has(contentType.split(';')[0].trim().toLowerCase());
}
