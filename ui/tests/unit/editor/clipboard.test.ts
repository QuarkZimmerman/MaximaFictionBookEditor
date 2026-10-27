/**
 * Clipboard normalisation (T065): structured paste keeps structure where legal and flattens to
 * paragraphs otherwise; external HTML keeps only supported marks; plain text becomes paragraphs.
 */

import {
  DOMParser as PMDOMParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Node as PMNode,
} from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import {
  flattenToParagraphs,
  insertSlice,
  payloadFromSlice,
  sliceFromExternalHtml,
  sliceFromPayload,
  sliceFromPlainText,
} from '@/editor/plugins/clipboard';
import { fb2Schema } from '@/editor/schema';

const { nodes: N, marks: M } = fb2Schema;

function p(text = '') {
  return N.p!.create(null, text ? fb2Schema.text(text) : undefined);
}
function docWith(...children: PMNode[]) {
  return N.doc!.create(null, N.body!.create(null, N.section!.create(null, children)));
}
function at(doc: PMNode, pos: number) {
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}
function names(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child) => out.push(child.type.name));
  return out;
}

const poem = N.poem!.create(
  null,
  N.stanza!.create(null, [
    N.v!.create(null, fb2Schema.text('roses')),
    N.v!.create(null, fb2Schema.text('violets')),
  ]),
);

