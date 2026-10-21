/**
 * File > Export > Export as FBD... (feature 004 US5; spec FR-040 to FR-043; research R3.3,
 * R6.4; data-model §5): a copy of the description, like "save a copy".
 *
 *  1. pending Source text is parsed back first; malformed XML refuses with the usual message
 *     (FR-043);
 *  2. the native save dialog offers the one type "FictionBook descriptors (*.fbd)" and no
 *     encoding choice - the export is always UTF-8, as the library writes its own FBD files -
 *     proposing `<its folder>/<stem>.fbd` for a document that has a file and the bare proposed
 *     name of FR-050 for a never-saved one, which the dialog places in the folder last used by
 *     Open or Save As (FR-053);
 *  3. `doc.exportDescription` writes the live model's description, the images it refers to
 *     and one empty section atomically; the exported content is validated, and errors ask
 *     Save's own question ("export anyway?") - Yes repeats the call with `force`, No writes
 *     nothing (FR-042);
 *  4. the open document's own file is refused by the core (1006) and reported; a failed write
 *     (1002) is reported as a failed save;
 *  5. the status bar names the written file; nothing else changes - no new path, kind or
 *     encoding, the modified state as it was, Recent Files and the remembered position
 *     untouched (US5 scenario 3).
 */

import type { TFunction } from 'i18next';

import type { CommandContext } from '@/app/commands';
import { describeError, isClientSideError, logUiError } from '@/app/diagnostics';
import { fileType } from '@/dialogs/fileTypes';
import type { Dialogs } from '@/dialogs/types';
import { exportStem, proposedStem } from '@/features/file/proposedName';
import type { ValidationReport } from '@/model/document';
import { actions, type AppState } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type FileFilter } from '@/rpc/types';
import { commitPendingSource } from '@/views/source/sourceSession';

import { errorReason } from './importDescription';

/** The extension of an exported description (spec FR-040). */
export const EXPORT_EXTENSION = 'fbd';

/** The save dialog's one type: FictionBook descriptors (*.fbd). */
export function exportFileTypes(t: TFunction): FileFilter[] {
  return [fileType(t('fileDialogs.types.fictionBookDescriptors'), [EXPORT_EXTENSION])];
}

/**
 * The file the dialog proposes (FR-050, FR-053): `<its folder>/<stem>.fbd` for a document that
 * has a file - a full path, so the dialog opens in the document's folder - else the bare
 * proposed name ("Last name First name - Book title", "Untitled" in the interface language),
 * which every platform's dialog places in the remembered folder.
 */
export function exportDefaultPath(
  state: Pick<AppState, 'path' | 'document'>,
  t: TFunction,
): string {
  if (state.path) {
    const separator = Math.max(state.path.lastIndexOf('/'), state.path.lastIndexOf('\\'));
    const folder = state.path.slice(0, separator + 1);
    return `${folder}${exportStem(state.path)}.${EXPORT_EXTENSION}`;
  }
  const untitled = t('app.untitled');
  const stem = state.document ? proposedStem(state.document.description, untitled) : untitled;
  return `${stem}.${EXPORT_EXTENSION}`;
}

/** Save's "Validation failed ... export anyway?" prompt; resolves true when the user insists. */
async function confirmExportWithErrors(
  dialogs: Dialogs,
  t: TFunction,
  report: ValidationReport,
): Promise<boolean> {
  const answer = await dialogs.showMessage({
    text: t('transfer.export.validationFailed', {
      errors: t('msg.errorsFound', { count: report.errorCount }),
    }),
    caption: t('msg.validationFailedCaption'),
    buttons: 'yesNo',
    icon: 'warning',
    defaultButton: 'no',
    testId: 'dialog-export-validation-failed',
  });
  return answer === 'yes';
}

/** The whole flow of the Export command; resolves true once the file is written. */
export async function exportFbd(ctx: CommandContext): Promise<boolean> {
  const { store, rpc } = ctx;
  if (!rpc) return false;
  if ((await commitPendingSource(ctx)) === 'error') return false;
  const state = store.getState();
  if (!state.document || !state.docId) return false;
  const docId = state.docId;

  const choice = await rpc.call('dialog.saveFile', {
    title: ctx.t('cmd.file.exportFbd.tooltip'),
    filters: exportFileTypes(ctx.t),
    selectedFilter: 0,
    defaultPath: exportDefaultPath(state, ctx.t),
  });
  const path = choice.path;
  if (!path) return false;

  let force = false;
  for (;;) {
    // The document may have been replaced while a prompt was up (a reload after an external
    // change); the export then stops.
    const current = store.getState();
    if (!current.document || current.docId !== docId) return false;
    try {
      const result = await rpc.runJob(
        'doc.exportDescription',
        { docId, document: current.document, path, force },
        { onProgress: (progress) => actions.setProgress(store, progress) },
      );
      actions.setProgress(store, null);
      if (result.needsConfirmation) {
        if (!(await confirmExportWithErrors(ctx.dialogs, ctx.t, result.validation))) return false;
        force = true;
        continue;
      }
      actions.setStatusMessage(
        store,
        result.validation.errorCount === 0
          ? ctx.t('transfer.export.done', { path: result.path })
          : ctx.t('transfer.export.doneWithErrors', {
              path: result.path,
              count: result.validation.errorCount,
            }),
      );
      return true;
    } catch (error) {
      actions.setProgress(store, null);
      if (error instanceof RpcError && error.code === RpcErrorCode.docSameAsOpenFile) {
        await ctx.dialogs.showMessage({
          text: ctx.t('transfer.export.sameFile', { path }),
          caption: ctx.t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-export-same-file',
        });
        return false;
      }
      // doc.ioError is logged by the core (rpc.doc.ioError with docId/path); a timeout or a
      // lost connection is a client-side failure logged here.
      if (isClientSideError(error)) {
        void logUiError(rpc, {
          code: 'transfer.exportFailed',
          ...describeError(error),
          context: { docId, path },
        });
      }
      await ctx.dialogs.showMessage({
        text: ctx.t('msg.saveFailed', { path, reason: errorReason(error) }),
        caption: ctx.t('dialog.error.caption'),
        icon: 'error',
        testId: 'dialog-export-failed',
      });
      return false; // nothing was written; the document is as it was
    }
  }
}
