/**
 * Feature 023 (T019; contracts/rpc-api.md §3): lazy DOCX export orchestrator.
 * Lives inside the `docx-export` lazy chunk — loaded only when the user initiates DOCX export.
 */
import type { CommandContext } from '@/app/commands';
import { proposedStem } from '@/features/file/proposedName';
import { docxWritePartsUrl } from '@/model/binaryUrls';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { DocxExportRun } from '../exportCommand';
import type { DocxSummaryItem } from '../shared/docxRoundtripTypes';
import { docxWordsLanguage } from '../shared/docxWords';
import {
  buildDocxPackage,
  collectDocxPictures,
  type StagedDocxPicture,
} from './docxDocumentBuilder';

class Cancelled extends Error {}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function formatSummaryLines(ctx: CommandContext, items: readonly DocxSummaryItem[]): string[] {
  const counted = new Map<string, { item: DocxSummaryItem; count: number }>();
  for (const item of items) {
    const key = `${item.kind}\u0000${item.detail}`;
    const existing = counted.get(key);
    if (existing) existing.count += item.count ?? 1;
    else counted.set(key, { item, count: item.count ?? 1 });
  }
  const lines = [...counted.values()].map(({ item, count }) => {
    const line = ctx.t(`docx.exportSummary.${item.kind}`, { detail: item.detail });
    return count > 1 && item.kind !== 'strippedControlChars' ? `${line} (\u00d7${count})` : line;
  });
  const shown = lines.slice(0, 40).map((l) => `\u2022 ${l}`);
  if (lines.length > 40) shown.push(ctx.t('docx.summaryMore', { count: lines.length - 40 }));
  return shown;
}

