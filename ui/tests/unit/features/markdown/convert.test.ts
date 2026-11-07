// Feature 010, US8 (T053; contracts/markdown-mapping.md §1-§3): the Markdown converter.

import { describe, expect, it } from 'vitest';

import { convertMarkdown, type ConvertOptions } from '@/features/markdown/convert';

const OPTIONS: ConvertOptions = { fileName: 'notes', baseDir: '/books', notesTitle: 'Notes' };
const convert = (text: string, options: Partial<ConvertOptions> = {}) =>
  convertMarkdown(text, { ...OPTIONS, ...options });

describe('Markdown structure (§1)', () => {
  it('takes a single opening level-1 heading as the book title; the next level are the sections', () => {
    const result = convert('# The Book\n\nIntro.\n\n## One\n\nText one.\n\n## Two\n\nText two.\n');
    expect(result.description.title).toBe('The Book');
    expect(result.bodyXml).toBe(
      '<body><title><p>The Book</p></title>' +
        '<section><p>Intro.</p></section>' +
        '<section id="one"><title><p>One</p></title><p>Text one.</p></section>' +
        '<section id="two"><title><p>Two</p></title><p>Text two.</p></section></body>',
    );
  });

  it('nests by relative level, puts text before subsections into an untitled subsection, makes ids unique', () => {
    const result = convert('Before.\n\n# A\n\nA text.\n\n### A1 {#first}\n\nx\n\n# A\n\ny\n');
    expect(result.bodyXml).toBe(
      '<body><section><p>Before.</p></section>' +
        '<section id="a"><title><p>A</p></title><section><p>A text.</p></section>' +
        '<section id="first"><title><p>A1</p></title><p>x</p></section></section>' +
        '<section id="a-1"><title><p>A</p></title><p>y</p></section></body>',
    );
    expect(result.description.title).toBe('notes');
  });

  it('makes one untitled section without headings', () => {
    expect(convert('Just text.').bodyXml).toBe('<body><section><p>Just text.</p></section></body>');
  });
});

