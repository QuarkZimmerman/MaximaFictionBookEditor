/**
 * Feature 019 (T035, T045, FR-024): lazy per-format adapter dispatcher.
 * Uses dynamic `import()` per format so running `FB2 -> TXT` loads only the TXT adapter & chunk
 * and never loads EPUB, MOBI, PDF, or Markdown converter bundles.
 */

import type { BatchBookFormat, BatchDirection } from '../engine/types';
import type { BatchAdapterFn } from './adapterTypes';

export async function loadBatchAdapter(
  direction: BatchDirection,
  format: BatchBookFormat,
): Promise<BatchAdapterFn> {
  if (direction === 'fb2ToExport') {
    switch (format) {
      case 'epub':
        return (await import('./fb2ToEpub')).runFb2ToEpub;
      case 'mobi':
        return (await import('./fb2ToMobi')).runFb2ToMobi;
      case 'pdf':
        return (await import('./fb2ToPdf')).runFb2ToPdf;
      case 'txt':
        return (await import('./fb2ToTxt')).runFb2ToTxt;
      case 'markdown':
        return (await import('./fb2ToMarkdown')).runFb2ToMarkdown;
    }
  }
  // Import adapters wired in Phase 4 (T040–T045).
  throw new Error(`Import adapter for "${format}" is not yet installed`);
}
