/**
 * ProseMirror schema of the FB2 body (T047). Mirrors `contracts/document-model.d.ts` and the
 * content models of `resources/schema/FictionBook.xsd` (data-model.md §1.3-1.4).
 *
 * Naming: ProseMirror content expressions cannot contain `-`, so the FB2 names with hyphens are
 * mapped to underscore node names (`empty-line` -> `empty_line`, `text-author` -> `text_author`,
 * `inline-image` -> `inline_image`, `raw-xml` -> `raw_xml` (block) / `raw_xml_inline`). Use
 * `nodeTypeFor(fb2Name, inline?)` and `fb2NameFor(nodeType)` instead of hard-coding names.
 *
 * Every structural node carries `nodeId` (session-stable, core-issued; `null` until
 * `assignNodeIds()` fills it for nodes created in the UI) and `extraAttrs`, a PM-only catch-all
 * that preserves attributes the schema does not know so the round trip stays lossless.
 *
 * `toDOM` produces semantic HTML with `fb-*` classes styled by `styles.css` (the look of the
 * original editor's `main.css`). Images get real node views in the Body view (T064 replaces
 * them); `raw_xml` renders as an "unknown element" box until T064 adds its node view.
 */

import {
  Fragment,
  Node as PMNode,
  Schema,
  type Attrs,
  type DOMOutputSpec,
  type MarkSpec,
  type NodeSpec,
  type NodeType,
  type ParseRule,
  type TagParseRule,
} from 'prosemirror-model';

/* ------------------------------------------------------------------------ */
/* Name mapping                                                             */
/* ------------------------------------------------------------------------ */

/** FB2 element/model type name -> schema node name. */
const FB2_TO_NODE: Readonly<Record<string, string>> = {
  body: 'body',
  section: 'section',
  title: 'title',
  epigraph: 'epigraph',
  annotation: 'annotation',
  p: 'p',
  subtitle: 'subtitle',
  'text-author': 'text_author',
  v: 'v',
  'empty-line': 'empty_line',
  poem: 'poem',
  stanza: 'stanza',
  date: 'date',
  cite: 'cite',
  table: 'table',
  tr: 'tr',
  td: 'td',
  th: 'th',
  image: 'image',
  'inline-image': 'inline_image',
  'raw-xml': 'raw_xml',
  text: 'text',
};

const NODE_TO_FB2: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FB2_TO_NODE).map(([fb2, node]) => [node, fb2]),
);

/** Model type names that are leaves (no `content` key in the JSON; see core `is_leaf_type`). */
export const LEAF_MODEL_TYPES: ReadonlySet<string> = new Set([
  'empty-line',
  'image',
  'inline-image',
  'raw-xml',
]);

/** Canonical mark order (= the `Mark` union order of document-model.d.ts; schema rank order). */
export const MARK_ORDER: readonly string[] = [
  'strong',
  'emphasis',
  'strikethrough',
  'sub',
  'sup',
  'code',
  'style',
  'link',
];

/* ------------------------------------------------------------------------ */
/* Attribute helpers                                                        */
/* ------------------------------------------------------------------------ */

type AttrSpecMap = NonNullable<NodeSpec['attrs']>;

/** `nodeId` + the PM-only `extraAttrs` catch-all, present on every structural node. */
const BASE_ATTRS: AttrSpecMap = {
  nodeId: { default: null },
  extraAttrs: { default: null },
};

function optional(...names: string[]): AttrSpecMap {
  const attrs: AttrSpecMap = { ...BASE_ATTRS };
  for (const name of names) attrs[name] = { default: null };
  return attrs;
}

/** Attributes the FB2 element shares with the model (`id`, `lang`, `style`...). */
const STRUCT_ATTRS = optional('id', 'lang');
const PARAGRAPH_ATTRS = optional('id', 'lang', 'style');

