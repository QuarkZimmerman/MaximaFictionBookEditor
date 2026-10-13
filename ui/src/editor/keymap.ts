/**
 * Body editor key bindings (T057), mirroring the original editor's behaviour on top of the
 * ProseMirror base keymap:
 *
 *  - Enter in a title adds a title line; Enter on an empty trailing title line leaves the title
 *    (caret moves to the text after it, creating a paragraph when the schema needs one);
 *  - Enter in a verse adds a verse; Enter on the empty last verse of a stanza starts a new
 *    stanza; Enter on the only (empty) verse of the last stanza leaves the poem;
 *  - Enter on an empty trailing paragraph of an epigraph / cite / annotation leaves it;
 *  - Enter on an empty paragraph turns it into `<empty-line/>` and opens a new paragraph below
 *    (the original saved empty `<P>` elements as empty lines);
 *  - Enter inside a table cell is swallowed (cells hold inline content only);
 *  - Backspace / Delete at a block boundary merge per schema (ProseMirror joinBackward /
 *    joinForward) and remove an adjacent `<empty-line/>`;
 *  - Tab / Shift+Tab move between table cells (a new row is appended after the last cell);
 *  - Insert toggles overwrite mode (INS/OVR pane).
 */

import {
  baseKeymap,
  chainCommands,
  joinBackward,
  joinForward,
  selectNodeBackward,
  selectNodeForward,
  splitBlockAs,
} from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import {
  TextSelection,
  type Command,
  type EditorState,
  type Plugin,
  type Transaction,
} from 'prosemirror-state';

import {
  ancestor,
  childPos,
  emptyParagraph,
  emptyStanza,
  firstTextblockPos,
  N,
} from './commands/util';
import { selectionIntoTarget } from './commands/links';
import { gotoNextCell, gotoPreviousCell } from './commands/table';

export interface KeymapOptions {
  /** Insert key: flips insert/overwrite mode. */
  toggleOvertype?: () => void;
}

/* ------------------------------------------------------------------------ */
/* Enter                                                                    */
/* ------------------------------------------------------------------------ */

const LEAVABLE_ON_EMPTY_LINE = new Set(['title', 'epigraph', 'cite', 'annotation']);

/** Caret in an empty text block that is the last child of its container. */
function emptyTrailingBlock(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.content.size > 0) return null;
  if ($from.depth < 2) return null;
  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  if (index !== container.childCount - 1) return null;
  return {
    container,
    containerPos: $from.before($from.depth - 1),
    index,
    blockPos: $from.before(),
  };
}

/**
 * Moves the caret out of the node at `pos`: into the next block when it is an empty text
 * block, otherwise into a new empty paragraph inserted after the node (when the parent allows
 * one) or, failing that, into the first text block that follows. Returns the transaction or
 * null when the caret cannot leave.
 */
function leaveAfter(tr: Transaction, pos: number): Transaction | null {
  const node = tr.doc.nodeAt(pos);
  if (!node) return null;
  const $pos = tr.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const after = pos + node.nodeSize;
  const next = parent.maybeChild(index + 1);
  if (next?.isTextblock && next.content.size === 0) {
    return tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  if (parent.canReplaceWith(index + 1, index + 1, N.p!)) {
    tr.insert(after, emptyParagraph());
    return tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  // No paragraph allowed here (e.g. after a body title): go to the next block's text, skipping
  // its own title / image header (as "Go to footnote" does).
  if (next) {
    const target = next.isTextblock ? after + 1 : null;
    if (target !== null) return tr.setSelection(TextSelection.create(tr.doc, target));
    if (firstTextblockPos(next, after) !== null) {
      return tr.setSelection(selectionIntoTarget(tr.doc, { node: next, pos: after }));
    }
  }
  return null;
}

/** Enter inside a table cell: nothing happens (cells are single-line in FB2). */
const enterInCell: Command = (state) => !!ancestor(state.selection.$from, ['td', 'th']);

/** Enter on an empty trailing line of a title / epigraph / cite / annotation leaves it. */
const leaveContainer: Command = (state, dispatch) => {
  const found = emptyTrailingBlock(state);
  if (!found || !LEAVABLE_ON_EMPTY_LINE.has(found.container.type.name)) return false;
  if (found.container.childCount < 2) return false;
  if (dispatch) {
    const tr = state.tr.delete(found.blockPos, found.blockPos + 2);
    const result = leaveAfter(tr, found.containerPos);
    if (!result) return false;
    dispatch(result.scrollIntoView());
  }
  return true;
};

/** Enter on the empty last verse: new stanza; on the only verse of an empty stanza: leave. */
const leaveStanza: Command = (state, dispatch) => {
  const found = emptyTrailingBlock(state);
  if (!found || found.container.type !== N.stanza || state.selection.$from.parent.type !== N.v) {
    return false;
  }
  const verses = found.container.content.content.filter((c) => c.type === N.v).length;
  const $stanza = state.doc.resolve(found.containerPos);
  const poem = $stanza.parent;
  const stanzaIndex = $stanza.index();
  if (verses > 1) {
    if (dispatch) {
      const tr = state.tr.delete(found.blockPos, found.blockPos + 2);
      const after = found.containerPos + found.container.nodeSize - 2;
      tr.insert(after, emptyStanza());
      dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView());
    }
    return true;
  }
  // The only verse is empty: drop the stanza and leave the poem (never remove the last stanza).
  const stanzas = poem.content.content.filter((c) => c.type === N.stanza).length;
  if (stanzas < 2 || stanzaIndex !== poem.childCount - 1) return false;
  if (dispatch) {
    const tr = state.tr.delete(found.containerPos, found.containerPos + found.container.nodeSize);
    const result = leaveAfter(tr, $stanza.before());
    if (!result) return false;
    dispatch(result.scrollIntoView());
  }
  return true;
};

/** Enter on an empty paragraph: it becomes an empty line and a new paragraph follows it. */
const emptyParagraphToEmptyLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== N.p || $from.parent.content.size > 0 || $from.depth < 2) {
    return false;
  }
  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  if (!['section', 'cite', 'annotation', 'epigraph'].includes(container.type.name)) return false;
  if (!container.canReplaceWith(index, index + 1, N.empty_line!)) return false;
  if (dispatch) {
    const pos = $from.before();
    const tr = state.tr.replaceWith(pos, pos + 2, [N.empty_line!.create(), emptyParagraph()]);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView());
  }
  return true;
};

