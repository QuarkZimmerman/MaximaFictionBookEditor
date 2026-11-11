/**
 * Feature 012 (US1; D2, D3, D13, D33; FR-002-FR-005, FR-015): File > Export > Export as EPUB.... The
 * first module of the lazy chunk `epub-export`.
 *
 * The command applies Source edits (D3), shows the Save dialog - the book's name with `.epub` in its
 * folder, no options (D2) - and starts the progress before this part loads (index.ts, D32). The
 * export writes the book as the window has it; it is modal -
 * progress and *Cancel*, the window refuses to close - and leaves no trace: no Recent files, no
 * folder of its own, no setting, no change of the document (D33). The core puts the pictures into
 * the EPUB; the pages, the navigation and the package are built here and checked before anything
 * is committed (D4, FR-005); the core then writes the file atomically.
 */

import type { CommandContext } from '@/app/commands';
import { proposedStem } from '@/features/file/proposedName';
import type { Document } from '@/model/document';
import { epubWriteUrl } from '@/model/binaryUrls';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { EpubRun } from '../index';
import { NameAllocator } from '../shared/names';
import { wordsLanguage } from '../shared/words';
import { buildEpub, verifyEpub } from './build';
import type { PlacedPicture, SummaryItem } from './render';

class Cancelled extends Error {}

/** Lets the page draw (the progress bar) before the next long synchronous step. */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The binaries the book shows, the cover first, then in book order; each once (D12). */
export function usedPictures(document: Document): string[] {
  const used: string[] = [];
  const known = new Set(document.binaries.map((binary) => binary.id));
  const add = (href: string | undefined): void => {
    if (!href?.startsWith('#')) return;
    const id = href.slice(1);
    if (known.has(id) && !used.includes(id)) used.push(id);
  };
  add(document.description.titleInfo.coverpage[0]?.href);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (node.type === 'image' || node.type === 'inline-image') add(node.attrs?.href);
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  if (document.description.titleInfo.annotation) visit(document.description.titleInfo.annotation);
  for (const body of document.bodies) visit(body);
  return used;
}

async function put(token: string, name: string, text: string): Promise<void> {
  const response = await fetch(epubWriteUrl(token, name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new TextEncoder().encode(text),
  });
  if (!response.ok) {
    throw new Error(
      `${name}: ${response.status} ${response.headers.get('X-MFBE-Reason') ?? ''}`.trim(),
    );
  }
}

/** The summary's lines: one per kind and detail, with a count when repeated. */
function summaryLines(ctx: CommandContext, summary: readonly SummaryItem[]): string[] {
  const counted = new Map<string, { item: SummaryItem; count: number }>();
  for (const item of summary) {
    const key = `${item.kind}\u0000${item.detail}`;
    const entry = counted.get(key);
    if (entry) entry.count++;
    else counted.set(key, { item, count: 1 });
  }
  const lines = [...counted.values()].map(({ item, count }) => {
    const detail = item.kind === 'gapFilled' ? ctx.t(`epub.gap.${item.detail}`) : item.detail;
    const line = ctx.t(`epub.summary.${item.kind}`, { detail });
    return count > 1 ? `${line} (\u00d7${count})` : line;
  });
  const shown = lines.slice(0, 40).map((line) => `\u2022 ${line}`);
  if (lines.length > 40) shown.push(ctx.t('epub.summaryMore', { count: lines.length - 40 }));
  return shown;
}

/**
 * The export of the book `docId` to `run.path` under `run.modal`, which the command started once the
 * Save dialog gave a file (index.ts, D32); resolves true once the file is written.
 */
