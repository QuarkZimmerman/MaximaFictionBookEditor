/**
 * Feature 014 (D4, D23; plan PD1, research R1, R7): the PDF export's job, the first module of the
 * lazy chunk `pdf-export`. The command chose the file and the page size and started the progress
 * (../index.ts); this part:
 * 1. lays the book out in pages (paginator.ts on Preview's look, document.ts);
 * 2. uploads each part of the paged document (`PUT /pdf/{token}/part/{n}`);
 * 3. has the core print each part (`pdf.export.print`, the shell's hidden browser or the journeys'
 *    seam);
 * 4. has the core finish and write the file (`pdf.export.finish`, with the page map).
 *
 * It is modal, with progress and *Cancel*, and leaves no trace but the file (D4, D25): nothing of
 * the book changes and no setting is written.
 */
import type { CommandContext } from '@/app/commands';
import { pdfPartUrl } from '@/model/binaryUrls';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { PdfRun } from '../index';
import { pdfPageSize } from '../pageSizes';
import { paginate } from './paginator';
import { wordsLanguage } from './words';

class Cancelled extends Error {}

async function put(token: string, part: number, html: string): Promise<void> {
  const response = await fetch(pdfPartUrl(token, part), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: new TextEncoder().encode(html),
  });
  if (!response.ok) throw new Error(`part ${part}: ${response.status}`);
}

/** The export of the book `docId` under `run`; resolves true once the file is written. */
export async function exportPdf(ctx: CommandContext, docId: string, run: PdfRun): Promise<boolean> {
  const { store, rpc } = ctx;
  const { path, modal } = run;
  const current = store.getState();
  if (!rpc || !current.document || current.docId !== docId) {
    modal.end();
    return false;
  }
  let token: string | null = null;
  try {
    token = (await rpc.call('pdf.export.begin', { path, pageSize: run.pageSize, docId })).token;
    const size = pdfPageSize(run.pageSize);
    const paged = await paginate(ctx, current.document, {
      pageSize: size,
      settings: current.settings?.pdf,
      cancelled: run.cancelled,
      progress: (done, total) => modal.progress(done, total * 3),
    });
    if (run.cancelled()) throw new Cancelled();
    const parts = paged.parts.length;
    // Paginate, upload and print each part, then the core's three steps: join, write, check.
    const total = parts * 3 + 3;
    let done = parts;
    await rpc.call('pdf.export.document', { token, parts });
    for (let part = 0; part < parts; part++) {
      if (run.cancelled()) throw new Cancelled();
      await put(token, part, paged.parts[part]);
      modal.progress(++done, total);
    }
    for (let part = 0; part < parts; part++) {
      if (run.cancelled()) throw new Cancelled();
      await rpc.runJob('pdf.export.print', { token, part });
      modal.progress(++done, total);
    }
    if (run.cancelled()) throw new Cancelled();
    const base = done;
    // D14: the genres by name in the book's language, as the EPUB export names them (012 D6).
    const titleInfo = current.document.description.titleInfo;
    const language = wordsLanguage(titleInfo.lang);
    const named = await rpc
      .call('resources.genres')
      .then(
        (list) =>
          new Map(
            list.entries.map((entry) => [
              entry.code,
              entry.names[language] ?? entry.names.en ?? entry.code,
            ]),
          ),
      )
      .catch(() => new Map<string, string>());
    const finished = await rpc.runJob(
      'pdf.export.finish',
      {
        token,
        pageMap: paged.pageMap,
        title: titleInfo.bookTitle ?? '',
        // D14-D16: the description as the window has it; the core writes it into the metadata.
        description: current.document.description,
        genreNames: titleInfo.genres.map((genre) => named.get(genre.code) ?? genre.code),
        hints: paged.hints,
      },
      {
        // SC-010: the bar moves at least once a second; the writing, which the core does in one
        // go, shows as busy.
        onProgress: ({ phase, done: stepDone, total: stepTotal }) => {
          if (stepTotal <= 0) modal.progress(0, 0);
          else modal.progress(base + (phase === 'check' ? 2 : 0) + stepDone / stepTotal, total);
        },
      },
    );
    token = null;
    modal.progress(total, total);
    modal.end();
    const counts = ctx.t('pdf.exportDone', {
      path,
      pages: paged.pageMap.pages,
      size: ctx.t(`pdf.sizes.${run.pageSize}`),
      pictures: paged.counts.pictures,
      tables: paged.counts.tables,
      notes: paged.counts.notes,
    });
    // D23: what was not carried over as written, each with its reason; else the status line.
    const lines = [
      ...[...paged.leftOut, ...(finished.picturesLeftOut ?? []).map((id) => `#${id}`)].map(
        (detail) => ctx.t('pdf.summary.pictureLeftOut', { detail }),
      ),
      ...paged.replacedFonts.map((detail) => ctx.t('pdf.summary.fontReplaced', { detail })),
      ...(finished.uncovered
        ? [ctx.t('pdf.summary.systemFont', { detail: [...finished.uncovered].join(' ') })]
        : []),
    ];
    if (lines.length === 0) {
      actions.setStatusMessage(store, counts);
    } else {
      await ctx.dialogs.showMessage({
        text: `${counts}\n\n${ctx.t('pdf.exportSummaryIntro')}\n${lines.join('\n')}`,
        caption: ctx.t('pdf.exportCaption'),
        icon: 'info',
        testId: 'dialog-pdf-export-summary',
      });
    }
    return true;
  } catch (error) {
    modal.end();
    if (token) await rpc.call('pdf.export.abort', { token }).catch(() => undefined);
    if (run.cancelled() || error instanceof Cancelled) {
      actions.setStatusMessage(store, ctx.t('pdf.exportCancelled'));
      return false;
    }
    let detail = error instanceof Error ? error.message : String(error);
    if (isRpcError(error) && error.code === RpcErrorCode.pdfExportFailed) {
      const data = (error.data ?? {}) as { reason?: string; message?: string };
      const reason = (data.reason ?? 'pdf.ioError').replace(/^pdf\./, '');
      detail = ctx.t(`pdf.reason.${reason}`, { message: data.message ?? '' });
    }
    await ctx.dialogs.showMessage({
      text: ctx.t('pdf.exportFailed', { path, detail }),
      caption: ctx.t('pdf.exportCaption'),
      icon: 'error',
      testId: 'dialog-pdf-export-failed',
    });
    return false;
  }
}
