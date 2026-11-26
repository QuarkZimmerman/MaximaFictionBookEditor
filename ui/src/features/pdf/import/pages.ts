/**
 * Feature 016 (contracts/page-model.md; tasks T029): the page model the reader wrote, fetched over the core's
 * route - the document first, then the pages in batches, with progress.
 */

import { pdfImportUrl } from '@/model/binaryUrls';

import type { PdfDocumentModel, PdfPageModel } from './model';

/** Per-attempt timeout for local 127.0.0.1 JSON fetches; guards against stalled HTTP/1.1 keep-alive sockets. */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function fetchJsonOnce<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { signal, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = options;
  if (signal?.aborted) throw new Error('cancelled');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    if (signal?.aborted) throw new Error('cancelled', { cause: error });
    if (timedOut) {
      const timeoutErr = new Error('timeout', { cause: error });
      timeoutErr.name = 'FetchTimeoutError';
      throw timeoutErr;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function json<T>(token: string, part: string, options: FetchJsonOptions = {}): Promise<T> {
  const url = pdfImportUrl(token, part);
  try {
    return await fetchJsonOnce<T>(url, options);
  } catch (error) {
    // Retry once if a local HTTP/1.1 keep-alive connection stalled (seen on macOS Chromium + uWS).
    if (error instanceof Error && error.name === 'FetchTimeoutError' && !options.signal?.aborted) {
      try {
        return await fetchJsonOnce<T>(url, options);
      } catch (retryError) {
        if (options.signal?.aborted) throw new Error('cancelled', { cause: retryError });
        throw new Error(
          `${part}: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
          { cause: retryError },
        );
      }
    }
    if (options.signal?.aborted) throw new Error('cancelled', { cause: error });
    throw new Error(`${part}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

export function loadDocument(
  token: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<PdfDocumentModel> {
  return json<PdfDocumentModel>(token, 'document', { signal, timeoutMs });
}

/**
 * Every page, `batch` at a time (default 4, staying within Chromium's 6-socket HTTP/1.1 pool per
 * origin so loopback fetches never queue behind keep-alive churn); `progress(done, total)` after
 * each batch; stops when `cancelled()` or `signal` aborts.
 */
export async function loadPages(
  token: string,
  count: number,
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
  batch = 4,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<PdfPageModel[]> {
  const pages: PdfPageModel[] = [];
  for (let first = 1; first <= count; first += batch) {
    if (cancelled() || signal?.aborted) throw new Error('cancelled');
    const last = Math.min(count, first + batch - 1);
    const numbers = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    pages.push(
      ...(await Promise.all(
        numbers.map((n) => json<PdfPageModel>(token, `page/${n}`, { signal, timeoutMs })),
      )),
    );
    progress(last, count);
  }
  return pages;
}
