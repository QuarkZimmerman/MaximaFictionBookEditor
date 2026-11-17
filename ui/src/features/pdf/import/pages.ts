/**
 * Feature 016 (contracts/page-model.md; tasks T029): the page model the reader wrote, fetched over the core's
 * route - the document first, then the pages in batches, with progress.
 */

import { pdfImportUrl } from '@/model/binaryUrls';

import type { PdfDocumentModel, PdfPageModel } from './model';

async function json<T>(token: string, part: string): Promise<T> {
  const response = await fetch(pdfImportUrl(token, part));
  if (!response.ok) throw new Error(`${part}: ${response.status}`);
  return (await response.json()) as T;
}

export function loadDocument(token: string): Promise<PdfDocumentModel> {
  return json<PdfDocumentModel>(token, 'document');
}

/** Every page, `batch` at a time; `progress(done, total)` after each batch; stops when `cancelled()`. */
export async function loadPages(
  token: string,
  count: number,
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
  batch = 16,
): Promise<PdfPageModel[]> {
  const pages: PdfPageModel[] = [];
  for (let first = 1; first <= count; first += batch) {
    if (cancelled()) throw new Error('cancelled');
    const last = Math.min(count, first + batch - 1);
    const numbers = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    pages.push(...(await Promise.all(numbers.map((n) => json<PdfPageModel>(token, `page/${n}`)))));
    progress(last, count);
  }
  return pages;
}