function domAttrs(node: PMNode, className: string, extra: Record<string, string | null> = {}) {
  const out: Record<string, string> = { class: className };
  if (node.attrs.nodeId) out['data-node-id'] = String(node.attrs.nodeId);
  if (node.attrs.id) out['data-id'] = String(node.attrs.id);
  if (node.attrs.lang) out.lang = String(node.attrs.lang);
  if (node.attrs.style) out['data-style'] = String(node.attrs.style);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** Element name of a raw XML fragment (`<foo:bar a="1">` -> `foo:bar`), for the unknown box. */
export function rawXmlElementName(xml: string): string {
  const match = /^\s*<\s*([^\s/>]+)/.exec(xml);
  return match ? match[1]! : '?';
}

/* ------------------------------------------------------------------------ */
/* Node specs                                                               */
/* ------------------------------------------------------------------------ */

const INLINE = 'inline*';
/** Blocks allowed in a section after the first one (`image` included). */
const SECTION_BLOCKS = 'p | image | poem | subtitle | cite | empty_line | table | raw_xml';
/** Blocks allowed as the first block of a section (no image). */
const SECTION_FIRST_BLOCKS = 'p | poem | subtitle | cite | empty_line | table | raw_xml';

function container(
  className: string,
  tag: string,
  content: string,
  attrs: AttrSpecMap,
  extraSpec: Partial<NodeSpec> = {},
): NodeSpec {
  return {
    content,
    attrs,
    defining: true,
    toDOM(node) {
      return [tag, domAttrs(node, className), 0];
    },
    parseDOM: [{ tag: `${tag}.${className}`, getAttrs: parseStructAttrs }],
    ...extraSpec,
  };
}

function parseStructAttrs(dom: HTMLElement | string): Attrs | false | null {
  if (typeof dom === 'string') return null;
  return {
    id: dom.getAttribute('data-id'),
    lang: dom.getAttribute('lang'),
    style: dom.getAttribute('data-style'),
  };
}

function paragraph(className: string, extraParseRules: TagParseRule[] = []): NodeSpec {
  return {
    content: INLINE,
    group: 'paragraphLike',
    attrs: PARAGRAPH_ATTRS,
    defining: true,
    toDOM(node) {
      return ['p', domAttrs(node, className), 0];
    },
    parseDOM: [{ tag: `p.${className}`, getAttrs: parseStructAttrs }, ...extraParseRules],
  };
}

const nodes: Record<string, NodeSpec> = {
  /** Zero bodies allowed so `.fbd` descriptors (and the empty editor) load. */
  doc: {
    content: 'body*',
  },

  body: container(
    'fb-body',
    'div',
    'image? title? epigraph* section+',
    optional('id', 'lang', 'name'),
    {
      toDOM(node) {
        return [
          'div',
          domAttrs(node, 'fb-body', { 'data-name': node.attrs.name as string | null }),
          0,
        ];
      },
      parseDOM: [
        {
          tag: 'div.fb-body',
          getAttrs: (dom) => ({ ...parseStructAttrs(dom), name: dom.getAttribute('data-name') }),
        },
      ],
    },
  ),

  section: container(
    'fb-section',
    'div',
    `title? epigraph* image? annotation? (section+ | ((${SECTION_FIRST_BLOCKS}) (${SECTION_BLOCKS})*))`,
    STRUCT_ATTRS,
  ),

  title: container('fb-title', 'div', '(p | empty_line)*', optional('lang')),

  epigraph: container(
    'fb-epigraph',
    'div',
    '(p | poem | cite | empty_line)* text_author*',
    optional('id'),
  ),

  annotation: container(
    'fb-annotation',
    'div',
    '(p | poem | cite | subtitle | table | empty_line)*',
    STRUCT_ATTRS,
  ),

  p: paragraph('fb-p', [{ tag: 'p', getAttrs: parseStructAttrs }]),
  subtitle: paragraph('fb-subtitle'),
  text_author: paragraph('fb-text-author'),
  v: paragraph('fb-v'),

  empty_line: {
    group: 'emptyLine',
    attrs: { ...BASE_ATTRS },
    selectable: false,
    toDOM(node) {
      return ['p', domAttrs(node, 'fb-empty-line')];
    },
    parseDOM: [{ tag: 'p.fb-empty-line' }],
  },

  poem: container(
    'fb-poem',
    'div',
    'title? epigraph* (stanza | subtitle)+ text_author* date?',
    STRUCT_ATTRS,
  ),

  stanza: container('fb-stanza', 'div', 'title? subtitle? v+', optional('lang')),

  date: {
    content: 'text*',
    marks: '',
    attrs: optional('value', 'lang'),
    defining: true,
    toDOM(node) {
      return [
        'p',
        domAttrs(node, 'fb-date', { 'data-value': node.attrs.value as string | null }),
        0,
      ];
    },
    parseDOM: [
      {
        tag: 'p.fb-date',
        getAttrs: (dom) => ({
          value: dom.getAttribute('data-value'),
          lang: dom.getAttribute('lang'),
        }),
      },
    ],
  },

  cite: container(
    'fb-cite',
    'div',
    '(p | subtitle | empty_line | poem | table)* text_author*',
    STRUCT_ATTRS,
  ),

  table: {
    content: 'tr+',
    attrs: optional('id', 'style'),
    isolating: true,
    defining: true,
    toDOM(node) {
      return ['table', domAttrs(node, 'fb-table'), ['tbody', 0]];
    },
    parseDOM: [{ tag: 'table', getAttrs: parseStructAttrs }],
  },

  tr: {
    content: '(th | td)+',
    attrs: optional('align'),
    toDOM(node) {
      return ['tr', domAttrs(node, 'fb-tr', { align: node.attrs.align as string | null }), 0];
    },
    parseDOM: [{ tag: 'tr', getAttrs: (dom) => ({ align: dom.getAttribute('align') }) }],
  },

  td: cellSpec('td'),
  th: cellSpec('th'),

  image: {
    group: 'imageBlock',
    attrs: {
      ...BASE_ATTRS,
      href: { default: '' },
      alt: { default: null },
      title: { default: null },
      id: { default: null },
    },
    atom: true,
    draggable: false,
    toDOM(node) {
      return imageDom(node, 'figure', 'fb-image');
    },
    parseDOM: [
      {
        tag: 'figure.fb-image',
        getAttrs: (dom) => ({
          href: dom.getAttribute('data-href') ?? '',
          alt: dom.getAttribute('data-alt'),
          title: dom.getAttribute('title'),
          id: dom.getAttribute('data-id'),
        }),
      },
    ],
  },

  inline_image: {
    inline: true,
    group: 'inline',
    attrs: { ...BASE_ATTRS, href: { default: '' }, alt: { default: null } },
    atom: true,
    draggable: false,
    toDOM(node) {
      return imageDom(node, 'span', 'fb-inline-image');
    },
    parseDOM: [
      {
        tag: 'span.fb-inline-image',
        getAttrs: (dom) => ({
          href: dom.getAttribute('data-href') ?? '',
          alt: dom.getAttribute('data-alt'),
        }),
      },
    ],
  },

  /** Unknown block element preserved verbatim; shown as an "unknown element" box. */
  raw_xml: {
    group: 'rawXml',
    attrs: { ...BASE_ATTRS, xml: { default: '' }, original: { default: null } },
    atom: true,
    draggable: false,
    toDOM(node) {
      return rawXmlDom(node, 'div', 'fb-unknown');
    },
    parseDOM: [{ tag: 'div.fb-unknown', getAttrs: parseRawXmlAttrs }],
  },

  /** Unknown inline element (the `inline: true` variant of the model's `raw-xml`). */
  raw_xml_inline: {
    inline: true,
    group: 'inline',
    attrs: { ...BASE_ATTRS, xml: { default: '' }, original: { default: null } },
    atom: true,
    draggable: false,
    toDOM(node) {
      return rawXmlDom(node, 'span', 'fb-unknown-inline');
    },
    parseDOM: [{ tag: 'span.fb-unknown-inline', getAttrs: parseRawXmlAttrs }],
  },

  text: {
    inline: true,
    group: 'inline',
  },
};

function cellSpec(tag: 'td' | 'th'): NodeSpec {
  return {
    content: INLINE,
    attrs: optional('id', 'style', 'colspan', 'rowspan', 'align', 'valign'),
    isolating: true,
    toDOM(node) {
      const attrs = domAttrs(node, `fb-${tag}`, {
        align: node.attrs.align as string | null,
        valign: node.attrs.valign as string | null,
      });
      if (node.attrs.colspan) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan) attrs.rowspan = String(node.attrs.rowspan);
      return [tag, attrs, 0];
    },
    parseDOM: [
      {
        tag,
        getAttrs: (dom) => ({
          ...parseStructAttrs(dom),
          colspan: dom.hasAttribute('colspan') ? Number(dom.getAttribute('colspan')) : null,
          rowspan: dom.hasAttribute('rowspan') ? Number(dom.getAttribute('rowspan')) : null,
          align: dom.getAttribute('align'),
          valign: dom.getAttribute('valign'),
        }),
      },
    ],
  };
}

