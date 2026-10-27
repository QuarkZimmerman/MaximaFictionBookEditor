/**
 * T084 - tree rows (kinds, captions, nesting, caching), visible rows with collapsed containers,
 * row lookup for Body selections, and the View Source position search. Feature 004 (US2): the
 * Annotation and History rows come first, at depth 0, whatever the document holds; a Body
 * selection inside the description's annotation or history maps to its block row. Feature 006
 * (US8, T126; FR-058; decision 8; C58; I18): a table row carries the summary of an irregular
 * table, and the rows of a cite, a section annotation, an epigraph and the two block rows the
 * summaries of the irregular tables they contain, in document order - the source book's
 * annotation, which has no row, gives none -, cached with the section's rows.
 */

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { gridOfNode } from '@/editor/table/grid';
import { locateInSource, nthTagOffset, tagOrdinal } from '@/features/tree/sourceLocate';
import type { BodyNode, Document } from '@/model/document';
import { FIXED_BLOCK_IDS } from '@/editor/schema';
import type { AnnotationNode } from '@/model/document';
import {
  buildTreeIndex,
  captionFor,
  normalizeCaption,
  rowForNode,
  rowForSelection,
  visibleRows,
  type BlockCaptions,
} from '@/views/tree/treeModel';

import { fakeDocument } from '../features/testUtils';

const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const p = (nodeId: string, value: string): ModelNodeJson => ({
  type: 'p',
  attrs: { nodeId },
  content: [text(value)],
});

function book(): Document {
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body1' },
    content: [
      { type: 'title', attrs: { nodeId: 'tBook' }, content: [p('pBook', 'The   Book ')] },
      {
        type: 'section',
        attrs: { nodeId: 'A', id: 'chapter-a' },
        content: [
          { type: 'title', attrs: { nodeId: 'tA' }, content: [p('pA', 'Chapter A')] },
          {
            type: 'epigraph',
            attrs: { nodeId: 'eA' },
            content: [
              p('pE', 'Wise words'),
              { type: 'text-author', attrs: { nodeId: 'ta' }, content: [text('Someone')] },
            ],
          },
          { type: 'image', attrs: { nodeId: 'imgA', href: '#cover.jpg' } },
          { type: 'annotation', attrs: { nodeId: 'anA' }, content: [p('pAn', 'About A')] },
          {
            type: 'section',
            attrs: { nodeId: 'A1' },
            content: [
              { type: 'title', attrs: { nodeId: 'tA1' }, content: [p('pA1t', 'A1')] },
              p('pA1', 'Text with an <image/> inline'),
              {
                type: 'poem',
                attrs: { nodeId: 'poem1' },
                content: [
                  { type: 'title', attrs: { nodeId: 'tPoem' }, content: [p('pPoem', 'Ode')] },
                  {
                    type: 'stanza',
                    attrs: { nodeId: 'st1' },
                    content: [{ type: 'v', attrs: { nodeId: 'v1' }, content: [text('line')] }],
                  },
                ],
              },
              { type: 'cite', attrs: { nodeId: 'cite1' }, content: [p('pCite', 'Quoted text')] },
              {
                type: 'table',
                attrs: { nodeId: 'tbl1' },
                content: [
                  {
                    type: 'tr',
                    attrs: { nodeId: 'tr1' },
                    content: [{ type: 'td', attrs: { nodeId: 'td1' }, content: [text('cell')] }],
                  },
                ],
              },
            ],
          },
          { type: 'section', attrs: { nodeId: 'A2' }, content: [p('pA2', 'No title here')] },
        ],
      },
    ],
  };
  const notes: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'body2', name: 'notes' },
    content: [{ type: 'section', attrs: { nodeId: 'N1' }, content: [p('pN1', 'note')] }],
  };
  const document = fakeDocument({ bodies: [body, notes] as unknown as BodyNode[] });
  document.description.titleInfo.annotation = {
    type: 'annotation',
    attrs: { nodeId: 'descAnn' },
    content: [p('pAnn', 'About the book')],
  } as unknown as AnnotationNode;
  document.description.documentInfo.history = {
    type: 'annotation',
    attrs: { nodeId: 'descHist' },
    content: [p('pHist', 'v1')],
  } as unknown as AnnotationNode;
  return document;
}

