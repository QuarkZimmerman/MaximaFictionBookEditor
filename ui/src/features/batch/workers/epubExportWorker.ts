/**
 * Feature 019 (T029): dedicated Web Worker for pure-JS EPUB package build, verification,
 * off-thread document fetch/parsing, and parallel EPUB file uploads.
 */

import type { Document } from '@/model/document';
import { buildEpub, verifyEpub, type BuiltEpub } from '@/features/epub/export/build';
import type { PlacedPicture, SummaryItem } from '@/features/epub/export/render';

export interface EpubUploadTarget {
  /** Absolute URL prefix ending with `/epub-write/<token>/`. */
  prefix: string;
  /** Optional query suffix starting with `?token=...` (or empty string). */
  query: string;
}

export interface EpubExportWorkerRequest {
  document?: Document;
  documentUrl?: string;
  needsPicturePlacement?: boolean;
  pictures?: [string, PlacedPicture][];
  fallbackTitle: string;
  genreNames?: [string, string][];
  uploadTarget?: EpubUploadTarget;
}

export interface EpubExportWorkerResult {
  built?: BuiltEpub;
  summary: SummaryItem[];
  faults: string[];
}

interface WorkerResponseMessage {
  type: 'response';
  id: number;
  ok: boolean;
  data?: unknown;
  message?: string;
}

let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (data: unknown) => void; reject: (err: Error) => void }
>();

function callMainThread<T>(payload: unknown): Promise<T> {
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: (data) => resolve(data as T),
      reject,
    });
    self.postMessage({ type: 'request', id, payload });
  });
}

function collectUsedEpubPictures(document: Document): string[] {
  const used: string[] = [];
  const known = new Set(document.binaries.map((binary) => binary.id));
  const add = (href: string | undefined): void => {
    if (!href?.startsWith('#')) return;
    const id = href.slice(1);
    if (known.has(id) && !used.includes(id)) used.push(id);
  };
  add(document.description.titleInfo.coverpage[0]?.href);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (node.type === 'image' || node.type === 'inline-image') add(node.attrs?.href);
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  if (document.description.titleInfo.annotation) visit(document.description.titleInfo.annotation);
  if (document.description.documentInfo.history) visit(document.description.documentInfo.history);
  for (const body of document.bodies) visit(body);
  return used;
}

function entryPath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

async function uploadEpubFile(target: EpubUploadTarget, name: string, text: string): Promise<void> {
  const url = `${target.prefix}${entryPath(name)}${target.query}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    // Blob avoids Chromium's slow inline ArrayBuffer IPC path on large HTML/XHTML uploads.
    body: new Blob([text]),
  });
  if (!response.ok) {
    throw new Error(
      `${name}: ${response.status} ${response.headers.get('X-MFBE-Reason') ?? ''}`.trim(),
    );
  }
}

async function handleJob(req: EpubExportWorkerRequest): Promise<void> {
  let document: Document;
  if (req.document) {
    document = req.document;
  } else if (req.documentUrl) {
    const response = await fetch(req.documentUrl);
    if (!response.ok) {
      throw new Error(`document fetch failed: HTTP ${response.status}`);
    }
    document = (await response.json()) as Document;
  } else {
    throw new Error('Missing document payload');
  }

  let placedEntries: [string, PlacedPicture][] = req.pictures ?? [];
  if (req.needsPicturePlacement) {
    const picIds = collectUsedEpubPictures(document);
    if (picIds.length > 0) {
      placedEntries = await callMainThread<[string, PlacedPicture][]>(picIds);
    }
  }

  const pictures = new Map<string, PlacedPicture>(placedEntries);
  const genreNames = req.genreNames ? new Map<string, string>(req.genreNames) : undefined;
  self.postMessage({ type: 'progress', done: 0, total: 3 });
  const built = buildEpub({
    document,
    pictures,
    modified: new Date(),
    fallbackTitle: req.fallbackTitle,
    genreNames,
  });
  self.postMessage({ type: 'progress', done: 1, total: 3 });
  const faults = verifyEpub(
    built.files,
    [...pictures.values()].map((p) => p.name),
  );
  self.postMessage({ type: 'progress', done: 2, total: 3 });

  if (req.uploadTarget) {
    if (faults.length === 0) {
      await Promise.all(
        built.files.map((file) => uploadEpubFile(req.uploadTarget!, file.name, file.text)),
      );
    }
    self.postMessage({ type: 'progress', done: 3, total: 3 });
    self.postMessage({
      type: 'result',
      data: { summary: built.summary, faults } satisfies EpubExportWorkerResult,
    });
    return;
  }

  self.postMessage({ type: 'progress', done: 3, total: 3 });
  self.postMessage({
    type: 'result',
    data: { built, summary: built.summary, faults } satisfies EpubExportWorkerResult,
  });
}

self.onmessage = (event: MessageEvent<EpubExportWorkerRequest | WorkerResponseMessage>) => {
  const data = event.data;
  if (data && typeof data === 'object' && 'type' in data && data.type === 'response') {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if (data.ok) pending.resolve(data.data);
    else pending.reject(new Error(data.message || 'Worker request failed'));
    return;
  }
  void handleJob(data as EpubExportWorkerRequest).catch((error: unknown) => {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
