/**
 * Key behaviour of the Body editor (T057): Enter in titles / verses / paragraphs, leaving
 * containers on empty trailing lines, empty paragraphs becoming empty lines, Backspace /
 * Delete removing empty lines, Tab in tables, the overwrite plugin and node id assignment.
 */

import { history, undo } from 'prosemirror-history';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { DISCRETE_STEP } from '@/editor/commands/util';
import {
  backspaceCommand,
  deleteCommand,
  enterCommand,
  shiftTabCommand,
  tabCommand,
} from '@/editor/keymap';
import { nodeIdPlugin } from '@/editor/plugins/nodeIds';
import { createNodeIdGenerator, fb2Schema, findNodeById } from '@/editor/schema';
import { CellBlockSelection } from '@/editor/table/selection';

const { nodes: N } = fb2Schema;

function p(text = '') {
  return N.p!.create(null, text ? fb2Schema.text(text) : undefined);
}
function v(text = '') {
  return N.v!.create(null, text ? fb2Schema.text(text) : undefined);
}
function docWith(...children: PMNode[]) {
  return N.doc!.create(null, N.body!.create(null, N.section!.create(null, children)));
}
function at(doc: PMNode, pos: number): EditorState {
  const state = EditorState.create({ doc, plugins: [nodeIdPlugin()] });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}
function endOf(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) found = pos + text.length;
    return found < 0;
  });
  if (found < 0) throw new Error(`"${text}" not found`);
  return found;
}
function apply(state: EditorState, command: typeof enterCommand): EditorState {
  let next = state;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  if (!ok) throw new Error('command refused');
  return next;
}
function names(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child) => out.push(child.type.name));
  return out;
}
const sectionOf = (state: EditorState) => state.doc.child(0).child(0);

describe('Enter', () => {
  it('adds a title line, then leaves the title on the empty trailing line', () => {
    const doc = docWith(N.title!.create(null, p('Chapter')), p('Text'));
    let state = apply(at(doc, endOf(doc, 'Chapter')), enterCommand);
    expect(sectionOf(state).child(0).childCount).toBe(2);
    expect(state.selection.$from.node(-1).type.name).toBe('title');
    state = apply(state, enterCommand); // empty trailing line: leave the title
    expect(sectionOf(state).child(0).childCount).toBe(1);
    // A new paragraph opens between the title and the existing text.
    expect(names(sectionOf(state))).toEqual(['title', 'p', 'p']);
    expect(state.selection.$from.parent.textContent).toBe('');
    expect(state.selection.$from.node(-1).type.name).toBe('section');
    expect(state.doc.check()).toBeUndefined();
    // With an empty paragraph following the title the caret moves into it instead.
    const fresh = docWith(N.title!.create(null, [p('Chapter'), p()]), p());
    const left = apply(at(fresh, endOf(fresh, 'Chapter') + 2), enterCommand);
    expect(names(sectionOf(left))).toEqual(['title', 'p']);
    expect(left.selection.$from.node(-1).type.name).toBe('section');
  });

  it('adds a verse, starts a new stanza on an empty last verse and leaves the poem afterwards', () => {
    const doc = docWith(p('Before'), N.poem!.create(null, N.stanza!.create(null, v('line one'))));
    let state = apply(at(doc, endOf(doc, 'line one')), enterCommand);
    const poem = () => sectionOf(state).child(1);
    expect(poem().child(0).childCount).toBe(2);
    expect(state.selection.$from.parent.type.name).toBe('v');
    state = apply(state, enterCommand); // empty last verse -> new stanza
    expect(names(poem())).toEqual(['stanza', 'stanza']);
    expect(poem().child(0).childCount).toBe(1);
    expect(state.selection.$from.node(-1)).toBe(poem().child(1));
    state = apply(state, enterCommand); // only verse of the last stanza is empty -> leave the poem
    expect(names(poem())).toEqual(['stanza']);
    expect(names(sectionOf(state))).toEqual(['p', 'poem', 'p']);
    expect(state.selection.$from.node(-1).type.name).toBe('section');
    expect(state.doc.check()).toBeUndefined();
  });

  it('turns an empty paragraph into an empty line and opens a new paragraph below', () => {
    const doc = docWith(p('Text'));
    let state = apply(at(doc, endOf(doc, 'Text')), enterCommand);
    expect(names(sectionOf(state))).toEqual(['p', 'p']);
    state = apply(state, enterCommand);
    expect(names(sectionOf(state))).toEqual(['p', 'empty_line', 'p']);
    expect(state.selection.$from.parent.type.name).toBe('p');
    // Backspace in the new paragraph removes the empty line again.
    state = apply(state, backspaceCommand);
    expect(names(sectionOf(state))).toEqual(['p', 'p']);
    expect(state.doc.check()).toBeUndefined();
  });

  it('leaves a cite / epigraph on the empty trailing paragraph, keeping the first paragraph', () => {
    const doc = docWith(N.cite!.create(null, p('Quote')), p('After'));
    let state = apply(at(doc, endOf(doc, 'Quote')), enterCommand);
    expect(sectionOf(state).child(0).childCount).toBe(2);
    state = apply(state, enterCommand);
    expect(sectionOf(state).child(0).childCount).toBe(1);
    expect(names(sectionOf(state))).toEqual(['cite', 'p', 'p']);
    expect(state.selection.$from.node(-1).type.name).toBe('section');
    // A single empty paragraph in a cite is kept (Enter does nothing destructive).
    const lonely = docWith(N.cite!.create(null, p()), p('x'));
    const lonelyState = at(lonely, 3);
    expect(enterCommand(lonelyState)).toBe(true);
  });

  it('does nothing inside table cells', () => {
    const doc = docWith(
      p('a'),
      N.table!.create(null, N.tr!.create(null, N.td!.create(null, fb2Schema.text('cell')))),
    );
    const state = at(doc, endOf(doc, 'cell'));
    const after = apply(state, enterCommand);
    expect(after.doc.eq(doc)).toBe(true);
  });
});

