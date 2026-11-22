/**
 * Feature 019 (T032; FR-004, FR-005, contracts/rpc-api.md §2.5): unattended FB2 -> PDF batch
 * adapter. Paginates using the ephemeral docId, serializes CEF PrintService access through the
 * 1-permit `cache.pdfPrintLock` semaphore, and passes `cancelPrint: false` on isolated
 * non-printing failures so another book's active print job is never disrupted.
 */

import { pdfPageSize } from '@/features/pdf/pageSizes';
import { pdfPartUrl } from '@/model/binaryUrls';
import type { PdfPageSizeId } from '@/rpc/types';

import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  openEphemeralFb2,
  runCancellableRpcJob,
  throwIfAborted,
} from './fb2LoadSave';

async function uploadPdfPart(
  token: string,
  part: number,
  html: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(pdfPartUrl(token, part), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: new TextEncoder().encode(html),
    signal,
  });
  if (!response.ok) {
    throw new Error(`part ${part}: HTTP ${response.status}`);
  }
}

export async function runFb2ToPdf(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, outputStem, signal, onStage, cache } =
    params;
  const [{ paginate }, { wordsLanguage }] = await Promise.all([
    import('@/features/pdf/export/paginator'),
    import('@/features/pdf/export/words'),
  ]);

  const pageSizeId: PdfPageSizeId = settings?.pdf?.defaultPageSize ?? 'a4';
  const size = pdfPageSize(pageSizeId);
  const zip = config.zipOutput;

  let docId: string | null = null;
  let token: string | null = null;
  let ownsPrint = false;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const opened = await openEphemeralFb2(rpc, item.sourcePath, item.archiveEntry, {
      signal,
      onProgress: (done, total) => onStage('batch.progress.stageReading', done, Math.max(total, 100)),
    });
    docId = opened.docId;
    const { document } = opened;
    throwIfAborted(signal);

    const begun = await rpc.call('pdf.export.begin', {
      path: targetPath,
      pageSize: pageSizeId,
      docId,
      zip,
    });
    token = begun.token;
    throwIfAborted(signal);

    const textFont = settings?.pdf?.textFont ?? 'noto-serif';
    const addedFonts = /^[0-9a-f]{64}(-\d+)?$/.test(textFont)
      ? await cache.getPdfAddedFonts()
      : [];
    const added = addedFonts.find((f) => f.id === textFont);

    onStage('batch.progress.stageConverting', 0, 100);
    const paged = await paginate(ctx, document, {
      docId,
      pageSize: size,
      settings: settings?.pdf,
      addedFont: added ? { id: added.id, kind: added.kind } : undefined,
      cancelled: () => signal.aborted,
      limits: begun.limits,
      progress: (done, total) => onStage('batch.progress.stageConverting', done, Math.max(total, 1)),
    });
    throwIfAborted(signal);

    const parts = paged.parts.length;
    await rpc.call('pdf.export.document', { token, parts });
    for (let part = 0; part < parts; part++) {
      throwIfAborted(signal);
      onStage('batch.progress.stageWriting', part, parts * 2 + 2);
      await uploadPdfPart(token, part, paged.parts[part]!, signal);
    }

    // Serialize PrintService calls across parallel workers (contracts/rpc-api.md §2.5).
    const releasePrint = await cache.pdfPrintLock.acquire(signal);
    try {
      ownsPrint = true;
      for (let part = 0; part < parts; part++) {
        throwIfAborted(signal);
        onStage('batch.progress.stageWriting', parts + part, parts * 2 + 2);
        await runCancellableRpcJob(
          rpc,
          () => rpc.call('pdf.export.print', { token: token!, part }),
          { signal },
        );
      }
    } finally {
      ownsPrint = false;
      releasePrint();
    }

    throwIfAborted(signal);
    if (zip && begun.fbdPath) {
      await runCancellableRpcJob(
        rpc,
        () =>
          rpc.call('doc.exportDescription', {
            docId: docId!,
            document,
            path: begun.fbdPath!,
            force: true,
          }),
        { signal },
      );
    }

    const titleInfo = document.description.titleInfo;
    const fileTitle = outputStem;
    const genresList = await cache.getGenres();
    const language = wordsLanguage(titleInfo.lang);
    const genreMap = new Map(
      genresList.map((entry) => [entry.code, entry.names[language] ?? entry.names.en ?? entry.code]),
    );

    const finishToken = token;
    const finished = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('pdf.export.finish', {
          token: finishToken,
          pageMap: paged.pageMap,
          title: titleInfo.bookTitle?.trim() || fileTitle,
          description: document.description,
          genreNames: titleInfo.genres.map((g) => genreMap.get(g.code) ?? g.code),
          hints: paged.hints,
        }),
      {
        signal,
        onProgress: (done, total) => onStage('batch.progress.stageWriting', done, Math.max(total, 1)),
      },
    );
    token = null;
    onStage('batch.progress.stageWriting', 1, 1);

    const warnings: string[] = [
      ...[...paged.leftOut, ...(finished.picturesLeftOut ?? []).map((id) => `#${id}`)].map(
        (detail) => ctx.t('pdf.summary.pictureLeftOut', { detail }),
      ),
      ...paged.replacedFonts.map((detail) => ctx.t('pdf.summary.fontReplaced', { detail })),
      ...paged.linksAsText.map((detail) => ctx.t('pdf.summary.linkAsText', { detail })),
      ...paged.idsTwice.map((detail) => ctx.t('pdf.summary.idTwice', { detail })),
      ...paged.rawParts.map((detail) => ctx.t('pdf.summary.rawPart', { detail })),
      ...(titleInfo.bookTitle?.trim()
        ? []
        : [ctx.t('pdf.summary.noTitle', { detail: fileTitle })]),
      ...(titleInfo.lang?.trim() ? [] : [ctx.t('pdf.summary.noLanguage')]),
      ...(finished.fallback
        ? [
            ctx.t('pdf.summary.addedFontFallback', {
              font: finished.fallbackFont ?? '',
              detail: [...finished.fallback].join(' '),
            }),
          ]
        : []),
      ...(finished.uncovered
        ? [ctx.t('pdf.summary.systemFont', { detail: [...finished.uncovered].join(' ') })]
        : []),
    ];
    return { warnings };
  } catch (error) {
    if (token) {
      // Only cancel pending PrintService jobs if this worker owned the active print slot or the
      // entire batch run was cancelled (contracts/rpc-api.md §2.5).
      await rpc
        .call('pdf.export.abort', { token, cancelPrint: ownsPrint || signal.aborted })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
