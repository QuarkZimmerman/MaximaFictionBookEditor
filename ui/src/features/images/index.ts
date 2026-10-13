/**
 * Images feature registrar (US7, T093/T094). Called once by `createAppServices()` after the
 * editing feature, so it takes over the Add-menu image commands (`insert.image`,
 * `insert.inlineImage`, `insert.sectionImage`, `insert.binary`) with the real binary flows,
 * installs the clipboard image paste and file drag-and-drop handlers of the Body editor and the
 * "Save image as..." context-menu entry / `image.saveAs` command.
 */

import type { FeatureContext } from '@/app/services';

import { installImageDragDrop } from './dragdrop';
import { registerImageCommands } from './insert';
import { installImagePaste } from './paste';
import { registerSaveImageAs } from './saveAs';

export { addBinaryToModel, referenceCounts, uploadBinary } from './binaries';
export { chooseImage, insertImageAtCaret, wantsClearImage } from './insert';
export { handleImagePaste, pasteImageFile } from './paste';
export { handleImageDrop } from './dragdrop';

export function registerImagesFeature(ctx: FeatureContext): void {
  const { commands, store } = ctx;
  registerImageCommands(commands);
  registerSaveImageAs(store, commands);
  if (typeof document !== 'undefined') {
    installImagePaste(store);
    installImageDragDrop(store);
  }
}
