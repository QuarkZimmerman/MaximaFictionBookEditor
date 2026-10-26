/**
 * The plan types and shared rules of the table engine (feature 006, T038; I4, I5; data-model
 * §1.5, §4.1-§4.4): `withSpans`, `applyTableEdit`, the refusal codes, placing a cell behind
 * holes, a new cell's neighbour, `tableTarget` and `tableTargetAt`, and `assertTableValid` on
 * each crafted violation. The commit is `commit.test.ts`, row compaction `compaction.test.ts`.
 * US4 (T096; U30; C24; data-model §4.5 `table.delete` steps 1 and 2): `removeTable`, the
 * *Delete table* transform the paste router uses on a selected table.
 */

import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

import { fb2Schema } from '@/editor/schema';
import {
  applyTableEdit,
  assertTableValid,
  indexByLeft,
  isRefusal,
  placeCell,
  REFUSAL_CODES,
  removeTable,
  tableTarget,
  tableTargetAt,
  withSpans,
  type Refusal,
  type TableEdit,
} from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import { blockOver, caretAt, neighbourAt, newCellLike, newRowLike } from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { annotationToModel } from '@/editor/toModel';
import { createRichFieldState } from '@/views/description/richFieldState';

import {
  N,
  cellNode,
  childrenOf,
  docOf,
  idGenerator,
  nodeOf,
  p,
  plainRows,
  pos,
  retyped,
  table,
  withChild,
} from './helpers';

describe('withSpans', () => {
  it('withSpans writes 2 or more as numbers and 1 as null, and deletes extraAttrs.unknownAttrs.colspan and .rowspan', () => {
    const attrs = {
      nodeId: 'c1',
      id: 'x',
      colspan: null,
      rowspan: 3,
      extraAttrs: { unknownAttrs: { colspan: 'abc', rowspan: '00', other: 'kept' }, more: 1 },
    };
    const copy = structuredClone(attrs);
    expect(withSpans(attrs, 2)).toEqual({
      ...copy,
      colspan: 2,
      extraAttrs: { unknownAttrs: { rowspan: '00', other: 'kept' }, more: 1 },
    });
    expect(withSpans(attrs, 1, 1)).toEqual({
      ...copy,
      colspan: null,
      rowspan: null,
      extraAttrs: { unknownAttrs: { other: 'kept' }, more: 1 },
    });
    // The input object is untouched.
    expect(attrs).toEqual(copy);
    // Emptied objects go: first unknownAttrs, then extraAttrs.
    expect(withSpans({ extraAttrs: { unknownAttrs: { colspan: 'abc' }, more: 1 } }, 3)).toEqual({
      colspan: 3,
      extraAttrs: { more: 1 },
    });
    expect(withSpans({ extraAttrs: { unknownAttrs: { colspan: 'abc' } } }, 3)).toEqual({
      colspan: 3,
      extraAttrs: null,
    });
    // An axis not given is left as it is, its kept text included.
    expect(withSpans({ rowspan: 4, extraAttrs: { unknownAttrs: { rowspan: 'q' } } }, 2)).toEqual({
      colspan: 2,
      rowspan: 4,
      extraAttrs: { unknownAttrs: { rowspan: 'q' } },
    });
    expect(withSpans({ rowspan: 2 }, undefined, 5)).toEqual({ rowspan: 5 });
  });
});

describe('applyTableEdit', () => {
  it('is pure: a new table node of the given rows, the attributes given or kept', () => {
    const before = table('t', plainRows(2, 2), { id: 't1' });
    const rows = childrenOf(before);
    const changed = withChild(rows[1]!, 0, retyped(rows[1]!.child(0), 'new'));
    const edit: TableEdit = {
      rows: [rows[0]!, changed],
      focus: caretAt(1, 0),
      removedIds: [],
    };
    const after = applyTableEdit(before, edit);
    expect(after).not.toBe(before);
    expect(after.child(0)).toBe(rows[0]);
    expect(after.child(1)).toBe(changed);
    expect(after.attrs).toEqual(before.attrs);
    expect(before.child(1)).toBe(rows[1]);
    const renamed = applyTableEdit(before, { ...edit, tableAttrs: { ...before.attrs, id: 't9' } });
    expect(renamed.attrs.id).toBe('t9');
    expect(before.attrs.id).toBe('t1');
  });
});

