/**
 * Feature 010, US3 (D9, D10): what stands behind a picture. Every picture stands on white by
 * default, in both themes; a picture with transparent areas can be switched to the background
 * of the place it stands in. The choice belongs to one image of one open document (every place
 * that shows the image follows it), holds until the document is closed and is never stored.
 *
 * The core's `BinaryMeta.transparent` says the headers allow transparent pixels; whether the
 * picture really has any is settled once per image from the decoded picture
 * (`hasTransparentPixels`), and only then is the switch offered.
 */

export type PictureBackground = 'white' | 'page';

const choices = new Map<string, PictureBackground>();
const confirmed = new Map<string, boolean>();
const listeners = new Set<() => void>();
let revision = 0;

const keyOf = (docId: string, id: string) => `${docId}\n${id}`;

function changed(): void {
  revision += 1;
  for (const listener of [...listeners]) listener();
}

export function pictureBackground(docId: string | null, id: string): PictureBackground {
  return docId ? (choices.get(keyOf(docId, id)) ?? 'white') : 'white';
}

export function togglePictureBackground(docId: string, id: string): void {
  const key = keyOf(docId, id);
  if (choices.get(key) === 'page') choices.delete(key);
  else choices.set(key, 'page');
  changed();
}

/** True / false once the decoded picture was checked; undefined before. */
export function transparencyConfirmed(docId: string | null, id: string): boolean | undefined {
  return docId ? confirmed.get(keyOf(docId, id)) : undefined;
}

export function confirmTransparency(docId: string, id: string, value: boolean): void {
  const key = keyOf(docId, id);
  if (confirmed.get(key) === value) return;
  confirmed.set(key, value);
  changed();
}

/** Forgets the choices of a closed document. */
export function forgetPictureBackgrounds(docId: string): void {
  const prefix = `${docId}\n`;
  let any = false;
  for (const map of [choices, confirmed]) {
    for (const key of [...map.keys()]) {
      if (key.startsWith(prefix)) {
        map.delete(key);
        any = true;
      }
    }
  }
  if (any) changed();
}

export function subscribePictureBackgrounds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pictureBackgroundRevision(): number {
  return revision;
}

/** The longest side of the copy the check draws: enough to keep small transparent areas. */
const CHECK_SIZE = 256;

/**
 * Whether a loaded picture has a pixel that is not fully opaque, from a copy drawn at most
 * `CHECK_SIZE` pixels on its longest side; null when the page cannot tell (no canvas).
 */
export function hasTransparentPixels(img: HTMLImageElement): boolean | null {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height || typeof document === 'undefined') return null;
  const scale = Math.min(1, CHECK_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  let context: CanvasRenderingContext2D | null;
  try {
    context = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
  if (!context) return null;
  try {
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 255) return true;
    }
    return false;
  } catch {
    return null;
  }
}
