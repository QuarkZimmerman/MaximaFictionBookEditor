/**
 * ProseMirror state of the rich annotation / history fields (T076): the editor document *is*
 * the `annotation` node of the FB2 schema, so the content model and the inline marks are those
 * of the Body view. Keymap: Enter splits paragraphs (an empty top-level paragraph becomes an
 * empty line followed by a new paragraph, as in the Body view), Backspace / Delete merge per
 * schema, Mod-B / Mod-I toggle strong / emphasis. No history plugin: undo goes through the
 * Description controller and the global undo coordinator.
 */

import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';

import { toggleInlineMark } from '@/editor/commands/marks';
import { emptyParagraph, N } from '@/editor/commands/util';
import { annotationFromModel } from '@/editor/fromModel';
import { backspaceCommand, deleteCommand, enterCommand } from '@/editor/keymap';
import { nodeIdPlugin } from '@/editor/plugins/nodeIds';
import { assignNodeIds, createNodeIdGenerator } from '@/editor/schema';
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

/** Editor state for an annotation model (an empty annotation gets one empty paragraph). */
export function createRichFieldState(
  value: AnnotationNode | undefined,
  nextId: () => string,
): EditorState {
  let doc = annotationFromModel(value);
  if (doc.childCount === 0) doc = doc.type.create(doc.attrs, emptyParagraph());
  doc = assignNodeIds(doc, nextId);
  const bindings: Record<string, Command> = {
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
    plugins: [keymap(bindings), keymap(baseKeymap), nodeIdPlugin(nextId)],
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
