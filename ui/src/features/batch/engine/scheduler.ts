/**
 * Feature 019 (T035, T049, T052, T056): Batch Converter execution scheduler.
 *
 * Coordinates scanning (`batch.scan`), target reservation (`batch.claimTarget`), W-slot concurrent
 * worker pool execution, throttled progress snapshots (<= 15 Hz, >= 1/s), error resilience,
 * per-item warning aggregation, strict cancellation, and guaranteed `batch.endRun` cleanup.
 */

import type { TFunction } from 'i18next';

import type { CommandContext } from '@/app/commands';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type Settings } from '@/rpc/types';

import {
  BatchSharedCache,
  type BatchAdapterContext,
  type BatchAdapterFn,
} from '../adapters/adapterTypes';
import { BatchAbortError, runCancellableRpcJob } from '../adapters/fb2LoadSave';
import { loadBatchAdapter } from '../adapters/registry';
import { WorkerCancelledError } from '../workers/workerCall';
import { effectiveWorkerCount, selectedImportFormats } from './configState';
import { formatActiveExportSummary } from './exportSummary';
import { resolveBatchTargetPath } from './paths';
import type {
  BatchActiveWorker,
  BatchBookFormat,
  BatchDiscoveredItem,
  BatchJobConfig,
  BatchPhase,
  BatchProgressSnapshot,
  BatchReport,
  BatchReportEntry,
  BatchReportWarningEntry,
  BatchScanError,
} from './types';

export interface BatchSchedulerOptions {
  ctx: CommandContext;
  config: BatchJobConfig;
  settings: Settings | null;
  cpuCores: number;
  openDocId?: string;
  onProgress: (snapshot: BatchProgressSnapshot) => void;
  /** Optional adapter override for unit tests (`tests/unit/batch/scheduler.test.ts`). */
  adapterLoader?: (
    direction: BatchJobConfig['direction'],
    format: BatchBookFormat,
  ) => Promise<BatchAdapterFn>;
}

export interface BatchRunController {
  readonly promise: Promise<BatchReport | null>;
  cancel(): void;
}

export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof BatchAbortError || error instanceof WorkerCancelledError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (isRpcError(error) && error.code === RpcErrorCode.cancelled) return true;
  return false;
}

export function mapScanErrorReason(err: BatchScanError, t: TFunction): string {
  switch (err.reasonCode) {
    case 'archive.encrypted':
      return t('batch.reasons.archiveEncrypted');
    case 'archive.damaged':
      return t('batch.reasons.archiveDamaged');
    case 'archive.tooLarge':
      return t('batch.reasons.archiveTooLarge');
    case 'archive.multiVolume':
      return t('batch.reasons.archiveMultiVolume');
    case 'archive.method':
      return t('batch.reasons.archiveMethod');
    case 'scan.unreadableDir':
      return t('batch.reasons.unreadableDir');
    default:
      return t('batch.reasons.unknownError', { detail: err.detail || err.reasonCode });
  }
}

export function mapClaimReason(reason: string, detail: string | undefined, t: TFunction): string {
  switch (reason) {
    case 'targetExists':
      return t('batch.reasons.targetExists');
    case 'targetBusy':
      return t('batch.reasons.targetBusy');
    case 'targetIsSource':
      return t('batch.reasons.targetIsSource');
    case 'targetIsOpenBook':
      return t('batch.reasons.targetIsOpenBook');
    case 'ioError':
      return t('batch.reasons.ioError', { detail: detail ?? '' });
    default:
      return t('batch.reasons.unknownError', { detail: detail ?? reason });
  }
}

export function mapBatchError(error: unknown, t: TFunction): string {
  if (isRpcError(error)) {
    const data = (error.data ?? {}) as { reason?: string; detail?: string; message?: string };
    if (error.code === RpcErrorCode.batchError) {
      switch (data.reason) {
        case 'sourceNotFound':
          return t('batch.reasons.sourceNotFound');
        case 'sourceNotDirectory':
          return t('batch.reasons.sourceNotDirectory');
        case 'sourceUnreadable':
          return t('batch.reasons.sourceUnreadable');
        case 'invalidPath':
          return t('batch.reasons.invalidPath');
        case 'extractFailed':
          return data.detail
            ? `${t('batch.reasons.extractFailed')} (${data.detail})`
            : t('batch.reasons.extractFailed');
        case 'ioError':
          return t('batch.reasons.ioError', { detail: data.detail ?? error.message });
      }
    }
    if (error.code === RpcErrorCode.mobiRefused && data.reason === 'encrypted') {
      return t('batch.reasons.encryptedMobi');
    }
    if (
      error.code === RpcErrorCode.pdfImportFailed &&
      (data.reason === 'passwordCancelled' || data.reason === 'copyForbidden')
    ) {
      return t('batch.reasons.passwordPdf');
    }
    const detail = data.detail ?? data.message ?? data.reason ?? error.message;
    return detail ? detail : t('batch.reasons.unknownError', { detail: String(error.code) });
  }
  const msg = error instanceof Error ? error.message : String(error);
  return msg || t('batch.reasons.unknownError', { detail: '' });
}

