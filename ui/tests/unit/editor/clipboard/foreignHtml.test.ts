/**
 * Foreign HTML (feature 006, T140; FR-059; C11, C42, C45, C46; R5.9; U28, U29; data-model §8.5,
 * §8.9; quickstart §9 "Unit and core tests", §13 "vitest: the clipboard router"; research R5
 * item 4, R5.2 to R5.4, R5.14): `parseForeignHtml` on the nine clipboard fixtures of T018 - each
 * table part made regular by `regularisePastedTable(table, {foreign: true, keepRows: false})`
 * (T147) equals the fixture's `expected.json` -, the rules of the conversion one by one,
 * `htmlHasTextTable`, the inert document (U28) and hostile HTML (U29).
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Node as PMNode } from 'prosemirror-model';

import {
  htmlHasTextTable,
  parseForeignHtml,
  type ForeignPart,
  type ForeignPaste,
} from '@/editor/clipboard/foreignHtml';
import { sliceFromExternalHtml } from '@/editor/plugins/clipboard';
import { isRefusal } from '@/editor/table/edit';
import {
  MAX_COLSPAN,
  MAX_ROWSPAN,
  effectiveColspan,
  effectiveRowspan,
  gridOfNode,
} from '@/editor/table/grid';
import { regularisePastedTable } from '@/editor/table/ops';

import { idGenerator } from '../table/helpers';

const CLIPBOARD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../tests/fixtures/clipboard',
);

const FIXTURES = [
  'word-win',
  'writer',
  'calc',
  'excel-win',
  'gdocs',
  'gsheets',
  'firefox-web',
  'irregular-web',
  'mixed',
] as const;

interface ExpectedCell {
  k: 'td' | 'th';
  t: string;
  cs?: number;
  rs?: number;
  al?: string;
  va?: string;
  m?: string[];
}

type ExpectedBlock =
  { p: { text: string; marks?: string[] } } | { table: { rows: ExpectedCell[][] } };

function fixture(name: string): { html: string; blocks: ExpectedBlock[] } {
  const html = readFileSync(path.join(CLIPBOARD_DIR, `${name}.html`), 'utf8');
  const { blocks } = JSON.parse(
    readFileSync(path.join(CLIPBOARD_DIR, `${name}.expected.json`), 'utf8'),
  ) as { blocks: ExpectedBlock[] };
  return { html, blocks };
}

/* ------------------------------------------------------------------------ */
/* The parts in the shape of expected.json                                  */
/* ------------------------------------------------------------------------ */

/** The sorted mark types inside a node. */
function marksOf(node: PMNode): string[] {
  const found = new Set<string>();
  node.descendants((child) => {
    for (const mark of child.marks) found.add(mark.type.name);
    return true;
  });
  return [...found].sort();
}

function paragraphBlock(node: PMNode): ExpectedBlock {
  const marks = marksOf(node);
  return { p: marks.length > 0 ? { text: node.textContent, marks } : { text: node.textContent } };
}

function cellOf(cell: PMNode): ExpectedCell {
  const out: ExpectedCell = { k: cell.type.name as 'td' | 'th', t: cell.textContent };
  const colspan = effectiveColspan(cell.attrs.colspan);
  const rowspan = effectiveRowspan(cell.attrs.rowspan);
  if (colspan > 1) out.cs = colspan;
  if (rowspan > 1) out.rs = rowspan;
  if (cell.attrs.align !== null) out.al = cell.attrs.align as string;
  if (cell.attrs.valign !== null) out.va = cell.attrs.valign as string;
  const marks = marksOf(cell);
  if (marks.length > 0) out.m = marks;
  return out;
}

function rowsOf(table: PMNode): ExpectedCell[][] {
  const rows: ExpectedCell[][] = [];
  table.forEach((row) => {
    const cells: ExpectedCell[] = [];
    row.forEach((cell) => cells.push(cellOf(cell)));
    rows.push(cells);
  });
  return rows;
}

/** The regular form of a pasted foreign table (FR-059; T147). */
function regular(table: PMNode): PMNode {
  const result = regularisePastedTable(
    table,
    { foreign: true, keepRows: false },
    { nextId: idGenerator('r') },
  );
  if (isRefusal(result)) throw new Error(`refused: ${result.refused}`);
  return result;
}

