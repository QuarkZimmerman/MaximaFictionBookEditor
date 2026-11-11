/**
 * Feature 012 (T031; D18-D22; contracts/epub-import.md §2, §3, §7): the pages of an EPUB as the FB2
 * body - sections from headings and the contents, the cover and title pages, the body title, the
 * text table, the notes in their three forms, the FB2 converter's marks, the links, and the pages of
 * the editor's own export joined.
 */
import { describe, expect, it } from 'vitest';

import { convertPages, type ConvertPage, type ConvertInput } from '@/features/epub/import/convert';
import type { NavEntry } from '@/features/epub/import/package';
import { parsePage } from '@/features/epub/import/parse';

function page(path: string, body: string, options: Partial<ConvertPage> = {}): ConvertPage {
  const xhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" ' +
    `xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head>${body}</html>`;
  return { path, doc: parsePage(xhtml, 'xhtml').doc, linear: true, ...options };
}

async function convert(pages: ConvertPage[], extra: Partial<ConvertInput> = {}) {
  return convertPages({
    pages,
    navigation: [],
    images: new Map([
      ['OEBPS/images/cover.jpg', 'image/jpeg'],
      ['OEBPS/images/pic.png', 'image/png'],
    ]),
    descriptionWords: new Set(['the', 'book', 'anna', 'example']),
    notesTitle: 'Notes',
    ...extra,
  });
}

describe('the EPUB import: structure (D18)', () => {
  it('gives a page holding only a picture a valid untitled section (FB2 2.1: content after it)', async () => {
    // After the cover (the image-only first page), a publisher's logo on a page of its own.
    const book = await convert([
      page(
        'OEBPS/cover.xhtml',
        '<body><div><img src="images/cover.jpg" alt="Cover"/></div></body>',
      ),
      page('OEBPS/logo.xhtml', '<body><div><img src="images/pic.png" alt="Logo"/></div></body>'),
      page('OEBPS/a.xhtml', '<body><h2>One</h2><p>a</p><h2>Two</h2><p>b</p></body>'),
    ]);
    expect(book.bodyXml).toMatch(
      /^<body><section><image l:href="#pic" alt="Logo"\/><empty-line\/><\/section><section><title>/,
    );
  });

  it('makes sections from the headings by their levels relative to each other', async () => {
    const book = await convert([
      page(
        'OEBPS/a.xhtml',
        '<body><h2>One</h2><p>a</p><h3>One.1</h3><p>b</p><h2>Two</h2><p>c</p></body>',
      ),
    ]);
    expect(book.bodyXml).toBe(
      '<body><section><title><p>One</p></title><section><p>a</p></section>' +
        '<section><title><p>One.1</p></title><p>b</p></section></section>' +
        '<section><title><p>Two</p></title><p>c</p></section></body>',
    );
    expect(book.stats.sections).toBe(3);
  });

  it('titles a page without a heading from the contents, and keeps text before any heading', async () => {
    const navigation: NavEntry[] = [
      { label: 'Глава 1', path: 'OEBPS/b.xhtml', fragment: '', depth: 1 },
    ];
    const book = await convert(
      [
        page('OEBPS/a.xhtml', '<body><p>Before.</p></body>'),
        page('OEBPS/b.xhtml', '<body><p>Text.</p></body>'),
      ],
      { navigation },
    );
    expect(book.bodyXml).toBe(
      '<body><section><p>Before.</p></section><section><title><p>Глава 1</p></title><p>Text.</p></section></body>',
    );
  });

  it('takes the cover from a cover page and does not repeat it, nor a title page', async () => {
    const book = await convert([
      page(
        'OEBPS/cover.xhtml',
        '<body><div><img src="images/cover.jpg" alt="Cover"/></div></body>',
      ),
      page('OEBPS/title.xhtml', '<body><h1>The Book</h1><p>Anna Example</p></body>', {
        role: 'title-page',
      }),
      page('OEBPS/a.xhtml', '<body><h1>Chapter</h1><p>Text.</p></body>'),
    ]);
    expect(book.coverPath).toBe('OEBPS/images/cover.jpg');
    expect(book.bodyXml).toBe(
      '<body><section><title><p>Chapter</p></title><p>Text.</p></section></body>',
    );
    // A title page that says more than the description is text.
    const kept = await convert([
      page('OEBPS/title.xhtml', '<body><h1>The Book</h1><p>A dedication to my cat.</p></body>', {
        role: 'title-page',
      }),
    ]);
    expect(kept.bodyXml).toContain('A dedication to my cat.');
  });

  it("makes one opening heading above all chapters the body's title", async () => {
    const book = await convert([
      page('OEBPS/t.xhtml', '<body><h1>The Book</h1></body>'),
      page('OEBPS/a.xhtml', '<body><h2>Chapter 1</h2><p>a</p></body>'),
      page('OEBPS/b.xhtml', '<body><h2>Chapter 2</h2><p>b</p></body>'),
    ]);
    expect(book.bodyXml).toBe(
      '<body><title><p>The Book</p></title><section><title><p>Chapter 1</p></title><p>a</p></section>' +
        '<section><title><p>Chapter 2</p></title><p>b</p></section></body>',
    );
  });

  it('reads the non-linear pages after the text', async () => {
    const book = await convert([
      page('OEBPS/extra.xhtml', '<body><h1>Extra</h1><p>x</p></body>', { linear: false }),
      page('OEBPS/a.xhtml', '<body><h1>Main</h1><p>m</p></body>'),
    ]);
    expect(book.bodyXml.indexOf('Main')).toBeLessThan(book.bodyXml.indexOf('Extra'));
  });

  it("joins the continued pages of the editor's own export", async () => {
    const book = await convert([
      page(
        'OEBPS/0001.xhtml',
        '<body><div id="s1" class="fb2-section"><h1 class="fb2-title">Long</h1><p>a</p></div></body>',
      ),
      page('OEBPS/0002.xhtml', '<body><div class="fb2-section fb-continued"><p>b</p></div></body>'),
    ]);
    expect(book.bodyXml).toBe(
      '<body><section><title><p>Long</p></title><p>a</p><p>b</p></section></body>',
    );
  });
});

