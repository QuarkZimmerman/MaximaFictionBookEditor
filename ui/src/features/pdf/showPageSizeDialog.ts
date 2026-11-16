/**
 * Feature 014 (D2; tasks T029): opens the page size window (PageSizeDialog.tsx), as dialogs/show.ts
 * opens the encoding window of Save As.
 */
import { createElement } from 'react';

import type { Dialogs } from '@/dialogs/types';
import type { PdfPageSizeId } from '@/rpc/types';

import { PageSizeDialog } from './PageSizeDialog';

/** Opens the window; resolves with the size chosen, or null for *Cancel*. */
export function showPageSizeDialog(
  dialogs: Dialogs,
  options: { defaultSize: PdfPageSizeId; path?: string; zip?: boolean },
): Promise<{ size: PdfPageSizeId; zip: boolean } | null> {
  return dialogs.openCustom<{ size: PdfPageSizeId; zip: boolean } | null>((close) =>
    createElement(PageSizeDialog, { ...options, onClose: close }),
  );
}
