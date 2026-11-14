/**
 * Feature 012 (D1, D14, D32; research DP-1): File > Import > EPUB File... and File > Export > Export as
 * EPUB.... The two commands are static and small; each loads its part - the lazy chunk `epub-import`
 * or `epub-export` (folder rules in vite.config.ts, checked by tests/unit/epub/chunk.test.ts) - with
 * import() on its first use only, never at start-up and never with the other. Both are one-time
 * operations (011 D32, D33): nothing of them is kept once they end.
 *
 * D32: each command asks its questions here - the import the unsaved-changes question and the Open
 * dialog, the export the Save dialog - then shows its progress at once and loads its part under it.
 * The first use never waits without a sign, and a dialog closed without a file loads nothing.
 */

import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { cmdKeys } from '@/features/editing/common';
import { confirmBookExport } from '@/features/file/exportCheck';
import type { FileFeature } from '@/features/file/fileCommands';
import { proposedStem } from '@/features/file/proposedName';
import { commitPendingSource } from '@/views/source/sourceSession';

export const IMPORT_EPUB_COMMAND = 'file.importEpub';
export const EXPORT_EPUB_COMMAND = 'file.exportEpub';

/** What a command hands its part once the user has chosen the file (D32). */
export interface EpubRun {
  /** The EPUB chosen in the Open or the Save dialog. */
  path: string;
  /** The progress, shown before the part loaded; the part ends it. */
  modal: ModalJobHandle;
  /** True once *Cancel* was pressed, also while the part was loading. */
  cancelled: () => boolean;
}

function startRun(title: string, path: string): EpubRun {
  let cancelled = false;
  const modal = startModalJob(title, () => {
    cancelled = true;
  });
  return { path, modal, cancelled: () => cancelled };
}

/** Loads a part under the run's progress; the progress ends if it cannot be loaded. */
async function load<T>(run: EpubRun, part: () => Promise<T>): Promise<T> {
  try {
    return await part();
  } catch (error) {
    run.modal.end();
    throw error;
  }
}

/** The folder part of a path, with its separator ('' for a book never saved). */
function folderOf(path: string | null | undefined): string {
  if (!path) return '';
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at >= 0 ? path.slice(0, at + 1) : '';
}

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerEpubFeature(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_EPUB_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_EPUB_COMMAND, 'menu.file.importEpub'),
    enabled: (ctx) => ctx.rpc !== null,
    run: async (ctx) => {
      const rpc = ctx.rpc;
      if (!rpc || !(await files.confirmDiscardChanges(ctx))) return;
      const { paths } = await rpc.call('dialog.openFile', {
        title: ctx.t('epub.openTitle'),
        filters: [{ name: ctx.t('epub.filter'), extensions: ['epub'] }],
        selectedFilter: 0,
      });
      if (!paths[0]) return;
      const run = startRun(ctx.t('epub.importing'), paths[0]);
      const { importEpub } = await load(run, () => import('./import/job'));
      await importEpub(ctx, files, run);
    },
  });
  commands.replace({
    id: EXPORT_EPUB_COMMAND,
    group: 'file',
    ...cmdKeys(EXPORT_EPUB_COMMAND, 'menu.file.exportEpub'),
    enabled: connectedWithDocument,
    run: async (ctx) => {
      const { store, rpc } = ctx;
      // D3: the book as the window has it, Source edits applied first.
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      const state = store.getState();
      if (!state.document || !state.docId) return;
      const docId = state.docId;
      // As Save asks before writing an invalid book (requester, rc.5).
      if (!(await confirmBookExport(ctx)) || store.getState().docId !== docId) return;
      const stem = proposedStem(state.document.description, ctx.t('app.untitled'));
      const { path } = await rpc.call('dialog.saveFile', {
        title: ctx.t('cmd.file.exportEpub.tooltip'),
        filters: [{ name: ctx.t('epub.filter'), extensions: ['epub'] }],
        selectedFilter: 0,
        // D2: the book's name in the book's folder; the dialog keeps no folder of its own (D33).
        defaultPath: `${folderOf(state.path)}${stem}.epub`,
      });
      if (!path || store.getState().docId !== docId) return;
      const run = startRun(ctx.t('epub.exporting'), path);
      const { exportEpub } = await load(run, () => import('./export/job'));
      await exportEpub(ctx, docId, run);
    },
  });
}
