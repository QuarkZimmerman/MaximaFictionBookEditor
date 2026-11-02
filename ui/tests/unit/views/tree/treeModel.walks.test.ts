/**
 * Feature 008, T034 (FR-022): the Document tree's walks over parent links end on any structure,
 * a parent cycle and repeated ids included (the 0.0.5 freeze was such a walk).
 */
import { describe, expect, it } from 'vitest';

import { ancestorRows, isRowWithin, type TreeIndex, type TreeRow } from '@/views/tree/treeModel';

function row(id: string, parentId: string | null): TreeRow {
  return { id, kind: 'section', caption: id, depth: 0, parentId, childIds: [] };
}

function index(rows: TreeRow[]): TreeIndex {
  return {
    rows: new Map(rows.map((r) => [r.id, r])),
    roots: rows.filter((r) => r.parentId === null).map((r) => r.id),
    order: rows.map((r) => r.id),
    sectionCount: rows.length,
  };
}

describe('tree walks (FR-022)', () => {
  it('list the ancestors of an ordinary tree, the outermost first', () => {
    const tree = index([row('body', null), row('s1', 'body'), row('s2', 's1')]);
    expect(ancestorRows(tree, 's2')).toEqual(['body', 's1']);
    expect(isRowWithin(tree, 's2', 'body')).toBe(true);
    expect(isRowWithin(tree, 'body', 's2')).toBe(false);
  });

  it('end on a parent cycle', () => {
    const tree = index([row('a', 'c'), row('b', 'a'), row('c', 'b')]);
    const ancestors = ancestorRows(tree, 'a');
    expect(ancestors.length).toBeLessThanOrEqual(3);
    expect(isRowWithin(tree, 'a', 'missing')).toBe(false);
  });

  it('end when a row is its own parent', () => {
    const tree = index([row('a', 'a')]);
    expect(ancestorRows(tree, 'a')).toEqual([]);
    expect(isRowWithin(tree, 'a', 'b')).toBe(false);
  });

  it('end when an id repeats so that two rows point at each other', () => {
    // Repeated names made a section's parent link point back into its own subtree (0.0.5).
    const tree = index([row('sc_1', 'sc_2'), row('sc_2', 'sc_1')]);
    expect(ancestorRows(tree, 'sc_1').length).toBeLessThanOrEqual(2);
    expect(isRowWithin(tree, 'sc_2', 'nowhere')).toBe(false);
  });
});
