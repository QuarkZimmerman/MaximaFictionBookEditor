// Feature 011 (US10; D44; contracts/styles.md §5; research DP-17): Preview's builder.
import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { buildPreview, FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

const text = (value: string, marks?: ModelNodeJson['marks']): ModelNodeJson => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

function book(sections = 1): Document {
  const content: ModelNodeJson[] = [];
  for (let i = 0; i < sections; i += 1) {
    content.push({
      type: 'section',
      attrs: { nodeId: `s${i}`, id: `ch${i}` },
      content: [
        {
          type: 'title',
          attrs: { nodeId: `t${i}` },
          content: [{ type: 'p', attrs: { nodeId: `tp${i}` }, content: [text(`Chapter ${i}`)] }],
        },
        {
          type: 'epigraph',
          attrs: { nodeId: `e${i}` },
          content: [{ type: 'p', attrs: { nodeId: `ep${i}` }, content: [text('Wise')] }],
        },
        {
          type: 'p',
          attrs: { nodeId: `p${i}`, style: 'letter' },
          content: [
            text('Dear '),
            text('friend', [{ type: 'emphasis' }]),
            text(' see'),
            text('1', [{ type: 'link', attrs: { href: '#n1', type: 'note' } }]),
            text(' and '),
            text('back', [{ type: 'link', attrs: { href: '#ch0' } }]),
          ],
        },
        {
          type: 'table',
          attrs: { nodeId: `T${i}` },
          content: [
            {
              type: 'tr',
              attrs: { nodeId: `r${i}` },
              content: [
                { type: 'td', attrs: { nodeId: `c${i}`, colspan: 2 }, content: [text('cell')] },
              ],
            },
          ],
        },
      ],
    });
  }
  const notes: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'notes', name: 'notes' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 'n', id: 'n1' },
        content: [{ type: 'p', attrs: { nodeId: 'np' }, content: [text('The note.')] }],
      },
    ],
  };
  const document = fakeDocument({
    bodies: [
      { type: 'body', attrs: { nodeId: 'b' }, content } as unknown as BodyNode,
      notes as unknown as BodyNode,
    ],
  });
  document.stylesheets = [
    { type: 'text/css', content: '.letter { font-style: italic }' },
    { type: 'text/x-other', content: 'ignored' },
  ];
  return document;
}

function frame(): globalThis.Document {
  return globalThis.document.implementation.createHTMLDocument('preview');
}

describe('Preview’s builder (DP-17)', () => {
  it('writes the book’s elements in the FB2 namespace, so the book’s selectors match them', async () => {
    const target = frame();
    const built = await buildPreview(target, book(), { docId: null });
    const paragraph = built.elements.get('p0')!;
    expect(paragraph.namespaceURI).toBe(FB2_NS);
    expect(paragraph.localName).toBe('p');
    expect(paragraph.matches('p.letter')).toBe(true);
    expect(paragraph.matches('[class~="letter"]')).toBe(true);
    expect(built.elements.get('e0')!.matches('epigraph')).toBe(true);
    expect(built.elements.get('t0')!.matches('section > title')).toBe(true);
    // Tables are the HTML elements of the same names: their spans work, the selectors match.
    const cell = built.elements.get('c0')!;
    expect(cell.namespaceURI).toBe(XHTML_NS);
    expect(cell.matches('td')).toBe(true);
    expect(cell.getAttribute('colspan')).toBe('2');
  });

  it('puts the base sheet first and the book’s CSS stylesheets after it, in order', async () => {
    const target = frame();
    await buildPreview(target, book(), { docId: null });
    const styles = [...target.head.querySelectorAll('style')].map(
      (style) => style.textContent ?? '',
    );
    expect(styles).toHaveLength(2);
    expect(styles[0]).toContain('FictionBook');
    // The class selector as the attribute selector the engine applies to FB2 elements.
    expect(styles[1]).toBe('[class~="letter"]{font-style:italic}');
  });

  it('marks links and note references for the overlay’s navigation', async () => {
    const target = frame();
    const built = await buildPreview(target, book(), { docId: null });
    const links = [...built.elements.get('p0')!.querySelectorAll('[data-href]')];
    expect(links.map((link) => link.getAttribute('data-href'))).toEqual(['#n1', '#ch0']);
    expect(links[0]!.getAttribute('data-note')).toBe('true');
    expect(built.ids.get('n1')!.textContent).toContain('The note.');
    expect(built.ids.get('ch0')).toBe(built.elements.get('s0'));
  });

  it('builds in steps with progress, and stops when cancelled', async () => {
    const progress: number[] = [];
    await buildPreview(frame(), book(40), {
      docId: null,
      onProgress: (done) => progress.push(done),
    });
    expect(progress.at(-1)).toBe(41);
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildPreview(frame(), book(3), { docId: null, signal: controller.signal }),
    ).rejects.toThrow('Preview cancelled');
  });
});
