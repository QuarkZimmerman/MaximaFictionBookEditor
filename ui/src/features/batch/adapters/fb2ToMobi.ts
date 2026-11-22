/**
 * Feature 019 (T031; FR-004, FR-005, FR-024): unattended FB2 -> MOBI / KF8 batch adapter.
 * Reuses Settings -> Exports -> MOBI defaults + batch `zipOutput` override and builds HTML/CSS/MFBE
 * off-thread in `mobiExportWorker.ts`.
 */

import { proposedStem } from '@/features/file/proposedName';
import { mobiWriteUrl } from '@/model/binaryUrls';
import { isRpcError } from '@/rpc/client';
import {
  RpcErrorCode,
  type MobiFormat,
  type MobiOpenAt,
  type MobiSeriesInTitle,
  type MobiTocPlacement,
} from '@/rpc/types';

import type { MobiExportWorkerRequest, MobiExportWorkerResult } from '../workers/mobiExportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  openEphemeralFb2,
  runCancellableRpcJob,
  throwIfAborted,
} from './fb2LoadSave';

async function uploadSlot(
  token: string,
  slot: 'mobi7-html' | 'kf8-html' | 'kf8-css' | 'mfbe',
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(mobiWriteUrl(token, slot), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new TextEncoder().encode(text),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `${slot}: HTTP ${response.status} ${await response.text().catch(() => '')}`.trim(),
    );
  }
}

export async function runFb2ToMobi(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, signal, onStage, cache } = params;
  const [{ usedMobiPictures }, { mobiWordsLanguage }] = await Promise.all([
    import('@/features/mobi/export/job'),
    import('@/features/mobi/shared/words'),
  ]);

  const mobiSettings = settings?.mobi;
  const format: MobiFormat = mobiSettings?.format ?? 'joint';
  const tocPlacement: MobiTocPlacement = mobiSettings?.tocPlacement ?? 'afterTitle';
  const seriesInTitle: MobiSeriesInTitle = mobiSettings?.seriesInTitle ?? 'seriesAndNumber';
  const openAt: MobiOpenAt = mobiSettings?.openAt ?? 'titlePage';
  const kf8PopupFootnotes: boolean = mobiSettings?.kf8PopupFootnotes ?? true;
  const zip = config.zipOutput;

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

    token = (
      await rpc.call('mobi.write.begin', {
        docId,
        path: targetPath,
        format,
        zip,
      })
    ).token;
    throwIfAborted(signal);

    const genresList = await cache.getGenres();
    const lang = mobiWordsLanguage(document.description.titleInfo.lang);
    const genreEntries: [string, string][] = genresList.map((entry) => [
      entry.code,
      entry.names[lang] ?? entry.names.en ?? entry.code,
    ]);

    const picList = usedMobiPictures(document);
    const placed: [
      string,
      { recindex: number; mediaType: 'image/jpeg' | 'image/png'; width: number; height: number },
    ][] = [];
    const picSummary: { kind: string; detail: string }[] = [];

    for (let i = 0; i < picList.length; i++) {
      throwIfAborted(signal);
      const pic = picList[i]!;
      onStage('batch.progress.stageConverting', i, picList.length + 4);
      try {
        const res = await rpc.call('mobi.write.picture', {
          token,
          docId,
          binaryId: pic.id,
          isCover: pic.isCover,
        });
        placed.push([
          pic.id,
          {
            recindex: res.recindex,
            mediaType: res.mediaType === 'image/png' ? 'image/png' : 'image/jpeg',
            width: res.width,
            height: res.height,
          },
        ]);
        if (res.converted) picSummary.push({ kind: 'pictureConverted', detail: `#${pic.id}` });
        if (res.downscaled) picSummary.push({ kind: 'pictureDownscaled', detail: `#${pic.id}` });
      } catch (error) {
        if (
          !isRpcError(error) ||
          (error.code !== RpcErrorCode.binaryNotImage && error.code !== RpcErrorCode.binaryNotFound)
        ) {
          throw error;
        }
        picSummary.push({ kind: 'pictureLeftOut', detail: `#${pic.id}` });
      }
    }

    throwIfAborted(signal);
    const workerReq: MobiExportWorkerRequest = {
      document,
      pictures: placed,
      fallbackTitle: proposedStem(document.description, ctx.t('app.untitled')),
      format,
      tocPlacement,
      seriesInTitle,
      openAt,
      kf8PopupFootnotes,
      genreNames: genreEntries,
    };
    const built = await runWorkerTask<MobiExportWorkerRequest, MobiExportWorkerResult>(
      () =>
        new Worker(new URL('../workers/mobiExportWorker.ts', import.meta.url), { type: 'module' }),
      workerReq,
      {
        signal,
        pool: { pool: cache.workerPool, key: 'mobiExport' },
        onProgress: (p) =>
          onStage('batch.progress.stageConverting', picList.length + p.done, picList.length + 4),
      },
    );

    throwIfAborted(signal);
    onStage('batch.progress.stageWriting', 0, 100);
    if (built.mobi7Html !== undefined) {
      await uploadSlot(token, 'mobi7-html', built.mobi7Html, signal);
    }
    if (built.kf8Html !== undefined) {
      await uploadSlot(token, 'kf8-html', built.kf8Html, signal);
      await uploadSlot(token, 'kf8-css', built.kf8Css ?? '', signal);
    }
    await uploadSlot(token, 'mfbe', built.mfbeJson, signal);
    throwIfAborted(signal);

    const commitToken = token;
    token = null; // consumed by mobi.write.commit
    const commitRes = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('mobi.write.commit', {
          token: commitToken,
          metadata: built.metadata,
          nav: built.nav,
          guide: built.guide,
          ...(zip ? { document } : {}),
        }),
      {
        signal,
        onProgress: (done, total) =>
          onStage('batch.progress.stageWriting', done, Math.max(total, 1)),
      },
    );

    const combined = [
      ...picSummary,
      ...built.summary.filter(
        (s) => s.kind !== 'pictureLeftOut' || !picSummary.some((p) => p.detail === s.detail),
      ),
      ...(commitRes.mfbeSkipped ? [{ kind: 'mfbeSkipped', detail: '' }] : []),
    ];
    const counted = new Map<string, { kind: string; detail: string; count: number }>();
    for (const entry of combined) {
      const key = `${entry.kind}\u0000${entry.detail}`;
      const existing = counted.get(key);
      if (existing) existing.count++;
      else counted.set(key, { kind: entry.kind, detail: entry.detail, count: 1 });
    }
    const warnings = [...counted.values()].map(({ kind, detail, count }) => {
      const resolvedDetail = kind === 'gapFilled' ? ctx.t(`mobi.gap.${detail}`) : detail;
      const line = ctx.t(`mobi.exportSummary.${kind}`, { detail: resolvedDetail });
      return count > 1 ? `${line} (\u00d7${count})` : line;
    });
    return { warnings };
  } catch (error) {
    if (token) {
      await rpc.call('mobi.write.abort', { token }).catch(() => undefined);
    }
    throw error;
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
