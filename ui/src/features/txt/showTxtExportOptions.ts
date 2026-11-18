/**
 * Feature 017 (DP-5): opens the TXT export's options window (TxtExportOptions.tsx), as the PDF
 * export opens its page size window.
 */
import { createElement } from 'react';

import type { Dialogs } from '@/dialogs/types';

import {
  TxtExportOptions,
  type TxtExportChoice,
  type TxtExportOptionsProps,
} from './TxtExportOptions';

/** Opens the window; resolves with the options chosen, or null for *Cancel*. */
export function showTxtExportOptions(
  dialogs: Dialogs,
  options: Omit<TxtExportOptionsProps, 'onClose'>,
): Promise<TxtExportChoice | null> {
  return dialogs.openCustom<TxtExportChoice | null>((close) =>
    createElement(TxtExportOptions, { ...options, onClose: close }),
  );
}
