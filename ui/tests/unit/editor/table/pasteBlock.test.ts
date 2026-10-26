/**
 * The paste-block plan and the pasted block (feature 006, T091; FR-011, FR-012, FR-016's split
 * as the paste uses it, FR-030, FR-035, FR-046; U8, U31; C17, C47; data-model §4.4, §8.4, §8.7;
 * analyze decision 4; quickstart §4 "Unit and core tests" and §12; research R5.7): tables in the
 * notation of data-model §16.1 (`show`), addresses from `tableTarget` over a caret or a
 * `CellBlockSelection`, a `PlanContext` with a counting `nextId` and a `bookIds` set. Every
 * result is committed through `commitTableEdit` as one `ReplaceStep`, passes `check()` and
 * `assertTableValid(before, after, edit.allowedIds, edit.pastedIrregular)`, and a regular table
 * stays regular unless the pasted block is irregular, whose edit alone carries
 * `pastedIrregular`.
 */

import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';

import { withoutNodeIds } from '@/editor/plugins/clipboard';
import { fb2Schema } from '@/editor/schema';
import {
  applyTableEdit,
  assertTableValid,
  commitTableEdit,
  isRefusal,
  tableTarget,
  type TableEdit,
} from '@/editor/table/edit';
import { gridOfNode } from '@/editor/table/grid';
import { blockOver, caretAt, normalisePastedBlock, pasteBlockPlan } from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';

import { childrenOf, docOf, idGenerator, p, pos, table, type CellSpec } from './helpers';

const N = fb2Schema.nodes;
const M = fb2Schema.marks;

/** A cell: its text, or its spec with the text. */
type Cell = string | CellSpec;

/** A table whose cells carry the given texts; node ids `<prefix>-<row>-<index>`. */
function build(rows: Cell[][], prefix: string, aligns: (string | null)[] = []): PMNode {
  return table(
    prefix,
    rows.map((cells, r) => {
      const specs = cells.map((cell) => (typeof cell === 'string' ? { text: cell } : cell));
      return aligns[r] ? { align: aligns[r]!, cells: specs } : specs;
    }),
  );
}

/** The plain 3 × 3 table `r1c1` … `r3c3` (texts counted from 1). */
const PLAIN: Cell[][] = [1, 2, 3].map((r) => [1, 2, 3].map((c) => `r${r}c${c}`));

/** The block `a b / c d`. */
const ABCD = (): PMNode =>
  build(
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
    'b',
  );

/**
 * The notation of data-model §16.1: rows separated by `/`, a row's own cells in brackets
 * (`{align}` before a row's bracket); a cell is its text - `<td>` or `<th>` when empty, `<th>`
 * before the text of a header cell - followed by its set attributes.
 */
function show(node: PMNode): string {
  const names = ['colspan', 'rowspan', 'align', 'valign', 'lang', 'id', 'style'];
  return childrenOf(node)
    .map((row) => {
      const cells = childrenOf(row).map((cell) => {
        const text = cell.textContent;
        const head = cell.type.name === 'th' ? `<th>${text}` : text === '' ? '<td>' : text;
        const attrs = names
          .filter((name) => cell.attrs[name] !== null && cell.attrs[name] !== undefined)
          .map((name) => `${name}=${String(cell.attrs[name])}`);
        if (cell.attrs.extraAttrs) attrs.push(`extra=${JSON.stringify(cell.attrs.extraAttrs)}`);
        return [head, ...attrs].join(' ');
      });
      return `${row.attrs.align ? `{${row.attrs.align}}` : ''}[${cells.join(', ')}]`;
    })
    .join(' / ');
}

interface Pasted {
  edit: TableEdit;
  before: PMNode;
  after: PMNode;
}

/**
 * Pastes `block` into `target` (a table node `t`) with the caret at the start of the cell
 * `at`, or over the block of the cells `at[0]` to `at[1]`, and checks what every result must
 * hold: one `ReplaceStep` through `commitTableEdit`, `check()`, `assertTableValid` and the
 * regularity rule.
 */
