/**
 * Feature 007 (T105, data-model §4, DP-4): the `pictureLayout` plugin marks every text block
 * whose first child is an inline picture with the class `fb-starts-with-picture` (pictures.css
 * gives it no first-line indent, so a picture as wide as the text area does not overflow by
 * the indent). The mark is absent otherwise and follows the edits. Both hosts install it: the
 * Body view's editor state and the annotation and history fields'.
 */

import { TextSelection, type EditorState } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';

import { pictureLayoutKey } from '@/editor/plugins/pictureLayout';
import { fb2Schema } from '@/editor/schema';
import type { AnnotationNode } from '@/model/document';
import { createBodyEditorState } from '@/views/body/bodyEditor';
import { createRichFieldState } from '@/views/description/richFieldState';

function picture(nodeId: string, href = '#a.png') {
  return { type: 'inline-image', attrs: { nodeId, href } };
}

function text(value: string) {
  return { type: 'text', text: value };
}

const ANNOTATION = {
  type: 'annotation',
  attrs: { nodeId: 'a' },
  content: [
    { type: 'p', attrs: { nodeId: 'p1' }, content: [picture('i1'), text(' after')] },
    { type: 'p', attrs: { nodeId: 'p2' }, content: [text('before '), picture('i2')] },
    { type: 'p', attrs: { nodeId: 'p3' }, content: [picture('i3')] },
    { type: 'p', attrs: { nodeId: 'p4' }, content: [text('no picture')] },
  ],
} as unknown as AnnotationNode;

let ids = 0;
const nextId = () => `ui_${++ids}`;

/** The node ids of the text blocks the plugin marks, in document order. */
function marked(state: EditorState): string[] {
  const set = pictureLayoutKey.getState(state) as DecorationSet;
  const out: string[] = [];
  for (const decoration of set.find()) {
    const node = state.doc.nodeAt(decoration.from);
    expect((decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(
      'fb-starts-with-picture',
    );
    expect(decoration.to).toBe(decoration.from + (node?.nodeSize ?? 0));
    out.push(String(node?.attrs.nodeId));
  }
  return out;
}

/** The position just inside the text block with this node id. */
function startOf(state: EditorState, nodeId: string): number {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isTextblock && node.attrs.nodeId === nodeId) found = pos + 1;
    return found < 0;
  });
  return found;
}

describe('the pictureLayout plugin', () => {
  it('marks the text blocks whose first child is an inline picture, and no other', () => {
    const state = createRichFieldState(ANNOTATION, nextId);
    expect(marked(state)).toEqual(['p1', 'p3']);
  });

  it('follows the edits: text typed before the picture removes the mark, deleting it restores it', () => {
    let state = createRichFieldState(ANNOTATION, nextId);
    const at = startOf(state, 'p1');
    state = state.apply(state.tr.insertText('x', at));
    expect(marked(state)).toEqual(['p3']);
    state = state.apply(state.tr.delete(at, at + 1));
    expect(marked(state)).toEqual(['p1', 'p3']);
    // Deleting the text before a picture makes the picture the first child.
    const p2 = startOf(state, 'p2');
    state = state.apply(state.tr.delete(p2, p2 + 'before '.length));
    expect(marked(state)).toEqual(['p1', 'p2', 'p3']);
    // A picture inserted at a block's start marks it.
    const p4 = startOf(state, 'p4');
    state = state.apply(
      state.tr.insert(p4, fb2Schema.nodes.inline_image.create({ nodeId: 'i4', href: '#b.png' })),
    );
    expect(marked(state)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('marks both halves correctly when a block is split before its picture', () => {
    let state = createRichFieldState(ANNOTATION, nextId);
    const p2 = startOf(state, 'p2');
    // Split "before |<picture>": the new block starts with the picture.
    state = state.apply(
      state.tr
        .setSelection(TextSelection.create(state.doc, p2 + 'before '.length))
        .split(p2 + 'before '.length),
    );
    expect(marked(state)).toHaveLength(3);
  });

  it('is installed in the Body view’s editor state too', () => {
    const doc = fb2Schema.nodes.doc.create(null, [
      fb2Schema.nodes.body.create({ nodeId: 'b1' }, [
        fb2Schema.nodes.section.create({ nodeId: 's1' }, [
          fb2Schema.nodes.p.create({ nodeId: 'q1' }, [
            fb2Schema.nodes.inline_image.create({ nodeId: 'j1', href: '#a.png' }),
          ]),
          fb2Schema.nodes.p.create({ nodeId: 'q2' }, fb2Schema.text('text')),
        ]),
      ]),
    ]);
    const state = createBodyEditorState(doc, { getNbspChar: () => '\u00A0' });
    expect(marked(state)).toEqual(['q1']);
  });
});
