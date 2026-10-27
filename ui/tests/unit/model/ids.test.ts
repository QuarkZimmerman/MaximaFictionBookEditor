/**
 * Book ids and link counts in the model layer (feature 006, T039; I12; C8; data-model §0, §10.2;
 * research R2.8): `collectBookIds` over the bodies, both annotations, the history and the
 * binaries, memoised per tree object; `countLinksTo` over link runs of text and inline atoms.
 */

import type {
  AnnotationNode,
  BinaryMeta,
  BodyNode,
  Document,
  InlineNode,
  Mark,
} from '@/model/document';
import { collectBookIds, countLinksTo } from '@/model/ids';

import { fakeDocument } from '../features/testUtils';

const link = (href: string): Mark => ({ type: 'link', attrs: { href } });
const strong: Mark = { type: 'strong' };

const text = (value: string, marks?: Mark[]): InlineNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const picture = (nodeId: string, marks?: Mark[]): InlineNode => ({
  type: 'inline-image',
  attrs: { nodeId, href: '#pic' },
  ...(marks ? { marks } : {}),
});
const rawInline = (nodeId: string, marks?: Mark[]): InlineNode => ({
  type: 'raw-xml',
  attrs: { nodeId, xml: '<x/>', inline: true },
  ...(marks ? { marks } : {}),
});

function paragraph(nodeId: string, content: InlineNode[], id?: string) {
  return { type: 'p' as const, attrs: { nodeId, ...(id ? { id } : {}) }, content };
}

function annotation(nodeId: string, content: ReturnType<typeof paragraph>[], id?: string) {
  return {
    type: 'annotation',
    attrs: { nodeId, ...(id ? { id } : {}) },
    content,
  } as AnnotationNode;
}

function body(nodeId: string, sections: unknown[], id?: string): BodyNode {
  return {
    type: 'body',
    attrs: { nodeId, ...(id ? { id } : {}) },
    content: sections,
  } as BodyNode;
}

function binary(id: string): BinaryMeta {
  return {
    id,
    contentType: 'image/png',
    size: 1,
    decodable: true,
    willConvert: false,
    referenceCount: 0,
  };
}

/** A book with ids everywhere the space reaches, and raw XML whose id is never collected. */
function book(): Document {
  const base = fakeDocument();
  const deep = {
    type: 'section',
    attrs: { nodeId: 's1', id: 'sec1' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 's2', id: 'sec2' },
        content: [
          paragraph('p1', [text('one')], 'para1'),
          {
            type: 'table',
            attrs: { nodeId: 't1', id: 'tab1' },
            content: [
              {
                type: 'tr',
                attrs: { nodeId: 'r1' },
                content: [{ type: 'td', attrs: { nodeId: 'c1', id: 'cell1' }, content: [] }],
              },
            ],
          },
          { type: 'raw-xml', attrs: { nodeId: 'x1', xml: '<x id="rawid"/>', inline: false } },
        ],
      },
    ],
  };
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        annotation: annotation('a1', [paragraph('ap', [text('a')], 'annpara')], 'ann'),
      },
      srcTitleInfo: {
        ...base.description.titleInfo,
        annotation: annotation('a2', [paragraph('sp', [text('s')], 'srcpara')]),
      },
      documentInfo: {
        ...base.description.documentInfo,
        history: annotation('h1', [paragraph('hp', [text('h')], 'histpara')], 'hist'),
      },
    },
    bodies: [
      body('b1', [deep], 'main'),
      body('b2', [
        {
          type: 'section',
          attrs: { nodeId: 's3', id: 'notes1' },
          content: [paragraph('p9', [text('n')])],
        },
      ]),
    ],
    binaries: [binary('cover.png')],
  };
}