export async function exportEpub(
  ctx: CommandContext,
  docId: string,
  run: EpubRun,
): Promise<boolean> {
  const { store, rpc } = ctx;
  const { path, modal } = run;
  const current = store.getState();
  if (!rpc || !current.document || current.docId !== docId) {
    modal.end();
    return false;
  }
  const document = current.document;
  let token: string | null = null;
  try {
    token = (await rpc.call('epub.write.begin', { path, docId })).token;
    const genres = await rpc
      .call('resources.genres')
      .then((list) => {
        const language = wordsLanguage(document.description.titleInfo.lang);
        return new Map(
          list.entries.map((entry) => [
            entry.code,
            entry.names[language] ?? entry.names.en ?? entry.code,
          ]),
        );
      })
      .catch(() => undefined);
    const pictures = usedPictures(document);
    let total = pictures.length + 2;
    let done = 0;
    const names = new NameAllocator();
    const placed = new Map<string, PlacedPicture>();
    const leftOut: SummaryItem[] = [];
    for (const binaryId of pictures) {
      if (run.cancelled()) throw new Cancelled();
      try {
        const result = await rpc.call('epub.write.binary', {
          token,
          stem: names.allocate('EPUB/images/', binaryId, ''),
          docId,
          binaryId,
        });
        placed.set(binaryId, { name: result.name, mediaType: result.mediaType });
      } catch (error) {
        if (
          !isRpcError(error) ||
          (error.code !== RpcErrorCode.binaryNotImage && error.code !== RpcErrorCode.binaryNotFound)
        ) {
          throw error;
        }
        leftOut.push({ kind: 'pictureLeftOut', detail: `#${binaryId}` });
      }
      modal.progress(++done, total);
    }
    if (run.cancelled()) throw new Cancelled();
    const built = buildEpub({
      document,
      pictures: placed,
      modified: new Date(),
      // D4: a book without a title takes the name the Save dialog proposed (index.ts).
      fallbackTitle: proposedStem(document.description, ctx.t('app.untitled')),
      genreNames: genres,
    });
    // SC-010: the progress moves at least once a second - the files go to the core one by one, each a
    // step, and the bar is drawn between the long steps.
    total = pictures.length + built.files.length + 3;
    modal.progress(++done, total);
    await nextTask();
    const faults = verifyEpub(
      built.files,
      [...placed.values()].map((picture) => picture.name),
    );
    if (faults.length > 0) {
      throw new Error(faults.slice(0, 5).join('\n'));
    }
    modal.progress(++done, total);
    for (const file of built.files) {
      if (run.cancelled()) throw new Cancelled();
      await put(token, file.name, file.text);
      modal.progress(++done, total);
    }
    await rpc.call('epub.write.commit', { token });
    token = null;
    modal.progress(total, total);
    modal.end();

    const summary = [
      ...leftOut,
      ...built.summary.filter(
        (item) =>
          item.kind !== 'pictureLeftOut' || !leftOut.some((left) => left.detail === item.detail),
      ),
    ];
    const counts = ctx.t('epub.exportDone', {
      path,
      pages: built.counts.pages,
      pictures: built.counts.pictures,
      tables: built.counts.tables,
      notes: built.counts.notes,
    });
    if (summary.length === 0) {
      actions.setStatusMessage(store, counts);
    } else {
      await ctx.dialogs.showMessage({
        text: `${counts}\n\n${ctx.t('epub.exportSummaryIntro')}\n${summaryLines(ctx, summary).join('\n')}`,
        caption: ctx.t('epub.exportCaption'),
        icon: 'info',
        testId: 'dialog-epub-export-summary',
      });
    }
    return true;
  } catch (error) {
    modal.end();
    if (token) await rpc.call('epub.write.abort', { token }).catch(() => undefined);
    if (run.cancelled() || error instanceof Cancelled) {
      actions.setStatusMessage(store, ctx.t('epub.exportCancelled'));
      return false;
    }
    let detail = error instanceof Error ? error.message : String(error);
    if (isRpcError(error) && error.code === RpcErrorCode.epubWriteFailed) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'epub.ioError';
      detail = ctx.t(`epub.writeFailed.${reason.replace(/^epub\./, '')}`, { path });
    }
    await ctx.dialogs.showMessage({
      text: ctx.t('epub.exportFailed', { path, detail }),
      caption: ctx.t('epub.exportCaption'),
      icon: 'error',
      testId: 'dialog-epub-export-failed',
    });
    return false;
  }
}