describe('the EPUB import: text (D19, contracts §3)', () => {
  it('maps the text table', async () => {
    const book = await convert([
      page(
        'OEBPS/a.xhtml',
        '<body><h1>T</h1>' +
          '<p><em>e</em> <i>i</i> <strong>s</strong> <b>b</b> <s>x</s> <del>d</del> H<sub>2</sub>O x<sup>2</sup> <code>c</code></p>' +
          '<p>line one<br/>line two</p>' +
          '<ul><li>first</li><li>second</li></ul><ol start="3"><li>third</li></ol>' +
          '<pre>a = 1\nb = 2</pre><hr/>' +
          '<table><tr><th colspan="2">Head</th></tr><tr><td align="right">1</td><td style="text-align: center">2</td></tr></table>' +
          '<figure><img src="images/pic.png" alt="Alt"/><figcaption>The caption</figcaption></figure>' +
          '<blockquote><p>Quoted.</p></blockquote>' +
          '</body>',
      ),
    ]);
    const xml = book.bodyXml;
    expect(xml).toContain(
      '<p><emphasis>e</emphasis> <emphasis>i</emphasis> <strong>s</strong> <strong>b</strong> ' +
        '<strikethrough>x</strikethrough> <strikethrough>d</strikethrough> H<sub>2</sub>O x<sup>2</sup> <code>c</code></p>',
    );
    expect(xml).toContain('<p>line one</p><p>line two</p>');
    expect(xml).toContain('<p>\u2022 first</p><p>\u2022 second</p><p>3. third</p>');
    expect(xml).toContain(
      '<p><code>a = 1</code></p><p><code>b = 2</code></p><subtitle>* * *</subtitle>',
    );
    expect(xml).toContain(
      '<table><tr><th colspan="2">Head</th></tr><tr><td align="right">1</td><td align="center">2</td></tr></table>',
    );
    expect(xml).toContain(
      `<image l:href="#${book.pictures.get('OEBPS/images/pic.png')}" alt="Alt" title="The caption"/>`,
    );
    expect(xml).toContain('<cite><p>Quoted.</p></cite>');
    expect(book.stats).toMatchObject({ tables: 1, pictures: 1 });
  });

  it('puts an epigraph where FB2 has one, and a quotation elsewhere', async () => {
    const book = await convert([
      page(
        'OEBPS/a.xhtml',
        '<body><h1>T</h1><blockquote epub:type="epigraph"><p>Epi.</p><p class="fb2-text-author">Author</p></blockquote>' +
          '<p>Text.</p><blockquote epub:type="epigraph"><p>Late.</p></blockquote></body>',
      ),
    ]);
    expect(book.bodyXml).toBe(
      '<body><section><title><p>T</p></title><epigraph><p>Epi.</p><text-author>Author</text-author></epigraph>' +
        '<p>Text.</p><cite><p>Late.</p></cite></section></body>',
    );
  });
});

