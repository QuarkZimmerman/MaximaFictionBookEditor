/**
 * Feature 019 (T030; FR-004, FR-005, FR-024): unattended FB2 -> EPUB batch adapter.
 * Uses dynamic imports so `batch-converter` never statically depends on `epub-export` or `epub-shared`.
 */

import { proposedStem } from '@/features/file/proposedName';
import { epubWriteUrl } from '@/model/binaryUrls';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { EpubExportWorkerRequest, EpubExportWorkerResult } from '../workers/epubExportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import { closeEphemeralDoc, openEphemeralFb2, throwIfAborted } from './fb2LoadSave';

async function uploadEpubFile(
  token: string,
  name: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(epubWriteUrl(token, name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new TextEncoder().encode(text),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `${name}: ${response.status} ${response.headers.get('X-MFBE-Reason') ?? ''}`.trim(),
    );
  }
}

export async function runFb2ToEpub(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, item, targetPath, signal, onStage, cache } = params;
  const [{ usedPictures }, { NameAllocator }, { wordsLanguage }] = await Promise.all([
    import('@/features/epub/export/job'),
    import('@/features/epub/shared/names'),
    import('@/features/epub/shared/words'),
  ]);

  let docId: string | null = null;
  let token: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const opened = await openEphemeralFb2(rpc, item.sourcePath, item.archiveEntry, {
      signal,
      onProgress: (done, total) =>
        onStage('batch.progress.stageReading', done, Math.max(total, 100)),
    });
    docId = opened.docId;
    const { document } = opened;
    throwIfAborted(signal);

    token = (await rpc.call('epub.write.begin', { path: targetPath, docId })).token;
    throwIfAborted(signal);

    const genresList = await cache.getGenres();
    const language = wordsLanguage(document.description.titleInfo.lang);
    const genreEntries: [string, string][] = genresList.map((entry) => [
      entry.code,
      entry.names[language] ?? entry.names.en ?? entry.code,
    ]);

    const pictures = usedPictures(document);
    const names = new NameAllocator();
    const placed: [string, { name: string; mediaType: string }][] = [];
    const leftOut: { kind: string; detail: string }[] = [];

    for (let i = 0; i < pictures.length; i++) {
      throwIfAborted(signal);
      const binaryId = pictures[i]!;
      onStage('batch.progress.stageConverting', i, pictures.length + 2);
      try {
        const res = await rpc.call('epub.write.binary', {
          token,
          stem: names.allocate('EPUB/images/', binaryId, ''),
          docId,
          binaryId,
        });
        placed.push([binaryId, { name: res.name, mediaType: res.mediaType }]);
      } catch (error) {
        if (
          !isRpcError(error) ||
          (error.code !== RpcErrorCode.binaryNotImage && error.code !== RpcErrorCode.binaryNotFound)
        ) {
          throw error;
        }
        leftOut.push({ kind: 'pictureLeftOut', detail: `#${binaryId}` });
      }
    }

    throwIfAborted(signal);
    onStage('batch.progress.stageConverting', pictures.length, pictures.length + 2);

    const workerReq: EpubExportWorkerRequest = {
      document,
      pictures: placed,
      fallbackTitle: proposedStem(document.description, ctx.t('app.untitled')),
      genreNames: genreEntries,
    };
    const { built, faults } = await runWorkerTask<EpubExportWorkerRequest, EpubExportWorkerResult>(
      () =>
        new Worker(new URL('../workers/epubExportWorker.ts', import.meta.url), { type: 'module' }),
      workerReq,
      {
        signal,
        onProgress: (p) =>
          onStage('batch.progress.stageConverting', pictures.length + p.done, pictures.length + 2),
      },
    );
    if (faults.length > 0) {
      throw new Error(faults.slice(0, 5).join('; '));
    }

    const totalUpload = built.files.length + 1;
    for (let i = 0; i < built.files.length; i++) {
      throwIfAborted(signal);
      const file = built.files[i]!;
      onStage('batch.progress.stageWriting', i, totalUpload);
      await uploadEpubFile(token, file.name, file.text, signal);
    }

    throwIfAborted(signal);
    onStage('batch.progress.stageWriting', built.files.length, totalUpload);
    await rpc.call('epub.write.commit', { token });
    token = null;
    onStage('batch.progress.stageWriting', totalUpload, totalUpload);

    // Format non-fatal summary warnings without any interactive prompt.
    const combined = [
      ...leftOut,
      ...built.summary.filter(
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
