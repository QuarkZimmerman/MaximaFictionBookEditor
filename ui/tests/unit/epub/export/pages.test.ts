/**
 * Feature 012 (T019; D5, D8-D12; contracts/epub-export.md §3-§4): the pages, notes, contents and
 * legacy parts of an exported book, and the export's own check of its result (D4, FR-005).
 */
import { describe, expect, it } from 'vitest';

import { buildEpub, PAGE_LIMIT, verifyEpub } from '@/features/epub/export/build';
import type { PlacedPicture } from '@/features/epub/export/render';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../../features/testUtils';

let next = 0;
const id = (): string => `t${++next}`;
const p = (text: string, marks?: unknown[]): unknown => ({
  type: 'p',
  attrs: { nodeId: id() },
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});
const title = (...lines: string[]): unknown => ({
  type: 'title',
  attrs: { nodeId: id() },
  content: lines.map((line) => p(line)),
});

function book(sections: unknown[], notes?: unknown[]): Document {
  const document = fakeDocument();
  document.description.documentInfo.id = '5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10';
  document.description.titleInfo.coverpage = [{ href: '#cover' }];
  document.bodies = [
    { type: 'body', attrs: { nodeId: id() }, content: sections } as unknown as BodyNode,
  ];
  if (notes) {
    document.bodies.push({
      type: 'body',
      attrs: { nodeId: id(), name: 'notes' },
      content: notes,
    } as unknown as BodyNode);
  }
  return document;
}

const pictures = new Map<string, PlacedPicture>([
  ['cover', { name: 'EPUB/images/cover.jpg', mediaType: 'image/jpeg' }],
  ['pic', { name: 'EPUB/images/pic.png', mediaType: 'image/png' }],
]);

function build(document: Document) {
  return buildEpub({
    document,
    pictures,
    modified: new Date('2026-11-10T00:00:00Z'),
    fallbackTitle: 'F',
  });
}

function textOf(files: { name: string; text: string }[], name: string): string {
  return files.find((file) => file.name === name)?.text ?? '';
}