const CAPTIONS: BlockCaptions = { annotation: 'Annotation', history: 'History' };
const BLOCK_ROWS = [FIXED_BLOCK_IDS.annotation, FIXED_BLOCK_IDS.history];

describe('tree model', () => {
  it('builds rows for bodies, sections and the leaf kinds with FBE captions', () => {
    const index = buildTreeIndex(book(), CAPTIONS);
    expect(index.roots).toEqual([...BLOCK_ROWS, 'body1', 'body2']);
    expect(index.order).toEqual([
      ...BLOCK_ROWS,
      'body1',
      'tBook',
      'A',
      'tA',
      'eA',
      'imgA',
      'anA',
      'A1',
      'tA1',
      'poem1',
      'cite1',
      'tbl1',
      'A2',
      'body2',
      'N1',
    ]);
    expect(index.sectionCount).toBe(4);
    const row = (id: string) => index.rows.get(id)!;
    expect(row('body1').caption).toBe('The Book');
    expect(row('body2').caption).toBe('notes');
    expect(row('A').caption).toBe('Chapter A');
    expect(row('A').depth).toBe(1);
    expect(row('A').childIds).toEqual(['tA', 'eA', 'imgA', 'anA', 'A1', 'A2']);
    expect(row('tA').caption).toBe('Chapter A');
    expect(row('eA').caption).toBe('Wise words Someone');
    expect(row('imgA').caption).toBe('cover.jpg');
    expect(row('anA').caption).toBe('About A');
    expect(row('poem1').caption).toBe('Ode');
    expect(row('cite1').caption).toBe('Quoted text');
    expect(row('tbl1').caption).toBe('cell');
    expect(row('A2').caption).toBe('<section>');
    expect(row('A1').depth).toBe(2);
    expect(row('poem1').parentId).toBe('A1');
  });

  it('normalises and truncates captions', () => {
    expect(normalizeCaption('  a \n b  ')).toBe('a b');
    const long = 'x'.repeat(200);
    expect(normalizeCaption(long)).toHaveLength(80);
    expect(normalizeCaption(long).endsWith('\u2026')).toBe(true);
    expect(
      captionFor({ type: 'image', attrs: { nodeId: 'i', href: '', alt: 'Alt text' } }, 'image'),
    ).toBe('Alt text');
    expect(captionFor({ type: 'image', attrs: { nodeId: 'i', href: '' } }, 'image')).toBe(
      '<image>',
    );
  });

  it('reuses the rows of unchanged top-level sections', () => {
    const doc = book();
    const first = buildTreeIndex(doc, CAPTIONS);
    const notes = doc.bodies[1]!;
    const edited: Document = {
      ...doc,
      bodies: [
        doc.bodies[0]!,
        {
          ...notes,
          content: notes.content.map((child) => ({
            ...child,
            content: [p('pN1', 'changed note')],
          })) as BodyNode['content'],
        },
      ],
    };
    const second = buildTreeIndex(edited, CAPTIONS);
    expect(second.rows.get('A')).toBe(first.rows.get('A'));
    expect(second.rows.get('N1')).not.toBe(first.rows.get('N1'));
    expect(second.rows.get('N1')!.caption).toBe('<section>');
  });

  it('hides the children of collapsed rows', () => {
    const index = buildTreeIndex(book(), CAPTIONS);
    expect(visibleRows(index, new Set()).map((r) => r.id)).toEqual(index.order);
    expect(visibleRows(index, new Set(['A'])).map((r) => r.id)).toEqual([
      ...BLOCK_ROWS,
      'body1',
      'tBook',
      'A',
      'body2',
      'N1',
    ]);
    expect(visibleRows(index, new Set(['A1'])).map((r) => r.id)).toContain('A2');
    expect(visibleRows(index, new Set(['A1'])).map((r) => r.id)).not.toContain('poem1');
  });

  it('lists the Annotation and History rows first, at depth 0, whatever the document holds', () => {
    const index = buildTreeIndex(book(), CAPTIONS);
    const annotation = index.rows.get(FIXED_BLOCK_IDS.annotation)!;
    const history = index.rows.get(FIXED_BLOCK_IDS.history)!;
    expect(annotation).toMatchObject({
      kind: 'annotationBlock',
      caption: 'Annotation',
      depth: 0,
      parentId: null,
      childIds: [],
    });
    expect(history).toMatchObject({ kind: 'historyBlock', caption: 'History', depth: 0 });
    expect(index.order.slice(0, 2)).toEqual(BLOCK_ROWS);
    expect(index.sectionCount).toBe(4);
    // A document without the elements (and without a body) still lists both rows.
    const bare = fakeDocument({ bodies: [] });
    const empty = buildTreeIndex(bare, { annotation: 'Анотація', history: 'Історія' });
    expect(empty.order).toEqual(BLOCK_ROWS);
    expect(empty.rows.get(FIXED_BLOCK_IDS.annotation)!.caption).toBe('Анотація');
    expect(empty.rows.get(FIXED_BLOCK_IDS.history)!.caption).toBe('Історія');
    expect(buildTreeIndex(null, CAPTIONS).order).toEqual([]);
  });

  it('maps a Body selection inside the description to its block row', () => {
    const doc = book();
    const index = buildTreeIndex(doc, CAPTIONS);
    expect(rowForNode(index, doc, FIXED_BLOCK_IDS.annotation)).toBe(FIXED_BLOCK_IDS.annotation);
    expect(rowForNode(index, doc, 'pAnn')).toBe(FIXED_BLOCK_IDS.annotation);
    expect(rowForNode(index, doc, 'descAnn')).toBe(FIXED_BLOCK_IDS.annotation);
    expect(rowForNode(index, doc, 'pHist')).toBe(FIXED_BLOCK_IDS.history);
    expect(rowForNode(index, doc, 'descHist')).toBe(FIXED_BLOCK_IDS.history);
    // An empty block holds a UI paragraph the model does not know: the status path names it.
    expect(rowForSelection(index, doc, 'ui_7', 'title-info/annotation[1]/p[1]')).toBe(
      FIXED_BLOCK_IDS.annotation,
    );
    expect(rowForSelection(index, doc, 'ui_7', 'document-info/history[1]/p[1]')).toBe(
      FIXED_BLOCK_IDS.history,
    );
    expect(rowForSelection(index, doc, 'ui_7', 'body[1]/section[1]/p[1]')).toBeNull();
    expect(rowForSelection(index, doc, 'pA1', 'body[1]/section[1]/section[1]/p[1]')).toBe('A1');
  });

  it('maps a Body selection to the innermost row', () => {
    const doc = book();
    const index = buildTreeIndex(doc, CAPTIONS);
    expect(rowForNode(index, doc, 'pA1')).toBe('A1'); // paragraph -> its section
    expect(rowForNode(index, doc, 'v1')).toBe('poem1'); // verse -> its poem
    expect(rowForNode(index, doc, 'td1')).toBe('tbl1');
    expect(rowForNode(index, doc, 'pA')).toBe('tA'); // title paragraph -> the title row
    expect(rowForNode(index, doc, 'A')).toBe('A');
    expect(rowForNode(index, doc, 'missing')).toBeNull();
    expect(rowForNode(index, doc, null)).toBeNull();
  });
});

