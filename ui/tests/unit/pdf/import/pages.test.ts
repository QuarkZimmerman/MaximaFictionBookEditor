import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDocument, loadPages } from '@/features/pdf/import/pages';

describe('pdf/import/pages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caps concurrent page fetches at 4 by default and preserves page order', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const url = String(input);
      const match = /\/page\/(\d+)/.exec(url);
      const page = match ? Number(match[1]) : 0;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify({ page, width: 100, height: 200, words: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const progress: [number, number][] = [];
    const pages = await loadPages(
      'tok',
      10,
      (done, total) => progress.push([done, total]),
      () => false,
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(pages.map((p) => (p as unknown as { page: number }).page)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(progress).toEqual([
      [4, 10],
      [8, 10],
      [10, 10],
    ]);
  });

  it('retries once when a loopback fetch stalls past its per-attempt timeout', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ pages: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const doc = await loadDocument('tok', undefined, 30);
    expect(doc.pages).toBe(2);
    expect(calls).toBe(2);
  });

  it('aborts an in-flight fetch immediately when the caller AbortSignal fires', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    });

    const ac = new AbortController();
    const pending = loadDocument('tok', ac.signal, 5_000);
    ac.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(calls).toBe(1);
  });
});