describe('clipboard', () => {
  it('round-trips a structured slice through the custom MIME payload', () => {
    const slice = new Slice(Fragment.from(poem), 0, 0);
    const json = JSON.stringify(payloadFromSlice(slice));
    const back = sliceFromPayload(json)!;
    expect(back.content.firstChild!.type.name).toBe('poem');
    expect(back.content.firstChild!.textContent).toBe('rosesviolets');
    expect(sliceFromPayload('{"format":"other"}')).toBeNull();
    expect(sliceFromPayload('not json')).toBeNull();
  });

  it('pastes a poem as a poem into a section and as paragraphs into a title', () => {
    const slice = new Slice(Fragment.from(poem), 0, 0);
    const sectionDoc = docWith(p('Before'), p('After'));
    const end = 3 + 'Before'.length; // end of the first paragraph
    const inSection = at(sectionDoc, end).apply(insertSlice(at(sectionDoc, end), slice));
    const section = inSection.doc.child(0).child(0);
    expect(names(section).filter((n) => n === 'poem')).toHaveLength(1);
    expect(section.textContent).toBe('Beforerosesviolets' + 'After');
    expect(inSection.doc.check()).toBeUndefined();

    const titleDoc = N.doc!.create(
      null,
      N.body!.create(null, N.section!.create(null, [N.title!.create(null, p('Head')), p('x')])),
    );
    const inTitle = at(titleDoc, 5).apply(insertSlice(at(titleDoc, 5), slice));
    const title = inTitle.doc.child(0).child(0).child(0);
    expect(names(title).every((name) => name === 'p')).toBe(true);
    expect(title.textContent).toContain('roses');
    expect(title.textContent).toContain('violets');
    expect(inTitle.doc.check()).toBeUndefined();
  });

  it('pastes an open poem slice (verses selected from inside) as title lines, not one line', () => {
    const poemDoc = docWith(p('Intro'), poem);
    // Select from the start of the first verse to the end of the last one.
    const state = EditorState.create({ doc: poemDoc });
    const from = 3 + 'Intro'.length + 1 + 1 + 1 + 1; // after p close: poem, stanza, v opens
    const to = from + 'roses'.length + 2 + 'violets'.length;
    const selected = state.apply(state.tr.setSelection(TextSelection.create(poemDoc, from, to)));
    const slice = selected.selection.content();
    expect(slice.openStart).toBe(5); // open down to the verse (body, section, poem, stanza, v)
    const titleDoc = N.doc!.create(
      null,
      N.body!.create(null, N.section!.create(null, [N.title!.create(null, p()), p('x')])),
    );
    const inTitle = at(titleDoc, 4).apply(insertSlice(at(titleDoc, 4), slice));
    const title = inTitle.doc.child(0).child(0).child(0);
    expect(names(title)).toEqual(['p', 'p']);
    expect(title.child(0).textContent).toBe('roses');
    expect(title.child(1).textContent).toBe('violets');
    // ... and into a section paragraph it stays a poem.
    const sectionDoc = docWith(p('Before'), p());
    const target = 3 + 'Before'.length + 2 + 1;
    const inSection = at(sectionDoc, target).apply(insertSlice(at(sectionDoc, target), slice));
    expect(names(inSection.doc.child(0).child(0)).filter((n) => n === 'poem')).toHaveLength(1);
    expect(inSection.doc.check()).toBeUndefined();
  });

  it('flattens external HTML to paragraphs keeping only supported marks', () => {
    const html =
      '<div><h1>Title</h1><p style="color:red">Some <b>bold</b>, <i>italic</i>, <u>underlined</u> and <span style="font-weight:bold">heavy</span> text.</p><ul><li>item</li></ul></div>';
    const slice = sliceFromExternalHtml(html);
    const blocks: PMNode[] = [];
    slice.content.forEach((n) => blocks.push(n));
    expect(blocks.map((b) => b.type.name)).toEqual(['p', 'p', 'p']);
    expect(blocks[0]!.textContent).toBe('Title');
    const marksOf = (text: string) => {
      let found: string[] = [];
      blocks[1]!.forEach((child) => {
        if (child.isText && child.text === text) found = child.marks.map((m) => m.type.name);
      });
      return found;
    };
    expect(marksOf('bold')).toEqual(['strong']);
    expect(marksOf('italic')).toEqual(['emphasis']);
    expect(marksOf('underlined')).toEqual([]); // underline is not an FB2 style
    expect(marksOf('heavy')).toEqual(['strong']);
    expect(blocks[2]!.textContent).toBe('item');
  });

  it('turns plain text into paragraphs (blank lines become empty lines) or inline text', () => {
    const multi = sliceFromPlainText('one\r\ntwo\n\nthree');
    const blocks: string[] = [];
    multi.content.forEach((n) => blocks.push(n.type.name));
    expect(blocks).toEqual(['p', 'p', 'empty_line', 'p']);
    const single = sliceFromPlainText('just words');
    expect(single.openStart).toBe(0);
    expect(single.content.firstChild!.isText).toBe(true);
  });

  it('flattenToParagraphs keeps marks and inline images', () => {
    const cite = N.cite!.create(null, [
      N.p!.create(null, [
        fb2Schema.text('a', [M.emphasis!.create()]),
        N.inline_image!.create({ href: '#i' }),
      ]),
      N.text_author!.create(null, fb2Schema.text('me')),
    ]);
    const flat = flattenToParagraphs(Fragment.from(cite));
    expect(flat.map((n) => n.type.name)).toEqual(['p', 'p']);
    expect(flat[0]!.child(0).marks[0]!.type.name).toBe('emphasis');
    expect(flat[0]!.child(1).type.name).toBe('inline_image');
    expect(flat[1]!.textContent).toBe('me');
  });

  it("own HTML keeps a mark's lang and a link's xlinkType; foreign HTML brings neither", () => {
    // Feature 006 (FR-064; data-model §8.5, §12.2): the editor's own markup carries the
    // attributes, the generic parse rules never give them.
    const paragraph = N.p!.create(null, [
      fb2Schema.text('la', [M.emphasis!.create({ lang: 'la' })]),
      fb2Schema.text(' '),
      fb2Schema.text('named', [M.style!.create({ name: 'foreign', lang: 'de' })]),
      fb2Schema.text(' '),
      fb2Schema.text('note', [M.link!.create({ href: '#n1', type: 'note', xlinkType: 'simple' })]),
    ]);
    const marksOf = (fragment: Fragment) => {
      const out: { mark: string; attrs: Record<string, unknown> }[] = [];
      fragment.descendants((node) => {
        for (const mark of node.marks) out.push({ mark: mark.type.name, attrs: mark.attrs });
      });
      return out;
    };
    const ownMarks = [
      { mark: 'emphasis', attrs: { lang: 'la' } },
      { mark: 'style', attrs: { name: 'foreign', lang: 'de' } },
      { mark: 'link', attrs: { href: '#n1', type: 'note', xlinkType: 'simple' } },
    ];
    expect(marksOf(Fragment.from(paragraph))).toEqual(ownMarks);
    // The own flavour (JSON payload) keeps them.
    const slice = new Slice(Fragment.from(paragraph), 0, 0);
    expect(marksOf(sliceFromPayload(JSON.stringify(payloadFromSlice(slice)))!.content)).toEqual(
      ownMarks,
    );
    // The own HTML (what serializeForClipboard writes and view.pasteHTML parses) keeps them.
    const container = document.createElement('div');
    container.appendChild(
      DOMSerializer.fromSchema(fb2Schema).serializeFragment(Fragment.from(paragraph)),
    );
    expect(container.innerHTML).toContain('<em class="fb-emphasis" lang="la">la</em>');
    expect(container.innerHTML).toContain('data-xlink-type="simple"');
    expect(marksOf(PMDOMParser.fromSchema(fb2Schema).parseSlice(container).content)).toEqual(
      ownMarks,
    );
    // Foreign HTML: a language or an xlink type in another program's markup is not taken.
    const foreign = sliceFromExternalHtml(
      '<p><em lang="la">la</em> <strong lang="de">de</strong> <span class="x" lang="fr">fr</span> ' +
        '<a href="#n1" data-xlink-type="simple">link</a></p>',
    );
    expect(marksOf(foreign.content)).toEqual([
      { mark: 'emphasis', attrs: { lang: null } },
      { mark: 'strong', attrs: { lang: null } },
      { mark: 'link', attrs: { href: '#n1', type: null, xlinkType: null } },
    ]);
  });
});
