/**
 * ProseMirror state of the rich annotation / history fields (T076): the editor document *is*
 * the `annotation` node of the FB2 schema, so the content model and the inline marks are those
 * of the Body view. Keymap: Enter splits paragraphs (an empty top-level paragraph becomes an
 * empty line followed by a new paragraph, as in the Body view; in a table cell it does nothing),
 * Backspace / Delete merge per schema, Mod-B / Mod-I toggle strong / emphasis. No history plugin:
 * undo goes through the Description controller and the global undo coordinator.
 *
 * Feature 006, US10 (FR-044, FR-005; C34; U14; data-model §4.6 "The Tab row", §5.4): the field
 * is a table host. The table plugin (`tableEditingPlugin`, with the field's node-id generator)
 * comes first, ahead of the keymaps, so the block of cells - made by the mouse, Shift+click or
 * Shift+Arrow -, Delete and Backspace of a block or of a selected table, type-over and the
 * composition rule come before them, as in the Body view; the selection-sync plugin after it
 * keeps the browser selection read before a press elsewhere (a menu, the Table bar) or a key.
 * Tab moves to the next cell, its content selected, and appends a row in the table's last cell
 * (the Tab row, one discrete undo step); Shift+Tab moves back; both give the key up outside
 * tables, and Shift+Tab also in the table's first cell, so the browser moves the focus on and
 * out of the field (unlike the Body view, which keeps Tab).
 */

import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { EditorState, TextSelection, type Command, type Plugin } from 'prosemirror-state';

import { toggleInlineMark } from '@/editor/commands/marks';
import { cellPositions, gotoNextCell, gotoPreviousCell } from '@/editor/commands/table';
import { emptyParagraph, N } from '@/editor/commands/util';
import { annotationFromModel } from '@/editor/fromModel';
import { backspaceCommand, deleteCommand, enterCommand } from '@/editor/keymap';
import { nodeIdPlugin } from '@/editor/plugins/nodeIds';
import { selectionSyncPlugin } from '@/editor/plugins/selectionSync';
import { assignNodeIds, createNodeIdGenerator } from '@/editor/schema';
import { tableEditingPlugin } from '@/editor/table/plugin';
import { cellRefAround } from '@/editor/table/selection';
import { annotationToModel } from '@/editor/toModel';
import type { AnnotationNode } from '@/model/document';

import type { FieldKey } from './model';

/** Node id generators per field (module-wide so re-mounts never reuse an id). */
const generators = new Map<string, () => string>();

export function richFieldIdGenerator(fieldKey: FieldKey): () => string {
  let generator = generators.get(fieldKey);
  if (!generator) {
    generator = createNodeIdGenerator(`ui_${fieldKey.replace(/\W+/g, '_')}_`);
    generators.set(fieldKey, generator);
  }
  return generator;
}

/** Enter on an empty top-level paragraph: it becomes an empty line and a new paragraph follows. */
const topLevelEmptyParagraph: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type !== N.p || $from.parent.content.size > 0) {
    return false;
  }
  const index = $from.index(0);
  if (!state.doc.canReplaceWith(index, index + 1, N.empty_line!)) return false;
  if (dispatch) {
    const pos = $from.before();
    const tr = state.tr.replaceWith(pos, pos + 2, [N.empty_line!.create(), emptyParagraph()]);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView());
  }
  return true;
};

export const richEnter: Command = chainCommands(topLevelEmptyParagraph, enterCommand);

/**
 * Tab in a rich field (FR-005): the next cell with its content selected, and in the table's last
 * cell the Tab row (`planTabRow`, a `DISCRETE_STEP` commit with the field's node ids); false
 * outside tables, so the focus moves on.
 */
export function richTab(nextId: () => string): Command {
  return gotoNextCell({ nextId });
}

/**
 * Shift+Tab in a rich field: the previous cell; false outside tables and when the cell of the
 * selection's head - a block's head cell - is the table's first cell in document order, so the
 * focus leaves the field (C34, U14).
 */
export const richShiftTab: Command = (state, dispatch, view) => {
  const head = cellRefAround(state.selection.$head);
  if (!head) return false;
  if (cellPositions(state, head.tablePos)[0] === head.cellPos) return false;
  return gotoPreviousCell(state, dispatch, view);
};

/** Editor state for an annotation model (an empty annotation gets one empty paragraph). */
export function createRichFieldState(
  value: AnnotationNode | undefined,
  nextId: () => string,
  extraPlugins: Plugin[] = [],
): EditorState {
  let doc = annotationFromModel(value);
  if (doc.childCount === 0) doc = doc.type.create(doc.attrs, emptyParagraph());
  doc = assignNodeIds(doc, nextId);
  const bindings: Record<string, Command> = {
    Tab: richTab(nextId),
    'Shift-Tab': richShiftTab,
    Enter: richEnter,
    'Shift-Enter': richEnter,
    Backspace: backspaceCommand,
    'Mod-Backspace': backspaceCommand,
    Delete: deleteCommand,
    'Mod-Delete': deleteCommand,
    'Mod-b': toggleInlineMark('strong'),
    'Mod-B': toggleInlineMark('strong'),
    'Mod-i': toggleInlineMark('emphasis'),
    'Mod-I': toggleInlineMark('emphasis'),
  };
  return EditorState.create({
    doc,
    plugins: [
      // First, as in the Body view: the block, a selected table's keys, type-over (US10).
      tableEditingPlugin({ nextNodeId: nextId }),
      selectionSyncPlugin(),
      keymap(bindings),
      keymap(baseKeymap),
      nodeIdPlugin(nextId),
      ...extraPlugins,
    ],
  });
}

/** Model of the editor document: undefined when it holds nothing but empty paragraphs. */
export function richFieldModel(state: EditorState): AnnotationNode | undefined {
  const doc = state.doc;
  let meaningful = false;
  doc.forEach((child) => {
    if (child.type !== N.p || child.content.size > 0) meaningful = true;
  });
  if (!meaningful) return undefined;
  return annotationToModel(doc);
}
