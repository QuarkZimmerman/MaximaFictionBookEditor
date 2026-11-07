/**
 * Feature 010, US8 (spec D29, D37; research DP-4): the imported book's pictures, added once the
 * book exists. The Markdown file's pictures go through `binary.add` - pictures only, whatever
 * their names - its `data:` pictures through the upload route, and each special character is
 * drawn from the bundled Noto fonts as a 48 px picture on a transparent background, once per
 * distinct character. A picture that cannot be added stays a picture naming it (D8's placeholder).
 */

import { uploadBinary } from '@/features/images/binaries';
import type { BinaryMeta } from '@/model/document';
import { isRpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import type { MarkdownPicture } from './convert';
import type { SpecialChar } from './specialChars';

export const CHAR_PICTURE_SIZE = 48;

const FAMILIES: Record<SpecialChar['font'], string> = {
  emoji: '"Noto Color Emoji"',
  symbol: '"Noto Sans Symbols 2", "Noto Sans Symbols"',
  math: '"Noto Sans Math"',
};

let fontsLoaded: Promise<void> | null = null;

/** The bundled fonts' faces, loaded once; their files come with the editor (offline). */
function loadFonts(): Promise<void> {
  fontsLoaded ??= Promise.all([
    import('@fontsource/noto-color-emoji/index.css'),
    import('@fontsource/noto-sans-symbols-2/index.css'),
    import('@fontsource/noto-sans-symbols/index.css'),
    import('@fontsource/noto-sans-math/index.css'),
  ]).then(() => undefined);
  return fontsLoaded;
}

/** One character as a 48 px PNG on a transparent background; null where there is no canvas. */
export async function drawChar(char: SpecialChar): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  await loadFonts();
  const font = `40px ${FAMILIES[char.font]}`;
  try {
    await document.fonts.load(font, char.text);
  } catch {
    // drawn with the faces there are
  }
  const canvas = document.createElement('canvas');
  canvas.width = CHAR_PICTURE_SIZE;
  canvas.height = CHAR_PICTURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#000000';
  context.fillText(char.text, CHAR_PICTURE_SIZE / 2, CHAR_PICTURE_SIZE / 2 + 2);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** The bytes of a `data:` address, or null when it is not one. */
export function dataUrlBlob(url: string): Blob | null {
  const match = /^data:([^;,]+)?((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const type = (match[1] ?? 'application/octet-stream').toLowerCase();
  const data = match[4] ?? '';
  try {
    const bytes = match[3]
      ? Uint8Array.from(atob(data.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(data));
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

export interface FailedPicture {
  id: string;
  /** The file's path, or `data:`. */
  source: string;
  reason: 'missing' | 'notPicture' | 'error';
}

export interface PictureOutcome {
  added: BinaryMeta[];
  failed: FailedPicture[];
}

export async function addPictures(
  rpc: RpcClient,
  docId: string,
  pictures: readonly MarkdownPicture[],
  chars: readonly SpecialChar[],
): Promise<PictureOutcome> {
  const added: BinaryMeta[] = [];
  const failed: FailedPicture[] = [];
  for (const picture of pictures) {
    const source = picture.kind === 'file' ? (picture.path ?? '') : 'data:';
    try {
      if (picture.kind === 'file') {
        added.push(
          await rpc.call('binary.add', {
            docId,
            path: source,
            suggestedId: picture.id,
            imagesOnly: true,
          }),
        );
      } else {
        const blob = dataUrlBlob(picture.data ?? '');
        if (!blob || !blob.type.startsWith('image/')) {
          failed.push({ id: picture.id, source, reason: 'notPicture' });
          continue;
        }
        added.push(
          await uploadBinary(docId, blob, { contentType: blob.type, suggestedId: picture.id }),
        );
      }
    } catch (error) {
      const code = isRpcError(error) ? error.code : null;
      failed.push({
        id: picture.id,
        source,
        reason:
          code === RpcErrorCode.binaryNotImage
            ? 'notPicture'
            : code === RpcErrorCode.docIoError
              ? 'missing'
              : 'error',
      });
    }
  }
  for (const char of chars) {
    const blob = await drawChar(char);
    if (!blob) continue;
    try {
      added.push(
        await uploadBinary(docId, blob, { contentType: 'image/png', suggestedId: char.id }),
      );
    } catch {
      // the character's placeholder stays
    }
  }
  return { added, failed };
}
