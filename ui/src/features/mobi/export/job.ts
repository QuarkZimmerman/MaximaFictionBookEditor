/**
 * Feature 018 (T022, contracts/rpc-api.md §2, contracts/mobi-export.md): lazy MOBI / KF8 export
 * orchestrator. Lives inside the `mobi-export` lazy chunk — loaded only when the user exports.
 */
import type { CommandContext } from '@/app/commands';
import { proposedStem } from '@/features/file/proposedName';
import { mobiWriteUrl } from '@/model/binaryUrls';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { MobiExportRun } from '../exportCommand';
import { mobiWordsLanguage } from '../shared/words';
import { buildKf8 } from './kf8';
import {
  buildExportPlan,
  buildMfbeRoundTripRecord,
  type MobiExportSummaryItem,
  type PlacedMobiPicture,
} from './metadata';
import { buildMobi7 } from './mobi7';

class Cancelled extends Error {}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Collects referenced binary IDs in document order (cover first, then annotation and bodies). */
export function usedMobiPictures(document: Document): { id: string; isCover: boolean }[] {
  const result: { id: string; isCover: boolean }[] = [];
  const seen = new Set<string>();
  const known = new Set(document.binaries.map((b) => b.id));

  const add = (href: string | undefined, isCover: boolean): void => {
    if (!href?.startsWith('#')) return;
    const id = href.slice(1);
    if (!known.has(id) || seen.has(id)) return;
    seen.add(id);
    result.push({ id, isCover });
  };

  add(document.description.titleInfo.coverpage[0]?.href, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (node.type === 'image' || node.type === 'inline-image') add(node.attrs?.href, false);
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  if (document.description.titleInfo.annotation) visit(document.description.titleInfo.annotation);
  for (const body of document.bodies) visit(body);
  return result;
}

async function uploadSlot(
  token: string,
  slot: 'mobi7-html' | 'kf8-html' | 'kf8-css' | 'mfbe',
  text: string,
): Promise<void> {
  const response = await fetch(mobiWriteUrl(token, slot), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new TextEncoder().encode(text),
  });
  if (!response.ok) {
    throw new Error(
      `${slot}: HTTP ${response.status} ${await response.text().catch(() => '')}`.trim(),
    );
  }
}

function formatSummaryLines(
  ctx: CommandContext,
  items: readonly MobiExportSummaryItem[],
): string[] {
  const counted = new Map<string, { item: MobiExportSummaryItem; count: number }>();
  for (const item of items) {
    const key = `${item.kind}\u0000${item.detail}`;
    const existing = counted.get(key);
    if (existing) existing.count++;
    else counted.set(key, { item, count: 1 });
  }
  const lines = [...counted.values()].map(({ item, count }) => {
    const detail = item.kind === 'gapFilled' ? ctx.t(`mobi.gap.${item.detail}`) : item.detail;
    const line = ctx.t(`mobi.exportSummary.${item.kind}`, { detail });
    return count > 1 ? `${line} (\u00d7${count})` : line;
  });
  const shown = lines.slice(0, 40).map((l) => `\u2022 ${l}`);
  if (lines.length > 40) shown.push(ctx.t('mobi.summaryMore', { count: lines.length - 40 }));
  return shown;
}

