/** Feature 010, US8 (research DP-1): converts a Markdown text in the background worker. */

import type { ConvertOptions, ConvertResult } from './convert';

type Answer = { ok: true; result: ConvertResult } | { ok: false; error: string };

export function convertInWorker(text: string, options: ConvertOptions): Promise<ConvertResult> {
  // The converter, with markdown-it, lives in the worker's bundle alone, outside the main bundle
  // (its unit tests import `convert.ts` directly).
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('the Markdown converter needs a background worker'));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Answer>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'the Markdown converter stopped'));
    };
    worker.postMessage({ text, options });
  });
}
