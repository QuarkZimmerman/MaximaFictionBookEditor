/**
 * Feature 012 (US3; D27, D31; FR-044): what the import leaves out because FB2 has no place for it,
 * counted by kind so that the summary says each once, with its files or its count: embedded fonts,
 * audio and video (their fallback text and poster picture are kept), scripts, forms and other
 * interactive parts, read-aloud synchronisation, page-number markers and the page list, and the
 * positions of fixed-layout pages.
 */

import type { ImportSummaryItem } from './convert';

export type DroppedKind =
  | 'droppedFonts'
  | 'droppedMedia'
  | 'droppedScripts'
  | 'droppedForms'
  | 'droppedEmbedded'
  | 'droppedOverlays'
  | 'droppedPageMarkers'
  | 'droppedPageList'
  | 'droppedFixedLayout';

/** The kinds a summary line names its files for; the others give a count. */
const NAMED: ReadonlySet<DroppedKind> = new Set([
  'droppedFonts',
  'droppedMedia',
  'droppedOverlays',
]);
const MAX_NAMES = 5;

export class Dropped {
  private readonly counts = new Map<DroppedKind, number>();
  private readonly names = new Map<DroppedKind, string[]>();

  add(kind: DroppedKind, name?: string): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    if (name && NAMED.has(kind)) {
      const list = this.names.get(kind) ?? [];
      if (!list.includes(name)) list.push(name);
      this.names.set(kind, list);
    }
  }

  count(kind: DroppedKind): number {
    return this.counts.get(kind) ?? 0;
  }

  /** One summary line per kind, in a fixed order. */
  summary(): ImportSummaryItem[] {
    const order: DroppedKind[] = [
      'droppedFonts',
      'droppedMedia',
      'droppedScripts',
      'droppedForms',
      'droppedEmbedded',
      'droppedOverlays',
      'droppedPageMarkers',
      'droppedPageList',
      'droppedFixedLayout',
    ];
    const items: ImportSummaryItem[] = [];
    for (const kind of order) {
      const count = this.counts.get(kind);
      if (!count) continue;
      const names = this.names.get(kind) ?? [];
      const detail = NAMED.has(kind)
        ? names.slice(0, MAX_NAMES).join(', ') + (names.length > MAX_NAMES ? ', …' : '')
        : String(count);
      items.push({ kind, detail });
    }
    return items;
  }
}
