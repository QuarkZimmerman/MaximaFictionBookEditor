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
import { shownEntries } from '@/views/tree/elementKinds';
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
    // Feature 011 (FR-010, FR-011, FR-014): the original's starting choices - no title, epigraph
    // or cite rows; stanzas under their poems, cells under their tables.
    const index = buildTreeIndex(book(), CAPTIONS);
    expect(index.roots).toEqual([...BLOCK_ROWS, 'body1', 'body2']);
    expect(index.order).toEqual([
      ...BLOCK_ROWS,
      'body1',
      'A',
      'imgA',
      'anA',
      'A1',
      'poem1',
      'st1',
      'tbl1',
      'td1',
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
    expect(row('A').childIds).toEqual(['imgA', 'anA', 'A1', 'A2']);
    expect(row('imgA').caption).toBe('cover.jpg');
    expect(row('anA').caption).toBe('About A');
    expect(row('poem1').caption).toBe('Ode');
    expect(row('st1').caption).toBe('<stanza>');
    expect(row('st1').parentId).toBe('poem1');
    expect(row('tbl1').caption).toBe('cell');
    expect(row('tbl1').childIds).toEqual(['td1']);
    expect(row('td1').caption).toBe('cell');
    expect(row('A2').caption).toBe('<section>');
    expect(row('A1').depth).toBe(2);
    expect(row('poem1').parentId).toBe('A1');
    // Every kind ticked: the title, epigraph and cite rows come back in their places.
    const all = buildTreeIndex(
      book(),
      CAPTIONS,
      shownEntries({ title: true, epigraph: true, quote: true }),
    );
    expect(all.rows.get('A')!.childIds).toEqual(['tA', 'eA', 'imgA', 'anA', 'A1', 'A2']);
    expect(all.rows.get('tA')!.caption).toBe('Chapter A');
    expect(all.rows.get('eA')!.caption).toBe('Wise words Someone');
    expect(all.rows.get('cite1')!.caption).toBe('Quoted text');
    expect(all.rows.get('poem1')!.childIds).toEqual(['tPoem', 'st1']);
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
    expect(rowForNode(index, doc, 'v1')).toBe('st1'); // verse -> its stanza (feature 011)
    expect(rowForNode(index, doc, 'td1')).toBe('td1'); // a cell has its own row (feature 011)
    expect(rowForNode(index, doc, 'pA')).toBe('A'); // title paragraph -> its section (no title rows)
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

  it('tableProblems on the rows of irregular tables, wherever they stand; containedTables on the rows above the tables that have no row of their own (hidden kinds), the two block rows included; nothing for the source book’s annotation', () => {
    const doc = tablesBook();
    // Feature 011 (FR-011, FR-014): tables have rows inside cites, epigraphs and annotations.
    const index = buildTreeIndex(doc, CAPTIONS);
    const row = (id: string) => index.rows.get(id)!;
    expect(row('T1').tableProblems).toEqual(summaryOf(tableOf(doc, 'T1')));
    expect(row('T2').tableProblems).toBeUndefined();
    expect(row('T3').tableProblems).toEqual(summaryOf(tableOf(doc, 'T3')));
    expect(row('T4').tableProblems!.id).toBe('named');
    expect(row('T5').parentId).toBe('AN1');
    expect(row('T6').parentId).toBe('S1'); // its epigraph and cite are hidden: the row moves up
    // The book's annotation and history hold their tables' rows, with their own marks.
    expect(row('T8').parentId).toBe(FIXED_BLOCK_IDS.annotation);
    expect(row('T8').tableProblems).toEqual(summaryOf(tableOf(doc, 'T8')));
    expect(row(FIXED_BLOCK_IDS.history).childIds).toEqual(['T9', 'T9b']);
    expect(row('T9b').tableProblems!.id).toBe('h9');
    expect([...index.rows.values()].filter((one) => one.containedTables)).toEqual([]);
    // Tables unticked, cites and epigraphs ticked: the rows above stand for their tables, in
    // document order, as feature 006 marked them.
    const hidden = buildTreeIndex(
      doc,
      CAPTIONS,
      shownEntries({ table: false, quote: true, epigraph: true }),
    );
    const at = (id: string) => hidden.rows.get(id)!;
    expect(at('C1').containedTables).toEqual([
      summaryOf(tableOf(doc, 'T3')),
      summaryOf(tableOf(doc, 'T4')),
    ]);
    expect(at('AN1').containedTables).toEqual([summaryOf(tableOf(doc, 'T5'))]);
    expect(at('EC').containedTables).toEqual([summaryOf(tableOf(doc, 'T6'))]);
    expect(at('S1').containedTables).toEqual([summaryOf(tableOf(doc, 'T1'))]);
    expect(at('S2').containedTables).toBeUndefined();
    expect(at(FIXED_BLOCK_IDS.annotation).containedTables).toEqual([summaryOf(tableOf(doc, 'T8'))]);
    expect(at(FIXED_BLOCK_IDS.history).containedTables).toEqual([
      summaryOf(tableOf(doc, 'T9')),
      summaryOf(tableOf(doc, 'T9b')),
    ]);
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
    for (const id of ['S1', 'T1', 'T3', 'AN1', 'T6']) {
      expect(second.rows.get(id), id).toBe(first.rows.get(id));
    }
    expect(second.rows.get('T7')!.tableProblems).toEqual(summaryOf(shortRow('T7')));
    expect(second.rows.get(FIXED_BLOCK_IDS.annotation)!.containedTables).toBe(
      first.rows.get(FIXED_BLOCK_IDS.annotation)!.containedTables,
    );
  });
});

