/**
 * The commit of a plan's edit (feature 006, T038; I5; data-model §4.3; research R1.4): one
 * `ReplaceStep` over exactly the changed children, unchanged rows reused by identity, the table
 * attributes in the same transaction, `DISCRETE_STEP` and `scrollIntoView`, nothing for a
 * no-op, and the selection from the focus - the caret's offset kept or reset, its fallback at a
 * hole, a block - or, outside the table, mapped.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { AttrStep, ReplaceStep } from 'prosemirror-transform';

import { DISCRETE_STEP } from '@/editor/commands/util';
import { commitTableEdit, type TableEdit } from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import { blockOver, caretAt } from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';

import {
  N,
  cellNode,
  childrenOf,
  docOf,
  nodeOf,
  p,
  plainRows,
  pos,
  retyped,
  table,
  withChild,
} from './helpers';

function stateOf(doc: PMNode, selection?: (doc: PMNode) => TextSelection | NodeSelection) {
  const state = EditorState.create({ doc });
  return selection ? state.apply(state.tr.setSelection(selection(doc))) : state;
}

function edit(rows: PMNode[], extra: Partial<TableEdit> = {}): TableEdit {
  return { rows, focus: caretAt(0, 0), removedIds: [], ...extra };
}

/** The table's rows with row `index` given new text in its cell `cell`. */
function rowsWithText(tableNode: PMNode, index: number, cell: number, text: string): PMNode[] {
  return childrenOf(tableNode).map((row, i) =>
    i === index ? withChild(row, cell, retyped(row.child(cell), text)) : row,
  );
}

