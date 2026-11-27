/**
 * Hybrid single-cover synchronization for FBD ZIP Package mode (feature 022, FR-014, data-model.md §4.2).
 *
 * Guarantees that an active package entry holds at most one cover binary auto-named `cover.jpg` or
 * `cover.png`, referenced exclusively by `titleInfo.coverpage = [{ href: '#cover.<ext>' }]`, with
 * zero orphan binaries and empty `srcTitleInfo.coverpage`.
 *
 * JPEG and PNG inputs are stored byte-for-byte without re-encoding; other decodable image formats
 * (WebP, BMP, GIF, TIFF) are converted immediately on add (`convertNow: true`) so the stored ID
 * extension always matches the binary content type.
 */

import type { CommandContext } from '@/app/commands';
import { imageFileTypes } from '@/dialogs/fileTypes';
import { bumpBinaryRevision } from '@/model/binaryUrls';
import type { BinaryMeta, Document } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import { RpcError, type RpcClient } from '@/rpc/client';

const TEMP_COVER_ID = '__pkg_cover_tmp';

export function canonicalCoverId(
  contentType: string | undefined | null,
): 'cover.png' | 'cover.jpg' {
  return (contentType ?? '').toLowerCase() === 'image/png' ? 'cover.png' : 'cover.jpg';
}

export function applyPackageCoverToDocument(doc: Document, meta: BinaryMeta): Document {
  const normalizedMeta: BinaryMeta = { ...meta, referenceCount: 1 };
  return {
    ...doc,
    description: {
      ...doc.description,
      titleInfo: {
        ...doc.description.titleInfo,
        coverpage: [{ href: `#${meta.id}` }],
      },
      ...(doc.description.srcTitleInfo
        ? {
            srcTitleInfo: {
              ...doc.description.srcTitleInfo,
              coverpage: [],
            },
          }
        : {}),
    },
    binaries: [normalizedMeta],
  };
}

export function clearPackageCoverFromDocument(doc: Document): Document {
  return {
    ...doc,
    description: {
      ...doc.description,
      titleInfo: {
        ...doc.description.titleInfo,
        coverpage: [],
      },
      ...(doc.description.srcTitleInfo
        ? {
            srcTitleInfo: {
              ...doc.description.srcTitleInfo,
              coverpage: [],
            },
          }
        : {}),
    },
    binaries: [],
  };
}

/**
 * Replaces the entry's cover image from `path`. Adding to a temporary ID first ensures an invalid
 * or corrupt image leaves any existing cover intact.
 */
export async function setPackageCoverFromFile(
  rpc: RpcClient,
  store: AppStore,
  docId: string,
  path: string,
): Promise<BinaryMeta | null> {
  const added = await rpc.call('binary.add', {
    docId,
    path,
    suggestedId: TEMP_COVER_ID,
    imagesOnly: true,
    convertNow: true,
  });

  const targetId = canonicalCoverId(added.contentType);
  const currentDoc = store.getState().document;
  if (!currentDoc || currentDoc.docId !== docId) {
    await rpc.call('binary.remove', { docId, id: added.id, force: true }).catch(() => undefined);
    return null;
  }

  // Remove any previously stored binaries so only the single canonical cover binary exists.
  const existingIds = currentDoc.binaries.map((b) => b.id).filter((id) => id !== added.id);
  for (const oldId of existingIds) {
    await rpc.call('binary.remove', { docId, id: oldId, force: true }).catch(() => undefined);
  }

  let finalMeta = added;
  if (added.id !== targetId) {
    finalMeta = await rpc.call('binary.rename', {
      docId,
      id: added.id,
      newId: targetId,
    });
  }

  const latestDoc = store.getState().document;
  if (!latestDoc || latestDoc.docId !== docId) return finalMeta;
  // Always bump revision so replacing cover.jpg with a same-size image refreshes thumbnails.
  bumpBinaryRevision(docId, finalMeta.id);
  actions.updateDocument(store, applyPackageCoverToDocument(latestDoc, finalMeta));
  return finalMeta;
}

/** Opens the image chooser and applies the selected image as the active entry's single cover. */
export async function pickAndSetPackageCover(ctx: CommandContext): Promise<BinaryMeta | null> {
  const rpc = ctx.rpc;
  const doc = ctx.store.getState().document;
  if (!rpc || !doc) return null;

  const hasCover = doc.binaries.length > 0 || doc.description.titleInfo.coverpage.length > 0;
  const { paths } = await rpc.call('dialog.openFile', {
    title: ctx.t(hasCover ? 'package.dialogs.replaceCover' : 'package.dialogs.addCover'),
    filters: imageFileTypes(ctx.t),
  });
  const chosenPath = paths[0];
  if (!chosenPath) return null;

  try {
    return await setPackageCoverFromFile(rpc, ctx.store, doc.docId, chosenPath);
  } catch (error) {
    const reason = error instanceof RpcError ? error.message : String(error);
    await ctx.dialogs.showMessage({
      text: reason,
      caption: ctx.t('dialog.error.caption'),
      icon: 'error',
      testId: 'package-cover-add-failed',
    });
    return null;
  }
}

/** Removes the active entry's cover binary and clears `titleInfo.coverpage` atomically. */
export async function removePackageCover(
  rpc: RpcClient,
  store: AppStore,
  docId: string,
): Promise<void> {
  const doc = store.getState().document;
  if (!doc || doc.docId !== docId) return;

  for (const b of doc.binaries) {
    await rpc.call('binary.remove', { docId, id: b.id, force: true }).catch(() => undefined);
  }
  const latestDoc = store.getState().document;
  if (!latestDoc || latestDoc.docId !== docId) return;
  actions.updateDocument(store, clearPackageCoverFromDocument(latestDoc));
}

/**
 * Copies a single cover binary from an imported description session into a Package mode entry,
 * converting non-JPEG/PNG images immediately, removing any prior cover, and normalizing the id to
 * `cover.jpg` or `cover.png` (FR-014, FR-017).
 */
export async function importSinglePackageCover(
  rpc: RpcClient,
  docId: string,
  fromDocId: string,
  sourceBinaryId: string,
  existingBinaryIds: readonly string[],
  preferredFormat: 'jpeg' | 'png' = 'jpeg',
): Promise<BinaryMeta> {
  const copied = await rpc.call('binary.copy', {
    docId,
    fromDocId,
    id: sourceBinaryId,
    suggestedId: TEMP_COVER_ID,
  });
  let current: BinaryMeta = { ...copied };
  if ('existing' in current) {
    delete (current as BinaryMeta & { existing?: boolean }).existing;
  }
  if (current.willConvert && current.decodable) {
    current = await rpc.call('binary.convert', {
      docId,
      id: current.id,
      format: preferredFormat,
    });
  }
  const targetId = canonicalCoverId(current.contentType);
  for (const oldId of existingBinaryIds) {
    if (oldId !== current.id) {
      await rpc.call('binary.remove', { docId, id: oldId, force: true }).catch(() => undefined);
    }
  }
  if (current.id !== targetId) {
    current = await rpc.call('binary.rename', {
      docId,
      id: current.id,
      newId: targetId,
    });
  }
  bumpBinaryRevision(docId, current.id);
  return { ...current, referenceCount: 1 };
}