function pasteAt(
  target: PMNode,
  at: string | [string, string],
  block: PMNode,
  bookIds: readonly string[] = [],
): Pasted {
  const doc = docOf(p('before', 'a1'), target, p('after', 'a2'));
  const selection =
    typeof at === 'string'
      ? TextSelection.create(doc, pos(doc, at) + 1)
      : CellBlockSelection.create(doc, pos(doc, at[0]), pos(doc, at[1]));
  const state = EditorState.create({ doc, selection });
  const found = tableTarget(state)!;
  const edit = pasteBlockPlan(found.address, block, {
    nextId: idGenerator('n'),
    bookIds: new Set(bookIds),
  });
  if (isRefusal(edit)) throw new Error(`refused: ${JSON.stringify(edit)}`);
  const before = found.address.table;
  const after = applyTableEdit(before, edit);
  after.check();
  assertTableValid(before, after, edit.allowedIds, edit.pastedIrregular);
  const irregularBlock = !gridOfNode(block).regular;
  expect(edit.pastedIrregular === true).toBe(irregularBlock);
  if (gridOfNode(before).regular && !irregularBlock) expect(gridOfNode(after).regular).toBe(true);
  const tr = commitTableEdit(state.tr, found.tablePos, edit)!;
  expect(tr.steps).toHaveLength(1);
  expect(tr.steps[0]).toBeInstanceOf(ReplaceStep);
  tr.doc.check();
  return { edit, before, after };
}

/** Every node id of a table, the table's own included. */
function nodeIds(node: PMNode): string[] {
  const ids = [node.attrs.nodeId as string];
  node.descendants((child) => {
    if (typeof child.attrs.nodeId === 'string') ids.push(child.attrs.nodeId);
    return true;
  });
  return ids;
}

