/**
 * Copy out (feature 006, T141; FR-060; C43; U32; I1; `contracts/resource-formats.md` §20 and
 * its Tests; data-model §8.8; quickstart §13; research R5 items 9 to 11, R5.10, R5.11): the
 * editor's own HTML of a table (`tableClipboardSerializer`), `transformCopied` and the
 * tab-separated text (`clipboardText`), directly and through `view.serializeForClipboard` of a
 * jsdom `EditorView` on a state from `createBodyEditorState`, and the copy handler's three
 * flavours.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  clipboardText,
  tableClipboardSerializer,
  transformCopied,
} from '@/editor/clipboard/copyOut';
import { classifyOwnSlice, isOwnHtml, type ClipboardOptions } from '@/editor/clipboard/route';
import { createTableNodeViews } from '@/editor/nodeviews/table';
import {
  MFBE_CLIPBOARD_MIME,
  clipboardPluginKey,
  sliceFromPayload,
  withoutNodeIds,
} from '@/editor/plugins/clipboard';
import { fb2Schema } from '@/editor/schema';
import { CellBlockSelection } from '@/editor/table/selection';
import { createBodyEditorState } from '@/views/body/bodyEditor';

import { docOf, idGenerator, p, pos, table, type CellSpec } from '../table/helpers';

const N = fb2Schema.nodes;
const M = fb2Schema.marks;

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

function options(): ClipboardOptions {
  return { bookIds: () => new Set(), nextNodeId: idGenerator('c'), message: () => {} };
}

function viewOf(state: EditorState): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, { state, nodeViews: createTableNodeViews() });
  views.push(view);
  return view;
}

function bodyView(doc: PMNode, nbspChar = '\u00a0'): EditorView {
  return viewOf(createBodyEditorState(doc, { getNbspChar: () => nbspChar, clipboard: options() }));
}

/** A `style` attribute as written by ProseMirror (through `cssText`), compared without spaces. */
function css(element: Element): string | null {
  const style = element.getAttribute('style');
  return style === null ? null : style.replace(/\s+/g, '').replace(/;$/, '');
}

/** The serialized HTML of a fragment through the table serializer. */
function serialize(content: Fragment): HTMLElement {
  const wrap = document.createElement('div');
  wrap.appendChild(tableClipboardSerializer.serializeFragment(content, { document }));
  return wrap;
}

