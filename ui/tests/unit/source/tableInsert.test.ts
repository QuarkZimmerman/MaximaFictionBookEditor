/**
 * The XML that *Add → Table* inserts in the Source view (feature 006, T055; FR-061 "What" and
 * "Undo", FR-003; US1 sc.10; U35; data-model §7.3 "The inserted XML" and "One undo step";
 * research R4.5, R4.6): `sourceTableLines` - FR-003's table from the dialog's values, header
 * row and header column, the parent's prefix, no attribute -, and
 * `planSourceTableInsertion` - laid out like the neighbours (a tab per level as the writer
 * writes, or the neighbours' own step), the white space around the point replaced so the
 * neighbours keep their indentation, the text's own line separator, the compact one-line form
 * when the parent's start and end tags share a line, the cursor between the first cell's tags;
 * and through `SourceEditorController.insertTable` one transaction, `input.table`, isolated in
 * the history, so that typing in the first cell is a step of its own, followed by a
 * selection-only one, so that Redo gives back the cursor in the first cell.
 */

import { undoDepth } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';

import { createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { sourceLanguage } from '@/views/source/extensions';
import { SourceEditorController } from '@/views/source/sourceEditor';
import { sourceSession } from '@/views/source/sourceSession';
import {
  planSourceTableInsertion,
  sourceTableLines,
  type SourceTableSpec,
} from '@/views/source/tableInsert';
import { sourceTablePoint, type SourceVerdict } from '@/views/source/tablePoint';

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const TWO_BY_THREE: SourceTableSpec = {
  rows: 2,
  columns: 3,
  headerRow: false,
  headerColumn: false,
};

/** A book whose body is `body` (lines joined with `\n` unless `separator` says otherwise). */
function book(body: string[], separator = '\n'): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<FictionBook xmlns="${FB2_NS}">`,
    '\t<body>',
    ...body,
    '\t</body>',
    '</FictionBook>',
    '',
  ].join(separator);
}

const WRITER = book([
  '\t\t<section>',
  '\t\t\t<p>First</p>',
  '\t\t\t<p>Second</p>',
  '\t\t</section>',
]);

function offsetOf(text: string, needle: string, nth = 0): number {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) {
    at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`"${needle}" not in the text`);
  }
  return at;
}

const after = (text: string, needle: string, nth = 0) =>
  offsetOf(text, needle, nth) + needle.length;

function stateOf(doc: string, separator?: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [sourceLanguage(), ...(separator ? [EditorState.lineSeparator.of(separator)] : [])],
  });
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return state;
}

/** The `ok` verdict at `at` (fails the test for any other). */
function okAt(state: EditorState, at: number): Extract<SourceVerdict, { code: 'ok' }> {
  const verdict = sourceTablePoint(state, { status: 'ready', parseError: null }, at);
  expect(verdict.code).toBe('ok');
  return verdict as Extract<SourceVerdict, { code: 'ok' }>;
}

/** The text after the planned insertion at `at`, and the cursor in it. */
function inserted(doc: string, at: number, spec = TWO_BY_THREE, separator?: string) {
  const state = stateOf(doc, separator);
  const plan = planSourceTableInsertion(state, okAt(state, at), spec);
  expect(plan.from).toBeLessThanOrEqual(at);
  expect(plan.to).toBeGreaterThanOrEqual(at);
  const next = state.update({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    selection: { anchor: plan.cursor },
  }).state;
  return { plan, text: next.sliceDoc(), cursor: plan.cursor, state: next };
}

/** FR-003's 2 × 3 table at the indentation `indent`, one level being `unit`. */
function tableBlock(indent: string, unit: string, rows = 2, columns = 3): string[] {
  const lines = [`${indent}<table>`];
  for (let r = 0; r < rows; r += 1) {
    lines.push(`${indent}${unit}<tr>`);
    for (let c = 0; c < columns; c += 1) lines.push(`${indent}${unit}${unit}<td></td>`);
    lines.push(`${indent}${unit}</tr>`);
  }
  lines.push(`${indent}</table>`);
  return lines;
}

/** The cursor is between the first cell's tags. */
function expectCursorInFirstCell(text: string, cursor: number, prefix = '', cell = 'td') {
  const open = `<${prefix ? `${prefix}:` : ''}${cell}>`;
  const close = `</${prefix ? `${prefix}:` : ''}${cell}>`;
  expect(text.slice(cursor - open.length, cursor)).toBe(open);
  expect(text.slice(cursor, cursor + close.length)).toBe(close);
  expect(text.indexOf(open)).toBe(cursor - open.length);
}

/* ------------------------------------------------------------------------ */
/* The lines                                                                */
/* ------------------------------------------------------------------------ */

describe('sourceTableLines: FR-003’s table from the dialog’s values', () => {
  const texts = (spec: SourceTableSpec, prefix = '') =>
    sourceTableLines(spec, prefix).map((line) => `${'.'.repeat(line.depth)}${line.text}`);
  const small = { rows: 2, columns: 2 };

  it('writes rows × columns normal cells without a header', () => {
    expect(texts({ ...small, headerRow: false, headerColumn: false })).toEqual([
      '<table>',
      '.<tr>',
      '..<td></td>',
      '..<td></td>',
      '.</tr>',
      '.<tr>',
      '..<td></td>',
      '..<td></td>',
      '.</tr>',
      '</table>',
    ]);
  });

  it('writes a header row of th cells before the rows', () => {
    expect(texts({ ...small, headerRow: true, headerColumn: false })).toEqual([
      '<table>',
      '.<tr>',
      '..<th></th>',
      '..<th></th>',
      '.</tr>',
      '.<tr>',
      '..<td></td>',
      '..<td></td>',
      '.</tr>',
      '.<tr>',
      '..<td></td>',
      '..<td></td>',
      '.</tr>',
      '</table>',
    ]);
  });

  it('starts every row with a th cell for a header column', () => {
    expect(texts({ ...small, headerRow: false, headerColumn: true })).toEqual([
      '<table>',
      '.<tr>',
      '..<th></th>',
      '..<td></td>',
      '.</tr>',
      '.<tr>',
      '..<th></th>',
      '..<td></td>',
      '.</tr>',
      '</table>',
    ]);
  });

  it('combines both: a header row, then rows that start with a th cell', () => {
    expect(texts({ ...small, headerRow: true, headerColumn: true })).toEqual([
      '<table>',
      '.<tr>',
      '..<th></th>',
      '..<th></th>',
      '.</tr>',
      '.<tr>',
      '..<th></th>',
      '..<td></td>',
      '.</tr>',
      '.<tr>',
      '..<th></th>',
      '..<td></td>',
      '.</tr>',
      '</table>',
    ]);
  });

  it('puts the parent’s prefix on every name and writes no attribute', () => {
    expect(texts({ rows: 1, columns: 1, headerRow: true, headerColumn: false }, 'fb')).toEqual([
      '<fb:table>',
      '.<fb:tr>',
      '..<fb:th></fb:th>',
      '.</fb:tr>',
      '.<fb:tr>',
      '..<fb:td></fb:td>',
      '.</fb:tr>',
      '</fb:table>',
    ]);
    const all = sourceTableLines({ rows: 3, columns: 4, headerRow: true, headerColumn: true }, '');
    expect(all.every((line) => !/\s/.test(line.text))).toBe(true);
  });

  it('writes the largest table, 999 × 64 with a header row, as about 66,000 lines', () => {
    const lines = sourceTableLines(
      { rows: 999, columns: 64, headerRow: true, headerColumn: false },
      '',
    );
    expect(lines).toHaveLength(2 + 1000 * (64 + 2));
  });
});

/* ------------------------------------------------------------------------ */
/* The layouts                                                              */
/* ------------------------------------------------------------------------ */

describe('planSourceTableInsertion: laid out like the neighbours', () => {
  const expectedWriter = book([
    '\t\t<section>',
    '\t\t\t<p>First</p>',
    ...tableBlock('\t\t\t', '\t'),
    '\t\t\t<p>Second</p>',
    '\t\t</section>',
  ]);

  it('1. the writer’s tab layout, the point right after </p>', () => {
    const { text, cursor, plan } = inserted(WRITER, after(WRITER, '<p>First</p>'));
    expect(text).toBe(expectedWriter);
    expectCursorInFirstCell(text, cursor);
    expect(plan.from).toBe(plan.to);
  });

  it('2. the point at the start of the next line’s indentation, or inside it', () => {
    const start = after(WRITER, '<p>First</p>\n');
    expect(inserted(WRITER, start).text).toBe(expectedWriter);
    expect(inserted(WRITER, start + 2).text).toBe(expectedWriter);
    // A blank line of white space between the paragraphs takes the table instead.
    const blank = WRITER.replace('<p>First</p>\n', '<p>First</p>\n\t\t\t\n');
    expect(inserted(blank, after(blank, '<p>First</p>\n\t')).text).toBe(expectedWriter);
  });

  it('3. a two-space indentation: the neighbours’ step is the unit', () => {
    const spaces = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<FictionBook xmlns="${FB2_NS}">`,
      '  <body>',
      '    <section>',
      '      <p>First</p>',
      '      <p>Second</p>',
      '    </section>',
      '  </body>',
      '</FictionBook>',
      '',
    ].join('\n');
    const { text, cursor } = inserted(spaces, after(spaces, '<p>First</p>'));
    expect(text).toBe(
      spaces.replace(
        '      <p>Second</p>',
        [...tableBlock('      ', '  '), '      <p>Second</p>'].join('\n'),
      ),
    );
    expectCursorInFirstCell(text, cursor);
  });

  it('4. a first child on the next line: the table before it, at its indentation', () => {
    const { text, cursor } = inserted(WRITER, after(WRITER, '<section>'));
    expect(text).toBe(
      book([
        '\t\t<section>',
        ...tableBlock('\t\t\t', '\t'),
        '\t\t\t<p>First</p>',
        '\t\t\t<p>Second</p>',
        '\t\t</section>',
      ]),
    );
    expectCursorInFirstCell(text, cursor);
  });

  it('5. after the last child: the previous child’s indentation', () => {
    const { text, cursor } = inserted(WRITER, after(WRITER, '<p>Second</p>'));
    expect(text).toBe(
      book([
        '\t\t<section>',
        '\t\t\t<p>First</p>',
        '\t\t\t<p>Second</p>',
        ...tableBlock('\t\t\t', '\t'),
        '\t\t</section>',
      ]),
    );
    expectCursorInFirstCell(text, cursor);
  });

  it('6. a parent whose start and end tags share a line: the compact form', () => {
    const oneLine = book([
      '\t\t<section>',
      '\t\t\t<cite><p>a</p><p>b</p></cite>',
      '\t\t</section>',
    ]);
    const { text, cursor, plan } = inserted(oneLine, after(oneLine, '<p>a</p>'));
    const compact =
      '<table><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table>';
    expect(plan.insert).toBe(compact);
    expect(text).toBe(oneLine.replace('<p>a</p><p>b</p>', `<p>a</p>${compact}<p>b</p>`));
    expectCursorInFirstCell(text, cursor);
    // A minified book (everything on one line) is written the same way.
    const minified = `<FictionBook xmlns="${FB2_NS}"><body><section><p>a</p><p>b</p></section></body></FictionBook>`;
    expect(inserted(minified, after(minified, '<p>a</p>')).plan.insert).toBe(compact);
  });

  it('7. a childless parent on one line: the compact form too (U35)', () => {
    const childless = book([
      '\t\t<section>',
      '\t\t\t<annotation></annotation>',
      '\t\t\t<p>Text</p>',
      '\t\t</section>',
    ]);
    const { text, cursor } = inserted(childless, after(childless, '<annotation>'), {
      rows: 1,
      columns: 2,
      headerRow: true,
      headerColumn: false,
    });
    expect(text).toBe(
      childless.replace(
        '<annotation></annotation>',
        '<annotation><table><tr><th></th><th></th></tr><tr><td></td><td></td></tr></table></annotation>',
      ),
    );
    expectCursorInFirstCell(text, cursor, '', 'th');
  });

  it('writes the header combinations and the parent’s prefix into the text', () => {
    const prefixed = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<fb:FictionBook xmlns:fb="${FB2_NS}">`,
      '\t<fb:body>',
      '\t\t<fb:section>',
      '\t\t\t<fb:p>First</fb:p>',
      '\t\t\t<fb:p>Second</fb:p>',
      '\t\t</fb:section>',
      '\t</fb:body>',
      '</fb:FictionBook>',
      '',
    ].join('\n');
    const { text, cursor } = inserted(prefixed, after(prefixed, '<fb:p>First</fb:p>'), {
      rows: 1,
      columns: 2,
      headerRow: false,
      headerColumn: true,
    });
    expect(text).toBe(
      prefixed.replace(
        '\t\t\t<fb:p>Second</fb:p>',
        [
          '\t\t\t<fb:table>',
          '\t\t\t\t<fb:tr>',
          '\t\t\t\t\t<fb:th></fb:th>',
          '\t\t\t\t\t<fb:td></fb:td>',
          '\t\t\t\t</fb:tr>',
          '\t\t\t</fb:table>',
          '\t\t\t<fb:p>Second</fb:p>',
        ].join('\n'),
      ),
    );
    expectCursorInFirstCell(text, cursor, 'fb', 'th');
    for (const headerRow of [false, true]) {
      for (const headerColumn of [false, true]) {
        const spec = { rows: 2, columns: 2, headerRow, headerColumn };
        const result = inserted(WRITER, after(WRITER, '<p>First</p>'), spec);
        const cells = (result.text.match(/<t[dh]><\/t[dh]>/g) ?? []).length;
        expect(cells, JSON.stringify(spec)).toBe((2 + (headerRow ? 1 : 0)) * 2);
        expectCursorInFirstCell(
          result.text,
          result.cursor,
          '',
          headerRow || headerColumn ? 'th' : 'td',
        );
      }
    }
  });

  it('keeps a CRLF text CRLF', () => {
    // CodeMirror counts a line break as one character whatever the separator: the offsets of
    // the document are those of the LF text, its CRLF form is what `sliceDoc` gives.
    const crlf = book(
      ['\t\t<section>', '\t\t\t<p>First</p>', '\t\t\t<p>Second</p>', '\t\t</section>'],
      '\r\n',
    );
    const { text, plan, cursor, state } = inserted(
      crlf,
      after(WRITER, '<p>First</p>'),
      TWO_BY_THREE,
      '\r\n',
    );
    expect(plan.insert).toContain('\r\n');
    expect(plan.insert.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text).toBe(expectedWriter.replace(/\n/g, '\r\n'));
    expect(state.doc.toString()).toBe(expectedWriter);
    expectCursorInFirstCell(state.doc.toString(), cursor);
  });
});

/* ------------------------------------------------------------------------ */
/* One undo step                                                            */
/* ------------------------------------------------------------------------ */

describe('SourceEditorController.insertTable: one transaction, one undo step', () => {
  async function loaded(text: string) {
    const store = createAppStore();
    const undo = new UndoCoordinator();
    const controller = new SourceEditorController({ store, undo });
    const session = sourceSession(store);
    session.docId = 'doc-1';
    session.text = text;
    session.baseline = text;
    await controller.load({ store, rpc: null } as never);
    ensureSyntaxTree(controller.state, controller.state.doc.length, 10_000);
    return { store, undo, controller };
  }

  it('dispatches one input.table transaction, records one entry, and typing starts a new step', async () => {
    const { undo, controller } = await loaded(WRITER);
    const point = after(WRITER, '<p>First</p>');
    controller.setSelection(point, point);
    const depth = undoDepth(controller.state);
    const entries = undo.entries().length;
    const dispatch = vi.spyOn(controller, 'dispatchHeadless');

    expect(controller.insertTable(TWO_BY_THREE)).toBe(true);
    // The change, then the cursor alone - which the history keeps for Redo.
    expect(dispatch).toHaveBeenCalledTimes(2);
    const spec = dispatch.mock.calls[0]![0] as TransactionSpec;
    expect(spec.userEvent).toBe('input.table');
    expect(spec.scrollIntoView).toBe(true);
    const cursorOnly = dispatch.mock.calls[1]![0] as TransactionSpec;
    expect(cursorOnly.changes).toBeUndefined();
    expect(cursorOnly.selection).toEqual({ anchor: controller.state.selection.main.head });
    expect(undoDepth(controller.state)).toBe(depth + 1);
    expect(undo.entries()).toHaveLength(entries + 1);
    expect(undo.peekUndo()).toMatchObject({ view: 'source', label: 'views.source.undoLabel' });
    const withTable = controller.text;
    expect(withTable).toBe(
      book([
        '\t\t<section>',
        '\t\t\t<p>First</p>',
        ...tableBlock('\t\t\t', '\t'),
        '\t\t\t<p>Second</p>',
        '\t\t</section>',
      ]),
    );
    const cursor = controller.state.selection.main.head;
    expect(controller.state.selection.main.empty).toBe(true);
    expectCursorInFirstCell(withTable, cursor);

    // Typing right away, in the first cell, is a step of its own (isolateHistory 'full').
    controller.target.dispatch({
      changes: { from: cursor, insert: 'X' },
      selection: EditorSelection.cursor(cursor + 1),
      userEvent: 'input.type',
    });
    expect(undoDepth(controller.state)).toBe(depth + 2);
    expect(undo.entries()).toHaveLength(entries + 2);
    expect(controller.undoStep()).toBe(true);
    expect(controller.text).toBe(withTable);
    expect(controller.undoStep()).toBe(true);
    expect(controller.text).toBe(WRITER);
    expect(controller.state.selection.main.head).toBe(point);
    // Redo brings the table back with the cursor in its first cell, as the insertion left it.
    expect(controller.redoStep()).toBe(true);
    expect(controller.text).toBe(withTable);
    expect(controller.state.selection.main).toMatchObject({ anchor: cursor, head: cursor });
  });

  it('keeps a non-empty selection’s text and inserts at its end', async () => {
    const { controller } = await loaded(WRITER);
    controller.setSelection(offsetOf(WRITER, '\t\t\t<p>First'), after(WRITER, '<p>First</p>'));
    expect(controller.insertTable(TWO_BY_THREE)).toBe(true);
    expect(controller.text).toContain('<p>First</p>\n\t\t\t<table>');
    expect(controller.text).toContain('<p>Second</p>');
  });
});
