/**
 * Feature 019 (T024): ephemeral headless FB2 open / create / save / close helpers for batch
 * adapters. Every call passes `ephemeral: true` and tracks active `jobId`s so cancellation aborts
 * promptly and neither Recent files nor remembered positions nor the active editor document are
 * ever touched.
 */

import type { TFunction } from 'i18next';

import type { Description, Document, ValidationIssue } from '@/model/document';
import { isRpcError, type RpcClient, type RpcError } from '@/rpc/client';
import { isJobStart, RpcErrorCode, type BinaryMeta, type SaveResult } from '@/rpc/types';

export class BatchAbortError extends Error {
  constructor(message = 'Batch item cancelled') {
    super(message);
    this.name = 'BatchAbortError';
  }
}

export class BatchSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchSkippedError';
  }
}

function formatBrokenXmlSkipped(error: RpcError, t?: TFunction): string {
  const data = (error.data ?? {}) as { line?: number; column?: number; message?: string };
  const line = typeof data.line === 'number' ? data.line : 0;
  const column = typeof data.column === 'number' ? data.column : 0;
  const message = (data.message ?? error.message ?? '').trim();
  if (t) {
    return line > 0
      ? t('batch.reasons.brokenXmlSkipped', { line, column, message })
      : t('batch.reasons.brokenXmlSkippedGeneric', { message });
  }
  return line > 0
    ? `Broken XML skipped (line ${line}, column ${column}): ${message}`
    : `Broken XML skipped: ${message}`;
}

function extractXmlRepairedReason(warnings: ValidationIssue[], t?: TFunction): string | undefined {
  const issue = warnings.find((w) => w.code === 'xml.repaired');
  if (!issue) return undefined;
  const params = (issue.params ?? {}) as {
    line?: number;
    column?: number;
    message?: string;
    errorCount?: number;
  };
  const line = typeof params.line === 'number' ? params.line : (issue.line ?? 0);
  const column = typeof params.column === 'number' ? params.column : (issue.column ?? 0);
  const message = typeof params.message === 'string' ? params.message.trim() : '';
  const count =
    typeof params.errorCount === 'number' && params.errorCount > 0 ? params.errorCount : 1;
  if (t) {
    return line > 0
      ? t('batch.reasons.brokenXmlFixed', { line, column, message, count })
      : t('batch.reasons.brokenXmlFixedGeneric', { message, count });
  }
  return line > 0
    ? `Repaired broken XML in memory (line ${line}, column ${column}): ${message}`
    : `Repaired broken XML in memory: ${message}`;
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
  repairedReason?: string;
}

export interface EphemeralHeadlessBook {
  docId: string;
  description: Description;
  binaryCount: number;
  warnings: ValidationIssue[];
  repairedReason?: string;
}

/**
 * Opens an FB2 file headlessly for worker-side processing (`batch.openDoc`). The full Document
 * JSON is serialized on a C++ worker thread and served once at `GET /batch/doc/:docId` so the
 * browser main thread never parses or structured-clones the document body AST.
 */
export async function openEphemeralFb2Headless(
  rpc: RpcClient,
  path: string,
  archiveEntry: string | undefined,
  options: {
    fixBroken?: boolean;
    t?: TFunction;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, phase: string) => void;
  } = {},
): Promise<EphemeralHeadlessBook> {
  const fixBroken = options.fixBroken ?? true;
  try {
    const answer = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('batch.openDoc', {
          path,
          entry: archiveEntry,
          cleanInvalidChars: true,
          recover: fixBroken,
        }),
      options,
    );
    const repairedReason = extractXmlRepairedReason(answer.warnings, options.t);
    return {
      ...answer,
      ...(repairedReason ? { repairedReason } : {}),
    };
  } catch (error) {
    if (!fixBroken && isRpcError(error) && error.code === RpcErrorCode.docParseError) {
      throw new BatchSkippedError(formatBrokenXmlSkipped(error, options.t));
    }
    throw error;
  }
}

/**
 * Opens an FB2 file (or an entry inside a ZIP archive) headlessly in a temporary core session.
 * When `fixBroken` is true (default), repairs malformed FB2 XML in memory without touching the
 * source file; when false, malformed XML raises `BatchSkippedError` so the file is skipped.
 */
export async function openEphemeralFb2(
  rpc: RpcClient,
  path: string,
  archiveEntry: string | undefined,
  options: {
    fixBroken?: boolean;
    t?: TFunction;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, phase: string) => void;
  } = {},
): Promise<EphemeralOpenedBook> {
  const fixBroken = options.fixBroken ?? true;
  let answer;
  try {
    answer = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('doc.open', {
          path,
          entry: archiveEntry,
          cleanInvalidChars: true,
          recover: fixBroken,
          ephemeral: true,
        }),
      options,
    );
  } catch (error) {
    if (!fixBroken && isRpcError(error) && error.code === RpcErrorCode.docParseError) {
      throw new BatchSkippedError(formatBrokenXmlSkipped(error, options.t));
    }
    throw error;
  }
  if ('needsChoice' in answer) {
    throw new Error('Archive requires an explicit book entry');
  }
  if ('packageDetected' in answer) {
    throw new Error('Archive is an FBD package rather than an FB2 document');
  }
  const repairedReason = extractXmlRepairedReason(answer.warnings, options.t);
  return {
    docId: answer.document.docId,
    document: answer.document,
    warnings: answer.warnings,
    ...(repairedReason ? { repairedReason } : {}),
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
