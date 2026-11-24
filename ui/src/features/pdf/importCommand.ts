/**
 * Feature 016 (D1, D2, D4, D21, D26; plan DP-10, DP-16): File > Import > PDF File.... The command is static
 * and small: it asks the questions that need no conversion code - the unsaved-changes question (Source
 * edits applied first), the Open dialog, the archive's PDF, the password - then shows its progress at once
 * and loads the lazy part `pdf-import` (src/features/pdf/import/, folder rule in vite.config.ts, checked by
 * tests/unit/pdf/import/chunk.test.ts) with import() on its first use only (D29). Like the other imports it
 * is a one-time operation (011 D32): nothing of it is kept once it ends (D3).
 */

import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { showArchiveBookChooser } from '@/dialogs/show';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type ArchiveChoice, type PdfImportEntry } from '@/rpc/types';

import { showPdfImportOptions } from './PdfImportOptionsDialog';

export const IMPORT_PDF_COMMAND = 'file.importPdf';

/**
 * Feature 020 (data-model.md §4): module-scoped session memory for interactive PDF import's
 * "Use OCR" checkbox. Null before the first user confirmation in this process (so it tracks
 * Settings.imports.pdf.useOcr); once confirmed, stays sticky until exit without mutating Settings.
 */
let sessionUseOcr: boolean | null = null;

export function getSessionUseOcr(savedDefault?: boolean): boolean {
  return sessionUseOcr ?? savedDefault ?? true;
}

export function setSessionUseOcr(value: boolean): void {
  sessionUseOcr = value;
}

export function resetSessionUseOcrForTests(): void {
  sessionUseOcr = null;
}

/** What the command hands its part once the PDF is open (D2: every question asked before the read). */
export interface PdfImportRun {
  /** The PDF, or the ZIP archive holding it. */
  path: string;
  /** The PDF's entry when it comes from an archive. */
  entry?: string;
  /** The archive's FBD files, for the questions of D22 and D23. */
  fbds: PdfImportEntry[];
  /** How many PDFs the archive holds (D22: one PDF and one FBD ask about that FBD). */
  pdfs: number;
  /** The core's import session (contracts/rpc-api.md). */
  token: string;
  pages: number;
  /** The progress, shown before the part loaded; the part ends it. */
  modal: ModalJobHandle;
  /** The progress again, after a question the part asked with it closed (the questions of D22, D23). */
  reopen: () => ModalJobHandle;
  /** True once Cancel was pressed, also while the part was loading. */
  cancelled: () => boolean;
}

const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** The message of a refused or failed import, in the interface's languages (FR-053). */
export function pdfImportReason(ctx: CommandContext, error: unknown): string {
  if (isRpcError(error) && error.code === RpcErrorCode.pdfImportFailed) {
    const data = (error.data ?? {}) as {
      reason?: string;
      pages?: number;
      script?: string;
      suggestedLanguages?: string[];
    };
    const key = `pdfImport.refused.${data.reason ?? 'damaged'}`;
    const text = ctx.t(key, {
      pages: data.pages ?? 0,
      script: data.script ?? '',
      languages: (data.suggestedLanguages ?? []).join(', '),
    });
    return text === key ? ctx.t('pdfImport.refused.damaged') : text;
  }
  return error instanceof Error ? error.message : String(error);
}

async function showFailure(ctx: CommandContext, path: string, error: unknown): Promise<void> {
  await ctx.dialogs.showMessage({
    text: ctx.t('pdfImport.importFailed', { path, reason: pdfImportReason(ctx, error) }),
    caption: ctx.t('pdfImport.importCaption'),
    icon: 'error',
    testId: 'dialog-pdf-import-failed',
  });
}

/** D21: the archive's PDF - the only one, or the one the user chooses (null for Cancel). */
async function choosePdf(
  ctx: CommandContext,
  path: string,
  pdfs: PdfImportEntry[],
): Promise<string | null> {
  if (pdfs.length === 1) return pdfs[0].entry;
  const choice: ArchiveChoice = {
    archive: path,
    books: pdfs.map(({ entry, size }) => {
      const at = entry.lastIndexOf('/');
      return {
        entry,
        name: entry.slice(at + 1),
        folder: at >= 0 ? entry.slice(0, at) : '',
        size,
        kind: 'pdf',
      };
    }),
    otherFiles: 0,
    booksTotal: pdfs.length,
  };
  return showArchiveBookChooser(ctx.dialogs, choice, baseName(path));
}

