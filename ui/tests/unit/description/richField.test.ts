/**
 * T076 - rich annotation / history field state: the editor document is the FB2 `annotation`
 * node (same content model and marks as the Body view), Enter splits paragraphs and turns an
 * empty paragraph into an empty line + new paragraph, inline marks apply, node ids are
 * assigned, and `richFieldModel()` returns the model (undefined when only empty paragraphs).
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { toggleInlineMark } from '@/editor/commands/marks';
import type { AnnotationNode } from '@/model/document';
import {
  createRichFieldState,
  richEnter,
  richFieldIdGenerator,
  richFieldModel,
} from '@/views/description/richFieldState';

const ANNOTATION: AnnotationNode = {
  type: 'annotation',
  attrs: { nodeId: 'a1' },
  content: [
    {
      type: 'p',
      attrs: { nodeId: 'a2' },
      content: [
        { type: 'text', text: 'First ' },
        { type: 'text', text: 'line', marks: [{ type: 'emphasis' }] },
      ],
    },
    { type: 'p', attrs: { nodeId: 'a3' }, content: [{ type: 'text', text: 'Second' }] },
  ],
};

function run(
  state: EditorState,
  command: (s: EditorState, d: (tr: Transaction) => void) => boolean,
): EditorState {
  let next = state;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  expect(ok).toBe(true);
  return next;
}

describe('rich field state (T076)', () => {
  it('round-trips the annotation model and assigns node ids to new nodes', () => {
    const state = createRichFieldState(ANNOTATION, richFieldIdGenerator('titleInfo.annotation'));
    expect(state.doc.type.name).toBe('annotation');
    expect(richFieldModel(state)).toEqual(ANNOTATION);
    const empty = createRichFieldState(undefined, () => 'ui_x_1');
    expect(empty.doc.childCount).toBe(1);
    expect(empty.doc.attrs.nodeId).toBe('ui_x_1');
    expect(richFieldModel(empty)).toBeUndefined();
  });

  it('Enter splits a paragraph and turns an empty one into an empty line', () => {
    let state = createRichFieldState(ANNOTATION, richFieldIdGenerator('test.annotation'));
    const endOfSecond = state.doc.content.size - 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, endOfSecond)));
    state = run(state, richEnter);
    expect(state.doc.childCount).toBe(3);
    expect(state.doc.child(2).type.name).toBe('p');
    expect(state.doc.child(2).attrs.nodeId).toMatch(/^ui_test_annotation_\d+$/);
    // Enter on the new empty paragraph: <empty-line/> + a fresh paragraph.
    state = run(state, richEnter);
    expect(state.doc.content.content.map((n) => n.type.name)).toEqual([
      'p',
      'p',
      'empty_line',
      'p',
    ]);
    const model = richFieldModel(state)!;
    expect(model.content.map((n) => n.type)).toEqual(['p', 'p', 'empty-line', 'p']);
    expect(model.content[2]!.attrs.nodeId).toBeTruthy();
    // Splitting in the middle keeps both halves.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));
    state = run(state, richEnter);
    expect(state.doc.child(0).textContent).toBe('Fir');
    expect(state.doc.child(1).textContent).toBe('st line');
  });

  it('applies the Body view inline marks', () => {
    let state = createRichFieldState(ANNOTATION, () => 'id');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
    state = run(state, toggleInlineMark('strong'));
    const first = richFieldModel(state)!.content[0] as {
      content: { text: string; marks?: { type: string }[] }[];
    };
    expect(first.content[0]).toEqual({ type: 'text', text: 'First', marks: [{ type: 'strong' }] });
    state = run(state, toggleInlineMark('strong'));
    expect(richFieldModel(state)).toEqual(ANNOTATION);
  });
});
