/**
 * Feature 017 (D1 to D3, D10, D13, D17, DP-5, DP-6): File > Export > Export as TXT.... Static and small:
 * it asks the Save dialog for the file, the encoding, the byte-order mark and the ZIP box, shows its
 * progress at once, and only then loads its part, the lazy chunk `txt-export`. The options a book
 * exported with are kept for it (keptExportOptions.ts); its first export takes Settings > Exports'.
 */
import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { cmdKeys } from '@/features/editing/common';
import { confirmBookExport } from '@/features/file/exportCheck';
import {
  keepExportOptions,
  keptExportOptions,
  keptTxtEncoding,
} from '@/features/file/keptExportOptions';
import { proposedStem } from '@/features/file/proposedName';
import { commitPendingSource } from '@/views/source/sourceSession';

import { defaultEncoding, encodingLabelKey, loadTxtEncodings, offeredEncodings } from './encodings';
import { showTxtExportOptions } from './showTxtExportOptions';

export const EXPORT_TXT_COMMAND = 'file.exportTxt';

/** What the command hands its part once the user has chosen the file and the options. */
export interface TxtRun {
  path: string;
  encoding: string;
  bom: boolean;
  zip: boolean;
  /** The file's name without its extension: the title of a book without one (D16). */
  stem: string;
  modal: ModalJobHandle;
  cancelled: () => boolean;
}

function folderOf(path: string | null | undefined): string {
  if (!path) return '';
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at >= 0 ? path.slice(0, at + 1) : '';
}

function stemOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return name.replace(/\.(txt|zip)$/i, '');
}

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerTxtExportFeature(commands: CommandRegistry): void {
  commands.replace({
    id: EXPORT_TXT_COMMAND,
    group: 'file',
    ...cmdKeys(EXPORT_TXT_COMMAND, 'menu.file.exportTxt'),
    enabled: connectedWithDocument,
    run: async (ctx) => {
      const { store, rpc } = ctx;
      // D2: the book as the window has it, Source edits applied first.
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      const state = store.getState();
      if (!state.document || !state.docId) return;
      const docId = state.docId;
      if (!(await confirmBookExport(ctx)) || store.getState().docId !== docId) return;
      const lists = await loadTxtEncodings(rpc);
      const lang = state.document.description.titleInfo.lang;
      const offered = offeredEncodings(lists, lang);
      const kept = keptExportOptions(docId, 'txt');
      const settings = state.settings?.txt;
      const first = keptTxtEncoding(docId, offered) ?? defaultEncoding(lists, lang, settings);
      const firstBom = kept?.bom ?? settings?.bom ?? false;
      const firstZip = kept?.zip ?? settings?.zip ?? false;
      const labels = offered.map((name) => ctx.t(encodingLabelKey(lists, name)));
      const stem = proposedStem(state.document.description, ctx.t('app.untitled'));
      const answer = await rpc.call('dialog.saveFile', {
        title: ctx.t('cmd.file.exportTxt.tooltip'),
        filters: [{ name: ctx.t('txt.filter'), extensions: ['txt'] }],
        selectedFilter: 0,
        defaultPath: `${folderOf(state.path)}${stem}.txt`,
        encodingChoices: labels,
        selectedEncoding: labels[offered.indexOf(first)] ?? labels[0],
        encodingLabel: ctx.t('txt.encodingLabel'),
        zipChoice: { label: ctx.t('txt.zipChoice'), checked: firstZip },
        checks: [{ id: 'bom', label: ctx.t('txt.bomChoice'), checked: firstBom }],
      });
      if (!answer.path || store.getState().docId !== docId) return;
      const at = answer.encoding === undefined ? -1 : labels.indexOf(answer.encoding);
      let encoding = at >= 0 ? offered[at]! : null;
      let bom = answer.checks?.bom;
      let zip = answer.zip;
      // DP-5: a dialog that could not carry the list or the boxes - the editor's own window asks.
      if (encoding === null || bom === undefined || zip === undefined) {
        const asked = await showTxtExportOptions(ctx.dialogs, {
          encodings: offered.map((name, i) => ({ name, label: labels[i]! })),
          encoding: encoding ?? first,
          bom: bom ?? firstBom,
          zip: zip ?? firstZip,
          path: answer.path,
        });
        if (!asked) return;
        ({ encoding, bom, zip } = asked);
      }
      if (store.getState().docId !== docId) return;
      // D13: ticked, the name takes .zip; unticked, a .zip ending becomes .txt.
      const path = zip
        ? /\.zip$/i.test(answer.path)
          ? answer.path
          : `${answer.path.replace(/\.txt$/i, '')}.zip`
        : answer.path.replace(/\.zip$/i, '.txt');
      // D17: kept for the book from here on, even if the export is cancelled.
      keepExportOptions(docId, 'txt', { encoding, bom: !!bom, zip: !!zip });
      let cancelled = false;
      const modal = startModalJob(ctx.t('txt.exporting'), () => {
        cancelled = true;
      });
      const run: TxtRun = {
        path,
        encoding,
        bom: encoding === 'utf-8' && !!bom,
        zip: !!zip,
        stem: stemOf(path),
        modal,
        cancelled: () => cancelled,
      };
      try {
        const { exportTxt } = await import('./export/job');
        await exportTxt(ctx, docId, run);
      } catch (error) {
        modal.end();
        throw error;
      }
    },
  });
}
