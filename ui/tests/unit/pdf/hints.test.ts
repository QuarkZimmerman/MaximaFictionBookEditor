/**
 * Feature 014 (R10, contracts/pdf-file.md `mfbe:fb2Hints`; tasks T037): the editor's hints, keyed by
 * the paginator's block order with text anchors, holding only what the PDF cannot give back.
 */
import { describe, expect, it } from 'vitest';

import { FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';
import { buildHints, type HintBlock } from '@/features/pdf/export/hints';

function el(
  name: string,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): Element {
  const element = document.createElementNS(name === 'table' ? XHTML_NS : FB2_NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  for (const child of children) element.append(child);
  return element;
}

describe('the editor hints (R10)', () => {
  it('keys blocks by the paginator order, with sections, kinds, spans, ids and anchors', () => {
    const body = el('body');
    const section = el('section', { id: 'ch1' });
    const p1 = el(
      'p',
      { class: 'intro', id: 'lonely' },
      'Первый ',
      el('strikethrough', {}, 'зачёркнутый'),
      ' абзац',
    );
    const poem = el('poem');
    const v1 = el('v', {}, 'Строка один');
    const v2 = el('v', { lang: 'en' }, 'Line two');
    const link = el('p', {}, el('a', { 'data-href': '#ch1' }, 'к главе'));
    body.append(section);
    section.append(p1, poem, link);
    poem.append(v1, v2);
    const blocks: HintBlock[] = [
      { element: p1, chain: [body, section], page: 2 },
      { element: v1, chain: [body, section, poem], page: 2 },
      { element: v2, chain: [body, section, poem], page: 3 },
      { element: link, chain: [body, section], page: 3 },
    ];
    const hints = JSON.parse(
      buildHints({
        blocks,
        book: {
          stylesheets: [{ type: 'text/css', content: 'p{}\u0001' }],
          binaries: [],
          bodies: [],
        },
        pageMap: { pictures: [], addedWords: 'ru' },
        coverPage: null,
        titlePage: 1,
      }),
    );
    expect(hints.v).toBe(1);
    expect(hints.blocks).toBe(4);
    expect(hints.generated).toEqual({
      cover: null,
      titlePage: 1,
      words: 'ru',
      pageNumbers: 'foot',
    });
    expect(hints.bodies).toEqual([{ name: '', page: 2 }]);
    expect(hints.sections).toEqual([[0, 1]]);
    expect(hints.kinds).toEqual([[1, 2, 'poem/v']]);
    expect(hints.styles).toEqual([[0, 'intro']]);
    expect(hints.marks).toEqual([[0, 7, 18, 'strikethrough']]);
    expect(hints.langs).toEqual([[2, 0, 8, 'en']]);
    // ch1 is a link target, so only the paragraph's id is a hint.
    expect(hints.ids).toEqual([[0, 'lonely']]);
    expect(hints.stylesheets).toEqual([{ type: 'text/css', text: 'p{}' }]);
    // Runs of keys: 0..2 is one run, anchored by its first block's first 16 characters.
    expect(hints.anchors).toEqual({ 0: 'Первый зачёркнут' });
  });
});
