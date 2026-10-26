/**
 * The block of cells and the table plugin (feature 006, T036; FR-010; I7; C4; U10; data-model
 * §5): `CellBlockSelection` - its rectangle, ranges, head, content, JSON, mapping and
 * bookmark - and `tableEditingPlugin` - `createSelectionBetween`, Shift+click, Shift+Arrow,
 * Enter with a block, the normalisation of §5.2, the decorations and the absence of paste
 * props. US4's journeys drive the same in a real page. US4 (T092; FR-011; US4 sc.4, sc.5,
 * sc.8; U39; data-model §4.6, §5.3, §5.4, §5.7): the generic replacement paths over a block -
 * `deleteSelection`, `replaceSelectionWith`, `insertText`, `replaceSelection`, `replaceWith` -
 * clear it with the clear-block plan and never change a row; Delete, Backspace, type-over and
 * the start of a composition through the plugin.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { history, undo, undoDepth } from 'prosemirror-history';
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Plugin,
  type Transaction,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { DISCRETE_STEP } from '@/editor/commands/util';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import { fb2Schema, findNodeById } from '@/editor/schema';
import { gridOfNode } from '@/editor/table/grid';
import { ComposeOverSelection, tableEditingKey, tableEditingPlugin } from '@/editor/table/plugin';
import { CellBlockSelection, blockTopLeftCellPos, cellBlockOrNull } from '@/editor/table/selection';
import { createBodyEditorState } from '@/views/body/bodyEditor';

const N = fb2Schema.nodes;

interface CellSpec {
  kind?: 'td' | 'th';
  text?: string;
  colspan?: number;
  rowspan?: number;
  id?: string;
  style?: string;
  lang?: string;
}
type RowSpec = CellSpec[] | { align?: string; cells: CellSpec[] };

/** A table whose cells carry the node ids `<prefix>-<row>-<cell>` and the texts `r<row>c<cell>`. */
function table(prefix: string, rows: RowSpec[]): PMNode {
  return N.table!.create(
    { nodeId: prefix },
    rows.map((spec, r) => {
      const cells = Array.isArray(spec) ? spec : spec.cells;
      const align = Array.isArray(spec) ? null : (spec.align ?? null);
      return N.tr!.create(
        { nodeId: `${prefix}-r${r}`, align },
        cells.map((cell, c) =>
          N[cell.kind ?? 'td']!.create(
            {
              nodeId: `${prefix}-${r}-${c}`,
              colspan: cell.colspan ?? null,
              rowspan: cell.rowspan ?? null,
              id: cell.id ?? null,
              style: cell.style ?? null,
              lang: cell.lang ?? null,
            },
            cell.text === '' ? undefined : fb2Schema.text(cell.text ?? `r${r}c${c}`),
          ),
        ),
      );
    }),
  );
}

const grid4 = (): RowSpec[] => Array.from({ length: 4 }, () => [{}, {}, {}, {}]);

function p(text: string, nodeId: string): PMNode {
  return N.p!.create({ nodeId }, text ? fb2Schema.text(text) : undefined);
}

function docOf(...blocks: PMNode[]): PMNode {
  return N.doc!.create(
    null,
    N.body!.create({ nodeId: 'b' }, N.section!.create({ nodeId: 's' }, blocks)),
  );
}

function pos(doc: PMNode, nodeId: string): number {
  const found = findNodeById(doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

function stateOf(doc: PMNode, plugins: Plugin[] = [tableEditingPlugin()]): EditorState {
  return EditorState.create({ doc, plugins });
}

function pluginOf(state: EditorState): Plugin {
  return tableEditingKey.get(state)!;
}

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

function viewOf(state: EditorState): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, { state, nodeViews: createTableNodeViews() });
  views.push(view);
  return view;
}

function select(state: EditorState, selection: Selection): EditorState {
  return state.apply(state.tr.setSelection(selection));
}

const caret = (doc: PMNode, nodeId: string, offset = 0) =>
  TextSelection.create(doc, pos(doc, nodeId) + 1 + offset);

