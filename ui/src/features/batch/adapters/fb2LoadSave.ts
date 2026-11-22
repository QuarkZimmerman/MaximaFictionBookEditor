/**
 * Feature 019 (T024): ephemeral headless FB2 open / create / save / close helpers for batch
 * adapters. Every call passes `ephemeral: true` and tracks active `jobId`s so cancellation aborts
 * promptly and neither Recent files nor remembered positions nor the active editor document are
 * ever touched.
 */

import type { Document, ValidationIssue } from '@/model/document';
import type { RpcClient } from '@/rpc/client';
import { isJobStart, type BinaryMeta, type SaveResult } from '@/rpc/types';

export class BatchAbortError extends Error {
  constructor(message = 'Batch item cancelled') {
    super(message);
    this.name = 'BatchAbortError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new BatchAbortError();
  }
}

/**
 * Awaits a core `MaybeJob<T>` RPC call while forwarding `signal` aborts to `job.cancel` and
 * forwarding `job.progress` updates to `onProgress`.
 */
export async function runCancellableRpcJob<T>(
  rpc: RpcClient,
  start: () => Promise<T | { jobId: string }>,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, phase: string) => void;
    onJobId?: (jobId: string) => void;
  } = {},
): Promise<T> {
  throwIfAborted(options.signal);
  const initial = await start();
  if (!isJobStart(initial)) {
    throwIfAborted(options.signal);
    return initial;
  }
  const { jobId } = initial;
  options.onJobId?.(jobId);

  const onAbort = () => {
    void rpc.call('job.cancel', { jobId }).catch(() => undefined);
  };
  if (options.signal?.aborted) {
    onAbort();
    throw new BatchAbortError();
  }
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const offProgress = rpc.on('job.progress', (progress) => {
    if (progress.jobId === jobId) {
      options.onProgress?.(progress.done, progress.total, progress.phase);
    }
  });

  try {
    return (await rpc.waitForJob(jobId)) as T;
  } finally {
    offProgress();
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export interface EphemeralOpenedBook {
  docId: string;
  document: Document;
  warnings: ValidationIssue[];
}

/**
 * Opens an FB2 file (or an entry inside a ZIP archive) headlessly in a temporary core session.
 * Automatically retries with `cleanInvalidChars: true` on repairable invalid-XML-character errors
 * so unattended batch export recovers every file the interactive editor can repair.
 */
export async function openEphemeralFb2(
  rpc: RpcClient,
  path: string,
  archiveEntry: string | undefined,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, phase: string) => void;
  } = {},
): Promise<EphemeralOpenedBook> {
  const answer = await runCancellableRpcJob(
    rpc,
    () =>
      rpc.call('doc.open', {
        path,
        entry: archiveEntry,
        cleanInvalidChars: true,
        ephemeral: true,
      }),
    options,
  );
  if ('needsChoice' in answer) {
    throw new Error('Archive requires an explicit book entry');
  }
  return {
    docId: answer.document.docId,
    document: answer.document,
    warnings: answer.warnings,
  };
}

/**
 * Creates a temporary core document session from imported FB2 XML without touching the active
 * editor store.
 */
export async function createEphemeralFb2FromXml(
  rpc: RpcClient,
  xml: string,
  origin: { kind: 'markdown' | 'epub' | 'pdf' | 'txt'; path: string },
  options: {
    keepDetails?: boolean;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, phase: string) => void;
  } = {},
): Promise<EphemeralOpenedBook> {
  const answer = await runCancellableRpcJob(
    rpc,
    () =>
      rpc.call('doc.newFromXml', {
        xml,
        origin,
        keepDetails: options.keepDetails,
      }),
    options,
  );
  return {
    docId: answer.document.docId,
    document: answer.document,
    warnings: answer.warnings,
  };
}

/**
 * Saves an ephemeral document atomically as UTF-8 `.fb2` or single-entry `.fb2.zip` without
 * touching Recent files, remembered positions, or session path metadata.
 */
export async function saveEphemeralFb2(
  rpc: RpcClient,
  docId: string,
  document: Document,
  targetPath: string,
  options: {
    zipOutput: boolean;
    outputStem: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, phase: string) => void;
  },
): Promise<SaveResult> {
  const answer = await runCancellableRpcJob(
    rpc,
    () =>
      rpc.call('doc.save', {
        docId,
        document,
        path: targetPath,
        encoding: 'utf-8',
        force: true,
        backup: false,
        archive: options.zipOutput ? { entryName: `${options.outputStem}.fb2` } : undefined,
        ephemeral: true,
      }),
    options,
  );
  if ('needsConfirmation' in answer && answer.needsConfirmation) {
    throw new Error('Unexpected save confirmation in forced ephemeral save');
  }
  return answer as SaveResult;
}

/** Best-effort close of a temporary core document session. */
export async function closeEphemeralDoc(
  rpc: RpcClient,
  docId: string | null | undefined,
): Promise<void> {
  if (!docId) return;
  await rpc.call('doc.close', { docId }).catch(() => undefined);
}

/**
 * Fetches binary metadata list for an ephemeral document session.
 */
export async function listEphemeralBinaries(rpc: RpcClient, docId: string): Promise<BinaryMeta[]> {
  return rpc.call('binary.list', { docId });
}
