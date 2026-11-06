/**
 * What the status bar's panes show (feature 009, User Story 5; FR-050 to FR-057, data-model §8):
 * selection counts, the encoding text, the validity from the last check, the visible panes.
 * Pure functions; the status bar and the feeds of the Body and Source views use them.
 */

import type { LastCheck } from '@/model/store';

/** Runs of letters and digits; an inner hyphen or apostrophe does not split a word. */
const WORD = /[\p{L}\p{N}]+(?:['\u2019\u02BC\-\u2010\u2011][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Selections longer than this are counted in idle chunks (FR-057: the panes keep up). */
export const CHUNKED_COUNT_LIMIT = 200_000;
const CHUNK = 50_000;

/** Counts the words of a long text in chunks cut at white space, one chunk per idle slot. */
export function countWordsInChunks(
  text: string,
  done: (words: number) => void,
  schedule: (step: () => void) => void = (step) => {
    setTimeout(step, 0);
  },
): () => void {
  let at = 0;
  let words = 0;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    let end = Math.min(text.length, at + CHUNK);
    // Never cut a word: the chunk ends at white space.
    while (end < text.length && !/\s/u.test(text[end]!)) end += 1;
    words += countWords(text.slice(at, end));
    at = end;
    if (at >= text.length) done(words);
    else schedule(step);
  };
  schedule(step);
  return () => {
    cancelled = true;
  };
}

/** The selection's counts; `units` are paragraphs (Body) or lines (Source). */
export interface SelectionCounts {
  chars: number;
  words: number | null; // null while a long selection is still being counted
  units: number;
}

/** Characters as the user sees them: code points, not UTF-16 units. */
export function countChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0xdc00 || unit > 0xdfff) count += 1; // a low surrogate ends a pair already counted
  }
  return count;
}

/** The encoding pane: the file's encoding, and the next Save's when it differs. */
export function encodingText(
  sourceEncoding: string | null | undefined,
  nextSave: string | null | undefined,
  upper = (e: string) => e.toUpperCase(),
): string {
  const current = sourceEncoding ? upper(sourceEncoding) : '';
  const next = nextSave ? upper(nextSave) : '';
  if (!current) return next;
  return next && next !== current ? `${current} \u2192 ${next}` : current;
}

export type Validity =
  { state: 'valid' } | { state: 'problems'; count: number } | { state: 'unchecked' };

/** "valid" or the count while nothing changed since the check; "not checked" otherwise. */
export function validityOf(lastCheck: LastCheck | null, revision: number): Validity {
  if (!lastCheck || lastCheck.revision !== revision) return { state: 'unchecked' };
  return lastCheck.problems === 0
    ? { state: 'valid' }
    : { state: 'problems', count: lastCheck.problems };
}

export const STATUS_PANES = [
  'path',
  'position',
  'selection',
  'character',
  'encoding',
  'validity',
  'insmode',
] as const;
export type StatusPane = (typeof STATUS_PANES)[number];

/** The panes shown: the setting's, in the bar's order; all of them without a setting. */
export function visiblePanes(setting: readonly string[] | null | undefined): StatusPane[] {
  if (!setting) return [...STATUS_PANES];
  return STATUS_PANES.filter((pane) => setting.includes(pane));
}
