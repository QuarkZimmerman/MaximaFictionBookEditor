/**
 * Feature 012 (US1; D10-D12; contracts/epub-export.md §4): FB2 blocks and inline text as XHTML.
 * Every FB2 element keeps its kind as a class; named styles become classes; the forms are those
 * EPUB 2 reading systems also show - paragraphs, divisions, headings, block quotations, tables
 * and pictures (D5) - with EPUB 3's meanings as attributes (`epub:type`) that older devices skip.
 *
 * Internal links are written as placeholders and resolved once every page has its name
 * (build.ts): `\uE000<fb2 id>\uE001` for a link to an element of the book, `\uE002<xml id>\uE003`
 * for a link to an anchor the export made (the notes' back-links).
 */

import type {
  CellNode,
  ImageNode,
  InlineNode,
  Mark,
  ParagraphNode,
  PoemNode,
  RowNode,
  StanzaNode,
  TableNode,
  TitleNode,
} from '@/model/document';

import { attr, text } from './xhtml';

/** A node of the book's model of any kind; the renderer switches on its `type`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export const fb2Link = (fb2Id: string): string => `\uE000${fb2Id}\uE001`;
export const anchorLink = (xmlId: string): string => `\uE002${xmlId}\uE003`;

export type SummaryKind =
  | 'pictureLeftOut'
  | 'linkAsText'
  | 'cssDropped'
  | 'stylesheetDropped'
  | 'gapFilled'
  | 'idMadeUnique';

export interface SummaryItem {
  kind: SummaryKind;
  detail: string;
}

export interface PlacedPicture {
  /** The path inside the EPUB, e.g. `EPUB/images/cover.jpg`. */
  name: string;
  mediaType: string;
}

/** What the renderer needs from the whole book (build.ts fills it in a first pass). */
export interface RenderContext {
  /** The XML id of an element by its model node id, when it has one (or needs one). */
  elementId(nodeId: string): string | undefined;
  /** Whether the book holds an element with this FB2 id. */
  hasTarget(fb2Id: string): boolean;
  /** Whether a link to this FB2 id is a note reference into a body of notes. */
  isNoteTarget(fb2Id: string): boolean;
  /** Records a note reference to `fb2Id` and returns the reference's own XML id. */
  noteReference(fb2Id: string): string;
  /** The picture an FB2 reference `#id` stands for, when it is in the EPUB. */
  picture(href: string): PlacedPicture | undefined;
  /** The CSS class of a named style. */
  styleClass(name: string): string;
  summary(kind: SummaryKind, detail: string): void;
  counts: { pictures: number; tables: number; notes: number; withoutAlt: number };
}

const EXTERNAL = /^(https?|mailto|ftp):/i;

function langAttrs(lang: string | undefined): string {
  return lang ? ` xml:lang="${attr(lang)}" lang="${attr(lang)}"` : '';
}

function idAttr(ctx: RenderContext, nodeId: string | undefined): string {
  const id = nodeId ? ctx.elementId(nodeId) : undefined;
  return id ? ` id="${attr(id)}"` : '';
}

function classAttr(...names: Array<string | undefined | false>): string {
  const list = names.filter((name): name is string => !!name);
  return list.length > 0 ? ` class="${attr(list.join(' '))}"` : '';
}

/** The relative path of a picture from a page in `EPUB/text/` (or from `EPUB/` itself). */
export function pictureSrc(picture: PlacedPicture, fromText: boolean): string {
  const inside = picture.name.replace(/^EPUB\//, '');
  return fromText ? `../${inside}` : inside;
}

const MARK_ORDER = ['style', 'strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code'] as const;
const MARK_TAG: Record<string, string> = {
  strong: 'strong',
  emphasis: 'em',
  strikethrough: 's',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function wrapMarks(inner: string, marks: readonly Mark[], ctx: RenderContext): string {
  let out = inner;
  const sorted = [...marks]
    .filter((mark) => mark.type !== 'link')
    .sort(
      (a, b) =>
        MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]) -
        MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]),
    );
  for (const mark of sorted) {
    const lang = langAttrs(mark.attrs?.lang);
    if (mark.type === 'style') {
      out = `<span class="${attr(ctx.styleClass(mark.attrs.name))}"${lang}>${out}</span>`;
    } else {
      const tag = MARK_TAG[mark.type];
      if (tag) out = `<${tag}${lang}>${out}</${tag}>`;
    }
  }
  return out;
}

