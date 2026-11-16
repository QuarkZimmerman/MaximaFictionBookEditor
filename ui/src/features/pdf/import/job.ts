/**
 * Feature 016 (plan DP-10 to DP-15; tasks T032): the lazy part of the PDF import (chunk `pdf-import`) - the
 * read by the reader process, the conversion, the new book made by the core, its pictures, the summary of
 * counts (D31). The window's book is replaced only by the finished new one; Cancel leaves it as it was.
 */

import type { CommandContext } from '@/app/commands';
import type { FileFeature } from '@/features/file/fileCommands';
import type { ReadDescriptionResult } from '@/features/transfer/importEntries';
import type { BinaryMeta } from '@/model/document';
import { actions } from '@/model/store';

import { pdfImportReason, type PdfImportRun } from '../importCommand';
import { FB2_NS, XLINK_NS } from './fb2';
import type { HintsV1 } from './model';
import { convertOurs, type PictureWanted } from './ours';
import { loadDocument, loadPages } from './pages';
import { flatten } from './parts';
import { askFbd, fbdUnreadable } from './questions';
import { guessLanguage, metadataDescription } from './describe';
import { applyFbd, closeRead, readDescriptionFile } from './fbd';
import { layoutParts } from './layout';
import { fromLatin1, looksLatin1Cyrillic } from './mend';
import { textBody } from './text';

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const folderOf = (path: string): string => path.slice(0, path.length - baseName(path).length);

class Cancelled extends Error {}

/** DP-3: the pictures a book takes at most. */
const MAX_PICTURES = 10_000;

