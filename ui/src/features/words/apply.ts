/**
 * Applying the Words tool to the book (T136): the whole-word pattern that mirrors the core's
 * segmentation (`words.analyze`: letters, marks and digits, with apostrophes / hyphens only
 * *inside* a word, soft hyphens ignored), Find / Next / Replace of the current word in the Body
 * through the search feature's Body target, and OK = every marked replacement document-wide
 * (whole word, case-sensitive) as ONE undo entry reporting "N replacement(s) done".
 */

import { escapeRegExp } from '@/features/search/replacement';
import { getSearchSession, type FindOptions, type SearchTarget } from '@/features/search/search';
import type { AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';

import type { WordRow } from './session';

const WORD_CHARS = '\\p{L}\\p{M}\\p{N}';
const CONNECTORS = "'\\u2019\\u02BC\\u002D\\u2010\\u2011";
const SOFT_HYPHEN = '\\u00AD';

/**
 * Regular-expression source matching `word` as the core counts it: not preceded / followed by
 * a word character, nor glued to one by an apostrophe or hyphen (which only join words), with
 * optional soft hyphens between the letters.
 */
export function wordPattern(word: string): string {
  const body = [...word].map((ch) => escapeRegExp(ch)).join(`${SOFT_HYPHEN}*`);
  const before = `(?<![${WORD_CHARS}]${SOFT_HYPHEN}*)(?<![${WORD_CHARS}]${SOFT_HYPHEN}*[${CONNECTORS}]${SOFT_HYPHEN}*)`;
  const after = `(?!${SOFT_HYPHEN}*[${WORD_CHARS}])(?!${SOFT_HYPHEN}*[${CONNECTORS}]${SOFT_HYPHEN}*[${WORD_CHARS}])`;
  return `${before}${body}${after}`;
}

/** The compiled pattern (unit tests, previews). */
export function wordRegExp(word: string): RegExp {
  return new RegExp(wordPattern(word), 'gu');
}

/** Find options the search feature uses for a Words-tool word (regex, case-sensitive). */
export function wordFindOptions(word: string): FindOptions {
  return {
    query: wordPattern(word),
    wholeWord: false,
    matchCase: true,
    regex: true,
    direction: 'down',
  };
}

/**
 * Replacement text for the search feature's regex mode: `$` and `\` introduce group references
 * there and cannot be escaped, so they are dropped from a replacement word (a word never needs
 * them).
 */
export function literalReplacement(text: string): string {
  return text.replace(/[$\\]/g, '');
}

/** The Body search target when the Body view is active (the Words tool acts on the body). */
export function bodySearchTarget(store: AppStore): SearchTarget | null {
  if (store.getState().activeView !== 'body') return null;
  try {
    const target = getSearchSession(store).activeTarget();
    return target && target.view === 'body' ? target : null;
  } catch {
    return null; // no search session for this store (editing feature not registered)
  }
}

/** Selects the next occurrence of `word` in the body (wrapping); false when there is none. */
export function findWordNext(target: SearchTarget, word: string): boolean {
  return target.findNext(wordFindOptions(word), 'next') !== false;
}

/** Replaces the occurrence selected by `findWordNext` with `replacement`. */
export function replaceCurrentWord(
  target: SearchTarget,
  word: string,
  replacement: string,
): boolean {
  return target.replaceCurrent(wordFindOptions(word), literalReplacement(replacement));
}

/**
 * Applies every effective replacement document-wide as one undo entry (`label`). Returns the
 * number of replaced occurrences.
 */
export async function applyWordReplacements(
  undo: UndoCoordinator,
  target: SearchTarget,
  rows: readonly WordRow[],
  label: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  return undo.group(label, () => {
    let count = 0;
    for (const row of rows) {
      count += target.replaceAll(wordFindOptions(row.word), literalReplacement(row.replacement));
    }
    return count;
  });
}