describe('Backspace / Delete / Tab', () => {
  it('Delete at the end of a paragraph removes a following empty line', () => {
    const doc = docWith(p('One'), N.empty_line!.create(), p('Two'));
    const state = apply(at(doc, endOf(doc, 'One')), deleteCommand);
    expect(names(sectionOf(state))).toEqual(['p', 'p']);
  });

  it('Backspace at the start of the first verse merges stanzas', () => {
    const doc = docWith(
      N.poem!.create(null, [N.stanza!.create(null, v('a')), N.stanza!.create(null, v('b'))]),
    );
    const bPos = endOf(doc, 'b') - 1;
    const state = apply(at(doc, bPos), backspaceCommand);
    expect(names(sectionOf(state).child(0))).toEqual(['stanza']);
    expect(sectionOf(state).child(0).child(0).childCount).toBe(2);
    expect(state.doc.check()).toBeUndefined();
  });

  it('Tab moves to the next cell and is swallowed outside tables', () => {
    const doc = docWith(
      p('a'),
      N.table!.create(
        null,
        N.tr!.create(null, [
          N.td!.create(null, fb2Schema.text('c1')),
          N.td!.create(null, fb2Schema.text('c2')),
        ]),
      ),
    );
    const tab = tabCommand({ nextId: createNodeIdGenerator() });
    const state = apply(at(doc, endOf(doc, 'c1')), tab);
    expect(state.selection.$from.parent.textContent).toBe('c2');
    expect(state.selection.from).not.toBe(state.selection.to); // the cell content is selected
    const outside = at(doc, endOf(doc, 'a'));
    expect(tab(outside)).toBe(true);
  });

  /** A 2 × 2 table `t` with the cells `x<row><column>`, after a paragraph. */
  function tableDoc(): PMNode {
    const cell = (nodeId: string) => N.td!.create({ nodeId }, fb2Schema.text(nodeId));
    return docWith(
      N.p!.create({ nodeId: 'p' }, fb2Schema.text('a')),
      N.table!.create({ nodeId: 't' }, [
        N.tr!.create({ nodeId: 'r0', align: 'center' }, [cell('x00'), cell('x01')]),
        N.tr!.create({ nodeId: 'r1' }, [cell('x10'), cell('x11')]),
      ]),
    );
  }

  it('Tab in the last cell appends the Tab row in one transaction carrying DISCRETE_STEP, the caret in its first cell, and one undo through history() removes it', () => {
    const doc = tableDoc();
    let state = EditorState.create({ doc, plugins: [history(), nodeIdPlugin()] });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, endOf(doc, 'x11'))));
    const transactions: Transaction[] = [];
    const ok = tabCommand({ nextId: createNodeIdGenerator('tab_') })(state, (tr) => {
      transactions.push(tr);
      state = state.apply(tr);
    });
    expect(ok).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    const tableNode = findNodeById(state.doc, 't')!.node;
    expect(tableNode.childCount).toBe(3);
    const added = tableNode.child(2);
    expect(added.attrs.nodeId).toMatch(/^tab_\d+$/);
    expect(added.child(0).attrs.nodeId).toMatch(/^tab_\d+$/);
    expect(added.textContent).toBe('');
    expect(state.selection.empty).toBe(true);
    expect(state.selection.$from.parent).toBe(added.child(0));
    expect(state.selection.$from.parentOffset).toBe(0);
    expect(state.doc.check()).toBeUndefined();
    expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true);
    // The table as it was (the node-id plugin names the id-less body and section once, out of
    // the history).
    expect(findNodeById(state.doc, 't')!.node.eq(findNodeById(doc, 't')!.node)).toBe(true);
  });

  it('with a block selected, Tab and Shift+Tab start from the head cell', () => {
    const doc = tableDoc();
    const block = (state: EditorState) =>
      state.apply(
        state.tr.setSelection(
          CellBlockSelection.create(
            state.doc,
            findNodeById(state.doc, 'x00')!.pos,
            findNodeById(state.doc, 'x10')!.pos,
          ),
        ),
      );
    const start = block(EditorState.create({ doc }));
    const forward = apply(start, tabCommand({ nextId: createNodeIdGenerator() }));
    expect(forward.selection.$from.parent.attrs.nodeId).toBe('x11');
    const back = apply(start, shiftTabCommand);
    expect(back.selection.$from.parent.attrs.nodeId).toBe('x01');
  });

  it('Shift+Tab on the first cell keeps the caret in the Body view', () => {
    const doc = tableDoc();
    const state = at(doc, endOf(doc, 'x00'));
    const dispatch = vi.fn();
    expect(shiftTabCommand(state, dispatch)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('node ids', () => {
  it('assigns ui_N ids to nodes created by edits and keeps existing ids', () => {
    const doc = docWith(N.p!.create({ nodeId: 'core_1', id: 'x1' }, fb2Schema.text('Text')));
    const state = apply(at(doc, endOf(doc, 'Text')), enterCommand);
    const section = sectionOf(state);
    expect(section.child(0).attrs.nodeId).toBe('core_1');
    expect(section.child(1).attrs.nodeId).toMatch(/^ui_\d+$/);
    // Splitting in the middle never duplicates the node id or the XML id.
    const middle = apply(at(doc, endOf(doc, 'Text') - 2), enterCommand);
    expect(sectionOf(middle).child(0).attrs).toMatchObject({ nodeId: 'core_1', id: 'x1' });
    expect(sectionOf(middle).child(1).attrs.id).toBeNull();
    expect(sectionOf(middle).child(1).attrs.nodeId).toMatch(/^ui_\d+$/);
    expect(sectionOf(middle).child(1).textContent).toBe('xt');
  });
});
