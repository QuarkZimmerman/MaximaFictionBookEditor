/**
 * Clipboard image paste (T093, FR-038, US7 scenario 2): when a paste into the Body editor
 * carries an image file (a screenshot, a bitmap copied from another application, an image
 * dragged from a browser), its bytes are uploaded to the core with `POST /binary/{docId}` -
 * never base64 inside JSON-RPC - and the stored binary is referenced by an inline image at the
 * caret (a block image when the caret's paragraph takes none), as the original editor did with
 * `CF_BITMAP`. The core applies the "paste images as" setting (JPEG with the configured quality
 * or PNG; PNG when the source has transparency) on save. The handler listens on the document in
 * the capture phase so it runs before ProseMirror's own paste handling.
 */

import i18next from 'i18next';

import { MFBE_CLIPBOARD_MIME } from '@/editor/plugins/clipboard';
import { bodyController } from '@/features/editing/common';
import { actions, type AppStore } from '@/model/store';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import { addBinaryToModel, imageMimeType, isImageType, uploadBinary } from './binaries';
import { latestCommandContext } from './context';
import { insertImageAtCaret, type ImageKind } from './insert';

/** The first image file of a clipboard / drag payload, or null. */
export function imageFileFromDataTransfer(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  const files = data.files ? Array.from(data.files) : [];
  for (const file of files) {
    if (isImageType(file.type) || imageMimeType(file.name)) return file;
  }
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && (isImageType(file.type) || imageMimeType(file.name))) return file;
    }
  }
  return null;
}

/** Every image file of a drag payload (drops may carry several). */
export function imageFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data?.files) return [];
  return Array.from(data.files).filter(
    (file) => isImageType(file.type) || imageMimeType(file.name),
  );
}

/**
 * Uploads `file` as a binary of the current document and inserts an image referencing it at
 * the caret. Resolves with the node kind inserted (null when no node fits; the binary is kept
 * and listed in Binary Objects).
 */
export async function pasteImageFile(
  store: AppStore,
  controller: BodyEditorController,
  file: File | Blob,
  options: { suggestedId?: string } = {},
): Promise<ImageKind | null> {
  const docId = store.getState().docId;
  if (!docId) return null;
  const name = options.suggestedId ?? (file instanceof File ? file.name : '');
  const contentType = file.type || imageMimeType(name) || 'application/octet-stream';
  const meta = await uploadBinary(docId, file, {
    contentType,
    suggestedId: name || undefined,
  });
  addBinaryToModel(store, meta);
  const kind = insertImageAtCaret(controller, { href: `#${meta.id}`, alt: null, title: null });
  if (!kind) {
    actions.setModified(store, true);
    actions.setStatusMessage(store, i18next.t('images.msg.pastedNoPlace', { id: meta.id }));
  }
  return kind;
}

/** Reports a failed upload in the status bar and the core log (best effort). */
export function reportImageFailure(store: AppStore, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  actions.setStatusMessage(store, i18next.t('images.msg.failed', { reason: message }));
  const ctx = latestCommandContext(store);
  void ctx?.rpc
    ?.call('log.error', { source: 'ui', code: 'images.upload', message })
    .catch(() => undefined);
}

/** True when the event targets the mounted, editable Body editor. */
export function targetsBodyEditor(
  store: AppStore,
  target: EventTarget | null,
): BodyEditorController | null {
  const controller = bodyController(store);
  const view = controller?.editorView;
  if (!controller || !view || !controller.isEditable) return null;
  if (!(target instanceof Node) || !view.dom.contains(target)) return null;
  return controller;
}

/**
 * Document-level `paste` handler (capture phase). Returns true when the event was an image
 * paste into the Body editor and has been taken over.
 */
export function handleImagePaste(store: AppStore, event: ClipboardEvent): boolean {
  const controller = targetsBodyEditor(store, event.target);
  if (!controller) return false;
  const data = event.clipboardData;
  if (!data) return false;
  // The editor's own structured flavour (copy inside MFBE) always wins.
  if (data.getData(MFBE_CLIPBOARD_MIME)) return false;
  const file = imageFileFromDataTransfer(data);
  if (!file) return false;
  event.preventDefault();
  event.stopPropagation();
  pasteImageFile(store, controller, file).catch((error: unknown) =>
    reportImageFailure(store, error),
  );
  return true;
}

/** Installs the paste handler on the document; returns the uninstall function. */
export function installImagePaste(store: AppStore, target: Document = document): () => void {
  const handler = (event: Event) => {
    handleImagePaste(store, event as ClipboardEvent);
  };
  target.addEventListener('paste', handler, true);
  return () => target.removeEventListener('paste', handler, true);
}
