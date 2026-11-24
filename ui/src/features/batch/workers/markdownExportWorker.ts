/**
 * Feature 019 (T029): dedicated Web Worker for pure-JS Markdown serialization.
 */

import type { Document } from '@/model/document';
import { serializeMarkdown, type SerializedExport } from '@/features/markdown/export/serialize';

export interface MarkdownExportWorkerRequest {
  document: Document;
  form: 'md' | 'zip';
  includePictures: boolean;
  diagramSources?: [string, string][];
}

self.onmessage = (event: MessageEvent<MarkdownExportWorkerRequest>) => {
  try {
    const req = event.data;
    self.postMessage({ type: 'progress', done: 0, total: 1 });
    const result: SerializedExport = serializeMarkdown(req.document, {
      form: req.form,
      includePictures: req.includePictures,
      diagramSources: req.diagramSources ? new Map(req.diagramSources) : undefined,
    });
    self.postMessage({ type: 'progress', done: 1, total: 1 });
    self.postMessage({ type: 'result', data: result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