describe('CellBlockSelection', () => {
  it('create on a 4 × 4 table from row 1, column 2 to row 3, column 3 gives a 3 × 2 rectangle (US4 sc.1)', () => {
    const doc = docOf(p('before', 'p1'), table('t', grid4()), p('after', 'p2'));
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-1'), pos(doc, 't-2-2'));
    expect(block.rect).toEqual({ top: 0, left: 1, bottom: 3, right: 3 });
    expect(block.tablePos).toBe(pos(doc, 't'));
    expect(block.cellPositions()).toEqual(
      ['t-0-1', 't-0-2', 't-1-1', 't-1-2', 't-2-1', 't-2-2'].map((id) => pos(doc, id)),
    );
  });

  it('grows over a merged cell its corners cut (US4 sc.2)', () => {
    //   a  b  c  d / e  f  g(colspan 2, rowspan 2) / h(rowspan 2)  i / k  l  m
    const doc = docOf(
      table('t', [
        [{}, {}, {}, {}],
        [{}, {}, { colspan: 2, rowspan: 2 }],
        [{ rowspan: 2 }, {}],
        [{}, {}, {}],
      ]),
    );
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-1'), pos(doc, 't-2-0'));
    // b (0, 1) to h (2, 0): h reaches row 3, which brings in k.
    expect(block.rect).toEqual({ top: 0, left: 0, bottom: 4, right: 2 });
    const whole = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-2'));
    expect(whole.rect).toEqual({ top: 0, left: 0, bottom: 4, right: 4 });
  });

  it('ranges cover exactly the cells of cellsIn(rect), the top-left cell first; $anchor and $head at the start of the head cell', () => {
    const doc = docOf(table('t', grid4()));
    const anchor = pos(doc, 't-2-2');
    const head = pos(doc, 't-1-1');
    const block = CellBlockSelection.create(doc, anchor, head);
    const tableNode = doc.nodeAt(pos(doc, 't'))!;
    const grid = gridOfNode(tableNode);
    expect(block.ranges).toHaveLength(grid.cellsIn(block.rect).length);
    expect(block.ranges.map((range) => [range.$from.pos, range.$to.pos])).toEqual(
      ['t-1-1', 't-1-2', 't-2-1', 't-2-2'].map((id) => {
        const at = pos(doc, id);
        return [at + 1, at + 1 + doc.nodeAt(at)!.content.size];
      }),
    );
    expect(block.$anchor.pos).toBe(head + 1);
    expect(block.$head.pos).toBe(head + 1);
    expect(block.$anchorCell.pos).toBe(anchor);
    expect(block.$headCell.pos).toBe(head);
    // from / to read the top-left cell (selectedText, the Find dialog's pre-fill).
    expect(doc.textBetween(block.from, block.to)).toBe('r1c1');
  });

  it('is never empty, also on empty cells, and not visible', () => {
    const doc = docOf(table('t', [[{ text: '' }, { text: '' }]]));
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-0-1'));
    expect(block.empty).toBe(false);
    expect(block.visible).toBe(false);
  });

  it('refuses one cell, cells of two tables, positions that are no cells', () => {
    const doc = docOf(table('t', grid4()), p('x', 'p1'), table('u', grid4()));
    expect(() => CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-0-0'))).toThrow(
      RangeError,
    );
    expect(() => CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 'u-0-1'))).toThrow(
      RangeError,
    );
    expect(() => CellBlockSelection.create(doc, pos(doc, 'p1'), pos(doc, 't-0-1'))).toThrow(
      RangeError,
    );
    expect(cellBlockOrNull(doc, pos(doc, 't-0-0'), pos(doc, 'u-0-1'))).toBeNull();
  });

  it('content() is a closed table slice: the rows with their align, the cells as they are, holes and an empty tr', () => {
    // [a, b, c rowspan 2] / [d]: the block from b to c reaches row 2, where no cell of the block
    // starts (d is at column 0, column 1 is a hole).
    const doc = docOf(
      table('t', [
        {
          align: 'center',
          cells: [{}, { id: 'bid', style: 'st', lang: 'de' }, { rowspan: 2, kind: 'th' }],
        },
        [{}],
      ]),
    );
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-1'), pos(doc, 't-0-2'));
    expect(block.rect).toEqual({ top: 0, left: 1, bottom: 2, right: 3 });
    const slice = block.content();
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
    expect(slice.content.childCount).toBe(1);
    const copied = slice.content.firstChild!;
    expect(copied.type.name).toBe('table');
    expect(copied.attrs).toMatchObject({ nodeId: null, id: null, style: null });
    expect(copied.childCount).toBe(2);
    const first = copied.child(0);
    expect(first.attrs.align).toBe('center');
    expect(first.childCount).toBe(2);
    expect(first.child(0)).toBe(doc.nodeAt(pos(doc, 't-0-1')));
    expect(first.child(0).attrs).toMatchObject({
      id: 'bid',
      style: 'st',
      lang: 'de',
      nodeId: 't-0-1',
    });
    expect(first.child(1)).toBe(doc.nodeAt(pos(doc, 't-0-2')));
    expect(copied.child(1).childCount).toBe(0);
    expect(copied.child(1).attrs.align).toBeNull();
    // The copy keeps the grid of the block: c over both rows, a hole below b.
    expect(gridOfNode(copied).summary).toEqual({
      rows: 2,
      columns: 2,
      shortRows: 1,
      row: 2,
      covered: 1,
      overlaps: 0,
      pastEnd: 0,
    });
  });

  it('round-trips through JSON and Selection.fromJSON', () => {
    const doc = docOf(table('t', grid4()));
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1'));
    const json = block.toJSON();
    expect(json).toEqual({
      type: 'mfbe-cell-block',
      anchor: pos(doc, 't-0-0'),
      head: pos(doc, 't-1-1'),
    });
    const restored = Selection.fromJSON(doc, JSON.parse(JSON.stringify(json)));
    expect(restored).toBeInstanceOf(CellBlockSelection);
    expect(restored.eq(block)).toBe(true);
    expect(() => Selection.fromJSON(doc, { type: 'mfbe-cell-block', anchor: 'x' })).toThrow(
      RangeError,
    );
  });

  it('maps through a step elsewhere, and becomes a text selection when a cell of it goes away', () => {
    const doc = docOf(p('before', 'p1'), table('t', grid4()));
    const state = select(
      stateOf(doc),
      CellBlockSelection.create(doc, pos(doc, 't-1-1'), pos(doc, 't-2-2')),
    );
    const typed = state.apply(state.tr.insertText('xx', pos(doc, 'p1') + 1));
    expect(typed.selection).toBeInstanceOf(CellBlockSelection);
    const mapped = typed.selection as CellBlockSelection;
    expect(mapped.$anchorCell.pos).toBe(pos(doc, 't-1-1') + 2);
    expect(mapped.$headCell.pos).toBe(pos(doc, 't-2-2') + 2);
    expect(mapped.rect).toEqual({ top: 1, left: 1, bottom: 3, right: 3 });
    // Removing the anchor cell's row.
    const rowPos = pos(doc, 't-r1');
    const removed = state.apply(state.tr.delete(rowPos, rowPos + doc.nodeAt(rowPos)!.nodeSize));
    expect(removed.selection).toBeInstanceOf(TextSelection);
  });

  it('eq: the same class and the same two cells', () => {
    const doc = docOf(table('t', grid4()));
    const a = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1'));
    expect(a.eq(CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1')))).toBe(true);
    // The same rectangle from other corners is another selection.
    expect(a.eq(CellBlockSelection.create(doc, pos(doc, 't-1-1'), pos(doc, 't-0-0')))).toBe(false);
    expect(a.eq(caret(doc, 't-1-1'))).toBe(false);
  });

  it('an Undo through history() restores a block from its bookmark', () => {
    const doc = docOf(p('before', 'p1'), table('t', grid4()));
    let state = stateOf(doc, [history(), tableEditingPlugin()]);
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-1'), pos(doc, 't-2-3'));
    state = select(state, block);
    state = state.apply(state.tr.insertText('X', pos(doc, 'p1') + 1));
    state = select(state, caret(state.doc, 'p1', 3));
    let undone: EditorState | null = null;
    expect(
      undo(state, (tr) => {
        undone = state.apply(tr);
      }),
    ).toBe(true);
    const restored = undone!.selection;
    expect(restored).toBeInstanceOf(CellBlockSelection);
    expect(restored.eq(block)).toBe(true);
  });
});

