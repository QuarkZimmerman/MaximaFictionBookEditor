/**
 * The paste router of the Body view (feature 006, T090; FR-004 for pastes, FR-011, FR-012,
 * FR-046; C4, C43, C47; I7, I14; U30; decision 4; data-model §8.1 to §8.4, §8.7;
 * resource-formats.md §20 and its Tests; quickstart §4 and §13 "vitest: the clipboard router";
 * research R5.1, R5.6 to R5.8, R5.12): states from `createBodyEditorState` (every Body plugin)
 * with `ClipboardOptions` holding a fixed `bookIds()` set, a counting `nextNodeId()` (`p1`,
 * `p2`, …) and a recording `message(key)`; the routing through `pasteTransaction(state, input,
 * opts)`; the entry points - `handleDOMEvents.paste`, `handlePaste`, `pasteData` - and the copy
 * and cut handlers on a jsdom `EditorView`.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Plugin,
  type Selection,
  type Transaction,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  classifyOwnSlice,
  dedupeIds,
  isOwnHtml,
  pasteTransaction,
  stampNodeIds,
  type ClipboardOptions,
  type PasteInput,
} from '@/editor/clipboard/route';
import { DISCRETE_STEP } from '@/editor/commands/util';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import {
  MFBE_CLIPBOARD_MIME,
  clipboardPluginKey,
  insertSlice,
  pasteData,
  payloadFromSlice,
  sliceFromPayload,
} from '@/editor/plugins/clipboard';
import { NBSP } from '@/editor/plugins/nbsp';
import { fb2Schema } from '@/editor/schema';
import { gridOfNode } from '@/editor/table/grid';
import { CellBlockSelection } from '@/editor/table/selection';
import { createBodyEditorState } from '@/views/body/bodyEditor';

import { docOf, nodeOf, p, plainRows, pos, table, type CellSpec } from '../table/helpers';

const N = fb2Schema.nodes;

/* ------------------------------------------------------------------------ */
/* States, options and pastes                                               */
/* ------------------------------------------------------------------------ */

interface Options {
  opts: ClipboardOptions;
  messages: string[];
}

/** A fixed `bookIds()` set, node ids `p1`, `p2`, … and a recording `message`. */
function options(bookIds: readonly string[] = []): Options {
  const messages: string[] = [];
  let counter = 0;
  return {
    messages,
    opts: {
      bookIds: () => new Set(bookIds),
      nextNodeId: () => `p${(counter += 1)}`,
      message: (key) => {
        messages.push(key);
      },
    },
  };
}

function stateOf(doc: PMNode, opts?: ClipboardOptions, nbspChar = '\u00b7'): EditorState {
  return createBodyEditorState(doc, { getNbspChar: () => nbspChar, clipboard: opts });
}

function withSelection(state: EditorState, selection: (doc: PMNode) => Selection): EditorState {
  return state.apply(state.tr.setSelection(selection(state.doc)));
}

const caret =
  (nodeId: string, offset = 0) =>
  (doc: PMNode) =>
    TextSelection.create(doc, pos(doc, nodeId) + 1 + offset);

const block = (anchor: string, head: string) => (doc: PMNode) =>
  CellBlockSelection.create(doc, pos(doc, anchor), pos(doc, head));

interface Pasted {
  tr: Transaction;
  state: EditorState;
  /** Transactions the plugins appended. */
  appended: Transaction[];
}

/** Routes `input` on `state`: the one transaction, applied, its document checked. */
function paste(state: EditorState, input: PasteInput, opts: ClipboardOptions): Pasted {
  const tr = pasteTransaction(state, input, opts);
  if (!tr) throw new Error('the paste was refused');
  const { state: next, transactions } = state.applyTransaction(tr);
  next.doc.check();
  return { tr, state: next, appended: transactions.slice(1) };
}

/** A closed slice of one node. */
function closed(node: PMNode): Slice {
  return new Slice(Fragment.from(node), 0, 0);
}

/** The own slice a block of `rows` copies: `content()` of the block from its first to last cell. */
function blockSlice(rows: (CellSpec[] | 'raw')[], prefix = 'clip'): Slice {
  const source = table(prefix, rows);
  const doc = docOf(source);
  const grid = gridOfNode(source);
  const last = grid.cells.length - 1;
  const lastCell = grid.cells[last]!;
  return CellBlockSelection.create(
    doc,
    pos(doc, `${prefix}-0-0`),
    pos(doc, `${prefix}-${lastCell.row}-${lastCell.index}`),
  ).content();
}

/** The section's children as `type:text`, a table as `table:<rows>x<columns>`. */
function shape(container: PMNode): string[] {
  const out: string[] = [];
  container.forEach((child) => {
    if (child.type.name === 'table') {
      const grid = gridOfNode(child);
      out.push(`table:${grid.height}x${grid.width}`);
    } else out.push(`${child.type.name}:${child.textContent}`);
  });
  return out;
}