describe('refusals', () => {
  it('every refusal code of I4 with its parameters', () => {
    const refusals: Refusal[] = [
      { refused: 'only-row' },
      { refused: 'all-rows' },
      { refused: 'only-column' },
      { refused: 'all-columns' },
      { refused: 'merged-crosses-border', params: { axis: 'row' } },
      { refused: 'merged-crosses-border', params: { axis: 'column' } },
      { refused: 'no-neighbour', params: { direction: 'up' } },
      { refused: 'no-neighbour', params: { direction: 'down' } },
      { refused: 'no-neighbour', params: { direction: 'left' } },
      { refused: 'no-neighbour', params: { direction: 'right' } },
      { refused: 'not-merged', params: { selection: 'cell' } },
      { refused: 'not-merged', params: { selection: 'block' } },
      { refused: 'needs-block' },
      { refused: 'regular' },
      { refused: 'span-past-edge', params: { axis: 'column' } },
      { refused: 'span-past-edge', params: { axis: 'row' } },
      { refused: 'merge-needs-block' },
      { refused: 'too-large' },
      { refused: 'invalid-id' },
      { refused: 'duplicate-id', params: { id: 'n1' } },
      { refused: 'invalid-lang', params: { value: 'en_GB' } },
    ];
    expect(new Set(refusals.map((r) => r.refused))).toEqual(new Set(REFUSAL_CODES));
    expect(REFUSAL_CODES).toHaveLength(15);
    for (const refusal of refusals) expect(isRefusal(refusal)).toBe(true);
    // Not refusals: a host's own reasons, an edit, an availability answer, nothing.
    expect(isRefusal({ refused: 'notInTable' })).toBe(false);
    expect(isRefusal({ ok: true })).toBe(false);
    expect(isRefusal({ rows: [], focus: caretAt(0, 0), removedIds: [] })).toBe(false);
    expect(isRefusal(null)).toBe(false);
    expect(isRefusal('too-large')).toBe(false);
  });
});

