/**
 * Feature 023 (T040): dedicated parallel Web Worker for off-thread FB2 fetch, OOXML DOCX package
 * & Custom XML round-trip generation, and single bundled `PUT /docx-write/:token/parts` upload.
 */
import {
  buildDocxPackage,
  collectDocxPictures,
  type DocxExportCounts,
  type StagedDocxPicture,
} from '@/features/docx/export/docxDocumentBuilder';
import type { DocxSettings } from '@/features/docx/docxSettingsSchema';
import type { DocxSummaryItem } from '@/features/docx/shared/docxRoundtripTypes';
import type { Document } from '@/model/document';

export interface DocxExportWorkerRequest {
  document?: Document;
  documentUrl?: string;
  needsPicturePlacement?: boolean;
  pictures?: [string, StagedDocxPicture][];
  settings: DocxSettings;
  fallbackTitle: string;
  appVersion: string;
  genreNames?: [string, string][];
  uploadPartsUrl: string;
}

export interface DocxExportWorkerResult {
  counts: DocxExportCounts;
  summary: DocxSummaryItem[];
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

async function handleJob(req: DocxExportWorkerRequest): Promise<void> {
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

  let placedEntries: [string, StagedDocxPicture][] = req.pictures ?? [];
  if (req.needsPicturePlacement) {
    const picList = collectDocxPictures(document);
    if (picList.length > 0) {
      placedEntries = await callMainThread<[string, StagedDocxPicture][]>(picList);
    }
  }

  self.postMessage({ type: 'progress', done: 1, total: 4 });
  const pictures = new Map<string, StagedDocxPicture>(placedEntries);
  const genreNames = req.genreNames ? new Map<string, string>(req.genreNames) : undefined;

  const built = await buildDocxPackage({
    document,
    pictures,
    settings: req.settings,
    fallbackTitle: req.fallbackTitle,
    appVersion: req.appVersion,
    genreNames,
  });
  self.postMessage({ type: 'progress', done: 3, total: 4 });

  const uploadResp = await fetch(req.uploadPartsUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: new Blob([JSON.stringify(built.parts)], { type: 'application/json' }),
  });
  if (!uploadResp.ok) {
    throw new Error(
      `parts upload failed: HTTP ${uploadResp.status} ${await uploadResp.text().catch(() => '')}`.trim(),
    );
  }

  const data: DocxExportWorkerResult = {
    counts: built.counts,
    summary: built.summary,
  };
  self.postMessage({ type: 'progress', done: 4, total: 4 });
  self.postMessage({ type: 'result', data });
}

self.onmessage = (event: MessageEvent<DocxExportWorkerRequest | WorkerResponseMessage>) => {
  const data = event.data;
  if (data && typeof data === 'object' && 'type' in data && data.type === 'response') {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if (data.ok) pending.resolve(data.data);
    else pending.reject(new Error(data.message || 'Worker request failed'));
    return;
  }
  void handleJob(data as DocxExportWorkerRequest).catch((error: unknown) => {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
