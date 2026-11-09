// Feature 011 (US5, US6; D15-D20, D45; contracts/markdown-export.md §1-§5): the Markdown export's
// text. The output is also rendered with markdown-it and the GitHub-style plugins the import uses,
// so that each element shows as D16-D20 say (SC-005).
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import { describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { serializeMarkdown } from '@/features/markdown/export/serialize';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

const text = (value: string, marks: ModelNodeJson['marks'] = []): ModelNodeJson => ({
  type: 'text',
  text: value,
  ...(marks && marks.length > 0 ? { marks } : {}),
});
let ids = 0;
const node = (
  type: string,
  content: ModelNodeJson[] = [],
  attrs: Record<string, unknown> = {},
): ModelNodeJson => ({
  type,
  attrs: { nodeId: `n${(ids += 1)}`, ...attrs },
  content,
});
const p = (...content: ModelNodeJson[]) => node('p', content);
const title = (...lines: string[]) =>
  node(
    'title',
    lines.map((line) => p(text(line))),
  );

function referenceBook(): Document {
  const main = node('body', [
    title('The Book'),
    node(
      'section',
      [
        title('Chapter One', 'The Start'),
        node('epigraph', [p(text('Wise words')), node('text-author', [text('Someone')])]),
        p(
          text('Plain, '),
          text('strong', [{ type: 'strong' }]),
          text(' and '),
          text('emphasis', [{ type: 'emphasis' }]),
          text(', '),
          text('gone', [{ type: 'strikethrough' }]),
          text(', '),
          text('x', [{ type: 'code' }]),
          text(', H'),
          text('2', [{ type: 'sub' }]),
          text('O, E=mc'),
          text('2', [{ type: 'sup' }]),
          text(' and a '),
          text('link', [{ type: 'link', attrs: { href: 'https://example.org' } }]),
          text(' and a note'),
          text('[1]', [{ type: 'link', attrs: { href: '#note1', type: 'note' } }]),
          text('.'),
        ),
        p(text('- Hello, said she * 2 _x_ [a] <b> # 1. done')),
        node('subtitle', [text('* * *')]),
        node('subtitle', [text('Part two')]),
        node('empty-line', []),
        p(text('let a = 1;', [{ type: 'code' }])),
        p(text('let b = 2;', [{ type: 'code' }])),
        node('poem', [
          title('Ode'),
          node('stanza', [node('v', [text('first line')]), node('v', [text('second line')])]),
          node('text-author', [text('Poet')]),
        ]),
        node('image', [], { href: '#pic.png', alt: 'A picture' }),
        p(text('a key '), node('inline-image', [], { href: '#ch-2605' }), text(' star')),
        p(text('Dear friend', [{ type: 'style', attrs: { name: 'letter' } }])),
        node('p', [text('Signed')], { style: 'sign' }),
        node('table', [
          node('tr', [
            node('th', [text('Room')], { align: 'center' }),
            node('th', [text('A|B')], { align: 'center' }),
          ]),
          node('tr', [
            node('td', [text('Hall')], { align: 'center' }),
            node('td', [text('1')], { align: 'center' }),
          ]),
        ]),
        node('table', [
          node('tr', [node('td', [text('wide')], { colspan: 2 })]),
          node('tr', [node('td', [text('a')]), node('td', [text('b')])]),
        ]),
        node('section', [p(text('An untitled subsection'))]),
        node('section', [
          title('Deep'),
          node('section', [
            title('Deeper'),
            node('section', [
              title('Deepest'),
              node('section', [title('Level six'), node('section', [title('Level seven')])]),
            ]),
          ]),
        ]),
      ],
      { id: 'ch1' },
    ),
    node('section', [
      title('Chapter Two'),
      p(text('Back to '), text('the start', [{ type: 'link', attrs: { href: '#ch1' } }])),
    ]),
  ]);
  const notes = node(
    'body',
    [
      title('Notes'),
      node('section', [title('1'), p(text('The note text.'))], { id: 'note1' }),
      node('section', [title('2'), p(text('Nobody points here.'))], { id: 'note2' }),
    ],
    { name: 'notes' },
  );
  const document = fakeDocument({ bodies: [main, notes] as unknown as BodyNode[] });
  document.description.titleInfo.bookTitle = 'The Book';
  document.description.titleInfo.authors = [
    { firstName: 'Ann', lastName: 'Writer', homePages: [], emails: [] },
  ];
  document.description.titleInfo.sequences = [{ name: 'Saga', number: 2, children: [] }];
  document.description.titleInfo.coverpage = [{ href: '#cover.jpg' }];
  document.stylesheets = [
    { type: 'text/css', content: '.letter { font-style: italic; }\n.sign { text-align: right; }' },
  ];
  document.binaries = [
    {
      id: 'cover.jpg',
      contentType: 'image/jpeg',
      size: 10,
    } as unknown as Document['binaries'][number],
    {
      id: 'pic.png',
      contentType: 'image/png',
      size: 10,
    } as unknown as Document['binaries'][number],
  ];
  return document;
}

const md = new MarkdownIt({ html: true }).use(footnote).use(sub).use(sup);

describe('the Markdown export (feature 011)', () => {
  it('opens with the header, the cover and the title page (D15, D16, D45)', () => {
    const { text: out } = serializeMarkdown(referenceBook(), {
      form: 'zip',
      includePictures: true,
    });
    const [, header] = /^---\n([\s\S]*?)\n---\n/.exec(out)!;
    expect(header).toContain('title: "The Book"');
    expect(header).toContain('author: ["Ann Writer"]');
    expect(header).toContain('series: "Saga"');
    expect(header).toContain('series_index: 2');
    expect(header).toContain('cover: "images/cover.jpg"');
    expect(header).toContain(
      'stylesheets: [{ type: "text/css", text: ".letter { font-style: italic; }\\n.sign { text-align: right; }" }]',
    );
    expect(header).toContain('header-includes: |');
    expect(header).toContain('  <style>');
    const body = out.slice(out.indexOf('\n---\n') + 5);
    expect(body).toMatch(
      /^\n!\[cover\]\(images\/cover\.jpg\)\n\n# The Book\n\n\*Saga #2\*\n\n\*\*Ann Writer\*\*\n\n---\n\n# The Book\n/,
    );
  });

  it('writes sections as headings by depth, untitled ones empty, deeper than six at six (D17)', () => {
    const { text: out } = serializeMarkdown(referenceBook(), {
      form: 'zip',
      includePictures: true,
    });
    expect(out).toContain('\n## Chapter One<br>The Start\n');
    expect(out).toContain('\n###\n\nAn untitled subsection');
    expect(out).toContain('\n###### Level six\n');
    expect(out).toContain('\n###### Level seven\n');
    expect(out).toContain('[the start](#chapter-one-the-start)');
  });

  it('writes the text, its formatting and its blocks as D18 lists them', () => {
    const { text: out } = serializeMarkdown(referenceBook(), {
      form: 'zip',
      includePictures: true,
    });
    expect(out).toContain(
      'Plain, **strong** and *emphasis*, ~~gone~~, `x`, H<sub>2</sub>O, E=mc<sup>2</sup> and a [link](https://example.org) and a note[^1].',
    );
    expect(out).toContain('> Wise words\n>\n> *Someone*');
    expect(out).toContain('\n---\n\n**Part two**\n\n\u00a0\n\n```\nlet a = 1;\nlet b = 2;\n```');
    expect(out).toContain('**Ode**\n\nfirst line  \nsecond line\n\n*Poet*');
    expect(out).toContain('![A picture](images/pic.png)');
    expect(out).toContain('a key ★ star');
    expect(out).toContain('<span class="letter">*Dear friend*</span>');
    expect(out).toContain('<span class="sign" data-fb2-style="element">Signed</span>');
    expect(out).toContain('[^1]: The note text.');
    expect(out).toContain('\n# Notes\n\n## 2\n\nNobody points here.');
  });

  it('escapes what Markdown would read as markup (D20) and writes tables as D19 says', () => {
    const { text: out } = serializeMarkdown(referenceBook(), {
      form: 'zip',
      includePictures: true,
    });
    expect(out).toContain('\\- Hello, said she \\* 2 \\_x\\_ \\[a\\] \\<b> # 1. done');
    expect(out).toContain('| Room | A\\|B |\n| :---: | :---: |\n| Hall | 1 |');
    expect(out).toContain(
      '<table>\n<tr><td colspan="2">wide</td></tr>\n<tr><td>a</td><td>b</td></tr>\n</table>',
    );
  });

  it('the one-file form names its pictures for the definitions at the end; unticked, none', () => {
    const one = serializeMarkdown(referenceBook(), { form: 'md', includePictures: true });
    expect(one.text).toContain('![A picture][pic.jpg]');
    expect(one.pictures).toEqual([
      { binaryId: 'cover.jpg', name: 'cover.jpg' },
      { binaryId: 'pic.png', name: 'pic.jpg' },
    ]);
    const none = serializeMarkdown(referenceBook(), { form: 'md', includePictures: false });
    expect(none.pictures).toEqual([]);
    expect(none.text).not.toContain('![');
    expect(none.text).not.toContain('cover:');
  });

  it('renders as the elements of D16-D20 in a CommonMark viewer with GitHub’s additions (SC-005)', () => {
    const { text: out } = serializeMarkdown(referenceBook(), {
      form: 'zip',
      includePictures: true,
    });
    const html = md.render(out.replace(/^---\n[\s\S]*?\n---\n/, ''));
    expect(html).toContain('<h1>The Book</h1>');
    expect(html).toContain('<h2>Chapter One<br>The Start</h2>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<code>x</code>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<table>');
    expect(html).toContain('<img src="images/pic.png" alt="A picture">');
    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('<p>- Hello, said she * 2 <em>x</em>'.replace('<em>x</em>', '_x_'));
    expect(html).not.toContain('<ul>');
  });
});
