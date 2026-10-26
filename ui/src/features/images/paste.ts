/**
 * Clipboard image paste (T093, FR-038, US7 scenario 2): when a paste into the Body editor
 * carries an image file (a screenshot, a bitmap copied from another application, an image
 * dragged from a browser), its bytes are uploaded to the core with `POST /binary/{docId}` -
 * never base64 inside JSON-RPC - and the stored binary is referenced by an inline image at the
 * caret (a block image when the caret's paragraph takes none), as the original editor did with
 * `CF_BITMAP`. The core applies the "paste images as" setting (JPEG with the configured quality
 * or PNG; PNG when the source has transparency) on save. The handler listens on the document in
 * the capture phase so it runs before ProseMirror's own paste handling.
 *
 * Feature 006 (US3, FR-025; data-model §9.7): the paste goes to the active editing target whose
 * DOM holds the event (`imageTargetFor`), so an image pasted into a table cell becomes an inline
 * image in that cell. US9 (R5.9; data-model §8.9): an HTML table with text on the clipboard wins
 * over a picture beside it - the paste is left to the clipboard plugin's router. US10 (FR-024,
 * FR-025, FR-044): an event inside a description field goes to that field's adapter - found by
 * its editor, active or not -, but only into a cell: with its caret in a cell for a paste, with
 * the drop point in a cell for a drop; a field paragraph takes no picture and uploads nothing.
 */

import i18next from 'i18next';

import { htmlHasTextTable } from '@/editor/clipboard/foreignHtml';
import { caretInCell } from '@/editor/commands/insert';
import { MFBE_CLIPBOARD_MIME } from '@/editor/plugins/clipboard';
import { cellRefAround } from '@/editor/table/selection';
import { activeTableTarget, fieldTargetFor, type TableEditTarget } from '@/features/tables/target';
import { actions, type AppStore } from '@/model/store';

import { addBinaryToModel, imageMimeType, isImageType, uploadBinary } from './binaries';
import { latestCommandContext } from './context';
import { insertImageAtCaret, type ImageKind, type ImageTarget } from './insert';

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
 * the caret of `target`. Resolves with the node kind inserted (null when no node fits; the
 * binary is kept and listed in Binary Objects).
 */
export async function pasteImageFile(
  store: AppStore,
  target: ImageTarget,
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
  const kind = insertImageAtCaret(target, { href: `#${meta.id}`, alt: null, title: null });
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

/** True when the document position at the viewport point `point` lies in a cell of `target`. */
function pointInCell(target: TableEditTarget, point: { x: number; y: number }): boolean {
  const view = target.view;
  const state = target.state;
  if (!view || !state) return false;
  let found: { pos: number } | null;
  try {
    found = view.posAtCoords({ left: point.x, top: point.y });
  } catch {
    return false; // a view that measures nothing (detached)
  }
  if (!found) return false;
  const pos = Math.max(0, Math.min(found.pos, state.doc.content.size));
  return cellRefAround(state.doc.resolve(pos)) !== null;
}

/**
 * The editing target an image event goes to. An event inside a description field (US10): that
 * field's adapter, active or not, when it is editable and the picture lands in a cell - its
 * caret in a cell for a paste, the drop point `point` in a cell for a drop -, else none. Any
 * other event: the active target when it is editable and its DOM holds the event's target (the
 * Body adapter for an event inside the Body editor). Null otherwise (outside the editors, under
 * the run lock).
 */
export function imageTargetFor(
  store: AppStore,
  eventTarget: EventTarget | null,
  point?: { x: number; y: number },
): ImageTarget | null {
  const field = fieldTargetFor(eventTarget);
  if (field) {
    const state = field.state;
    if (!field.editable || !state) return null;
    if (point) return pointInCell(field, point) ? field : null;
    return caretInCell(state) ? field : null;
  }
  const target = activeTableTarget(store);
  if (!target?.editable || !target.dom) return null;
  if (!(eventTarget instanceof Node) || !target.dom.contains(eventTarget)) return null;
  return target;
}

/**
 * Document-level `paste` handler (capture phase). Returns true when the event was an image
 * paste into the editing target and has been taken over.
 */
export function handleImagePaste(store: AppStore, event: ClipboardEvent): boolean {
  const target = imageTargetFor(store, event.target);
  if (!target) return false;
  const data = event.clipboardData;
  if (!data) return false;
  // The editor's own structured flavour (copy inside MFBE) always wins.
  if (data.getData(MFBE_CLIPBOARD_MIME)) return false;
  // An HTML table with text wins over the picture of it a spreadsheet may add (feature 006,
  // R5.9; data-model §8.9): the clipboard plugin's router converts the table, nothing is
  // uploaded. A lone picture inside a table without text still pastes as a picture.
  const html = data.getData('text/html');
  if (html && htmlHasTextTable(html)) return false;
  const file = imageFileFromDataTransfer(data);
  if (!file) return false;
  event.preventDefault();
  event.stopPropagation();
  pasteImageFile(store, target, file).catch((error: unknown) => reportImageFailure(store, error));
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
