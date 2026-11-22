/**
 * Feature 019 (T029): dedicated Web Worker for pure-JS EPUB package build + verification.
 */

import type { Document } from '@/model/document';
import { buildEpub, verifyEpub, type BuiltEpub } from '@/features/epub/export/build';
import type { PlacedPicture } from '@/features/epub/export/render';

export interface EpubExportWorkerRequest {
  document: Document;
  pictures: [string, PlacedPicture][];
  fallbackTitle: string;
  genreNames?: [string, string][];
}

export interface EpubExportWorkerResult {
  built: BuiltEpub;
  faults: string[];
}

self.onmessage = (event: MessageEvent<EpubExportWorkerRequest>) => {
  try {
    const req = event.data;
    const pictures = new Map<string, PlacedPicture>(req.pictures);
    const genreNames = req.genreNames ? new Map<string, string>(req.genreNames) : undefined;
    self.postMessage({ type: 'progress', done: 0, total: 2 });
    const built = buildEpub({
      document: req.document,
      pictures,
      modified: new Date(),
      fallbackTitle: req.fallbackTitle,
      genreNames,
    });
    self.postMessage({ type: 'progress', done: 1, total: 2 });
    const faults = verifyEpub(
      built.files,
      [...pictures.values()].map((p) => p.name),
    );
    self.postMessage({ type: 'progress', done: 2, total: 2 });
    self.postMessage({ type: 'result', data: { built, faults } satisfies EpubExportWorkerResult });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
