/**
 * Images feature registrar (US7, T093/T094). Called once by `createAppServices()` after the
 * editing feature, so it takes over the Add-menu image commands (`insert.image`,
 * `insert.inlineImage`, `insert.sectionImage`, `insert.binary`) with the real binary flows,
 * installs the clipboard image paste and file drag-and-drop handlers of the Body editor and the
 * "Save image as..." context-menu entry / `image.saveAs` command.
 */

import type { FeatureContext } from '@/app/services';
import { setPicturePlaceholderAction } from '@/editor/nodeviews/image';
import { forgetPictureBackgrounds } from '@/model/pictureBackground';

import { choosePictureFor } from './choosePicture';
import { installImageDragDrop } from './dragdrop';
import { registerImageCommands } from './insert';
import { installImagePaste } from './paste';
import { registerPictureMenu } from './pictureMenu';
import { registerSaveImageAs } from './saveAs';

export { addBinaryToModel, referenceCounts, uploadBinary } from './binaries';
export { chooseImage, insertImageAtCaret, wantsClearImage, type ImageTarget } from './insert';
export { handleImagePaste, imageTargetFor, pasteImageFile } from './paste';
export { handleImageDrop } from './dragdrop';

export function registerImagesFeature(ctx: FeatureContext): void {
  const { commands, store } = ctx;
  registerImageCommands(commands);
  registerSaveImageAs(store, commands);
  // Feature 010 (D4, D5): Change picture… and Show picture; replaces the image slot's provider.
  registerPictureMenu(store, commands);
  if (typeof document !== 'undefined') {
    installImagePaste(store);
    installImageDragDrop(store);
  }
  // Feature 010 (D10): a closed document's background choices are forgotten (never stored).
  let openDocId = store.getState().docId;
  store.subscribe(() => {
    const docId = store.getState().docId;
    if (docId === openDocId) return;
    if (openDocId) forgetPictureBackgrounds(openDocId);
    openDocId = docId;
  });
  // Feature 010 (D4): a double-click on a picture without an image opens the picture chooser.
  const getContext = ctx.getCommandContext;
  if (getContext) {
    setPicturePlaceholderAction((view, pos) => {
      void choosePictureFor(view, pos, getContext());
    });
  }
}
