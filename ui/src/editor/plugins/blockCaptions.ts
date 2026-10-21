/**
 * Captions of the annotation and history blocks (feature 004, US2; spec FR-010): a node
 * decoration puts `data-caption` - the text of the tree node, "Annotation" / "History" in the
 * interface language - on each block and the stylesheet draws it through `::before`
 * (`editor/styles.css`). Generated content is never part of the document: it is not selected,
 * copied, found, spell-checked or counted. The decorations are rebuilt when the document
 * changes (the blocks are the first children, cheap to find) and on a `refresh` meta, which
 * the Body controller dispatches after a language change (the NBSP marker plugin's pattern).
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { blockKindOf } from '../schema';

export const blockCaptionsKey = new PluginKey<DecorationSet>('mfbe-block-captions');

/** The caption of a block kind; the controller supplies the localised texts. */
export type BlockCaptionSource = () => (key: string) => string;

export const BLOCK_CAPTION_KEYS = {
  annotation: 'tree.node.annotation',
  history: 'tree.node.history',
} as const;

function decorate(state: EditorState, translate: (key: string) => string): DecorationSet {
  const decorations: Decoration[] = [];
  let pos = 0;
  for (let i = 0; i < state.doc.childCount; i += 1) {
    const child = state.doc.child(i);
    const kind = blockKindOf(child.type.name);
    if (!kind) break;
    decorations.push(
      Decoration.node(pos, pos + child.nodeSize, {
        'data-caption': translate(BLOCK_CAPTION_KEYS[kind]),
      }),
    );
    pos += child.nodeSize;
  }
  return DecorationSet.create(state.doc, decorations);
}

export function blockCaptionsPlugin(source: BlockCaptionSource): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: blockCaptionsKey,
    state: {
      init: (_config, state) => decorate(state, source()),
      apply: (tr: Transaction, set: DecorationSet, _old, state) => {
        if (tr.docChanged || tr.getMeta(blockCaptionsKey) === 'refresh') {
          return decorate(state, source());
        }
        return set;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
