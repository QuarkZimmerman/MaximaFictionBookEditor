/**
 * Feature 014 (D1, D2, D24): File > Export > Export as PDF.... The command is static and small. It
 * asks the Save dialog for the file and the page size, shows its progress at once, and only then
 * loads its part, the lazy chunk `pdf-export` (folder rule in vite.config.ts). That is never at
 * start-up and never with another command, and a dialog closed without a file loads nothing.
 *
 * The page size comes with the Save dialog (D2): the dialog's labelled list carries the nine sizes
 * (`encodingChoices` with the label "Page size:", the chosen label returned as `encoding`). A
 * dialog that cannot carry the list returns no `encoding`; the size is then asked in the editor's
 * own window (PageSizeDialog.tsx).
 */
import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { cmdKeys } from '@/features/editing/common';
import { confirmBookExport } from '@/features/file/exportCheck';
import { proposedStem } from '@/features/file/proposedName';
import type { PdfPageSizeId } from '@/rpc/types';
import { commitPendingSource } from '@/views/source/sourceSession';

import { DEFAULT_PDF_PAGE_SIZE, PDF_PAGE_SIZES, pdfPageSize } from './pageSizes';
import { keepPageSize, keptPageSize } from './keptPageSize';
import { showPageSizeDialog } from './showPageSizeDialog';

export const EXPORT_PDF_COMMAND = 'file.exportPdf';

/** What the command hands its part once the user has chosen the file and the size. */
export interface PdfRun {
  path: string;
  pageSize: PdfPageSizeId;
  /** The progress, shown before the part loaded; the part ends it. */
  modal: ModalJobHandle;
  /** True once *Cancel* was pressed, also while the part was loading. */
  cancelled: () => boolean;
}

/** The folder part of a path, with its separator ('' for a book never saved). */
function folderOf(path: string | null | undefined): string {
  if (!path) return '';
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at >= 0 ? path.slice(0, at + 1) : '';
}

/**
 * The size the dialog proposes (D25): the one kept for the open book, else the settings' default,
 * A4 out of the box.
 */
function proposedSize(ctx: CommandContext, docId: string): PdfPageSizeId {
  return (
    keptPageSize(docId) ??
    pdfPageSize(ctx.store.getState().settings?.pdf?.defaultPageSize ?? DEFAULT_PDF_PAGE_SIZE).id
  );
}

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerPdfFeature(commands: CommandRegistry): void {
  commands.replace({
    id: EXPORT_PDF_COMMAND,
    group: 'file',
    ...cmdKeys(EXPORT_PDF_COMMAND, 'menu.file.exportPdf'),
    enabled: connectedWithDocument,
    run: async (ctx) => {
      const { store, rpc } = ctx;
      // D4: the book as the window has it, Source edits applied first.
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      const state = store.getState();
      if (!state.document || !state.docId) return;
      const docId = state.docId;
      // As Save asks before writing an invalid book (requester, rc.5).
      if (!(await confirmBookExport(ctx)) || store.getState().docId !== docId) return;
      const stem = proposedStem(state.document.description, ctx.t('app.untitled'));
      const proposed = proposedSize(ctx, docId);
      const labels = PDF_PAGE_SIZES.map((size) => ctx.t(`pdf.sizes.${size.id}`));
      const { path, encoding } = await rpc.call('dialog.saveFile', {
        title: ctx.t('cmd.file.exportPdf.tooltip'),
        filters: [{ name: ctx.t('pdf.filter'), extensions: ['pdf'] }],
        selectedFilter: 0,
        // D2: the book's name in the book's folder.
        defaultPath: `${folderOf(state.path)}${stem}.pdf`,
        encodingChoices: labels,
        selectedEncoding: ctx.t(`pdf.sizes.${proposed}`),
        encodingLabel: ctx.t('pdf.pageSizeLabel'),
      });
      if (!path || store.getState().docId !== docId) return;
      // D2: a dialog that could not carry the list answered without it - the size is asked in the
      // editor's own window; its *Cancel* writes nothing.
      const chosen = encoding === undefined ? -1 : labels.indexOf(encoding);
      const pageSize =
        chosen >= 0
          ? PDF_PAGE_SIZES[chosen].id
          : await showPageSizeDialog(ctx.dialogs, { defaultSize: proposed, path });
      if (!pageSize || store.getState().docId !== docId) return;
      // D25: kept for the book from here on, even if the export is cancelled (analysis C7).
      keepPageSize(docId, pageSize);
      let cancelled = false;
      const modal = startModalJob(ctx.t('pdf.exporting'), () => {
        cancelled = true;
      });
      const run: PdfRun = { path, pageSize, modal, cancelled: () => cancelled };
      try {
        const { exportPdf } = await import('./export/job');
        await exportPdf(ctx, docId, run);
      } catch (error) {
        modal.end();
        throw error;
      }
    },
  });
}