// Feature 011 (US2; D33-D39, FR-010-FR-016; contracts/tree.md §1-§3): the original's rows.
describe('the rows of the original’s tree (feature 011)', () => {
  const subtitle = (nodeId: string, value: string): ModelNodeJson => ({
    type: 'subtitle',
    attrs: { nodeId },
    content: [text(value)],
  });
  const cell = (type: 'th' | 'td', nodeId: string, value?: string): ModelNodeJson => ({
    type,
    attrs: { nodeId },
    content: value ? [text(value)] : [],
  });
  const inlinePicture = (nodeId: string, href: string): ModelNodeJson => ({
    type: 'inline-image',
    attrs: { nodeId, href },
  });

  function kindsBook(): Document {
    const body: ModelNodeJson = {
      type: 'body',
      attrs: { nodeId: 'b' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 'S' },
          content: [
            { type: 'title', attrs: { nodeId: 'tS' }, content: [p('pS', 'The Gate')] },
            subtitle('sub1', 'At the door'),
            {
              type: 'p',
              attrs: { nodeId: 'pPic' },
              content: [
                text('A key '),
                inlinePicture('pic1', '#key.png'),
                text(' and a '),
                inlinePicture('ch1', '#ch-2605'),
              ],
            },
            {
              type: 'cite',
              attrs: { nodeId: 'C' },
              content: [p('pC', 'Quoted'), subtitle('sub2', 'Inside the quote')],
            },
            {
              type: 'table',
              attrs: { nodeId: 'T' },
              content: [
                {
                  type: 'tr',
                  attrs: { nodeId: 'r0' },
                  content: [cell('th', 'h1', ' Name '), cell('th', 'h2')],
                },
                {
                  type: 'tr',
                  attrs: { nodeId: 'r1' },
                  content: [cell('td', 'c1', 'x'.repeat(100)), cell('td', 'c2')],
                },
              ],
            },
          ],
        },
      ],
    };
    return fakeDocument({ bodies: [body as unknown as BodyNode] });
  }

  it('subtitles and inline pictures have rows; the pictures of special characters have none', () => {
    const index = buildTreeIndex(kindsBook(), CAPTIONS);
    expect(index.rows.get('sub1')).toMatchObject({ kind: 'subtitle', caption: 'At the door' });
    expect(index.rows.get('pic1')).toMatchObject({ kind: 'inline-image', caption: 'key.png' });
    expect(index.rows.has('ch1')).toBe(false);
    // The cite is hidden: the subtitle inside it stands under the section, in its place.
    expect(index.rows.get('sub2')!.parentId).toBe('S');
    expect(index.rows.get('S')!.childIds).toEqual(['sub1', 'pic1', 'sub2', 'T']);
  });

  it('table cells stand flat under their table with their own text; empty ones say <th> / <td>', () => {
    const index = buildTreeIndex(kindsBook(), CAPTIONS);
    expect(index.rows.get('T')!.childIds).toEqual(['h1', 'h2', 'c1', 'c2']);
    expect(index.rows.get('h1')).toMatchObject({ kind: 'th', caption: 'Name' });
    expect(index.rows.get('h2')!.caption).toBe('<th>');
    expect(index.rows.get('c2')!.caption).toBe('<td>');
    const long = index.rows.get('c1')!.caption;
    expect(long).toHaveLength(80);
    expect(long.endsWith('\u2026')).toBe(true);
  });

  it('a hidden kind passes its contents’ rows up; ticking it brings its row back', () => {
    const noTables = buildTreeIndex(kindsBook(), CAPTIONS, shownEntries({ table: false }));
    expect(noTables.rows.has('T')).toBe(false);
    expect(noTables.rows.get('h1')!.parentId).toBe('S');
    const quotes = buildTreeIndex(
      kindsBook(),
      CAPTIONS,
      shownEntries({ quote: true, title: true }),
    );
    expect(quotes.rows.get('C')!.childIds).toEqual(['sub2']);
    expect(quotes.rows.get('S')!.childIds).toEqual(['tS', 'sub1', 'pic1', 'C', 'T']);
    const noSections = buildTreeIndex(kindsBook(), CAPTIONS, shownEntries({ section: false }));
    expect(noSections.rows.get('b')!.childIds).toEqual(['sub1', 'pic1', 'sub2', 'T']);
  });
});

