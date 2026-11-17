/**
 * Feature 016 (SC-002 as revised, 2026-11-17): an imported book is valid FB2 - the bodies mended to the schema's
 * content models, a valid book untouched.
 */
import { describe, expect, it } from 'vitest';

import { mendFb2 } from '@/features/pdf/import/valid';

const FB = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const book = (bodies: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="${FB}" xmlns:l="http://www.w3.org/1999/xlink">` +
  `<description><title-info><genre>my own genre</genre><book-title>B</book-title></title-info></description>` +
  `${bodies}</FictionBook>`;
/** The bodies' elements as a compact outline: names, nested in brackets, text after a colon. */
const outline = (xml: string): string => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const walk = (element: Element): string => {
    const kids = [...element.children];
    const text = kids.length ? '' : `:${element.textContent ?? ''}`;
    return `${element.localName}${text}${kids.length ? `[${kids.map(walk).join(' ')}]` : ''}`;
  };
  return [...doc.getElementsByTagNameNS(FB, 'body')].map(walk).join(' ');
};

describe('the import gives valid FB2 (SC-002)', () => {
  it('leaves a valid book as it is, the very string, its own genre too', () => {
    const xml = book(
      '<body><title><p>T</p></title><section><title><p>One</p></title><p>a</p><image l:href="#x"/><p>b</p></section></body>',
    );
    expect(mendFb2(xml)).toEqual({ xml, mended: 0 });
  });

  it('makes a section of the blocks beside subsections, and of a paragraph straight in a body', () => {
    const { xml, mended } = mendFb2(
      book(
        '<body><p>loose</p><section><title><p>S</p></title><p>lead</p><section><p>in</p></section><p>after</p></section></body>',
      ),
    );
    expect(mended).toBeGreaterThan(0);
    expect(outline(xml)).toBe(
      'body[section[p:loose] section[title[p:S] section[p:lead] section[p:in] section[p:after]]]',
    );
  });

  it('turns what a title, an epigraph or a stanza may not hold into what it may', () => {
    const { xml } = mendFb2(
      book(
        '<body><section><title><section><p>A</p><p>B</p></section></title><epigraph><subtitle>s</subtitle><epigraph><p>e</p></epigraph><text-author>x</text-author><p>y</p></epigraph><p>t</p><poem><v>loose</v></poem></section></body>',
      ),
    );
    expect(outline(xml)).toBe(
      'body[section[title[p:A p:B] epigraph[p:s p:e p:x p:y] p:t poem[stanza[v:loose]]]]',
    );
  });

  it('gives a header without content an empty line, and a body without a section one', () => {
    const { xml } = mendFb2(
      book(
        '<body><section><title><p>Only a title</p></title></section></body><body name="notes"><title><p>N</p></title></body>',
      ),
    );
    expect(outline(xml)).toBe(
      'body[section[title[p:Only a title] empty-line:]] body[title[p:N] section:]',
    );
  });

  it('begins a section of its own at a title after the sections, and an epigraph there is a quote', () => {
    const { xml } = mendFb2(
      book(
        '<body><section><p>a</p></section><title><p>Late</p></title><p>b</p><epigraph><p>q</p></epigraph></body>',
      ),
    );
    expect(outline(xml)).toBe('body[section[p:a] section[title[p:Late] p:b cite[p:q]]]');
  });

  it('keeps one body and one notes body: the others join them', () => {
    const { xml } = mendFb2(
      book(
        '<body><section><p>a</p></section></body><body><title><p>Second</p></title><section><p>b</p></section></body>' +
          '<body name="comments"><section id="c1"><p>c</p></section></body><body name="notes"><section id="n1"><p>n</p></section></body>',
      ),
    );
    expect(outline(xml)).toBe(
      'body[section[p:a] section[title[p:Second] section[p:b]]] body[section[p:n] section[p:c]]',
    );
    expect(
      new DOMParser()
        .parseFromString(xml, 'application/xml')
        .getElementsByTagNameNS(FB, 'body')[1]
        .getAttribute('name'),
    ).toBe('notes');
  });

  it('names a lone comments body the notes, and leaves an unnamed second body as it is', () => {
    const renamed = mendFb2(
      book(
        '<body><section><p>a</p></section></body><body name="comments"><section><p>c</p></section></body>',
      ),
    );
    expect(renamed.xml).toContain('<body name="notes">');
    expect(mendFb2(book('<body name="Volume 3"><section><p>a</p></section></body>')).xml).toContain(
      '<body>',
    );
    const two = book(
      '<body><section><p>a</p></section></body><body><section><p>b</p></section></body>',
    );
    expect(mendFb2(two)).toEqual({ xml: two, mended: 0 });
  });
});
