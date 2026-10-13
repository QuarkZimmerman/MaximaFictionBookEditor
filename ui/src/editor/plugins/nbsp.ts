/**
 * Non-breaking space marker (the original editor replaced U+00A0 with the configurable
 * "display character", Settings > Other > Non-breaking space). Here every NBSP keeps its real
 * character in the document and gets an inline decoration `span.fb-nbsp[data-char]`; the CSS in
 * `styles.css` paints the display character over the invisible space. T068 adds the insert
 * command and hotkey on top of this plugin.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const NBSP = '\u00A0';
export const DEFAULT_NBSP_DISPLAY_CHAR = '\u00B0';

export const nbspPluginKey = new PluginKey<DecorationSet>('mfbe-nbsp');

export function nbspDecorations(doc: PMNode, displayChar: string): DecorationSet {
  if (!displayChar) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const text = node.text;
    let index = text.indexOf(NBSP);
    while (index >= 0) {
      decorations.push(
        Decoration.inline(pos + index, pos + index + 1, {
          class: 'fb-nbsp',
          'data-char': displayChar,
        }),
      );
      index = text.indexOf(NBSP, index + 1);
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * `getDisplayChar` is read on every rebuild so the setting can change without re-creating the
 * editor; dispatch a transaction with `setMeta(nbspPluginKey, 'refresh')` to force a rebuild.
 */
export function nbspMarkerPlugin(getDisplayChar: () => string): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: nbspPluginKey,
    state: {
      init: (_config, state) => nbspDecorations(state.doc, getDisplayChar()),
      apply(tr, decorations, _old, state) {
        if (tr.docChanged || tr.getMeta(nbspPluginKey) === 'refresh') {
          return nbspDecorations(state.doc, getDisplayChar());
        }
        return decorations;
      },
    },
    props: {
      decorations(state) {
        return nbspPluginKey.getState(state);
      },
    },
  });
}
