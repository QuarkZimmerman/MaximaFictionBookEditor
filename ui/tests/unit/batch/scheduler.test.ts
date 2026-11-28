/**
 * Feature 019 (T054; US5): Unit tests for `startBatchRun` scheduler verifying strict sequential
 * concurrency (max = 1), bounded parallel concurrency (1 < max <= W <= cores - 1), stable worker
 * slot assignment, progress throttling (<= 15 Hz, >= 1/s heartbeat), parallel error isolation,
 * and deterministic cleanup (`batch.releaseTarget`, `batch.cleanupItem`, `batch.endRun`).
 */

import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '@/app/commands';
import type { BatchAdapterFn } from '@/features/batch/adapters/adapterTypes';
import { BatchSkippedError } from '@/features/batch/adapters/fb2LoadSave';
import { startBatchRun } from '@/features/batch/engine/scheduler';
import type {
  BatchDiscoveredItem,
  BatchJobConfig,
  BatchProgressSnapshot,
} from '@/features/batch/engine/types';
import { initI18n } from '@/i18n';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeItems(count: number): BatchDiscoveredItem[] {
  return Array.from({ length: count }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return {
      itemId: `item-${num}`,
      sourcePath: `/books/src/book-${num}.fb2`,
      relativeDir: '',
      displayPath: `book-${num}.fb2`,
      format: 'fb2',
      archiveMultiBook: false,
      sizeBytes: 1024,
    };
  });
}

function makeConfig(overrides: Partial<BatchJobConfig> = {}): BatchJobConfig {
  return {
    direction: 'fb2ToExport',
    exportFormat: 'txt',
    importAll: true,
    importFormats: { epub: true, mobi: true, pdf: true, txt: true, markdown: true, docx: true },
    sourceDir: '/books/src',
    destinationDir: '/books/out',
    includeSubfolders: true,
    keepTree: true,
    inPlace: false,
    zipOutput: false,
    fixBroken: true,
    overwrite: false,
    parallel: false,
    workerCount: 3,
    pdfUseOcr: true,
    ocrAutoDetect: true,
    ocrLanguages: ['eng', 'rus'],
    ...overrides,
  };
}

interface MockRpcState {
  released: Array<{ runId: string; claimId: string; succeeded: boolean }>;
  cleaned: Array<{ runId: string; itemId: string }>;
  endedRuns: string[];
  busyItems: Set<string>;
}

async function createMockContext(
  items: BatchDiscoveredItem[],
  busyItems: string[] = [],
): Promise<{ ctx: CommandContext; rpcState: MockRpcState }> {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const rpcState: MockRpcState = {
    released: [],
    cleaned: [],
    endedRuns: [],
    busyItems: new Set(busyItems),
  };
  let nextClaim = 1;

  const rpc = {
    async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
      switch (method) {
        case 'batch.scan':
          return {
            runId: 'run-mock-1',
            sourceDir: '/books/src',
            items,
            scanErrors: [],
          };
        case 'batch.claimTarget': {
          const targetPath = String(params?.targetPath ?? '');
          for (const busy of rpcState.busyItems) {
            if (targetPath.includes(busy)) {
              return { status: 'skipped', targetPath, reason: 'targetBusy' };
            }
          }
          return { status: 'claimed', claimId: `claim-${nextClaim++}`, targetPath };
        }
        case 'batch.releaseTarget':
          rpcState.released.push({
            runId: String(params?.runId),
            claimId: String(params?.claimId),
            succeeded: Boolean(params?.succeeded),
          });
          return {};
        case 'batch.cleanupItem':
          rpcState.cleaned.push({
            runId: String(params?.runId),
            itemId: String(params?.itemId),
          });
          return {};
        case 'batch.endRun':
          rpcState.endedRuns.push(String(params?.runId));
          return {};
        case 'job.cancel':
          return {};
        default:
          throw new Error(`Unexpected RPC method in mock: ${method}`);
      }
    },
    on: () => () => undefined,
    waitForJob: async () => ({}),
  };

  const ctx = {
    rpc,
    t: i18n.t.bind(i18n),
  } as unknown as CommandContext;

  return { ctx, rpcState };
}

