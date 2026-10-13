/**
 * T084 - tree rows (kinds, captions, nesting, caching), visible rows with collapsed containers,
 * row lookup for Body selections, and the View Source position search.
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import { locateInSource, nthTagOffset, tagOrdinal } from '@/features/tree/sourceLocate';
import type { BodyNode, Document } from '@/model/document';
import {
  buildTreeIndex,
  captionFor,
  normalizeCaption,
  rowForNode,
  visibleRows,
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
  return fakeDocument({ bodies: [body, notes] as unknown as BodyNode[] });
}

describe('tree model', () => {
  it('builds rows for bodies, sections and the leaf kinds with FBE captions', () => {
    const index = buildTreeIndex(book());
    expect(index.roots).toEqual(['body1', 'body2']);
    expect(index.order).toEqual([
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
    const first = buildTreeIndex(doc);
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
    const second = buildTreeIndex(edited);
    expect(second.rows.get('A')).toBe(first.rows.get('A'));
    expect(second.rows.get('N1')).not.toBe(first.rows.get('N1'));
    expect(second.rows.get('N1')!.caption).toBe('<section>');
  });

  it('hides the children of collapsed rows', () => {
    const index = buildTreeIndex(book());
    expect(visibleRows(index, new Set()).map((r) => r.id)).toEqual(index.order);
    expect(visibleRows(index, new Set(['A'])).map((r) => r.id)).toEqual([
      'body1',
      'tBook',
      'A',
      'body2',
      'N1',
    ]);
    expect(visibleRows(index, new Set(['A1'])).map((r) => r.id)).toContain('A2');
    expect(visibleRows(index, new Set(['A1'])).map((r) => r.id)).not.toContain('poem1');
  });

  it('maps a Body selection to the innermost row', () => {
    const doc = book();
    const index = buildTreeIndex(doc);
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
    '    <coverpage><image l:href="#c.jpg"/></coverpage></title-info></description>',
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
    expect(byId.line).toBe(7);
    expect(byId.column).toBe(5);
    const a2 = locateInSource(xml, doc, 'A2')!;
    expect(xml.slice(a2.offset, a2.offset + 9)).toBe('<section>');
    expect(a2.line).toBe(19);
    const image = locateInSource(xml, doc, 'imgA')!;
    expect(xml.slice(image.offset, image.offset + 26)).toBe('<image l:href="#cover.jpg"');
    expect(image.line).toBe(10);
    const notes = locateInSource(xml, doc, 'body2')!;
    expect(notes.line).toBe(22);
    expect(locateInSource(xml, doc, 'tbl1')!.line).toBe(17);
    expect(locateInSource(xml, doc, 'anA')!.line).toBe(11); // the description annotation is skipped
    expect(locateInSource(xml, doc, 'missing')).toBeNull();
  });
});
