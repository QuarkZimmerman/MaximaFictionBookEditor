/**
 * Drag-and-drop of image files onto the Body editor (T093, FR-038): document-level
 * `dragover` / `drop` handlers (capture phase, scoped to the mounted editor's DOM so no change
 * to the Body view is needed). The caret moves to the drop position, every dropped image file
 * is uploaded with `POST /binary/{docId}` and inserted as an image node (inline where the
 * paragraph allows it, otherwise block / section image). While a file drag hovers the editor
 * the `mfbe-drop-target` class is set on it for visual feedback. Feature 006 (US3, FR-025): the
 * handlers act on the active editing target (`imageTargetFor`), so files dropped on a table
 * cell become inline images at the drop point in that cell, in their order, each one undo step.
 * US10 (FR-025, FR-044): a drop on a description field - also one that is not the active one -
 * goes to that field's adapter when the drop point lies in a cell, the caret moved there first.
 */

import { TextSelection } from 'prosemirror-state';

import { fieldTargetFor } from '@/features/tables/target';
import type { AppStore } from '@/model/store';

import type { ImageTarget } from './insert';
import {
  imageFilesFromDataTransfer,
  imageTargetFor,
  pasteImageFile,
  reportImageFailure,
} from './paste';

export const DROP_TARGET_CLASS = 'mfbe-drop-target';

function hasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  return Array.from(data.types ?? []).includes('Files') || (data.files?.length ?? 0) > 0;
}

/** Moves the caret of `target` to the drop coordinates (best effort; a selection only). */
export function moveCaretToPoint(target: ImageTarget, point: { x: number; y: number }): void {
  const view = target.view;
  const state = target.state;
  if (!view || !state) return;
  const found = view.posAtCoords({ left: point.x, top: point.y });
  if (!found) return;
  const pos = Math.max(0, Math.min(found.pos, state.doc.content.size));
  target.setSelection(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))));
}

/** `dragover`: accept file drags over the editor. Returns true when handled. */
export function handleImageDragOver(store: AppStore, event: DragEvent): boolean {
  const target = imageTargetFor(store, event.target, { x: event.clientX, y: event.clientY });
  if (!target || !hasFiles(event.dataTransfer)) return false;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  target.dom?.classList.add(DROP_TARGET_CLASS);
  return true;
}

export function handleImageDragLeave(store: AppStore, event: DragEvent): void {
  const dom = (fieldTargetFor(event.target) ?? imageTargetFor(store, event.target))?.dom;
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
  const point = { x: event.clientX, y: event.clientY };
  const target = imageTargetFor(store, event.target, point);
  if (!target) return null;
  const files = imageFilesFromDataTransfer(event.dataTransfer);
  target.dom?.classList.remove(DROP_TARGET_CLASS);
  if (files.length === 0) return null;
  event.preventDefault();
  event.stopPropagation();
  moveCaretToPoint(target, point);
  return (async () => {
    let inserted = 0;
    // One after another, in the dropped order: each file is one insertion and one undo step.
    for (const file of files) {
      try {
        if (await pasteImageFile(store, target, file)) inserted += 1;
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