function imageDom(node: PMNode, tag: string, className: string): DOMOutputSpec {
  const href = String(node.attrs.href ?? '');
  const alt = (node.attrs.alt as string | null) ?? '';
  const title = node.attrs.title as string | null | undefined;
  const attrs = domAttrs(node, className, {
    'data-href': href,
    'data-alt': node.attrs.alt as string | null,
    title: title ?? null,
  });
  // No `src`: the Body view's node views resolve `href` against the core's /binary endpoint.
  const img: DOMOutputSpec = ['img', { alt, 'data-href': href, draggable: 'false' }];
  if (tag === 'figure' && title) {
    return [tag, attrs, img, ['figcaption', { class: 'fb-image-caption' }, title]];
  }
  return [tag, attrs, img];
}

function rawXmlDom(node: PMNode, tag: string, className: string): DOMOutputSpec {
  const xml = String(node.attrs.xml ?? '');
  return [
    tag,
    domAttrs(node, className, { 'data-xml': xml, title: xml }),
    ['span', { class: 'fb-unknown-name' }, rawXmlElementName(xml)],
  ];
}

function parseRawXmlAttrs(dom: HTMLElement | string): Attrs | null {
  if (typeof dom === 'string') return null;
  return { xml: dom.getAttribute('data-xml') ?? '' };
}

