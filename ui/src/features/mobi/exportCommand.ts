/**
 * Feature 018 (T023, FR-001..FR-005, FR-050): static entry for File > Export > Export as MOBI....
 * Stays in the main bundle and dynamically loads `./export/job` (`mobi-export` lazy chunk) only
 * after the user confirms the Save dialog (and optional fallback modal).
 */
import { createElement } from 'react';

import type { CommandContext, CommandRegistry } from '@/app/commands';
import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { mobiExportFileTypes } from '@/dialogs/fileTypes';
import { cmdKeys } from '@/features/editing/common';
import { confirmCompletedTarget } from '@/features/file/completedTarget';
import { confirmBookExport } from '@/features/file/exportCheck';
import { keepExportOptions, keptExportOptions } from '@/features/file/keptExportOptions';
import { proposedStem } from '@/features/file/proposedName';
import type { MobiFormat, MobiOpenAt, MobiSeriesInTitle, MobiTocPlacement } from '@/rpc/types';
import { commitPendingSource } from '@/views/source/sourceSession';

import { MobiExportOptions, type MobiExportOptionsChoice } from './MobiExportOptions';

export const EXPORT_MOBI_COMMAND = 'file.exportMobi';

export interface MobiExportRun {
  docId: string;
  path: string;
  format: MobiFormat;
  tocPlacement: MobiTocPlacement;
  seriesInTitle: MobiSeriesInTitle;
  openAt: MobiOpenAt;
  kf8PopupFootnotes: boolean;
  zip: boolean;
  modal: ModalJobHandle;
  cancelled: () => boolean;
}

function folderOf(path: string | null | undefined): string {
  if (!path) return '';
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at >= 0 ? path.slice(0, at + 1) : '';
}

function isMobiFormat(v: string | undefined): v is MobiFormat {
  return v === 'mobi7' || v === 'joint' || v === 'kf8';
}

function isTocPlacement(v: string | undefined): v is MobiTocPlacement {
  return v === 'afterTitle' || v === 'end' || v === 'none';
}

function finalizeTargetPath(rawPath: string, format: MobiFormat, zip: boolean): string {
  if (zip) {
    return /\.zip$/i.test(rawPath)
      ? rawPath
      : `${rawPath.replace(/\.(mobi|azw3|azw|prc)$/i, '')}.zip`;
  }
  const ext = format === 'kf8' ? 'azw3' : 'mobi';
  const stripped = rawPath.replace(/\.(mobi|azw3|azw|prc|zip)$/i, '');
  return `${stripped}.${ext}`;
}

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null;

export function registerMobiExportFeature(commands: CommandRegistry): void {
  commands.replace({
    id: EXPORT_MOBI_COMMAND,
    group: 'file',
    ...cmdKeys(EXPORT_MOBI_COMMAND, 'menu.file.exportMobi'),
    enabled: connectedWithDocument,
    run: async (ctx) => {
      const { store, rpc } = ctx;
      // Apply pending Source edits first (never mutates book silently if malformed).
      if (!rpc || (await commitPendingSource(ctx)) === 'error') return;
      const state = store.getState();
      if (!state.document || !state.docId) return;
      const docId = state.docId;
      if (!(await confirmBookExport(ctx)) || store.getState().docId !== docId) return;

      const settings = state.settings?.mobi;
      const kept = keptExportOptions(docId, 'mobi');
      const initFormat: MobiFormat = kept?.format ?? settings?.format ?? 'joint';
      const initToc: MobiTocPlacement =
        kept?.tocPlacement ?? settings?.tocPlacement ?? 'afterTitle';
      const initZip: boolean = kept?.zip ?? settings?.zip ?? false;
      const seriesInTitle: MobiSeriesInTitle = settings?.seriesInTitle ?? 'seriesAndNumber';
      const openAt: MobiOpenAt = settings?.openAt ?? 'titlePage';
      const kf8PopupFootnotes: boolean = settings?.kf8PopupFootnotes ?? true;

      const stem = proposedStem(state.document.description, ctx.t('app.untitled'));
      const initExt = initZip ? 'zip' : initFormat === 'kf8' ? 'azw3' : 'mobi';
      const selectedFilter = initZip ? 2 : initFormat === 'kf8' ? 1 : 0;

      const answer = await rpc.call('dialog.saveFile', {
        title: ctx.t('mobi.exportTitle'),
        filters: mobiExportFileTypes(ctx.t),
        selectedFilter,
        defaultPath: `${folderOf(state.path)}${stem}.${initExt}`,
        zipChoice: {
          label: ctx.t('mobi.zipChoice'),
          checked: initZip,
          rename: 'replace',
          filter: 2,
        },
        selects: [
          {
            id: 'format',
            label: ctx.t('mobi.formatLabel'),
            selected: initFormat,
            choices: [
              { value: 'joint', label: ctx.t('mobi.formats.joint'), extension: 'mobi' },
              { value: 'mobi7', label: ctx.t('mobi.formats.mobi7'), extension: 'mobi' },
              { value: 'kf8', label: ctx.t('mobi.formats.kf8'), extension: 'azw3' },
            ],
          },
          {
            id: 'tocPlacement',
            label: ctx.t('mobi.tocLabel'),
            selected: initToc,
            choices: [
              { value: 'afterTitle', label: ctx.t('mobi.tocPlacements.afterTitle') },
              { value: 'end', label: ctx.t('mobi.tocPlacements.end') },
              { value: 'none', label: ctx.t('mobi.tocPlacements.none') },
            ],
          },
        ],
      });

      if (!answer.path || store.getState().docId !== docId) return;

      const returnedFormat = answer.selects?.format;
      const returnedToc = answer.selects?.tocPlacement;
      let format: MobiFormat | null = isMobiFormat(returnedFormat) ? returnedFormat : null;
      let tocPlacement: MobiTocPlacement | null = isTocPlacement(returnedToc) ? returnedToc : null;
      let zip: boolean | undefined = answer.zip;

      // Fallback modal when platform dialog could not carry selects or zip checkbox.
      if (format === null || tocPlacement === null || zip === undefined) {
        const asked = await ctx.dialogs.openCustom<MobiExportOptionsChoice | null>((close) =>
          createElement(MobiExportOptions, {
            format: format ?? initFormat,
            tocPlacement: tocPlacement ?? initToc,
            zip: zip ?? initZip,
            path: answer.path,
            onClose: close,
          }),
        );
        if (!asked) return;
        ({ format, tocPlacement, zip } = asked);
      }

      if (store.getState().docId !== docId) return;

      const finalPath = finalizeTargetPath(answer.path, format, zip);
      if (!(await confirmCompletedTarget(ctx, answer.path, finalPath))) return;
      if (store.getState().docId !== docId) return;

      // Remember choices for this open book once export actually begins (even if later cancelled).
      keepExportOptions(docId, 'mobi', { format, tocPlacement, zip });

      let cancelled = false;
      const modal = startModalJob(ctx.t('mobi.exporting'), () => {
        cancelled = true;
      });
      const run: MobiExportRun = {
        docId,
        path: finalPath,
        format,
        tocPlacement,
        seriesInTitle,
        openAt,
        kf8PopupFootnotes,
        zip,
        modal,
        cancelled: () => cancelled,
      };
      try {
        const { exportMobi } = await import('./export/job');
        await exportMobi(ctx, docId, run);
      } catch (error) {
        modal.end();
        throw error;
      }
    },
  });
}
