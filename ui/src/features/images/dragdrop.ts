/**
 * Drag-and-drop of image files onto the Body editor (T093, FR-038): document-level
 * `dragover` / `drop` handlers (capture phase, scoped to the mounted editor's DOM so no change
 * to the Body view is needed). The caret moves to the drop position, every dropped image file
 * is uploaded with `POST /binary/{docId}` and inserted as an image node (inline where the
 * paragraph allows it, otherwise block / section image). While a file drag hovers the editor
 * the `mfbe-drop-target` class is set on it for visual feedback.
 */

import { TextSelection } from 'prosemirror-state';

import type { AppStore } from '@/model/store';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import {
  imageFilesFromDataTransfer,
  pasteImageFile,
  reportImageFailure,
  targetsBodyEditor,
} from './paste';

export const DROP_TARGET_CLASS = 'mfbe-drop-target';

function hasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  return Array.from(data.types ?? []).includes('Files') || (data.files?.length ?? 0) > 0;
}

/** Moves the caret to the drop coordinates (best effort). */
export function moveCaretToPoint(
  controller: BodyEditorController,
  point: { x: number; y: number },
): void {
  const view = controller.editorView;
  if (!view) return;
  const found = view.posAtCoords({ left: point.x, top: point.y });
  if (!found) return;
  const pos = Math.max(0, Math.min(found.pos, view.state.doc.content.size));
  controller.apply(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
}

/** `dragover`: accept file drags over the editor. Returns true when handled. */
export function handleImageDragOver(store: AppStore, event: DragEvent): boolean {
  const controller = targetsBodyEditor(store, event.target);
  if (!controller || !hasFiles(event.dataTransfer)) return false;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  controller.editorView?.dom.classList.add(DROP_TARGET_CLASS);
  return true;
}

export function handleImageDragLeave(store: AppStore, event: DragEvent): void {
  const controller = targetsBodyEditor(store, event.target);
  const dom = controller?.editorView?.dom;
  if (!dom) return;
  const related = event.relatedTarget;
  if (related instanceof Node && dom.contains(related)) return;
  dom.classList.remove(DROP_TARGET_CLASS);
}

/**
 * `drop`: uploads the dropped image files and inserts them at the drop position. Returns the
 * promise of the insertion (null when the event was not an image drop into the editor).
 */
export function handleImageDrop(store: AppStore, event: DragEvent): Promise<number> | null {
  const controller = targetsBodyEditor(store, event.target);
  if (!controller) return null;
  const files = imageFilesFromDataTransfer(event.dataTransfer);
  controller.editorView?.dom.classList.remove(DROP_TARGET_CLASS);
  if (files.length === 0) return null;
  event.preventDefault();
  event.stopPropagation();
  moveCaretToPoint(controller, { x: event.clientX, y: event.clientY });
  return (async () => {
    let inserted = 0;
    for (const file of files) {
      try {
        if (await pasteImageFile(store, controller, file)) inserted += 1;
      } catch (error) {
        reportImageFailure(store, error);
      }
    }
    return inserted;
  })();
}

/** Installs the drag-and-drop handlers on the document; returns the uninstall function. */
export function installImageDragDrop(store: AppStore, target: Document = document): () => void {
  const onDragOver = (event: Event) => {
    handleImageDragOver(store, event as DragEvent);
  };
  const onDragLeave = (event: Event) => {
    handleImageDragLeave(store, event as DragEvent);
  };
  const onDrop = (event: Event) => {
    handleImageDrop(store, event as DragEvent);
  };
  target.addEventListener('dragover', onDragOver, true);
  target.addEventListener('dragleave', onDragLeave, true);
  target.addEventListener('drop', onDrop, true);
  return () => {
    target.removeEventListener('dragover', onDragOver, true);
    target.removeEventListener('dragleave', onDragLeave, true);
    target.removeEventListener('drop', onDrop, true);
  };
}
