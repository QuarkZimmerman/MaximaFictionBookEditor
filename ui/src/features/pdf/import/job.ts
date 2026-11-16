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
import { guessLanguage, metadataDescription } from './describe';
import { layoutParts } from './layout';
import { textBody } from './text';

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
      // A PDF made from text, or a scan with a text layer (D11, D17): its structure when tagged, else its layout.
      const { xml: template } = await rpc.call('template.xml');
      // The dictionaries the editor has, by their language (en, ru, uk): spell.check takes their languages.
      const dictionaries = await rpc.call('spell.dictionaries').catch(() => []);
      const dictionaryOf = (code: string): string | undefined =>
        dictionaries.find(
          (d) =>
            d.lang.toLowerCase().startsWith(code) || (d.tag ?? '').toLowerCase().startsWith(code),
        )?.lang;
      const misspelled = async (list: string[], code: string): Promise<string[]> => {
        const dictionary = dictionaryOf(code);
        if (!dictionary || list.length === 0) return list;
        return (await rpc.call('spell.check', { words: list, langs: [dictionary] })).misspelled;
      };
      // Words broken with a plain hyphen at a line's end, joined: kept when a dictionary knows them (D12).
      const candidates = new Set<string>();
      for (const model of models) {
        model.words.forEach((word, index) => {
          const next = model.words[index + 1];
          if (next && /\p{L}-$/u.test(word.t))
            candidates.add(`${word.t.slice(0, -1)}${next.t}`.replace(/[^\p{L}]/gu, ''));
        });
      }
      const knownWords = new Set<string>();
      for (const code of ['en', 'ru', 'uk']) {
        const list = [...candidates].filter((w) => !knownWords.has(w)).slice(0, 1000);
        const wrong = new Set(await misspelled(list, code).catch(() => list));
        for (const word of list) if (!wrong.has(word)) knownWords.add(word);
      }
      const parts = document.structure?.length
        ? flatten(document.structure, document.orphans ?? []).parts
        : layoutParts(models, { outline: document.outline, known: (word) => knownWords.has(word) })
            .parts;
      // Pictures: on each page, the parts' pictures in order against the reader's, top to bottom.
      const pagePictures = new Map(
        models.map((m) => [m.n, [...m.pictures].sort((a, b) => a.box[1] - b.box[1])]),
      );
      const picture = (page: number): string | null => {
        const next = pagePictures.get(page)?.shift();
        if (!next) return null;
        const binaryId = `picture-${wanted.length + 1}`;
        wanted.push({ readerId: next.id, page, binaryId });
        return binaryId;
      };
      const link = (run: { uri?: string }): { href: string; note: boolean } | null =>
        run.uri ? { href: run.uri, note: false } : null;
      const body = textBody(parts, link, picture);
      const words = parts.flatMap((part) => part.runs.flatMap((run) => run.text.split(/\s+/)));
      const language = await guessLanguage(words, misspelled);
      const stem = baseName(originPath).replace(/\.pdf$/i, '');
      xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
        metadataDescription(document.metadata.info, template, stem, language) +
        body.xml +
        '</FictionBook>';
      counts = body.counts;
    }
    check();
    const opened = await rpc.runJob(
      'doc.newFromXml',
      { xml, origin: { kind: 'pdf', path: originPath }, keepDetails: !!document.record },
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
