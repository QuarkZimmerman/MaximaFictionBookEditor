/**
 * Untouched cells survive a table command unchanged (feature 006, T038; FR-047; R1.12; C19):
 * span values `null`, 0, 1, −1, 2 and `"x"` (kept in `unknownAttrs`) and the cell language come
 * back as read through `nodeFromModel`, a commit that changes another row and `nodeToModel`;
 * and `withSpans` on a cell read from `colspan="abc"` writes `colspan: 3` without the kept text
 * (C19's UI half, recorded by T025).
 */

import { EditorState, TextSelection } from 'prosemirror-state';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { nodeToModel } from '@/editor/toModel';
import { commitTableEdit, withSpans } from '@/editor/table/edit';
import { caretAt } from '@/editor/table/ops';

import { childrenOf, docOf, pos, retyped, withChild } from './helpers';

const cell = (nodeId: string, attrs: Record<string, unknown>, text = 'x'): ModelNodeJson => ({
  type: 'td',
  attrs: { nodeId, ...attrs },
  content: text ? [{ type: 'text', text }] : [],
});

const TABLE: ModelNodeJson = {
  type: 'table',
  attrs: { nodeId: 't' },
  content: [
    {
      type: 'tr',
      attrs: { nodeId: 'r0' },
      content: [
        cell('c0', {}),
        cell('c1', { rowspan: 0 }),
        cell('c2', { colspan: 1 }),
        cell('c3', { rowspan: -1, lang: 'de' }),
      ],
    },
    {
      type: 'tr',
      attrs: { nodeId: 'r1', align: 'center' },
      content: [
        cell('c4', { colspan: 2, lang: '' }),
        cell('c5', { unknownAttrs: { colspan: 'x', rowspan: '00' } }),
        cell('c6', { id: 'keep', style: 'st', valign: 'bottom' }, ''),
      ],
    },
    {
      type: 'tr',
      attrs: { nodeId: 'r2' },
      content: [cell('c7', {}), cell('c8', {}), cell('c9', {}), cell('c10', {})],
    },
  ],
};

describe('untouched cells round-trip through a table command', () => {
  it('spans null, 0, 1, -1, 2 and "x" and lang come back unchanged', () => {
    const tableNode = nodeFromModel(structuredClone(TABLE))!;
    // The model value as read: the reader's integers, the kept text, the language verbatim.
    expect(nodeToModel(tableNode)).toEqual(TABLE);
    const doc = docOf(tableNode);
    const tablePos = pos(doc, 't');
    const state = EditorState.create({ doc }).apply(
      EditorState.create({ doc }).tr.setSelection(TextSelection.create(doc, pos(doc, 'c7') + 1)),
    );
    const rows = childrenOf(tableNode);
    const changed = withChild(rows[2]!, 0, retyped(rows[2]!.child(0), 'new'));
    const tr = commitTableEdit(state.tr, tablePos, {
      rows: [rows[0]!, rows[1]!, changed],
      focus: caretAt(2, 0),
      removedIds: [],
    })!;
    const after = nodeToModel(tr.doc.nodeAt(tablePos)!);
    expect(after.content![0]).toEqual(TABLE.content![0]);
    expect(after.content![1]).toEqual(TABLE.content![1]);
    expect(after.content![2]!.content![0]).toEqual(cell('c7', {}, 'new'));
  });

  it('withSpans on a cell read from colspan="abc" gives colspan: 3 without unknownAttrs.colspan', () => {
    const read = nodeFromModel(cell('c', { unknownAttrs: { colspan: 'abc' } }))!;
    expect(read.attrs.extraAttrs).toEqual({ unknownAttrs: { colspan: 'abc' } });
    const written = read.type.create(withSpans(read.attrs, 3), read.content, read.marks);
    expect(nodeToModel(written)).toEqual(cell('c', { colspan: 3 }));
    // A second kept name stays.
    const two = nodeFromModel(cell('d', { unknownAttrs: { colspan: 'abc', rowspan: '00' } }))!;
    const one = two.type.create(withSpans(two.attrs, 3), two.content, two.marks);
    expect(nodeToModel(one)).toEqual(cell('d', { colspan: 3, unknownAttrs: { rowspan: '00' } }));
  });
});
