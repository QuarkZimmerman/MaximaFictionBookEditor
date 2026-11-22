/**
 * Feature 018 (T031, T035, T044, contracts/mobi-import.md): lazy MOBI / KF8 / PalmDOC import
 * orchestrator. Lives inside the `mobi-import` lazy chunk — loaded only when the user imports.
 */
import type { CommandContext } from '@/app/commands';
import { showArchiveBookChooser } from '@/dialogs/show';
import type { FileFeature } from '@/features/file/fileCommands';
import { uploadBinary } from '@/features/images/binaries';
import { closeRead, readDescriptionFile, withFbd } from '@/features/importShared/fbdApply';
import { buildBook } from '@/features/markdown/describe';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type ArchiveChoice } from '@/rpc/types';
import { normaliseGenres } from '@/views/description/resources';

import type { MobiImportRun } from '../importCommand';
import { convertMobiToFb2, type ConvertedMobiBook } from './convert';
import { buildForeignDescription, type MobiImportSummaryItem } from './metadata';
import {
  drawMathMlMarkup,
  drawSvgMarkup,
  fetchImportText,
  transferMobiPictures,
  type MobiPictureInfo,
} from './pictures';
import {
  descriptionsCanonicallyEqual,
  resolveMfbeMode,
  serializeDescriptionXml,
  serializeStylesheetsXml,
} from './roundtrip';

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

class Cancelled extends Error {}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function baseName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

function stemOf(p: string): string {
  const b = baseName(p);
  return b.replace(/\.[^.]*$/, '') || b;
}