describe('the EPUB import: notes (D20)', () => {
  const notesOf = async (pages: ConvertPage[]): Promise<{ body: string; notes: string }> => {
    const book = await convert(pages);
    return { body: book.bodyXml, notes: book.notesXml ?? '' };
  };

  it('reads EPUB 3 footnotes', async () => {
    const { body, notes } = await notesOf([
      page(
        'OEBPS/a.xhtml',
        '<body><h1>T</h1><p>Text<a epub:type="noteref" href="#n1">1</a>.</p>' +
          '<aside epub:type="footnote" id="n1"><p>The note.</p></aside></body>',
      ),
    ]);
    expect(body).toMatch(/<p>Text<a l:href="#(note_a_n1)" type="note">1<\/a>\.<\/p>/);
    expect(body).not.toContain('The note.');
    expect(notes).toBe(
      '<body name="notes"><title><p>Notes</p></title><section id="note_a_n1"><title><p>1</p></title><p>The note.</p></section></body>',
    );
  });

  it('reads EPUB 2 notes: a target that links back to its reference', async () => {
    const { body, notes } = await notesOf([
      page(
        'OEBPS/a.xhtml',
        '<body><h1>T</h1><p>Text<a id="r1" href="notes.xhtml#n1">[1]</a>.</p></body>',
      ),
      page(
        'OEBPS/notes.xhtml',
        '<body><p id="n1"><a href="a.xhtml#r1">1</a> The note.</p></body>',
        { linear: false },
      ),
    ]);
    expect(body).toContain('type="note">[1]</a>');
    expect(notes).toContain('<title><p>1</p></title><p>The note.</p>');
  });

  it("reads InDesign's footnotes", async () => {
    const { body, notes } = await notesOf([
      page(
        'OEBPS/a.xhtml',
        '<body><h1>T</h1><p>Text<a class="_idFootnoteLink" href="#fn1">1</a>.</p>' +
          '<div class="_idFootnotes"><div id="fn1" class="_idFootnote"><p>The note.</p></div></div></body>',
      ),
    ]);
    expect(body).toContain('type="note">1</a>');
    expect(notes).toContain('<p>The note.</p>');
  });
});

describe("the EPUB import: the FB2 converter's marks and the links (D21, D22)", () => {
  it('gives the FB2 structure back from the converter found in the corpus', async () => {
    const book = await convert([
      page(
        'OEBPS/a.xhtml',
        '<body><h1 class="body_head">The Book</h1><div class="section1"><h2>Chapter</h2>' +
          '<h5 class="subtitle">Sub</h5><div class="poem"><div class="stanza"><p class="v">Line 1</p>' +
          '<p class="v">Line 2</p></div></div></div></body>',
      ),
    ]);
    expect(book.bodyXml).toBe(
      '<body><title><p>The Book</p></title><section><title><p>Chapter</p></title><subtitle>Sub</subtitle>' +
        '<poem><stanza><v>Line 1</v><v>Line 2</v></stanza></poem></section></body>',
    );
  });

  it('resolves links inside the book, keeps those outside it, and writes missing ones as text', async () => {
    const book = await convert([
      page(
        'OEBPS/a.xhtml',
        '<body><h1>One</h1><p><a href="b.xhtml#place">a place</a> <a href="b.xhtml">next chapter</a> ' +
          '<a href="https://www.google.com">web</a> <a href="b.xhtml#nowhere">missing</a></p></body>',
      ),
      page('OEBPS/b.xhtml', '<body><h1>Two</h1><p id="place">There.</p></body>'),
    ]);
    const xml = book.bodyXml;
    expect(xml).toContain('<a l:href="#b_place">a place</a>');
    expect(xml).toContain('<p id="b_place">There.</p>');
    expect(xml).toMatch(/<a l:href="#(b)">next chapter<\/a>/);
    expect(xml).toContain('<section id="b">');
    expect(xml).toContain('<a l:href="https://www.google.com">web</a>');
    expect(xml).toContain(' missing</p>');
    expect(book.summary).toContainEqual({ kind: 'linkAsText', detail: 'b.xhtml#nowhere' });
  });
});
