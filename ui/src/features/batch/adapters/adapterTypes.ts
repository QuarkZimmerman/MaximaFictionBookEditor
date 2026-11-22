/**
 * Feature 019 (T030–T035): shared adapter interface, per-run lookup cache, and 1-permit async
 * semaphore (used to serialize CEF PrintService calls during parallel batch PDF export).
 */

import type { CommandContext } from '@/app/commands';
import type { RpcClient } from '@/rpc/client';
import type { GenreEntry, LanguageEntry, PdfAddedFont, Settings, TxtEncodings } from '@/rpc/types';

import type { BatchDiscoveredItem, BatchJobConfig } from '../engine/types';
import { BatchWorkerPool } from '../workers/workerCall';
import { BatchAbortError } from './fb2LoadSave';

export class AsyncSemaphore {
  private locked = false;
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new BatchAbortError();
    }
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const entry: (typeof this.waiters)[number] = { resolve, reject, signal };
      if (signal) {
        const onAbort = () => {
          const idx = this.waiters.indexOf(entry);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new BatchAbortError());
        };
        entry.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.waiters.push(entry);
    });
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (!next) {
      this.locked = false;
      return;
    }
    if (next.signal && next.onAbort) {
      next.signal.removeEventListener('abort', next.onAbort);
    }
    next.resolve();
  }
}

export class BatchSharedCache {
  private genresPromise: Promise<GenreEntry[]> | null = null;
  private languagesPromise: Promise<LanguageEntry[]> | null = null;
  private txtEncodingsPromise: Promise<TxtEncodings> | null = null;
  private pdfAddedFontsPromise: Promise<PdfAddedFont[]> | null = null;
  private appVersionPromise: Promise<string> | null = null;
  readonly pdfPrintLock = new AsyncSemaphore();
  readonly workerPool = new BatchWorkerPool();

  constructor(private readonly rpc: RpcClient) {}

  dispose(): void {
    this.workerPool.dispose();
  }

  getGenres(): Promise<GenreEntry[]> {
    this.genresPromise ??= this.rpc
      .call('resources.genres')
      .then((res) => res.entries)
      .catch(() => []);
    return this.genresPromise;
  }

  getLanguages(): Promise<LanguageEntry[]> {
    this.languagesPromise ??= this.rpc.call('resources.languages').catch(() => []);
    return this.languagesPromise;
  }

  getTxtEncodings(): Promise<TxtEncodings> {
    this.txtEncodingsPromise ??= this.rpc.call('txt.encodings', {});
    return this.txtEncodingsPromise;
  }

  getPdfAddedFonts(): Promise<PdfAddedFont[]> {
    this.pdfAddedFontsPromise ??= this.rpc
      .call('pdf.fonts.list', {})
      .then((res) => res.added)
      .catch(() => []);
    return this.pdfAddedFontsPromise;
  }

  getAppVersion(): Promise<string> {
    this.appVersionPromise ??= this.rpc
      .call('app.info')
      .then((info) => info.version)
      .catch(() => '');
    return this.appVersionPromise;
  }
}

export interface BatchAdapterContext {
  ctx: CommandContext;
  rpc: RpcClient;
  settings: Settings | null;
  config: BatchJobConfig;
  runId: string;
  item: BatchDiscoveredItem;
  targetPath: string;
  outputStem: string;
  signal: AbortSignal;
  onStage: (stageKey: string, done: number, total: number) => void;
  cache: BatchSharedCache;
}

export interface BatchAdapterOutcome {
  warnings: string[];
}

export type BatchAdapterFn = (params: BatchAdapterContext) => Promise<BatchAdapterOutcome>;