/** A paste event's or copy event's clipboard data as a map (the pattern of route.test.ts). */
function clipboardEvent(type: string) {
  const store: Record<string, string> = {};
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

/** A table with every attribute the HTML carries. */
function richTable(): PMNode {
  return table(
    't',
    [
      {
        align: 'center',
        cells: [
          {
            kind: 'th',
            text: 'Head',
            colspan: 2,
            align: 'right',
            valign: 'top',
            lang: 'de',
            id: 'h1',
            style: 'st',
          },
          { kind: 'th', text: 'Other' },
        ],
      },
      [{ text: 'a', rowspan: 2, valign: 'bottom' }, { text: 'b' }, { text: 'c', align: 'left' }],
      [{ text: 'd' }, { text: 'e' }],
    ],
    { id: 'tid', style: 'tstyle' },
  );
}

/* ------------------------------------------------------------------------ */
/* tableClipboardSerializer                                                 */
/* ------------------------------------------------------------------------ */

describe('tableClipboardSerializer (data-model §8.8)', () => {
  it('writes the table with border="1", border-collapse, its class, data-id and data-style, and a tbody', () => {
    const wrap = serialize(Fragment.from(richTable()));
    const element = wrap.querySelector('table')!;
    expect(element.getAttribute('border')).toBe('1');
    expect(css(element)).toBe('border-collapse:collapse');
    expect(element.getAttribute('class')).toBe('fb-table');
    expect(element.getAttribute('data-id')).toBe('tid');
    expect(element.getAttribute('data-style')).toBe('tstyle');
    expect(wrap.innerHTML).toMatch(
      /^<table border="1" style="border-collapse: ?collapse;?" class="fb-table"/,
    );
    expect(element.children).toHaveLength(1);
    expect(element.firstElementChild!.tagName).toBe('TBODY');
    expect(element.querySelectorAll('tbody > tr')).toHaveLength(3);
  });

  it('writes a row’s align as the attribute and as text-align; a cell’s spans above 1, align and valign as attributes and as CSS, lang, data-id and data-style; never a node id', () => {
    const wrap = serialize(Fragment.from(richTable()));
    const row = wrap.querySelector('tr')!;
    expect(row.getAttribute('align')).toBe('center');
    expect(css(row)).toBe('text-align:center');
    const head = wrap.querySelector('th')!;
    expect(head.getAttribute('class')).toBe('fb-th');
    expect(head.getAttribute('colspan')).toBe('2');
    expect(head.hasAttribute('rowspan')).toBe(false);
    expect(head.getAttribute('align')).toBe('right');
    expect(head.getAttribute('valign')).toBe('top');
    expect(css(head)).toBe('text-align:right;vertical-align:top');
    expect(head.getAttribute('lang')).toBe('de');
    expect(head.getAttribute('data-id')).toBe('h1');
    expect(head.getAttribute('data-style')).toBe('st');
    const a = wrap.querySelectorAll('td')[0]!;
    expect(a.getAttribute('class')).toBe('fb-td');
    expect(a.getAttribute('rowspan')).toBe('2');
    expect(css(a)).toBe('vertical-align:bottom');
    const b = wrap.querySelectorAll('td')[1]!;
    expect(b.attributes).toHaveLength(1);
    expect(wrap.querySelectorAll('[data-node-id]')).toHaveLength(0);
  });

  it('writes a span only when the effective span is above 1: 1, null, 0 and "x" kept in unknownAttrs are not written, 5000 is written as 1000', () => {
    const cells: CellSpec[] = [
      { text: 'one', colspan: 1 },
      { text: 'null' },
      { text: 'zero', colspan: 0, rowspan: 0 },
      { text: 'x', extraAttrs: { unknownAttrs: { colspan: 'x' } } },
      { text: 'big', colspan: 5000 },
    ];
    const wrap = serialize(Fragment.from(table('s', [cells])));
    const written = [...wrap.querySelectorAll('td')].map((cell) => [
      cell.getAttribute('colspan'),
      cell.getAttribute('rowspan'),
    ]);
    expect(written).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, null],
      ['1000', null],
    ]);
  });

  it('the HTML parses back through ProseMirror’s clipboard parser to the same table, and is the editor’s own by its root’s fb- class (C43)', () => {
    const source = richTable();
    const view = bodyView(docOf(p('before', 'a1'), source));
    const slice = NodeSelection.create(view.state.doc, pos(view.state.doc, 't')).content();
    const { dom } = view.serializeForClipboard(slice);
    const html = dom.innerHTML;
    expect(isOwnHtml(html)).toBe(true);
    // A view whose only paste handler records the slice ProseMirror's clipboard parser gives.
    const recorded: Slice[] = [];
    const recorder = new Plugin({
      props: {
        handlePaste: (_view, _event, pasted) => {
          recorded.push(pasted);
          return true;
        },
      },
    });
    const parser = viewOf(EditorState.create({ doc: docOf(p('x', 'x1')), plugins: [recorder] }));
    parser.pasteHTML(html, clipboardEvent('paste').event);
    expect(recorded).toHaveLength(1);
    const own = classifyOwnSlice(recorded[0]!);
    expect(own.kind).toBe('table');
    const reparsed = own.kind === 'table' ? own.table : null;
    const expected = withoutNodeIds(Fragment.from(source)).firstChild!;
    expect(reparsed!.eq(expected)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* transformCopied                                                          */
/* ------------------------------------------------------------------------ */

describe('transformCopied', () => {
  it('strips node ids; text inside one cell becomes that cell’s inline content; other slices keep their shape', () => {
    const doc = docOf(
      p('before', 'a1'),
      table('t', [[{ text: 'alpha beta' }, { text: 'c' }]]),
      p('after', 'a2'),
    );
    const inCell = TextSelection.create(
      doc,
      pos(doc, 't-0-0') + 2,
      pos(doc, 't-0-0') + 6,
    ).content();
    expect(inCell.openStart).toBeGreaterThan(2);
    const text = transformCopied(inCell);
    expect([text.openStart, text.openEnd]).toEqual([0, 0]);
    expect(text.content.childCount).toBe(1);
    expect(text.content.firstChild!.isText).toBe(true);
    expect(text.content.firstChild!.text).toBe('lpha');
    const whole = transformCopied(NodeSelection.create(doc, pos(doc, 't')).content());
    expect(whole.content.firstChild!.type.name).toBe('table');
    let ids = 0;
    whole.content.descendants((node) => {
      if (node.attrs.nodeId) ids += 1;
      return true;
    });
    expect(ids).toBe(0);
    const across = transformCopied(
      TextSelection.create(doc, pos(doc, 'a1') + 2, pos(doc, 't-0-1') + 1).content(),
    );
    let tables = 0;
    across.content.descendants((node) => {
      if (node.type.name === 'table') tables += 1;
      return true;
    });
    expect(tables).toBe(1);
  });

  it('a copy of text inside one cell gives no <table> in the HTML - its inline content - while the JSON flavour stays the selection’s own slice', () => {
    const doc = docOf(p('before', 'a1'), table('t', [[{ text: 'alpha beta' }, { text: 'c' }]]));
    const view = bodyView(doc);
    const at = pos(doc, 't-0-0') + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + 5)));
    const { event, store } = clipboardEvent('copy');
    const plugin = clipboardPluginKey.get(view.state)!;
    expect(plugin.props.handleDOMEvents!.copy!.call(plugin, view, event)).toBe(true);
    expect(store['text/html']).not.toContain('<table');
    expect(store['text/html']).toContain('alpha');
    expect(store['text/plain']).toBe('alpha');
    const own = sliceFromPayload(store[MFBE_CLIPBOARD_MIME]!)!;
    expect(own.openStart).toBeGreaterThan(2);
    expect(classifyOwnSlice(own).kind).toBe('inline');
  });
});

