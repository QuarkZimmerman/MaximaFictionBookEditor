/**
 * Row compaction (feature 006, T038; decision 1, C12; contracts/document-model.md §4.12;
 * data-model §4.4): a row that lost every cell goes with its raw children, every cell over it
 * spans one row fewer, and a row that had no cell before stays as read (FR-035).
 */

import { compactRows } from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';

import { N, childrenOf, table, withChild } from './helpers';

describe('compactRows', () => {
  it('removes a row that lost every cell, together with its raw children', () => {
    // [a, b] / [c, raw, d] / [e, f]; the plan took c and d out of the middle row.
    const before = table('t', [
      [{}, {}],
      [{}, 'raw', {}],
      [{}, {}],
    ]);
    const rows = childrenOf(before);
    const emptied = withChild(withChild(rows[1]!, 2, null), 0, null);
    expect(childrenOf(emptied).map((child) => child.type.name)).toEqual(['raw_xml']);
    const compacted = compactRows(before, [rows[0]!, emptied, rows[2]!]);
    expect(compacted).toEqual([rows[0], rows[2]]);
    expect(compacted[0]).toBe(rows[0]);
    expect(compacted[1]).toBe(rows[2]);
  });

  it('gives every cell over a removed row one row fewer of rowspan (2 becomes null)', () => {
    // [a rowspan 2, b, c rowspan 3] / [d] / [e, f]: the plan emptied the middle row.
    const before = table('t', [[{ rowspan: 2 }, {}, { rowspan: 3 }], [{}], [{}, {}]]);
    const rows = childrenOf(before);
    const emptied = withChild(rows[1]!, 0, null);
    const compacted = compactRows(before, [rows[0]!, emptied, rows[2]!]);
    expect(compacted).toHaveLength(2);
    const first = compacted[0]!;
    expect(first).not.toBe(rows[0]);
    expect(first.attrs).toEqual(rows[0]!.attrs);
    expect(first.child(0).attrs.rowspan).toBeNull();
    expect(first.child(0).attrs.nodeId).toBe('t-0-0');
    expect(first.child(0).content).toBe(rows[0]!.child(0).content);
    expect(first.child(1)).toBe(rows[0]!.child(1));
    expect(first.child(2).attrs.rowspan).toBe(2);
    expect(compacted[1]).toBe(rows[2]);
    const after = before.type.create(before.attrs, compacted);
    expect(gridOfNode(after).regular).toBe(true);
    expect(gridOfNode(after).height).toBe(2);
  });

  it('keeps a row that had no cell before, and leaves rows with cells alone', () => {
    // An invalid book's empty tr stays as read; nothing to compact.
    const empty = N.tr!.create({ nodeId: 't-empty' }, []);
    const base = table('t', [[{}, {}]]);
    const before = base.type.create(base.attrs, [base.child(0), empty]);
    const rows = childrenOf(before);
    const compacted = compactRows(before, rows);
    expect(compacted).toEqual(rows);
    expect(compacted).not.toBe(rows);
    // A new row without a cell (no match in before) is left for assertTableValid to refuse.
    const fresh = N.tr!.create({ nodeId: 'fresh' }, []);
    expect(compactRows(before, [...rows, fresh])).toHaveLength(3);
  });
});
