/**
 * Feature 016 (D21 to D23, FR-041, FR-045; tasks T050): which FBD of the archive gives the book's description,
 * asked before the pages are read. One PDF and one FBD: that FBD; else the FBD with the PDF's name (without the
 * extension, letter case ignored, in any folder); else the list of every FBD, with None. For the editor's own
 * PDF one question names both descriptions, and none is asked when they are the same.
 */

import type { CommandContext } from '@/app/commands';
import { showArchiveBookChooser } from '@/dialogs/show';
import type { ReadDescriptionResult } from '@/features/transfer/importEntries';
import type { ArchiveChoice } from '@/rpc/types';

import type { PdfImportRun } from '../importCommand';
import { closeRead, readDescriptionFile, sameDescription } from './fbd';
import type { PdfDocumentModel } from './model';

/** The FBD the user takes (its entry), null for the PDF's own description, 'cancel' to end the import. */
export type FbdAnswer = string | null | 'cancel';

const stem = (entry: string): string =>
  entry
    .slice(entry.lastIndexOf('/') + 1)
    .replace(/\.[^.]*$/, '')
    .toLowerCase();
const nameOf = (entry: string): string => entry.slice(entry.lastIndexOf('/') + 1);

/** D24: an FBD that cannot be read is named with its problem; the import goes on without it. */
export async function fbdUnreadable(
  ctx: CommandContext,
  entry: string,
  error: unknown,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  await ctx.dialogs.showMessage({
    text: ctx.t('pdfImport.fbd.unreadable', { name: nameOf(entry), reason }),
    caption: ctx.t('pdfImport.importCaption'),
    icon: 'warning',
    testId: 'dialog-pdf-fbd-unreadable',
  });
}

export async function askFbd(
  ctx: CommandContext,
  run: PdfImportRun,
  document: PdfDocumentModel,
): Promise<FbdAnswer> {
  const rpc = ctx.rpc!;
  const fbds = run.fbds;
  if (fbds.length === 0 || !run.entry) return null;
  const ours = !!document.record;
  const pdfName = nameOf(run.entry);
  const candidate =
    run.pdfs === 1 && fbds.length === 1
      ? fbds[0].entry
      : (fbds.find((fbd) => stem(fbd.entry) === stem(run.entry!))?.entry ?? null);
  if (candidate) {
    if (ours) {
      // D23 (clarify): the same description as the record - as in an archive the export writes - asks nothing.
      const docId = ctx.store.getState().docId;
      let record: ReadDescriptionResult | null = null;
      let theirs: ReadDescriptionResult | null = null;
      try {
        if (docId) {
          record = await readDescriptionFile(
            ctx,
            docId,
            (await rpc.call('pdfImport.recordFbd', { token: run.token })).path,
          );
          const { path } = await rpc.call('pdfImport.extractFbd', {
            token: run.token,
            entry: candidate,
          });
          theirs = await readDescriptionFile(ctx, docId, path);
          if (sameDescription(record, theirs, document.cover)) return null;
        }
      } catch (error) {
        if (record && !theirs) {
          await fbdUnreadable(ctx, candidate, error);
          return null;
        }
      } finally {
        await closeRead(ctx, record);
        await closeRead(ctx, theirs);
      }
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('pdfImport.fbd.whichDescription', { pdf: pdfName, fbd: nameOf(candidate) }),
        caption: ctx.t('pdfImport.importCaption'),
        buttons: 'yesNoCancel',
        icon: 'question',
        labels: { yes: ctx.t('pdfImport.fbd.thePdfs'), no: ctx.t('pdfImport.fbd.theFbds') },
        testId: 'dialog-pdf-fbd-which',
      });
      return answer === 'cancel' ? 'cancel' : answer === 'no' ? candidate : null;
    }
    const answer = await ctx.dialogs.showMessage({
      text: ctx.t('pdfImport.fbd.takeIt', { fbd: nameOf(candidate) }),
      caption: ctx.t('pdfImport.importCaption'),
      buttons: 'yesNoCancel',
      icon: 'question',
      testId: 'dialog-pdf-fbd-take',
    });
    return answer === 'cancel' ? 'cancel' : answer === 'yes' ? candidate : null;
  }
  // No FBD has the PDF's name: every FBD of the archive, with None (the PDF's own description for its own PDF).
  const none = {
    entry: '',
    name: ctx.t(ours ? 'pdfImport.fbd.ownDescription' : 'pdfImport.fbd.none'),
    folder: '',
    size: 0,
    kind: 'fbd' as const,
  };
  const choice: ArchiveChoice = {
    archive: run.path,
    books: [
      none,
      ...fbds.map(({ entry, size }) => {
        const at = entry.lastIndexOf('/');
        return {
          entry,
          name: entry.slice(at + 1),
          folder: at >= 0 ? entry.slice(0, at) : '',
          size,
          kind: 'fbd' as const,
        };
      }),
    ],
    otherFiles: 0,
    booksTotal: fbds.length + 1,
  };
  const chosen = await showArchiveBookChooser(ctx.dialogs, choice, nameOf(run.path));
  if (chosen === null) return 'cancel';
  return chosen === '' ? null : chosen;
}