describe('tableEditingPlugin', () => {
  it('createSelectionBetween: a block for two cells of one table, nothing for one cell or two tables', () => {
    const doc = docOf(table('t', grid4()), p('x', 'p1'), table('u', grid4()));
    const view = viewOf(stateOf(doc));
    const plugin = pluginOf(view.state);
    const between = (a: number, h: number) =>
      plugin.props.createSelectionBetween!.call(plugin, view, doc.resolve(a), doc.resolve(h));
    const block = between(pos(doc, 't-0-0') + 2, pos(doc, 't-1-2') + 1);
    expect(block).toBeInstanceOf(CellBlockSelection);
    expect((block as CellBlockSelection).rect).toEqual({ top: 0, left: 0, bottom: 2, right: 3 });
    expect(between(pos(doc, 't-0-0') + 1, pos(doc, 't-0-0') + 3)).toBeNull();
    expect(between(pos(doc, 't-0-0') + 1, pos(doc, 'u-0-0') + 1)).toBeNull();
    expect(between(pos(doc, 't-0-0') + 1, pos(doc, 'p1') + 1)).toBeNull();
  });

  it('Shift+click on another cell of the table makes the block from the caret cell, or from the block anchor', () => {
    const doc = docOf(table('t', grid4()));
    const view = viewOf(select(stateOf(doc), caret(doc, 't-0-0', 1)));
    const plugin = pluginOf(view.state);
    let clicked = pos(doc, 't-2-1') + 1;
    view.posAtCoords = () => ({ pos: clicked, inside: -1 });
    const mousedown = plugin.props.handleDOMEvents!.mousedown!;
    const click = (init: MouseEventInit) =>
      mousedown.call(plugin, view, new MouseEvent('mousedown', { button: 0, ...init }));
    expect(click({ shiftKey: true })).toBe(true);
    let selection = view.state.selection as CellBlockSelection;
    expect(selection).toBeInstanceOf(CellBlockSelection);
    expect(selection.$anchorCell.pos).toBe(pos(doc, 't-0-0'));
    expect(selection.$headCell.pos).toBe(pos(doc, 't-2-1'));
    // With a block, from its anchor cell.
    clicked = pos(doc, 't-1-3') + 1;
    expect(click({ shiftKey: true })).toBe(true);
    selection = view.state.selection as CellBlockSelection;
    expect(selection.$anchorCell.pos).toBe(pos(doc, 't-0-0'));
    expect(selection.rect).toEqual({ top: 0, left: 0, bottom: 2, right: 4 });
    // Ctrl+click and Cmd+click are left alone for links.
    expect(click({ shiftKey: true, ctrlKey: true })).toBe(false);
    expect(click({ shiftKey: true, metaKey: true })).toBe(false);
  });

  it('Shift+Arrow at the edge of the cell makes a block towards the next cell (US4 sc.3)', () => {
    const doc = docOf(table('t', grid4()));
    const view = viewOf(select(stateOf(doc), caret(doc, 't-1-1', 4)));
    const plugin = pluginOf(view.state);
    const key = (init: KeyboardEventInit) =>
      plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', init));
    view.endOfTextblock = () => false;
    expect(key({ key: 'ArrowDown', shiftKey: true })).toBe(false);
    view.endOfTextblock = () => true;
    expect(key({ key: 'ArrowDown', shiftKey: true })).toBe(true);
    const block = view.state.selection as CellBlockSelection;
    expect(block.$anchorCell.pos).toBe(pos(doc, 't-1-1'));
    expect(block.$headCell.pos).toBe(pos(doc, 't-2-1'));
    // The head moves on, one grid step at a time.
    expect(key({ key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect((view.state.selection as CellBlockSelection).rect).toEqual({
      top: 1,
      left: 1,
      bottom: 3,
      right: 3,
    });
  });

  it('head steps skip holes', () => {
    // [a, b, c] / [d] / [e, f, g]: below b, row 2 has a hole.
    const doc = docOf(table('t', [[{}, {}, {}], [{}], [{}, {}, {}]]));
    const view = viewOf(select(stateOf(doc), caret(doc, 't-0-1')));
    const plugin = pluginOf(view.state);
    view.endOfTextblock = () => true;
    expect(
      plugin.props.handleKeyDown!.call(
        plugin,
        view,
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }),
      ),
    ).toBe(true);
    const block = view.state.selection as CellBlockSelection;
    expect(block.$headCell.pos).toBe(pos(doc, 't-2-1'));
    expect(block.rect).toEqual({ top: 0, left: 1, bottom: 3, right: 2 });
    expect(block.cellPositions()).toEqual([pos(doc, 't-0-1'), pos(doc, 't-2-1')]);
  });

  it('the head back on the anchor cell gives a caret there; at the table edge the key is not handled', () => {
    const doc = docOf(table('t', grid4()));
    const block = CellBlockSelection.create(doc, pos(doc, 't-2-1'), pos(doc, 't-3-1'));
    const view = viewOf(select(stateOf(doc), block));
    const plugin = pluginOf(view.state);
    const key = (init: KeyboardEventInit) =>
      plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', init));
    // The table's last row: nothing below.
    expect(key({ key: 'ArrowDown', shiftKey: true })).toBe(false);
    expect(view.state.selection.eq(block)).toBe(true);
    expect(key({ key: 'ArrowUp', shiftKey: true })).toBe(true);
    const selection = view.state.selection;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection.empty).toBe(true);
    // At the end of the anchor cell, the side the head came from.
    expect(selection.head).toBe(pos(doc, 't-2-1') + 1 + 4);
  });

  it('plain ArrowUp and ArrowDown are not handled', () => {
    const doc = docOf(table('t', grid4()));
    const block = CellBlockSelection.create(doc, pos(doc, 't-1-1'), pos(doc, 't-2-1'));
    const view = viewOf(select(stateOf(doc), block));
    const plugin = pluginOf(view.state);
    view.endOfTextblock = () => true;
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(
        plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', { key })),
      ).toBe(false);
    }
  });

  it('Enter with a block leaves the document unchanged (the keymap finds the top-left cell)', () => {
    const doc = docOf(p('before', 'p1'), table('t', grid4()));
    const state = createBodyEditorState(doc, { getNbspChar: () => '\u00b0' });
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1'));
    const view = viewOf(select(state, block));
    const before = view.state.doc;
    const handled = view.someProp('handleKeyDown', (f) =>
      f(view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );
    expect(handled).toBe(true);
    expect(view.state.doc).toBe(before);
  });

  it('the Body editor state installs the plugin right after history()', () => {
    const state = createBodyEditorState(docOf(p('x', 'p1')), { getNbspChar: () => '\u00b0' });
    expect(state.plugins[1]).toBe(tableEditingKey.get(state));
  });

  describe('normalisation (U10; data-model §5.2)', () => {
    function normalised(state: EditorState, selection: Selection) {
      const { state: next, transactions } = state.applyTransaction(
        state.tr.setSelection(selection),
      );
      expect(next.doc).toBe(state.doc);
      for (const tr of transactions.slice(1)) expect(tr.steps).toHaveLength(0);
      return { selection: next.selection, appended: transactions.length - 1 };
    }

    it('a text selection across two cells of one table becomes their block', () => {
      const doc = docOf(table('t', grid4()));
      const { selection, appended } = normalised(
        stateOf(doc),
        TextSelection.create(doc, pos(doc, 't-0-0') + 2, pos(doc, 't-2-1') + 3),
      );
      expect(appended).toBe(1);
      expect(selection).toBeInstanceOf(CellBlockSelection);
      expect((selection as CellBlockSelection).$anchorCell.pos).toBe(pos(doc, 't-0-0'));
      expect((selection as CellBlockSelection).$headCell.pos).toBe(pos(doc, 't-2-1'));
    });

    it('a selected td or th becomes a text selection over its content', () => {
      const doc = docOf(
        table('t', [
          [{ kind: 'th' }, {}],
          [{}, {}],
        ]),
      );
      for (const id of ['t-0-0', 't-0-1']) {
        const at = pos(doc, id);
        const { selection } = normalised(stateOf(doc), NodeSelection.create(doc, at));
        expect(selection).toBeInstanceOf(TextSelection);
        expect([selection.from, selection.to]).toEqual([at + 1, at + 5]);
      }
    });

    it('a selected tr becomes the block over its cells, or its one cell content', () => {
      const doc = docOf(table('t', [[{}, {}, {}], [{ colspan: 3 }]]));
      const row = normalised(stateOf(doc), NodeSelection.create(doc, pos(doc, 't-r0'))).selection;
      expect(row).toBeInstanceOf(CellBlockSelection);
      expect((row as CellBlockSelection).$anchorCell.pos).toBe(pos(doc, 't-0-0'));
      expect((row as CellBlockSelection).$headCell.pos).toBe(pos(doc, 't-0-2'));
      expect((row as CellBlockSelection).rect).toEqual({ top: 0, left: 0, bottom: 1, right: 3 });
      const single = normalised(
        stateOf(doc),
        NodeSelection.create(doc, pos(doc, 't-r1')),
      ).selection;
      expect(single).toBeInstanceOf(TextSelection);
      expect([single.from, single.to]).toEqual([pos(doc, 't-1-0') + 1, pos(doc, 't-1-0') + 5]);
    });

    it('a selected row without cells gives the nearest text selection', () => {
      const empty = N.tr!.create({ nodeId: 'empty' }, []);
      const base = table('t', [[{}, {}]]);
      const tableNode = N.table!.create(base.attrs, [base.child(0), empty]);
      const doc = docOf(p('x', 'p1'), tableNode, p('y', 'p2'));
      const { selection } = normalised(stateOf(doc), NodeSelection.create(doc, pos(doc, 'empty')));
      expect(selection).toBeInstanceOf(TextSelection);
    });

    it('on a too-large table: a row gives a caret in its first cell, two cells stay a text selection', () => {
      const wide: CellSpec[] = Array.from({ length: 4195 }, () => ({ colspan: 1000, text: 'w' }));
      const doc = docOf(table('t', [wide]));
      expect(gridOfNode(doc.nodeAt(pos(doc, 't'))!).tooLarge).toBe(true);
      const row = normalised(stateOf(doc), NodeSelection.create(doc, pos(doc, 't-r0'))).selection;
      expect(row).toBeInstanceOf(TextSelection);
      expect(row.empty).toBe(true);
      expect(row.head).toBe(pos(doc, 't-0-0') + 1);
      const text = TextSelection.create(doc, pos(doc, 't-0-0') + 1, pos(doc, 't-0-3') + 1);
      const kept = normalised(stateOf(doc), text);
      expect(kept.appended).toBe(0);
      expect(kept.selection).toBeInstanceOf(TextSelection);
    });

    it('a selection from a cell into a paragraph stays a text selection', () => {
      const doc = docOf(table('t', grid4()), p('after', 'p1'));
      const { selection, appended } = normalised(
        stateOf(doc),
        TextSelection.create(doc, pos(doc, 't-3-3') + 2, pos(doc, 'p1') + 3),
      );
      expect(appended).toBe(0);
      expect(selection).toBeInstanceOf(TextSelection);
    });
  });

  it('decorates exactly the cells of the block', () => {
    const doc = docOf(table('t', grid4()));
    const view = viewOf(stateOf(doc));
    expect(view.dom.querySelectorAll('.mfbe-cell-selected')).toHaveLength(0);
    view.dispatch(
      view.state.tr.setSelection(
        CellBlockSelection.create(doc, pos(doc, 't-1-2'), pos(doc, 't-2-1')),
      ),
    );
    const marked = [...view.dom.querySelectorAll('.mfbe-cell-selected')].map((cell) =>
      cell.getAttribute('data-node-id'),
    );
    expect(marked).toEqual(['t-1-1', 't-1-2', 't-2-1', 't-2-2']);
    view.dispatch(view.state.tr.setSelection(caret(view.state.doc, 't-0-0')));
    expect(view.dom.querySelectorAll('.mfbe-cell-selected')).toHaveLength(0);
  });

  it('has no paste props: the clipboard plugin routes every paste (C4)', () => {
    const plugin = tableEditingPlugin();
    expect(plugin.props.handlePaste).toBeUndefined();
    expect(plugin.props.transformPasted).toBeUndefined();
    expect(plugin.props.clipboardTextParser).toBeUndefined();
    expect(plugin.props.handleDOMEvents?.paste).toBeUndefined();
  });
});

