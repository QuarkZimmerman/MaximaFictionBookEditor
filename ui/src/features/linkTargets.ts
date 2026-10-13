/**
 * Link target helpers shared by the Link dialog, the Links bar and the footnote feature.
 */

import { createElement } from 'react';

import { LinkDialog } from '@/dialogs/LinkDialog';
import type { Dialogs } from '@/dialogs/types';

/** `#id` stays; `scheme://...` stays; anything else becomes `http://...` (FBE Href field). */
export function normalizeHref(value: string): string {
  const href = value.trim();
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return `http://${href}`;
}

/** Opens the Link dialog; resolves with the normalised href or null when cancelled. */
export function showLinkDialog(
  dialogs: Dialogs,
  options: { initialHref?: string; targets?: readonly string[] } = {},
): Promise<string | null> {
  return dialogs.openCustom<string | null>((close) =>
    createElement(LinkDialog, { ...options, onClose: close }),
  );
}