describe('startBatchRun scheduler', () => {
  it('enforces max concurrency === 1 when parallel is unchecked', async () => {
    const items = makeItems(6);
    const { ctx, rpcState } = await createMockContext(items);
    let inFlight = 0;
    let peak = 0;
    const snapshots: BatchProgressSnapshot[] = [];

    const fakeAdapter: BatchAdapterFn = async ({ onStage }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      onStage('batch.progress.stageConverting', 1, 2);
      await delay(15);
      inFlight--;
      return { warnings: [] };
    };

    const run = startBatchRun({
      ctx,
      config: makeConfig({ parallel: false, workerCount: 5 }),
      settings: null,
      cpuCores: 8,
      onProgress: (s) => snapshots.push(s),
      adapterLoader: async () => fakeAdapter,
    });

    const report = await run.promise;
    expect(report).not.toBeNull();
    expect(report!.counts).toEqual({
      total: 6,
      converted: 6,
      fixed: 0,
      ocr: 0,
      skipped: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(peak).toBe(1);
    for (const snap of snapshots) {
      expect(snap.activeWorkers.length).toBeLessThanOrEqual(1);
      for (const w of snap.activeWorkers) expect(w.slot).toBe(0);
    }
    expect(rpcState.released).toHaveLength(6);
    expect(rpcState.cleaned).toHaveLength(6);
    expect(rpcState.endedRuns).toEqual(['run-mock-1']);
  });

  it('bounds parallel concurrency strictly to <= W and <= cores - 1 with stable slots', async () => {
    const items = makeItems(12);
    const { ctx, rpcState } = await createMockContext(items);
    let inFlight = 0;
    let peak = 0;
    const observedSlots = new Set<number>();

    const fakeAdapter: BatchAdapterFn = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(30);
      inFlight--;
      return { warnings: [] };
    };

    // Request workerCount=10 on a 4-core host -> must clamp strictly to cores - 1 = 3.
    const run = startBatchRun({
      ctx,
      config: makeConfig({ parallel: true, workerCount: 10 }),
      settings: null,
      cpuCores: 4,
      onProgress: (snap) => {
        expect(snap.activeWorkers.length).toBeLessThanOrEqual(3);
        // Active workers must always be sorted stably by ascending slot id.
        const slots = snap.activeWorkers.map((w) => w.slot);
        expect(slots).toEqual([...slots].sort((a, b) => a - b));
        for (const s of slots) observedSlots.add(s);
      },
      adapterLoader: async () => fakeAdapter,
    });

    const report = await run.promise;
    expect(report!.counts.converted).toBe(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect([...observedSlots].every((s) => s >= 0 && s < 3)).toBe(true);
    expect(rpcState.endedRuns).toEqual(['run-mock-1']);
  });

  it('throttles rapid progress bursts (<= 15 Hz) and emits heartbeat updates (>= 1/s)', async () => {
    const items = makeItems(1);
    const { ctx } = await createMockContext(items);
    let burstSnapshots = 0;
    let heartbeatSnapshots = 0;
    let inStall = false;

    const fakeAdapter: BatchAdapterFn = async ({ onStage }) => {
      // Burst: 60 synchronous updates inside < 5 ms should coalesce well below 60 emits.
      for (let i = 1; i <= 60; i++) {
        onStage('batch.progress.stageConverting', i, 60);
      }
      await delay(100);
      inStall = true;
      // Stall for 1.1 s: 900 ms heartbeat must emit at least once (>= 1/s).
      await delay(1100);
      inStall = false;
      return { warnings: [] };
    };

    const run = startBatchRun({
      ctx,
      config: makeConfig({ parallel: false }),
      settings: null,
      cpuCores: 4,
      onProgress: (snap) => {
        if (snap.phase === 'converting') {
          if (inStall) heartbeatSnapshots++;
          else burstSnapshots++;
        }
      },
      adapterLoader: async () => fakeAdapter,
    });

    await run.promise;
    expect(burstSnapshots).toBeLessThan(15);
    expect(heartbeatSnapshots).toBeGreaterThanOrEqual(1);
  });

  it('isolates parallel item errors and skips while cleaning up every item deterministically', async () => {
    const items = makeItems(6);
    const { ctx, rpcState } = await createMockContext(items, ['book-03']);

    const fakeAdapter: BatchAdapterFn = async ({ item }) => {
      await delay(15);
      if (item.itemId === 'item-02') {
        throw new Error('corrupt input stream');
      }
      if (item.itemId === 'item-05') {
        throw new BatchSkippedError('Broken XML skipped because Fix broken is off');
      }
      return {
        warnings: item.itemId === 'item-04' ? ['minor warning'] : [],
        ...(item.itemId === 'item-06'
          ? { fixedReason: 'Broken XML repaired in memory (line 12, column 4): mismatch' }
          : {}),
      };
    };

    const run = startBatchRun({
      ctx,
      config: makeConfig({ parallel: true, workerCount: 3 }),
      settings: null,
      cpuCores: 4,
      onProgress: () => undefined,
      adapterLoader: async () => fakeAdapter,
    });

    const report = await run.promise;
    expect(report!.counts).toEqual({
      total: 6,
      converted: 3,
      fixed: 1,
      ocr: 0,
      skipped: 2,
      failed: 1,
      cancelled: 0,
    });
    expect(report!.failed).toHaveLength(1);
    expect(report!.failed[0]!.displayPath).toBe('book-02.fb2');
    expect(report!.skipped).toHaveLength(2);
    expect(report!.skipped.map((s) => s.displayPath).sort()).toEqual([
      'book-03.fb2',
      'book-05.fb2',
    ]);
    expect(report!.fixed).toHaveLength(1);
    expect(report!.fixed[0]!.displayPath).toBe('book-06.fb2');
    expect(report!.warnings).toHaveLength(1);
    expect(report!.warnings[0]!.displayPath).toBe('book-04.fb2');

    // Every claimed item (5: all except claim-skipped book-03) released; failed item-02 and
    // adapter-skipped item-05 released with succeeded=false; every item cleaned up; run ended.
    expect(rpcState.released).toHaveLength(5);
    expect(rpcState.released.filter((r) => !r.succeeded)).toHaveLength(2);
    expect(rpcState.cleaned).toHaveLength(6);
    expect(rpcState.endedRuns).toEqual(['run-mock-1']);
  });

  it('cleans up active workers and accounts queued items as cancelled on parallel cancel', async () => {
    const items = makeItems(10);
    const { ctx, rpcState } = await createMockContext(items);
    let started = 0;

    let cancelFn: (() => void) | null = null;
    const fakeAdapter: BatchAdapterFn = async ({ signal }) => {
      started++;
      if (started === 3) {
        cancelFn?.();
      }
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ warnings: [] }), 150);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true },
        );
      });
    };

    const run = startBatchRun({
      ctx,
      config: makeConfig({ parallel: true, workerCount: 3 }),
      settings: null,
      cpuCores: 4,
      onProgress: () => undefined,
      adapterLoader: async () => fakeAdapter,
    });
    cancelFn = run.cancel;

    const report = await run.promise;
    expect(report).not.toBeNull();
    expect(report!.cancelled).toBe(true);
    expect(report!.counts.failed).toBe(0);
    expect(report!.counts.cancelled).toBeGreaterThan(0);
    expect(report!.counts.converted + report!.counts.cancelled).toBe(10);
    expect(rpcState.endedRuns).toEqual(['run-mock-1']);
  });
});