describe('placing cells', () => {
  it('indexByLeft and placeCell behind holes', () => {
    const nextId = idGenerator();
    // [a, b, c, d rowspan 2] / [e]: row 2 has holes at columns 1 and 2, d covers column 3.
    const before = table('t', [[{}, {}, {}, { rowspan: 2 }], [{}]]);
    const grid = gridOfNode(before);
    const row = before.child(1);
    expect(indexByLeft(row, grid, 1, 0)).toBe(0);
    expect(indexByLeft(row, grid, 1, 1)).toBe(1);
    expect(indexByLeft(before.child(0), grid, 0, 2)).toBe(2);
    expect(indexByLeft(before.child(0), grid, 0, 9)).toBe(4);
    const x = cellNode('x', {}, 'x');
    const placed = placeCell(row, grid, 1, 2, x, { nextId });
    // One empty td fills the hole at column 1, then x stands at column 2.
    expect(childrenOf(placed).map((cell) => cell.attrs.nodeId)).toEqual(['t-1-0', 'new1', 'x']);
    expect(placed.child(1).content.size).toBe(0);
    const after = before.type.create(before.attrs, [before.child(0), placed]);
    const afterGrid = gridOfNode(after);
    expect(afterGrid.cells.map((cell) => [cell.row, cell.left])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    expect(afterGrid.regular).toBe(true);
    // At the reach no hole is filled: x follows the cells and the spans from above.
    const above = table('u', [[{}, { rowspan: 2 }, {}], [{}]]);
    const aboveGrid = gridOfNode(above);
    expect(aboveGrid.reach(1)).toBe(2);
    const next = placeCell(above.child(1), aboveGrid, 1, 2, x, { nextId });
    expect(childrenOf(next).map((cell) => cell.attrs.nodeId)).toEqual(['u-1-0', 'x']);
    expect(gridOfNode(above.type.create(above.attrs, [above.child(0), next])).regular).toBe(true);
  });
});

describe('new cells (FR-008)', () => {
  it('neighbourAt and newCellLike with a hole on one side and on both sides', () => {
    const nextId = idGenerator();
    // [a (th, centred, bottom, de, id, style, colspan 2), b] / [c]: row 2 short.
    const before = table('t', [
      [
        {
          kind: 'th',
          align: 'center',
          valign: 'bottom',
          lang: 'de',
          id: 'aid',
          style: 'st',
          colspan: 2,
          extraAttrs: { unknownAttrs: { foo: 'bar' } },
        },
        {},
      ],
      [{}],
      [{}, {}, {}],
    ]);
    const grid = gridOfNode(before);
    const a = nodeOf(docOf(before), 't-0-0');
    // A hole on one side: (1, 2) is a hole, the owner above it is b.
    expect(neighbourAt(grid, before, { row: 1, col: 2 }, { row: 0, col: 2 })).toBe(
      before.child(0).child(1),
    );
    expect(neighbourAt(grid, before, { row: 1, col: 0 }, { row: 2, col: 0 })).toBe(
      before.child(1).child(0),
    );
    expect(neighbourAt(grid, before, { row: 0, col: 1 }, { row: 1, col: 1 })).toBe(a);
    // Holes on both sides: none.
    const holes = table('u', [[{}], [{}, {}, {}], [{}]]);
    const holesGrid = gridOfNode(holes);
    expect(neighbourAt(holesGrid, holes, { row: 0, col: 2 }, { row: 2, col: 2 })).toBeNull();
    const plain = newCellLike(null, { nextId });
    expect(plain.type.name).toBe('td');
    expect(plain.attrs).toMatchObject({
      nodeId: 'new1',
      id: null,
      style: null,
      colspan: null,
      rowspan: null,
      align: null,
      valign: null,
      lang: null,
      extraAttrs: null,
    });
    const like = newCellLike(a, { nextId });
    expect(like.type.name).toBe('th');
    expect(like.content.size).toBe(0);
    expect(like.attrs).toEqual({
      nodeId: 'new2',
      extraAttrs: null,
      id: null,
      style: null,
      colspan: null,
      rowspan: null,
      align: 'center',
      valign: 'bottom',
      lang: 'de',
    });
    const row = newRowLike(N.tr!.create({ nodeId: 'r', align: 'right' }, [plain]), [like], {
      nextId,
    });
    expect(row.attrs).toMatchObject({ nodeId: 'new3', align: 'right' });
    expect(row.child(0)).toBe(like);
    expect(caretAt(2, 3)).toEqual({
      kind: 'caret',
      rect: { top: 2, left: 3, bottom: 3, right: 4 },
    });
    expect(blockOver({ top: 0, left: 1, bottom: 2, right: 3 })).toEqual({
      kind: 'block',
      rect: { top: 0, left: 1, bottom: 2, right: 3 },
    });
  });
});

describe('tableTarget and tableTargetAt', () => {
  // [a, b (colspan 2)] / [c, d, e] / [f, g (inline image), h]
  function setup() {
    const image = N.inline_image!.create({ nodeId: 'img', href: '#i' });
    const t = table('t', [
      [{}, { colspan: 2 }],
      [{}, {}, {}],
      [{}, {}, {}],
    ]);
    const g = N.td!.create({ nodeId: 't-2-1' }, image);
    const rows = childrenOf(t);
    const withImage = t.type.create(t.attrs, [rows[0]!, rows[1]!, withChild(rows[2]!, 1, g)]);
    const doc = docOf(p('before', 'p1'), withImage, p('after', 'p2'), table('u', plainRows(1, 2)));
    return { doc, state: EditorState.create({ doc }) };
  }
  const at = (state: EditorState, selection: Parameters<EditorState['tr']['setSelection']>[0]) =>
    state.apply(state.tr.setSelection(selection));

  it('tableTarget for each selection kind with its caret, head and rect; null outside tables', () => {
    const { doc, state } = setup();
    const tablePos = pos(doc, 't');
    // A caret in b, which starts at column 1.
    const caret = tableTarget(at(state, TextSelection.create(doc, pos(doc, 't-0-1') + 2)))!;
    expect(caret.tablePos).toBe(tablePos);
    expect(caret.selection).toBe('cell');
    expect(caret.address.caret).toEqual({ row: 0, col: 1 });
    expect(caret.address.head).toEqual({ row: 0, col: 1 });
    expect(caret.address.rect).toBeUndefined();
    expect(caret.address.grid).toBe(gridOfNode(doc.nodeAt(tablePos)!));
    // Text inside one cell, and the inline image of g selected as a node: cell.
    const e = pos(doc, 't-1-2');
    expect(tableTarget(at(state, TextSelection.create(doc, e + 1, e + 4)))!.selection).toBe('cell');
    const image = tableTarget(at(state, NodeSelection.create(doc, pos(doc, 'img'))))!;
    expect(image.selection).toBe('cell');
    expect(image.address.caret).toEqual({ row: 2, col: 1 });
    // A block from e to a: its rectangle, the head cell a.
    const block = tableTarget(
      at(state, CellBlockSelection.create(doc, pos(doc, 't-1-2'), pos(doc, 't-0-0'))),
    )!;
    expect(block.selection).toBe('block');
    expect(block.address.rect).toEqual({ top: 0, left: 0, bottom: 2, right: 3 });
    expect(block.address.head).toEqual({ row: 0, col: 0 });
    expect(block.address.caret).toEqual({ row: 0, col: 0 });
    // The table selected as a node.
    const whole = tableTarget(at(state, NodeSelection.create(doc, tablePos)))!;
    expect(whole).toMatchObject({ tablePos, selection: 'table' });
    expect(whole.address.caret).toBeUndefined();
    // From a cell to the paragraph after the table, and between two cells without a plugin.
    const mixed = tableTarget(
      at(state, TextSelection.create(doc, pos(doc, 'p2') + 2, pos(doc, 't-1-0') + 1)),
    )!;
    expect(mixed.selection).toBe('mixed');
    expect(mixed.address.caret).toEqual({ row: 1, col: 0 });
    expect(
      tableTarget(at(state, TextSelection.create(doc, pos(doc, 't-0-0') + 1, e + 1)))!.selection,
    ).toBe('mixed');
    // Outside every table.
    expect(tableTarget(at(state, TextSelection.create(doc, pos(doc, 'p1') + 2)))).toBeNull();
  });

  it('tableTargetAt answers none for a table that holds no end of the selection', () => {
    const { doc, state } = setup();
    const inT = at(state, TextSelection.create(doc, pos(doc, 't-1-1') + 1));
    const other = tableTargetAt(inT, pos(doc, 'u'))!;
    expect(other.selection).toBe('none');
    expect(other.address.table).toBe(doc.nodeAt(pos(doc, 'u')));
    expect(other.address.caret).toBeUndefined();
    expect(tableTargetAt(inT, pos(doc, 't'))).toEqual(tableTarget(inT));
    expect(tableTargetAt(inT, pos(doc, 'p1'))).toBeNull();
  });
});

describe('assertTableValid', () => {
  const before = table('t', plainRows(2, 2));
  const rows = childrenOf(before);
  const replaceRow = (index: number, row: ReturnType<typeof withChild>) =>
    before.type.create(
      before.attrs,
      rows.map((r, i) => (i === index ? row : r)),
    );

  it('fails on each crafted violation, naming the rule', () => {
    const emptyRow = N.tr!.create({ nodeId: 't-r1' }, []);
    expect(() => assertTableValid(before, replaceRow(1, emptyRow))).toThrow(/valid FB2|no cell/);
    const spanOne = withChild(rows[1]!, 1, cellNode('n1', { colspan: 1 }, 'x'));
    expect(() => assertTableValid(before, replaceRow(1, spanOne))).toThrow(/span/);
    const spanHuge = withChild(rows[1]!, 1, cellNode('n2', { colspan: 1001 }, 'x'));
    expect(() => assertTableValid(before, replaceRow(1, spanHuge))).toThrow(/span/);
    const twice = withChild(rows[1]!, 1, cellNode('t-0-0', {}, 'x'));
    expect(() => assertTableValid(before, replaceRow(1, twice))).toThrow(/node id t-0-0/);
    const newId = withChild(rows[1]!, 1, cellNode('t-1-1', { id: 'fresh' }, 'x'));
    expect(() => assertTableValid(before, replaceRow(1, newId))).toThrow(/FB2 id fresh/);
    const short = withChild(rows[1]!, 1, null);
    expect(() => assertTableValid(before, replaceRow(1, short))).toThrow(/became irregular/);
  });

  it('passes on a valid edit, on a new id listed as allowed, and on a pasted irregular copy', () => {
    const edited = withChild(rows[1]!, 1, retyped(rows[1]!.child(1), 'changed'));
    expect(() => assertTableValid(before, replaceRow(1, edited))).not.toThrow();
    const merged = withChild(rows[0]!, 0, cellNode('t-0-0', { colspan: 2 }, 'r0c0'));
    const mergedRow = merged.type.create(merged.attrs, [merged.child(0)]);
    expect(() => assertTableValid(before, replaceRow(0, mergedRow))).not.toThrow();
    const newId = withChild(rows[1]!, 1, cellNode('t-1-1', { id: 'fresh' }, 'x'));
    expect(() => assertTableValid(before, replaceRow(1, newId), ['fresh'])).not.toThrow();
    const short = withChild(rows[1]!, 1, null);
    expect(() => assertTableValid(before, replaceRow(1, short), [], true)).not.toThrow();
  });

  it('checks the spans a plan writes, not those a changed cell keeps as read: a kind change keeps an odd span (US6; FR-019, FR-047)', () => {
    // [a colspan 0, b] / [c rowspan 1000000000, d]: values the commands count as 1 and 65534.
    const odd = table('o', [
      [{ colspan: 0 }, {}],
      [{ rowspan: 1_000_000_000 }, {}],
    ]);
    const oddRows = childrenOf(odd);
    const make = (row: number, cell: number, node: (typeof oddRows)[number]) =>
      odd.type.create(
        odd.attrs,
        oddRows.map((r, i) => (i === row ? withChild(r, cell, node) : r)),
      );
    const a = oddRows[0]!.child(0);
    const c = oddRows[1]!.child(0);
    const asHeader = (cell: typeof a) => N.th!.create(cell.attrs, cell.content, cell.marks);
    expect(() => assertTableValid(odd, make(0, 0, asHeader(a)))).not.toThrow();
    expect(() => assertTableValid(odd, make(1, 0, asHeader(c)))).not.toThrow();
    // A span the plan writes on the other axis is checked; the odd one it keeps is not.
    const grown = a.type.create(withSpans(a.attrs, undefined, 2), a.content, a.marks);
    expect(() =>
      assertTableValid(
        odd,
        odd.type.create(odd.attrs, [withChild(oddRows[0]!, 0, grown), oddRows[1]!]),
      ),
    ).not.toThrow();
    // An odd value the plan writes, on a changed cell or a new one, fails.
    const written = a.type.create({ ...a.attrs, colspan: -1 }, a.content, a.marks);
    expect(() => assertTableValid(odd, make(0, 0, written))).toThrow(/span/);
    const copy = N.td!.create({ ...a.attrs, nodeId: 'o-new' }, a.content, a.marks);
    expect(() => assertTableValid(odd, make(0, 0, copy))).toThrow(/span/);
  });

  it('keeps the non-row children of an invalid table and the non-cell children of its kept rows', () => {
    // [a, b] / raw / [c, raw, d]: unchecked, as nodeFromModel keeps it.
    const invalid = table('v', [[{}, {}], 'raw', [{}, 'raw', {}]]);
    const children = childrenOf(invalid);
    const make = (list: typeof children) => invalid.type.create(invalid.attrs, list);
    const edited = withChild(children[2]!, 0, retyped(children[2]!.child(0), 'new'));
    expect(() =>
      assertTableValid(invalid, make([children[0]!, children[1]!, edited])),
    ).not.toThrow();
    expect(() => assertTableValid(invalid, make([children[0]!, edited]))).toThrow(/non-row child/);
    const lost = withChild(children[2]!, 1, null);
    expect(() => assertTableValid(invalid, make([children[0]!, children[1]!, lost]))).toThrow(
      /non-cell child/,
    );
    const emptied = N.tr!.create({ nodeId: 'v-r2' }, [children[2]!.child(1)]);
    expect(() => assertTableValid(invalid, make([children[0]!, children[1]!, emptied]))).toThrow(
      /holds no cell/,
    );
  });
});

describe('removeTable (the Delete table transform; U30, C24)', () => {
  /** The children of the node at `nodeId` (or of the document) after removing table `t`. */
  function removed(doc: ReturnType<typeof docOf>, container?: string): string[] {
    const state = EditorState.create({ doc });
    const tr = removeTable(state.tr, pos(doc, 't'), idGenerator('e'));
    tr.doc.check();
    const node = container ? nodeOf(tr.doc, container) : tr.doc;
    return childrenOf(node).map((child) => `${child.type.name}:${String(child.attrs.nodeId)}`);
  }

  it('a section’s only table leaves an empty p; a table between two paragraphs leaves nothing', () => {
    expect(removed(docOf(table('t', plainRows(2, 2))), 's')).toEqual(['p:e1']);
    expect(removed(docOf(p('a', 'p1'), table('t', plainRows(2, 2)), p('b', 'p2')), 's')).toEqual([
      'p:p1',
      'p:p2',
    ]);
  });

  it('the only table of the annotation block or the history block leaves an empty p; a section annotation’s none', () => {
    for (const kind of ['annotation_block', 'history_block'] as const) {
      const doc = N.doc!.create(null, [
        N[kind]!.create({ nodeId: 'blk' }, [table('t', plainRows(1, 2))]),
        N.body!.create({ nodeId: 'b' }, [N.section!.create({ nodeId: 's' }, [p('x', 'p1')])]),
      ]);
      expect(removed(doc, 'blk'), kind).toEqual(['p:e1']);
    }
    const annotated = docOf(
      N.annotation!.create({ nodeId: 'an' }, [table('t', plainRows(1, 2))]),
      p('x', 'p1'),
    );
    expect(removed(annotated, 'an')).toEqual([]);
  });

  it('a description field’s only table leaves an empty p', () => {
    const field = N.annotation!.create(null, [table('t', plainRows(1, 2))]);
    const state = createRichFieldState(annotationToModel(field), idGenerator('f'));
    expect(state.doc.childCount).toBe(1);
    const tablePos = 0;
    expect(state.doc.nodeAt(tablePos)!.type.name).toBe('table');
    const tr = removeTable(state.tr, tablePos, idGenerator('e'));
    tr.doc.check();
    expect(childrenOf(tr.doc).map((child) => child.type.name)).toEqual(['p']);
    expect(tr.doc.child(0).attrs.nodeId).toBe('e1');
    expect(fb2Schema.nodes.annotation).toBe(tr.doc.type);
  });
});