export async function importPdf(
  ctx: CommandContext,
  files: FileFeature,
  run: PdfImportRun,
): Promise<void> {
  const rpc = ctx.rpc;
  const { token } = run;
  let modal = run.modal;
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
    // D22, D23 (FR-045): which FBD of the archive gives the description, asked before the pages are read.
    let fbd: string | null = null;
    if (run.fbds.length > 0) {
      // The questions come above the window, not under the progress: it closes while they are asked.
      modal.end();
      const answer = await askFbd(ctx, run, await loadDocument(token));
      if (answer === 'cancel') {
        modal = run.reopen();
        throw new Cancelled();
      }
      fbd = answer;
      // D24: the chosen FBD is read now, so that one that cannot be read leaves the PDF's description.
      const windowDoc = ctx.store.getState().docId;
      if (fbd && windowDoc) {
        let probe: ReadDescriptionResult | null = null;
        try {
          const { path } = await rpc.call('pdfImport.extractFbd', { token, entry: fbd });
          probe = await readDescriptionFile(ctx, windowDoc, path);
        } catch (error) {
          await fbdUnreadable(ctx, fbd, error);
          fbd = null;
        } finally {
          await closeRead(ctx, probe);
        }
      }
      modal = run.reopen();
    }
    // The read: the reader process takes every page (half of the bar).
    let jobId: string | null = null;
    const watch = setInterval(() => {
      if (run.cancelled() && jobId) void rpc.call('job.cancel', { jobId }).catch(() => undefined);
    }, 200);
    let kinds: Record<string, number> = {};
    let drawingsLeftOut = 0;
    try {
      ({ kinds, drawingsLeftOut = 0 } = await rpc.runJob(
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
      ));
    } finally {
      clearInterval(watch);
    }
    // D17, D19: pages without text that the book does not get - blank pages, and a scan's plates (the
    // first page's picture becomes the cover, not counted).
    let notImported = 0;
    // FR-061: the pages without usable text that came in - a text PDF's plates, layers read as garbage.
    let platesImported = 0;
    let garbledPages = 0;
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
      const hints = JSON.parse(document.record.hints) as HintsV1;
      // An FBD taken whole (D23): the book starts from the template's description, as an untouched new
      // document does, and the record's description pages and cover are not used.
      const description = fbd
        ? (/<description[\s\S]*?<\/description>/.exec((await rpc.call('template.xml')).xml)?.[0] ??
          '<description/>')
        : document.record.description;
      const result = convertOurs(
        hints,
        flatten(document.structure ?? [], document.orphans ?? []),
        models,
        description,
        { descriptionPages: !fbd },
      );
      ({ xml, mismatches, counts } = result);
      wanted = fbd
        ? result.pictures.filter((w) => w.page !== hints.generated.cover)
        : result.pictures;
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
      // Every candidate is asked about, in batches the core takes (a long book has thousands; the first
      // thousand alone left most of them broken in D32's library run).
      for (const code of ['en', 'ru', 'uk']) {
        const list = [...candidates].filter((w) => !knownWords.has(w));
        for (let at = 0; at < list.length; at += 20_000) {
          const batch = list.slice(at, at + 20_000);
          const wrong = new Set(await misspelled(batch, code).catch(() => batch));
          for (const word of batch) if (!wrong.has(word)) knownWords.add(word);
        }
      }
      // A tag tree that holds only a part of the pages' words is not the book's structure (an OCR plug-in's
      // tags gave an empty book in D32's library run): then the layout reads the pages.
      const tagged = document.structure?.length
        ? flatten(document.structure, document.orphans ?? []).parts
        : null;
      const wordsOf = (texts: string[]): number =>
        texts.join(' ').split(/\s+/).filter(Boolean).length;
      const taggedWords = (tagged ?? []).reduce(
        (n, part) =>
          n +
          wordsOf(part.runs.map((run) => run.text)) +
          wordsOf(
            (part.rows ?? []).flatMap((row) =>
              row.flatMap((cell) => cell.runs.map((run) => run.text)),
            ),
          ),
        0,
      );
      const pageWords = models.reduce((n, model) => n + model.words.length, 0);
      const layout =
        tagged && taggedWords >= pageWords * 0.5
          ? null
          : layoutParts(models, {
              outline: document.outline,
              known: (word) => knownWords.has(word),
            });
      const parts = layout ? layout.parts : (tagged ?? []);
      if (layout?.cover && !fbd)
        wanted.push({ readerId: layout.cover, page: 1, binaryId: 'cover' });
      notImported = (kinds.blank ?? 0) + (layout?.skippedPictures ?? 0);
      platesImported = layout?.platesImported ?? 0;
      garbledPages = kinds.garbled ?? 0;
      // D15: windows-1251 text read as Latin-1, mended when the mended words are mostly known.
      const sample = parts.flatMap((part) => part.runs.map((run) => run.text)).join(' ');
      if (looksLatin1Cyrillic(sample)) {
        const words = fromLatin1(sample)
          .split(/\s+/)
          .filter((w) => /^\p{L}{3,}$/u.test(w))
          .slice(0, 500);
        const wrong = (await misspelled(words, 'ru')).length;
        if (words.length > 0 && wrong / words.length < 0.5) {
          for (const part of parts) for (const run of part.runs) run.text = fromLatin1(run.text);
        }
      }
      // Pictures: on each page, the parts' pictures in order against the reader's, top to bottom.
      // A tagged PDF's figures take the page's pictures and drawings, top to bottom.
      const pagePictures = new Map(
        models.map((m) => [
          m.n,
          [...m.pictures, ...(m.drawings ?? [])].sort((a, b) => a.box[1] - b.box[1]),
        ]),
      );
      const picture = (page: number, _alt: string, readerId?: string): string | null => {
        const id = readerId ?? pagePictures.get(page)?.shift()?.id;
        if (!id) return null;
        const binaryId = `picture-${wanted.length + 1}`;
        wanted.push({ readerId: id, page, binaryId });
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
        (fbd
          ? metadataDescription(undefined, template, stem, null)
          : metadataDescription(
              document.metadata.info,
              template,
              stem,
              language,
              layout?.cover ? 'cover' : null,
            )) +
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
    // DP-3: at most 10,000 pictures a book; the rest are left out and counted.
    if (wanted.length > MAX_PICTURES) {
      picturesLeftOut += wanted.length - MAX_PICTURES;
      wanted = wanted.slice(0, MAX_PICTURES);
    }
    if (wanted.length > 0) {
      const answer = await rpc.runJob('pdfImport.addPictures', {
        token,
        docId,
        pictures: wanted.map((w) => ({ id: w.readerId, page: w.page, suggestedId: w.binaryId })),
      });
      added.push(...answer.added.map((entry) => entry.binary));
      picturesLeftOut += answer.failed.length;
    }
    check();
    const uploaded = new Set(added.map((binary) => binary.id));
    let book = {
      ...opened.document,
      binaries: [
        ...opened.document.binaries.filter((binary) => !uploaded.has(binary.id)),
        ...added,
      ],
    };
    // D23: the FBD's description, every entry of it, as Import Description gives one to a new document.
    // D24: an FBD that cannot be read is said once the progress has closed.
    let fbdError: unknown = null;
    if (fbd) {
      let read: ReadDescriptionResult | null = null;
      try {
        const { path } = await rpc.call('pdfImport.extractFbd', { token, entry: fbd });
        read = await readDescriptionFile(ctx, docId, path);
        book = { ...book, ...(await applyFbd(ctx, docId, book, read)) };
      } catch (error) {
        fbdError = error;
      } finally {
        await closeRead(ctx, read);
      }
    }
    await end();
    modal.progress(total, total);
    modal.end();
    if (fbd && fbdError) await fbdUnreadable(ctx, fbd, fbdError);
    await nextTask();
    await files.loadImported(ctx, book, originPath);
    docId = null;
    const done = ctx.t('pdfImport.importDone', { pages: document.pages, ...counts });
    const lines: string[] = [];
    if (mismatches > 0) lines.push(ctx.t('pdfImport.summary.mismatches', { count: mismatches }));
    if (picturesLeftOut > 0)
      lines.push(ctx.t('pdfImport.summary.picturesLeftOut', { count: picturesLeftOut }));
    if (notImported > 0) lines.push(ctx.t('pdfImport.summary.notImported', { count: notImported }));
    if (drawingsLeftOut > 0)
      lines.push(ctx.t('pdfImport.summary.drawingsLeftOut', { count: drawingsLeftOut }));
    if (platesImported > 0)
      lines.push(ctx.t('pdfImport.summary.platesImported', { count: platesImported }));
    if (garbledPages > 0)
      lines.push(ctx.t('pdfImport.summary.garbledPages', { count: garbledPages }));
    // D16, FR-029: what FB2 has no place for is left out and counted.
    const dropped = document.dropped ?? {};
    for (const key of ['comments', 'attachments', 'media', 'scripts'] as const) {
      const count = dropped[key] ?? 0;
      if (count > 0) lines.push(ctx.t(`pdfImport.summary.dropped.${key}`, { count }));
    }
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
