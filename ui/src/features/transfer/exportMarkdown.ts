/**
 * Feature 011 (US5, US6; D13-D28, D32; FR-040-FR-062): File > Export as Markdown… and Export as
 * Markdown ZIP…. The interface writes the text (`serializeMarkdown`); the core job
 * `export.markdown` writes the file with its pictures. The export is modal - progress and *Cancel*,
 * the window refuses to close - and leaves no trace: no Save dialog role (the folder Open starts in
 * stays), no change of the document, its file, the settings or Recent files.
 */
import type { CommandContext } from '@/app/commands';
import { startModalJob } from '@/app/modalJob';
import { proposedStem } from '@/features/file/proposedName';
import { serializeMarkdown } from '@/features/markdown/export/serialize';
import { actions } from '@/model/store';
import { commitPendingSource } from '@/views/source/sourceSession';

export type MarkdownForm = 'md' | 'zip';

/** The whole flow of an export; resolves true once the file is written. */
export async function exportMarkdown(ctx: CommandContext, form: MarkdownForm): Promise<boolean> {
  const { store, rpc } = ctx;
  if (!rpc) return false;
  if ((await commitPendingSource(ctx)) === 'error') return false;
  const state = store.getState();
  if (!state.document || !state.docId) return false;
  const docId = state.docId;
  const stem = proposedStem(state.document.description, ctx.t('app.untitled'));
  const one = form === 'md';
  const choice = await rpc.call('dialog.saveFile', {
    title: ctx.t(one ? 'cmd.file.exportMarkdown.tooltip' : 'cmd.file.exportMarkdownZip.tooltip'),
    filters: [
      {
        name: ctx.t(one ? 'transfer.markdown.filterMd' : 'transfer.markdown.filterZip'),
        extensions: [one ? 'md' : 'zip'],
      },
    ],
    selectedFilter: 0,
    defaultPath: `${stem}.${one ? 'md' : 'md.zip'}`,
    // The Save dialog's checkbox of feature 009 carries *Include pictures*, ticked every time (D14).
    ...(one
      ? { zipChoice: { label: ctx.t('transfer.markdown.includePictures'), checked: true } }
      : {}),
  });
  const path = choice.path;
  if (!path) return false;
  let includePictures = true;
  if (one && choice.zip !== undefined) includePictures = choice.zip;
  else if (one && state.document.binaries.length > 0) {
    // A system dialog that cannot carry the box: the editor asks (D14).
    includePictures =
      (await ctx.dialogs.showMessage({
        text: ctx.t('transfer.markdown.includePicturesQuestion'),
        caption: ctx.t('app.name'),
        buttons: 'yesNo',
        icon: 'question',
        defaultButton: 'yes',
        testId: 'dialog-markdown-pictures',
      })) === 'yes';
  }
  const current = store.getState();
  if (!current.document || current.docId !== docId) return false;
  const serialized = serializeMarkdown(current.document, { form, includePictures });
  let jobId: string | null = null;
  let cancelled = false;
  const modal = startModalJob(ctx.t('transfer.markdown.exporting'), () => {
    cancelled = true;
    if (jobId) void rpc.call('job.cancel', { jobId }).catch(() => undefined);
  });
  let result: { pictures: number; skipped: string[] };
  try {
    result = await rpc.runJob(
      'export.markdown',
      {
        docId,
        path,
        form,
        text: serialized.text,
        pictures: serialized.pictures,
        includePictures,
      },
      {
        onStart: (id) => {
          jobId = id;
          if (cancelled) void rpc.call('job.cancel', { jobId: id }).catch(() => undefined);
        },
        onProgress: (progress) => modal.progress(progress.done, progress.total),
      },
    );
  } catch (error) {
    modal.end();
    if (cancelled) {
      actions.setStatusMessage(store, ctx.t('transfer.markdown.cancelled'));
      return false;
    }
    throw error;
  }
  modal.end();
  const { written } = serialized;
  // The pictures the core could not read are left out too (SC-011).
  const leftOut = serialized.leftOut.length + (result.skipped?.length ?? 0);
  const tooLarge = one && serialized.text.length > 128 * 1024 * 1024;
  actions.setStatusMessage(
    store,
    ctx.t(leftOut > 0 ? 'transfer.markdown.doneWithLeftOut' : 'transfer.markdown.done', {
      path,
      sections: written.sections,
      pictures: result.pictures ?? written.pictures,
      tables: written.tables,
      notes: written.notes,
      count: leftOut,
    }) + (tooLarge ? ` ${ctx.t('transfer.markdown.tooLargeToImport')}` : ''),
  );
  return true;
}