/** The parts as the blocks a paste outside a table gives, each table made regular. */
function blocksOf(paste: ForeignPaste): ExpectedBlock[] {
  return paste.parts.flatMap((part): ExpectedBlock[] =>
    part.kind === 'blocks'
      ? part.nodes.map(paragraphBlock)
      : [
          ...(part.caption ? [paragraphBlock(part.caption)] : []),
          { table: { rows: rowsOf(regular(part.table)) } },
        ],
  );
}

/** The table parts of a paste. */
function tablesOf(paste: ForeignPaste): Extract<ForeignPart, { kind: 'table' }>[] {
  return paste.parts.filter(
    (part): part is Extract<ForeignPart, { kind: 'table' }> => part.kind === 'table',
  );
}

/** The one table of `html`, as parsed (not yet made regular). */
function onlyTable(html: string): PMNode {
  const tables = tablesOf(parseForeignHtml(html));
  expect(tables).toHaveLength(1);
  return tables[0]!.table;
}

/** The cells of a parsed table, row by row, in the shape of expected.json. */
function parsedRows(html: string): ExpectedCell[][] {
  return rowsOf(onlyTable(html));
}

/* ------------------------------------------------------------------------ */
/* The fixtures                                                             */
/* ------------------------------------------------------------------------ */

describe('parseForeignHtml on the clipboard fixtures (T018; SC-012)', () => {
  for (const name of FIXTURES) {
    it(`${name}: the parts in document order, each table regular, equal to ${name}.expected.json`, () => {
      const { html, blocks } = fixture(name);
      const paste = parseForeignHtml(html);
      expect(blocksOf(paste)).toEqual(blocks);
      // No node ids: the router stamps them (data-model §8.7); no FB2 id from foreign HTML.
      for (const part of paste.parts) {
        const nodes = part.kind === 'blocks' ? part.nodes : [part.table];
        for (const node of nodes) {
          node.descendants((child) => {
            if (!child.isText) {
              expect(child.attrs.nodeId ?? null).toBeNull();
              expect(child.attrs.id ?? null).toBeNull();
            }
            return true;
          });
          expect(node.attrs.nodeId ?? null).toBeNull();
        }
      }
    });
  }

  it('a caption is the part’s caption paragraph, before its table (firefox-web; vR5 corr 3)', () => {
    const [part] = tablesOf(parseForeignHtml(fixture('firefox-web').html));
    expect(part!.caption!.type.name).toBe('p');
    expect(part!.caption!.textContent).toBe('Inner planets');
    expect(tablesOf(parseForeignHtml(fixture('calc').html))[0]!.caption).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* The rules of the conversion (data-model §8.5)                            */
/* ------------------------------------------------------------------------ */

describe('the structure of a foreign table (data-model §8.5 step 5)', () => {
  it('rows in the order thead, tbody and direct rows, tfoot; any cell of a thead row is a header cell', () => {
    const rows = parsedRows(
      '<table><tfoot><tr><td>f</td></tr></tfoot><tbody><tr><td>b1</td></tr></tbody>' +
        '<thead><tr><td>h</td></tr></thead><tbody><tr><th>b2</th></tr></tbody></table>',
    );
    expect(rows).toEqual([
      [{ k: 'th', t: 'h' }],
      [{ k: 'td', t: 'b1' }],
      [{ k: 'th', t: 'b2' }],
      [{ k: 'td', t: 'f' }],
    ]);
  });

  it('a nested table is no row of its own: its text joins its cell', () => {
    const rows = parsedRows(
      '<table><tr><td>outer <table><tr><td>in1</td><td>in2</td></tr><tr><td>in3</td></tr></table> end</td><td>b</td></tr></table>',
    );
    expect(rows).toEqual([
      [
        { k: 'td', t: 'outer in1 in2 in3 end' },
        { k: 'td', t: 'b' },
      ],
    ]);
  });

  it('spans: whole numbers of 1 or more are kept, capped at the limits; every other spelling counts 1', () => {
    const table = onlyTable(
      '<table><tr><td colspan="2">a</td><td colspan=" 3 ">b</td><td colspan="0">c</td>' +
        '<td colspan="2.5">d</td><td colspan="abc">e</td><td colspan="-1">f</td>' +
        '<td colspan="1000000" rowspan="1000000">g</td><td colspan="1">h</td></tr></table>',
    );
    const cells: PMNode[] = [];
    table.child(0).forEach((cell) => cells.push(cell));
    expect(cells.map((cell) => effectiveColspan(cell.attrs.colspan))).toEqual([
      2,
      3,
      1,
      1,
      1,
      1,
      MAX_COLSPAN,
      1,
    ]);
    expect(effectiveRowspan(cells[6]!.attrs.rowspan)).toBe(MAX_ROWSPAN);
    // 1 is never written (withSpans): the attribute is null.
    for (const index of [2, 3, 4, 5, 7]) expect(cells[index]!.attrs.colspan).toBeNull();
    expect(cells[0]!.attrs.colspan).toBe(2);
  });
});

describe('alignment (data-model §8.5 step 6)', () => {
  it('a cell’s align: its own, else the uniform alignment of the blocks its text stands in, else its row group’s, else the table’s CSS text-align; CSS over the attribute', () => {
    const rows = parsedRows(`<table style="text-align:right" align="center">
      <thead align="left"><tr><td>g</td><td align="right">own</td></tr></thead>
      <tbody><tr>
        <td><p align="center">one</p><p style="text-align:center">two</p></td>
        <td><p align="center">one</p><p>two</p></td>
        <td align="left" style="text-align:right">css</td>
        <td style="text-align:-webkit-center">webkit</td>
        <td style="text-align:-moz-right">moz</td>
        <td style="text-align:justify" align="left">justify</td>
        <td><div style="text-align:center"><span>deep</span></div></td>
      </tr></tbody></table>`);
    expect(rows[0]).toEqual([
      { k: 'th', t: 'g', al: 'left' },
      { k: 'th', t: 'own', al: 'right' },
    ]);
    expect(rows[1]!.map((cell) => cell.al ?? null)).toEqual([
      'center',
      // Not uniform: the table's CSS text-align (the `align` attribute is its position).
      'right',
      'right',
      'center',
      'right',
      'left',
      'center',
    ]);
  });

  it('valign: the cell’s own, else its row’s, else its row group’s, CSS over the attribute; a row’s align is its own; values are kept as given, defaults included', () => {
    const table = onlyTable(`<table><tbody valign="bottom">
      <tr valign="middle" align="left"><td valign="top">a</td><td>b</td><td style="vertical-align:text-bottom" valign="top">c</td></tr>
      <tr style="text-align:center"><td>d</td><td style="vertical-align:baseline" valign="top">e</td><td style="vertical-align:center">f</td></tr>
    </tbody></table>`);
    expect(rowsOf(table).map((row) => row.map((cell) => cell.va ?? null))).toEqual([
      ['top', 'middle', 'bottom'],
      ['bottom', 'top', 'middle'],
    ]);
    expect(table.child(0).attrs.align).toBe('left');
    expect(table.child(1).attrs.align).toBe('center');
  });
});

describe('what is removed inside a table (data-model §8.5 step 4)', () => {
  it('hidden elements, inline and by a rule: Excel’s hidden row, Calc’s cell note, a hidden span', () => {
    const rows = parsedRows(`<style>comment { display:none; } .gone { visibility: hidden }</style>
      <table><tr><td>a<comment><p>note</p></comment></td><td>b <span style="display:none">x</span><span class="gone">y</span>c</td></tr>
      <tr style="display:none"><td>hidden</td><td>row</td></tr>
      <tr><td style="visibility:hidden">h</td><td>d</td></tr></table>`);
    expect(rows).toEqual([
      [
        { k: 'td', t: 'a' },
        { k: 'td', t: 'b c' },
      ],
      [{ k: 'td', t: 'd' }],
    ]);
  });

  it('Word’s mso-list:Ignore marker, o:p and VML shapes; pictures, media, frames, form controls, scripts, styles, templates, colgroup and col', () => {
    const rows = parsedRows(`<table><colgroup><col width="1"></colgroup><col>
      <tr><td><p><span style='mso-list:Ignore'>&#183;&nbsp;&nbsp;</span>First item<o:p></o:p></p></td>
      <td><v:shape><v:textbox>Shape label</v:textbox></v:shape><img src="x.png" alt="pic">Picture</td>
      <td>a<picture><source srcset="y"></picture><svg><text>svg</text></svg><video>v</video><audio>au</audio><canvas>c</canvas><iframe src="about:blank"></iframe><object>o</object><embed src="e"><input value="i"><button>btn</button><select><option>opt</option></select><textarea>ta</textarea><script>s()</script><style>p{}</style><template>tpl</template><noscript>ns</noscript>b</td></tr></table>`);
    expect(rows).toEqual([
      [
        { k: 'td', t: 'First item' },
        { k: 'td', t: 'Picture' },
        { k: 'td', t: 'ab' },
      ],
    ]);
  });
});

describe('cell content (data-model §8.5 step 7)', () => {
  it('<br> and block boundaries become single spaces; white space collapses; a cell of white space and no-break spaces is empty', () => {
    const rows = parsedRows(`<table><tr>
      <td>one<br>two<br/>three</td>
      <td><p>para one</p><p>para two</p><ul><li>item</li><li>more</li></ul></td>
      <td>  spaced   out \n text  </td>
      <td> &nbsp; &#160; </td>
      <td><p>&nbsp;</p></td>
      <td>keep&nbsp;nbsp</td></tr></table>`);
    expect(rows[0]!.map((cell) => cell.t)).toEqual([
      'one two three',
      'para one para two item more',
      'spaced out text',
      '',
      '',
      'keep\u00a0nbsp',
    ]);
  });

  it('bold or italic set on the cell, its row, its row group, the table or a b, strong, i or em ancestor marks the whole content, in th too; Google Docs’ font-weight:normal wrapper adds none', () => {
    const marks = (html: string) => parsedRows(html)[0]!.map((cell) => cell.m ?? []);
    expect(
      marks(`<style>.bold { font-weight: 700 } .it { font-style: italic }</style><table><tr>
        <td style="font-weight:bold">a <span>b</span></td>
        <th class="bold">c</th>
        <td class="it">d</td>
        <td style="font-weight:400">plain</td>
        <th>header</th></tr></table>`),
    ).toEqual([['strong'], ['strong'], ['emphasis'], [], []]);
    expect(marks('<table><tr style="font-weight:700"><td>a</td><th>b</th></tr></table>')).toEqual([
      ['strong'],
      ['strong'],
    ]);
    expect(
      marks('<table><tbody style="font-style:italic"><tr><td>a</td></tr></tbody></table>'),
    ).toEqual([['emphasis']]);
    expect(marks('<table style="font-weight:bold"><tr><td>a</td></tr></table>')).toEqual([
      ['strong'],
    ]);
    expect(marks('<b><table><tr><td>a</td></tr></table></b>')).toEqual([['strong']]);
    expect(marks('<em><table><tr><td>a</td></tr></table></em>')).toEqual([['emphasis']]);
    expect(
      marks(
        '<b style="font-weight:normal;" id="docs-internal-guid-1"><table><tr><td>a</td></tr></table></b>',
      ),
    ).toEqual([[]]);
    // The whole content: every text node of the cell carries the mark.
    const cell = onlyTable('<table><tr><td style="font-weight:bold">a <i>b</i> c</td></tr></table>')
      .child(0)
      .child(0);
    cell.forEach((child) => {
      expect(child.marks.some((mark) => mark.type.name === 'strong')).toBe(true);
    });
  });

  it('inline formatting: strong, emphasis, strikethrough, sub, sup and code from tags and from CSS; links keep href; underline is dropped', () => {
    const table = onlyTable(`<table><tr>
      <td><b>b</b><strong>s</strong><i>i</i><em>e</em><s>x</s><del>d</del><sub>2</sub><sup>3</sup><code>c</code><tt>t</tt></td>
      <td><span style="font-weight:700">w</span><span style="font-style:italic">y</span><span style="text-decoration:line-through">z</span><span style="vertical-align:super">p</span><span style="vertical-align:sub">q</span></td>
      <td><a href="https://example.org/x" title="t">link</a> <u>under</u> <span style="text-decoration:underline">line</span></td></tr></table>`);
    const rows = rowsOf(table);
    expect(rows[0]![0]!.m).toEqual(['code', 'emphasis', 'strikethrough', 'strong', 'sub', 'sup']);
    expect(rows[0]![1]!.m).toEqual(['emphasis', 'strikethrough', 'strong', 'sub', 'sup']);
    expect(rows[0]![2]).toEqual({ k: 'td', t: 'link under line', m: ['link'] });
    let href: unknown = null;
    table
      .child(0)
      .child(2)
      .forEach((child) => {
        for (const mark of child.marks) if (mark.type.name === 'link') href = mark.attrs.href;
      });
    expect(href).toBe('https://example.org/x');
  });

  it('nothing of the never-taken list reaches a node: id, data-id, data-style, lang, class, the editor’s own span classes', () => {
    const table =
      onlyTable(`<table id="tid" data-id="t2" data-style="s" lang="de" class="fb-table"><tr id="r" align="left" class="fb-tr">
      <td id="c" data-id="c2" data-style="st" lang="de" class="fb-td" data-node-id="n1">a<span class="fb-unknown-inline" data-xml="&lt;x/&gt;">u</span><span class="fb-inline-image" data-href="#p.png"></span><span class="fb-style" data-style="named">n</span><a class="fb-link fb-note" data-type="note" href="#n1">1</a><strong class="fb-strong" lang="fr">s</strong></td></tr></table>`);
    expect(table.attrs.id).toBeNull();
    expect(table.attrs.style).toBeNull();
    const cell = table.child(0).child(0);
    for (const name of ['id', 'style', 'lang']) expect(cell.attrs[name], name).toBeNull();
    expect(cell.attrs.extraAttrs ?? null).toBeNull();
    expect(cell.textContent).toBe('aun1s');
    cell.descendants((child) => {
      expect(child.type.name).toBe('text');
      for (const mark of child.marks) {
        expect(['link', 'strong']).toContain(mark.type.name);
        if (mark.type.name === 'link') expect(mark.attrs.type).toBeNull();
        if (mark.type.name === 'strong') expect(mark.attrs.lang).toBeNull();
      }
      return true;
    });
  });
});

describe('HTML around and without tables (data-model §8.5 step 3)', () => {
  it('HTML without a table gives exactly sliceFromExternalHtml’s paragraphs', () => {
    for (const html of [
      '<html><body><h2>Imported</h2><p>Keep <b>bold</b> and <i>italic</i>, drop <u>underline</u>.</p><ul><li>bullet</li></ul></body></html>',
      '<p>one</p><p>two</p>',
      '<p>only</p>',
      '<p></p>',
      'plain text',
    ]) {
      const paste = parseForeignHtml(html);
      const nodes = paste.parts.flatMap((part) => (part.kind === 'blocks' ? part.nodes : []));
      expect(tablesOf(paste)).toEqual([]);
      expect(paste.parts.length, html).toBeLessThanOrEqual(1);
      const slice = sliceFromExternalHtml(html);
      if (slice.openStart === 0) {
        // One paragraph: today's slice is its inline content.
        expect(nodes, html).toHaveLength(1);
        expect(nodes[0]!.type.name, html).toBe('p');
        expect(nodes[0]!.content.eq(slice.content), html).toBe(true);
      } else {
        const today: PMNode[] = [];
        slice.content.forEach((node) => today.push(node));
        expect(nodes.length, html).toBe(today.length);
        nodes.forEach((node, index) => expect(node.eq(today[index]!), html).toBe(true));
      }
    }
  });

  it('the paragraphs around tables are parsed as today: empty ones give no block, no-break-space ones are kept (C45)', () => {
    const paste = parseForeignHtml(
      '<p>before <b>b</b></p><p></p><table><tr><td>x</td></tr></table><p><br/></p><p>&nbsp;</p><p>after</p><table><tr><td>y</td></tr></table>',
    );
    expect(
      paste.parts.map((part) =>
        part.kind === 'blocks'
          ? `blocks:${part.nodes.map((node) => JSON.stringify(node.textContent)).join(',')}`
          : `table:${part.table.textContent}`,
      ),
    ).toEqual(['blocks:"before b"', 'table:x', 'blocks:"\u00a0","after"', 'table:y']);
  });
});

/* ------------------------------------------------------------------------ */
/* htmlHasTextTable (R5.9; data-model §8.9)                                 */
/* ------------------------------------------------------------------------ */

describe('htmlHasTextTable', () => {
  it('is true for a cell with text, false without <td>/<th>, for a table of empty cells and for a table that holds only a picture', () => {
    expect(htmlHasTextTable(fixture('excel-win').html)).toBe(true);
    expect(htmlHasTextTable('<table><tr><th>h</th></tr></table>')).toBe(true);
    expect(htmlHasTextTable('<p>no table here</p><div>td th</div>')).toBe(false);
    expect(htmlHasTextTable('<table><tr><td> </td><td>&nbsp;</td><td></td></tr></table>')).toBe(
      false,
    );
    expect(
      htmlHasTextTable(
        '<table class=MsoTableGrid><tr><td><p class=MsoNormal><img width=16 height=16 src="file:///C:/clip_image001.png"></p></td></tr></table>',
      ),
    ).toBe(false);
    expect(htmlHasTextTable('')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* Inert and hostile HTML (U28, U29)                                        */
/* ------------------------------------------------------------------------ */

describe('inert and hostile HTML', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).__ran;
    delete (window as unknown as Record<string, unknown>).__ran2;
  });

  it('U28: scripts do not run, event handlers do not fire and nothing is fetched', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html =
      '<link rel="stylesheet" href="https://example.org/a.css"><script>window.__ran2 = 1</script>' +
      '<table><tr><td>a<img src="https://example.org/p.png" onerror="window.__ran = 1">' +
      '<script>window.__ran2 = 1</script></td></tr></table>' +
      '<img src="https://example.org/q.png" onerror="window.__ran = 1">';
    const paste = parseForeignHtml(html);
    expect(htmlHasTextTable(html)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((window as unknown as Record<string, unknown>).__ran).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__ran2).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(tablesOf(paste)[0]!.table.textContent).toBe('a');
    // Nothing of the pasted document is attached to the page.
    expect(document.querySelectorAll('img, script, link[href*="example.org"]')).toHaveLength(0);
  });

  it('U29: unclosed tags, 2,000 nested divs, 50 nested tables, huge spans and 5,000 rows convert within a coarse bound; the spans are capped and the result regular, or too-large for an irregular table above the grid limit', () => {
    const started = performance.now();
    const unclosed = parseForeignHtml('<table><tr><td>a<b>bold<td>b<i>it</table><p>after');
    expect(rowsOf(regular(tablesOf(unclosed)[0]!.table))).toEqual([
      [
        { k: 'td', t: 'abold', m: ['strong'] },
        { k: 'td', t: 'bit', m: ['emphasis'] },
      ],
    ]);
    const deep = `<table><tr><td>${'<div>'.repeat(2000)}deep${'</div>'.repeat(2000)}</td></tr></table>`;
    expect(onlyTable(deep).textContent).toBe('deep');
    let nested = 'core';
    for (let level = 0; level < 50; level += 1)
      nested = `<table><tr><td>${nested}</td></tr></table>`;
    const nestedTable = onlyTable(nested);
    expect(gridOfNode(nestedTable).height).toBe(1);
    expect(nestedTable.textContent).toBe('core');
    // A cell spanning 1000 columns and 65534 rows: capped, then made regular.
    const huge = regular(
      onlyTable(
        '<table><tr><td colspan="1000" rowspan="65534">x</td><td>y</td></tr><tr><td>z</td></tr></table>',
      ),
    );
    expect(gridOfNode(huge).regular).toBe(true);
    expect(effectiveColspan(huge.child(0).child(0).attrs.colspan)).toBe(1000);
    // 5,000 rows.
    const many = `<table>${'<tr><td>r</td><td>s</td></tr>'.repeat(5000)}</table>`;
    const manyTable = regular(onlyTable(many));
    expect(gridOfNode(manyTable).height).toBe(5000);
    expect(gridOfNode(manyTable).regular).toBe(true);
    // Irregular and above MAX_GRID_POSITIONS: refused as too large.
    // (Every row reaches column 1000, so no column is phantom and the table stays too large.)
    const irregular = onlyTable(
      `<table><tr><td colspan="1000">wide</td><td>x</td></tr>${'<tr><td colspan="1000">r</td></tr>'.repeat(4200)}</table>`,
    );
    expect(gridOfNode(irregular).tooLarge).toBe(true);
    expect(
      regularisePastedTable(
        irregular,
        { foreign: true, keepRows: false },
        { nextId: idGenerator() },
      ),
    ).toEqual({ refused: 'too-large' });
    expect(performance.now() - started).toBeLessThan(30_000);
  });
});