/**
 * Starts a full batch conversion run. Returns a controller with `.cancel()` and `.promise`.
 * Resolves to `null` ONLY if cancelled during the initial scan (before any conversion started),
 * or resolves to the completed/cancelled `BatchReport`.
 */
export function startBatchRun(options: BatchSchedulerOptions): BatchRunController {
  const { ctx, config, settings, cpuCores, openDocId, onProgress } = options;
  const rpc = ctx.rpc;
  const t = ctx.t;
  const loader = options.adapterLoader ?? loadBatchAdapter;
  const controller = new AbortController();
  const { signal } = controller;

  let phase: BatchPhase = 'scanning';
  let scannedCount = 0;
  let totalCount = 0;
  let convertedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  const activeBySlot = new Map<number, BatchActiveWorker>();

  let lastEmitMs = 0;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const MIN_EMIT_INTERVAL_MS = 67; // <= 15 Hz

  const buildSnapshot = (): BatchProgressSnapshot => ({
    phase,
    scannedCount,
    totalCount,
    completedCount: convertedCount + skippedCount + failedCount + cancelledCount,
    convertedCount,
    skippedCount,
    failedCount,
    cancelledCount,
    activeWorkers: [...activeBySlot.values()].sort((a, b) => a.slot - b.slot),
  });

  const emitNow = () => {
    if (emitTimer !== null) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    lastEmitMs = Date.now();
    onProgress(buildSnapshot());
  };

  const emitThrottled = () => {
    const now = Date.now();
    const wait = MIN_EMIT_INTERVAL_MS - (now - lastEmitMs);
    if (wait <= 0) {
      emitNow();
    } else if (emitTimer === null) {
      emitTimer = setTimeout(() => {
        emitTimer = null;
        emitNow();
      }, wait);
    }
  };

  const cancel = () => {
    if (signal.aborted) return;
    if (phase === 'scanning' || phase === 'converting') {
      phase = 'cancelling';
      for (const worker of activeBySlot.values()) {
        worker.stage = t('batch.progress.stageCancelling');
      }
      emitNow();
    }
    controller.abort();
  };

  const promise = (async (): Promise<BatchReport | null> => {
    if (!rpc) {
      throw new Error('RPC client unavailable');
    }
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    let runId: string | null = null;
    let cache: BatchSharedCache | null = null;

    // Heartbeat timer ensures at least 1 progress update per second while active (SC-009).
    const heartbeat = setInterval(() => {
      if (phase === 'scanning' || phase === 'converting' || phase === 'cancelling') {
        emitNow();
      }
    }, 900);

    try {
      emitNow();
      const scanRes = await runCancellableRpcJob(
        rpc,
        () =>
          rpc.call('batch.scan', {
            direction: config.direction,
            sourceDir: config.sourceDir.trim(),
            includeSubfolders: config.includeSubfolders,
            formats: config.direction === 'importToFb2' ? selectedImportFormats(config) : undefined,
          }),
        {
          signal,
          onProgress: (done) => {
            scannedCount = done;
            emitThrottled();
          },
        },
      );

      runId = scanRes.runId;
      if (signal.aborted) {
        return null;
      }

      const items: BatchDiscoveredItem[] = scanRes.items;
      const failed: BatchReportEntry[] = [];
      const skipped: BatchReportEntry[] = [];
      const warnings: BatchReportWarningEntry[] = [];

      // Pre-failed scan errors enter the report directly in failed status.
      for (const err of scanRes.scanErrors) {
        failed.push({
          displayPath: err.displayPath,
          sourcePath: err.sourcePath,
          reason: mapScanErrorReason(err, t),
        });
      }
      failedCount = failed.length;
      totalCount = items.length + failed.length;

      const exportDefaultsSummary =
        config.direction === 'fb2ToExport'
          ? formatActiveExportSummary(config.exportFormat, settings, config.zipOutput, t)
          : undefined;

      // 0 matching items and 0 scan errors -> clean empty completion with immediate endRun.
      if (items.length === 0) {
        phase = 'finished';
        emitNow();
        return {
          startedAtIso,
          finishedAtIso: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          cancelled: false,
          config: { ...config, sourceDir: scanRes.sourceDir },
          exportDefaultsSummary,
          counts: {
            total: totalCount,
            converted: 0,
            skipped: 0,
            failed: failedCount,
            cancelled: 0,
          },
          failed,
          skipped,
          warnings,
        };
      }

      phase = 'converting';
      emitNow();

      const workerSlots = Math.min(effectiveWorkerCount(config, cpuCores), items.length);
      cache = new BatchSharedCache(rpc);
      const activeCache = cache;
      const adapterCache = new Map<string, Promise<BatchAdapterFn>>();
      const getAdapter = (format: BatchBookFormat) => {
        const key = `${config.direction}:${format}`;
        let p = adapterCache.get(key);
        if (!p) {
          p = loader(config.direction, format);
          adapterCache.set(key, p);
        }
        return p;
      };

      let nextIndex = 0;

      const workerLoop = async (slot: number): Promise<void> => {
        while (true) {
          if (signal.aborted) return;
          const idx = nextIndex++;
          if (idx >= items.length) return;
          const item = items[idx]!;
          const resolved = resolveBatchTargetPath(item, config, settings);

          activeBySlot.set(slot, {
            slot,
            itemId: item.itemId,
            displayPath: item.displayPath,
            stage: t('batch.progress.stageReading'),
            done: 0,
            total: 0,
          });
          emitNow();

          let claimId: string | null = null;
          let claimSucceeded = false;

          try {
            const claim = await rpc.call('batch.claimTarget', {
              runId: runId!,
              sourcePath: item.sourcePath,
              targetPath: resolved.targetPath,
              openDocId,
              overwrite: config.overwrite,
            });

            if (signal.aborted) {
              if (claim.status === 'claimed') {
                claimId = claim.claimId;
              }
              cancelledCount++;
              continue;
            }

            if (claim.status === 'skipped') {
              skippedCount++;
              skipped.push({
                displayPath: item.displayPath,
                sourcePath: item.sourcePath,
                targetPath: resolved.targetPath,
                reason: mapClaimReason(claim.reason, undefined, t),
              });
              continue;
            }
            if (claim.status === 'failed') {
              failedCount++;
              failed.push({
                displayPath: item.displayPath,
                sourcePath: item.sourcePath,
                targetPath: resolved.targetPath,
                reason: mapClaimReason(claim.reason, claim.detail, t),
              });
              continue;
            }

            claimId = claim.claimId;
            const targetFormat: BatchBookFormat =
              config.direction === 'fb2ToExport'
                ? config.exportFormat
                : (item.format as BatchBookFormat);
            const adapter = await getAdapter(targetFormat);

            const adapterParams: BatchAdapterContext = {
              ctx,
              rpc,
              settings,
              config,
              runId: runId!,
              item,
              targetPath: claim.targetPath,
              outputStem: resolved.outputStem,
              signal,
              cache: activeCache,
              onStage: (stageKey, done, total) => {
                const current = activeBySlot.get(slot);
                if (!current) return;
                current.stage = signal.aborted ? t('batch.progress.stageCancelling') : t(stageKey);
                current.done = done;
                current.total = total;
                emitThrottled();
              },
            };

            const outcome = await adapter(adapterParams);
            claimSucceeded = true;
            convertedCount++;
            if (outcome.warnings.length > 0) {
              warnings.push({
                displayPath: item.displayPath,
                sourcePath: item.sourcePath,
                targetPath: claim.targetPath,
                messages: outcome.warnings,
              });
            }
          } catch (error) {
            if (signal.aborted || isAbortLikeError(error)) {
              cancelledCount++;
            } else {
              failedCount++;
              failed.push({
                displayPath: item.displayPath,
                sourcePath: item.sourcePath,
                targetPath: resolved.targetPath,
                reason: mapBatchError(error, t),
              });
            }
          } finally {
            activeBySlot.delete(slot);
            if (claimId !== null && runId !== null) {
              await rpc
                .call('batch.releaseTarget', {
                  runId,
                  claimId,
                  succeeded: claimSucceeded,
                })
                .catch(() => undefined);
            }
            if (runId !== null) {
              await rpc
                .call('batch.cleanupItem', { runId, itemId: item.itemId })
                .catch(() => undefined);
            }
            emitNow();
          }
        }
      };

      await Promise.all(Array.from({ length: workerSlots }, (_, slot) => workerLoop(slot)));

      // Any queued items never picked up before Cancel are accounted as cancelled.
      if (signal.aborted && nextIndex < items.length) {
        cancelledCount += items.length - nextIndex;
      }

      phase = 'finished';
      emitNow();

      return {
        startedAtIso,
        finishedAtIso: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        cancelled: signal.aborted,
        config: { ...config, sourceDir: scanRes.sourceDir },
        exportDefaultsSummary,
        counts: {
          total: totalCount,
          converted: convertedCount,
          skipped: skippedCount,
          failed: failedCount,
          cancelled: cancelledCount,
        },
        failed,
        skipped,
        warnings,
      };
    } catch (error) {
      if (signal.aborted || isAbortLikeError(error)) {
        // Cancelled during scan before conversion began: return to editable configuration.
        phase = 'idle';
        emitNow();
        return null;
      }
      phase = 'idle';
      emitNow();
      throw error;
    } finally {
      cache?.dispose();
      clearInterval(heartbeat);
      if (emitTimer !== null) {
        clearTimeout(emitTimer);
        emitTimer = null;
      }
      if (runId !== null) {
        await rpc.call('batch.endRun', { runId }).catch(() => undefined);
      }
    }
  })();

  return { promise, cancel };
}
