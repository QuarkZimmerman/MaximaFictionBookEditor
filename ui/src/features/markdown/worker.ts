/**
 * Feature 010, US8 (research DP-1): the converter in a background worker, so that a large
 * Markdown file never stalls the window.
 */

import { convertMarkdown, type ConvertOptions } from './convert';

interface Request {
  text: string;
  options: ConvertOptions;
}

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    self.postMessage({ ok: true, result: convertMarkdown(event.data.text, event.data.options) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