describe('Markdown blocks and inline (§2)', () => {
  it('styles, links to headings and footnotes', () => {
    const result = convert(
      '# Doc\n\n## Part Two\n\n*e* **s** ~~d~~ `c` H~2~O x^2^ [go](#part-two) [lost](#nowhere) [w](https://x.org)[^1]\n\n[^1]: The note.\n',
    );
    expect(result.bodyXml).toContain(
      '<p><emphasis>e</emphasis> <strong>s</strong> <strikethrough>d</strikethrough> <code>c</code> H<sub>2</sub>O x<sup>2</sup> <a l:href="#part-two">go</a> <a l:href="#nowhere">lost</a> <a l:href="https://x.org">w</a><a l:href="#n_1" type="note">[1]</a></p>',
    );
    expect(result.notesXml).toBe(
      '<body name="notes"><title><p>Notes</p></title><section id="n_1"><title><p>1</p></title><p>The note.</p></section></body>',
    );
    expect(result.summary).toContainEqual({ kind: 'missingTarget', detail: '#nowhere' });
  });

  it('lists, task lists, quotes, code, rules, definition lists and tables', () => {
    const result = convert(
      [
        '- one',
        '  - deeper',
        '1. first',
        '2) second',
        '- [ ] todo',
        '- [x] done',
        '',
        '> quoted',
        '> > nested',
        '',
        '```',
        '  code',
        '',
        '\tx',
        '```',
        '',
        '---',
        '',
        'Term',
        ': Definition',
        '',
        '| a | b |',
        '|:-|-:|',
        '| 1 | **2** |',
      ].join('\n'),
    );
    const xml = result.bodyXml;
    expect(xml).toContain('<p>\u2022 one</p><p>\u00a0\u00a0\u00a0\u00a0\u2022 deeper</p>');
    expect(xml).toContain('<p>1. first</p><p>2) second</p>');
    expect(xml).toContain('<p><image l:href="#ch-2610" alt="\u2610"/> todo</p>');
    expect(xml).toContain('<p><image l:href="#ch-2611" alt="\u2611"/> done</p>');
    expect(xml).toContain('<cite><p>quoted</p><p>nested</p></cite>');
    expect(xml).toContain(
      '<p><code>\u00a0\u00a0code</code></p><empty-line/><p><code>\u00a0\u00a0\u00a0\u00a0x</code></p>',
    );
    expect(xml).toContain('<subtitle>* * *</subtitle>');
    expect(xml).toContain('<p><strong>Term</strong></p><p>Definition</p>');
    expect(xml).toContain(
      '<table><tr><th align="left">a</th><th align="right">b</th></tr><tr><td align="left">1</td><td align="right"><strong>2</strong></td></tr></table>',
    );
    expect(result.stats.tables).toBe(1);
  });

  it('pictures: a block picture alone, inline ones in text, files relative to the folder, web ones kept', () => {
    const result = convert(
      '![Cover](img/cover.png "The cover")\n\nSee ![icon](./i.gif) and ![web](https://x.org/a.png).\n',
    );
    expect(result.bodyXml).toContain(
      '<image l:href="#cover.png" alt="Cover" title="The cover"/><p>See <image l:href="#i.gif" alt="icon"/> and <image l:href="https://x.org/a.png" alt="web"/>.</p>',
    );
    expect(result.pictures).toEqual([
      { id: 'cover.png', kind: 'file', path: '/books/img/cover.png' },
      { id: 'i.gif', kind: 'file', path: '/books/i.gif' },
    ]);
    expect(result.summary).toContainEqual({ kind: 'webPicture', detail: 'https://x.org/a.png' });
  });

  it('HTML: the common tags as their Markdown forms, others dropped and listed, comments dropped', () => {
    const result = convert('a <b>b</b> <i>i</i> <span>s</span> <!-- c --> z\n');
    expect(result.bodyXml).toContain('<p>a <strong>b</strong> <emphasis>i</emphasis> s  z</p>');
    expect(result.summary).toContainEqual({ kind: 'htmlTag', detail: 'span' });
  });
});

describe('special characters and the front matter (§3, D30)', () => {
  it('draws emoji and symbols, expands codes, drops private use', () => {
    const result = convert('Done :white_check_mark: \u2713 \ue000 ∑\n');
    expect(result.bodyXml).toContain(
      '<p>Done <image l:href="#ch-2705" alt="\u2705"/> <image l:href="#ch-2713" alt="\u2713"/>  <image l:href="#ch-2211" alt="\u2211"/></p>',
    );
    expect(result.chars.map((c) => [c.id, c.font])).toEqual([
      ['ch-2705', 'emoji'],
      ['ch-2713', 'symbol'],
      ['ch-2211', 'math'],
    ]);
    expect(result.summary).toContainEqual({ kind: 'droppedChar', detail: 'U+E000' });
  });

  it('takes the description from the front matter', () => {
    const result = convert(
      '---\ntitle: Front\nauthors: [Ann Mary Writer, Zed]\ndate: 2026-03-01\nlang: en\nsummary: A short book.\ntags: sea, ships\nseries: Saga\nseries_index: 2\ncover: cover.jpg\ngenres: [sf, nonsense]\n---\n# Heading\n\nText.\n',
      { genres: new Set(['sf']) },
    );
    expect(result.description).toEqual({
      title: 'Front',
      authors: [{ firstName: 'Ann', middleName: 'Mary', lastName: 'Writer' }, { nickname: 'Zed' }],
      date: '2026-03-01',
      lang: 'en',
      annotation: ['A short book.'],
      keywords: 'sea, ships',
      sequence: { name: 'Saga', number: 2 },
      cover: '#cover.jpg',
      genres: ['sf'],
    });
  });
});
