/**
 * Feature 014 (contracts/print-service.md, tasks T013): the journeys' print seam. A core run with
 * --test-hooks keeps the PDF export's print requests (`test.printRequests`). This helper prints
 * each one as the shell's hidden browser does: its address in a page of the test's own browser
 * context, once the page has set its ready title, with `page.pdf` at the job's exact paper size.
 * It then uploads the bytes (`PUT /test/print/{jobId}`), and the export goes on.
 *
 * Readiness has one source of truth: the title the core's print route sets after
 * `document.fonts.ready`, which the shell waits for as well (app/src/print_service_cef.cpp).
 */
import type { BrowserContext } from '@playwright/test';

import type { CoreHandle } from './core';

export const PRINT_READY_TITLE = 'mfbe-print-ready';

/** One entry of `test.printRequests`. */
export interface PrintRequest {
  jobId: string;
  url: string;
  paperWidthIn: number;
  paperHeightIn: number;
  tagged: boolean;
}

/** What the seam did, for journeys that assert the requests (paper sizes, counts). */
export interface PrintSeam {
  readonly printed: PrintRequest[];
  readonly failed: { request: PrintRequest; error: string }[];
  stop(): Promise<void>;
}

/**
 * Answers print requests in the background until `stop()`. A request the page cannot print is
 * reported to the core as failed (`test.completePrint`), so the export ends with its message.
 */
export function startPrintSeam(
  core: CoreHandle,
  context: BrowserContext,
  options: { intervalMs?: number; readyTimeoutMs?: number } = {},
): PrintSeam {
  const printed: PrintRequest[] = [];
  const failed: { request: PrintRequest; error: string }[] = [];
  const seen = new Set<string>();
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const pending = await core.rpc<PrintRequest[]>('test.printRequests').catch(() => []);
      for (const request of pending) {
        if (seen.has(request.jobId)) continue;
        seen.add(request.jobId);
        try {
          await printOne(core, context, request, options.readyTimeoutMs ?? 120_000);
          printed.push(request);
        } catch (error) {
          failed.push({ request, error: String(error) });
          await core
            .rpc('test.completePrint', { jobId: request.jobId, message: String(error) })
            .catch(() => undefined);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 100));
    }
  })();
  return {
    printed,
    failed,
    stop: async () => {
      stopped = true;
      await loop;
    },
  };
}

async function printOne(
  core: CoreHandle,
  context: BrowserContext,
  request: PrintRequest,
  readyTimeoutMs: number,
): Promise<void> {
  if (core.port === undefined) throw new Error('the print seam needs a core');
  const page = await context.newPage();
  try {
    await page.goto(request.url);
    // The e2e files have no DOM types: the readiness probe is a string evaluated in the page.
    await page.waitForFunction(`document.title === ${JSON.stringify(PRINT_READY_TITLE)}`, null, {
      timeout: readyTimeoutMs,
    });
    const pdf = await page.pdf({
      width: `${request.paperWidthIn}in`,
      height: `${request.paperHeightIn}in`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
      printBackground: true,
      tagged: request.tagged,
      outline: false,
    });
    const response = await fetch(
      `http://127.0.0.1:${core.port}/test/print/${encodeURIComponent(request.jobId)}`,
      { method: 'PUT', headers: { 'x-mfbe-token': core.token ?? '' }, body: new Uint8Array(pdf) },
    );
    if (response.status !== 201) {
      throw new Error(`the core answered the upload with ${response.status}`);
    }
  } finally {
    await page.close();
  }
}