/**
 * Plain split: the new block keeps the type/attributes of the current one (verses stay verses)
 * but never its ids - the XML `id` must stay unique and the node id is re-assigned by the
 * node id plugin.
 */
const splitParagraph: Command = splitBlockAs((node, atEnd) => {
  if (atEnd && node.type !== N.v) return null; // default content type of the parent (p after a subtitle)
  return { type: node.type, attrs: { ...node.attrs, nodeId: null, id: null } };
});

export const enterCommand: Command = chainCommands(
  enterInCell,
  leaveContainer,
  leaveStanza,
  emptyParagraphToEmptyLine,
  splitParagraph,
);

/* ------------------------------------------------------------------------ */
/* Backspace / Delete                                                       */
/* ------------------------------------------------------------------------ */

/** Backspace at the start of a text block preceded by an empty line removes that line. */
const deleteEmptyLineBefore: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset > 0 || $from.depth < 1) {
    return false;
  }
  const index = $from.index($from.depth - 1);
  if (index === 0) return false;
  const container = $from.node($from.depth - 1);
  const previous = container.child(index - 1);
  if (previous.type !== N.empty_line) return false;
  if (dispatch) {
    const pos = childPos($from.before($from.depth - 1), container, index - 1);
    dispatch(state.tr.delete(pos, pos + previous.nodeSize).scrollIntoView());
  }
  return true;
};

/** Delete at the end of a text block followed by an empty line removes that line. */
const deleteEmptyLineAfter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset < $from.parent.content.size) {
    return false;
  }
  if ($from.depth < 1) return false;
  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  const next = container.maybeChild(index + 1);
  if (!next || next.type !== N.empty_line) return false;
  if (dispatch) {
    const pos = $from.after();
    dispatch(state.tr.delete(pos, pos + next.nodeSize).scrollIntoView());
  }
  return true;
};

export const backspaceCommand: Command = chainCommands(
  deleteEmptyLineBefore,
  joinBackward,
  selectNodeBackward,
);

export const deleteCommand: Command = chainCommands(
  deleteEmptyLineAfter,
  joinForward,
  selectNodeForward,
);

/* ------------------------------------------------------------------------ */
/* Tab                                                                      */
/* ------------------------------------------------------------------------ */

/** Tab outside a table is swallowed so the focus stays in the editor. */
const swallow: Command = () => true;

export const tabCommand: Command = chainCommands(gotoNextCell, swallow);
export const shiftTabCommand: Command = chainCommands(gotoPreviousCell, swallow);

/* ------------------------------------------------------------------------ */
/* The keymap                                                               */
/* ------------------------------------------------------------------------ */

export function bodyKeymap(options: KeymapOptions = {}): Plugin {
  const bindings: Record<string, Command> = {
    Enter: enterCommand,
    'Shift-Enter': enterCommand,
    Backspace: backspaceCommand,
    'Mod-Backspace': backspaceCommand,
    Delete: deleteCommand,
    'Mod-Delete': deleteCommand,
    Tab: tabCommand,
    'Shift-Tab': shiftTabCommand,
    Insert: () => {
      options.toggleOvertype?.();
      return true;
    },
  };
  return keymap(bindings);
}

/**
 * The ProseMirror base keymap (select all, arrow handling...), lowest precedence. Undo/redo and
 * the editing hotkeys are dispatched globally by the command registry, not here.
 */
export function baseEditorKeymap(): Plugin {
  return keymap(baseKeymap);
}