/* ------------------------------------------------------------------------ */
/* Marks (canonical order = rank order)                                     */
/* ------------------------------------------------------------------------ */

function simpleMark(tag: string, className: string, parse: ParseRule[]): MarkSpec {
  return {
    toDOM() {
      return [tag, { class: className }, 0];
    },
    parseDOM: parse,
  };
}

const marks: Record<string, MarkSpec> = {
  strong: simpleMark('strong', 'fb-strong', [
    { tag: 'strong' },
    { tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
    {
      style: 'font-weight',
      getAttrs: (value) => (/^(bold(er)?|[5-9]\d{2,})$/.test(value) ? null : false),
    },
  ]),
  emphasis: simpleMark('em', 'fb-emphasis', [
    { tag: 'em' },
    { tag: 'i' },
    { style: 'font-style=italic' },
  ]),
  strikethrough: simpleMark('s', 'fb-strikethrough', [
    { tag: 's' },
    { tag: 'strike' },
    { tag: 'del' },
    { style: 'text-decoration=line-through' },
  ]),
  sub: simpleMark('sub', 'fb-sub', [{ tag: 'sub' }, { style: 'vertical-align=sub' }]),
  sup: simpleMark('sup', 'fb-sup', [{ tag: 'sup' }, { style: 'vertical-align=super' }]),
  code: simpleMark('code', 'fb-code', [{ tag: 'code' }, { tag: 'tt' }]),
  style: {
    attrs: { name: { default: '' } },
    toDOM(mark) {
      return ['span', { class: 'fb-style', 'data-style': String(mark.attrs.name) }, 0];
    },
    parseDOM: [
      {
        tag: 'span.fb-style',
        getAttrs: (dom) => ({ name: dom.getAttribute('data-style') ?? '' }),
      },
    ],
  },
  link: {
    attrs: { href: { default: '' }, type: { default: null } },
    inclusive: false,
    toDOM(mark) {
      const type = mark.attrs.type as string | null;
      const attrs: Record<string, string> = {
        class: type === 'note' ? 'fb-link fb-note' : 'fb-link',
        href: String(mark.attrs.href),
      };
      if (type) attrs['data-type'] = type;
      return ['a', attrs, 0];
    },
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => ({
          href: dom.getAttribute('href') ?? '',
          type:
            dom.getAttribute('data-type') ?? (dom.classList.contains('fb-note') ? 'note' : null),
        }),
      },
    ],
  },
};

