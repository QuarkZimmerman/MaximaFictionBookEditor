/**
 * Feature 023 (T028; FR-012..FR-014): static entry for File > Import > DOCX File....
 * Stays in the main bundle (ZERO imports from `./import/`, `./export/`, or `./shared/`) and
 * dynamically loads `./import/docxImportJob` (`docx-import` lazy chunk) only after the user picks
 * a file (and archive book if ZIP).
 */
import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { docxImportFileTypes } from '@/dialogs/fileTypes';
import { showArchiveBookChooser } from '@/dialogs/show';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type ArchiveChoice } from '@/rpc/types';
import { commitPendingSource } from '@/views/source/sourceSession';

export const IMPORT_DOCX_COMMAND = 'file.importDocx';

export interface DocxImportRun {
  path: string;
  token: string;
  entries: string[];
  strayMacros: string[];
  outside: string[];
  fromArchive: boolean;
  archiveEntry?: string;
  fbdEntries: string[];
  siblingFbdPath?: string;
  modal: ModalJobHandle;
  reopen: () => ModalJobHandle;
  cancelled: () => boolean;
}

function baseName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

/** User-facing refusal reason for `1125 kDocxRefused` and generic import errors. */
export function docxImportReason(ctx: CommandContext, error: unknown): string {
  if (isRpcError(error) && error.code === RpcErrorCode.docxRefused) {
    const data = (error.data ?? {}) as { reason?: string };
    const reason = data.reason ?? 'damaged';
    const key = `docx.refused.${reason}`;
    const text = ctx.t(key);
    return text === key ? ctx.t('docx.refused.damaged') : text;
  }
  return error instanceof Error ? error.message : String(error);
}

async function chooseArchiveDocx(
  ctx: CommandContext,
  path: string,
  entries: string[],
): Promise<string | null> {
  if (entries.length === 1) return entries[0]!;
  const choice: ArchiveChoice = {
    archive: path,
    books: entries.map((entry) => {
      const at = entry.lastIndexOf('/');
      return {
        entry,
        name: entry.slice(at + 1),
        folder: at >= 0 ? entry.slice(0, at) : '',
        size: 0,
        kind: 'fb2',
      };
    }),
    otherFiles: 0,
    booksTotal: entries.length,
  };
  return showArchiveBookChooser(ctx.dialogs, choice, baseName(path));
}

export function registerDocxImportFeature(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_DOCX_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_DOCX_COMMAND, 'menu.file.importDocx'),
    enabled: (ctx) => ctx.rpc !== null && ctx.store.getState().connection === 'connected',
    run: async (ctx) => {
      const { rpc } = ctx;
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      if (!(await files.confirmDiscardChanges(ctx))) return;

      const { paths } = await rpc.call('dialog.openFile', {
        title: ctx.t('docx.openTitle'),
        filters: docxImportFileTypes(ctx.t),
        selectedFilter: 0,
      });
      const path = paths[0];
      if (!path) return;

      let token = '';
      try {
        let begun = await rpc.call('docxImport.begin', { path });
        if ('archive' in begun) {
          const chosen = await chooseArchiveDocx(ctx, path, begun.entries);
          if (!chosen) return;
          begun = await rpc.call('docxImport.begin', { path, entry: chosen });
        }
        if ('archive' in begun) {
          throw new Error(ctx.t('docx.refused.damaged'));
        }
        token = begun.token;

        let cancelled = false;
        const beginModal = (): ModalJobHandle =>
          startModalJob(ctx.t('docx.importing'), () => {
            cancelled = true;
          });
        const modal = beginModal();

        const run: DocxImportRun = {
          path,
          token,
          entries: begun.entries,
          strayMacros: begun.strayMacros,
          outside: begun.outside,
          fromArchive: begun.fromArchive,
          archiveEntry: begun.archiveEntry,
          fbdEntries: begun.fbdEntries,
          siblingFbdPath: begun.siblingFbdPath,
          modal,
          reopen: beginModal,
          cancelled: () => cancelled,
        };

        let mod: typeof import('./import/docxImportJob');
        try {
          mod = await import('./import/docxImportJob');
        } catch (err) {
          modal.end();
          throw err;
        }
        token = ''; // ownership transferred to importDocx
        await mod.importDocx(ctx, files, run);
      } catch (error) {
        if (token) {
          await rpc.call('docxImport.end', { token }).catch(() => undefined);
        }
        await ctx.dialogs.showMessage({
          text: ctx.t('docx.importFailed', { path, reason: docxImportReason(ctx, error) }),
          caption: ctx.t('docx.importCaption'),
          icon: 'error',
          testId: 'dialog-docx-import-failed',
        });
      }
    },
  });
}