function linkOf(marks: readonly Mark[] | undefined): Extract<Mark, { type: 'link' }> | undefined {
  return marks?.find((mark): mark is Extract<Mark, { type: 'link' }> => mark.type === 'link');
}

function rawText(xml: string): string {
  return xml
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, entity: string) =>
      entity === 'lt'
        ? '<'
        : entity === 'gt'
          ? '>'
          : entity === 'amp'
            ? '&'
            : entity === 'quot'
              ? '"'
              : "'",
    );
}

function inlineImage(
  node: Extract<InlineNode, { type: 'inline-image' }>,
  ctx: RenderContext,
  fromText: boolean,
): string {
  const picture = ctx.picture(node.attrs.href);
  const alt = node.attrs.alt ?? '';
  if (!picture) {
    ctx.summary('pictureLeftOut', node.attrs.href);
    return alt ? text(`[${alt}]`) : '';
  }
  ctx.counts.pictures++;
  if (!alt) ctx.counts.withoutAlt++;
  return `<img class="fb2-inline-image" src="${attr(pictureSrc(picture, fromText))}" alt="${attr(alt)}"/>`;
}

function renderNode(node: InlineNode, ctx: RenderContext, fromText: boolean): string {
  if (node.type === 'text') return wrapMarks(text(node.text), node.marks ?? [], ctx);
  if (node.type === 'inline-image')
    return wrapMarks(inlineImage(node, ctx, fromText), node.marks ?? [], ctx);
  return wrapMarks(text(rawText(node.attrs.xml)), node.marks ?? [], ctx);
}

/** Inline content; runs that share one link become one `<a>`. */
export function renderInline(
  nodes: readonly InlineNode[],
  ctx: RenderContext,
  fromText = true,
): string {
  let out = '';
  let index = 0;
  while (index < nodes.length) {
    const link = linkOf((nodes[index] as { marks?: Mark[] }).marks);
    if (!link) {
      out += renderNode(nodes[index]!, ctx, fromText);
      index++;
      continue;
    }
    let end = index + 1;
    while (end < nodes.length) {
      const next = linkOf((nodes[end] as { marks?: Mark[] }).marks);
      if (!next || next.attrs.href !== link.attrs.href || next.attrs.type !== link.attrs.type)
        break;
      end++;
    }
    const inner = nodes
      .slice(index, end)
      .map((node) => renderNode(node, ctx, fromText))
      .join('');
    out += renderLink(link, inner, ctx);
    index = end;
  }
  return out;
}

function renderLink(
  link: Extract<Mark, { type: 'link' }>,
  inner: string,
  ctx: RenderContext,
): string {
  const href = link.attrs.href ?? '';
  if (href.startsWith('#') && href.length > 1) {
    const target = href.slice(1);
    if (!ctx.hasTarget(target)) {
      ctx.summary('linkAsText', href);
      return inner;
    }
    if (link.attrs.type === 'note' || ctx.isNoteTarget(target)) {
      const ref = ctx.noteReference(target);
      return `<a epub:type="noteref" id="${attr(ref)}" href="${fb2Link(target)}">${inner}</a>`;
    }
    return `<a href="${fb2Link(target)}">${inner}</a>`;
  }
  // D22 (and its reverse): links outside the book stay exactly as written.
  if (EXTERNAL.test(href)) return `<a href="${attr(href)}">${inner}</a>`;
  ctx.summary('linkAsText', href);
  return inner;
}

/* ------------------------------------------------------------------------------------------ */

