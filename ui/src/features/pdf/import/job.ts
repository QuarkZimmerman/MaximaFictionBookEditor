/**
 * Feature 016 (plan DP-10 to DP-15; tasks T032): the lazy part of the PDF import (chunk `pdf-import`) - the
 * read by the reader process, the conversion, the new book made by the core, its pictures, the summary of
 * counts (D31). The window's book is replaced only by the finished new one; Cancel leaves it as it was.
 */

import type { CommandContext } from '@/app/commands';
import type { FileFeature } from '@/features/file/fileCommands';
import type { BinaryMeta } from '@/model/document';
import { actions } from '@/model/store';

import { pdfImportReason, type PdfImportRun } from '../importCommand';
import { FB2_NS, XLINK_NS } from './fb2';
import type { HintsV1 } from './model';
import { convertOurs, type PictureWanted } from './ours';
import { loadDocument, loadPages } from './pages';
import { flatten } from './parts';
import { plainBody, templateDescription } from './plain';

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const folderOf = (path: string): string => path.slice(0, path.length - baseName(path).length);

class Cancelled extends Error {}

export async function importPdf(
  ctx: CommandContext,
  files: FileFeature,
  run: PdfImportRun,
): Promise<void> {
  const rpc = ctx.rpc;
  const { modal, token } = run;
  if (!rpc) {
    modal.end();
    return;
  }
  // D3: Save As proposes the PDF's name; a PDF from an archive is named as if it lay beside it.
  const originPath = run.entry ? `${folderOf(run.path)}${baseName(run.entry)}` : run.path;
  let ended = false;
  const end = async (): Promise<void> => {
    if (ended) return;
    ended = true;
    await rpc.call('pdfImport.end', { token }).catch(() => undefined);
  };
  let docId: string | null = null;
  const pages = Math.max(1, run.pages);
  const total = pages * 4;
  const check = (): void => {
    if (run.cancelled()) throw new Cancelled();
  };
  try {
    // The read: the reader process takes every page (half of the bar).
    let jobId: string | null = null;
    const watch = setInterval(() => {
      if (run.cancelled() && jobId) void rpc.call('job.cancel', { jobId }).catch(() => undefined);
    }, 200);
    try {
      await rpc.runJob(
        'pdfImport.read',
        { token },
        {
          onStart: (id) => {
            jobId = id;
          },
          onProgress: (progress) => {
            if (progress.total > 0)
              modal.progress(Math.round((progress.done / progress.total) * pages * 2), total);
          },
        },
      );
    } finally {
      clearInterval(watch);
    }
    check();
    const document = await loadDocument(token);
    const models = await loadPages(
      token,
      document.pages,
      (done, count) => modal.progress(pages * 2 + Math.round((done / count) * pages), total),
      run.cancelled,
    );
    check();
    let xml: string;
    let wanted: PictureWanted[] = [];
    let mismatches = 0;
    let counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };
    if (document.record) {
      // The editor's own PDF (D5): its record and hints rebuild the book.
      const result = convertOurs(
        JSON.parse(document.record.hints) as HintsV1,
        flatten(document.structure ?? [], document.orphans ?? []),
        models,
        document.record.description,
      );
      ({ xml, mismatches, counts } = result);
      wanted = result.pictures;
    } else {
      const { xml: template } = await rpc.call('template.xml');
      const title =
        document.metadata.info?.Title?.trim() || baseName(originPath).replace(/\.pdf$/i, '');
      const body = plainBody(models);
      xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
        templateDescription(template, title) +
        body.xml +
        '</FictionBook>';
      counts = { sections: 1, pictures: 0, tables: 0, notes: 0 };
    }
    check();
    const opened = await rpc.runJob(
      'doc.newFromXml',
      { xml, origin: { kind: 'pdf', path: originPath } },
      {
        onProgress: (progress) => {
          if (progress.total > 0)
            modal.progress(pages * 3 + Math.round((progress.done / progress.total) * pages), total);
        },
      },
    );
    docId = opened.document.docId;
    // The pictures go into the new book before the window shows it (as the EPUB import does).
    const added: BinaryMeta[] = [];
    let picturesLeftOut = 0;
    if (wanted.length > 0) {
      const answer = await rpc.call('pdfImport.addPictures', {
        token,
        docId,
        pictures: wanted.map((w) => ({ id: w.readerId, page: w.page, suggestedId: w.binaryId })),
      });
      added.push(...answer.added.map((entry) => entry.binary));
      picturesLeftOut = answer.failed.length;
    }
    check();
    const uploaded = new Set(added.map((binary) => binary.id));
    const book = {
      ...opened.document,
      binaries: [
        ...opened.document.binaries.filter((binary) => !uploaded.has(binary.id)),
        ...added,
      ],
    };
    await end();
    modal.progress(total, total);
    modal.end();
    await nextTask();
    await files.loadImported(ctx, book, originPath);
    docId = null;
    const done = ctx.t('pdfImport.importDone', { pages: document.pages, ...counts });
    const lines: string[] = [];
    if (mismatches > 0) lines.push(ctx.t('pdfImport.summary.mismatches', { count: mismatches }));
    if (picturesLeftOut > 0)
      lines.push(ctx.t('pdfImport.summary.picturesLeftOut', { count: picturesLeftOut }));
    if (lines.length === 0) actions.setStatusMessage(ctx.store, done);
    else {
      await ctx.dialogs.showMessage({
        text: `${done}\n\n${ctx.t('pdfImport.summaryIntro')}\n${lines.join('\n')}`,
        caption: ctx.t('pdfImport.importCaption'),
        icon: 'info',
        testId: 'dialog-pdf-import-summary',
      });
    }
  } catch (error) {
    modal.end();
    if (docId) await rpc.call('doc.close', { docId }).catch(() => undefined);
    await end();
    if (run.cancelled() || error instanceof Cancelled) {
      actions.setStatusMessage(ctx.store, ctx.t('pdfImport.importCancelled'));
      return;
    }
    await ctx.dialogs.showMessage({
      text: ctx.t('pdfImport.importFailed', {
        path: originPath,
        reason: pdfImportReason(ctx, error),
      }),
      caption: ctx.t('pdfImport.importCaption'),
      icon: 'error',
      testId: 'dialog-pdf-import-failed',
    });
  }
}
