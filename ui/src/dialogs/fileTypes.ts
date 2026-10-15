/**
 * File types of the native file dialogs (spec FR-010): the original editor's lists, in its
 * order, plus the kinds this editor adds (`.fbd` documents, WebP images). The dialogs show a
 * name as written (rpc-api.md §3.9), so each carries its patterns: "FictionBook files (*.fb2)".
 * Extensions travel without the dot; `*` lists every file.
 */

import type { TFunction } from 'i18next';

import type { FileFilter } from '@/rpc/types';

/** A file type: the name in the interface language followed by the patterns of `extensions`. */
export function fileType(name: string, extensions: readonly string[]): FileFilter {
  const patterns = extensions.map((extension) => (extension === '*' ? '*.*' : `*.${extension}`));
  return { name: `${name} (${patterns.join(';')})`, extensions: [...extensions] };
}

/** Open and Save As: FictionBook files, FictionBook descriptors, All files. */
export function documentFileTypes(t: TFunction): FileFilter[] {
  return [
    fileType(t('fileDialogs.types.fictionBook'), ['fb2']),
    fileType(t('fileDialogs.types.fictionBookDescriptors'), ['fbd']),
    fileType(t('fileDialogs.types.all'), ['*']),
  ];
}

/** Adding a block, inline or section image and choosing a cover image file. */
export function imageFileTypes(t: TFunction): FileFilter[] {
  return [
    fileType(t('fileDialogs.types.supportedImages'), ['jpg', 'jpeg', 'png']),
    fileType(t('fileDialogs.types.jpeg'), ['jpg']),
    fileType(t('fileDialogs.types.png'), ['png']),
    fileType(t('fileDialogs.types.bitmap'), ['bmp']),
    fileType(t('fileDialogs.types.gif'), ['gif']),
    fileType(t('fileDialogs.types.tiff'), ['tif']),
    fileType(t('fileDialogs.types.webp'), ['webp']),
  ];
}

/** Add Binary Object: All files first, then the image types. */
export function binaryFileTypes(t: TFunction): FileFilter[] {
  return [fileType(t('fileDialogs.types.all'), ['*']), ...imageFileTypes(t)];
}

/** Add Binary Object selects "Supported images", the second type (as the original). */
export const BINARY_SELECTED_TYPE = 1;

/** Save image as: JPEG files, PNG files, All files. */
export function savedImageFileTypes(t: TFunction): FileFilter[] {
  return [
    fileType(t('fileDialogs.types.jpegFiles'), ['jpg']),
    fileType(t('fileDialogs.types.pngFiles'), ['png']),
    fileType(t('fileDialogs.types.all'), ['*']),
  ];
}

/** The custom dictionary in Settings: Dictionaries, All files. */
export function dictionaryFileTypes(t: TFunction): FileFilter[] {
  return [
    fileType(t('fileDialogs.types.dictionaries'), ['dic']),
    fileType(t('fileDialogs.types.all'), ['*']),
  ];
}