describe('commitTableEdit', () => {
  it('replaces exactly the changed children with one ReplaceStep: one row of 300, rows added at either end', () => {
    const doc = docOf(p('before', 'p1'), table('t', plainRows(300, 2)), p('after', 'p2'));
    const state = stateOf(doc, (d) => TextSelection.create(d, pos(d, 't-5-0') + 1));
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    const rows = rowsWithText(tableNode, 5, 1, 'changed');
    const tr = commitTableEdit(state.tr, tablePos, edit(rows, { focus: caretAt(5, 1) }))!;
    expect(tr.steps).toHaveLength(1);
    const step = tr.steps[0] as ReplaceStep;
    expect(step).toBeInstanceOf(ReplaceStep);
    const rowPos = pos(doc, 't-r5');
    expect([step.from, step.to]).toEqual([rowPos, rowPos + tableNode.child(5).nodeSize]);
    expect(step.slice.content.childCount).toBe(1);
    expect(step.slice.content.firstChild).toBe(rows[5]);
    // Unchanged rows are the very nodes of the old document.
    const after = tr.doc.nodeAt(tablePos)!;
    for (let i = 0; i < 300; i += 1) {
      if (i !== 5) expect(after.child(i)).toBe(tableNode.child(i));
    }
    expect(after.child(5)).toBe(rows[5]);

    // A row added before the first and one after the last: insertions at the table's edges.
    const first = N.tr!.create({ nodeId: 'n-first' }, [
      cellNode('n1', {}, ''),
      cellNode('n2', {}, ''),
    ]);
    const atStart = commitTableEdit(
      state.tr,
      tablePos,
      edit([first, ...childrenOf(tableNode)], { focus: caretAt(0, 0) }),
    )!;
    expect(atStart.steps).toHaveLength(1);
    const startStep = atStart.steps[0] as ReplaceStep;
    expect([startStep.from, startStep.to]).toEqual([tablePos + 1, tablePos + 1]);
    expect(startStep.slice.content.firstChild).toBe(first);
    const last = N.tr!.create({ nodeId: 'n-last' }, [
      cellNode('n3', {}, ''),
      cellNode('n4', {}, ''),
    ]);
    const atEnd = commitTableEdit(
      state.tr,
      tablePos,
      edit([...childrenOf(tableNode), last], { focus: caretAt(300, 0) }),
    )!;
    const endStep = atEnd.steps[0] as ReplaceStep;
    const end = tablePos + 1 + tableNode.content.size;
    expect([endStep.from, endStep.to]).toEqual([end, end]);
    expect(atEnd.doc.nodeAt(tablePos)!.child(0)).toBe(tableNode.child(0));
  });

  it('sets the table attributes in the same transaction, with DISCRETE_STEP and scrollIntoView', () => {
    const doc = docOf(table('t', plainRows(2, 2)));
    const state = stateOf(doc, (d) => TextSelection.create(d, pos(d, 't-0-0') + 1));
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    const rows = rowsWithText(tableNode, 1, 0, 'x');
    const tr = commitTableEdit(
      state.tr,
      tablePos,
      // The id an attribute plan sets is one it may bring in (allowedIds, data-model §4.2).
      edit(rows, { tableAttrs: { ...tableNode.attrs, id: 'tid' }, allowedIds: ['tid'] }),
    )!;
    expect(tr.steps.map((step) => step.constructor)).toEqual([ReplaceStep, AttrStep]);
    expect(tr.doc.nodeAt(tablePos)!.attrs.id).toBe('tid');
    expect(tr.doc.nodeAt(tablePos)!.child(1)).toBe(rows[1]);
    expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
    expect(tr.scrolledIntoView).toBe(true);
    // The attributes alone.
    const attrsOnly = commitTableEdit(
      state.tr,
      tablePos,
      edit(childrenOf(tableNode), { tableAttrs: { ...tableNode.attrs, style: 'wide' } }),
    )!;
    expect(attrsOnly.steps.map((step) => step.constructor)).toEqual([AttrStep]);
    expect(attrsOnly.doc.nodeAt(tablePos)!.attrs.style).toBe('wide');
  });

  it('answers null for a no-op', () => {
    const doc = docOf(table('t', plainRows(2, 2)));
    const state = stateOf(doc);
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    expect(commitTableEdit(state.tr, tablePos, edit(childrenOf(tableNode)))).toBeNull();
    expect(
      commitTableEdit(
        state.tr,
        tablePos,
        edit(childrenOf(tableNode), { tableAttrs: { ...tableNode.attrs } }),
      ),
    ).toBeNull();
  });

  it('keeps the caret offset when the cell keeps its content, else puts it at the start', () => {
    const doc = docOf(table('t', plainRows(3, 3)));
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    const state = stateOf(doc, (d) => TextSelection.create(d, pos(d, 't-2-1') + 1 + 2));
    // A kind change keeps the content fragment: the offset stays.
    const cell = tableNode.child(2).child(1);
    const header = N.th!.create(cell.attrs, cell.content, cell.marks);
    const rows = childrenOf(tableNode).map((row, i) => (i === 2 ? withChild(row, 1, header) : row));
    const kept = commitTableEdit(state.tr, tablePos, edit(rows, { focus: caretAt(2, 1) }))!;
    const keptCell = pos(kept.doc, 't-2-1');
    expect(kept.doc.nodeAt(keptCell)!.type.name).toBe('th');
    expect(kept.selection.head).toBe(keptCell + 1 + 2);
    // New content: the start of the cell.
    const reset = commitTableEdit(
      state.tr,
      tablePos,
      edit(rowsWithText(tableNode, 2, 1, 'other'), { focus: caretAt(2, 1) }),
    )!;
    expect(reset.selection.head).toBe(pos(reset.doc, 't-2-1') + 1);
    // Another cell: its start.
    const moved = commitTableEdit(
      state.tr,
      tablePos,
      edit(rowsWithText(tableNode, 0, 0, 'zz'), { focus: caretAt(0, 2) }),
    )!;
    expect(moved.selection.head).toBe(pos(moved.doc, 't-0-2') + 1);
  });

  it('puts the caret before a hole into the row last own cell before it', () => {
    // [a, b, c] / [d, e] / [f, g, h]: (1, 2) is a hole.
    const doc = docOf(
      table('t', [
        [{}, {}, {}],
        [{}, {}],
        [{}, {}, {}],
      ]),
    );
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    const state = stateOf(doc, (d) => TextSelection.create(d, pos(d, 't-1-0') + 1));
    const tr = commitTableEdit(
      state.tr,
      tablePos,
      edit(rowsWithText(tableNode, 1, 0, 'dd'), { focus: caretAt(1, 2) }),
    )!;
    expect(tr.selection.head).toBe(pos(tr.doc, 't-1-1') + 1);
  });

  it('makes the block of the focus, keeping its anchor and head cells when they lie in it', () => {
    const doc = docOf(table('t', plainRows(3, 3)));
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    const block = CellBlockSelection.create(doc, pos(doc, 't-1-2'), pos(doc, 't-0-1'));
    const state = EditorState.create({ doc, selection: block });
    const rows = rowsWithText(tableNode, 0, 1, 'b');
    const tr = commitTableEdit(
      state.tr,
      tablePos,
      edit(rows, { focus: blockOver({ top: 0, left: 1, bottom: 2, right: 3 }) }),
    )!;
    const after = tr.selection as CellBlockSelection;
    expect(after).toBeInstanceOf(CellBlockSelection);
    expect(after.rect).toEqual({ top: 0, left: 1, bottom: 2, right: 3 });
    expect(after.$anchorCell.nodeAfter!.attrs.nodeId).toBe('t-1-2');
    expect(after.$headCell.nodeAfter!.attrs.nodeId).toBe('t-0-1');
    // A rectangle without those cells: its corners.
    const corners = commitTableEdit(
      state.tr,
      tablePos,
      edit(rows, { focus: blockOver({ top: 1, left: 0, bottom: 3, right: 2 }) }),
    )!.selection as CellBlockSelection;
    expect(corners.$anchorCell.nodeAfter!.attrs.nodeId).toBe('t-1-0');
    expect(corners.$headCell.nodeAfter!.attrs.nodeId).toBe('t-2-1');
    // A block over one merged cell is a caret in it.
    const merged = docOf(
      table('m', [
        [{ colspan: 2 }, {}],
        [{}, {}, {}],
      ]),
    );
    const mergedPos = pos(merged, 'm');
    const one = commitTableEdit(
      EditorState.create({
        doc: merged,
        selection: TextSelection.create(merged, pos(merged, 'm-1-0') + 1),
      }).tr,
      mergedPos,
      edit(rowsWithText(merged.nodeAt(mergedPos)!, 1, 0, 'x'), {
        focus: blockOver({ top: 0, left: 0, bottom: 1, right: 2 }),
      }),
    )!;
    expect(one.selection).toBeInstanceOf(TextSelection);
    expect(one.selection.head).toBe(pos(one.doc, 'm-0-0') + 1);
  });

  it('maps a selection outside the table instead of following the focus', () => {
    const doc = docOf(table('t', plainRows(2, 2)), p('after', 'p2'));
    const tablePos = pos(doc, 't');
    const tableNode = doc.nodeAt(tablePos)!;
    const state = stateOf(doc, (d) => TextSelection.create(d, pos(d, 'p2') + 3));
    const added = N.tr!.create({ nodeId: 'n-row' }, [
      cellNode('n1', {}, ''),
      cellNode('n2', {}, ''),
    ]);
    const tr = commitTableEdit(
      state.tr,
      tablePos,
      edit([...childrenOf(tableNode), added], { focus: caretAt(2, 0) }),
    )!;
    expect(tr.selection).toBeInstanceOf(TextSelection);
    expect(tr.selection.head).toBe(pos(tr.doc, 'p2') + 3);
    // A table selected as a node stays selected.
    const whole = EditorState.create({ doc, selection: NodeSelection.create(doc, tablePos) });
    const kept = commitTableEdit(
      whole.tr,
      tablePos,
      edit(rowsWithText(tableNode, 0, 0, 'q'), { focus: caretAt(0, 0) }),
    )!;
    expect(kept.selection).toBeInstanceOf(NodeSelection);
    expect(kept.selection.from).toBe(tablePos);
  });

  it('replaces a table holding a non-row child as a whole node, in one step', () => {
    // [a, b] / raw / [c, d]: an invalid book's table, kept unchecked.
    const doc = docOf(table('v', [[{}, {}], 'raw', [{}, {}]]));
    const tablePos = pos(doc, 'v');
    const tableNode = doc.nodeAt(tablePos)!;
    const state = stateOf(doc, (d) => TextSelection.create(d, pos(d, 'v-2-0') + 1));
    const tr = commitTableEdit(
      state.tr,
      tablePos,
      edit(rowsWithText(tableNode, 2, 0, 'new'), { focus: caretAt(1, 0) }),
    )!;
    expect(tr.steps).toHaveLength(1);
    const step = tr.steps[0] as ReplaceStep;
    expect([step.from, step.to]).toEqual([tablePos, tablePos + tableNode.nodeSize]);
    const after = tr.doc.nodeAt(tablePos)!;
    expect(after.child(1)).toBe(tableNode.child(1));
    expect(after.child(0)).toBe(tableNode.child(0));
    expect(nodeOf(tr.doc, 'v-2-0').textContent).toBe('new');
    expect(gridOfNode(after).regular).toBe(true);
    expect(tr.selection.head).toBe(pos(tr.doc, 'v-2-0') + 1);
  });
});
