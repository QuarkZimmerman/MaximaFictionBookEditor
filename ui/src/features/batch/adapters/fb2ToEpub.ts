/**
 * Feature 019 (T030; FR-004, FR-005, FR-024): unattended FB2 -> EPUB batch adapter.
 * Uses dynamic imports so `batch-converter` never statically depends on `epub-export` or `epub-shared`.
 */

import { proposedStem } from '@/features/file/proposedName';
import { batchDocUrl, epubWriteUrl } from '@/model/binaryUrls';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { EpubExportWorkerRequest, EpubExportWorkerResult } from '../workers/epubExportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import { closeEphemeralDoc, openEphemeralFb2Headless, throwIfAborted } from './fb2LoadSave';

function splitEpubUploadTarget(token: string): { prefix: string; query: string } {
  const probe = new URL(epubWriteUrl(token, '__mfbe_probe__'), window.location.href);
  const full = probe.href;
  const idx = full.lastIndexOf('__mfbe_probe__');
  return {
    prefix: full.slice(0, idx),
    query: probe.search,
  };
}

const createEpubExportWorker = () =>
  new Worker(new URL('../workers/epubExportWorker.ts', import.meta.url), { type: 'module' });

export async function runFb2ToEpub(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, item, targetPath, signal, onStage, cache } = params;
  const { wordsLanguage } = await import('@/features/epub/shared/words');

  let docId: string | null = null;
  let token: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const opened = await openEphemeralFb2Headless(rpc, item.sourcePath, item.archiveEntry, {
      signal,
      onProgress: (done, total) =>
        onStage('batch.progress.stageReading', done, Math.max(total, 100)),
    });
    docId = opened.docId;
    throwIfAborted(signal);

    const [begun, genresList] = await Promise.all([
      rpc.call('epub.write.begin', { path: targetPath, docId }),
      cache.getGenres(),
    ]);
    token = begun.token;
    throwIfAborted(signal);

    const activeToken = token;
    const activeDocId = docId;
    const language = wordsLanguage(opened.description.titleInfo.lang);
    const genreEntries: [string, string][] = genresList.map((entry) => [
      entry.code,
      entry.names[language] ?? entry.names.en ?? entry.code,
    ]);

    const leftOut: { kind: string; detail: string }[] = [];

    const workerReq: EpubExportWorkerRequest = {
      documentUrl: new URL(batchDocUrl(activeDocId), window.location.href).href,
      needsPicturePlacement: opened.binaryCount > 0,
      fallbackTitle: proposedStem(opened.description, ctx.t('app.untitled')),
      genreNames: genreEntries,
      uploadTarget: splitEpubUploadTarget(activeToken),
    };
    const { summary, faults } = await runWorkerTask<
      EpubExportWorkerRequest,
      EpubExportWorkerResult
    >(createEpubExportWorker, workerReq, {
      signal,
      pool: { pool: cache.workerPool, key: 'epubExport' },
      onProgress: (p) => onStage('batch.progress.stageConverting', p.done, Math.max(p.total, 3)),
      onRequest: async (payload) => {
        const pictures = payload as string[];
        const { NameAllocator } = await import('@/features/epub/shared/names');
        const names = new NameAllocator();
        const placed: [string, { name: string; mediaType: string }][] = [];
        for (let i = 0; i < pictures.length; i++) {
          throwIfAborted(signal);
          const binaryId = pictures[i]!;
          onStage('batch.progress.stageConverting', i, pictures.length + 3);
          try {
            const res = await rpc.call('epub.write.binary', {
              token: activeToken,
              stem: names.allocate('EPUB/images/', binaryId, ''),
              docId: activeDocId,
              binaryId,
            });
            placed.push([binaryId, { name: res.name, mediaType: res.mediaType }]);
          } catch (error) {
            if (
              !isRpcError(error) ||
              (error.code !== RpcErrorCode.binaryNotImage &&
                error.code !== RpcErrorCode.binaryNotFound)
            ) {
              throw error;
            }
            leftOut.push({ kind: 'pictureLeftOut', detail: `#${binaryId}` });
          }
        }
        return placed;
      },
    });
    if (faults.length > 0) {
      throw new Error(faults.slice(0, 5).join('; '));
    }

    throwIfAborted(signal);
    onStage('batch.progress.stageWriting', 0, 1);
    await rpc.call('epub.write.commit', { token });
    token = null;
    onStage('batch.progress.stageWriting', 1, 1);

    // Format non-fatal summary warnings without any interactive prompt.
    const combined = [
      ...leftOut,
      ...summary.filter(
        (s) => s.kind !== 'pictureLeftOut' || !leftOut.some((l) => l.detail === s.detail),
      ),
    ];
    const counted = new Map<string, { kind: string; detail: string; count: number }>();
    for (const entry of combined) {
      const key = `${entry.kind}\u0000${entry.detail}`;
      const existing = counted.get(key);
      if (existing) existing.count++;
      else counted.set(key, { kind: entry.kind, detail: entry.detail, count: 1 });
    }
    const warnings = [...counted.values()].map(({ kind, detail, count }) => {
      const resolvedDetail = kind === 'gapFilled' ? ctx.t(`epub.gap.${detail}`) : detail;
      const line = ctx.t(`epub.summary.${kind}`, { detail: resolvedDetail });
      return count > 1 ? `${line} (\u00d7${count})` : line;
    });
    return { warnings };
  } catch (error) {
    if (token) {
      await rpc.call('epub.write.abort', { token }).catch(() => undefined);
    }
    if (isRpcError(error) && error.code === RpcErrorCode.epubWriteFailed) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'epub.ioError';
      throw new Error(
        ctx.t(`epub.writeFailed.${reason.replace(/^epub\./, '')}`, { path: targetPath }),
        { cause: error },
      );
    }
    throw error;
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
