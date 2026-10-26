import { DOMParser, DOMSerializer, Fragment } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { createReport, nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import {
  MARK_ORDER,
  assignNodeIds,
  createNodeIdGenerator,
  fb2NameFor,
  fb2Schema,
  findNodeById,
  isBlock,
  isStructural,
  nodeTypeFor,
  rawXmlElementName,
} from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';

const { nodes, marks } = fb2Schema;

function p(text: string, attrs: Record<string, unknown> = {}) {
  return nodes.p!.create(attrs, text ? fb2Schema.text(text) : undefined);
}

describe('fb2Schema', () => {
  it('declares every node type of document-model.d.ts (hyphens mapped to underscores)', () => {
    const expected = [
      'doc',
      'body',
      'section',
      'title',
      'epigraph',
      'annotation',
      'p',
      'subtitle',
      'text_author',
      'v',
      'empty_line',
      'poem',
      'stanza',
      'date',
      'cite',
      'table',
      'tr',
      'td',
      'th',
      'image',
      'inline_image',
      'raw_xml',
      'raw_xml_inline',
      'text',
    ];
    for (const name of expected) expect(nodes[name], name).toBeDefined();
    expect(Object.keys(marks)).toEqual(MARK_ORDER);
  });

  it('maps FB2 names to node types and back', () => {
    expect(nodeTypeFor('empty-line')).toBe(nodes.empty_line);
    expect(nodeTypeFor('text-author')).toBe(nodes.text_author);
    expect(nodeTypeFor('inline-image')).toBe(nodes.inline_image);
    expect(nodeTypeFor('raw-xml')).toBe(nodes.raw_xml);
    expect(nodeTypeFor('raw-xml', true)).toBe(nodes.raw_xml_inline);
    expect(nodeTypeFor('p')).toBe(nodes.p);
    expect(nodeTypeFor('nonsense')).toBeUndefined();
    expect(fb2NameFor(nodes.empty_line!)).toBe('empty-line');
    expect(fb2NameFor('raw_xml_inline')).toBe('raw-xml');
    expect(fb2NameFor('text_author')).toBe('text-author');
    expect(fb2NameFor('section')).toBe('section');
  });

  it('classifies block, inline and structural types', () => {
    expect(isBlock('section')).toBe(true);
    expect(isBlock('p')).toBe(true);
    expect(isBlock('empty_line')).toBe(true);
    expect(isBlock('inline_image')).toBe(false);
    expect(isBlock('text')).toBe(false);
    expect(isBlock('doc')).toBe(false);
    expect(isStructural('poem')).toBe(true);
    expect(isStructural('p')).toBe(false);
  });

  it('allows zero bodies (descriptor files) and enforces the body/section order', () => {
    expect(() => nodes.doc!.createChecked(null)).not.toThrow();
    const section = nodes.section!.createChecked({ nodeId: 's' }, p('text'));
    const body = nodes.body!.createChecked({ nodeId: 'b' }, [
      nodes.image!.create({ href: '#cover' }),
      nodes.title!.create(null, p('Title')),
      nodes.epigraph!.create(null, [p('e'), nodes.text_author!.create(null, fb2Schema.text('a'))]),
      section,
    ]);
    expect(body.childCount).toBe(4);
    // title after section is not allowed
    expect(() =>
      nodes.body!.createChecked(null, [section, nodes.title!.create(null, p('t'))]),
    ).toThrow();
    // body needs at least one section
    expect(() => nodes.body!.createChecked(null, [nodes.title!.create(null, p('t'))])).toThrow();
  });

  it('section: either child sections or blocks, first block not an image', () => {
    const image = nodes.image!.create({ href: '#x' });
    // one image is the section header image; a second image cannot be the first block
    expect(() => nodes.section!.createChecked(null, [image, p('a')])).not.toThrow();
    expect(() => nodes.section!.createChecked(null, [image, image, p('a')])).toThrow();
    expect(() => nodes.section!.createChecked(null, [image, p('a'), image])).not.toThrow();
    expect(() => nodes.section!.createChecked(null, [p('a'), image])).not.toThrow();
    expect(() => nodes.section!.createChecked(null)).toThrow(); // empty section
    const child = nodes.section!.create(null, p('a'));
    expect(() => nodes.section!.createChecked(null, [child, p('mixed')])).toThrow();
    expect(() =>
      nodes.section!.createChecked(null, [
        nodes.title!.create(null, p('t')),
        nodes.epigraph!.create(null, p('e')),
        image,
        nodes.annotation!.create(null, p('ann')),
        child,
        child,
      ]),
    ).not.toThrow();
    // a raw-xml block may appear anywhere a block may
    expect(() =>
      nodes.section!.createChecked(null, [nodes.raw_xml!.create({ xml: '<x/>' }), p('a')]),
    ).not.toThrow();
  });

  it('poem, stanza, cite, table content models', () => {
    const v = nodes.v!.create(null, fb2Schema.text('line'));
    const stanza = nodes.stanza!.createChecked(null, [nodes.subtitle!.create(null), v, v]);
    expect(() => nodes.stanza!.createChecked(null, [nodes.subtitle!.create(null)])).toThrow();
    const poem = nodes.poem!.createChecked(null, [
      nodes.title!.create(null, p('T')),
      stanza,
      nodes.subtitle!.create(null),
      nodes.text_author!.create(null),
      nodes.date!.create({ value: '1900-01-01' }, fb2Schema.text('1900')),
    ]);
    expect(poem.childCount).toBe(5);
    expect(() => nodes.poem!.createChecked(null, [nodes.text_author!.create(null)])).toThrow();
    expect(() =>
      nodes.cite!.createChecked(null, [p('q'), nodes.text_author!.create(null), p('after')]),
    ).toThrow();
    const row = nodes.tr!.createChecked({ align: 'center' }, [
      nodes.th!.create({ colspan: 2 }, fb2Schema.text('h')),
      nodes.td!.create(null, fb2Schema.text('d')),
    ]);
    expect(() => nodes.table!.createChecked({ id: 't' }, row)).not.toThrow();
    expect(() => nodes.table!.createChecked(null)).toThrow();
    expect(() =>
      nodes.date!.createChecked(null, fb2Schema.text('x', [marks.strong!.create()])),
    ).toThrow();
  });

  it('sorts marks in the canonical order and keeps link attrs', () => {
    const text = fb2Schema.text('x', [
      marks.link!.create({ href: '#n_1', type: 'note' }),
      marks.emphasis!.create(),
      marks.strong!.create(),
    ]);
    expect(text.marks.map((m) => m.type.name)).toEqual(['strong', 'emphasis', 'link']);
    expect(text.marks[2]!.attrs).toEqual({ href: '#n_1', type: 'note', xlinkType: null });
  });

  it('renders semantic DOM with fb-* classes', () => {
    const section = nodes.section!.create({ nodeId: 'n7', id: 'ch1', lang: 'ru' }, [
      nodes.title!.create(null, p('Глава')),
      p('Текст', { style: 'lead' }),
      nodes.empty_line!.create(),
      nodes.image!.create({ href: '#pic.png', alt: 'alt', title: 'Caption', id: 'img1' }),
      nodes.raw_xml!.create({ xml: '<weird a="1">x</weird>' }),
    ]);
    const spec = section.type.spec.toDOM!(section) as unknown as unknown[];
    expect(spec[0]).toBe('div');
    expect(spec[1]).toMatchObject({
      class: 'fb-section',
      'data-node-id': 'n7',
      'data-id': 'ch1',
      lang: 'ru',
    });
    const para = section.child(1);
    expect(para.type.spec.toDOM!(para)).toEqual(['p', { class: 'fb-p', 'data-style': 'lead' }, 0]);
    const empty = section.child(2);
    expect(empty.type.spec.toDOM!(empty)).toEqual(['p', { class: 'fb-empty-line' }]);
    const image = section.child(3);
    const imageSpec = image.type.spec.toDOM!(image) as unknown as unknown[];
    expect(imageSpec[0]).toBe('figure');
    expect(imageSpec[1]).toMatchObject({
      class: 'fb-image',
      'data-href': '#pic.png',
      title: 'Caption',
    });
    expect(imageSpec[3]).toEqual(['figcaption', { class: 'fb-image-caption' }, 'Caption']);
    const raw = section.child(4);
    const rawSpec = raw.type.spec.toDOM!(raw) as unknown as unknown[];
    expect(rawSpec[2]).toEqual(['span', { class: 'fb-unknown-name' }, 'weird']);
    const note = marks.link!.create({ href: '#n_1', type: 'note' });
    expect(marks.link!.spec.toDOM!(note, true)).toEqual([
      'a',
      { class: 'fb-link fb-note', href: '#n_1', 'data-type': 'note' },
      0,
    ]);
    expect(marks.style!.spec.toDOM!(marks.style!.create({ name: 'x' }), true)).toEqual([
      'span',
      { class: 'fb-style', 'data-style': 'x' },
      0,
    ]);
    expect(rawXmlElementName('  <l:foo-bar x="1"/>')).toBe('l:foo-bar');
    expect(rawXmlElementName('garbage')).toBe('?');
  });

  it('assignNodeIds fills missing ids without touching existing ones and findNodeById finds them', () => {
    const doc = nodes.doc!.create(null, [
      nodes.body!.create({ nodeId: 'b1' }, [
        nodes.section!.create(null, [p('a', { nodeId: 'p1' }), p('b')]),
      ]),
    ]);
    const gen = createNodeIdGenerator('t_');
    const withIds = assignNodeIds(doc, gen);
    expect(withIds).not.toBe(doc);
    const ids: (string | null)[] = [];
    withIds.descendants((node) => {
      if (!node.isText) ids.push(node.attrs.nodeId as string | null);
    });
    expect(ids).toEqual(['b1', 't_1', 'p1', 't_2']);
    expect(assignNodeIds(withIds, gen)).toBe(withIds); // nothing missing: same instance
    expect(findNodeById(withIds, 'p1')?.node.textContent).toBe('a');
    expect(findNodeById(withIds, 'nope')).toBeNull();
    expect(Fragment.from(withIds.content).childCount).toBe(1);
  });
});

/** Model JSON -> ProseMirror -> model JSON, with the conversion's problems. */
function viaEditor(json: ModelNodeJson) {
  const report = createReport();
  const node = nodeFromModel(json, report);
  return {
    node: node!,
    back: nodeToModel(node!),
    problems: report.problems.map((problem) => problem.message),
  };
}

describe('feature 006: cells, marks and atoms in the schema and the conversions', () => {
  it("td and th declare lang; a model cell's lang lands in node.attrs.lang, not in extraAttrs", () => {
    for (const type of ['td', 'th'] as const) {
      expect(Object.keys(nodes[type]!.spec.attrs ?? {})).toContain('lang');
      const cell: ModelNodeJson = {
        type,
        attrs: {
          nodeId: 'c1',
          colspan: 2,
          lang: 'de',
          unknownAttrs: { rowspan: '00', '{http://www.w3.org/1999/xlink}title': 't' },
        },
        content: [{ type: 'text', text: 'x' }],
      };
      const { node, back, problems } = viaEditor(cell);
      expect(problems).toEqual([]);
      expect(node.attrs.lang).toBe('de');
      expect(node.attrs.colspan).toBe(2);
      // Only the undeclared rest waits in extraAttrs: unknownAttrs, as it came.
      expect(node.attrs.extraAttrs).toEqual({
        unknownAttrs: { rowspan: '00', '{http://www.w3.org/1999/xlink}title': 't' },
      });
      expect(back).toEqual(cell);
      // The cell's DOM form carries the language for the editor's own HTML.
      expect(node.type.spec.toDOM!(node)).toEqual([
        type,
        { class: `fb-${type}`, 'data-node-id': 'c1', lang: 'de', colspan: '2' },
        0,
      ]);
    }
    // An empty language is kept as written (File > Validate reports it).
    const empty = viaEditor({ type: 'td', attrs: { nodeId: 'c2', lang: '' }, content: [] });
    expect(empty.node.attrs.lang).toBe('');
    expect(empty.back).toEqual({ type: 'td', attrs: { nodeId: 'c2', lang: '' }, content: [] });
  });

  it('marks declare lang and link declares xlinkType; both survive fromModel then toModel', () => {
    for (const name of ['strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code', 'style']) {
      expect(Object.keys(marks[name]!.spec.attrs ?? {}), name).toContain('lang');
    }
    expect(Object.keys(marks.link!.spec.attrs ?? {})).toEqual(['href', 'type', 'xlinkType']);
    const paragraph: ModelNodeJson = {
      type: 'p',
      attrs: { nodeId: 'p1' },
      content: [
        { type: 'text', text: 'a', marks: [{ type: 'strong', attrs: { lang: 'la' } }] },
        { type: 'text', text: 'b', marks: [{ type: 'code', attrs: { lang: '' } }] },
        { type: 'text', text: 'c', marks: [{ type: 'style', attrs: { name: 'x', lang: 'la' } }] },
        {
          type: 'text',
          text: 'd',
          marks: [{ type: 'link', attrs: { href: '#n1', type: 'note', xlinkType: 'simple' } }],
        },
        { type: 'text', text: 'e', marks: [{ type: 'emphasis' }] },
        { type: 'text', text: 'f', marks: [{ type: 'link', attrs: { href: '#s2' } }] },
      ],
    };
    const { node, back, problems } = viaEditor(paragraph);
    expect(problems).toEqual([]);
    expect(node.child(0).marks[0]!.attrs).toEqual({ lang: 'la' });
    expect(node.child(1).marks[0]!.attrs).toEqual({ lang: '' });
    expect(node.child(2).marks[0]!.attrs).toEqual({ name: 'x', lang: 'la' });
    expect(node.child(3).marks[0]!.attrs).toEqual({
      href: '#n1',
      type: 'note',
      xlinkType: 'simple',
    });
    expect(node.child(4).marks[0]!.attrs).toEqual({ lang: null });
    expect(back).toEqual(paragraph);
    // The DOM form: lang on the element when set ("" included), data-xlink-type on a link.
    const dom = (index: number) =>
      node.child(index).marks[0]!.type.spec.toDOM!(node.child(index).marks[0]!, true);
    expect(dom(0)).toEqual(['strong', { class: 'fb-strong', lang: 'la' }, 0]);
    expect(dom(1)).toEqual(['code', { class: 'fb-code', lang: '' }, 0]);
    expect(dom(2)).toEqual(['span', { class: 'fb-style', 'data-style': 'x', lang: 'la' }, 0]);
    expect(dom(3)).toEqual([
      'a',
      { class: 'fb-link fb-note', href: '#n1', 'data-type': 'note', 'data-xlink-type': 'simple' },
      0,
    ]);
    expect(dom(4)).toEqual(['em', { class: 'fb-emphasis' }, 0]);
  });

  it("an inline image's and an inline raw-xml node's marks survive fromModel then toModel", () => {
    // Feature 006 (FR-067; document-model §2.6): atoms keep the link and the formatting around
    // them; a block raw-xml node never takes marks, an atom without marks has no member.
    const paragraph: ModelNodeJson = {
      type: 'p',
      attrs: { nodeId: 'p1' },
      content: [
        { type: 'text', text: 'see ', marks: [{ type: 'link', attrs: { href: '#s1' } }] },
        {
          type: 'inline-image',
          attrs: { nodeId: 'i1', href: '#pic.png' },
          marks: [{ type: 'strong' }, { type: 'link', attrs: { href: '#s1', type: 'note' } }],
        },
        {
          type: 'raw-xml',
          attrs: { nodeId: 'r1', xml: '<!-- c -->', inline: true },
          marks: [{ type: 'emphasis', attrs: { lang: 'la' } }],
        },
        { type: 'inline-image', attrs: { nodeId: 'i2', href: '#pic.png' } },
      ],
    };
    const { node, back, problems } = viaEditor(paragraph);
    expect(problems).toEqual([]);
    expect(node.child(1).type.name).toBe('inline_image');
    expect(node.child(1).marks.map((m) => m.type.name)).toEqual(['strong', 'link']);
    expect(node.child(2).type.name).toBe('raw_xml_inline');
    expect(node.child(2).marks[0]!.attrs).toEqual({ lang: 'la' });
    expect(node.child(3).marks).toEqual([]);
    expect(back).toEqual(paragraph);
    // An inline raw node kept from its original JSON (a node the schema could not take) gives
    // back its current marks in place of the stored ones.
    const odd: ModelNodeJson = {
      type: 'p',
      attrs: { nodeId: 'p2' },
      content: [
        {
          type: 'mystery',
          attrs: { nodeId: 'm1' },
          marks: [{ type: 'strong' }],
        },
      ],
    };
    const converted = viaEditor(odd);
    const unknown = converted.node.child(0);
    expect(unknown.type.name).toBe('raw_xml_inline');
    expect(unknown.marks.map((m) => m.type.name)).toEqual(['strong']);
    expect(converted.back).toEqual(odd);
    const restyled = unknown.mark([fb2Schema.marks.code!.create()]);
    expect(nodeToModel(restyled)).toEqual({
      type: 'mystery',
      attrs: { nodeId: 'm1' },
      marks: [{ type: 'code' }],
    });
    expect(nodeToModel(unknown.mark([]))).toEqual({ type: 'mystery', attrs: { nodeId: 'm1' } });
    // A block raw-xml node is created without marks.
    const block = viaEditor({
      type: 'raw-xml',
      attrs: { nodeId: 'b1', xml: '<x/>', inline: false },
      marks: [{ type: 'strong' }],
    } as ModelNodeJson);
    expect(block.node.type.name).toBe('raw_xml');
    expect(block.node.marks).toEqual([]);
    expect(block.back).toEqual({
      type: 'raw-xml',
      attrs: { nodeId: 'b1', xml: '<x/>', inline: false },
    });
  });

  it('the formatting marks exclude nothing: two styles, or two marks of each of strong to code with different languages, sit on one node in the order added, an equal one is not added twice, and Node.check accepts either order', () => {
    // Feature 006 (FR-069; decision 23 as widened at /speckit-analyze): nested formatting of
    // one kind with other attributes is kept.
    const a = marks.style!.create({ name: 'a' });
    const b = marks.style!.create({ name: 'b' });
    const ab = b.addToSet(a.addToSet([]));
    expect(ab.map((m) => m.attrs.name)).toEqual(['a', 'b']);
    expect(a.addToSet(ab)).toBe(ab); // an equal one is not added twice
    expect(a.addToSet(b.addToSet([])).map((m) => m.attrs.name)).toEqual(['b', 'a']);
    for (const name of ['strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code']) {
      const type = marks[name]!;
      expect(type.spec.excludes, name).toBe('');
      const la = type.create({ lang: 'la' });
      const de = type.create({ lang: 'de' });
      const plain = type.create();
      const set = plain.addToSet(de.addToSet(la.addToSet([])));
      expect(
        set.map((m) => m.attrs.lang),
        name,
      ).toEqual(['la', 'de', null]);
      expect(type.create({ lang: 'de' }).addToSet(set), name).toBe(set);
      for (const order of [
        [la, de],
        [de, la],
      ]) {
        const text = fb2Schema.text('x', order);
        expect(text.marks, name).toEqual(order);
        const paragraph = nodes.p!.create(null, text);
        expect(() => paragraph.check(), name).not.toThrow();
      }
    }
    // Across kinds the schema's rank order holds.
    const mixed = marks
      .strong!.create()
      .addToSet(b.addToSet(marks.emphasis!.create().addToSet([])));
    expect(mixed.map((m) => m.type.name)).toEqual(['strong', 'emphasis', 'style']);
  });

  it('link still excludes itself', () => {
    expect(marks.link!.spec.excludes).toBeUndefined();
    const first = marks.link!.create({ href: '#a' });
    const second = marks.link!.create({ href: '#b' });
    expect(second.addToSet(first.addToSet([])).map((m) => m.attrs.href)).toEqual(['#b']);
    expect(() => nodes.p!.create(null, fb2Schema.text('x', [first, second])).check()).toThrow();
  });

  it('nested span.fb-style elements, and nested em.fb-emphasis elements with different lang, parse as two marks, outer first, and serialise back nested', () => {
    const html =
      '<p class="fb-p"><span class="fb-style" data-style="a">x<span class="fb-style" data-style="b">y</span></span>' +
      '<em class="fb-emphasis" lang="la">u<em class="fb-emphasis" lang="de">v</em></em></p>';
    const container = document.createElement('div');
    container.innerHTML = html;
    const slice = DOMParser.fromSchema(fb2Schema).parseSlice(container);
    const paragraph = slice.content.firstChild!;
    const runs: [string, unknown[]][] = [];
    paragraph.forEach((child) =>
      runs.push([
        child.text ?? '',
        child.marks.map((m) => (m.type.name === 'style' ? m.attrs.name : m.attrs.lang)),
      ]),
    );
    expect(runs).toEqual([
      ['x', ['a']],
      ['y', ['a', 'b']],
      ['u', ['la']],
      ['v', ['la', 'de']],
    ]);
    const out = document.createElement('div');
    out.appendChild(DOMSerializer.fromSchema(fb2Schema).serializeFragment(paragraph.content));
    expect(out.innerHTML).toBe(
      '<span class="fb-style" data-style="a">x<span class="fb-style" data-style="b">y</span></span>' +
        '<em class="fb-emphasis" lang="la">u<em class="fb-emphasis" lang="de">v</em></em>',
    );
  });

  it('text typed inside [emphasis la, emphasis de] carries both', () => {
    const la = marks.emphasis!.create({ lang: 'la' });
    const de = marks.emphasis!.create({ lang: 'de' });
    const doc = nodes.doc!.create(null, [
      nodes.body!.create(null, [
        nodes.section!.create(null, [nodes.p!.create(null, fb2Schema.text('ab', [la, de]))]),
      ]),
    ]);
    const start = 3; // doc > body > section > p
    let state = EditorState.create({ doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + 2)));
    // What ProseMirror's input handling does: insert with the marks at the caret.
    state = state.apply(state.tr.insertText('c'));
    const text = state.doc.nodeAt(start)!;
    expect(text.text).toBe('abc');
    expect(text.marks).toEqual([la, de]);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + 1)));
    state = state.apply(state.tr.insertText('-'));
    expect(state.doc.nodeAt(start)!.text).toBe('a-bc');
    expect(state.doc.nodeAt(start)!.marks).toEqual([la, de]);
  });

  it('fromModel then toModel keep [style a, style b], [style b, style a] and [emphasis la, emphasis de] in their order', () => {
    const style = (name: string) => ({ type: 'style' as const, attrs: { name } });
    const emphasis = (lang: string) => ({ type: 'emphasis' as const, attrs: { lang } });
    const paragraph: ModelNodeJson = {
      type: 'p',
      attrs: { nodeId: 'p1' },
      content: [
        { type: 'text', text: 'ab', marks: [style('a'), style('b')] },
        { type: 'text', text: 'ba', marks: [style('b'), style('a')] },
        { type: 'text', text: 'lade', marks: [emphasis('la'), emphasis('de')] },
        {
          type: 'text',
          text: 'mixed',
          marks: [{ type: 'strong' }, emphasis('la'), emphasis('de'), style('a'), style('b')],
        },
      ],
    };
    const { node, back, problems } = viaEditor(paragraph);
    expect(problems).toEqual([]);
    expect(node.childCount).toBe(4);
    expect(back).toEqual(paragraph);
  });
});