/* ------------------------------------------------------------------------ */
/* clipboardText (resource-formats.md §20; U32)                             */
/* ------------------------------------------------------------------------ */

describe('clipboardText', () => {
  const closed = (node: PMNode) => new Slice(Fragment.from(node), 0, 0);

  it('a merged cell’s text stands at its top-left position, an empty field for each other position it covers; rows by \\n, none after the last', () => {
    const merged = table('m', [
      [
        { text: 'a', colspan: 2 },
        { text: 'b', rowspan: 2 },
      ],
      [{ text: 'c' }, { text: 'd' }],
      [{ text: 'e' }, { text: 'f' }, { text: 'g' }],
    ]);
    expect(clipboardText(closed(merged))).toBe('a\t\tb\nc\td\t\ne\tf\tg');
  });

  it('an irregular table gives W fields per row, holes as empty fields', () => {
    const irregular = table('i', [
      [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      [{ text: 'd' }],
      [{ text: 'e', colspan: 2 }],
    ]);
    expect(clipboardText(closed(irregular))).toBe('a\tb\tc\nd\t\t\ne\t\t');
  });

  it('a block’s content(), and a mixed slice: blocks joined by \\n\\n', () => {
    const doc = docOf(
      p('lead', 'a1'),
      table('t', [
        [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
        [{ text: 'd' }, { text: 'e' }, { text: 'f' }],
      ]),
      p('tail', 'a2'),
    );
    const block = CellBlockSelection.create(doc, pos(doc, 't-0-1'), pos(doc, 't-1-2')).content();
    expect(clipboardText(block)).toBe('b\tc\ne\tf');
    const mixed = TextSelection.create(doc, pos(doc, 'a1') + 1, pos(doc, 'a2') + 3).content();
    expect(clipboardText(mixed)).toBe('lead\n\na\tb\tc\nd\te\tf\n\nta');
  });

  it('tabs, CR and LF inside a cell become spaces; inline images give nothing; nothing is quoted', () => {
    const cell = N.td!.create({ nodeId: 'q1' }, [
      fb2Schema.text('say "hi"\tthere\r\nnow'),
      N.inline_image!.create({ nodeId: 'img', href: '#p.png' }),
      fb2Schema.text(', x', [M.strong!.create()]),
    ]);
    const node = N.table!.create({ nodeId: 'q' }, [
      N.tr!.create({ nodeId: 'qr' }, [cell, N.td!.create({ nodeId: 'q2' }, fb2Schema.text('two'))]),
    ]);
    expect(clipboardText(closed(node))).toBe('say "hi" there  now, x\ttwo');
  });

  it('a slice without a table gives "", so serializeForClipboard keeps ProseMirror’s default text', () => {
    const doc = docOf(p('one', 'a1'), p('two', 'a2'));
    const slice = TextSelection.create(doc, pos(doc, 'a1') + 1, pos(doc, 'a2') + 4).content();
    expect(clipboardText(slice)).toBe('');
    const view = bodyView(doc);
    expect(view.serializeForClipboard(slice).text).toBe(
      slice.content.textBetween(0, slice.content.size, '\n\n'),
    );
  });

  it('through serializeForClipboard: a selected table gives its tab-separated text and the table HTML without node ids', () => {
    const doc = docOf(
      p('before', 'a1'),
      table('t', [[{ text: 'x' }, { text: 'y' }], [{ text: 'z', colspan: 2 }]]),
    );
    const view = bodyView(doc);
    const { dom, text } = view.serializeForClipboard(
      NodeSelection.create(view.state.doc, pos(view.state.doc, 't')).content(),
    );
    expect(text).toBe('x\ty\nz\t');
    expect(dom.querySelector('table')!.getAttribute('class')).toBe('fb-table');
    expect(dom.querySelectorAll('[data-node-id]')).toHaveLength(0);
  });
});

describe('the transformCopied of the NBSP marker plugin still runs after the clipboard plugin’s', () => {
  it('a copied table holds the marker character instead of a no-break space, in its text and its HTML', () => {
    const doc = docOf(p('before', 'a1'), table('t', [[{ text: 'a\u00a0b' }, { text: 'c' }]]));
    const view = bodyView(doc, '\u25a1');
    const { dom, text } = view.serializeForClipboard(
      NodeSelection.create(view.state.doc, pos(view.state.doc, 't')).content(),
    );
    expect(text).toBe('a\u25a1b\tc');
    expect(dom.querySelector('td')!.textContent).toBe('a\u25a1b');
    expect(dom.querySelector('table')!.getAttribute('border')).toBe('1');
    expect(dom.querySelectorAll('[data-node-id]')).toHaveLength(0);
  });
});