function paragraphLike(
  node: {
    type: string;
    attrs: { nodeId: string; style?: string; lang?: string };
    content: InlineNode[];
  },
  kind: string | undefined,
  ctx: RenderContext,
): string {
  const style = node.attrs.style ? ctx.styleClass(node.attrs.style) : undefined;
  const inner = renderInline(node.content, ctx);
  return `<p${idAttr(ctx, node.attrs.nodeId)}${classAttr(kind, style)}${langAttrs(node.attrs.lang)}>${inner}</p>`;
}

/** A title's lines as one heading (sections) or as a division of paragraphs (poems, stanzas). */
export function renderTitle(
  title: TitleNode,
  ctx: RenderContext,
  level: number | null,
  kind = 'fb2-title',
): string {
  const lines = title.content
    .filter((line): line is ParagraphNode => line.type === 'p')
    .map((line) => {
      const inner = renderInline(line.content, ctx);
      const id = idAttr(ctx, line.attrs.nodeId);
      return id ? `<span${id}>${inner}</span>` : inner;
    });
  if (level === null) {
    return `<div${idAttr(ctx, title.attrs.nodeId)}${classAttr(kind)}${langAttrs(title.attrs.lang)}>${lines
      .map((line) => `<p>${line}</p>`)
      .join('')}</div>`;
  }
  const tag = `h${Math.min(Math.max(level, 1), 6)}`;
  return `<${tag}${idAttr(ctx, title.attrs.nodeId)}${classAttr(kind)}${langAttrs(title.attrs.lang)}>${lines.join('<br/>')}</${tag}>`;
}

/** The plain text of a title's lines, joined by spaces (the contents' entries). */
export function titleText(title: TitleNode | undefined): string {
  if (!title) return '';
  return title.content
    .filter((line): line is ParagraphNode => line.type === 'p')
    .map((line) => inlineText(line.content))
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' ? node.text : node.type === 'raw-xml' ? rawText(node.attrs.xml) : '',
    )
    .join('');
}

export function renderImage(node: ImageNode, ctx: RenderContext, fromText = true): string {
  const picture = ctx.picture(node.attrs.href);
  if (!picture) {
    ctx.summary('pictureLeftOut', node.attrs.href);
    return '';
  }
  ctx.counts.pictures++;
  const alt = node.attrs.alt ?? '';
  if (!alt) ctx.counts.withoutAlt++;
  const caption = node.attrs.title ? `<figcaption>${text(node.attrs.title)}</figcaption>` : '';
  return (
    `<figure${idAttr(ctx, node.attrs.nodeId)} class="fb2-image">` +
    `<img src="${attr(pictureSrc(picture, fromText))}" alt="${attr(alt)}"/>${caption}</figure>`
  );
}

function cell(node: CellNode, row: RowNode, ctx: RenderContext): string {
  const tag = node.type;
  const align = node.attrs.align ?? row.attrs.align;
  const span =
    (node.attrs.colspan && node.attrs.colspan > 1 ? ` colspan="${node.attrs.colspan}"` : '') +
    (node.attrs.rowspan && node.attrs.rowspan > 1 ? ` rowspan="${node.attrs.rowspan}"` : '');
  const style = node.attrs.style ? ctx.styleClass(node.attrs.style) : undefined;
  return (
    `<${tag}${idAttr(ctx, node.attrs.nodeId)}${span}` +
    `${classAttr(align && `fb2-align-${align}`, node.attrs.valign && `fb2-valign-${node.attrs.valign}`, style)}` +
    `${langAttrs(node.attrs.lang)}>${renderInline(node.content, ctx)}</${tag}>`
  );
}

export function renderTable(node: TableNode, ctx: RenderContext): string {
  ctx.counts.tables++;
  const style = node.attrs.style ? ctx.styleClass(node.attrs.style) : undefined;
  const rows = node.content
    .map(
      (row) =>
        `<tr${idAttr(ctx, row.attrs.nodeId)}>${row.content.map((c) => cell(c, row, ctx)).join('')}</tr>`,
    )
    .join('');
  return `<table${idAttr(ctx, node.attrs.nodeId)}${classAttr('fb2-table', style)}><tbody>${rows}</tbody></table>`;
}

