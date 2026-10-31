/**
 * Opens the picture view (`PictureView.tsx`, feature 007 US6) of a binary over the whole window,
 * through the dialog service's `viewer` kind; resolves when it closes.
 */

import type { Dialogs } from '@/dialogs/types';

import { PictureView, type PictureViewProps } from './PictureView';

export function openPictureView(
  dialogs: Pick<Dialogs, 'openCustom'>,
  props: Omit<PictureViewProps, 'onClose'>,
): Promise<void> {
  return dialogs.openCustom<void>(
    (close) => <PictureView {...props} onClose={() => close(undefined)} />,
    { kind: 'viewer' },
  );
}