describe('collectBookIds', () => {
  it('collects the ids of the bodies, both annotations, the history and the binaries, none from raw XML', () => {
    const ids = collectBookIds(book());
    expect([...ids].sort()).toEqual(
      [
        'main',
        'sec1',
        'sec2',
        'para1',
        'tab1',
        'cell1',
        'notes1',
        'ann',
        'annpara',
        'srcpara',
        'hist',
        'histpara',
        'cover.png',
      ].sort(),
    );
    expect(ids.has('rawid')).toBe(false);
  });

  it('memoises per body: a replaced body gives its new ids, the other bodies are reused', () => {
    const doc = book();
    const first = collectBookIds(doc);
    expect(collectBookIds(doc)).toBe(first);
    const changedBody = body('b2', [
      { type: 'section', attrs: { nodeId: 's3', id: 'notes2' }, content: [paragraph('p9', [])] },
    ]);
    const next: Document = { ...doc, bodies: [doc.bodies[0]!, changedBody] };
    const ids = collectBookIds(next);
    expect(ids).not.toBe(first);
    expect(ids.has('notes2')).toBe(true);
    expect(ids.has('notes1')).toBe(false);
    expect(ids.has('sec2')).toBe(true);
    // The unchanged body's ids are read from its cached set, not walked again.
    const content = doc.bodies[0]!.content as unknown[];
    const walked = new Proxy(content, {
      get(target, key, receiver) {
        if (key === 'length' || key === Symbol.iterator || /^\d+$/.test(String(key))) {
          throw new Error('the unchanged body was walked again');
        }
        return Reflect.get(target, key, receiver);
      },
    });
    (doc.bodies[0] as unknown as { content: unknown }).content = walked;
    expect(() => collectBookIds({ ...next, binaries: [] })).not.toThrow();
  });
});

describe('countLinksTo', () => {
  function withParagraphs(...paragraphs: ReturnType<typeof paragraph>[]): Document {
    const base = fakeDocument();
    return {
      ...base,
      bodies: [body('b1', [{ type: 'section', attrs: { nodeId: 's1' }, content: paragraphs }])],
    };
  }

  it('counts link runs of text and inline atoms', () => {
    // A text link.
    expect(
      countLinksTo(withParagraphs(paragraph('p1', [text('see', [link('#c1')])])), ['c1']),
    ).toBe(1);
    // One link over text and a picture: one run.
    expect(
      countLinksTo(
        withParagraphs(
          paragraph('p1', [text('see ', [link('#c1')]), picture('i1', [link('#c1')]), text('.')]),
        ),
        ['c1'],
      ),
    ).toBe(1);
    // Two separate links to one id: two.
    expect(
      countLinksTo(
        withParagraphs(
          paragraph('p1', [text('a', [link('#c1')]), text(' and '), text('b', [link('#c1')])]),
        ),
        ['c1'],
      ),
    ).toBe(2);
    // A run continues across other marks; white space without the link ends it.
    expect(
      countLinksTo(
        withParagraphs(
          paragraph('p1', [
            text('a', [link('#c1')]),
            text('b', [strong, link('#c1')]),
            text(' '),
            text('c', [link('#c1')]),
          ]),
        ),
        ['c1'],
      ),
    ).toBe(2);
    // A linked inline image alone, and a linked inline raw-xml node alone.
    expect(
      countLinksTo(withParagraphs(paragraph('p1', [picture('i1', [link('#c1')])])), ['c1']),
    ).toBe(1);
    expect(
      countLinksTo(withParagraphs(paragraph('p1', [rawInline('x1', [link('#c1')])])), ['c1']),
    ).toBe(1);
  });

  it('counts links in the annotations and the history, in table cells too', () => {
    const base = fakeDocument();
    const doc: Document = {
      ...base,
      description: {
        ...base.description,
        titleInfo: {
          ...base.description.titleInfo,
          annotation: annotation('a1', [paragraph('ap', [text('x', [link('#t')])])]),
        },
        srcTitleInfo: {
          ...base.description.titleInfo,
          annotation: annotation('a2', [paragraph('sp', [text('y', [link('#t')])])]),
        },
        documentInfo: {
          ...base.description.documentInfo,
          history: annotation('h1', [paragraph('hp', [text('z', [link('#u')])])]),
        },
      },
      bodies: [
        body('b1', [
          {
            type: 'section',
            attrs: { nodeId: 's1' },
            content: [
              {
                type: 'table',
                attrs: { nodeId: 't1' },
                content: [
                  {
                    type: 'tr',
                    attrs: { nodeId: 'r1' },
                    content: [
                      { type: 'td', attrs: { nodeId: 'c1' }, content: [text('q', [link('#t')])] },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ],
    };
    expect(countLinksTo(doc, ['t'])).toBe(3);
    expect(countLinksTo(doc, ['u'])).toBe(1);
    expect(countLinksTo(doc, ['t', 'u'])).toBe(4);
  });

  it('counts nothing for an href without # or to another id, or for no ids', () => {
    const doc = withParagraphs(
      paragraph('p1', [
        text('a', [link('c1')]),
        text(' '),
        text('b', [link('#c2')]),
        text(' '),
        text('c', [link('https://example.org/#c1')]),
      ]),
    );
    expect(countLinksTo(doc, ['c1'])).toBe(0);
    expect(countLinksTo(doc, [])).toBe(0);
  });
});