describe('view source position', () => {
  const xml = [
    '<?xml version="1.0"?>',
    '<FictionBook>',
    '  <description><title-info><book-title>T</book-title><annotation><p>a</p></annotation>',
    '    <coverpage><image l:href="#c.jpg"/></coverpage></title-info>',
    '    <document-info><history><p>v1</p></history></document-info></description>',
    '  <body>',
    '    <title><p>The Book</p></title>',
    '    <section id="chapter-a">',
    '      <title><p>Chapter A</p></title>',
    '      <epigraph><p>Wise words</p><text-author>Someone</text-author></epigraph>',
    '      <image l:href="#cover.jpg"/>',
    '      <annotation><p>About A</p></annotation>',
    '      <section>',
    '        <title><p>A1</p></title>',
    '        <p>Text with an <image l:href="#x"/> inline</p>',
    '        <poem><title><p>Ode</p></title><stanza><v>line</v></stanza></poem>',
    '        <cite><p>Quoted text</p></cite>',
    '        <table><tr><td>cell</td></tr></table>',
    '      </section>',
    '      <section><p>No title here</p></section>',
    '    </section>',
    '  </body>',
    '  <body name="notes"><section><p>note</p></section></body>',
    '</FictionBook>',
  ].join('\n');

  it('counts same-type tags in document order (inline images included)', () => {
    const doc = book();
    expect(tagOrdinal(doc, 'A')).toBe(0);
    expect(tagOrdinal(doc, 'A1')).toBe(1);
    expect(tagOrdinal(doc, 'A2')).toBe(2);
    expect(tagOrdinal(doc, 'N1')).toBe(3);
    expect(tagOrdinal(doc, 'tA1')).toBe(2); // body title, A's title, A1's title
    expect(tagOrdinal(doc, 'body2')).toBe(1);
    expect(tagOrdinal(doc, 'nope')).toBeNull();
    expect(nthTagOffset('<title-info/><title/>', 'title', 0)).toBe(13);
  });

  it('finds the element by id, else by the n-th tag after <body>', () => {
    const doc = book();
    const byId = locateInSource(xml, doc, 'A')!;
    expect(xml.slice(byId.offset, byId.offset + 23)).toBe('<section id="chapter-a"');
    expect(byId.line).toBe(8);
    expect(byId.column).toBe(5);
    const a2 = locateInSource(xml, doc, 'A2')!;
    expect(xml.slice(a2.offset, a2.offset + 9)).toBe('<section>');
    expect(a2.line).toBe(20);
    const image = locateInSource(xml, doc, 'imgA')!;
    expect(xml.slice(image.offset, image.offset + 26)).toBe('<image l:href="#cover.jpg"');
    expect(image.line).toBe(11);
    const notes = locateInSource(xml, doc, 'body2')!;
    expect(notes.line).toBe(23);
    expect(locateInSource(xml, doc, 'tbl1')!.line).toBe(18);
    expect(locateInSource(xml, doc, 'anA')!.line).toBe(12); // the description annotation is skipped
    expect(locateInSource(xml, doc, 'missing')).toBeNull();
  });

  it('finds the title-info annotation and the history for the block rows (004 US2)', () => {
    const doc = book();
    const annotation = locateInSource(xml, doc, FIXED_BLOCK_IDS.annotation)!;
    expect(annotation.line).toBe(3);
    expect(xml.slice(annotation.offset, annotation.offset + 12)).toBe('<annotation>');
    const history = locateInSource(xml, doc, FIXED_BLOCK_IDS.history)!;
    expect(history.line).toBe(5);
    expect(xml.slice(history.offset, history.offset + 9)).toBe('<history>');
    // The src-title-info annotation is skipped; an absent element lands on its parent block.
    const withSource = xml.replace(
      '</title-info>',
      '</title-info><src-title-info><annotation><p>s</p></annotation></src-title-info>',
    );
    expect(locateInSource(withSource, doc, FIXED_BLOCK_IDS.annotation)!.line).toBe(3);
    const noAnnotation = xml.replace('<annotation><p>a</p></annotation>', '');
    const fallback = locateInSource(noAnnotation, doc, FIXED_BLOCK_IDS.annotation)!;
    expect(noAnnotation.slice(fallback.offset, fallback.offset + 11)).toBe('<title-info');
    const noHistory = xml.replace('<history><p>v1</p></history>', '');
    const historyFallback = locateInSource(noHistory, doc, FIXED_BLOCK_IDS.history)!;
    expect(noHistory.slice(historyFallback.offset, historyFallback.offset + 14)).toBe(
      '<document-info',
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006, US8 (T126): irregular tables                                */
/* ------------------------------------------------------------------------ */

describe('irregular tables in the tree (feature 006, US8)', () => {
  const td = (nodeId: string, attrs: Record<string, unknown> = {}): ModelNodeJson => ({
    type: 'td',
    attrs: { nodeId, ...attrs },
    content: [text(nodeId)],
  });
  const tr = (nodeId: string, cells: ModelNodeJson[]): ModelNodeJson => ({
    type: 'tr',
    attrs: { nodeId },
    content: cells,
  });
  /** `[a, b] / [c]`: a short row. */
  const shortRow = (id: string, attrs: Record<string, unknown> = {}): ModelNodeJson => ({
    type: 'table',
    attrs: { nodeId: id, ...attrs },
    content: [tr(`${id}r0`, [td(`${id}a`), td(`${id}b`)]), tr(`${id}r1`, [td(`${id}c`)])],
  });
  /** `[a, b rowspan 2] / [c colspan 2]`: an overlap. */
  const overlap = (id: string): ModelNodeJson => ({
    type: 'table',
    attrs: { nodeId: id },
    content: [
      tr(`${id}r0`, [td(`${id}a`), td(`${id}b`, { rowspan: 2 })]),
      tr(`${id}r1`, [td(`${id}c`, { colspan: 2 })]),
    ],
  });
  /** `[a, b]`: regular. */
  const regular = (id: string): ModelNodeJson => ({
    type: 'table',
    attrs: { nodeId: id },
    content: [tr(`${id}r0`, [td(`${id}a`), td(`${id}b`)])],
  });
  const annotation = (nodeId: string, content: ModelNodeJson[]) =>
    ({ type: 'annotation', attrs: { nodeId }, content }) as unknown as AnnotationNode;

  function tablesBook(): Document {
    const body: ModelNodeJson = {
      type: 'body',
      attrs: { nodeId: 'body1' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 'S1' },
          content: [
            { type: 'title', attrs: { nodeId: 'tS1' }, content: [p('pS1', 'Tables')] },
            {
              type: 'epigraph',
              attrs: { nodeId: 'E1' },
              content: [{ type: 'cite', attrs: { nodeId: 'EC' }, content: [overlap('T6')] }],
            },
            { type: 'annotation', attrs: { nodeId: 'AN1' }, content: [shortRow('T5')] },
            p('pS1a', 'Text'),
            shortRow('T1'),
            regular('T2'),
            {
              type: 'cite',
              attrs: { nodeId: 'C1' },
              content: [
                p('pC1', 'Cited'),
                overlap('T3'),
                regular('T3b'),
                shortRow('T4', { id: 'named' }),
              ],
            },
          ],
        },
        {
          type: 'section',
          attrs: { nodeId: 'S2' },
          content: [p('pS2', 'Second'), regular('T7')],
        },
      ],
    };
    const doc = fakeDocument({ bodies: [body as unknown as BodyNode] });
    doc.description.titleInfo.annotation = annotation('ann', [
      p('pAnn', 'A'),
      shortRow('T8'),
      regular('T8b'),
    ]);
    doc.description.documentInfo.history = annotation('hist', [
      overlap('T9'),
      shortRow('T9b', { id: 'h9' }),
    ]);
    doc.description.srcTitleInfo = {
      ...doc.description.titleInfo,
      annotation: annotation('src', [shortRow('T10')]),
    };
    return doc;
  }

  /** The Body view's summary of a model table (`gridOfNode` over `nodeFromModel`). */
  const summaryOf = (table: ModelNodeJson) => gridOfNode(nodeFromModel(table)!).summary;

  function tableOf(doc: Document, id: string): ModelNodeJson {
    let found: ModelNodeJson | null = null;
    const visit = (node: ModelNodeJson) => {
      if (node.type === 'table' && node.attrs?.nodeId === id) found = node;
      for (const child of node.content ?? []) visit(child);
    };
    for (const root of [
      ...doc.bodies,
      doc.description.titleInfo.annotation,
      doc.description.documentInfo.history,
      doc.description.srcTitleInfo?.annotation,
    ]) {
      if (root) visit(root as unknown as ModelNodeJson);
    }
    if (!found) throw new Error(`no table ${id}`);
    return found;
  }

  it('tableProblems only on the rows of irregular tables; containedTables on a cite’s, a section annotation’s and an epigraph’s row and on the two block rows, in document order; nothing for the source book’s annotation', () => {
    const doc = tablesBook();
    const index = buildTreeIndex(doc, CAPTIONS);
    const row = (id: string) => index.rows.get(id)!;
    expect(row('T1').tableProblems).toEqual(summaryOf(tableOf(doc, 'T1')));
    expect(row('T2').tableProblems).toBeUndefined();
    expect(row('S2').containedTables).toBeUndefined();
    expect(row('C1').containedTables).toEqual([
      summaryOf(tableOf(doc, 'T3')),
      summaryOf(tableOf(doc, 'T4')),
    ]);
    expect(row('C1').containedTables![1]!.id).toBe('named');
    expect(row('AN1').containedTables).toEqual([summaryOf(tableOf(doc, 'T5'))]);
    expect(row('E1').containedTables).toEqual([summaryOf(tableOf(doc, 'T6'))]);
    expect(row(FIXED_BLOCK_IDS.annotation).containedTables).toEqual([
      summaryOf(tableOf(doc, 'T8')),
    ]);
    expect(row(FIXED_BLOCK_IDS.history).containedTables).toEqual([
      summaryOf(tableOf(doc, 'T9')),
      summaryOf(tableOf(doc, 'T9b')),
    ]);
    // No row of the tree stands for the source book's annotation (decision 8; C58): only the
    // rows above carry summaries, and T1 is the only table row with one.
    for (const one of index.rows.values()) {
      expect(one.tableProblems === undefined || one.id === 'T1', one.id).toBe(true);
    }
    expect(
      [...index.rows.values()]
        .filter((one) => one.containedTables)
        .map((one) => one.id)
        .sort(),
    ).toEqual(['AN1', 'C1', 'E1', FIXED_BLOCK_IDS.annotation, FIXED_BLOCK_IDS.history].sort());
    // A document without a description: the block rows have nothing.
    const bare = buildTreeIndex({ bodies: doc.bodies }, CAPTIONS);
    expect(bare.rows.get(FIXED_BLOCK_IDS.annotation)!.containedTables).toBeUndefined();
    expect(bare.rows.get('T1')!.tableProblems).toEqual(summaryOf(tableOf(doc, 'T1')));
  });

  it('a section’s rows - and their summaries - are reused after an edit in another section; the block rows’ summaries per annotation object', () => {
    const doc = tablesBook();
    const first = buildTreeIndex(doc, CAPTIONS);
    const body = doc.bodies[0]!;
    const edited: Document = {
      ...doc,
      bodies: [
        {
          ...body,
          content: [
            body.content[0]!,
            { ...(body.content[1] as object), content: [p('pS2', 'Edited'), shortRow('T7')] },
          ] as BodyNode['content'],
        },
      ],
    };
    const second = buildTreeIndex(edited, CAPTIONS);
    for (const id of ['S1', 'T1', 'C1', 'AN1', 'E1']) {
      expect(second.rows.get(id), id).toBe(first.rows.get(id));
    }
    expect(second.rows.get('T7')!.tableProblems).toEqual(summaryOf(shortRow('T7')));
    expect(second.rows.get(FIXED_BLOCK_IDS.annotation)!.containedTables).toBe(
      first.rows.get(FIXED_BLOCK_IDS.annotation)!.containedTables,
    );
  });
});