function sectionOf(doc: PMNode, index = 0): PMNode {
  return doc.child(0).child(index);
}

/** The texts of a table's cells, row by row. */
function cellTexts(node: PMNode): string[][] {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

function tableIn(doc: PMNode, nodeId: string): PMNode {
  return nodeOf(doc, nodeId);
}

/** Every `nodeId` of a document. */
function nodeIds(doc: PMNode): string[] {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (typeof node.attrs.nodeId === 'string') ids.push(node.attrs.nodeId);
    return true;
  });
  return ids;
}

/** The 3 × 3 target table `t` between two paragraphs. */
function target(): PMNode {
  return docOf(p('before', 'a1'), table('t', plainRows(3, 3)), p('after', 'a2'));
}

/** The 2 × 2 block `x`, its first cell with the id `xid`. */
const BLOCK: CellSpec[][] = [
  [{ text: 'a', id: 'xid' }, { text: 'b' }],
  [{ text: 'c' }, { text: 'd' }],
];

/* ------------------------------------------------------------------------ */
/* Views                                                                    */
/* ------------------------------------------------------------------------ */

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

function viewOf(state: EditorState, editable = true): { view: EditorView; seen: Transaction[] } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const seen: Transaction[] = [];
  const view: EditorView = new EditorView(host, {
    state,
    editable: () => editable,
    nodeViews: createTableNodeViews(),
    dispatchTransaction(tr) {
      seen.push(tr);
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return { view, seen };
}

function pluginOf(state: EditorState): Plugin {
  return clipboardPluginKey.get(state)!;
}

/** A paste or copy event whose clipboard data is the map `data`. */
function clipboardEvent(type: string, data: Record<string, string> = {}) {
  const store = { ...data };
  const event = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => store[format] ?? '',
      setData: (format: string, value: string) => {
        store[format] = value;
      },
      clearData: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      get types() {
        return Object.keys(store);
      },
    },
  });
  return { event: event as ClipboardEvent, store };
}

/* ------------------------------------------------------------------------ */
/* Classification (C43)                                                     */
/* ------------------------------------------------------------------------ */

describe('classification of the editor’s own content (C43)', () => {
  it('a payload of another format or version is not own; version 1 is', () => {
    const slice = closed(table('t', plainRows(1, 2)));
    const payload = payloadFromSlice(slice);
    expect(sliceFromPayload(JSON.stringify(payload))).not.toBeNull();
    expect(sliceFromPayload(JSON.stringify({ ...payload, version: 2 }))).toBeNull();
    expect(sliceFromPayload(JSON.stringify({ ...payload, format: 'other' }))).toBeNull();
    expect(sliceFromPayload('{')).toBeNull();
  });

  it('own HTML is known by a fb- class on the slice root, never by data-pm-slice alone', () => {
    const { view } = viewOf(stateOf(target()));
    const html = (slice: Slice) => view.serializeForClipboard(slice).dom.innerHTML;
    // A block's content: the closed table carries data-pm-slice and its fb-table class.
    expect(isOwnHtml(html(blockSlice(BLOCK)))).toBe(true);
    // A word inside one cell: ProseMirror wraps the cell in a bare table (`-3` wrappers); the
    // slice root under them is the editor's cell.
    const doc = view.state.doc;
    const word = view.state.apply(
      view.state.tr.setSelection(
        TextSelection.create(doc, pos(doc, 't-0-0') + 1, pos(doc, 't-0-0') + 3),
      ),
    ).selection;
    expect(word).toBeInstanceOf(TextSelection);
    expect(isOwnHtml(html(word.content()))).toBe(true);
    // Another ProseMirror editor: data-pm-slice without the editor's classes.
    expect(isOwnHtml('<p data-pm-slice="1 1 []">foreign</p>')).toBe(false);
    expect(isOwnHtml('<table data-pm-slice="0 0 []"><tr><td>x</td></tr></table>')).toBe(false);
    expect(isOwnHtml('<meta charset="utf-8"><p class="fb-p">own</p>')).toBe(true);
    expect(isOwnHtml('<p>plain</p>')).toBe(false);
  });

  it('a word copied inside one cell is inline; a block or a whole table is an own single table; a slice cut by a table edge is mixed', () => {
    const doc = docOf(p('before', 'a1'), table('t', plainRows(2, 2)), p('after', 'a2'));
    const inCell = TextSelection.create(doc, pos(doc, 't-0-0') + 1, pos(doc, 't-0-0') + 3);
    expect(inCell.content().openStart).toBeGreaterThan(2);
    const word = classifyOwnSlice(inCell.content());
    expect(word.kind).toBe('inline');
    expect(word.kind === 'inline' && word.slice.content.textBetween(0, word.slice.size)).toBe('r0');
    // A slice open 3 and 3 inside table > tr > td.
    const open = new Slice(
      Fragment.from(
        N.table!.create(null, N.tr!.create(null, N.td!.create(null, fb2Schema.text('w')))),
      ),
      3,
      3,
    );
    expect(classifyOwnSlice(open).kind).toBe('inline');
    const ownBlock = classifyOwnSlice(
      CellBlockSelection.create(doc, pos(doc, 't-0-0'), pos(doc, 't-1-1')).content(),
    );
    expect(ownBlock.kind).toBe('table');
    const whole = classifyOwnSlice(NodeSelection.create(doc, pos(doc, 't')).content());
    expect(whole.kind).toBe('table');
    // A paragraph and part of a table.
    const across = TextSelection.create(doc, pos(doc, 'a1') + 2, pos(doc, 't-0-1') + 2);
    expect(classifyOwnSlice(across.content()).kind).toBe('mixed');
    // Two paragraphs.
    const two = docOf(p('one', 'a1'), p('two', 'a2'));
    const paragraphs = TextSelection.create(two, pos(two, 'a1') + 1, pos(two, 'a2') + 4);
    expect(classifyOwnSlice(paragraphs.content()).kind).toBe('mixed');
  });
});

