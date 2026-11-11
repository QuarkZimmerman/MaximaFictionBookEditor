/**
 * Feature 012 (T064; D18, D34): the editor's own EPUB gives its FB2 structure back - a body's own
 * picture and epigraphs, a section's id and annotation, a note's title and id, the notes' heading, a
 * poem's epigraph, stanza title and subtitle and date value, a paragraph's language - and its classes
 * as named styles, its FB2 marks never as a look.
 */
import { describe, expect, it } from 'vitest';

import { classUseOf, convertPages, type ConvertPage } from '@/features/epub/import/convert';
import { namedStylesPlan, planClasses } from '@/features/epub/import/css';
import { parsePage } from '@/features/epub/import/parse';

function page(path: string, body: string): ConvertPage {
  const xhtml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" ' +
    `xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>${body}</body></html>`;
  return { path, doc: parsePage(xhtml, 'xhtml').doc, linear: true };
}

const IMAGES = new Map([['EPUB/images/pic.png', 'image/png']]);

function convert(pages: ConvertPage[], editorBook = true) {
  return convertPages({
    pages,
    navigation: [],
    images: IMAGES,
    descriptionWords: new Set(),
    notesTitle: 'Notes',
    editorBook,
  });
}

describe("the editor's own EPUB, imported again (D34)", () => {
  it('gives a body its own picture, title and epigraphs back', async () => {
    const book = await convert([
      page(
        'EPUB/text/p1.xhtml',
        '<div class="fb2-body-intro"><img src="../images/pic.png" alt="Body picture"/>' +
          '<h1 class="fb2-title fb2-body-title">The Book</h1>' +
          '<blockquote class="fb2-epigraph" epub:type="epigraph"><p>An epigraph.</p></blockquote></div>',
      ),
      page(
        'EPUB/text/p2.xhtml',
        '<div id="ch1" class="fb2-section"><h2 class="fb2-title">One</h2><p>Text.</p></div>',
      ),
    ]);
    expect(book.bodyXml).toBe(
      '<body><image l:href="#pic" alt="Body picture"/><title><p>The Book</p></title>' +
        '<epigraph><p>An epigraph.</p></epigraph>' +
        '<section id="ch1"><title><p>One</p></title><p>Text.</p></section></body>',
    );
  });

  it("gives a section its id, annotation and paragraphs' language back", async () => {
    const book = await convert([
      page(
        'EPUB/text/p1.xhtml',
        '<div id="ch1" class="fb2-section"><h1 class="fb2-title">One</h1>' +
          '<div class="fb2-annotation"><p>An annotation.</p></div>' +
          '<p id="p1">Text.</p><p xml:lang="de" lang="de">Ein Absatz.</p></div>',
      ),
    ]);
    expect(book.bodyXml).toContain(
      '<section id="ch1"><title><p>One</p></title><annotation><p>An annotation.</p></annotation>' +
        '<p id="p1">Text.</p><p xml:lang="de">Ein Absatz.</p></section>',
    );
  });

  it("gives the notes their titles and ids back, and no chapter for the notes' heading", async () => {
    const notes =
      '<aside id="n1" class="fb2-note" epub:type="footnote"><div class="fb2-note-title"><p>1</p></div>' +
      '<p>The note.</p><p class="fb2-backlink"><a href="p1.xhtml#ref1">\u21a9</a></p></aside>';
    const text =
      '<div id="ch1" class="fb2-section"><h1 class="fb2-title">One</h1>' +
      '<p>See<a id="ref1" href="notes.xhtml#n1" epub:type="noteref">[1]</a>.</p></div>';
    const generated = await convert([
      page('EPUB/text/p1.xhtml', text),
      page(
        'EPUB/text/notes.xhtml',
        `<h1 id="notes" class="fb2-title fb2-notes-title fb2-generated">Notes</h1>${notes}`,
      ),
    ]);
    expect(generated.notesXml).toBe(
      '<body name="notes"><section id="n1"><title><p>1</p></title><p>The note.</p></section></body>',
    );
    expect(generated.bodyXml).not.toContain('Notes');
    const own = await convert([
      page('EPUB/text/p1.xhtml', text),
      page(
        'EPUB/text/notes.xhtml',
        `<h1 id="notes" class="fb2-title fb2-notes-title">Footnotes</h1>${notes}`,
      ),
    ]);
    expect(own.notesXml).toMatch(
      /^<body name="notes"><title><p>Footnotes<\/p><\/title><section id="n1">/,
    );
  });

  it('gives a poem its epigraph, a stanza its title and subtitle, the date its value back', async () => {
    const book = await convert([
      page(
        'EPUB/text/p1.xhtml',
        '<div id="ch1" class="fb2-section"><h1 class="fb2-title">One</h1><div class="fb2-poem">' +
          '<div class="fb2-title fb2-poem-title"><p>A Poem</p></div>' +
          '<blockquote class="fb2-epigraph" epub:type="epigraph"><p>Its epigraph.</p></blockquote>' +
          '<div class="fb2-stanza"><div class="fb2-stanza-title"><p>Stanza one</p></div>' +
          '<p class="fb2-subtitle">Its subtitle</p><p class="fb2-v">First line,</p><p class="fb2-v">second.</p></div>' +
          '<p class="fb2-text-author">The Poet</p><p class="fb2-date" data-fb2-value="2026-01-01">1 January 2026</p>' +
          '</div></div>',
      ),
    ]);
    expect(book.bodyXml).toContain(
      '<poem><title><p>A Poem</p></title><epigraph><p>Its epigraph.</p></epigraph>' +
        '<stanza><title><p>Stanza one</p></title><subtitle>Its subtitle</subtitle><v>First line,</v>' +
        '<v>second.</v></stanza><text-author>The Poet</text-author>' +
        '<date value="2026-01-01">1 January 2026</date></poem>',
    );
  });

  it('keeps every space of its paragraphs, also around formatting', async () => {
    const book = await convert([
      page(
        'EPUB/text/p1.xhtml',
        '<div id="ch1" class="fb2-section"><h1 class="fb2-title">One</h1>' +
          '<p><strong> <sup>x</sup> </strong></p><p><em> </em><strong>t</strong></p></div>',
      ),
    ]);
    expect(book.bodyXml).toContain(
      '<p><strong> <sup>x</sup> </strong></p><p><emphasis> </emphasis><strong>t</strong></p>',
    );
  });

  it('takes its classes as named styles, never its FB2 marks', () => {
    const pages = [
      page(
        'EPUB/text/p1.xhtml',
        '<p class="letter">L</p><p class="fb2-subtitle">S</p><div class="fb2-section fb-continued"/>',
      ),
    ];
    expect([...namedStylesPlan(classUseOf(pages)).named]).toEqual(['letter']);
    // Another book's CSS: the export's marks are no look either.
    const plan = planClasses(
      ['.fb2-subtitle { text-align: center; font-weight: bold; }'],
      classUseOf(pages),
    );
    expect(plan.named.has('fb2-subtitle')).toBe(false);
    expect(plan.forms.has('fb2-subtitle')).toBe(false);
  });
});
