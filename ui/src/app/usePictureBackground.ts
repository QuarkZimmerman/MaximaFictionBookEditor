/**
 * Feature 010 (D10): React access to the pictures' background choices (`@/model/pictureBackground`)
 * - every place that shows an image follows the switch.
 */

import { useSyncExternalStore } from 'react';

import {
  pictureBackground,
  pictureBackgroundRevision,
  subscribePictureBackgrounds,
  transparencyConfirmed,
} from '@/model/pictureBackground';

/** Re-renders the caller whenever a choice or a transparency check changes. */
export function usePictureBackgrounds(): number {
  return useSyncExternalStore(subscribePictureBackgrounds, pictureBackgroundRevision);
}

/**
 * The class suffix a preview of the image `id` takes: ` mfbe-picture-on-page` when switched (D10).
 * A plain function for lists: the component calls `usePictureBackgrounds()` once.
 */
export function onPageClass(docId: string | null, id: string): string {
  return pictureBackground(docId, id) === 'page' ? ' mfbe-picture-on-page' : '';
}

/** Whether the image `id` really has transparent areas (checked once from the decoded picture). */
export function useTransparentPicture(docId: string | null, id: string): boolean {
  usePictureBackgrounds();
  return transparencyConfirmed(docId, id) === true;
}
