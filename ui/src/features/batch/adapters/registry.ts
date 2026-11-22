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
  switch (format) {
    case 'epub':
      return (await import('./epubToFb2')).runEpubToFb2;
    case 'mobi':
      return (await import('./mobiToFb2')).runMobiToFb2;
    case 'pdf':
      return (await import('./pdfToFb2')).runPdfToFb2;
    case 'txt':
      return (await import('./txtToFb2')).runTxtToFb2;
    case 'markdown':
      return (await import('./markdownToFb2')).runMarkdownToFb2;
  }
}
