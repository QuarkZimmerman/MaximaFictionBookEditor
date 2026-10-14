/**
 * Find / Replace target of the Source view (feature 002 FR-035): as in the original, the Source
 * view uses the same Find and Replace dialogs, on the source text. Adapts the CodeMirror search
 * of `views/source/searchTarget.ts` to the session's `SearchTarget`; CodeMirror draws the
 * selection without the focus, so the match shows while the dialog keeps it.
 */

import { EditorSelection } from '@codemirror/state';

import type { SourceEditorController } from '@/views/source/sourceEditor';
import {
  expandReplacement,
  nextHit,
  selectionMatches,
  type SourceSearchOptions,
} from '@/views/source/searchTarget';

import type { FindMode, FindOptions, FindResult, SearchTarget } from './search';

function sourceOptions(options: FindOptions): SourceSearchOptions {
  return {
    matchCase: options.matchCase,
    wholeWord: options.wholeWord,
    regex: options.regex,
    direction: options.direction,
  };
}

export function createSourceFindTarget(controller: SourceEditorController): SearchTarget {
  /** The selection an incremental search started from. */
  let anchor: { from: number; to: number } | null = null;
  return {
    view: 'source',
    findNext(options: FindOptions, mode: FindMode = 'next'): FindResult {
      const view = controller.target;
      const start =
        mode === 'fromAnchor' && anchor
          ? { from: anchor.from, to: anchor.from }
          : view.state.selection.main;
      const next = nextHit(view.state, options.query, sourceOptions(options), start);
      if (!next) return false;
      view.dispatch({
        selection: EditorSelection.range(next.hit.from, next.hit.to),
        scrollIntoView: true,
        userEvent: 'select.search',
      });
      return next.wrapped ? 'wrapped' : true;
    },
    replaceCurrent(options: FindOptions, replacement: string): boolean {
      const view = controller.target;
      const current = selectionMatches(view.state, options.query, sourceOptions(options));
      if (!current) return false;
      const text = expandReplacement(replacement, current, options.regex);
      view.dispatch({
        changes: { from: current.from, to: current.to, insert: text },
        selection: EditorSelection.cursor(current.from + text.length),
        userEvent: 'input.replace',
      });
      return true;
    },
    replaceAll(options: FindOptions, replacement: string): number {
      return controller.searchTarget.replaceAll(options.query, replacement, sourceOptions(options));
    },
    selectedText(): string {
      const { state } = controller;
      return state.sliceDoc(state.selection.main.from, state.selection.main.to);
    },
    markAnchor(): void {
      const { main } = controller.state.selection;
      anchor = { from: main.from, to: main.to };
    },
    restoreAnchor(): void {
      if (anchor) {
        controller.target.dispatch({ selection: EditorSelection.range(anchor.from, anchor.to) });
      }
      anchor = null;
    },
    clearAnchor(): void {
      anchor = null;
    },
  };
}
