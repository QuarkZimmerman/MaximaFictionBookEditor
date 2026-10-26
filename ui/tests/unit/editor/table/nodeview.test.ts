/**
 * The table node views (feature 006): the cell view writes the effective spans, and only above
 * 1, and the cell language (T034; rule 9 of the grid, C20; FR-020).
 */

import type { Node as PMNode } from 'prosemirror-model';

import { CellView } from '@/editor/nodeviews/table';
import { fb2Schema } from '@/editor/schema';

const N = fb2Schema.nodes;

function cell(attrs: Record<string, unknown>, kind: 'td' | 'th' = 'td'): PMNode {
  return N[kind]!.create({ nodeId: 'c1', ...attrs });
}

describe('CellView', () => {
  it('CellView renders the effective spans and lang: rowspan 0, -1 and "abc" render none; colspan 5000 renders 1000', () => {
    for (const rowspan of [0, -1, 'abc', 1, null, 2.5, '3']) {
      const view = new CellView(cell({ rowspan }), 'td');
      expect(view.dom.hasAttribute('rowspan')).toBe(false);
    }
    const kept = new CellView(
      cell({ extraAttrs: { unknownAttrs: { rowspan: 'abc', colspan: '4' } } }),
      'td',
    );
    expect(kept.dom.hasAttribute('rowspan')).toBe(false);
    expect(kept.dom.hasAttribute('colspan')).toBe(false);
    const wide = new CellView(cell({ colspan: 5000, rowspan: 70000 }), 'th');
    expect(wide.dom.getAttribute('colspan')).toBe('1000');
    expect(wide.dom.getAttribute('rowspan')).toBe('65534');
    const merged = new CellView(cell({ colspan: 2, rowspan: 3 }), 'td');
    expect(merged.dom.getAttribute('colspan')).toBe('2');
    expect(merged.dom.getAttribute('rowspan')).toBe('3');
    // An update to a span of 1 removes the attribute again.
    expect(merged.update(cell({ colspan: 1, rowspan: 0 }))).toBe(true);
    expect(merged.dom.hasAttribute('colspan')).toBe(false);
    expect(merged.dom.hasAttribute('rowspan')).toBe(false);
  });

  it('renders lang="de" and removes it again; an empty language is written as read', () => {
    const view = new CellView(cell({ lang: 'de' }), 'td');
    expect(view.dom.getAttribute('lang')).toBe('de');
    expect(view.update(cell({ lang: null }))).toBe(true);
    expect(view.dom.hasAttribute('lang')).toBe(false);
    expect(view.update(cell({ lang: '' }))).toBe(true);
    expect(view.dom.getAttribute('lang')).toBe('');
    // A cell of another kind is not updated in place.
    expect(view.update(cell({ lang: 'de' }, 'th'))).toBe(false);
  });
});
