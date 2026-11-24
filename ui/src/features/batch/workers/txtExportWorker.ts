/**
 * Feature 019 (T029): dedicated Web Worker for pure-JS TXT book layout.
 */

import type { Document } from '@/model/document';
import { layoutTxt, type TxtLayout } from '@/features/txt/export/layout';
import type { RecordLists } from '@/features/txt/export/record';

export interface TxtExportWorkerRequest {
  document: Document;
  lists: RecordLists;
  fileStem: string;
  version: string;
}

self.onmessage = (event: MessageEvent<TxtExportWorkerRequest>) => {
  try {
    const req = event.data;
    self.postMessage({ type: 'progress', done: 0, total: 1 });
    const layout: TxtLayout = layoutTxt(req.document, req.lists, req.fileStem, req.version);
    self.postMessage({ type: 'progress', done: 1, total: 1 });
    self.postMessage({ type: 'result', data: layout });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