describe('US4: clearing and typing over a block (data-model §4.6, §5.3, §5.4)', () => {
  /** The 4 × 4 table `t` (one id on r0c0) between two paragraphs, a block from `a` to `h`. */
  function blockState(anchor = 't-0-0', head = 't-1-1', plugins?: Plugin[]): EditorState {
    const rows = grid4();
    (rows[0] as CellSpec[])[0] = { id: 'tid' };
    const doc = docOf(p('before', 'p1'), table('t', rows), p('after', 'p2'));
    const state = plugins
      ? stateOf(doc, plugins)
      : createBodyEditorState(doc, { getNbspChar: () => '\u00b0' });
    return select(state, CellBlockSelection.create(doc, pos(doc, anchor), pos(doc, head)));
  }

  /** The texts of table `t`, row by row. */
  function texts(doc: PMNode): string[][] {
    const tableNode = doc.nodeAt(pos(doc, 't'))!;
    const out: string[][] = [];
    tableNode.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cell.textContent));
      out.push(cells);
    });
    return out;
  }

  /** The node ids and FB2 ids of every row and cell of table `t`. */
  function skeleton(doc: PMNode): string[] {
    const tableNode = doc.nodeAt(pos(doc, 't'))!;
    const out: string[] = [];
    tableNode.forEach((row) => {
      out.push(String(row.attrs.nodeId));
      row.forEach((cell) => out.push(`${String(cell.attrs.nodeId)}#${String(cell.attrs.id)}`));
    });
    return out;
  }

  const CLEARED = [
    ['', '', 'r0c2', 'r0c3'],
    ['', '', 'r1c2', 'r1c3'],
    ['r2c0', 'r2c1', 'r2c2', 'r2c3'],
    ['r3c0', 'r3c1', 'r3c2', 'r3c3'],
  ];

  it('tr.deleteSelection() clears the cells through the clear-block plan, keeps every row and cell and the block, with DISCRETE_STEP', () => {
    const state = blockState();
    const tr = state.tr.deleteSelection();
    expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
    expect(texts(tr.doc)).toEqual(CLEARED);
    expect(skeleton(tr.doc)).toEqual(skeleton(state.doc));
    const after = state.apply(tr);
    expect(after.selection).toBeInstanceOf(CellBlockSelection);
    // The same anchor and head cells (the commit's focus keeps them by node id).
    const cells = (selection: CellBlockSelection) => [
      selection.$anchorCell.nodeAfter!.attrs.nodeId,
      selection.$headCell.nodeAfter!.attrs.nodeId,
    ];
    expect(cells(after.selection as CellBlockSelection)).toEqual(
      cells(state.selection as CellBlockSelection),
    );
    expect((after.selection as CellBlockSelection).rect).toEqual({
      top: 0,
      left: 0,
      bottom: 2,
      right: 2,
    });
  });

  it('replaceSelectionWith(text) and insertText clear the block and put the text at the start of its top-left cell, the caret after it', () => {
    for (const run of [
      (tr: Transaction) => tr.replaceSelectionWith(fb2Schema.text('x')),
      (tr: Transaction) => tr.insertText('x'),
    ]) {
      // The head in the top-left corner's opposite: the text still goes to the top-left cell.
      const state = blockState('t-1-1', 't-0-0');
      const tr = run(state.tr);
      const expected = CLEARED.map((row) => [...row]);
      expected[0]![0] = 'x';
      expect(texts(tr.doc)).toEqual(expected);
      expect(skeleton(tr.doc)).toEqual(skeleton(state.doc));
      expect(tr.selection.empty).toBe(true);
      expect(tr.selection.head).toBe(pos(tr.doc, 't-0-0') + 2);
    }
  });

  it('the top-left cell is the owner of the rectangle’s top-left position, else the first cell of the block in reading order', () => {
    // [a] / [b, c]: (0, 1) is a hole; the rectangle rows 1-2 × column 2 holds c only.
    const doc = docOf(table('t', [[{}], [{}, {}]]));
    const tablePos = pos(doc, 't');
    expect(blockTopLeftCellPos(doc, tablePos, { top: 0, left: 1, bottom: 2, right: 2 })).toBe(
      pos(doc, 't-1-1'),
    );
    expect(blockTopLeftCellPos(doc, tablePos, { top: 0, left: 0, bottom: 2, right: 2 })).toBe(
      pos(doc, 't-0-0'),
    );
  });

  it('replaceSelection of a two-paragraph slice puts it into the top-left cell as one inline run; no row changes', () => {
    const state = blockState();
    const slice = new Slice(Fragment.from([p('one', 'x1'), p('two', 'x2')]), 1, 1);
    const tr = state.tr.replaceSelection(slice);
    const expected = CLEARED.map((row) => [...row]);
    expected[0]![0] = 'one two';
    expect(texts(tr.doc)).toEqual(expected);
    expect(skeleton(tr.doc)).toEqual(skeleton(state.doc));
    expect(tr.selection.head).toBe(pos(tr.doc, 't-0-0') + 1 + 'one two'.length);
  });

  it('replaceWith of a block node only clears the block', () => {
    const state = blockState();
    const tr = state.tr.replaceSelectionWith(N.p!.create(null, fb2Schema.text('para')));
    expect(texts(tr.doc)).toEqual(CLEARED);
    expect(tr.doc.child(0).child(0).childCount).toBe(3);
    expect(tr.selection).toBeInstanceOf(CellBlockSelection);
  });

  it('Delete and Backspace (also with Ctrl) clear the block through the plugin and return true; a caret is left to the keymap', () => {
    for (const init of [
      { key: 'Delete' },
      { key: 'Backspace' },
      { key: 'Delete', ctrlKey: true },
      { key: 'Backspace', ctrlKey: true },
    ]) {
      const view = viewOf(blockState());
      const plugin = pluginOf(view.state);
      expect(
        plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', init)),
        JSON.stringify(init),
      ).toBe(true);
      expect(texts(view.state.doc)).toEqual(CLEARED);
      expect(view.state.selection).toBeInstanceOf(CellBlockSelection);
    }
    const base = blockState();
    const view = viewOf(select(base, caret(base.doc, 't-0-0', 2)));
    const plugin = pluginOf(view.state);
    expect(
      plugin.props.handleKeyDown!.call(
        plugin,
        view,
        new KeyboardEvent('keydown', { key: 'Delete' }),
      ),
    ).toBe(false);
  });

  it('Delete on a block of empty cells dispatches nothing', () => {
    const doc = docOf(
      table('t', [
        [{ text: '' }, { text: '' }],
        [{}, {}],
      ]),
    );
    const state = select(
      createBodyEditorState(doc, { getNbspChar: () => '\u00b0' }),
      CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-0-1')),
    );
    const seen: unknown[] = [];
    const view = viewOf(state);
    view.setProps({
      dispatchTransaction: (tr) => {
        seen.push(tr);
        view.updateState(view.state.apply(tr));
      },
    });
    const plugin = pluginOf(view.state);
    expect(
      plugin.props.handleKeyDown!.call(
        plugin,
        view,
        new KeyboardEvent('keydown', { key: 'Delete' }),
      ),
    ).toBe(true);
    expect(seen).toEqual([]);
  });

  it('handleTextInput with a block dispatches one transaction - the clear, the text, a caret after it, DISCRETE_STEP - before the overtype plugin', () => {
    const doc = docOf(p('before', 'p1'), table('t', grid4()), p('after', 'p2'));
    const state = select(
      createBodyEditorState(doc, { getNbspChar: () => '\u00b0', isOvertype: () => true }),
      CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1')),
    );
    const seen: Transaction[] = [];
    const view = viewOf(state);
    view.setProps({
      dispatchTransaction: (tr) => {
        seen.push(tr);
        view.updateState(view.state.apply(tr));
      },
    });
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) =>
      f(view, from, to, 'x', () => view.state.tr),
    );
    expect(handled).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    expect(texts(view.state.doc)[0]![0]).toBe('x');
    expect(texts(view.state.doc)[1]![1]).toBe('');
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.head).toBe(pos(view.state.doc, 't-0-0') + 2);
    // Without a block the plugin leaves the text to the others.
    const plugin = pluginOf(view.state);
    expect(
      plugin.props.handleTextInput!.call(plugin, view, from, from, 'y', () => view.state.tr),
    ).toBe(false);
  });

  describe('a composition over a block (U39): one undo step, the block given back', () => {
    // Its changes scroll to the caret, which then stands in the editor: layout APIs jsdom
    // lacks.
    beforeAll(() => {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
      });
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      });
    });
    afterAll(() => {
      delete (Range.prototype as Partial<Range>).getClientRects;
      delete (Range.prototype as Partial<Range>).getBoundingClientRect;
      document.getSelection()?.removeAllRanges();
    });

    /** A view of a block from t-0-0 to t-1-1 in a state with every Body plugin. */
    function composeView(): EditorView {
      return viewOf(blockState());
    }

    /** `compositionstart` and `compositionend` as the browser fires them on the editor. */
    function fire(view: EditorView, type: 'compositionstart' | 'compositionend'): void {
      view.dom.dispatchEvent(new Event(type, { bubbles: true }));
    }

    /**
     * A change of the composition read as text, as ProseMirror's DOM reader passes it on: to
     * `handleTextInput`, with its own transaction (marked with the composition id) as `deflt`,
     * which it dispatches when no plugin handles the text.
     */
    function typed(view: EditorView, from: number, to: number, text: string): void {
      const deflt = () => view.state.tr.insertText(text, from, to).setMeta('composition', 7);
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, text, deflt));
      if (!handled) view.dispatch(deflt());
    }

    const corner = (view: EditorView) => pos(view.state.doc, 't-0-0');
    const endStep = () => new Promise((resolve) => setTimeout(resolve, 30));

    it('compositionstart selects the top-left cell’s content, its bookmark the block, and returns false; nothing for a caret', () => {
      const view = composeView();
      const block = view.state.selection;
      const before = view.state.doc;
      const seen: Transaction[] = [];
      view.setProps({
        dispatchTransaction: (tr) => {
          seen.push(tr);
          view.updateState(view.state.apply(tr));
        },
      });
      fire(view, 'compositionstart');
      expect(seen).toHaveLength(1);
      // No document change under a starting composition.
      expect(view.state.doc).toBe(before);
      const selection = view.state.selection;
      expect(selection).toBeInstanceOf(ComposeOverSelection);
      expect(selection).toBeInstanceOf(TextSelection);
      expect([selection.from, selection.to]).toEqual([corner(view) + 1, corner(view) + 5]);
      expect(selection.getBookmark().resolve(view.state.doc).eq(block)).toBe(true);
      expect(view.composing).toBe(true);
      // The handler does nothing for a caret.
      const base = blockState();
      const caretView = viewOf(select(base, caret(base.doc, 't-0-0', 2)));
      const plugin = pluginOf(caretView.state);
      const start = plugin.props.handleDOMEvents!.compositionstart!;
      const state = caretView.state;
      expect(start.call(plugin, caretView, new Event('compositionstart') as CompositionEvent)).toBe(
        false,
      );
      expect(caretView.state).toBe(state);
    });

    it('its first change read as text clears the other cells in the same transaction; later changes join that undo step, the end step closes it; one Undo gives back the contents and the block', async () => {
      const view = composeView();
      const at = corner(view) + 1;
      // A change typed into the top-left cell a moment before: the composition does not join
      // its undo step (compositionstart closes the group).
      view.dispatch(view.state.tr.insert(at + 4, fb2Schema.text('Z')));
      expect(undoDepth(view.state)).toBe(1);
      const block = view.state.selection;
      expect(block).toBeInstanceOf(CellBlockSelection);
      const original = texts(view.state.doc);
      fire(view, 'compositionstart');
      const seen: Transaction[] = [];
      view.setProps({
        dispatchTransaction: (tr) => {
          seen.push(tr);
          view.updateState(view.state.apply(tr));
        },
      });
      typed(view, at, at + 5, 'に');
      // One transaction: the composition's change and the clear, with the composition id and
      // without DISCRETE_STEP; no appended transaction changes the table (data-model §4.4).
      expect(seen).toHaveLength(1);
      expect(seen[0]!.getMeta('composition')).toBe(7);
      expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(false);
      const expected = CLEARED.map((row) => [...row]);
      expected[0]![0] = 'に';
      expect(texts(view.state.doc)).toEqual(expected);
      expect(view.state.selection.head).toBe(at + 1);
      expect(undoDepth(view.state)).toBe(2);
      // Later changes of the composition join its undo step.
      typed(view, at, at + 1, '日本');
      expected[0]![0] = '日本';
      expect(texts(view.state.doc)).toEqual(expected);
      expect(undoDepth(view.state)).toBe(2);
      // The end step closes it: the next character is a step of its own.
      fire(view, 'compositionend');
      await endStep();
      view.dispatch(view.state.tr.insertText('x', at + 2));
      expect(undoDepth(view.state)).toBe(3);
      let state = view.state;
      expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true);
      expect(texts(state.doc)).toEqual(expected);
      expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true);
      expect(texts(state.doc)).toEqual(original);
      expect(state.selection).toBeInstanceOf(CellBlockSelection);
      expect(state.selection.eq(block)).toBe(true);
    });

    it('a composition whose changes are read otherwise is cleared by the end step, in its undo step; a composition that changed nothing gives the block back', async () => {
      const view = composeView();
      const block = view.state.selection;
      const original = texts(view.state.doc);
      fire(view, 'compositionstart');
      const at = corner(view) + 1;
      // Not read as text (a first text that repeats the cell's start reads as a deletion).
      view.dispatch(view.state.tr.delete(at + 1, at + 4).setMeta('composition', 7));
      expect(texts(view.state.doc)[0]).toEqual(['r', 'r0c1', 'r0c2', 'r0c3']);
      fire(view, 'compositionend');
      await endStep();
      const expected = CLEARED.map((row) => [...row]);
      expected[0]![0] = 'r';
      expect(texts(view.state.doc)).toEqual(expected);
      expect(undoDepth(view.state)).toBe(1);
      let state = view.state;
      expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true);
      expect(texts(state.doc)).toEqual(original);
      expect(state.selection.eq(block)).toBe(true);

      // Nothing composed: the block again, no step.
      const idle = composeView();
      const idleBlock = idle.state.selection;
      fire(idle, 'compositionstart');
      expect(idle.state.selection).toBeInstanceOf(ComposeOverSelection);
      fire(idle, 'compositionend');
      await endStep();
      expect(idle.state.selection.eq(idleBlock)).toBe(true);
      expect(undoDepth(idle.state)).toBe(0);
    });

    it('a key after the composition, before its end step ran, runs it first', () => {
      const view = composeView();
      fire(view, 'compositionstart');
      const at = corner(view) + 1;
      typed(view, at, at + 4, 'é');
      fire(view, 'compositionend');
      const plugin = pluginOf(view.state);
      plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', { key: 'x' }));
      // The step closed: the next change is an undo step of its own.
      view.dispatch(view.state.tr.insertText('x', at + 1));
      expect(undoDepth(view.state)).toBe(2);
    });

    it('its first change puts the DOM caret back at the top-left cell’s text, which Chromium leaves in the head cell', () => {
      const view = composeView();
      fire(view, 'compositionstart');
      const headText = view.nodeDOM(pos(view.state.doc, 't-1-1'))!.firstChild!;
      document.getSelection()!.collapse(headText, 2);
      const at = corner(view) + 1;
      typed(view, at, at + 4, 'é');
      const focus = document.getSelection()!.focusNode;
      expect(view.nodeDOM(corner(view))!.contains(focus)).toBe(true);
    });
  });

  it('an Undo through history() after a clear gives back the contents and the block', () => {
    let state = blockState('t-0-0', 't-1-1', [history(), tableEditingPlugin()]);
    const block = state.selection;
    state = state.apply(state.tr.deleteSelection());
    expect(texts(state.doc)).toEqual(CLEARED);
    let undone: EditorState | null = null;
    expect(
      undo(state, (tr) => {
        undone = state.apply(tr);
      }),
    ).toBe(true);
    expect(texts(undone!.doc)[0]).toEqual(['r0c0', 'r0c1', 'r0c2', 'r0c3']);
    expect(undone!.selection).toBeInstanceOf(CellBlockSelection);
    expect(undone!.selection.eq(block)).toBe(true);
  });
});