export async function exportDocx(
  ctx: CommandContext,
  docId: string,
  run: DocxExportRun,
): Promise<boolean> {
  const { store, rpc } = ctx;
  const current = store.getState();
  if (!rpc || !current.document || current.docId !== docId) {
    run.modal.end();
    return false;
  }
  const document = current.document;
  let token: string | null = null;
  let activeJobId: string | null = null;

  try {
    token = (
      await rpc.call('docx.write.begin', {
        docId,
        path: run.path,
        zip: run.zip,
      })
    ).token;

    const genres = await rpc
      .call('resources.genres')
      .then((list) => {
        const lang = docxWordsLanguage(document.description.titleInfo.lang);
        return new Map(
          list.entries.map((entry) => [
            entry.code,
            entry.names[lang] ?? entry.names.en ?? entry.code,
          ]),
        );
      })
      .catch(() => undefined);

    const picList = collectDocxPictures(document);
    const COMMIT_SPAN = 35;
    const totalSteps = picList.length + 4 + COMMIT_SPAN;
    let done = 0;

    const placed = new Map<string, StagedDocxPicture>();
    const picSummary: DocxSummaryItem[] = [];

    for (let i = 0; i < picList.length; i++) {
      if (run.cancelled()) throw new Cancelled();
      const pic = picList[i]!;
      const res = await rpc.call('docx.write.picture', {
        token,
        binaryId: pic.id,
        mediaName: `word/media/image${i + 1}.jpg`,
      });
      if ('missing' in res || 'unreadable' in res) {
        picSummary.push({ kind: 'missingPicture', detail: `#${pic.id}` });
      } else {
        placed.set(pic.id, {
          binaryId: pic.id,
          mediaName: res.mediaName,
          contentType: res.contentType,
          width: res.width,
          height: res.height,
          bytes: res.bytes,
          sha256: res.sha256,
          converted: res.converted,
        });
      }
      run.modal.progress(++done, totalSteps);
    }

    if (run.cancelled()) throw new Cancelled();
    run.modal.progress(++done, totalSteps);
    await nextTask();

    const built = await buildDocxPackage({
      document,
      pictures: placed,
      settings: run.settings,
      fallbackTitle: proposedStem(document.description, ctx.t('app.untitled')),
      appVersion: ctx.version || '0.0.16',
      genreNames: genres,
    });

    if (run.cancelled()) throw new Cancelled();
    run.modal.progress(++done, totalSteps);
    await nextTask();

    const uploadResp = await fetch(docxWritePartsUrl(token), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(built.parts),
    });
    if (!uploadResp.ok) {
      throw new Error(
        `parts upload failed: HTTP ${uploadResp.status} ${await uploadResp.text().catch(() => '')}`.trim(),
      );
    }
    run.modal.progress(++done, totalSteps);
    await nextTask();

    if (run.cancelled()) throw new Cancelled();

    const commitToken = token;
    token = null; // consumed by commit
    const cancelJob = (): void => {
      if (activeJobId) {
        void rpc.call('job.cancel', { jobId: activeJobId }).catch(() => undefined);
      }
    };

    const commitRes = await rpc.runJob(
      'docx.write.commit',
      {
        token: commitToken,
        ...(run.zip ? { document } : {}),
      },
      {
        onStart: (jobId) => {
          activeJobId = jobId;
          if (run.cancelled()) cancelJob();
        },
        onProgress: (p) => {
          if (run.cancelled()) cancelJob();
          const frac = p.total > 0 ? p.done / p.total : 0.5;
          run.modal.progress(
            Math.min(done + Math.round(frac * COMMIT_SPAN), totalSteps),
            totalSteps,
          );
        },
      },
    );
    activeJobId = null;

    run.modal.progress(totalSteps, totalSteps);
    run.modal.end();

    const summary: DocxSummaryItem[] = [
      ...picSummary,
      ...built.summary.filter(
        (item) =>
          item.kind !== 'missingPicture' || !picSummary.some((p) => p.detail === item.detail),
      ),
    ];

    const doneMessage = ctx.t('docx.exportDone', {
      path: commitRes.path,
      sections: built.counts.sections,
      pictures: built.counts.pictures,
      tables: built.counts.tables,
      notes: built.counts.notes,
    });
    if (summary.length === 0) {
      actions.setStatusMessage(store, doneMessage);
    } else {
      await ctx.dialogs.showMessage({
        text: `${doneMessage}\n\n${ctx.t('docx.exportSummaryIntro')}\n${formatSummaryLines(ctx, summary).join('\n')}`,
        caption: ctx.t('docx.exportCaption'),
        icon: 'info',
        testId: 'dialog-docx-export-summary',
      });
    }
    return true;
  } catch (error) {
    run.modal.end();
    if (activeJobId) {
      await rpc.call('job.cancel', { jobId: activeJobId }).catch(() => undefined);
    }
    if (token) {
      await rpc.call('docx.write.abort', { token }).catch(() => undefined);
    }
    if (
      run.cancelled() ||
      error instanceof Cancelled ||
      (isRpcError(error) && error.code === RpcErrorCode.cancelled)
    ) {
      actions.setStatusMessage(store, ctx.t('docx.exportCancelled'));
      return false;
    }

    let detail = error instanceof Error ? error.message : String(error);
    if (isRpcError(error) && error.code === RpcErrorCode.docxWriteFailed) {
      const data = error.data as { reason?: string; detail?: string } | undefined;
      const reason = data?.reason ?? 'ioError';
      detail = ctx.t(`docx.writeFailed.${reason}`, {
        path: run.path,
        detail: data?.detail ?? '',
      });
    } else if (isRpcError(error) && error.code === RpcErrorCode.docxUnknownToken) {
      detail = ctx.t('docx.writeFailed.unknownToken');
    } else if (isRpcError(error) && error.code === RpcErrorCode.docSameAsOpenFile) {
      detail = ctx.t('docx.writeFailed.targetIsSource', { path: run.path });
    }
    await ctx.dialogs.showMessage({
      text: ctx.t('docx.exportFailed', { path: run.path, detail }),
      caption: ctx.t('docx.exportCaption'),
      icon: 'error',
      testId: 'dialog-docx-export-failed',
    });
    return false;
  }
}
