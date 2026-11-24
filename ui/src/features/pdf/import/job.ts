/**
 * Feature 016 (plan DP-10 to DP-15; tasks T032): the lazy part of the PDF import (chunk `pdf-import`) - the
 * read by the reader process, the conversion, the new book made by the core, its pictures, the summary of
 * counts (D31). The window's book is replaced only by the finished new one; Cancel leaves it as it was.
 */

import type { CommandContext } from '@/app/commands';
import { brokenWordCandidate, knownWords } from '@/features/text/joinWords';
import type { FileFeature } from '@/features/file/fileCommands';
import type { ReadDescriptionResult } from '@/features/transfer/importEntries';
import type { BinaryMeta } from '@/model/document';
import { actions } from '@/model/store';
import type { PdfImportOcrSummary } from '@/rpc/types';

import { pdfImportReason, type PdfImportRun } from '../importCommand';
import { FB2_NS, XLINK_NS } from './fb2';
import type { HintsV1 } from './model';
import { convertOurs, type PictureWanted } from './ours';
import { loadDocument, loadPages } from './pages';
import { flatten } from './parts';
import { askFbd, fbdUnreadable } from './questions';
import { guessLanguage, metadataDescription, resolveImportLanguage } from './describe';
import { applyFbd, closeRead, readDescriptionFile } from '@/features/importShared/fbdApply';
import { furnitureOf, layoutParts, linesOf } from './layout';
import { fromLatin1, looksLatin1Cyrillic } from './mend';
import { textBody } from './text';
import { mendFb2 } from './valid';

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
    // Feature 017 (D39): a PDF the editor did not make, outside an archive, asks about the FBD lying beside
    // it with its name - with the question an archive's matching FBD gets (016 D22).
    let besidePath: string | null = null;
    if (run.entry === undefined && run.fbds.length === 0) {
      const beside = await rpc
        .call('files.fbdBeside', { path: run.path })
        .catch(() => ({ path: undefined }));
      if (beside.path && !(await loadDocument(token)).record) {
        modal.end();
        const answer = await ctx.dialogs.showMessage({
          text: ctx.t('pdfImport.fbd.takeIt', {
            fbd: beside.path.slice(
              Math.max(beside.path.lastIndexOf('/'), beside.path.lastIndexOf('\\')) + 1,
            ),
          }),
          caption: ctx.t('pdfImport.importCaption'),
          buttons: 'yesNoCancel',
          icon: 'question',
          testId: 'dialog-pdf-fbd-take',
        });
        modal = run.reopen();
        if (answer === 'cancel') throw new Cancelled();
        if (answer === 'yes') besidePath = beside.path;
      }
    }
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
    let ocrSummary: PdfImportOcrSummary | undefined;
    const detectSpan = Math.max(3, Math.round(pages * 0.1));
    const cropSpan = Math.max(3, Math.round(pages * 0.1));
    const ocrSpan = Math.max(1, pages - detectSpan - cropSpan);
    let maxReadProgress = 0;
    const advanceRead = (value: number, title?: string): void => {
      maxReadProgress = Math.max(maxReadProgress, Math.min(pages * 2, value));
      modal.progress(maxReadProgress, total, title);
    };
    try {
      ({
        kinds,
        drawingsLeftOut = 0,
        ocr: ocrSummary,
      } = await rpc.runJob(
        'pdfImport.read',
        { token },
        {
          onStart: (id) => {
            jobId = id;
          },
          onProgress: (progress) => {
            const frac = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
            if (progress.phase === 'ocrDetect') {
              advanceRead(
                pages + Math.round(frac * detectSpan),
                ctx.t('pdfImport.progress.ocrDetect'),
              );
            } else if (progress.phase === 'ocr') {
              advanceRead(
                pages + detectSpan + Math.round(frac * ocrSpan),
                ctx.t('pdfImport.progress.ocr'),
              );
            } else if (progress.phase === 'ocrCrop') {
              advanceRead(
                pages + detectSpan + ocrSpan + Math.round(frac * cropSpan),
                ctx.t('pdfImport.progress.ocr'),
              );
            } else if (progress.total > 0) {
              advanceRead(Math.round(frac * pages));
            }
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
      // A tag tree that holds only a part of the pages' words is not the book's structure (an OCR plug-in's
      // tags gave an empty book in D32's library run): then the layout reads the pages.
      const tagged = document.structure?.length
        ? flatten(document.structure, document.orphans ?? []).parts
        : null;
      // The runs of the tags' text, cells and captions too.
      const taggedRuns = (tagged ?? []).flatMap((part) => [
        ...part.runs,
        ...(part.rows ?? []).flatMap((row) => row.flatMap((cell) => cell.runs)),
        ...(part.caption ?? []),
      ]);
      // The reader marks a plain hyphen that ends a line in the tags' text (U+2063 after it).
      const BROKEN = /(\p{L}+)-\u2063(\p{L}+)/gu;
      // Words broken with a plain hyphen at a line's end, joined: kept when a dictionary knows them (D12).
      const candidates = new Set<string>();
      for (const run of taggedRuns)
        for (const match of run.text.matchAll(BROKEN)) candidates.add(`${match[1]}${match[2]}`);
      for (const model of models) {
        model.words.forEach((word, index) => {
          const next = model.words[index + 1];
          const candidate = next ? brokenWordCandidate(word.t, next.t) : null;
          if (candidate) candidates.add(candidate);
        });
      }
      // Every candidate is asked about, in batches the core takes (a long book has thousands; the first
      // thousand alone left most of them broken in D32's library run) - small ones, after each of which the
      // bar moves (SC-010: a book of 1,102 pages stood still for 12 s here). Feature 017 (DP-13): the
      // asking is the TXT import's too (features/text/joinWords.ts).
      const knownWordSet = await knownWords(
        candidates,
        misspelled,
        (asked, batches) =>
          modal.progress(pages * 3 + Math.round((asked / batches) * (pages / 2)), total),
        check,
      );
      // ... and in the tags' text as in the layout's: joined where known, else the hyphen stays (D12).
      for (const run of taggedRuns)
        run.text = run.text
          .replace(BROKEN, (_all, head: string, tail: string) =>
            knownWordSet.has(`${head}${tail}`) ? `${head}${tail}` : `${head}-${tail}`,
          )
          .replace(/\u2063/g, '');
      const wordsOf = (texts: string[]): number =>
        texts.join(' ').split(/\s+/).filter(Boolean).length;
      const lettersOf = (text: string): number => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
      const sum = (values: Iterable<number>): number => [...values].reduce((a, b) => a + b, 0);
      // The tags' letters and words, page by page (cells and captions too).
      const taggedLetters = new Map<number, number>();
      const taggedTokens = new Map<number, number>();
      for (const run of taggedRuns) {
        if (!run.text.trim()) continue;
        taggedLetters.set(run.page, (taggedLetters.get(run.page) ?? 0) + lettersOf(run.text));
        taggedTokens.set(run.page, (taggedTokens.get(run.page) ?? 0) + wordsOf([run.text]));
      }
      // The pages' words as the book's text: without the running heads and page numbers, which tags leave out.
      const pageLines = models.map(linesOf);
      const furniture = furnitureOf(pageLines);
      const pageText = pageLines.map((lines) =>
        lines.filter((line) => !furniture.has(line)).flatMap((line) => line.words),
      );
      const pageLetters = pageText.map((words) => sum(words.map((word) => lettersOf(word.t))));
      // Tags are the book's structure only when they hold nearly all its text: text outside them (an OCR layer
      // tagged in part - D32's library run) would be lost, and the layout reads every word. Counted by letters:
      // tags may set a word's letters apart.
      // ... and when they read in the pages' order: of the tags' words side by side on a page, nearly all stand
      // side by side in the order the page draws its words (D32's library run: tables read far from their place).
      const token = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const drawn = new Set<string>();
      for (const model of models) {
        let previous = '';
        for (const word of model.words) {
          const t = token(word.t);
          if (!t) continue;
          if (previous) drawn.add(`${model.n} ${previous} ${t}`);
          previous = t;
        }
      }
      let pairs = 0;
      let inOrder = 0;
      for (const part of tagged ?? []) {
        let previous = '';
        let page = -1;
        for (const run of part.runs)
          for (const word of run.text.split(/\s+/)) {
            const t = token(word);
            if (!t) continue;
            if (previous && page === run.page) {
              pairs++;
              if (drawn.has(`${run.page} ${previous} ${t}`)) inOrder++;
            }
            previous = t;
            page = run.page;
          }
      }
      const hasOcrPages = models.some(
        (model) => model.ocrUsed || (model.ocrImages?.length ?? 0) > 0,
      );
      const layout =
        !hasOcrPages &&
        tagged &&
        sum(taggedLetters.values()) >= sum(pageLetters) * 0.97 &&
        inOrder >= pairs * 0.97
          ? null
          : layoutParts(models, {
              outline: document.outline,
              known: (word) => knownWordSet.has(word),
            });
      // Pages the tags leave out, wholly or in part (a back cover's text layer, a contents page), or whose words
      // their tags set apart letter by letter (D32's library run): read by the layout and set among the tags'
      // parts by their page.
      let fromTags = tagged ?? [];
      if (!layout && tagged) {
        const untagged = models.filter((model, index) => {
          const words = pageText[index].length;
          return (
            words >= 5 &&
            ((taggedLetters.get(model.n) ?? 0) < pageLetters[index] * 0.9 ||
              (taggedTokens.get(model.n) ?? 0) > words * 1.5)
          );
        });
        if (untagged.length > 0) {
          // Such a page is the layout's whole: the tags' runs on it go, and the parts they leave empty.
          const replaced = new Set(untagged.map((model) => model.n));
          const text = (part: (typeof tagged)[number]): boolean =>
            part.kind === 'p' || part.kind === 'title';
          const kept = tagged
            .map((part) =>
              text(part)
                ? { ...part, runs: part.runs.filter((run) => !replaced.has(run.page)) }
                : part,
            )
            .filter((part) =>
              text(part) ? part.runs.some((run) => run.text.trim()) : !replaced.has(part.page),
            );
          const extra = layoutParts(untagged, {
            outline: [],
            known: (word) => knownWordSet.has(word),
          }).parts;
          const merged: typeof tagged = [];
          let k = 0;
          for (const part of kept) {
            while (k < extra.length && extra[k].page < part.page) merged.push(extra[k++]);
            merged.push(part);
          }
          fromTags = [...merged, ...extra.slice(k)];
        }
      }
      const parts = layout ? layout.parts : fromTags;
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
      const words = parts.flatMap((part) => part.runs.flatMap((run) => run.text.split(/\s+/)));
      const guessedLang = await guessLanguage(words, misspelled);
      const language = resolveImportLanguage({
        pdfLang: document.metadata.lang,
        ocrSummary,
        totalPages: document.pages,
        guessedLang,
      });
      const body = textBody(parts, link, picture, { bookLang: language });
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
    // SC-002 (requester, 2026-11-17): the book comes in as valid FB2 - what the schema does not allow, mended.
    const valid = mendFb2(xml);
    xml = valid.xml;
    const opened = await rpc.runJob(
      'doc.newFromXml',
      { xml, origin: { kind: 'pdf', path: originPath }, keepDetails: !!document.record },
      {
        onProgress: (progress) => {
          if (progress.total > 0)
            modal.progress(
              Math.round(pages * 3.5 + (progress.done / progress.total) * (pages / 4)),
              total,
            );
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
      // The last quarter of the bar's last part (SC-010: a book's many pictures held it still for 12 s).
      const answer = await rpc.runJob(
        'pdfImport.addPictures',
        {
          token,
          docId,
          pictures: wanted.map((w) => ({ id: w.readerId, page: w.page, suggestedId: w.binaryId })),
        },
        {
          onProgress: (progress) => {
            if (progress.total > 0)
              modal.progress(
                Math.round(pages * 3.75 + (progress.done / progress.total) * (pages / 4)),
                total,
              );
          },
        },
      );
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
    if (fbd || besidePath) {
      let read: ReadDescriptionResult | null = null;
      try {
        const path = fbd
          ? (await rpc.call('pdfImport.extractFbd', { token, entry: fbd })).path
          : besidePath!;
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
    const fbdName =
      fbd ??
      (besidePath
        ? besidePath.slice(Math.max(besidePath.lastIndexOf('/'), besidePath.lastIndexOf('\\')) + 1)
        : null);
    if (fbdName && fbdError) await fbdUnreadable(ctx, fbdName, fbdError);
    await nextTask();
    await files.loadImported(ctx, book);
    docId = null;
    // The cover is no picture of the text, so the count leaves it out: the summary names it (the requester,
    // after his smoke test of rc.1: a book of a cover alone read as one without pictures).
    const coverHref = book.description.titleInfo.coverpage[0]?.href ?? '';
    const withCover = !!coverHref && book.binaries.some((binary) => `#${binary.id}` === coverHref);
    const done = ctx.t(withCover ? 'pdfImport.importDoneCover' : 'pdfImport.importDone', {
      pages: document.pages,
      ...counts,
    });
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
    if (ocrSummary?.used) {
      if (ocrSummary.pagesRecognized > 0)
        lines.push(ctx.t('pdfImport.summary.ocrPages', { count: ocrSummary.pagesRecognized }));
      if (ocrSummary.imageBlocksRecognized > 0)
        lines.push(
          ctx.t('pdfImport.summary.ocrImageBlocks', { count: ocrSummary.imageBlocksRecognized }),
        );
      if (ocrSummary.languages.length > 0)
        lines.push(
          ctx.t('pdfImport.summary.ocrLanguages', { languages: ocrSummary.languages.join(', ') }),
        );
      if (ocrSummary.fallbackPages > 0)
        lines.push(
          ctx.t('pdfImport.summary.ocrFallbackPages', { count: ocrSummary.fallbackPages }),
        );
      if (ocrSummary.lowConfidencePages > 0)
        lines.push(
          ctx.t('pdfImport.summary.ocrLowConfidence', { count: ocrSummary.lowConfidencePages }),
        );
    }
    if (valid.mended > 0) lines.push(ctx.t('pdfImport.summary.mended', { count: valid.mended }));
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
