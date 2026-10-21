/**
 * File > Import > Description from FictionBook file... (feature 004 US4; spec FR-030 to
 * FR-036; research R3.2 steps 1-7, data-model §4.3):
 *
 *  1. pending Source text is parsed back first; malformed XML refuses with the usual message;
 *  2. the native open dialog offers the three document types, descriptors selected, in the
 *     folder last used (the core remembers it for every document dialog - FR-053);
 *  3. `doc.readDescription` reads the file as Open does (a job with Open's progress above
 *     2 MB) into a hidden import session; nothing importable is reported and nothing changes;
 *  4. an untouched new document (never saved, description equal to its baseline) takes every
 *     entry silently; otherwise the confirmation dialog lists the entries with unticked
 *     checkboxes and Import takes the ticked ones; Cancel changes nothing;
 *  5. the image data of the chosen covers comes across through `binary.copy` (inside the
 *     core), building the `#old -> #new` map the applied references follow;
 *  6. the result is shown through the Body controller's `showModel` (the blocks follow) or
 *     the store, the Source text reloaded when that view is active, as one undo step holding
 *     the document before and after (the snapshot entry of a script run);
 *  7. the status bar counts the imported entries; the active view stays; the import session
 *     is closed whatever happened.
 *
 * Errors of the read are Open's: 1004 not a FictionBook document, 1001 not well-formed (no
 * Source-only fallback here), 1002 unreadable or missing - one message, the document untouched.
 */

import i18next from 'i18next';
import { createElement } from 'react';

import type { CommandContext } from '@/app/commands';
import { describeError, isClientSideError, logUiError } from '@/app/diagnostics';
import { fileType } from '@/dialogs/fileTypes';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type DocParseErrorData, type FileFilter } from '@/rpc/types';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';
import { getSourceEditor } from '@/views/source/sourceEditor';
import { commitPendingSource } from '@/views/source/sourceSession';

import { ImportDescriptionDialog } from './ImportDescriptionDialog';
import {
  applyEntries,
  importableEntries,
  type ImportableEntry,
  type ReadDescriptionResult,
} from './importEntries';
import { isUntouchedNewDocument } from './untouched';

