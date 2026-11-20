/**
 * Feature 018 (T032, T044, FR-020..FR-025, FR-050): static entry for File > Import > MOBI File....
 * Stays in the main bundle (ZERO imports from `./import/`, `./export/`, `./shared/`, or
 * `../ebookShared/`) and dynamically loads `./import/job` (`mobi-import` lazy chunk) only after
 * the user selects a file (and archive book if ZIP).
 */
import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { mobiImportFileTypes } from '@/dialogs/fileTypes';
import { showArchiveBookChooser } from '@/dialogs/show';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type ArchiveChoice } from '@/rpc/types';
import { commitPendingSource } from '@/views/source/sourceSession';

export const IMPORT_MOBI_COMMAND = 'file.importMobi';

export interface MobiArchiveEntry {
  entry: string;
  size: number;
}

export interface MobiImportRun {
  path: string;
  entry?: string;
  fbds: MobiArchiveEntry[];
  mobisCount: number;
  token: string;
  modal: ModalJobHandle;
  reopen: () => ModalJobHandle;
  cancelled: () => boolean;
}

function baseName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

/** User-facing refusal reason for `1117 kMobiRefused` and generic errors. */
export function mobiImportReason(ctx: CommandContext, error: unknown): string {
  if (isRpcError(error) && error.code === RpcErrorCode.mobiRefused) {
    const data = (error.data ?? {}) as { reason?: string };
    const rawReason = data.reason ?? 'damaged';
    const key =
      rawReason === 'encrypted'
        ? 'mobi.refused.encrypted'
        : `mobi.refused.${rawReason}`;
    const text = ctx.t(key);
    return text === key ? ctx.t('mobi.refused.damaged') : text;
  }
  return error instanceof Error ? error.message : String(error);
}

async function chooseArchiveMobi(
  ctx: CommandContext,
  path: string,
  mobis: MobiArchiveEntry[],
): Promise<string | null> {
  if (mobis.length === 1) return mobis[0]!.entry;
  const choice: ArchiveChoice = {
    archive: path,
    books: mobis.map(({ entry, size }) => {
      const at = entry.lastIndexOf('/');
      return {
        entry,
        name: entry.slice(at + 1),
        folder: at >= 0 ? entry.slice(0, at) : '',
        size,
        kind: 'fb2',
      };
    }),
    otherFiles: 0,
    booksTotal: mobis.length,
  };
  return showArchiveBookChooser(ctx.dialogs, choice, baseName(path));
}

export function registerMobiImportFeature(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_MOBI_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_MOBI_COMMAND, 'menu.file.importMobi'),
    enabled: (ctx) => ctx.rpc !== null && ctx.store.getState().connection === 'connected',
    run: async (ctx) => {
      const { rpc } = ctx;
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      if (!(await files.confirmDiscardChanges(ctx))) return;

      const { paths } = await rpc.call('dialog.openFile', {
        title: ctx.t('mobi.openTitle'),
        filters: mobiImportFileTypes(ctx.t),
        selectedFilter: 0,
      });
      const path = paths[0];
      if (!path) return;

      let token = '';
      try {
        let begun = await rpc.call('mobiImport.begin', { path });
        let entry: string | undefined;
        let fbds: MobiArchiveEntry[] = [];
        let mobisCount = 1;

        if ('archive' in begun) {
          fbds = begun.archive.fbds;
          mobisCount = begun.archive.mobis.length;
          const chosen = await chooseArchiveMobi(ctx, path, begun.archive.mobis);
          if (!chosen) return;
          entry = chosen;
          begun = await rpc.call('mobiImport.begin', { path, entry });
        }

        token = 'token' in begun ? begun.token : '';
        if (!token) throw new Error(ctx.t('mobi.refused.damaged'));

        let cancelled = false;
        const beginModal = (): ModalJobHandle =>
          startModalJob(ctx.t('mobi.importing'), () => {
            cancelled = true;
          });
        const modal = beginModal();

        const run: MobiImportRun = {
          path,
          entry,
          fbds,
          mobisCount,
          token,
          modal,
          reopen: beginModal,
          cancelled: () => cancelled,
        };

        let mod: typeof import('./import/job');
        try {
          mod = await import('./import/job');
        } catch (err) {
          modal.end();
          throw err;
        }
        token = ''; // ownership transferred to importMobi
        await mod.importMobi(ctx, files, run);
      } catch (error) {
        if (token) {
          await rpc.call('mobiImport.end', { token }).catch(() => undefined);
        }
        await ctx.dialogs.showMessage({
          text: ctx.t('mobi.importFailed', { path, reason: mobiImportReason(ctx, error) }),
          caption: ctx.t('mobi.importCaption'),
          icon: 'error',
          testId: 'dialog-mobi-import-failed',
        });
      }
    },
  });
}