export const fb2Schema = new Schema({ nodes, marks });

export type Fb2Schema = typeof fb2Schema;

/* ------------------------------------------------------------------------ */
/* Lookup helpers                                                           */
/* ------------------------------------------------------------------------ */

/** Node type for an FB2/model type name (`'empty-line'`, `'raw-xml'`...); undefined if unknown. */
export function nodeTypeFor(fb2Name: string, inline = false): NodeType | undefined {
  if (fb2Name === 'raw-xml')
    return inline ? fb2Schema.nodes.raw_xml_inline : fb2Schema.nodes.raw_xml;
  const name = FB2_TO_NODE[fb2Name];
  return name ? fb2Schema.nodes[name] : undefined;
}

/** FB2/model type name of a schema node type (`'empty_line'` -> `'empty-line'`). */
export function fb2NameFor(type: NodeType | string): string {
  const name = typeof type === 'string' ? type : type.name;
  if (name === 'raw_xml_inline') return 'raw-xml';
  return NODE_TO_FB2[name] ?? name;
}

/** True for block-level node types (everything that is not inline, except `doc`). */
export function isBlock(type: NodeType | string): boolean {
  const nodeType = typeof type === 'string' ? fb2Schema.nodes[type] : type;
  return !!nodeType && nodeType.isBlock && nodeType.name !== 'doc';
}

/**
 * Node ids of the Body view's annotation and history blocks (feature 004, data-model §0.1):
 * fixed UI identifiers - never `n<N>` or `ui_<N>`, never sent to the core - shared by the editor
 * document, the tree index and every caret or navigation call, including the resolver's
 * "document start" of a body-less document (`structuralPath.ts`).
 */
export const FIXED_BLOCK_IDS = {
  annotation: 'desc:annotation',
  history: 'desc:history',
} as const;

/** True for the node types the Document Tree shows (containers and images). */
export function isStructural(type: NodeType | string): boolean {
  const name = typeof type === 'string' ? type : type.name;
  return [
    'body',
    'section',
    'title',
    'epigraph',
    'annotation',
    'poem',
    'stanza',
    'cite',
    'table',
    'image',
  ].includes(name);
}

/* ------------------------------------------------------------------------ */
/* Node ids                                                                 */
/* ------------------------------------------------------------------------ */

/** Generates `ui_1`, `ui_2`... (the core re-assigns ids when it re-parses). */
export function createNodeIdGenerator(prefix = 'ui_'): () => string {
  let next = 1;
  return () => `${prefix}${next++}`;
}

const defaultNodeIds = createNodeIdGenerator();

/**
 * Returns `node` with a `nodeId` on every structural descendant that lacks one. The input is
 * not mutated; the same node is returned when nothing was missing.
 */
export function assignNodeIds(node: PMNode, nextId: () => string = defaultNodeIds): PMNode {
  if (node.isText) return node;
  // Pre-order: the parent gets its id before its children (ids then read top-down).
  const needsId = node.type.name !== 'doc' && node.type.spec.attrs?.nodeId && !node.attrs.nodeId;
  const attrs = needsId ? { ...node.attrs, nodeId: nextId() } : node.attrs;
  let changed = false;
  const children: PMNode[] = [];
  node.forEach((child) => {
    const updated = assignNodeIds(child, nextId);
    if (updated !== child) changed = true;
    children.push(updated);
  });
  if (!changed && !needsId) return node;
  return node.type.create(attrs, Fragment.from(children), node.marks);
}

/** Depth-first search for the node with `nodeId`; returns its position or null. */
export function findNodeById(doc: PMNode, nodeId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.nodeId === nodeId) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}
