/**
 * Feature 017 (D23 to D26, D31, D36, D38; tasks T040): File > Import > TXT File.... Static and small: it asks
 * about unsaved changes, opens the file dialog (text files and ZIP archives), asks which TXT of an archive
 * (D31) and the encoding when the judge cannot tell (D26), shows its progress, and only then loads its part,
 * the lazy chunk `txt-import`. The window's book is replaced only by the finished new one.
 */
import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { showArchiveBookChooser } from '@/dialogs/show';
import { cmdKeys } from '@/features/editing/common';
import type { FileFeature } from '@/features/file/fileCommands';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type ArchiveChoice } from '@/rpc/types';

import { encodingLabelKey, loadTxtEncodings } from './encodings';
import { showTxtEncodingQuestion } from './showTxtEncodingQuestion';

export const IMPORT_TXT_COMMAND = 'file.importTxt';

/** An archive's file, as txtImport.begin lists it. */
export interface TxtImportEntry {
  entry: string;
  size: number;
}

/** What the command hands its part once the text is read (every question asked before). */
export interface TxtImportRun {
  /** The TXT, or the ZIP archive holding it. */
  path: string;
  /** The TXT's entry when it comes from an archive. */
  entry?: string;
  /** The archive's FBD files (D32). */
  fbds: TxtImportEntry[];
  /** How many TXT files the archive holds (D32: one TXT and one FBD are a pair). */
  txts: number;
  token: string;
  text: string;
  encoding: string;
  source: 'bom' | 'utf8' | 'judged' | 'chosen';
  modal: ModalJobHandle;
  reopen: () => ModalJobHandle;
  cancelled: () => boolean;
}

const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** The message of a refused or failed import, in the interface's languages. */
export function txtImportReason(ctx: CommandContext, error: unknown): string {
  if (isRpcError(error) && error.code === RpcErrorCode.textImportRefused) {
    const data = (error.data ?? {}) as { reason?: string };
    const key = `txt.refused.${data.reason ?? 'damaged'}`;
    const text = ctx.t(key);
    return text === key ? ctx.t('txt.refused.damaged') : text;
  }
  return error instanceof Error ? error.message : String(error);
}

/** D31: the archive's TXT - the only one, or the one the user chooses (null for Cancel). */
async function chooseTxt(
  ctx: CommandContext,
  path: string,
  txts: TxtImportEntry[],
): Promise<string | null> {
  if (txts.length === 1) return txts[0]!.entry;
  const choice: ArchiveChoice = {
    archive: path,
    books: txts.map(({ entry, size }) => {
      const at = entry.lastIndexOf('/');
      return {
        entry,
        name: entry.slice(at + 1),
        folder: at >= 0 ? entry.slice(0, at) : '',
        size,
        kind: 'txt',
      };
    }),
    otherFiles: 0,
    booksTotal: txts.length,
  };
  return showArchiveBookChooser(ctx.dialogs, choice, baseName(path));
}

export function registerTxtImportFeature(commands: CommandRegistry, files: FileFeature): void {
  commands.replace({
    id: IMPORT_TXT_COMMAND,
    group: 'file',
    ...cmdKeys(IMPORT_TXT_COMMAND, 'menu.file.importTxt'),
    enabled: (ctx) => ctx.rpc !== null,
    run: async (ctx) => {
      const rpc = ctx.rpc;
      // D23: Source edits applied and unsaved changes asked about, as every import does.
      if (!rpc || !(await files.confirmDiscardChanges(ctx))) return;
      const { paths } = await rpc.call('dialog.openFile', {
        title: ctx.t('txt.openTitle'),
        filters: [
          { name: ctx.t('txt.filterAll'), extensions: ['txt', 'zip'] },
          { name: ctx.t('txt.filter'), extensions: ['txt'] },
          { name: ctx.t('txt.filterZip'), extensions: ['zip'] },
          { name: ctx.t('txt.filterAnyFile'), extensions: ['*'] },
        ],
        selectedFilter: 0,
      });
      const path = paths[0];
      if (!path) return;
      let token = '';
      try {
        let begun = await rpc.call('txtImport.begin', { path });
        let entry: string | undefined;
        let fbds: TxtImportEntry[] = [];
        let txts = 1;
        if ('archive' in begun) {
          fbds = begun.archive.fbds;
          txts = begun.archive.txts.length;
          const chosen = await chooseTxt(ctx, path, begun.archive.txts);
          if (!chosen) return;
          entry = chosen;
          begun = await rpc.call('txtImport.begin', { path, entry });
        }
        token = 'token' in begun ? begun.token : '';
        let read = await rpc.call('txtImport.read', { token });
        if ('needsEncoding' in read) {
          // D26: asked only when the judge cannot tell - its candidates first, then every other encoding.
          const lists = await loadTxtEncodings(rpc);
          const first = read.needsEncoding.candidates;
          const order = [
            ...first,
            ...lists.all.map((e) => e.name).filter((n) => !first.includes(n)),
          ];
          const chosen = await showTxtEncodingQuestion(ctx.dialogs, {
            encodings: order.map((name) => ({ name, label: ctx.t(encodingLabelKey(lists, name)) })),
            path: entry ?? path,
          });
          if (!chosen) {
            await rpc.call('txtImport.end', { token }).catch(() => undefined);
            return;
          }
          read = await rpc.call('txtImport.read', { token, encoding: chosen });
          if ('needsEncoding' in read) throw new Error(ctx.t('txt.refused.damaged'));
        }
        let cancelled = false;
        const begin = (): ModalJobHandle =>
          startModalJob(ctx.t('txt.importing'), () => {
            cancelled = true;
          });
        const modal = begin();
        const run: TxtImportRun = {
          path,
          entry,
          fbds,
          txts,
          token,
          text: read.text,
          encoding: read.encoding,
          source: read.source,
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
        await part.importTxt(ctx, files, run);
      } catch (error) {
        if (token) await rpc.call('txtImport.end', { token }).catch(() => undefined);
        await ctx.dialogs.showMessage({
          text: ctx.t('txt.importFailed', { path, reason: txtImportReason(ctx, error) }),
          caption: ctx.t('txt.importCaption'),
          icon: 'error',
          testId: 'dialog-txt-import-failed',
        });
      }
    },
  });
}
