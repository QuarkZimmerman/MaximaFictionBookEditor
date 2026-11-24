/**
 * Feature 019 (T029): dedicated Web Worker for pure-JS MOBI 7 / KF8 HTML + CSS + MFBE envelope
 * generation, off-thread document fetch/parsing, and parallel slot uploads.
 */

import type { Document } from '@/model/document';
import type { MobiFormat, MobiOpenAt, MobiSeriesInTitle, MobiTocPlacement } from '@/rpc/types';
import { buildKf8 } from '@/features/mobi/export/kf8';
import {
  buildExportPlan,
  buildMfbeRoundTripRecord,
  type MobiExportSummaryItem,
  type PlacedMobiPicture,
} from '@/features/mobi/export/metadata';
import { buildMobi7 } from '@/features/mobi/export/mobi7';

export interface MobiExportWorkerRequest {
  document?: Document;
  documentUrl?: string;
  needsPicturePlacement?: boolean;
  pictures?: [string, PlacedMobiPicture][];
  fallbackTitle: string;
  format: MobiFormat;
  tocPlacement: MobiTocPlacement;
  seriesInTitle: MobiSeriesInTitle;
  openAt: MobiOpenAt;
  kf8PopupFootnotes: boolean;
  genreNames?: [string, string][];
  /** Single bundled upload URL (`PUT /mobi-write/:token/bundle`). */
  uploadBundleUrl?: string;
}

export interface MobiExportWorkerResult {
  metadata: ReturnType<typeof buildExportPlan>['metadata'];
  summary: MobiExportSummaryItem[];
  mobi7Html?: string;
  kf8Html?: string;
  kf8Css?: string;
  mfbeJson?: string;
  nav: { label: string; anchorId: string; depth: number }[];
  guide: {
    type: 'cover' | 'title-page' | 'toc' | 'text' | 'colophon';
    title: string;
    anchorId: string;
  }[];
}

interface WorkerResponseMessage {
  type: 'response';
  id: number;
  ok: boolean;
  data?: unknown;
  message?: string;
}

const encoder = new TextEncoder();
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

function collectUsedMobiPictures(document: Document): { id: string; isCover: boolean }[] {
  const result: { id: string; isCover: boolean }[] = [];
  const seen = new Set<string>();
  const known = new Set(document.binaries.map((b) => b.id));

  const add = (href: string | undefined, isCover: boolean): void => {
    if (!href?.startsWith('#')) return;
    const id = href.slice(1);
    if (!known.has(id) || seen.has(id)) return;
    seen.add(id);
    result.push({ id, isCover });
  };

  add(document.description.titleInfo.coverpage[0]?.href, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (node.type === 'image' || node.type === 'inline-image') add(node.attrs?.href, false);
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  if (document.description.titleInfo.annotation) visit(document.description.titleInfo.annotation);
  if (document.description.documentInfo.history) visit(document.description.documentInfo.history);
  for (const body of document.bodies) visit(body);
  return result;
}

async function uploadBundle(url: string, slots: [string, string][]): Promise<void> {
  // Wrapping parts in a Blob routes large uploads through Chromium's shared-memory Blob IPC
  // (~1.8 ms for 1.5 MB) instead of slow inline ArrayBuffer IPC (~22-35 ms).
  const parts: BlobPart[] = [];
  for (const [name, text] of slots) {
    const nameBytes = encoder.encode(name);
    const bodyBytes = encoder.encode(text);
    const nameLen = new Uint8Array(4);
    new DataView(nameLen.buffer).setUint32(0, nameBytes.byteLength, true);
    const bodyLen = new Uint8Array(4);
    new DataView(bodyLen.buffer).setUint32(0, bodyBytes.byteLength, true);
    parts.push(nameLen, nameBytes, bodyLen, bodyBytes);
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob(parts),
  });
  if (!response.ok) {
    throw new Error(
      `bundle: HTTP ${response.status} ${await response.text().catch(() => '')}`.trim(),
    );
  }
}

async function handleJob(req: MobiExportWorkerRequest): Promise<void> {
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

  let placedEntries: [string, PlacedMobiPicture][] = req.pictures ?? [];
  if (req.needsPicturePlacement) {
    const picList = collectUsedMobiPictures(document);
    if (picList.length > 0) {
      placedEntries = await callMainThread<[string, PlacedMobiPicture][]>(picList);
    }
  }

  const pictures = new Map<string, PlacedMobiPicture>(placedEntries);
  const genreNames = req.genreNames ? new Map<string, string>(req.genreNames) : undefined;
  const opts = {
    document,
    pictures,
    fallbackTitle: req.fallbackTitle,
    tocPlacement: req.tocPlacement,
    seriesInTitle: req.seriesInTitle,
    openAt: req.openAt,
    kf8PopupFootnotes: req.kf8PopupFootnotes,
    genreNames,
  };

  self.postMessage({ type: 'progress', done: 0, total: 4 });
  const plan = buildExportPlan(opts);
  self.postMessage({ type: 'progress', done: 1, total: 4 });

  const mobi7Result =
    req.format === 'mobi7' || req.format === 'joint' ? buildMobi7(opts, plan) : null;
  self.postMessage({ type: 'progress', done: 2, total: 4 });

  const kf8Result = req.format === 'kf8' || req.format === 'joint' ? buildKf8(opts, plan) : null;
  self.postMessage({ type: 'progress', done: 3, total: 4 });

  const mfbeJson = JSON.stringify(buildMfbeRoundTripRecord(document, pictures, plan.attrs));
  const active = kf8Result ?? mobi7Result!;

  if (req.uploadBundleUrl) {
    const slots: [string, string][] = [];
    if (mobi7Result !== null) {
      slots.push(['mobi7-html', mobi7Result.html]);
    }
    if (kf8Result !== null) {
      slots.push(['kf8-html', kf8Result.html]);
      slots.push(['kf8-css', kf8Result.css]);
    }
    slots.push(['mfbe', mfbeJson]);
    await uploadBundle(req.uploadBundleUrl, slots);

    const data: MobiExportWorkerResult = {
      metadata: plan.metadata,
      summary: plan.summary,
      nav: active.nav,
      guide: active.guide,
    };
    self.postMessage({ type: 'progress', done: 4, total: 4 });
    self.postMessage({ type: 'result', data });
    return;
  }

  const data: MobiExportWorkerResult = {
    metadata: plan.metadata,
    summary: plan.summary,
    mobi7Html: mobi7Result?.html,
    kf8Html: kf8Result?.html,
    kf8Css: kf8Result?.css,
    mfbeJson,
    nav: active.nav,
    guide: active.guide,
  };
  self.postMessage({ type: 'progress', done: 4, total: 4 });
  self.postMessage({ type: 'result', data });
}

self.onmessage = (event: MessageEvent<MobiExportWorkerRequest | WorkerResponseMessage>) => {
  const data = event.data;
  if (data && typeof data === 'object' && 'type' in data && data.type === 'response') {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if (data.ok) pending.resolve(data.data);
    else pending.reject(new Error(data.message || 'Worker request failed'));
    return;
  }
  void handleJob(data as MobiExportWorkerRequest).catch((error: unknown) => {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
