/**
 * `regularisePastedTable` (feature 006, T142; FR-046, FR-059; C42; decision 4; data-model §8.4,
 * §8.6, open point 12; research R5 item 5, R5.5, vR5:119-130): a pasted table prepared for the
 * document - the empty rows dropped unless `keepRows`, the phantom columns of a foreign table
 * collapsed, a foreign table repaired as *Repair table* would - while the editor's own tables and
 * blocks keep their grid until *Repair table* (analyze decision 4). The tables are written in the
 * notation of data-model §16.1: `[a, b colspan 2] / [c rowspan 2]`, one bracket per row.
 */

import type { Node as PMNode } from 'prosemirror-model';

import { isRefusal } from '@/editor/table/edit';
import { effectiveColspan, effectiveRowspan, gridOfNode } from '@/editor/table/grid';
import { regularisePastedTable } from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';

import { N, docOf, idGenerator, pos, table, type CellSpec, type RowSpec } from './helpers';

/** A table from the notation `[a, b colspan 2] / [c rowspan 2] / []`, cell texts as named. */
function notation(text: string, prefix = 't'): PMNode {
  const rows: RowSpec[] = text.split('/').map((row) => {
    const inner = row.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    if (inner === '') return [];
    return inner.split(',').map((cell): CellSpec => {
      const [name, ...rest] = cell.trim().split(/\s+/);
      const spec: CellSpec = { text: name };
      for (let index = 0; index + 1 < rest.length; index += 2) {
        const value = Number(rest[index + 1]);
        if (rest[index] === 'colspan') spec.colspan = value;
        if (rest[index] === 'rowspan') spec.rowspan = value;
      }
      return spec;
    });
  });
  return table(prefix, rows);
}

/** A table written back in the notation, spans as counted. */
function written(node: PMNode): string {
  const rows: string[] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      let out = cell.textContent || '_';
      const colspan = effectiveColspan(cell.attrs.colspan);
      const rowspan = effectiveRowspan(cell.attrs.rowspan);
      if (colspan > 1) out += ` colspan ${colspan}`;
      if (rowspan > 1) out += ` rowspan ${rowspan}`;
      cells.push(out);
    });
    rows.push(`[${cells.join(', ')}]`);
  });
  return rows.join(' / ');
}

function regularise(node: PMNode, foreign: boolean, keepRows: boolean, next = idGenerator()) {
  const result = regularisePastedTable(node, { foreign, keepRows }, { nextId: next });
  if (isRefusal(result)) throw new Error(`refused: ${result.refused}`);
  return result;
}

describe('step 1: empty rows (data-model §8.6)', () => {
  it('without keepRows a row in which no cell starts is removed and every span that crossed it shrinks by one row; with keepRows it stays', () => {
    const source = notation('[a rowspan 3, b] / [] / [c]');
    for (const foreign of [false, true]) {
      expect(written(regularise(source, foreign, false)), String(foreign)).toBe(
        '[a rowspan 2, b] / [c]',
      );
    }
    expect(regularise(source, false, true)).toBe(source);
  });

  it('a block’s content() with its empty row under a cell that spans the block’s rows', () => {
    const doc = docOf(
      table('t', [
        [{ text: 'a', rowspan: 2 }, { text: 'b' }, { text: 'c' }],
        [{ text: 'd' }, { text: 'e' }],
      ]),
    );
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-0')).content();
    const copied = block.content.firstChild!;
    expect(gridOfNode(copied).rowStart).toEqual([0, 2, 3]);
    // The block's rows 1-2 × columns 1-2: [a rowspan 2, b] / [d].
    expect(written(copied)).toBe('[a rowspan 2, b] / [d]');
    expect(regularise(copied, false, false)).toBe(copied);
  });
});

