/**
 * The one builder of the addresses of a book's binaries (feature 007, data-model §3, DP-3): the
 * preview the core scales (`GET /binary/:docId/:id/preview?w=&h=`), the original bytes
 * (`GET /binary/:docId/:id`) and the upload (`POST /binary/:docId`), each with the session
 * token, and the size such a preview has. Every caller - the image node view, Binary objects,
 * the cover picker, the import of a description, the picture view and the image upload -
 * imports these; none writes the routes itself.
 *
 * The addresses follow the binaries: a binary that appears, goes or changes under its id gets a
 * new revision (`r=`, which the core ignores), so the engine fetches its picture again instead
 * of showing what its image cache holds for the old address - the binary of a dangling reference
 * added, a binary removed and added again, a binary converted. The store records every new
 * binary list of the open document (`observeBinaries`); the Body view's pictures redraw then
 * (feature 007: the editor shows such changes itself, so 2.7.9's script that redrew the
 * pictures - group 05, place 03 - has no place in it).
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

/* ------------------------------------------------------------------------ */
/* Revisions                                                                */
/* ------------------------------------------------------------------------ */

interface Seen {
  /** The binaries of the last list, each as its signature. */
  signatures: Map<string, string>;
  /** The ids whose binary appeared, went or changed since the document's first list. */
  revisions: Map<string, number>;
}

const seen = new Map<string, Seen>();

/** What tells two binaries of one id apart without their bytes. */
function signature(meta: BinaryMeta): string {
  return [meta.contentType, meta.size, meta.width ?? '', meta.height ?? '', meta.decodable].join(
    '|',
  );
}

/**
 * Records the binary list of the document `docId`: an id whose binary appeared, went or changed
 * since the previous list gets a new revision. The first list of a document starts every id at
 * revision 0, whose addresses carry none.
 */
export function observeBinaries(docId: string, list: readonly BinaryMeta[]): void {
  const signatures = new Map(list.map((meta) => [meta.id, signature(meta)]));
  const entry = seen.get(docId);
  if (!entry) {
    seen.set(docId, { signatures, revisions: new Map() });
    return;
  }
  for (const id of new Set([...entry.signatures.keys(), ...signatures.keys()])) {
    if (entry.signatures.get(id) !== signatures.get(id)) {
      entry.revisions.set(id, (entry.revisions.get(id) ?? 0) + 1);
    }
  }
  entry.signatures = signatures;
}

/** Forgets the binaries of every document but `keep` (null: of all of them). */
export function forgetBinaries(keep: string | null): void {
  for (const docId of [...seen.keys()]) if (docId !== keep) seen.delete(docId);
}

/** `r=<revision>&` for a binary that changed since the document's first list, else nothing. */
function revisionParam(docId: string | null, href: string): string {
  const id = binaryId(href);
  const revision = docId && id !== null ? (seen.get(docId)?.revisions.get(id) ?? 0) : 0;
  return revision > 0 ? `r=${revision}` : '';
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
  const revision = revisionParam(docId, href);
  return withToken(`${base}/preview?${size}${revision ? `&${revision}` : ''}`, '&');
}

/** The original bytes of the binary `href` ("#id") of the document `docId`. */
export function binaryOriginalUrl(docId: string | null, href: string): string | null {
  const base = binaryBase(docId, href);
  if (base === null) return null;
  const revision = revisionParam(docId, href);
  return revision ? withToken(`${base}?${revision}`, '&') : withToken(base, '?');
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

/** Feature 012: a path inside an EPUB, each segment percent-encoded and the "/" kept. */
function entryPath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

/**
 * Feature 012 (contracts/rpc-api.md §2): the bytes of the entry `name` of the EPUB the import opened
 * under `token` (`GET /epub/{token}/{entry}`).
 */
export function epubEntryUrl(
  token: string,
  name: string,
  baseUrl: string = import.meta.env.BASE_URL ?? '/',
): string {
  return withToken(`${baseUrl}epub/${encodeURIComponent(token)}/${entryPath(name)}`, '?');
}

/**
 * Feature 012 (contracts/rpc-api.md §3): the file `name` of the EPUB the export writes under `token`
 * (`PUT /epub-write/{token}/{name}`, the bytes as the body).
 */
export function epubWriteUrl(
  token: string,
  name: string,
  baseUrl: string = import.meta.env.BASE_URL ?? '/',
): string {
  return withToken(`${baseUrl}epub-write/${encodeURIComponent(token)}/${entryPath(name)}`, '?');
}

/**
 * Feature 014 (contracts/rpc-api.md): part `part` of the PDF export's paged document under `token`
 * (`PUT /pdf/{token}/part/{n}`, the HTML as the body).
 */
export function pdfPartUrl(
  token: string,
  part: number,
  baseUrl: string = import.meta.env.BASE_URL ?? '/',
): string {
  return withToken(`${baseUrl}pdf/${encodeURIComponent(token)}/part/${part}`, '?');
}

/**
 * Feature 014 (contracts/rpc-api.md): a font file the PDF export ships, as the paged document's
 * `@font-face` rules name it (`GET /pdf/fonts/shipped/{id}/{style}`; style Regular, Italic, Bold or
 * BoldItalic).
 */
export function pdfFontUrl(
  id: string,
  style: string,
  baseUrl: string = import.meta.env.BASE_URL ?? '/',
): string {
  return withToken(
    `${baseUrl}pdf/fonts/shipped/${encodeURIComponent(id)}/${encodeURIComponent(style)}`,
    '?',
  );
}