describe('US9 selected table (data-model §4.5 table.select, table.delete; C24; vR2 X3)', () => {
  /** A body whose first section holds only the 2 × 2 table `t`, and a second section. */
  function onlyTableDoc(): PMNode {
    return N.doc!.create(
      null,
      N.body!.create({ nodeId: 'b' }, [
        N.section!.create({ nodeId: 's1' }, [
          table('t', [
            [{}, {}],
            [{}, {}],
          ]),
        ]),
        N.section!.create({ nodeId: 's2' }, [p('after', 'p2')]),
      ]),
    );
  }

  /** A view of `onlyTableDoc` with every Body plugin, `selection` set, and its transactions. */
  function bodyView(selection: (doc: PMNode) => Selection): {
    view: EditorView;
    seen: Transaction[];
  } {
    const doc = onlyTableDoc();
    const state = select(
      createBodyEditorState(doc, { getNbspChar: () => '\u00b0' }),
      selection(doc),
    );
    const view = viewOf(state);
    const seen: Transaction[] = [];
    view.setProps({
      dispatchTransaction: (tr) => {
        seen.push(tr);
        view.updateState(view.state.apply(tr));
      },
    });
    return { view, seen };
  }

  const wholeTable = (doc: PMNode) => NodeSelection.create(doc, pos(doc, 't'));

  /** The first section after the step: its one empty paragraph, holding the caret. */
  function expectEmptyParagraph(view: EditorView, text = ''): void {
    const section = view.state.doc.child(0).child(0);
    expect(section.childCount).toBe(1);
    const paragraph = section.child(0);
    expect(paragraph.type.name).toBe('p');
    expect(paragraph.textContent).toBe(text);
    expect(typeof paragraph.attrs.nodeId).toBe('string');
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.$head.parent).toBe(paragraph);
    expect(view.state.selection.$head.parentOffset).toBe(text.length);
  }

  it('ProseMirror’s own deleteSelection never leaves the empty paragraph a section’s only table needs: it throws or takes the whole section (vR2 X3)', () => {
    const titled = N.doc!.create(
      null,
      N.body!.create({ nodeId: 'b' }, [
        N.section!.create({ nodeId: 's1' }, [
          N.title!.create({ nodeId: 'h' }, [p('Head', 'h1')]),
          table('t', [[{}, {}]]),
        ]),
        N.section!.create({ nodeId: 's2' }, [p('after', 'p2')]),
      ]),
    );
    for (const doc of [onlyTableDoc(), titled]) {
      const attempt = (): PMNode | null => {
        try {
          return EditorState.create({ doc, selection: wholeTable(doc) }).tr.deleteSelection().doc;
        } catch {
          return null;
        }
      };
      const result = attempt();
      if (result) expect(findNodeById(result, 's1')).toBeNull();
    }
  });

  it('Delete and Backspace, also with Mod, run the Delete table transform through the table plugin and return true; Shift+Delete stays the platform’s Cut', () => {
    for (const init of [
      { key: 'Delete' },
      { key: 'Backspace' },
      { key: 'Delete', ctrlKey: true },
      { key: 'Backspace', metaKey: true },
    ]) {
      const { view, seen } = bodyView(wholeTable);
      const plugin = pluginOf(view.state);
      expect(
        plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', init)),
        JSON.stringify(init),
      ).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(true);
      expectEmptyParagraph(view);
    }
    const { view, seen } = bodyView(wholeTable);
    const plugin = pluginOf(view.state);
    expect(
      plugin.props.handleKeyDown!.call(
        plugin,
        view,
        new KeyboardEvent('keydown', { key: 'Delete', shiftKey: true }),
      ),
    ).toBe(false);
    expect(seen).toEqual([]);
  });

  it('text input replaces the table with a paragraph holding the text, the caret after it, in one DISCRETE_STEP transaction', () => {
    const { view, seen } = bodyView(wholeTable);
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) =>
      f(view, from, to, 'x', () => view.state.tr.insertText('x')),
    );
    expect(handled).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    expectEmptyParagraph(view, 'x');
  });

  it('compositionstart replaces the table with an empty paragraph holding the caret, with DISCRETE_STEP, and returns false', () => {
    const { view, seen } = bodyView(wholeTable);
    const plugin = pluginOf(view.state);
    const result = plugin.props.handleDOMEvents!.compositionstart!.call(
      plugin,
      view,
      new Event('compositionstart') as CompositionEvent,
    );
    expect(result).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(true);
    expectEmptyParagraph(view);
  });

  it('every other selection makes these handlers return false at once', () => {
    const others: ((doc: PMNode) => Selection)[] = [
      (doc) => caret(doc, 't-0-0', 1),
      (doc) => caret(doc, 'p2', 2),
      (doc) => TextSelection.create(doc, pos(doc, 'p2') + 1, pos(doc, 'p2') + 3),
    ];
    for (const selection of others) {
      const { view, seen } = bodyView(selection);
      const plugin = pluginOf(view.state);
      for (const key of ['Delete', 'Backspace']) {
        expect(
          plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', { key })),
        ).toBe(false);
      }
      const { from, to } = view.state.selection;
      expect(
        plugin.props.handleTextInput!.call(plugin, view, from, to, 'x', () => view.state.tr),
      ).toBe(false);
      expect(
        plugin.props.handleDOMEvents!.compositionstart!.call(
          plugin,
          view,
          new Event('compositionstart') as CompositionEvent,
        ),
      ).toBe(false);
      expect(seen).toEqual([]);
    }
  });
});