describe('pasteBlockPlan (data-model §8.4)', () => {
  it('a 2 × 2 block onto a 3 × 3 table at (1, 1): the cells overwritten by position, a block over T', () => {
    const { after, edit } = pasteAt(build(PLAIN, 't'), 't-1-1', ABCD());
    expect(show(after)).toBe('[r1c1, r1c2, r1c3] / [r2c1, a, b] / [r3c1, c, d]');
    expect(edit.focus).toEqual(blockOver({ top: 1, left: 1, bottom: 3, right: 3 }));
    expect(edit.removedIds).toEqual([]);
  });

  it('at (0, 0), and over a block anchored at its top-left position', () => {
    expect(show(pasteAt(build(PLAIN, 't'), 't-0-0', ABCD()).after)).toBe(
      '[a, b, r1c3] / [c, d, r2c3] / [r3c1, r3c2, r3c3]',
    );
    // A larger selected block is not tiled: the block anchors at its top-left.
    expect(show(pasteAt(build(PLAIN, 't'), ['t-2-2', 't-1-1'], ABCD()).after)).toBe(
      '[r1c1, r1c2, r1c3] / [r2c1, a, b] / [r3c1, c, d]',
    );
  });

  it('at (2, 2) with growth: one row and one column appended, their cells like their neighbours (FR-008), the row with its reference row’s align', () => {
    const target = build(
      [
        ['r1c1', 'r1c2', { kind: 'th', text: 'r1c3' }],
        ['r2c1', 'r2c2', { kind: 'th', text: 'r2c3' }],
        [
          { text: 'r3c1', lang: 'de' },
          { text: 'r3c2', valign: 'top' },
          { kind: 'th', text: 'r3c3', align: 'right' },
        ],
      ],
      't',
      [null, null, 'center'],
    );
    const { after, edit } = pasteAt(target, 't-2-2', ABCD());
    expect(show(after)).toBe(
      '[r1c1, r1c2, <th>r1c3, <th>] / [r2c1, r2c2, <th>r2c3, <th>] / ' +
        '{center}[r3c1 lang=de, r3c2 valign=top, a, b] / {center}[<td> lang=de, <td> valign=top, c, d]',
    );
    expect(edit.focus).toEqual(blockOver({ top: 2, left: 2, bottom: 4, right: 4 }));
  });

  it('a block that holds a merged cell', () => {
    const block = build([[{ text: 'A', colspan: 2 }], ['c', 'd']], 'b');
    expect(show(pasteAt(build(PLAIN, 't'), 't-1-1', block).after)).toBe(
      '[r1c1, r1c2, r1c3] / [r2c1, A colspan=2] / [r3c1, c, d]',
    );
  });

  it('a target cell crossing the edge of T is split first; its content stays in its top-left piece', () => {
    // X covers (1, 2) and (2, 2); T is rows 2-3 × columns 1-2 after the growth.
    const crossing = build(
      [
        ['r1c1', 'r1c2', 'r1c3'],
        ['r2c1', 'r2c2', { text: 'X', rowspan: 2 }],
        ['r3c1', 'r3c2'],
      ],
      't',
    );
    expect(show(pasteAt(crossing, 't-2-1', ABCD()).after)).toBe(
      '[r1c1, r1c2, r1c3] / [r2c1, r2c2, X] / [r3c1, a, b] / [<td>, c, d]',
    );
    // m (rows 2-3 × columns 3-4) starts inside T: its pieces outside T are empty cells.
    const merged = build(
      [
        ['r1c1', 'r1c2', 'r1c3', 'r1c4'],
        ['r2c1', 'r2c2', { text: 'm', colspan: 2, rowspan: 2, align: 'center' }],
        ['r3c1', 'r3c2'],
        ['r4c1', 'r4c2', 'r4c3', 'r4c4'],
      ],
      't',
    );
    expect(show(pasteAt(merged, 't-1-1', ABCD()).after)).toBe(
      '[r1c1, r1c2, r1c3, r1c4] / [r2c1, a, b, <td> align=center] / ' +
        '[r3c1, c, d, <td> align=center] / [r4c1, r4c2, r4c3, r4c4]',
    );
  });

  it('an irregular target with a short row: the hole fill puts each pasted cell in its column (FR-035)', () => {
    const short = build([['r1c1', 'r1c2', 'r1c3'], ['r2c1'], ['r3c1', 'r3c2', 'r3c3']], 't');
    expect(show(pasteAt(short, 't-0-2', ABCD()).after)).toBe(
      '[r1c1, r1c2, a, b] / [r2c1, <td>, c, d] / [r3c1, r3c2, r3c3, <td>]',
    );
  });

  it('header kinds kept; an id the book uses removed, an unused one kept', () => {
    const headers = build(
      [
        [
          { kind: 'th', text: 'H1' },
          { kind: 'th', text: 'H2' },
        ],
        ['a', 'b'],
      ],
      'b',
    );
    expect(show(pasteAt(build(PLAIN, 't'), 't-0-0', headers).after)).toBe(
      '[<th>H1, <th>H2, r1c3] / [a, b, r2c3] / [r3c1, r3c2, r3c3]',
    );
    const ids = build(
      [
        [
          { text: 'a', id: 'used' },
          { text: 'b', id: 'free' },
        ],
        ['c', 'd'],
      ],
      'b',
    );
    const { after, edit } = pasteAt(build(PLAIN, 't'), 't-1-1', ids, ['used']);
    expect(show(after)).toBe('[r1c1, r1c2, r1c3] / [r2c1, a, b id=free] / [r3c1, c, d]');
    expect(edit.allowedIds).toContain('free');
    expect(edit.allowedIds ?? []).not.toContain('used');
  });

  it('U31: a removed target cell passes its id to the pasted cell starting at its position; target rows keep their align', () => {
    const linked = build(
      [
        ['r1c1', 'r1c2', 'r1c3'],
        ['r2c1', { text: 'r2c2', id: 'linked' }, { text: 'r2c3', id: 'gone' }],
        ['r3c1', 'r3c2', 'r3c3'],
      ],
      't',
      [null, 'center', null],
    );
    const handed = pasteAt(linked, 't-1-1', ABCD(), ['linked', 'gone']);
    expect(show(handed.after)).toBe(
      '[r1c1, r1c2, r1c3] / {center}[r2c1, a id=linked, b id=gone] / [r3c1, c, d]',
    );
    expect(handed.edit.removedIds).toEqual([]);
    // A merged pasted cell covers the position of `gone` without starting there: the id goes.
    const merged = build([[{ text: 'A', colspan: 2 }], ['c', 'd']], 'b');
    const lost = pasteAt(linked, 't-1-1', merged, ['linked', 'gone']);
    expect(show(lost.after)).toBe(
      '[r1c1, r1c2, r1c3] / {center}[r2c1, A colspan=2 id=linked] / [r3c1, c, d]',
    );
    expect(lost.edit.removedIds).toEqual(['gone']);
  });

  it('row compaction when T spans the whole width and a block row holds no own cell', () => {
    // A block's content() under a cell over two rows: its second row is an empty tr.
    const block = table('b', [
      [{ text: 'A', colspan: 2, rowspan: 2 }],
      [],
      [{ text: 'p' }, { text: 'q' }],
    ]);
    const target = build(
      [
        ['r1c1', 'r1c2'],
        ['r2c1', 'r2c2'],
        ['r3c1', 'r3c2'],
      ],
      't',
    );
    const { after, edit } = pasteAt(target, 't-0-0', block);
    expect(show(after)).toBe('[A colspan=2] / [p, q]');
    expect(edit.focus).toEqual(blockOver({ top: 0, left: 0, bottom: 2, right: 2 }));
  });

  describe('blocks copied from irregular tables keep their grid (analyze decision 4)', () => {
    const target23 = () =>
      build(
        [
          ['r1c1', 'r1c2', 'r1c3'],
          ['r2c1', 'r2c2', 'r2c3'],
        ],
        't',
      );

    it('an overlap stays an overlap inside T', () => {
      const overlap = build([['a', { text: 'X', rowspan: 2 }], [{ text: 'Y', colspan: 2 }]], 'b');
      expect(gridOfNode(overlap).summary.overlaps).toBe(1);
      const { after, edit } = pasteAt(target23(), 't-0-0', overlap);
      expect(show(after)).toBe('[a, X rowspan=2, r1c3] / [Y colspan=2, r2c3]');
      expect(gridOfNode(after).summary).toMatchObject({ overlaps: 1, shortRows: 0 });
      expect(edit.pastedIrregular).toBe(true);
    });

    it('a hole stays a hole where no target cell follows it, and is filled where one does', () => {
      const holed = build([['a', 'b'], ['c']], 'b');
      const end = pasteAt(target23(), 't-0-1', holed);
      expect(show(end.after)).toBe('[r1c1, a, b] / [r2c1, c]');
      expect(gridOfNode(end.after).summary.shortRows).toBe(1);
      const filled = pasteAt(target23(), 't-0-0', holed);
      expect(show(filled.after)).toBe('[a, b, r1c3] / [c, <td>, r2c3]');
      expect(gridOfNode(filled.after).regular).toBe(true);
      expect(filled.edit.pastedIrregular).toBe(true);
    });

    it('a rowspan past the block’s last row ends at T’s last row when rows follow, and keeps its value at the table’s end', () => {
      const past = build([['a', { text: 'X', rowspan: 3 }], ['c']], 'b');
      expect(gridOfNode(past).summary.pastEnd).toBe(1);
      const below = build(
        [
          ['r1c1', 'r1c2'],
          ['r2c1', 'r2c2'],
          ['r3c1', 'r3c2'],
        ],
        't',
      );
      expect(show(pasteAt(below, 't-0-0', past).after)).toBe(
        '[a, X rowspan=2] / [c] / [r3c1, r3c2]',
      );
      const last = build(
        [
          ['r1c1', 'r1c2'],
          ['r2c1', 'r2c2'],
        ],
        't',
      );
      const kept = pasteAt(last, 't-0-0', past);
      expect(show(kept.after)).toBe('[a, X rowspan=3] / [c]');
      expect(gridOfNode(kept.after).summary.pastEnd).toBe(1);
    });
  });

  it('fresh node ids on every pasted node, inline atoms included (FR-030)', () => {
    const image = N.inline_image!.create({ nodeId: 'img', href: '#pic.png' });
    const block = N.table!.create({ nodeId: 'b' }, [
      N.tr!.create({ nodeId: 'b-r0' }, [
        N.td!.create({ nodeId: 'b-0-0' }, [image]),
        N.td!.create({ nodeId: 'b-0-1' }, fb2Schema.text('x')),
      ]),
    ]);
    const { after } = pasteAt(build(PLAIN, 't'), 't-0-0', block);
    const ids = nodeIds(after);
    for (const id of ['img', 'b-0-0', 'b-0-1']) expect(ids).not.toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(after.child(0).child(0).firstChild!.attrs.nodeId).toMatch(/^n\d+$/);
  });

  it('U8: inline images, note links, nested named styles and inline raw XML come through a paste unchanged', () => {
    const content = [
      fb2Schema.text('note', [M.link!.create({ href: '#n1', type: 'note' })]),
      N.inline_image!.create({ nodeId: 'img', href: '#pic.png' }, null, [M.strong!.create()]),
      fb2Schema.text('styled', [
        M.style!.create({ name: 'outer' }),
        M.style!.create({ name: 'inner' }),
      ]),
      N.raw_xml_inline!.create({ nodeId: 'raw', xml: '<x:y/>' }),
    ];
    const source = N.td!.create({ nodeId: 'b-0-0' }, content);
    const block = N.table!.create({ nodeId: 'b' }, [
      N.tr!.create({ nodeId: 'b-r0' }, [source, N.td!.create({ nodeId: 'b-0-1' })]),
    ]);
    const { after } = pasteAt(build(PLAIN, 't'), 't-1-1', block);
    const pasted = after.child(1).child(1);
    expect(withoutNodeIds(pasted.content).eq(withoutNodeIds(source.content))).toBe(true);
  });

  it('a caret focus when T is one position; too-large on a table above MAX_GRID_POSITIONS', () => {
    const one = build([['z']], 'b');
    const { after, edit } = pasteAt(build(PLAIN, 't'), 't-1-1', one);
    expect(show(after)).toBe('[r1c1, r1c2, r1c3] / [r2c1, z, r2c3] / [r3c1, r3c2, r3c3]');
    expect(edit.focus).toEqual(caretAt(1, 1));
    const wide: CellSpec[] = Array.from({ length: 4195 }, () => ({ colspan: 1000, text: 'w' }));
    const huge = table('h', [wide]);
    const doc = docOf(huge);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, pos(doc, 'h-0-0') + 1),
    });
    const found = tableTarget(state)!;
    expect(found.address.grid.tooLarge).toBe(true);
    expect(pasteBlockPlan(found.address, one, { nextId: idGenerator('n') })).toEqual({
      refused: 'too-large',
    });
  });
});

describe('normalisePastedBlock (data-model §8.4, §8.6 step 1)', () => {
  it('with keepRows nothing changes; a block of a regular table is pasted unchanged', () => {
    const regular = ABCD();
    expect(normalisePastedBlock(regular, { keepRows: true }, { nextId: idGenerator() })).toBe(
      regular,
    );
    expect(normalisePastedBlock(regular, { keepRows: false }, { nextId: idGenerator() })).toBe(
      regular,
    );
    const holed = build([['a', 'b'], ['c']], 'b');
    expect(normalisePastedBlock(holed, { keepRows: false }, { nextId: idGenerator() })).toBe(holed);
  });

  it('without keepRows a row in which no cell starts goes and the spans over it shrink', () => {
    const block = table('b', [[{ text: 'A', rowspan: 3 }, { text: 'b' }], [], [{ text: 'c' }]]);
    const kept = normalisePastedBlock(block, { keepRows: true }, { nextId: idGenerator() });
    expect(kept).toBe(block);
    const compact = normalisePastedBlock(block, { keepRows: false }, { nextId: idGenerator() });
    expect(show(compact)).toBe('[A rowspan=2, b] / [c]');
    expect(Fragment.from(compact).size).toBeGreaterThan(0);
  });
});
