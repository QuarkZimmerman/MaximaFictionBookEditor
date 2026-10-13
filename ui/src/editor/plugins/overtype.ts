/**
 * Insert / overwrite mode (the INS/OVR pane of the status bar, toggled with the Insert key as in
 * the original editor). In overwrite mode a typed character replaces the character after the
 * caret instead of being inserted, except at the end of a text block or before an inline
 * object (image, unknown element), where it is inserted.
 */

import { Plugin, PluginKey } from 'prosemirror-state';

export const overtypePluginKey = new PluginKey('mfbe-overtype');

export function overtypePlugin(isOvertype: () => boolean): Plugin {
  return new Plugin({
    key: overtypePluginKey,
    props: {
      handleTextInput(view, from, to, text) {
        if (!isOvertype() || from !== to || !text) return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        const after = $from.nodeAfter;
        if (!after || !after.isText) return false; // end of block or an inline object: insert
        // Characters available for overwriting: text up to the next inline object / block end.
        let available = 0;
        const parent = $from.parent;
        for (let i = $from.index(); i < parent.childCount; i += 1) {
          const child = parent.child(i);
          if (!child.isText) break;
          available += child.nodeSize - (i === $from.index() ? $from.textOffset : 0);
        }
        const replaced = Math.min(text.length, available);
        const tr = view.state.tr.insertText(text, from, from + replaced);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}
