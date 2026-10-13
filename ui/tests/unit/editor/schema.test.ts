import { Fragment } from 'prosemirror-model';

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
    expect(text.marks[2]!.attrs).toEqual({ href: '#n_1', type: 'note' });
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
