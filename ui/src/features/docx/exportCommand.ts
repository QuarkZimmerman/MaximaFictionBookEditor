/**
 * Feature 023 (T021; FR-001..FR-005): static entry for File > Export > Export as DOCX....
 * Stays in the main bundle and dynamically loads `./export/docxExportJob` (`docx-export` lazy
 * chunk) only after the user confirms the Save dialog (and optional fallback modal).
 */
import { createElement } from 'react';

import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { docxExportFileTypes } from '@/dialogs/fileTypes';
import { cmdKeys } from '@/features/editing/common';
import { confirmCompletedTarget } from '@/features/file/completedTarget';
import { confirmBookExport } from '@/features/file/exportCheck';
import { keepExportOptions, keptExportOptions } from '@/features/file/keptExportOptions';
import { proposedStem } from '@/features/file/proposedName';
import { PDF_PAGE_SIZES } from '@/features/pdf/pageSizes';
import type { PdfPageSizeId } from '@/rpc/types';
import { commitPendingSource } from '@/views/source/sourceSession';

import { DocxExportOptions, type DocxExportOptionsChoice } from './DocxExportOptions';
import { isDocxPageSizeId, resolveDocxSettings, type DocxSettings } from './docxSettingsSchema';

export const EXPORT_DOCX_COMMAND = 'file.exportDocx';

export interface DocxExportRun {
  docId: string;
  path: string;
  zip: boolean;
  settings: DocxSettings;
  modal: ModalJobHandle;
  cancelled: () => boolean;
}

function folderOf(path: string | null | undefined): string {
  if (!path) return '';
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at >= 0 ? path.slice(0, at + 1) : '';
}

function finalizeTargetPath(rawPath: string, zip: boolean): string {
  if (zip) {
    return /\.zip$/i.test(rawPath) ? rawPath : `${rawPath.replace(/\.docx$/i, '')}.zip`;
  }
  const stripped = rawPath.replace(/\.(docx|zip)$/i, '');
  return `${stripped}.docx`;
}

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerDocxExportFeature(commands: CommandRegistry): void {
  commands.replace({
    id: EXPORT_DOCX_COMMAND,
    group: 'file',
    ...cmdKeys(EXPORT_DOCX_COMMAND, 'menu.file.exportDocx'),
    enabled: connectedWithDocument,
    run: async (ctx) => {
      const { store, rpc } = ctx;
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      const state = store.getState();
      if (!state.document || !state.docId) return;
      const docId = state.docId;
      if (!(await confirmBookExport(ctx)) || store.getState().docId !== docId) return;

      const resolved = resolveDocxSettings(state.settings?.docx);
      const kept = keptExportOptions(docId, 'docx');
      const initPageSize: PdfPageSizeId = isDocxPageSizeId(kept?.pageSize)
        ? kept.pageSize
        : resolved.defaultPageSize;
      const initZip: boolean = kept?.zip ?? resolved.zip;

      const stem = proposedStem(state.document.description, ctx.t('app.untitled'));
      const initExt = initZip ? 'zip' : 'docx';

      const answer = await rpc.call('dialog.saveFile', {
        title: ctx.t('docx.exportTitle'),
        filters: docxExportFileTypes(ctx.t),
        selectedFilter: initZip ? 1 : 0,
        defaultPath: `${folderOf(state.path)}${stem}.${initExt}`,
        zipChoice: {
          label: ctx.t('docx.zipChoice'),
          checked: initZip,
          rename: 'replace',
          filter: 1,
        },
        selects: [
          {
            id: 'pageSize',
            label: ctx.t('docx.pageSizeLabel'),
            selected: initPageSize,
            choices: PDF_PAGE_SIZES.map((s) => ({
              value: s.id,
              label: ctx.t(`pdf.sizes.${s.id}`),
            })),
          },
        ],
      });

      if (!answer.path || store.getState().docId !== docId) return;

      const returnedSize = answer.selects?.pageSize;
      let pageSize: PdfPageSizeId | null = isDocxPageSizeId(returnedSize) ? returnedSize : null;
      let zip: boolean | undefined = answer.zip;

      if (pageSize === null || zip === undefined) {
        const asked = await ctx.dialogs.openCustom<DocxExportOptionsChoice | null>((close) =>
          createElement(DocxExportOptions, {
            pageSize: pageSize ?? initPageSize,
            zip: zip ?? initZip,
            path: answer.path,
            onClose: close,
          }),
        );
        if (!asked) return;
        ({ pageSize, zip } = asked);
      }

      if (store.getState().docId !== docId) return;

      const finalPath = finalizeTargetPath(answer.path, zip);
      if (!(await confirmCompletedTarget(ctx, answer.path, finalPath))) return;
      if (store.getState().docId !== docId) return;

      // Remember choices for this open book once export actually begins (never writes global Settings).
      keepExportOptions(docId, 'docx', { pageSize, zip });

      let cancelled = false;
      const modal = startModalJob(ctx.t('docx.exporting'), () => {
        cancelled = true;
      });
      const run: DocxExportRun = {
        docId,
        path: finalPath,
        zip,
        settings: { ...resolved, defaultPageSize: pageSize, zip },
        modal,
        cancelled: () => cancelled,
      };
      try {
        const { exportDocx } = await import('./export/docxExportJob');
        await exportDocx(ctx, docId, run);
      } catch (error) {
        modal.end();
        throw error;
      }
    },
  });
}