/** The open dialog's types: descriptors first and selected, then FictionBook files, All files. */
export function importFileTypes(t: CommandContext['t']): FileFilter[] {
  return [
    fileType(t('fileDialogs.types.fictionBookDescriptors'), ['fbd']),
    fileType(t('fileDialogs.types.fictionBook'), ['fb2']),
    fileType(t('fileDialogs.types.all'), ['*']),
  ];
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** The reason of a failed call for a message: the core's `data.reason`, else the error's text. */
export function errorReason(error: unknown): string {
  if (error instanceof RpcError) {
    const data = error.data as { reason?: unknown } | undefined;
    if (data && typeof data.reason === 'string' && data.reason) return data.reason;
    // Stable RPC error names (`doc.ioError`, ...) have catalogue entries.
    const key = `error.${error.message}`;
    if (i18next.exists(key)) return i18next.t(key, { ...(error.data as object) });
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The message of a failed read (FR-031: "a message names the problem"). */
function failureText(ctx: CommandContext, path: string, error: unknown): string {
  if (error instanceof RpcError && error.code === RpcErrorCode.docNotFictionBook) {
    return ctx.t('msg.notFictionBook', { path });
  }
  if (error instanceof RpcError && error.code === RpcErrorCode.docParseError) {
    const data = (error.data ?? {}) as Partial<DocParseErrorData>;
    return ctx.t('msg.xmlParseError', {
      where: fileName(path),
      line: typeof data.line === 'number' ? data.line : 0,
      column: typeof data.column === 'number' ? data.column : 0,
      message: typeof data.message === 'string' ? data.message : error.message,
    });
  }
  return ctx.t('msg.openFailed', { path, reason: errorReason(error) });
}

/** Shows `document` in the editors and the store without switching the view (FR-035). */
function show(ctx: CommandContext, document: Document): void {
  const { store } = ctx;
  if (hasBodyController(store)) getBodyController(store).showModel(document);
  else actions.updateDocument(store, document);
  if (store.getState().activeView === 'source') {
    // The Source view loads its text on mount only: without the reload its stale text would
    // be parsed back over the import at the next commit.
    void getSourceEditor(store)?.load(ctx);
  }
}

/**
 * Copies the image data the chosen entries refer to from the import session into the open
 * document; returns the `#old -> #new` map and the metadata of the binaries added.
 */
async function copyBinaries(
  ctx: CommandContext,
  docId: string,
  importId: string,
  entries: readonly ImportableEntry[],
): Promise<{ map: Map<string, string>; added: Document['binaries'] }> {
  const rpc = ctx.rpc!;
  const map = new Map<string, string>();
  const added: Document['binaries'] = [];
  const hrefs = new Set<string>();
  for (const entry of entries) for (const href of entry.hrefs) hrefs.add(href);
  for (const href of hrefs) {
    const meta = await rpc.call('binary.copy', { docId, fromDocId: importId, id: href.slice(1) });
    map.set(href, `#${meta.id}`);
    if (!meta.existing) {
      const stored: Document['binaries'][number] & { existing?: boolean } = { ...meta };
      delete stored.existing;
      added.push(stored);
    }
  }
  return { map, added };
}

/** The whole flow of the Import command; resolves once the status bar reports the outcome. */
export async function importDescription(ctx: CommandContext): Promise<boolean> {
  const { store, rpc } = ctx;
  if (!rpc) return false;
  if ((await commitPendingSource(ctx)) === 'error') return false;
  const state = store.getState();
  if (!state.document || !state.docId) return false;
  const docId = state.docId;

  const { paths } = await rpc.call('dialog.openFile', {
    title: ctx.t('cmd.file.importDescription.tooltip'),
    filters: importFileTypes(ctx.t),
    selectedFilter: 0,
  });
  const path = paths[0];
  if (!path) return false;

  let read: ReadDescriptionResult;
  try {
    read = await rpc.runJob(
      'doc.readDescription',
      { docId, path },
      { onProgress: (progress) => actions.setProgress(store, progress) },
    );
  } catch (error) {
    if (isClientSideError(error)) {
      void logUiError(rpc, {
        code: 'transfer.importFailed',
        ...describeError(error),
        context: { docId, path },
      });
    }
    await ctx.dialogs.showMessage({
      text: failureText(ctx, path, error),
      caption: ctx.t('dialog.error.caption'),
      icon: 'error',
      testId: 'dialog-import-failed',
    });
    return false;
  } finally {
    actions.setProgress(store, null);
  }

  try {
    const entries = importableEntries(read);
    if (entries.length === 0) {
      await ctx.dialogs.showMessage({
        text: ctx.t('transfer.import.nothing', { path }),
        caption: ctx.t('app.name'),
        icon: 'info',
        testId: 'dialog-import-nothing',
      });
      return false;
    }

    let chosen: ImportableEntry[];
    if (isUntouchedNewDocument(store.getState())) {
      chosen = entries;
    } else {
      const ticked = await ctx.dialogs.openCustom<string[] | null>((close) =>
        createElement(ImportDescriptionDialog, {
          importId: read.importId,
          entries,
          onClose: close,
        }),
      );
      if (!ticked || ticked.length === 0) return false;
      const wanted = new Set(ticked);
      chosen = entries.filter((entry) => wanted.has(entry.key));
    }

    // The document may have been replaced while the dialog was up (a reload after an
    // external change); the import then leaves it alone.
    const before = store.getState().document;
    if (!before || store.getState().docId !== docId) return false;
    const { map, added } = await copyBinaries(ctx, docId, read.importId, chosen);
    const after: Document = {
      ...before,
      description: applyEntries(
        before.description,
        read,
        chosen.map((entry) => entry.key),
        map,
      ),
      binaries: [...before.binaries, ...added],
    };
    // One undo step independent of any view history, recorded against the view the import
    // was made in (undoing it brings that view back, as every undo does).
    const view = store.getState().activeView;
    show(ctx, after);
    ctx.undo.recordSnapshot(view, ctx.t('transfer.import.undoLabel'), {
      undo: () => show(ctx, before),
      redo: () => show(ctx, after),
    });
    actions.setStatusMessage(store, ctx.t('transfer.import.done', { count: chosen.length }));
    return true;
  } catch (error) {
    if (isClientSideError(error)) {
      void logUiError(rpc, {
        code: 'transfer.importFailed',
        ...describeError(error),
        context: { docId, path },
      });
    }
    await ctx.dialogs.showMessage({
      text: failureText(ctx, path, error),
      caption: ctx.t('dialog.error.caption'),
      icon: 'error',
      testId: 'dialog-import-failed',
    });
    return false;
  } finally {
    await rpc.call('doc.close', { docId: read.importId }).catch(() => {});
  }
}
