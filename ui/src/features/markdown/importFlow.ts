/**
 * Feature 010, US8 (spec D26-D32, D36; FR-080-FR-094): the Markdown import. The question about
 * unsaved changes, the file, its text (the encoding asked only when the core cannot tell), the
 * template, the conversion in the worker, a new untitled book from the FB2 text, its pictures -
 * and only then is the window's book closed (D36). A summary lists what could not come over as
 * written; otherwise the status bar says what came in.
 */

import type { CommandContext } from '@/app/commands';
import { showEncodingDialog } from '@/dialogs/show';
import { addBinariesToModel } from '@/features/images/binaries';
import type { FileFeature } from '@/features/file/fileCommands';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type MarkdownText } from '@/rpc/types';

import type { SummaryItem } from './convert';
import { buildBook } from './describe';
import { addPictures } from './pictures';
import { convertInWorker } from './run';

function parts(path: string): { folder: string; stem: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(at + 1);
  return { folder: at >= 0 ? path.slice(0, at) : '', stem: name.replace(/\.(md|markdown)$/i, '') };
}

async function readText(ctx: CommandContext, path: string): Promise<MarkdownText | null> {
  const rpc = ctx.rpc!;
  const first = await rpc.call('import.readMarkdown', { path });
  if (!('needsEncoding' in first)) return first;
  // D31: asked only when the judge cannot tell - the most plausible encodings, best first.
  const candidates = first.needsEncoding.candidates;
  const answer = await showEncodingDialog(ctx.dialogs, {
    defaultEncoding: candidates[0] ?? 'utf-8',
    path,
  });
  if (!answer) return null;
  const chosen = await rpc.call('import.readMarkdown', { path, encoding: answer });
  return 'needsEncoding' in chosen ? null : chosen;
}

/** Runs the import; false when cancelled or refused (the window's book is then unchanged). */
export async function importMarkdown(
  ctx: CommandContext,
  files: FileFeature,
  given?: string,
): Promise<boolean> {
  const rpc = ctx.rpc;
  if (!rpc) return false;
  if (!(await files.confirmDiscardChanges(ctx))) return false;
  let path = given;
  if (!path) {
    const { paths } = await rpc.call('dialog.openFile', {
      title: ctx.t('markdown.openTitle'),
      filters: [
        { name: ctx.t('markdown.filter'), extensions: ['md', 'markdown'] },
        { name: ctx.t('markdown.allFiles'), extensions: ['*'] },
      ],
      selectedFilter: 0,
    });
    path = paths[0];
  }
  if (!path) return false;
  try {
    const text = await readText(ctx, path);
    if (!text) return false;
    const { xml: templateXml } = await rpc.call('template.xml');
    const genres = await rpc
      .call('resources.genres')
      .then((list) => new Set(list.entries.map((entry) => entry.code)))
      .catch(() => undefined);
    const { folder, stem } = parts(path);
    const result = await convertInWorker(text.text, {
      fileName: stem,
      baseDir: folder,
      notesTitle: ctx.t('editing.footnote.notesTitle'),
      genres,
    });
    const opened = await rpc.runJob('doc.newFromXml', {
      xml: buildBook(templateXml, result),
      origin: { kind: 'markdown', path },
    });
    await files.loadImported(ctx, opened.document, path);
    const outcome = await addPictures(rpc, opened.document.docId, result.pictures, result.chars);
    addBinariesToModel(ctx.store, outcome.added);
    const summary: SummaryItem[] = [...result.summary];
    for (const failed of outcome.failed) {
      summary.push({
        kind: 'webPicture',
        detail: `${failed.source} (${ctx.t(`markdown.picture.${failed.reason}`)})`,
      });
    }
    const counts = ctx.t('markdown.done', {
      encoding: text.encoding,
      sections: result.stats.sections,
      pictures: result.stats.pictures,
      tables: result.stats.tables,
      notes: result.stats.notes,
    });
    if (summary.length === 0) {
      actions.setStatusMessage(ctx.store, counts);
    } else {
      await ctx.dialogs.showMessage({
        text: `${counts}\n\n${ctx.t('markdown.summaryIntro')}\n${summary
          .map(
            (item) => `\u2022 ${ctx.t(`markdown.summary.${item.kind}`, { detail: item.detail })}`,
          )
          .join('\n')}`,
        caption: ctx.t('markdown.caption'),
        icon: 'info',
        testId: 'dialog-markdown-summary',
      });
    }
    return true;
  } catch (error) {
    const reason =
      isRpcError(error) && error.code === RpcErrorCode.importNotText
        ? ctx.t('markdown.notText')
        : isRpcError(error) && error.code === RpcErrorCode.importTooLarge
          ? ctx.t('markdown.tooLarge')
          : error instanceof Error
            ? error.message
            : String(error);
    await ctx.dialogs.showMessage({
      text: ctx.t('markdown.failed', { path, reason }),
      caption: ctx.t('dialog.error.caption'),
      icon: 'error',
      testId: 'dialog-markdown-failed',
    });
    return false;
  }
}
