/**
 * Feature 023 (T041; US5): unattended FB2 -> DOCX (bare or ZIP+FBD) batch adapter.
 * Reuses effective batch `settings.docx` + `config.zipOutput` and runs OOXML generation and
 * bundled parts upload off-thread in `docxExportWorker.ts`.
 */
import { resolveDocxSettings } from '@/features/docx/docxSettingsSchema';
import type { StagedDocxPicture } from '@/features/docx/export/docxDocumentBuilder';
import { proposedStem } from '@/features/file/proposedName';
import { batchDocUrl, docxWritePartsUrl } from '@/model/binaryUrls';

import type { DocxExportWorkerRequest, DocxExportWorkerResult } from '../workers/docxExportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  openEphemeralFb2Headless,
  runCancellableRpcJob,
  throwIfAborted,
} from './fb2LoadSave';

function toAbsoluteUrl(relativeOrAbsolute: string): string {
  return new URL(relativeOrAbsolute, window.location.href).href;
}

const createDocxExportWorker = () =>
  new Worker(new URL('../workers/docxExportWorker.ts', import.meta.url), { type: 'module' });

export async function runFb2ToDocx(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, signal, onStage, cache } = params;
  const { docxWordsLanguage } = await import('@/features/docx/shared/docxWords');

  const resolvedSettings = resolveDocxSettings(settings?.docx);
  const zip = config.zipOutput;

  let docId: string | null = null;
  let token: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const opened = await openEphemeralFb2Headless(rpc, item.sourcePath, item.archiveEntry, {
      fixBroken: config.fixBroken,
      t: ctx.t,
      signal,
      onProgress: (done, total) =>
        onStage('batch.progress.stageReading', done, Math.max(total, 100)),
    });
    docId = opened.docId;
    throwIfAborted(signal);

    const [begun, genresList] = await Promise.all([
      rpc.call('docx.write.begin', {
        docId,
        path: targetPath,
        zip,
      }),
      cache.getGenres(),
    ]);
    token = begun.token;
    throwIfAborted(signal);

    const activeToken = token;
    const activeDocId = docId;
    const lang = docxWordsLanguage(opened.description.titleInfo.lang);
    const genreEntries: [string, string][] = genresList.map((entry) => [
      entry.code,
      entry.names[lang] ?? entry.names.en ?? entry.code,
    ]);

    const picSummary: { kind: string; detail: string; count?: number }[] = [];

    const workerReq: DocxExportWorkerRequest = {
      documentUrl: toAbsoluteUrl(batchDocUrl(activeDocId)),
      needsPicturePlacement: opened.binaryCount > 0,
      settings: { ...resolvedSettings, zip },
      fallbackTitle: proposedStem(opened.description, ctx.t('app.untitled')),
      appVersion: ctx.version || '0.0.16',
      genreNames: genreEntries,
      uploadPartsUrl: toAbsoluteUrl(docxWritePartsUrl(activeToken)),
    };

    const built = await runWorkerTask<DocxExportWorkerRequest, DocxExportWorkerResult>(
      createDocxExportWorker,
      workerReq,
      {
        signal,
        pool: { pool: cache.workerPool, key: 'docxExport' },
        onProgress: (p) => onStage('batch.progress.stageConverting', p.done, Math.max(p.total, 4)),
        onRequest: async (payload) => {
          const picList = payload as { id: string; isCover: boolean }[];
          const placed: [string, StagedDocxPicture][] = [];
          for (let i = 0; i < picList.length; i++) {
            throwIfAborted(signal);
            const pic = picList[i]!;
            onStage('batch.progress.stageConverting', i, picList.length + 4);
            const res = await rpc.call('docx.write.picture', {
              token: activeToken,
              binaryId: pic.id,
              mediaName: `word/media/image${i + 1}.jpg`,
            });
            if ('missing' in res || 'unreadable' in res) {
              picSummary.push({ kind: 'missingPicture', detail: `#${pic.id}` });
            } else {
              placed.push([
                pic.id,
                {
                  binaryId: pic.id,
                  mediaName: res.mediaName,
                  contentType: res.contentType,
                  width: res.width,
                  height: res.height,
                  bytes: res.bytes,
                  sha256: res.sha256,
                  converted: res.converted,
                },
              ]);
            }
          }
          return placed;
        },
      },
    );

    throwIfAborted(signal);
    onStage('batch.progress.stageWriting', 0, 100);
    const commitToken = token;
    token = null; // consumed by commit
    await runCancellableRpcJob(rpc, () => rpc.call('docx.write.commit', { token: commitToken }), {
      signal,
      onProgress: (done, total) => onStage('batch.progress.stageWriting', done, Math.max(total, 1)),
    });

    const combined = [
      ...picSummary,
      ...built.summary.filter(
        (s) => s.kind !== 'missingPicture' || !picSummary.some((p) => p.detail === s.detail),
      ),
    ];
    const counted = new Map<string, { kind: string; detail: string; count: number }>();
    for (const entry of combined) {
      const key = `${entry.kind}\u0000${entry.detail}`;
      const existing = counted.get(key);
      if (existing) existing.count += entry.count ?? 1;
      else counted.set(key, { kind: entry.kind, detail: entry.detail, count: entry.count ?? 1 });
    }
    const warnings = [...counted.values()].map(({ kind, detail, count }) => {
      const line = ctx.t(`docx.exportSummary.${kind}`, { detail });
      return count > 1 && kind !== 'strippedControlChars' ? `${line} (\u00d7${count})` : line;
    });
    return { warnings, ...(opened.repairedReason ? { fixedReason: opened.repairedReason } : {}) };
  } catch (error) {
    if (token) {
      await rpc.call('docx.write.abort', { token }).catch(() => undefined);
    }
    throw error;
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