export async function exportMobi(
  ctx: CommandContext,
  docId: string,
  run: MobiExportRun,
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
      await rpc.call('mobi.write.begin', {
        docId,
        path: run.path,
        format: run.format,
        zip: run.zip,
      })
    ).token;

    const genres = await rpc
      .call('resources.genres')
      .then((list) => {
        const lang = mobiWordsLanguage(document.description.titleInfo.lang);
        return new Map(
          list.entries.map((entry) => [
            entry.code,
            entry.names[lang] ?? entry.names.en ?? entry.code,
          ]),
        );
      })
      .catch(() => undefined);

    const picList = usedMobiPictures(document);
    const totalSteps = picList.length + 5;
    let done = 0;
    const placed = new Map<string, PlacedMobiPicture>();
    const picSummary: MobiExportSummaryItem[] = [];

    for (const pic of picList) {
      if (run.cancelled()) throw new Cancelled();
      try {
        const res = await rpc.call('mobi.write.picture', {
          token,
          docId,
          binaryId: pic.id,
          isCover: pic.isCover,
        });
        placed.set(pic.id, {
          recindex: res.recindex,
          mediaType: res.mediaType,
          width: res.width,
          height: res.height,
        });
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
      run.modal.progress(++done, totalSteps);
    }

    if (run.cancelled()) throw new Cancelled();
    await nextTask();

    const buildOpts = {
      document,
      pictures: placed,
      fallbackTitle: proposedStem(document.description, ctx.t('app.untitled')),
      tocPlacement: run.tocPlacement,
      seriesInTitle: run.seriesInTitle,
      openAt: run.openAt,
      kf8PopupFootnotes: run.kf8PopupFootnotes,
      genreNames: genres,
    };
    const plan = buildExportPlan(buildOpts);

    let mobi7Result = null;
    let kf8Result = null;
    if (run.format === 'mobi7' || run.format === 'joint') {
      mobi7Result = buildMobi7(buildOpts, plan);
    }
    if (run.format === 'kf8' || run.format === 'joint') {
      kf8Result = buildKf8(buildOpts, plan);
    }
    const mfbe = buildMfbeRoundTripRecord(document, placed, plan.attrs);

    run.modal.progress(++done, totalSteps);
    await nextTask();
    if (run.cancelled()) throw new Cancelled();

    if (mobi7Result) await uploadSlot(token, 'mobi7-html', mobi7Result.html);
    if (kf8Result) {
      await uploadSlot(token, 'kf8-html', kf8Result.html);
      await uploadSlot(token, 'kf8-css', kf8Result.css);
    }
    await uploadSlot(token, 'mfbe', JSON.stringify(mfbe));
    run.modal.progress(++done, totalSteps);

    if (run.cancelled()) throw new Cancelled();

    const activeNav = kf8Result ? kf8Result.nav : mobi7Result!.nav;
    const activeGuide = kf8Result ? kf8Result.guide : mobi7Result!.guide;
    const activeCounts = kf8Result ? kf8Result.counts : mobi7Result!.counts;

    const commitToken = token;
    token = null; // consumed by commit
    const cancelJob = (): void => {
      if (activeJobId) {
        void rpc.call('job.cancel', { jobId: activeJobId }).catch(() => undefined);
      }
    };
    const commitRes = await rpc.runJob(
      'mobi.write.commit',
      {
        token: commitToken,
        metadata: plan.metadata,
        nav: activeNav,
        guide: activeGuide,
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
          run.modal.progress(done + Math.round(frac * 2), totalSteps);
        },
      },
    );
    activeJobId = null;

    run.modal.progress(totalSteps, totalSteps);
    run.modal.end();

    const summary: MobiExportSummaryItem[] = [
      ...picSummary,
      ...plan.summary.filter(
        (item) =>
          item.kind !== 'pictureLeftOut' || !picSummary.some((p) => p.detail === item.detail),
      ),
    ];
    if (commitRes.mfbeSkipped) {
      summary.push({ kind: 'mfbeSkipped', detail: '' });
    }

    const doneMessage = ctx.t('mobi.exportDone', {
      path: commitRes.path,
      sections: activeCounts.sections,
      pictures: activeCounts.pictures,
      tables: activeCounts.tables,
      notes: activeCounts.notes,
    });
    if (summary.length === 0) {
      actions.setStatusMessage(store, doneMessage);
    } else {
      await ctx.dialogs.showMessage({
        text: `${doneMessage}\n\n${ctx.t('mobi.exportSummaryIntro')}\n${formatSummaryLines(ctx, summary).join('\n')}`,
        caption: ctx.t('mobi.exportCaption'),
        icon: 'info',
        testId: 'dialog-mobi-export-summary',
      });
    }
    return true;
  } catch (error) {
    run.modal.end();
    if (activeJobId) {
      await rpc.call('job.cancel', { jobId: activeJobId }).catch(() => undefined);
    }
    if (token) {
      await rpc.call('mobi.write.abort', { token }).catch(() => undefined);
    }
    if (
      run.cancelled() ||
      error instanceof Cancelled ||
      (isRpcError(error) && error.code === RpcErrorCode.cancelled)
    ) {
      actions.setStatusMessage(store, ctx.t('mobi.exportCancelled'));
      return false;
    }
    let detail = error instanceof Error ? error.message : String(error);
    if (isRpcError(error) && error.code === RpcErrorCode.mobiWriteFailed) {
      const data = error.data as { reason?: string; detail?: string } | undefined;
      const reason = data?.reason ?? 'ioError';
      detail = ctx.t(`mobi.writeFailed.${reason}`, {
        path: run.path,
        detail: data?.detail ?? '',
      });
    } else if (isRpcError(error) && error.code === RpcErrorCode.docSameAsOpenFile) {
      detail = ctx.t('mobi.writeFailed.targetIsSource', { path: run.path });
    }
    await ctx.dialogs.showMessage({
      text: ctx.t('mobi.exportFailed', { path: run.path, detail }),
      caption: ctx.t('mobi.exportCaption'),
      icon: 'error',
      testId: 'dialog-mobi-export-failed',
    });
    return false;
  }
}