describe('step 2: phantom columns, foreign tables only (C42; data-model open point 12)', () => {
  it('the banner [x colspan 99] over rows of four cells keeps four columns, the banner’s colspan 4', () => {
    const banner = notation('[x colspan 99] / [a, b, c, d] / [e, f, g, h]');
    const foreign = regularise(banner, true, false);
    expect(written(foreign)).toBe('[x colspan 4] / [a, b, c, d] / [e, f, g, h]');
    expect(gridOfNode(foreign).regular).toBe(true);
    // The editor's own copy is never collapsed (and not repaired: analyze decision 4).
    expect(regularise(banner, false, false)).toBe(banner);
    expect(regularise(banner, false, true)).toBe(banner);
  });

  it('a column is phantom only when no cell starts in it and every cell covering it runs past every other row there', () => {
    // x runs past rows 2 and 3 from column 5 on; c, which covers columns 1-4, runs past nothing:
    // only column 5 is phantom.
    const partly = notation('[x colspan 5] / [a, b] / [c colspan 4]');
    expect(written(regularise(partly, true, false, idGenerator('n')))).toBe(
      '[x colspan 4] / [a, b, _, _] / [c colspan 4]',
    );
    // b, in row 2, reaches column 6 as x does: nothing runs past, nothing collapses.
    const even = notation('[x colspan 6] / [a, b colspan 5] / [c, d]');
    expect(written(regularise(even, true, false))).toBe(
      '[x colspan 6] / [a, b colspan 5] / [c, d, _, _, _, _]',
    );
    // A cell that covers every row never runs past: a one-row table keeps its width.
    const single = notation('[a colspan 5]');
    expect(regularise(single, true, false)).toBe(single);
  });

  it('a block’s content() and an own table are never collapsed', () => {
    const doc = docOf(table('t', [[{ text: 'x', colspan: 9 }], [{ text: 'a' }, { text: 'b' }]]));
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1')).content();
    const copied = block.content.firstChild!;
    expect(regularise(copied, false, false)).toBe(copied);
    expect(regularise(copied, false, true)).toBe(copied);
  });
});

describe('step 3: the repair of a foreign table; the editor’s own tables keep their grid (analyze decision 4)', () => {
  const cases: [string, string, string][] = [
    ['an overlap', '[a, b rowspan 2] / [c colspan 2]', '[a, b rowspan 2] / [c]'],
    ['a rowspan past the last row', '[a rowspan 3, b] / [c]', '[a rowspan 2, b] / [c]'],
    ['a short row', '[a, b, c] / [d]', '[a, b, c] / [d, _, _]'],
  ];
  for (const [name, source, repaired] of cases) {
    it(`${name}: regular when foreign, as it was when the editor's own`, () => {
      const node = notation(source);
      expect(gridOfNode(node).regular).toBe(false);
      const foreign = regularise(node, true, false);
      expect(written(foreign)).toBe(repaired);
      expect(gridOfNode(foreign).regular).toBe(true);
      expect(gridOfNode(regularise(node, true, true)).regular).toBe(true);
      expect(regularise(node, false, false)).toBe(node);
      expect(regularise(node, false, true)).toBe(node);
    });
  }

  it('a regular table comes back as the same node, foreign or own', () => {
    const node = notation('[a colspan 2, b] / [c, d, e]');
    for (const foreign of [false, true]) {
      for (const keepRows of [false, true]) {
        expect(regularise(node, foreign, keepRows)).toBe(node);
      }
    }
  });

  it('new cells take fresh node ids from ctx.nextId; the other cells keep theirs', () => {
    const node = notation('[a, b, c] / [d]');
    const result = regularise(node, true, false, idGenerator('fresh'));
    const ids: unknown[] = [];
    result.descendants((child) => {
      if (child.type.name === 'td') ids.push(child.attrs.nodeId);
      return true;
    });
    expect(ids).toEqual(['t-0-0', 't-0-1', 't-0-2', 't-1-0', 'fresh1', 'fresh2']);
  });

  it('an irregular table above MAX_GRID_POSITIONS gives too-large', () => {
    const rows: RowSpec[] = [[{ text: 'wide', colspan: 1000 }, { text: 'x' }]];
    for (let index = 0; index < 4200; index += 1) rows.push([{ text: 'r', colspan: 1000 }]);
    const huge = table('h', rows);
    expect(gridOfNode(huge).tooLarge).toBe(true);
    expect(gridOfNode(huge).regular).toBe(false);
    expect(
      regularisePastedTable(huge, { foreign: true, keepRows: false }, { nextId: idGenerator() }),
    ).toEqual({
      refused: 'too-large',
    });
    // The editor's own: nothing to compute, nothing refused.
    expect(
      regularisePastedTable(huge, { foreign: false, keepRows: false }, { nextId: idGenerator() }),
    ).toBe(huge);
  });

  it('the phantom collapse goes first: an irregular table that is too large only by a phantom span is made regular', () => {
    const rows: RowSpec[] = [[{ text: 'banner', colspan: 1000 }]];
    for (let index = 0; index < 4200; index += 1) rows.push([{ text: 'a' }, { text: 'b' }]);
    const banner = table('b', rows);
    expect(gridOfNode(banner).tooLarge).toBe(true);
    const result = regularise(banner, true, false);
    expect(gridOfNode(result).regular).toBe(true);
    expect(gridOfNode(result).width).toBe(2);
    expect(N.table!.validContent(result.content)).toBe(true);
  });
});
