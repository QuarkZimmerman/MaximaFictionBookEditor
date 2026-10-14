/** Focus hook shared by the modeless Find and Replace dialogs. */

import { useEffect, type RefObject } from 'react';

import type { SearchDialogKind, SearchSession } from '@/features/search/search';

/** Brings an open search dialog to the front when Find / Replace is chosen again. */
export function useSearchDialogFocus(
  session: SearchSession,
  kind: SearchDialogKind,
  queryRef: RefObject<HTMLInputElement | null>,
): void {
  useEffect(
    () =>
      session.attachDialog(kind, () => {
        queryRef.current?.focus();
        queryRef.current?.select();
      }),
    [session, kind, queryRef],
  );
}