function folderOfEntry(entry: string): string {
  const at = entry.lastIndexOf('/');
  return at >= 0 ? entry.slice(0, at) : '';
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSummaryLines(
  ctx: CommandContext,
  items: readonly MobiImportSummaryItem[],
): string[] {
  const counted = new Map<string, { item: MobiImportSummaryItem; count: number }>();
  for (const item of items) {
    const key = `${item.kind}\u0000${item.detail}`;
    const existing = counted.get(key);
    if (existing) existing.count++;
    else counted.set(key, { item, count: 1 });
  }
  const lines = [...counted.values()].map(({ item, count }) => {
    let key: string;
    let params: Record<string, string | number> = { detail: item.detail };
    switch (item.kind) {
      case 'fellBackToMobi7':
        key = 'mobi.importSummary.fallbackMobi7';
        break;
      case 'externallyModified':
        key = 'mobi.importSummary.mfbeExternallyModified';
        break;
      case 'fbdApplied':
        key = 'mobi.importSummary.fbd';
        params = { name: item.detail };
        break;
      default:
        key = `mobi.importSummary.${item.kind}`;
        break;
    }
    const line = ctx.t(key, params);
    return count > 1 ? `${line} (\u00d7${count})` : line;
  });
  const shown = lines.slice(0, 40).map((l) => `\u2022 ${l}`);
  if (lines.length > 40) shown.push(ctx.t('mobi.summaryMore', { count: lines.length - 40 }));
  return shown;
}

interface DrawnFigure {
  id: string;
  blob: Blob;
  contentType: string;
}

async function resolveFigures(
  book: ConvertedMobiBook,
  summary: MobiImportSummaryItem[],
  checkCancelled: () => void,
): Promise<{
  bodyXml: string;
  notesXml: string | null;
  annotationXml: string | null;
  historyXml: string | null;
  drawn: DrawnFigure[];
}> {
  const drawn: DrawnFigure[] = [];
  const placed = new Map<string, string>();

  for (const [index, formula] of book.formulas.entries()) {
    checkCancelled();
    try {
      const pic = await drawMathMlMarkup(formula.markup, formula.display);
      drawn.push({ id: formula.id, blob: pic.blob, contentType: pic.contentType });
      placed.set(`math:${index}`, formula.id);
    } catch {
      summary.push({ kind: 'formulaAsText', detail: formula.alt || '\u2026' });
    }
  }
  for (const [index, drawing] of book.drawings.entries()) {
    checkCancelled();
    try {
      const pic = await drawSvgMarkup(drawing.markup);
      drawn.push({ id: drawing.id, blob: pic.blob, contentType: pic.contentType });
      placed.set(`svg:${index}`, drawing.id);
    } catch {
      summary.push({ kind: 'drawingLeftOut', detail: drawing.alt || drawing.id });
    }
  }

  const replace = (xml: string): string =>
    xml.replace(
      /<!--mfbe-(math|svg)(-block)?:(\d+)-->/g,
      (_, kind: string, block: string | undefined, n: string) => {
        const item = (kind === 'math' ? book.formulas : book.drawings)[Number(n)]!;
        const id = placed.get(`${kind}:${n}`);
        const alt = item.alt ? ` alt="${escText(item.alt).replace(/"/g, '&quot;')}"` : '';
        if (id) return `<image l:href="#${id}"${alt}/>`;
        const text = escText(item.alt);
        if (!block) return text;
        return text ? `<p>${text}</p>` : '<empty-line/>';
      },
    );

  return {
    bodyXml: replace(book.bodyXml),
    notesXml: book.notesXml === null ? null : replace(book.notesXml),
    annotationXml: book.annotationXml === null ? null : replace(book.annotationXml),
    historyXml: book.historyXml === null ? null : replace(book.historyXml),
    drawn,
  };
}

/**
 * Resolves the companion FBD candidate per contracts/mobi-import.md §4 (MobiFbdResolution rules 1–5):
 * - Inside ZIP: exact stem match in same folder -> sole FBD in archive -> chooser with None.
 * - Outside ZIP (foreign only): `files.fbdBeside({ path })`; editor-made bare MOBIs ignore sibling FBD.
 */
async function resolveArchiveFbdChoice(
  ctx: CommandContext,
  run: MobiImportRun,
): Promise<{ entry: string; name: string } | null | 'cancel'> {
  if (run.entry === undefined || run.fbds.length === 0) return null;
  const bookFolder = folderOfEntry(run.entry);
  const bookStem = stemOf(run.entry).toLowerCase();

  // 1. Exact stem match in same folder
  const sameFolder = run.fbds.find(
    (f) => folderOfEntry(f.entry) === bookFolder && stemOf(f.entry).toLowerCase() === bookStem,
  );
  if (sameFolder) return { entry: sameFolder.entry, name: baseName(sameFolder.entry) };

  // 2. Sole .fbd in archive (especially when archive has 1 MOBI + 1 FBD)
  if (run.fbds.length === 1) {
    return { entry: run.fbds[0]!.entry, name: baseName(run.fbds[0]!.entry) };
  }

  // 3. Multiple / unmatched FBDs -> chooser listing archive FBDs + None
  const choice: ArchiveChoice = {
    archive: run.path,
    books: [
      { entry: '', name: ctx.t('mobi.fbd.none'), folder: '', size: 0, kind: 'fbd' },
      ...run.fbds.map(({ entry, size }) => ({
        entry,
        name: baseName(entry),
        folder: folderOfEntry(entry),
        size,
        kind: 'fbd' as const,
      })),
    ],
    otherFiles: 0,
    booksTotal: run.fbds.length + 1,
  };
  const chosen = await showArchiveBookChooser(ctx.dialogs, choice, baseName(run.path));
  if (chosen === null) return 'cancel';
  return chosen === '' ? null : { entry: chosen, name: baseName(chosen) };
}

export async function importMobi(
  ctx: CommandContext,
  files: FileFeature,
  run: MobiImportRun,
): Promise<boolean> {
  const { rpc, store } = ctx;
  let modal = run.modal;
  if (!rpc) {
    modal.end();
    return false;
  }
  actions.setStatusMessage(store, '');

  let activeJobId: string | null = null;
  let createdDocId: string | null = null;
  const check = (): void => {
    if (run.cancelled()) throw new Cancelled();
  };
  const cancelJob = (): void => {
    if (activeJobId) {
      void rpc.call('job.cancel', { jobId: activeJobId }).catch(() => undefined);
    }
  };

  try {
    const SCALE = 10_000;
    // 1. Read & parse the MOBI/KF8/PalmDOC container in core (background job).
    const readRes = await rpc.runJob(
      'mobiImport.read',
      { token: run.token },
      {
        onStart: (id) => {
          activeJobId = id;
          if (run.cancelled()) cancelJob();
        },
        onProgress: (p) => {
          if (run.cancelled()) cancelJob();
          const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0.5;
          modal.progress(Math.max(1, Math.round(frac * 1_500)), SCALE);
        },
      },
    );
    activeJobId = null;
    check();
    modal.progress(1_600, SCALE);
    await nextTask();

    // 2. Fetch HTML + KF8 CSS flows over authenticated loopback HTTP routes.
    const [htmlOrText, templateRes, genresRes] = await Promise.all([
      fetchImportText(run.token, 'html'),
      rpc.call('template.xml'),
      rpc.call('resources.genres').catch(() => null),
    ]);
    check();

    const cssFlows: string[] = [];
    for (let i = 0; i < readRes.cssFlowCount; i++) {
      check();
      cssFlows.push(await fetchImportText(run.token, `css/${i}`));
    }
    modal.progress(2_000, SCALE);
    await nextTask();
    check();

    // 3. Resolve verified MFBE round-trip vs partial fallback vs foreign import.
    const mfbeRes = resolveMfbeMode({
      mfbeStatus: readRes.mfbeStatus,
      mfbeHtmlMatches: readRes.mfbeHtmlMatches,
      mfbeMetaMatches: readRes.mfbeMetaMatches,
      mfbe: readRes.mfbe,
    });

    const summary: MobiImportSummaryItem[] = [...mfbeRes.summary];
    if (readRes.fellBackToMobi7) {
      summary.push({ kind: 'fellBackToMobi7', detail: '' });
    }

    // 4. Convert HTML/PalmDOC -> FB2 bodies & notes (cooperatively yielding every ~40 ms).
    let convTick = 2_000;
    const converted = await convertMobiToFb2({
      activePart: readRes.activePart,
      htmlOrText,
      cssFlows,
      metadata: readRes.metadata,
      navigation: readRes.navigation,
      guide: readRes.guide,
      pictures: readRes.pictures,
      coverIndex: readRes.coverIndex,
      thumbnailIndex: readRes.thumbnailIndex,
      mfbeBodyRecord: mfbeRes.useBody ? mfbeRes.record : null,
      yieldStep: async () => {
        check();
        convTick = Math.min(convTick + 50, 5_490);
        modal.progress(convTick, SCALE);
        await nextTask();
        check();
      },
    });
    summary.push(...converted.summary);

    // 5. Rasterise inline drawing SVGs / MathML formulas (if any).
    const figures = await resolveFigures(converted, summary, check);
    modal.progress(5_700, SCALE);
    await nextTask();
    check();

    // 6. Assemble complete FB2 XML (restored MFBE description vs foreign EXTH description).
    let fb2Xml: string;
    if (mfbeRes.useMeta && mfbeRes.record) {
      const descXml = serializeDescriptionXml(mfbeRes.record.description, undefined, {
        annotationXml: figures.annotationXml,
        historyXml: figures.historyXml,
      });
      const cssXml = serializeStylesheetsXml(mfbeRes.record.stylesheets);
      fb2Xml =
        `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
        `${cssXml}${descXml}${figures.bodyXml}${figures.notesXml ?? ''}</FictionBook>\n`;
    } else {
      const genreEntries = genresRes ? normaliseGenres(genresRes).entries : undefined;
      const fallbackTitle = stemOf(run.entry ?? run.path);
      const foreign = buildForeignDescription(readRes.metadata, genreEntries, fallbackTitle);
      summary.push(...foreign.summary);
      if (converted.coverBinaryId) {
        foreign.description.cover = `#${converted.coverBinaryId}`;
      }
      fb2Xml = buildBook(
        templateRes.xml,
        {
          description: foreign.description,
          bodyXml: figures.bodyXml,
          notesXml: figures.notesXml,
          stylesheets: converted.stylesheets,
          pictures: [],
          formulas: [],
          chars: [],
          diagrams: [],
          summary: [],
          cssFiles: [],
          stats: {
            sections: converted.counts.sections,
            pictures: converted.counts.pictures,
            tables: converted.counts.tables,
            notes: converted.counts.notes,
          },
        },
        {
          annotationXml: figures.annotationXml,
          historyXml: figures.historyXml,
        },
      );
    }
    modal.progress(6_000, SCALE);
    await nextTask();
    check();

    // 7. Create the new untitled book in core (fire-and-forget: NO source origin per 017 D25!).
    //    Forward core job progress so the bar keeps moving smoothly while core reads big books (SC-007).
    const opened = await rpc.runJob(
      'doc.newFromXml',
      {
        xml: fb2Xml,
        ...(mfbeRes.useMeta ? { keepDetails: true } : {}),
      },
      {
        onProgress: (p) => {
          if (p.total <= 0) return;
          const frac = Math.min(1, p.done / p.total);
          modal.progress(6_000 + Math.round(frac * 2_500), SCALE);
        },
      },
    );
    createdDocId = opened.document.docId;
    let book: Document & typeof opened.document = opened.document;
    modal.progress(8_500, SCALE);
    check();

    // 8. Transfer referenced MOBI/KF8 pictures inside core + upload drawn SVGs/formulas.
    const pictureIndex = new Map<number, MobiPictureInfo>(
      readRes.pictures.map((p) => [p.index, p]),
    );
    const quality = store.getState().settings?.other.jpegQuality ?? 90;
    const totalPics = Math.max(1, converted.neededPictures.size + figures.drawn.length);
    let picDone = 0;
    const transferred = await transferMobiPictures({
      rpc,
      token: run.token,
      docId: book.docId,
      pictureIndex,
      needed: converted.neededPictures,
      quality,
      summary,
      onStep: async () => {
        check();
        modal.progress(8_500 + Math.round((++picDone / totalPics) * 1_300), SCALE);
      },
    });
    const uploadedDrawn = [];
    for (const fig of figures.drawn) {
      check();
      try {
        uploadedDrawn.push(
          await uploadBinary(book.docId, fig.blob, {
            contentType: fig.contentType,
            suggestedId: fig.id,
          }),
        );
      } catch {
        summary.push({ kind: 'drawingLeftOut', detail: fig.id });
      }
      modal.progress(8_500 + Math.round((++picDone / totalPics) * 1_300), SCALE);
    }
    book = {
      ...book,
      binaries: [...book.binaries, ...transferred.added, ...uploadedDrawn],
    };
    modal.progress(9_850, SCALE);
    check();

    // 9. Companion FBD resolution (US5 rules 1–5, contracts/mobi-import.md §4).
    let fbdWarning: { name: string; reason: string } | null = null;
    if (run.entry !== undefined) {
      // Inside a ZIP archive (never calls files.fbdBeside!)
      if (run.fbds.length > 0) {
        const needsAsk =
          run.fbds.length > 1 &&
          !run.fbds.some(
            (f) =>
              folderOfEntry(f.entry) === folderOfEntry(run.entry!) &&
              stemOf(f.entry).toLowerCase() === stemOf(run.entry!).toLowerCase(),
          );
        if (needsAsk) modal.end();
        const chosen = await resolveArchiveFbdChoice(ctx, run);
        if (needsAsk) modal = run.reopen();
        if (chosen === 'cancel') throw new Cancelled();
        if (chosen) {
          let extractedPath: string | null = null;
          try {
            extractedPath = (
              await rpc.call('mobiImport.extractFbd', { token: run.token, entry: chosen.entry })
            ).path;
          } catch (err) {
            fbdWarning = {
              name: chosen.name,
              reason: err instanceof Error ? err.message : String(err),
            };
          }

          if (extractedPath) {
            if (mfbeRes.useMeta) {
              // Editor-made MOBI + archive FBD: compare archive FBD canonically against the
              // full restored description (including annotation & history read from their pages).
              let archiveRead = null;
              try {
                archiveRead = await readDescriptionFile(ctx, book.docId, extractedPath);
                const same = descriptionsCanonicallyEqual(
                  archiveRead.description,
                  book.description,
                );
                await closeRead(ctx, archiveRead);
                archiveRead = null;

                if (!same) {
                  modal.end();
                  const choice = await ctx.dialogs.showMessage({
                    text: ctx.t('mobi.fbd.whichDescription', {
                      mobi: baseName(run.entry),
                      fbd: chosen.name,
                    }),
                    caption: ctx.t('mobi.importCaption'),
                    buttons: 'yesNoCancel',
                    icon: 'question',
                    labels: {
                      yes: ctx.t('mobi.fbd.theFbds'),
                      no: ctx.t('mobi.fbd.theMobis'),
                    },
                    testId: 'dialog-mobi-fbd-conflict',
                  });
                  modal = run.reopen();
                  if (choice === 'cancel') throw new Cancelled();
                  if (choice === 'yes') {
                    const applied = await withFbd(ctx, book.docId, book, extractedPath);
                    if (applied.error) {
                      fbdWarning = {
                        name: chosen.name,
                        reason:
                          applied.error instanceof Error
                            ? applied.error.message
                            : String(applied.error),
                      };
                    } else {
                      book = { ...book, ...applied.document };
                      summary.push({ kind: 'fbdApplied', detail: chosen.name });
                    }
                  }
                }
              } catch (err) {
                await closeRead(ctx, archiveRead);
                if (err instanceof Cancelled) throw err;
                fbdWarning = {
                  name: chosen.name,
                  reason: err instanceof Error ? err.message : String(err),
                };
              }
            } else {
              // Foreign MOBI + archive FBD: apply silently!
              const applied = await withFbd(ctx, book.docId, book, extractedPath);
              if (applied.error) {
                fbdWarning = {
                  name: chosen.name,
                  reason:
                    applied.error instanceof Error ? applied.error.message : String(applied.error),
                };
              } else {
                book = { ...book, ...applied.document };
                summary.push({ kind: 'fbdApplied', detail: chosen.name });
              }
            }
          }
        }
      }
    } else if (!mfbeRes.useMeta) {
      // Bare foreign MOBI/KF8/PalmDOC: apply sibling .fbd if present (bare editor-made ignores it!)
      const beside = await rpc
        .call('files.fbdBeside', { path: run.path })
        .catch(() => ({ path: null }));
      if (beside.path) {
        const applied = await withFbd(ctx, book.docId, book, beside.path);
        const fbdName = baseName(beside.path);
        if (applied.error) {
          fbdWarning = {
            name: fbdName,
            reason: applied.error instanceof Error ? applied.error.message : String(applied.error),
          };
        } else {
          book = { ...book, ...applied.document };
          summary.push({ kind: 'fbdApplied', detail: fbdName });
        }
      }
    }

    // 10. Clean up import session, close modal, replace window book!
    await rpc.call('mobiImport.end', { token: run.token }).catch(() => undefined);
    modal.progress(SCALE, SCALE);
    modal.end();

    if (fbdWarning) {
      await ctx.dialogs.showMessage({
        text: ctx.t('mobi.fbd.unreadable', fbdWarning),
        caption: ctx.t('mobi.importCaption'),
        icon: 'warning',
        testId: 'dialog-mobi-fbd-unreadable',
      });
    }

    createdDocId = null; // handed off to editor window
    await files.loadImported(ctx, book);

    const picCount = transferred.added.length + uploadedDrawn.length;
    const doneMsg = ctx.t('mobi.importDone', {
      sections: converted.counts.sections,
      pictures: picCount,
      tables: converted.counts.tables,
      notes: converted.counts.notes,
    });

    if (summary.length === 0) {
      actions.setStatusMessage(store, doneMsg);
    } else {
      await ctx.dialogs.showMessage({
        text: `${doneMsg}\n\n${ctx.t('mobi.importSummaryIntro')}\n${formatSummaryLines(ctx, summary).join('\n')}`,
        caption: ctx.t('mobi.importCaption'),
        icon: 'info',
        testId: 'dialog-mobi-import-summary',
      });
    }
    return true;
  } catch (error) {
    modal.end();
    if (activeJobId) {
      await rpc.call('job.cancel', { jobId: activeJobId }).catch(() => undefined);
    }
    if (createdDocId) {
      await rpc.call('doc.close', { docId: createdDocId }).catch(() => undefined);
    }
    await rpc.call('mobiImport.end', { token: run.token }).catch(() => undefined);
    if (
      run.cancelled() ||
      error instanceof Cancelled ||
      (isRpcError(error) && error.code === RpcErrorCode.cancelled)
    ) {
      actions.setStatusMessage(store, ctx.t('mobi.importCancelled'));
      return false;
    }
    throw error;
  }
}
