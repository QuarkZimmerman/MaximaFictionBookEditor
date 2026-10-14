/**
 * The current Find / Replace match (feature 002 FR-030). ProseMirror draws the selection only
 * while the editor has the focus, and the modeless Find dialog keeps it, so the match the
 * search selected is also drawn as a highlight of its own. A transaction carrying
 * `withSearchMatch(tr, from, to)` sets it; the next edit or selection change clears it.
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

interface MatchRange {
  from: number;
  to: number;
}

export const searchMatchKey = new PluginKey<DecorationSet>('mfbe-search-match');

/** Marks `tr` (which selects the match) as showing `[from, to)` as the current match. */
export function withSearchMatch(tr: Transaction, from: number, to: number): Transaction {
  return tr.setMeta(searchMatchKey, { from, to } satisfies MatchRange);
}

export function searchMatchPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: searchMatchKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, current) {
        const range = tr.getMeta(searchMatchKey) as MatchRange | undefined;
        if (range) {
          return DecorationSet.create(tr.doc, [
            Decoration.inline(range.from, range.to, { class: 'mfbe-search-match' }),
          ]);
        }
        return tr.docChanged || tr.selectionSet ? DecorationSet.empty : current;
      },
    },
    props: {
      decorations: (state) => searchMatchKey.getState(state),
    },
  });
}
