/**
 * Feature 019 (T034; FR-004, FR-005): unattended FB2 -> Markdown batch adapter.
 * Reuses `settings.markdown.includePictures` + batch `zipOutput` (`.md` vs `.md.zip`), recovers
 * embedded Mermaid/formula sources, serializes in `markdownExportWorker.ts`, and writes via
 * `export.markdown`.
 */

import { binaryOriginalUrl } from '@/model/binaryUrls';
import type { Document } from '@/model/document';

import type { MarkdownExportWorkerRequest } from '../workers/markdownExportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  openEphemeralFb2,
  runCancellableRpcJob,
  throwIfAborted,
} from './fb2LoadSave';

async function extractDiagramSources(
  document: Document,
  docId: string,
  signal: AbortSignal,
): Promise<[string, string][]> {
  const candidates = document.binaries.filter(
    (b) => /^mermaid-\d+$/.test(b.id) || /^formula-\d+$/.test(b.id),
  );
  if (candidates.length === 0) return [];
  const { diagramSource, FORMULA_KEYWORD, SOURCE_KEYWORD } =
    await import('@/features/markdown/diagrams/files');
  const sources: [string, string][] = [];
  for (const binary of candidates) {
    throwIfAborted(signal);
    const keyword = /^mermaid-\d+$/.test(binary.id) ? SOURCE_KEYWORD : FORMULA_KEYWORD;
    const url = binaryOriginalUrl(docId, `#${binary.id}`);
    if (!url) continue;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) continue;
      const source = diagramSource(new Uint8Array(await response.arrayBuffer()), keyword);
      if (source !== null) sources.push([binary.id, source]);
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return sources;
}

export async function runFb2ToMarkdown(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, signal, onStage } = params;

  let docId: string | null = null;
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

    const form: 'md' | 'zip' = config.zipOutput ? 'zip' : 'md';
    const includePictures = form === 'zip' ? true : (settings?.markdown?.includePictures ?? true);

    onStage('batch.progress.stageConverting', 0, 2);
    const diagramSources = await extractDiagramSources(document, docId, signal);
    throwIfAborted(signal);

    const serialized = await runWorkerTask<
      MarkdownExportWorkerRequest,
      {
        text: string;
        pictures: { binaryId: string; name: string }[];
        leftOut: { kind: string; id?: string; reason: string }[];
      }
    >(
      () =>
        new Worker(new URL('../workers/markdownExportWorker.ts', import.meta.url), {
          type: 'module',
        }),
      {
        document,
        form,
        includePictures,
        diagramSources: diagramSources.length > 0 ? diagramSources : undefined,
      },
      { signal },
    );
    throwIfAborted(signal);

    onStage('batch.progress.stageWriting', 0, 1);
    const result = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('export.markdown', {
          docId: docId!,
          path: targetPath,
          form,
          text: serialized.text,
          pictures: serialized.pictures,
          includePictures,
        }),
      {
        signal,
        onProgress: (done, total) =>
          onStage('batch.progress.stageWriting', done, Math.max(total, 1)),
      },
    );

    const warnings: string[] = [];
    for (const lo of serialized.leftOut) {
      warnings.push(lo.id ? `${lo.kind} (${lo.id}): ${lo.reason}` : `${lo.kind}: ${lo.reason}`);
    }
    for (const skippedPic of result.skipped ?? []) {
      warnings.push(ctx.t('pdf.summary.pictureLeftOut', { detail: skippedPic }));
    }
    return { warnings };
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