function stanza(node: StanzaNode, ctx: RenderContext): string {
  const parts = node.content.map((child) => {
    if (child.type === 'title') return renderTitle(child, ctx, null, 'fb2-stanza-title');
    if (child.type === 'subtitle') return paragraphLike(child, 'fb2-subtitle', ctx);
    return paragraphLike(child, 'fb2-v', ctx);
  });
  return `<div${idAttr(ctx, node.attrs.nodeId)} class="fb2-stanza"${langAttrs(node.attrs.lang)}>${parts.join('')}</div>`;
}

function poem(node: PoemNode, ctx: RenderContext): string {
  const parts = node.content.map((child) => {
    switch (child.type) {
      case 'title':
        return renderTitle(child, ctx, null, 'fb2-title fb2-poem-title');
      case 'epigraph':
        return renderBlock(child, ctx, 0);
      case 'stanza':
        return stanza(child, ctx);
      case 'subtitle':
        return paragraphLike(child, 'fb2-subtitle', ctx);
      case 'text-author':
        return paragraphLike(child, 'fb2-text-author', ctx);
      case 'date':
        return `<p${idAttr(ctx, child.attrs.nodeId)} class="fb2-date"${langAttrs(child.attrs.lang)}>${renderInline(child.content, ctx)}</p>`;
      default:
        return '';
    }
  });
  return `<div${idAttr(ctx, node.attrs.nodeId)} class="fb2-poem"${langAttrs(node.attrs.lang)}>${parts.join('')}</div>`;
}

/** Any block of a section, an epigraph, a cite or an annotation. `level` is the heading level of the section around it. */
export function renderBlock(node: AnyNode, ctx: RenderContext, level: number): string {
  switch (node.type) {
    case 'p':
      return paragraphLike(node, undefined, ctx);
    case 'subtitle':
      return paragraphLike(node, 'fb2-subtitle', ctx);
    case 'text-author':
      return paragraphLike(node, 'fb2-text-author', ctx);
    case 'empty-line':
      return '<p class="fb2-empty-line">\u00a0</p>';
    case 'poem':
      return poem(node, ctx);
    case 'cite':
      return `<blockquote${idAttr(ctx, node.attrs.nodeId)} class="fb2-cite"${langAttrs(node.attrs.lang)}>${node.content
        .map((child: unknown) => renderBlock(child, ctx, level))
        .join('')}</blockquote>`;
    case 'epigraph':
      return `<blockquote${idAttr(ctx, node.attrs.nodeId)} class="fb2-epigraph" epub:type="epigraph">${node.content
        .map((child: unknown) => renderBlock(child, ctx, level))
        .join('')}</blockquote>`;
    case 'annotation':
      return `<div${idAttr(ctx, node.attrs.nodeId)} class="fb2-annotation"${langAttrs(node.attrs.lang)}>${node.content
        .map((child: unknown) => renderBlock(child, ctx, level))
        .join('')}</div>`;
    case 'table':
      return renderTable(node, ctx);
    case 'image':
      return renderImage(node, ctx);
    case 'title':
      return renderTitle(node, ctx, level);
    case 'section':
      return renderSection(node, ctx, level + 1);
    case 'raw-xml':
      return `<p class="fb2-unknown">${text(rawText(node.attrs.xml))}</p>`;
    default:
      return '';
  }
}

/** A section with its title as a heading of `level`, and everything inside it. */
export function renderSection(
  node: AnyNode,
  ctx: RenderContext,
  level: number,
  extraClass?: string,
): string {
  const inner = node.content.map((child: unknown) => renderBlock(child, ctx, level)).join('');
  return `<div${idAttr(ctx, node.attrs.nodeId)}${classAttr('fb2-section', extraClass)}${langAttrs(node.attrs.lang)}>${inner}</div>`;
}