/* ------------------------------------------------------------------------ */
/* The routing table (data-model §8.3)                                      */
/* ------------------------------------------------------------------------ */

describe('the routing table of data-model §8.3', () => {
  it('an own single table with the caret in a cell: the paste-block plan, one discrete step, the block over T selected', () => {
    const { opts } = options();
    const state = withSelection(stateOf(target(), opts), caret('t-1-1'));
    const {
      tr,
      state: next,
      appended,
    } = paste(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts);
    expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
    expect(appended).toEqual([]);
    expect(cellTexts(tableIn(next.doc, 't'))).toEqual([
      ['r0c0', 'r0c1', 'r0c2'],
      ['r1c0', 'a', 'b'],
      ['r2c0', 'c', 'd'],
    ]);
    expect(next.selection).toBeInstanceOf(CellBlockSelection);
    expect((next.selection as CellBlockSelection).rect).toEqual({
      top: 1,
      left: 1,
      bottom: 3,
      right: 3,
    });
  });

  it('a table pasted over a block anchors at its top-left position (U30)', () => {
    const { opts } = options();
    const state = withSelection(stateOf(target(), opts), block('t-2-2', 't-1-1'));
    const { state: next } = paste(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts);
    expect(cellTexts(tableIn(next.doc, 't'))[1]).toEqual(['r1c0', 'a', 'b']);
  });

  it('elsewhere a table goes to the FR-004 point in every kind of text block', () => {
    const cases: {
      name: string;
      doc: () => PMNode;
      at: (doc: PMNode) => Selection;
      shape: string[];
    }[] = [
      {
        name: 'a paragraph’s start',
        doc: () => docOf(p('one', 'a1'), p('two', 'a2')),
        at: caret('a2', 0),
        shape: ['p:one', 'table:2x2', 'p:two'],
      },
      {
        name: 'a paragraph’s middle',
        doc: () => docOf(p('one', 'a1'), p('two', 'a2')),
        at: caret('a2', 1),
        shape: ['p:one', 'p:t', 'table:2x2', 'p:wo'],
      },
      {
        name: 'a paragraph’s end',
        doc: () => docOf(p('one', 'a1'), p('two', 'a2')),
        at: caret('a1', 3),
        shape: ['p:one', 'table:2x2', 'p:two'],
      },
      {
        name: 'an empty paragraph',
        doc: () => docOf(p('one', 'a1'), p('', 'a2')),
        at: caret('a2'),
        shape: ['p:one', 'table:2x2'],
      },
      {
        name: 'a subtitle',
        doc: () =>
          docOf(p('one', 'a1'), N.subtitle!.create({ nodeId: 's1' }, fb2Schema.text('sub'))),
        at: caret('s1', 3),
        shape: ['p:one', 'subtitle:sub', 'table:2x2'],
      },
      {
        name: 'a title',
        doc: () => docOf(N.title!.create({ nodeId: 'h' }, [p('Head', 'h1')]), p('one', 'a1')),
        at: caret('h1', 2),
        shape: ['title:Head', 'table:2x2', 'p:one'],
      },
      {
        name: 'a poem line',
        doc: () =>
          docOf(
            p('one', 'a1'),
            N.poem!.create({ nodeId: 'po' }, [
              N.stanza!.create({ nodeId: 'st' }, [
                N.v!.create({ nodeId: 'v1' }, fb2Schema.text('verse')),
              ]),
            ]),
            p('two', 'a2'),
          ),
        at: caret('v1', 2),
        shape: ['p:one', 'poem:verse', 'table:2x2', 'p:two'],
      },
      {
        name: 'a cite’s text-author line',
        doc: () =>
          docOf(
            N.cite!.create({ nodeId: 'ci' }, [
              p('quote', 'q1'),
              N.text_author!.create({ nodeId: 'ta' }, fb2Schema.text('me')),
            ]),
            p('two', 'a2'),
          ),
        at: caret('ta', 1),
        shape: ['cite:quoteme', 'table:2x2', 'p:two'],
      },
    ];
    for (const one of cases) {
      const { opts, messages } = options();
      const state = withSelection(stateOf(one.doc(), opts), one.at);
      const {
        tr,
        state: next,
        appended,
      } = paste(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts);
      expect(shape(sectionOf(next.doc)), one.name).toEqual(one.shape);
      expect(tr.getMeta(DISCRETE_STEP), one.name).toBe(true);
      expect(appended, one.name).toEqual([]);
      expect(messages, one.name).toEqual([]);
      // The caret in the new table's first cell.
      const cell = next.selection.$head.parent;
      expect(cell.type.name, one.name).toBe('td');
      expect(cell.textContent, one.name).toBe('a');
    }
  });

  it('refused in the title of a section that holds subsections, with tables.msg.pasteNoPlace and no transaction', () => {
    const doc = N.doc!.create(
      null,
      N.body!.create({ nodeId: 'b' }, [
        N.section!.create({ nodeId: 's' }, [
          N.title!.create({ nodeId: 'h' }, [p('Scenario tables', 'h1')]),
          N.section!.create({ nodeId: 's2' }, [p('inner', 'a1')]),
        ]),
      ]),
    );
    const { opts, messages } = options();
    const state = withSelection(stateOf(doc, opts), caret('h1', 3));
    expect(pasteTransaction(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts)).toBeNull();
    expect(messages).toEqual(['tables.msg.pasteNoPlace']);
    // Decision 4: a refused paste leaves the selection and the document as they were.
    const selected = withSelection(state, (d) =>
      TextSelection.create(d, pos(d, 'h1') + 1, pos(d, 'h1') + 4),
    );
    expect(pasteTransaction(selected, { kind: 'own', slice: blockSlice(BLOCK) }, opts)).toBeNull();
    expect(selected.doc.textContent).toContain('Scenario tables');
  });

  it('a too-large target gives tables.reason.too-large and no transaction', () => {
    const wide: CellSpec[] = Array.from({ length: 4195 }, () => ({ colspan: 1000, text: 'w' }));
    const doc = docOf(table('t', [wide]));
    expect(gridOfNode(nodeOf(doc, 't')).tooLarge).toBe(true);
    const { opts, messages } = options();
    const state = withSelection(stateOf(doc, opts), caret('t-0-0'));
    expect(pasteTransaction(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts)).toBeNull();
    expect(messages).toEqual(['tables.reason.too-large']);
  });

  it('inline content and one line of text go in inline, without DISCRETE_STEP; several lines join a cell with single spaces', () => {
    const { opts } = options();
    const state = withSelection(stateOf(target(), opts), caret('t-0-0', 4));
    const word = TextSelection.create(
      state.doc,
      pos(state.doc, 'a1') + 1,
      pos(state.doc, 'a1') + 4,
    );
    const inline = paste(state, { kind: 'own', slice: word.content() }, opts);
    expect(nodeOf(inline.state.doc, 't-0-0').textContent).toBe('r0c0bef');
    expect(inline.tr.getMeta(DISCRETE_STEP)).toBeUndefined();
    const line = paste(state, { kind: 'text', text: 'one line' }, opts);
    expect(nodeOf(line.state.doc, 't-0-0').textContent).toBe('r0c0one line');
    expect(line.tr.getMeta(DISCRETE_STEP)).toBeUndefined();
    const lines = paste(state, { kind: 'text', text: 'one\ntwo\n\nthree' }, opts);
    expect(nodeOf(lines.state.doc, 't-0-0').textContent).toBe('r0c0one two three');
    expect(lines.tr.getMeta(DISCRETE_STEP)).toBe(true);
    // The table is not split, no row changes.
    expect(cellTexts(tableIn(lines.state.doc, 't'))).toHaveLength(3);
    expect(lines.state.selection.$head.parentOffset).toBe('r0c0one two three'.length);
  });

  it('own mixed content and foreign HTML join a cell as one inline run (decision 5); a table never splits', () => {
    const two = docOf(p('one', 'b1'), p('two', 'b2'));
    const mixed = TextSelection.create(two, pos(two, 'b1') + 1, pos(two, 'b2') + 4).content();
    const { opts } = options();
    const state = withSelection(stateOf(target(), opts), caret('t-1-1', 4));
    const own = paste(state, { kind: 'own', slice: mixed }, opts);
    expect(nodeOf(own.state.doc, 't-1-1').textContent).toBe('r1c1one two');
    expect(own.tr.getMeta(DISCRETE_STEP)).toBe(true);
    const foreign = paste(
      state,
      { kind: 'foreign', html: '<p>one <b>bold</b></p><p></p><ul><li>two</li></ul>' },
      opts,
    );
    const joined = nodeOf(foreign.state.doc, 't-1-1');
    expect(joined.textContent).toBe('r1c1one bold two');
    let bold = '';
    joined.forEach((child) => {
      if (child.marks.some((mark) => mark.type.name === 'strong')) bold += child.text;
    });
    expect(bold).toBe('bold');
    expect(foreign.tr.getMeta(DISCRETE_STEP)).toBe(true);
    // A slice cut by a table edge gives its cells' inline content, joined the same way.
    const withTable = docOf(p('lead', 'c1'), table('m', plainRows(1, 2)));
    const across = TextSelection.create(
      withTable,
      pos(withTable, 'c1') + 1,
      pos(withTable, 'm-0-1') + 5,
    ).content();
    const cut = paste(state, { kind: 'own', slice: across }, opts);
    expect(nodeOf(cut.state.doc, 't-1-1').textContent).toBe('r1c1lead r0c0 r0c1');
    expect(shape(sectionOf(cut.state.doc))).toEqual(['p:before', 'table:3x3', 'p:after']);
  });

  it('non-table content over a block clears it and goes into its top-left cell, in one discrete step', () => {
    const { opts } = options();
    const state = withSelection(stateOf(target(), opts), block('t-1-2', 't-0-1'));
    const { tr, state: next } = paste(state, { kind: 'text', text: 'x\ny' }, opts);
    expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
    expect(cellTexts(tableIn(next.doc, 't'))).toEqual([
      ['r0c0', 'x y', ''],
      ['r1c0', '', ''],
      ['r2c0', 'r2c1', 'r2c2'],
    ]);
    expect(next.selection.empty).toBe(true);
  });

  it('elsewhere text, own mixed content and foreign HTML are today’s insertSlice result (pinned)', () => {
    const two = docOf(p('one', 'b1'), p('two', 'b2'));
    const mixed = TextSelection.create(two, pos(two, 'b1') + 1, pos(two, 'b2') + 4).content();
    const inputs: [string, PasteInput][] = [
      ['own mixed', { kind: 'own', slice: mixed }],
      ['text', { kind: 'text', text: 'one\ntwo' }],
      ['foreign', { kind: 'foreign', html: '<p>one</p><p>two</p>' }],
    ];
    for (const [name, input] of inputs) {
      const { opts } = options();
      const state = withSelection(
        stateOf(docOf(p('before', 'a1'), p('after', 'a2')), opts),
        caret('a1', 6),
      );
      const { tr, state: next } = paste(state, input, opts);
      expect(shape(sectionOf(next.doc)), name).toEqual(['p:beforeone', 'p:two', 'p:after']);
      expect(tr.getMeta(DISCRETE_STEP), name).toBeUndefined();
    }
  });

  it('decision 4: a text selection is replaced in the same transaction and the rule runs at the resulting caret', () => {
    const { opts } = options();
    const state = withSelection(stateOf(docOf(p('one', 'a1'), p('two', 'a2')), opts), (doc) =>
      TextSelection.create(doc, pos(doc, 'a2') + 1, pos(doc, 'a2') + 3),
    );
    const { tr, state: next } = paste(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts);
    // "tw" deleted; the caret at offset 0 of the non-empty "o": the table before it.
    expect(shape(sectionOf(next.doc))).toEqual(['p:one', 'table:2x2', 'p:o']);
    expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* A selected node (U30)                                                    */
/* ------------------------------------------------------------------------ */

describe('a selected node is replaced at its place (U30)', () => {
  const pasted = () => blockSlice(BLOCK);
  const poem = () =>
    N.poem!.create({ nodeId: 'po' }, [
      N.stanza!.create({ nodeId: 'st' }, [N.v!.create({ nodeId: 'v1' }, fb2Schema.text('verse'))]),
    ]);
  const cite = (...blocks: PMNode[]) => N.cite!.create({ nodeId: 'ci' }, blocks);
  const cases: {
    name: string;
    doc: () => PMNode;
    shape: (doc: PMNode) => string[];
    expected: string[];
  }[] = [
    {
      name: 'a section’s only table: the pasted table takes the empty p’s place',
      doc: () => docOf(table('old', plainRows(2, 2))),
      shape: (doc) => shape(sectionOf(doc)),
      expected: ['table:2x2'],
    },
    {
      name: 'a table followed by a poem',
      doc: () => docOf(p('one', 'a1'), table('old', plainRows(3, 3)), poem()),
      shape: (doc) => shape(sectionOf(doc)),
      expected: ['p:one', 'table:2x2', 'poem:verse'],
    },
    {
      name: 'a table followed by a cite',
      doc: () => docOf(p('one', 'a1'), table('old', plainRows(3, 3)), cite(p('quote', 'q1'))),
      shape: (doc) => shape(sectionOf(doc)),
      expected: ['p:one', 'table:2x2', 'cite:quote'],
    },
    {
      name: 'a table followed by another table',
      doc: () =>
        docOf(p('one', 'a1'), table('old', plainRows(3, 3)), table('next', plainRows(1, 1))),
      shape: (doc) => shape(sectionOf(doc)),
      expected: ['p:one', 'table:2x2', 'table:1x1'],
    },
    {
      name: 'a table directly before a cite’s text-author line',
      doc: () =>
        docOf(
          cite(
            p('quote', 'q1'),
            table('old', plainRows(3, 3)),
            N.text_author!.create({ nodeId: 'ta' }, fb2Schema.text('me')),
          ),
        ),
      shape: (doc) => shape(sectionOf(doc).child(0)),
      expected: ['p:quote', 'table:2x2', 'text_author:me'],
    },
    {
      name: 'a table that ends its section before another section',
      doc: () =>
        N.doc!.create(
          null,
          N.body!.create({ nodeId: 'b' }, [
            N.section!.create({ nodeId: 's1' }, [p('one', 'a1'), table('old', plainRows(3, 3))]),
            N.section!.create({ nodeId: 's2' }, [p('two', 'a2')]),
          ]),
        ),
      shape: (doc) => [...shape(sectionOf(doc, 0)), '|', ...shape(sectionOf(doc, 1))],
      expected: ['p:one', 'table:2x2', '|', 'p:two'],
    },
  ];
  for (const one of cases) {
    it(one.name, () => {
      const { opts } = options();
      const state = withSelection(stateOf(one.doc(), opts), (doc) =>
        NodeSelection.create(doc, pos(doc, 'old')),
      );
      const { tr, state: next } = paste(state, { kind: 'own', slice: pasted() }, opts);
      expect(one.shape(next.doc)).toEqual(one.expected);
      expect(tr.getMeta(DISCRETE_STEP)).toBe(true);
    });
  }

  it('a selected block image likewise', () => {
    const { opts } = options();
    const doc = docOf(
      p('one', 'a1'),
      N.image!.create({ nodeId: 'img', href: '#pic' }),
      p('two', 'a2'),
    );
    const state = withSelection(stateOf(doc, opts), (d) => NodeSelection.create(d, pos(d, 'img')));
    const { state: next } = paste(state, { kind: 'own', slice: pasted() }, opts);
    expect(shape(sectionOf(next.doc))).toEqual(['p:one', 'table:2x2', 'p:two']);
  });
});

/* ------------------------------------------------------------------------ */
/* Ids and node ids (C47; R5.8)                                             */
/* ------------------------------------------------------------------------ */

describe('ids and node ids (C47; R5.8)', () => {
  it('pasted table, td and th ids that the book uses are removed; unused ones are kept', () => {
    const source = table(
      'clip',
      [
        [
          { text: 'a', id: 'used' },
          { text: 'b', id: 'free', kind: 'th' },
        ],
      ],
      {
        id: 'tused',
      },
    );
    expect(dedupeIds(source, new Set(['used', 'tused'])).attrs.id).toBeNull();
    const deduped = dedupeIds(source, new Set(['used', 'tused']));
    expect(deduped.child(0).child(0).attrs.id).toBeNull();
    expect(deduped.child(0).child(1).attrs.id).toBe('free');
    expect(dedupeIds(source, new Set())).toBe(source);
  });

  it('after a copy and after a block cut, which leaves its cells in the book, the pasted id goes; after the cut of a whole table it stays', () => {
    for (const [name, bookIds, expected] of [
      ['a copy', ['xid'], null],
      ['a block cut', ['xid'], null],
      ['the cut of a whole table', [], 'xid'],
    ] as const) {
      const { opts } = options(bookIds);
      const state = withSelection(stateOf(target(), opts), caret('a2', 5));
      const { state: next } = paste(state, { kind: 'own', slice: blockSlice(BLOCK) }, opts);
      const created = sectionOf(next.doc).child(3);
      expect(created.type.name, name).toBe('table');
      expect(created.child(0).child(0).attrs.id, name).toBe(expected);
      // In a cell: the same rule.
      const inCell = withSelection(stateOf(target(), opts), caret('t-0-0'));
      const overwritten = paste(inCell, { kind: 'own', slice: blockSlice(BLOCK) }, opts);
      expect(tableIn(overwritten.state.doc, 't').child(0).child(0).attrs.id, name).toBe(expected);
    }
  });

  it('paragraph ids in a mixed paste behave as today (insertSlice)', () => {
    const two = docOf(
      N.p!.create({ nodeId: 'b1', id: 'pid' }, fb2Schema.text('one')),
      p('two', 'b2'),
    );
    const slice = new Slice(two.child(0).child(0).content, 0, 0);
    const { opts } = options(['pid']);
    const state = withSelection(stateOf(docOf(p('before', 'a1'), p('', 'a2')), opts), caret('a2'));
    const { state: next } = paste(state, { kind: 'own', slice }, opts);
    const ids = (doc: PMNode) => {
      const found: unknown[] = [];
      doc.descendants((node) => {
        if (node.type.name === 'p') found.push(node.attrs.id);
        return true;
      });
      return found;
    };
    const today = insertSlice(state, slice).doc;
    expect(shape(sectionOf(next.doc))).toEqual(shape(sectionOf(today)));
    expect(ids(next.doc)).toEqual(ids(today));
  });

  it('no node id of the clipboard survives; every pasted node has one from nextNodeId and nodeIdPlugin appends nothing, also for a 1,000-cell table', () => {
    const big = table('clip', plainRows(40, 25));
    const clipIds = new Set([big.attrs.nodeId as string, ...nodeIds(big)]);
    for (const at of [caret('a2', 5), caret('t-0-0')]) {
      const { opts } = options();
      const state = withSelection(stateOf(target(), opts), at);
      const { state: next, appended } = paste(state, { kind: 'own', slice: closed(big) }, opts);
      expect(appended).toEqual([]);
      const ids = nodeIds(next.doc);
      expect(ids.filter((id) => clipIds.has(id))).toEqual([]);
      expect(new Set(ids).size).toBe(ids.length);
      next.doc.descendants((node) => {
        if (node.type.spec.attrs?.nodeId && node.type.name !== 'doc') {
          expect(node.attrs.nodeId, node.type.name).toEqual(expect.any(String));
        }
        return true;
      });
    }
    const stamped = stampNodeIds(Fragment.from(big), () => 'n');
    stamped.descendants((node) => {
      if (!node.isText) expect(node.attrs.nodeId).toBe('n');
      return true;
    });
  });
});

/* ------------------------------------------------------------------------ */
/* The NBSP marker                                                          */
/* ------------------------------------------------------------------------ */

describe('the NBSP marker is converted on every input kind', () => {
  it('text, foreign HTML and own HTML: the marker character becomes a no-break space', () => {
    const { opts } = options();
    const state = withSelection(stateOf(target(), opts, '\u25a1'), caret('t-0-0', 4));
    const text = paste(state, { kind: 'text', text: 'x\u25a1y' }, opts);
    expect(nodeOf(text.state.doc, 't-0-0').textContent).toBe(`r0c0x${NBSP}y`);
    const foreign = paste(state, { kind: 'foreign', html: '<p>x\u25a1y</p>' }, opts);
    expect(nodeOf(foreign.state.doc, 't-0-0').textContent).toBe(`r0c0x${NBSP}y`);
    const { view } = viewOf(state);
    expect(
      view.pasteHTML(
        '<p class="fb-p" data-pm-slice="1 1 []">x\u25a1y</p>',
        clipboardEvent('paste').event,
      ),
    ).toBe(true);
    expect(nodeOf(view.state.doc, 't-0-0').textContent).toBe(`r0c0x${NBSP}y`);
  });
});

/* ------------------------------------------------------------------------ */
/* Entry points                                                             */
/* ------------------------------------------------------------------------ */

describe('the entry points', () => {
  it('handleDOMEvents.paste reads the own flavour, then HTML, then text, before ProseMirror parses', () => {
    const { opts } = options();
    const flavours: Record<string, string>[] = [
      { [MFBE_CLIPBOARD_MIME]: JSON.stringify(payloadFromSlice(blockSlice(BLOCK))) },
      { 'text/html': '<p>one</p><p>two</p>', 'text/plain': 'ignored' },
      { 'text/plain': 'one\ntwo' },
    ];
    for (const data of flavours) {
      const { view, seen } = viewOf(withSelection(stateOf(target(), opts), caret('t-0-0', 4)));
      const { event } = clipboardEvent('paste', data);
      const handler = pluginOf(view.state).props.handleDOMEvents!.paste!;
      expect(handler.call(pluginOf(view.state), view, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(seen).toHaveLength(1);
      expect(cellTexts(tableIn(view.state.doc, 't'))).toHaveLength(3);
    }
    // Own HTML goes through view.pasteHTML, so ProseMirror reads its data-pm-slice context.
    const { view } = viewOf(withSelection(stateOf(target(), opts), caret('t-1-1')));
    const html = view.serializeForClipboard(blockSlice(BLOCK)).dom.innerHTML;
    const { event } = clipboardEvent('paste', { 'text/html': html });
    const handler = pluginOf(view.state).props.handleDOMEvents!.paste!;
    expect(handler.call(pluginOf(view.state), view, event)).toBe(true);
    expect(cellTexts(tableIn(view.state.doc, 't'))[1]).toEqual(['r1c0', 'a', 'b']);
  });

  it('it returns false without a text flavour, while the view is not editable and while it is composing', () => {
    const { opts } = options();
    const text = { 'text/plain': 'x' };
    const { view } = viewOf(stateOf(target(), opts));
    const handler = pluginOf(view.state).props.handleDOMEvents!.paste!;
    expect(handler.call(pluginOf(view.state), view, clipboardEvent('paste', {}).event)).toBe(false);
    const { view: readOnly } = viewOf(stateOf(target(), opts), false);
    expect(handler.call(pluginOf(view.state), readOnly, clipboardEvent('paste', text).event)).toBe(
      false,
    );
    (view as unknown as { input: { composing: boolean } }).input.composing = true;
    expect(view.composing).toBe(true);
    expect(handler.call(pluginOf(view.state), view, clipboardEvent('paste', text).event)).toBe(
      false,
    );
    (view as unknown as { input: { composing: boolean } }).input.composing = false;
  });

  it('handlePaste routes the slice of view.pasteHTML() and returns false for an empty slice; pasteData routes with the plugin’s options', () => {
    const { opts, messages } = options();
    const { view } = viewOf(withSelection(stateOf(target(), opts), caret('t-1-1')));
    const handlePaste = pluginOf(view.state).props.handlePaste!;
    expect(
      handlePaste.call(pluginOf(view.state), view, clipboardEvent('paste').event, Slice.empty),
    ).toBe(false);
    expect(
      handlePaste.call(
        pluginOf(view.state),
        view,
        clipboardEvent('paste').event,
        blockSlice(BLOCK),
      ),
    ).toBe(true);
    expect(cellTexts(tableIn(view.state.doc, 't'))[1]).toEqual(['r1c0', 'a', 'b']);
    // pasteData (Edit → Paste) with the options the plugin carries: the refusal's message.
    const title = N.doc!.create(
      null,
      N.body!.create({ nodeId: 'b' }, [
        N.section!.create({ nodeId: 's' }, [
          N.title!.create({ nodeId: 'h' }, [p('Head', 'h1')]),
          N.section!.create({ nodeId: 's2' }, [p('inner', 'a1')]),
        ]),
      ]),
    );
    const { view: titled } = viewOf(withSelection(stateOf(title, opts), caret('h1', 2)));
    expect(pasteData(titled, { json: JSON.stringify(payloadFromSlice(blockSlice(BLOCK))) })).toBe(
      true,
    );
    expect(messages).toEqual(['tables.msg.pasteNoPlace']);
  });
});

/* ------------------------------------------------------------------------ */
/* Copy and cut of a block (data-model §8.8; R5.12)                         */
/* ------------------------------------------------------------------------ */

describe('copy and cut of a block', () => {
  it('copy writes {format, version 1, slice} of its content(); cut then clears the block with DISCRETE_STEP', () => {
    const { opts } = options();
    const doc = docOf(
      p('before', 'a1'),
      table(
        't',
        [
          [{ text: 'a', id: 'aid' }, { text: 'b' }, { text: 'c' }],
          [{ text: 'd' }, { text: 'e' }, { text: 'f' }],
        ],
        { id: 'tid', style: 'st' },
      ),
    );
    for (const cut of [false, true]) {
      const { view, seen } = viewOf(withSelection(stateOf(doc, opts), block('t-0-0', 't-1-1')));
      const { event, store } = clipboardEvent(cut ? 'cut' : 'copy');
      const handler = pluginOf(view.state).props.handleDOMEvents![cut ? 'cut' : 'copy']!;
      expect(handler.call(pluginOf(view.state), view, event)).toBe(true);
      const payload = JSON.parse(store[MFBE_CLIPBOARD_MIME]!) as {
        format: string;
        version: number;
      };
      expect(payload).toMatchObject({ format: 'mfbe-fb2', version: 1 });
      const slice = sliceFromPayload(store[MFBE_CLIPBOARD_MIME]!)!;
      const copied = slice.content.firstChild!;
      expect([slice.openStart, slice.openEnd, slice.content.childCount]).toEqual([0, 0, 1]);
      expect(copied.type.name).toBe('table');
      expect(copied.attrs.id).toBeNull();
      expect(copied.attrs.style).toBeNull();
      expect(cellTexts(copied)).toEqual([
        ['a', 'b'],
        ['d', 'e'],
      ]);
      expect(copied.child(0).child(0).attrs.id).toBe('aid');
      if (cut) {
        expect(seen).toHaveLength(1);
        expect(seen[0]!.getMeta(DISCRETE_STEP)).toBe(true);
        expect(cellTexts(tableIn(view.state.doc, 't'))).toEqual([
          ['', '', 'c'],
          ['', '', 'f'],
        ]);
        expect(view.state.selection).toBeInstanceOf(CellBlockSelection);
      } else {
        expect(seen).toHaveLength(0);
      }
    }
  });
});