// Feature 011 (D37, contracts/tree.md §2): pictures in cells; the book's annotation and history.
describe('rows inside cells and inside the description blocks (feature 011)', () => {
  it('a picture inside a cell has its row under its cell’s', () => {
    const body: ModelNodeJson = {
      type: 'body',
      attrs: { nodeId: 'b' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 'S' },
          content: [
            {
              type: 'table',
              attrs: { nodeId: 'T' },
              content: [
                {
                  type: 'tr',
                  attrs: { nodeId: 'r' },
                  content: [
                    {
                      type: 'td',
                      attrs: { nodeId: 'c' },
                      content: [
                        text('see '),
                        { type: 'inline-image', attrs: { nodeId: 'pic', href: '#p.png' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const index = buildTreeIndex(fakeDocument({ bodies: [body as unknown as BodyNode] }), CAPTIONS);
    expect(index.rows.get('c')!.childIds).toEqual(['pic']);
    expect(index.rows.get('pic')!.parentId).toBe('c');
  });

  it('the Annotation and History rows hold the rows of what the book’s annotation and history contain', () => {
    const doc = book();
    doc.description.titleInfo.annotation = {
      type: 'annotation',
      attrs: { nodeId: 'descAnn' },
      content: [
        p('pAnn', 'About the book'),
        { type: 'image', attrs: { nodeId: 'annPic', href: '#cover.jpg' } },
        { type: 'subtitle', attrs: { nodeId: 'annSub' }, content: [text('Praise')] },
      ],
    } as unknown as AnnotationNode;
    const index = buildTreeIndex(doc, CAPTIONS);
    expect(index.rows.get(FIXED_BLOCK_IDS.annotation)!.childIds).toEqual(['annPic', 'annSub']);
    expect(index.rows.get('annSub')).toMatchObject({
      depth: 1,
      parentId: FIXED_BLOCK_IDS.annotation,
    });
    expect(rowForNode(index, doc, 'annSub')).toBe('annSub');
    expect(rowForNode(index, doc, 'pAnn')).toBe(FIXED_BLOCK_IDS.annotation);
  });
});