export function registerPdfImportFeature(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_PDF_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_PDF_COMMAND, 'menu.file.importPdf'),
    enabled: (ctx) => ctx.rpc !== null,
    run: async (ctx) => {
      const rpc = ctx.rpc;
      if (!rpc || !(await files.confirmDiscardChanges(ctx))) return;
      const savedDefault = ctx.store.getState().settings?.imports?.pdf?.useOcr ?? true;
      const initialUseOcr = getSessionUseOcr(savedDefault);
      const openResult = await rpc.call('dialog.openFile', {
        title: ctx.t('pdfImport.openTitle'),
        filters: [
          { name: ctx.t('pdfImport.filterAll'), extensions: ['pdf', 'zip'] },
          { name: ctx.t('pdfImport.filterPdf'), extensions: ['pdf'] },
          { name: ctx.t('pdfImport.filterZip'), extensions: ['zip'] },
        ],
        selectedFilter: 0,
        checks: [{ id: 'useOcr', label: ctx.t('pdfImport.useOcrLabel'), checked: initialUseOcr }],
      });
      const path = openResult.paths[0];
      if (!path) return;
      let useOcr: boolean;
      if (openResult.checks && typeof openResult.checks.useOcr === 'boolean') {
        useOcr = openResult.checks.useOcr;
      } else {
        const chosen = await showPdfImportOptions(ctx.dialogs, { initialUseOcr });
        if (chosen === null) return;
        useOcr = chosen.useOcr;
      }
      setSessionUseOcr(useOcr);
      let token = '';
      try {
        let begun = await rpc.call('pdfImport.begin', { path });
        let entry: string | undefined;
        let fbds: PdfImportEntry[] = [];
        let pdfs = 1;
        if (begun.archive) {
          fbds = begun.archive.fbds;
          pdfs = begun.archive.pdfs.length;
          const chosen = await choosePdf(ctx, path, begun.archive.pdfs);
          if (!chosen) return;
          entry = chosen;
          begun = await rpc.call('pdfImport.begin', { path, entry });
        }
        token = begun.token ?? '';
        // D26: a password asked for while the PDF needs one; Cancel ends the import, nothing changed.
        let open = await rpc.call(
          'pdfImport.inspect',
          useOcr ? { token, ocr: { enabled: true } } : { token },
        );
        const name = baseName(entry ?? path);
        while (!open.opened) {
          const answer = await ctx.dialogs.showInput({
            caption: ctx.t('pdfImport.passwordCaption'),
            prompt: open.wrongPassword
              ? ctx.t('pdfImport.wrongPassword')
              : ctx.t(
                  open.ownerPassword ? 'pdfImport.ownerPasswordPrompt' : 'pdfImport.passwordPrompt',
                  { name },
                ),
            buttons: 'okCancel',
            password: true,
            testId: 'dialog-pdf-password',
          });
          if (answer.button === 'cancel' || !answer.value) {
            await rpc.call('pdfImport.end', { token }).catch(() => undefined);
            return;
          }
          open = await rpc.call('pdfImport.password', { token, password: answer.value });
        }
        let cancelled = false;
        const begin = (): ModalJobHandle =>
          startModalJob(ctx.t('pdfImport.importing'), () => {
            cancelled = true;
          });
        const modal = begin();
        const run: PdfImportRun = {
          path,
          entry,
          fbds,
          pdfs,
          token,
          pages: open.pages ?? 0,
          modal,
          reopen: begin,
          cancelled: () => cancelled,
        };
        let part: typeof import('./import/job');
        try {
          part = await import('./import/job');
        } catch (error) {
          modal.end();
          throw error;
        }
        token = ''; // the part ends the session from here on
        await part.importPdf(ctx, files, run);
      } catch (error) {
        if (token) await rpc.call('pdfImport.end', { token }).catch(() => undefined);
        await showFailure(ctx, path, error);
      }
    },
  });
}
