/**
 * Feature 012 (T031, D17, D20): a DTBook page converts - its poem and epigraph as FB2's, its notes
 * as FB2 notes, its front matter not repeated - and EPUB 3.0's switch gives its fallback.
 */
import { describe, expect, it } from 'vitest';

import { convertPages } from '@/features/epub/import/convert';
import { parsePage } from '@/features/epub/import/parse';

const NOTED =
  '<?xml version="1.0" encoding="UTF-8"?>\n<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3">' +
  '<book><frontmatter><doctitle>DTBook Title</doctitle><docauthor>Anna Example</docauthor></frontmatter>' +
  '<bodymatter><level1><h1>One</h1><p>Text<noteref idref="#n1">1</noteref>.</p>' +
  '<note id="n1"><p>The note.</p></note></level1></bodymatter></book></dtbook>\n';

const DTBOOK =
  '<?xml version="1.0" encoding="UTF-8"?>\n<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="en">' +
  '<head><meta name="dc:Title" content="DTBook"/></head><book><bodymatter><level1><h1>A poem</h1>' +
  '<epigraph><p>An epigraph.</p></epigraph><poem><linegroup><line>First line</line><line>Second line</line>' +
  '</linegroup></poem></level1></bodymatter></book></dtbook>\n';

describe('the EPUB import of DTBook', () => {
  it('converts a DTBook page with its poem and epigraph', async () => {
    const { doc } = parsePage(DTBOOK, 'dtbook');
    const book = await convertPages({
      pages: [{ path: 'OEBPS/poem.xml', doc, linear: true }],
      navigation: [],
      images: new Map(),
      descriptionWords: new Set(),
      notesTitle: 'Notes',
    });
    expect(book.bodyXml).toContain('<epigraph><p>An epigraph.</p></epigraph>');
    expect(book.bodyXml).toContain(
      '<poem><stanza><v>First line</v><v>Second line</v></stanza></poem>',
    );
  });

  it('reads its notes and leaves out the front matter that repeats the description', async () => {
    const { doc } = parsePage(NOTED, 'dtbook');
    const book = await convertPages({
      pages: [{ path: 'OEBPS/book.xml', doc, linear: true }],
      navigation: [],
      images: new Map(),
      descriptionWords: new Set(['dtbook', 'title', 'anna', 'example']),
      notesTitle: 'Notes',
    });
    expect(book.bodyXml).toBe(
      '<body><section><title><p>One</p></title><p>Text<a l:href="#note_book_n1" type="note">1</a>.</p></section></body>',
    );
    expect(book.notesXml).toContain(
      '<section id="note_book_n1"><title><p>1</p></title><p>The note.</p></section>',
    );
  });

  it("shows EPUB 3.0's switch by its fallback", async () => {
    const xhtml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
      '<head><title>t</title></head><body><h1>T</h1><p>x = <epub:switch><epub:case required-namespace="http://www.w3.org/1998/Math/MathML">' +
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi></math></epub:case><epub:default>a</epub:default></epub:switch></p></body></html>';
    const book = await convertPages({
      pages: [{ path: 'OEBPS/a.xhtml', doc: parsePage(xhtml, 'xhtml').doc, linear: true }],
      navigation: [],
      images: new Map(),
      descriptionWords: new Set(),
      notesTitle: 'Notes',
    });
    expect(book.bodyXml).toBe(
      '<body><section><title><p>T</p></title><p>x = a</p></section></body>',
    );
  });
});
