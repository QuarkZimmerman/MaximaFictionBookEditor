/**
 * Find/Replace over the Source editor text (T079, FR-060 "Find/Replace"): the hook the search
 * feature (US2, `edit.find` / `edit.findNext` / `edit.replace`) plugs into when the Source view
 * is the active scope. Self-contained: it only needs a CodeMirror `EditorView` and uses the
 * `@codemirror/search` cursors (literal, whole word, match case, regular expression).
 *
 * The search feature obtains the target of the current document through
 * `getSourceEditor(store)?.searchTarget` (see `sourceEditor.ts`).
 */

import { RegExpCursor, SearchCursor } from '@codemirror/search';
import { EditorSelection, type EditorState, type Text } from '@codemirror/state';

import type { EditorTarget } from './extensions';

export interface SourceSearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** `'up'` searches backwards from the selection. Default `'down'`. */
  direction?: 'up' | 'down';
  /** Continue from the other end of the document when nothing is found (default true). */
  wrap?: boolean;
}

export interface SourceMatch {
  from: number;
  to: number;
  line: number;
  column: number;
}

/** What the US2 search feature drives for the Source scope. */
export interface SourceSearchTarget {
  /** Selects the next match after (or before, `direction: 'up'`) the selection. */
  findNext(query: string, options?: SourceSearchOptions): boolean;
  /**
   * Replaces the current selection when it is a match of `query`, then selects the next match.
   * Returns true when a replacement was made.
   */
  replace(query: string, replacement: string, options?: SourceSearchOptions): boolean;
  /** Replaces every match in one undoable change; returns the number of replacements. */
  replaceAll(query: string, replacement: string, options?: SourceSearchOptions): number;
  /** The current selection as a match, or null when it is empty. */
  currentSelection(): SourceMatch | null;
}

interface Hit {
  from: number;
  to: number;
  match?: RegExpExecArray;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordBoundary(doc: Text, from: number, to: number): boolean {
  const before = from > 0 ? doc.sliceString(from - 1, from) : '';
  const after = to < doc.length ? doc.sliceString(to, to + 1) : '';
  const first = doc.sliceString(from, from + 1);
  const last = doc.sliceString(to - 1, to);
  const startsWord = WORD_CHAR.test(first);
  const endsWord = WORD_CHAR.test(last);
  return (!startsWord || !WORD_CHAR.test(before)) && (!endsWord || !WORD_CHAR.test(after));
}

/** All matches of `query` in `[from, to)`, in document order. */
export function findMatches(
  state: EditorState,
  query: string,
  options: SourceSearchOptions = {},
  from = 0,
  to = state.doc.length,
  limit = Infinity,
): Hit[] {
  if (!query) return [];
  const { doc } = state;
  const hits: Hit[] = [];
  const accept = (hit: Hit): boolean => {
    if (options.wholeWord && !isWordBoundary(doc, hit.from, hit.to)) return true;
    hits.push(hit);
    return hits.length < limit;
  };
  if (options.regex) {
    let cursor: RegExpCursor;
    try {
      cursor = new RegExpCursor(doc, query, { ignoreCase: !options.matchCase }, from, to);
    } catch {
      return []; // invalid pattern
    }
    while (!cursor.next().done) {
      const { value } = cursor;
      if (value.to === value.from) continue; // never loop on empty matches
      if (!accept({ from: value.from, to: value.to, match: value.match })) break;
    }
  } else {
    const normalize = options.matchCase ? undefined : (s: string) => s.toLowerCase();
    const cursor = new SearchCursor(doc, query, from, to, normalize);
    while (!cursor.next().done) {
      const { value } = cursor;
      if (!accept({ from: value.from, to: value.to })) break;
    }
  }
  return hits;
}

/** The replacement text for a hit (`$1`/`$&` groups for regular expressions). */
export function expandReplacement(replacement: string, hit: Hit, regex: boolean): string {
  if (!regex || !hit.match) return replacement;
  const match = hit.match;
  return replacement.replace(/\$([$&]|\d+)/g, (whole, group: string) => {
    if (group === '$') return '$';
    if (group === '&') return match[0];
    const value = match[Number(group)];
    return value === undefined ? whole : value;
  });
}

function nextHit(state: EditorState, query: string, options: SourceSearchOptions): Hit | null {
  const { main } = state.selection;
  const wrap = options.wrap ?? true;
  if (options.direction === 'up') {
    const before = findMatches(state, query, options, 0, main.from);
    if (before.length > 0) return before[before.length - 1]!;
    if (!wrap) return null;
    const all = findMatches(state, query, options, main.from, state.doc.length);
    return all.length > 0 ? all[all.length - 1]! : null;
  }
  const after = findMatches(state, query, options, main.to, state.doc.length, 1);
  if (after.length > 0) return after[0]!;
  if (!wrap) return null;
  const first = findMatches(state, query, options, 0, main.to, 1);
  return first.length > 0 ? first[0]! : null;
}

function selectionMatches(
  state: EditorState,
  query: string,
  options: SourceSearchOptions,
): Hit | null {
  const { main } = state.selection;
  if (main.empty) return null;
  const hits = findMatches(state, query, options, main.from, main.to, 1);
  const hit = hits[0];
  return hit && hit.from === main.from && hit.to === main.to ? hit : null;
}

export function createSourceSearchTarget(getView: () => EditorTarget | null): SourceSearchTarget {
  const toMatch = (state: EditorState, hit: Hit): SourceMatch => {
    const line = state.doc.lineAt(hit.from);
    return { from: hit.from, to: hit.to, line: line.number, column: hit.from - line.from + 1 };
  };
  const select = (view: EditorTarget, hit: Hit): void => {
    view.dispatch({
      selection: EditorSelection.range(hit.from, hit.to),
      scrollIntoView: true,
      userEvent: 'select.search',
    });
  };
  return {
    findNext(query, options = {}) {
      const view = getView();
      if (!view) return false;
      const hit = nextHit(view.state, query, options);
      if (!hit) return false;
      select(view, hit);
      return true;
    },
    replace(query, replacement, options = {}) {
      const view = getView();
      if (!view) return false;
      const current = selectionMatches(view.state, query, options);
      if (!current) {
        // Nothing selected to replace: behave like Find Next so the user sees the first match.
        const hit = nextHit(view.state, query, options);
        if (hit) select(view, hit);
        return false;
      }
      const text = expandReplacement(replacement, current, !!options.regex);
      view.dispatch({
        changes: { from: current.from, to: current.to, insert: text },
        selection: EditorSelection.cursor(current.from + text.length),
        userEvent: 'input.replace',
      });
      const next = nextHit(view.state, query, options);
      if (next) select(view, next);
      return true;
    },
    replaceAll(query, replacement, options = {}) {
      const view = getView();
      if (!view) return 0;
      const hits = findMatches(view.state, query, options);
      if (hits.length === 0) return 0;
      view.dispatch({
        changes: hits.map((hit) => ({
          from: hit.from,
          to: hit.to,
          insert: expandReplacement(replacement, hit, !!options.regex),
        })),
        userEvent: 'input.replace.all',
      });
      return hits.length;
    },
    currentSelection() {
      const view = getView();
      if (!view) return null;
      const { main } = view.state.selection;
      return main.empty ? null : toMatch(view.state, { from: main.from, to: main.to });
    },
  };
}
