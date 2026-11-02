/**
 * Link target helpers shared by the Link dialog, the Links bar and the footnote feature.
 */

import { createElement } from 'react';

import { LinkDialog } from '@/dialogs/LinkDialog';
import type { Dialogs } from '@/dialogs/types';
import type { Document } from '@/model/document';

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

/** An entry of the Links bar's list and of Style > Link's (feature 008, data-model §8). */
export interface ListTarget {
  href: string;
  label: string;
}

interface IdNode {
  attrs?: { id?: unknown };
  content?: readonly IdNode[];
}

/**
 * Every element id of the whole book, in document order - the annotations and the history, then
 * the bodies, as the Body view shows them - as `#id` (feature 008, FR-040, FR-045). The model is
 * walked, not the editor, so a large book's sections outside the mounted window count too.
 */
export function collectJumpTargets(document: Document | null): ListTarget[] {
  if (!document) return [];
  const out: ListTarget[] = [];
  const seen = new Set<string>();
  const pending: IdNode[] = [];
  const { titleInfo, srcTitleInfo, documentInfo } = document.description;
  const roots: IdNode[] = [];
  for (const root of [titleInfo.annotation, srcTitleInfo?.annotation, documentInfo.history]) {
    if (root) roots.push(root as IdNode);
  }
  roots.push(...(document.bodies as readonly IdNode[]));
  // Pre-order without recursion: push children in reverse so they come out in order.
  for (let i = roots.length - 1; i >= 0; i -= 1) pending.push(roots[i]!);
  for (let node = pending.pop(); node; node = pending.pop()) {
    const id = node.attrs?.id;
    if (typeof id === 'string' && id !== '' && !seen.has(id)) {
      seen.add(id);
      out.push({ href: `#${id}`, label: `#${id}` });
    }
    const children = node.content ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) pending.push(children[i]!);
  }
  return out;
}

/** The book's pictures, in book order, as `#id` (feature 008, FR-040). */
export function collectImageRefs(document: Document | null): ListTarget[] {
  if (!document) return [];
  return document.binaries
    .filter((binary) => /^image\//i.test(binary.contentType))
    .map((binary) => ({ href: `#${binary.id}`, label: `#${binary.id}` }));
}