describe('the EPUB pages', () => {
  it('write every FB2 element in its form, pictures with captions, notes as footnotes', () => {
    const document = book(
      [
        {
          type: 'section',
          attrs: { nodeId: id(), id: 'ch1' },
          content: [
            title('Chapter One', 'second line'),
            { type: 'epigraph', attrs: { nodeId: id() }, content: [p('An epigraph.')] },
            {
              type: 'image',
              attrs: { nodeId: id(), href: '#pic', alt: 'Alt', title: 'The caption' },
            },
            p('A note', [{ type: 'link', attrs: { href: '#n1', type: 'note' } }]),
            p('To two', [{ type: 'link', attrs: { href: '#ch2' } }]),
            p('Nowhere', [{ type: 'link', attrs: { href: '#missing' } }]),
            p('Web', [{ type: 'link', attrs: { href: 'https://www.google.com' } }]),
            { type: 'subtitle', attrs: { nodeId: id() }, content: [{ type: 'text', text: 'Sub' }] },
            { type: 'cite', attrs: { nodeId: id() }, content: [p('Quoted.')] },
            {
              type: 'poem',
              attrs: { nodeId: id() },
              content: [
                {
                  type: 'stanza',
                  attrs: { nodeId: id() },
                  content: [
                    {
                      type: 'v',
                      attrs: { nodeId: id() },
                      content: [{ type: 'text', text: 'Verse' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'table',
              attrs: { nodeId: id() },
              content: [
                {
                  type: 'tr',
                  attrs: { nodeId: id() },
                  content: [
                    {
                      type: 'td',
                      attrs: { nodeId: id(), colspan: 2, align: 'center' },
                      content: [{ type: 'text', text: 'Wide' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'section',
          attrs: { nodeId: id(), id: 'ch2' },
          content: [title('Chapter Two'), p('Last.')],
        },
      ],
      [
        {
          type: 'section',
          attrs: { nodeId: id(), id: 'n1' },
          content: [title('1'), p('The note.')],
        },
      ],
    );
    const built = build(document);
    const first = textOf(built.files, 'EPUB/text/0001.xhtml');
    expect(first).toContain('<h1 class="fb2-title">Chapter One<br/>second line</h1>');
    expect(first).toContain('class="fb2-epigraph" epub:type="epigraph"');
    expect(first).toContain(
      '<figure class="fb2-image"><img src="../images/pic.png" alt="Alt"/><figcaption>The caption</figcaption></figure>',
    );
    expect(first).toMatch(/<a epub:type="noteref" id="ref1" href="notes\.xhtml#n1">A note<\/a>/);
    expect(first).toContain('<a href="0002.xhtml#ch2">To two</a>');
    expect(first).toContain('<p>Nowhere</p>');
    expect(first).toContain('<a href="https://www.google.com">Web</a>');
    expect(first).toContain('<p class="fb2-subtitle">Sub</p>');
    expect(first).toContain('<blockquote class="fb2-cite">');
    expect(first).toContain('<p class="fb2-v">Verse</p>');
    expect(first).toContain('<td colspan="2" class="fb2-align-center">Wide</td>');
    const notes = textOf(built.files, 'EPUB/text/notes.xhtml');
    expect(notes).toContain('<aside id="n1" class="fb2-note" epub:type="footnote">');
    expect(notes).toContain('<a href="0001.xhtml#ref1">\u21a9</a>');
    expect(built.summary).toContainEqual({ kind: 'linkAsText', detail: '#missing' });
    expect(built.counts).toMatchObject({ notes: 1, tables: 1 });
    expect(textOf(built.files, 'EPUB/text/cover.xhtml')).toContain(
      '<img src="../images/cover.jpg" alt="Cover"/>',
    );
    expect(
      verifyEpub(
        built.files,
        [...pictures.values()].map((picture) => picture.name),
      ),
    ).toEqual([]);
  });

  it('give the contents, the landmarks, the NCX and the guide (D5, D8, D9)', () => {
    const built = build(
      book([
        {
          type: 'section',
          attrs: { nodeId: id() },
          content: [
            title('One'),
            { type: 'section', attrs: { nodeId: id() }, content: [title('One.1'), p('x')] },
          ],
        },
        { type: 'section', attrs: { nodeId: id() }, content: [title('Two'), p('y')] },
      ]),
    );
    const nav = textOf(built.files, 'EPUB/nav.xhtml');
    expect(nav).toMatch(
      /<li><a href="text\/0001\.xhtml#s1">One<\/a><ol><li><a href="text\/0001\.xhtml#s2">One\.1<\/a><\/li><\/ol><\/li>/,
    );
    expect(nav).toContain('<a epub:type="cover" href="text/cover.xhtml">Cover</a>');
    expect(nav).toContain('<a epub:type="bodymatter" href="text/0001.xhtml">Start</a>');
    const ncx = textOf(built.files, 'EPUB/toc.ncx');
    expect(ncx).toContain(
      '<meta name="dtb:uid" content="urn:uuid:5b0e8a52-3c1d-4f6e-9a7b-2c8d4e6f8a10"/>',
    );
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
    const opf = textOf(built.files, 'EPUB/package.opf');
    expect(opf).toContain('<spine toc="ncx">');
    expect(opf).toContain('<reference type="cover"');
    expect(opf).toContain('<reference type="title-page"');
    expect(opf).toContain('<reference type="text" title="Start" href="text/0001.xhtml"/>');
  });

  it('divide a page larger than the limit between its blocks, marking the continuation (D5)', () => {
    const paragraphs = Array.from({ length: 700 }, (_, n) => p(`${n} ${'word '.repeat(100)}`));
    const built = build(
      book([{ type: 'section', attrs: { nodeId: id() }, content: [title('Long'), ...paragraphs] }]),
    );
    const pages = built.files.filter((file) => /^EPUB\/text\/\d{4}\.xhtml$/.test(file.name));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      expect(new TextEncoder().encode(page.text).length).toBeLessThan(PAGE_LIMIT + 2000);
    expect(pages[1]!.text).toContain('class="fb2-section fb-continued"');
    expect(
      verifyEpub(
        built.files,
        [...pictures.values()].map((picture) => picture.name),
      ),
    ).toEqual([]);
  });

  it('finds a fault in a result the export would not write (FR-005)', () => {
    const built = build(
      book([{ type: 'section', attrs: { nodeId: id() }, content: [title('One'), p('x')] }]),
    );
    const broken = built.files.map((file) =>
      file.name === 'EPUB/text/0001.xhtml'
        ? { ...file, text: file.text.replace('</body>', '<a href="9999.xhtml">x</a></body>') }
        : file,
    );
    expect(
      verifyEpub(
        broken,
        [...pictures.values()].map((picture) => picture.name),
      ),
    ).toEqual(['EPUB/text/0001.xhtml: 9999.xhtml names no file of the EPUB']);
  });
});
