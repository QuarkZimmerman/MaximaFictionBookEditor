/**
 * Binary object helpers shared by the image flows and the Description forms (T093/T094):
 *
 *  - `uploadBinary()`: `POST /binary/{docId}` with the raw bytes (`Content-Type` = source type,
 *    optional `X-MFBE-Suggested-Id`) for clipboard paste and drag-and-drop - binary payloads
 *    never travel through JSON-RPC (rpc-api.md §2);
 *  - `addBinaryFromFile()`: `dialog.openFile` with the image types (`dialogs/fileTypes.ts`) +
 *    `binary.add` (the core reads the file, sniffs the type, assigns a unique id);
 *  - model bookkeeping: `addBinaryToModel()` / `removeBinaryFromModel()` keep
 *    `document.binaries` in sync with the core's store without marking the document modified
 *    by themselves (the inserted image node / the cover reference does that), and
 *    `referenceCounts()` counts `href="#id"` references in bodies and cover pages.
 */

import type { BinaryMeta, Document } from '@/model/document';
import type { AppStore } from '@/model/store';
import { resolveToken, type RpcClient } from '@/rpc/client';
import type { FileFilter } from '@/rpc/types';

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** File name part of a path (used as the suggested binary id, like the original editor). */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1]!.toLowerCase() : '';
}

/** MIME type by file extension (null when it is not a known image extension). */
export function imageMimeType(name: string): string | null {
  return MIME_BY_EXTENSION[extensionOf(name)] ?? null;
}

/** True for `image/*` types the core can decode (anything else is kept as an opaque binary). */
export function isImageType(type: string | undefined | null): boolean {
  return !!type && type.toLowerCase().startsWith('image/');
}

/** `image/jpeg` / `image/png` are written byte-for-byte; everything else is converted on save. */
export function isClearImageType(type: string | undefined | null): boolean {
  const lower = (type ?? '').toLowerCase();
  return lower === 'image/jpeg' || lower === 'image/png';
}

/* ------------------------------------------------------------------------ */
/* HTTP upload                                                              */
/* ------------------------------------------------------------------------ */

export interface UploadOptions {
  contentType: string;
  suggestedId?: string;
  /** Test seam; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Base URL of the core (defaults to the page origin / Vite base). */
  baseUrl?: string;
}

/** Uploads raw image bytes to the core; resolves with the stored binary's metadata. */
export async function uploadBinary(
  docId: string,
  bytes: Blob | ArrayBuffer,
  options: UploadOptions,
): Promise<BinaryMeta> {
  const base = options.baseUrl ?? import.meta.env.BASE_URL ?? '/';
  const token = resolveToken();
  const url = `${base}binary/${encodeURIComponent(docId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const headers: Record<string, string> = { 'Content-Type': options.contentType };
  if (token) headers['X-MFBE-Token'] = token;
  if (options.suggestedId) headers['X-MFBE-Suggested-Id'] = encodeHeaderValue(options.suggestedId);
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, { method: 'POST', headers, body: bytes });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).trim();
    } catch {
      // no body
    }
    throw new Error(`POST /binary failed: ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  return (await response.json()) as BinaryMeta;
}

/** HTTP header values must be ISO-8859-1: non-ASCII suggested ids are percent-encoded. */
function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : encodeURIComponent(value);
}

/* ------------------------------------------------------------------------ */
/* File dialog + binary.add                                                 */
/* ------------------------------------------------------------------------ */

export interface AddFileOptions {
  title: string;
  filters: FileFilter[];
  /** Index of the type selected when the dialog opens. */
  selectedFilter: number;
  multiple?: boolean;
  convertNow?: boolean;
}

/** Lets the user pick image files and embeds them; empty when cancelled. */
export async function addBinariesFromFiles(
  rpc: RpcClient,
  docId: string,
  options: AddFileOptions,
): Promise<BinaryMeta[]> {
  const { paths } = await rpc.call('dialog.openFile', {
    title: options.title,
    filters: options.filters,
    selectedFilter: options.selectedFilter,
    multiple: options.multiple,
  });
  const out: BinaryMeta[] = [];
  for (const path of paths) {
    out.push(
      await rpc.call('binary.add', {
        docId,
        path,
        suggestedId: fileName(path),
        convertNow: options.convertNow,
      }),
    );
  }
  return out;
}

export async function addBinaryFromFile(
  rpc: RpcClient,
  docId: string,
  options: AddFileOptions,
): Promise<BinaryMeta | null> {
  const added = await addBinariesFromFiles(rpc, docId, { ...options, multiple: false });
  return added[0] ?? null;
}

/* ------------------------------------------------------------------------ */
/* Model bookkeeping                                                        */
/* ------------------------------------------------------------------------ */

/** Adds (or replaces) a binary's metadata in the document model without marking it modified. */
export function addBinaryToModel(store: AppStore, meta: BinaryMeta): void {
  const document = store.getState().document;
  if (!document) return;
  const binaries = document.binaries.filter((b) => b.id !== meta.id).concat(meta);
  store.setState({ document: { ...document, binaries } });
}

export function removeBinaryFromModel(store: AppStore, id: string): void {
  const document = store.getState().document;
  if (!document) return;
  const binaries = document.binaries.filter((b) => b.id !== id);
  if (binaries.length === document.binaries.length) return;
  store.setState({ document: { ...document, binaries }, modified: true });
}

/** Replaces the whole metadata list (after `binary.list`) without marking the document modified. */
export function replaceBinariesInModel(store: AppStore, list: BinaryMeta[]): void {
  const document = store.getState().document;
  if (!document) return;
  const same =
    document.binaries.length === list.length &&
    document.binaries.every((b, i) => JSON.stringify(b) === JSON.stringify(list[i]));
  if (same) return;
  store.setState({ document: { ...document, binaries: list } });
}

/** `href="#id"` references per binary id (body images, inline images, cover pages). */
export function referenceCounts(
  document: Pick<Document, 'bodies' | 'description'>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const count = (href: unknown) => {
    if (typeof href !== 'string' || !href.startsWith('#') || href.length < 2) return;
    const id = href.slice(1);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  const visit = (node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.type === 'image' || node.type === 'inline-image') count(node.attrs?.href);
    for (const child of node.content ?? []) {
      if (typeof child === 'object' && child !== null) {
        visit(child as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] });
      }
    }
  };
  for (const body of document.bodies) visit(body as unknown as { type?: string });
  const covers = [
    ...document.description.titleInfo.coverpage,
    ...(document.description.srcTitleInfo?.coverpage ?? []),
  ];
  for (const ref of covers) count(ref.href);
  return counts;
}

/** Hrefs of images that refer to a binary id missing from the document. */
export function danglingImageRefs(
  document: Pick<Document, 'bodies' | 'description' | 'binaries'>,
): string[] {
  const ids = new Set(document.binaries.map((b) => b.id));
  return [...referenceCounts(document).keys()].filter((id) => !ids.has(id)).map((id) => `#${id}`);
}
