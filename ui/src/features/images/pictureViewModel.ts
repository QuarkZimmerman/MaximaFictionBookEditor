/**
 * The picture view's rules (feature 007, data-model §5, FR-050 to FR-054; DP-5), apart from
 * its component: which binaries have a view, the mode it opens in, when a click toggles, the
 * size the picture shows at, and the address of its bytes.
 *
 *   open:    natural when the picture fits the window, else fitted
 *   toggle:  fitted <-> natural, only when the picture exceeds the window
 *   fitted:  scaled down proportionally into the window, never enlarged
 *   source:  the original bytes when the engine shows the type, else the core's preview at the
 *            natural size (TIFF; the core clamps it at 4096 px)
 */

import { binaryOriginalUrl, binaryPreviewUrl, displayableInEngine } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';

export type PictureViewMode = 'fitted' | 'natural';

export interface Size {
  width: number;
  height: number;
}

/** A picture of known size the editor decodes; the others have no view (FR-054). */
export type ViewablePicture = Pick<BinaryMeta, 'id' | 'contentType'> & Size;

export function canViewPicture(
  binary: Pick<BinaryMeta, 'decodable' | 'width' | 'height'>,
): boolean {
  return binary.decodable && (binary.width ?? 0) > 0 && (binary.height ?? 0) > 0;
}

export function exceedsWindow(picture: Size, window: Size): boolean {
  return picture.width > window.width || picture.height > window.height;
}

export function initialMode(picture: Size, window: Size): PictureViewMode {
  return exceedsWindow(picture, window) ? 'fitted' : 'natural';
}

export function toggledMode(mode: PictureViewMode, picture: Size, window: Size): PictureViewMode {
  if (!exceedsWindow(picture, window)) return mode;
  return mode === 'fitted' ? 'natural' : 'fitted';
}

/** The size the picture shows at: its own, or scaled into the window (never enlarged). */
export function displaySize(mode: PictureViewMode, picture: Size, window: Size): Size {
  if (mode === 'natural') return { width: picture.width, height: picture.height };
  const factor = Math.min(1, window.width / picture.width, window.height / picture.height);
  return {
    width: Math.max(1, Math.round(picture.width * factor)),
    height: Math.max(1, Math.round(picture.height * factor)),
  };
}

export function pictureViewUrl(
  docId: string | null,
  binary: Pick<BinaryMeta, 'id' | 'contentType' | 'width' | 'height'>,
): string | null {
  const href = `#${binary.id}`;
  if (displayableInEngine(binary.contentType)) return binaryOriginalUrl(docId, href);
  return binaryPreviewUrl(docId, href, binary.width, binary.height);
}
