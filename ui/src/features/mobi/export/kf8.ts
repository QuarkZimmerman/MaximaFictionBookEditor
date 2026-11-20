/**
 * Feature 018 (T021, contracts/mobi-export.md §1, §4): FB2 -> KF8 XHTML5 + translated CSS builder.
 * Uses neutral `ebookShared/exportCss`, `kindle:embed:NNNN?mime=...`, `data-kf8-target="..."`
 * (resolved by core into `kindle:pos:fid:0000:off:YYYYYYYYYY`), and optional KF8 pop-up footnotes.
 */
import { BASE_CSS, publicationCss, type CssSummaryItem } from '@/features/ebookShared/exportCss';
import type {
  BodyNode,
  CellNode,
  ImageNode,
  InlineNode,
  Mark,
  PoemNode,
  RowNode,
  SectionNode,
  StanzaNode,
  TableNode,
  TitleNode,
} from '@/model/document';

import {
  escapeAttr,
  escapeXml,
  flattenSequences,
  formatKf8EmbedId,
  personDisplayName,
  titlePlainText,
  type BookExportPlan,
  type MobiExportBuildOptions,
  type MobiGuideItem,
  type MobiNavItem,
} from './metadata';
import { buildNavTree, renderInlineTocKf8 } from './toc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export interface Kf8BuildResult {
  html: string;
  css: string;
  nav: MobiNavItem[];
  guide: MobiGuideItem[];
  counts: { sections: number; pictures: number; tables: number; notes: number };
}

const KF8_EXTRA_CSS = `
.fb2-toc ol { list-style-type: none; padding-left: 0; }
.fb2-toc li { margin: 0.2em 0; text-indent: 0; }
.fb2-toc-d1 { padding-left: 1.5em; }
.fb2-toc-d2 { padding-left: 3em; }
.fb2-toc-d3 { padding-left: 4.5em; }
.fb2-toc-d4 { padding-left: 6em; }
.fb2-toc-d5 { padding-left: 7.5em; }
.fb2-pagebreak { page-break-before: always; break-before: page; }
`;

const EXTERNAL_RE = /^(https?|mailto|ftp):/i;
const MARK_ORDER = ['style', 'strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code'] as const;
const KF8_MARK_TAG: Record<string, string> = {
  strong: 'strong',
  emphasis: 'em',
  strikethrough: 's',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

function rawText(xml: string): string {
  return xml
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, e: string) =>
      e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : "'",
    );
}

function linkOf(marks: readonly Mark[] | undefined): Extract<Mark, { type: 'link' }> | undefined {
  return marks?.find((m): m is Extract<Mark, { type: 'link' }> => m.type === 'link');
}

function classAttr(...names: Array<string | undefined | false>): string {
  const list = names.filter((n): n is string => Boolean(n));
  return list.length > 0 ? ` class="${escapeAttr(list.join(' '))}"` : '';
}

function langAttrs(lang: string | undefined): string {
  return lang ? ` xml:lang="${escapeAttr(lang)}" lang="${escapeAttr(lang)}"` : '';
}

export function buildKf8(options: MobiExportBuildOptions, plan: BookExportPlan): Kf8BuildResult {
  const { document } = options;
  const { nav, bodyAnchorIds } = buildNavTree(document.bodies, plan);
  const backRefs = new Map<string, string>();
  let refSeq = 0;
  const counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };

  const ensureId = (nodeId: string | undefined, prefix = 'k'): string | undefined => {
    if (!nodeId) return undefined;
    const existing = plan.elementIds.get(nodeId);
    if (existing) return existing;
    const allocated = plan.ids.allocate(prefix);
    plan.elementIds.set(nodeId, allocated);
    return allocated;
  };

  const idAttrOf = (nodeId: string | undefined): string => {
    const id = nodeId ? plan.elementIds.get(nodeId) : undefined;
    return id ? ` id="${escapeAttr(id)}"` : '';
  };

  const wrapMarks = (inner: string, marks: readonly Mark[]): string => {
    let out = inner;
    const sorted = [...marks]
      .filter((m) => m.type !== 'link')
      .sort(
        (a, b) =>
          MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]) -
          MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]),
      );
    for (const mark of sorted) {
      const lang = langAttrs(mark.attrs?.lang);
      if (mark.type === 'style') {
        out = `<span class="${escapeAttr(plan.styleClass(mark.attrs.name))}"${lang}>${out}</span>`;
      } else {
        const tag = KF8_MARK_TAG[mark.type];
        if (tag) out = `<${tag}${lang}>${out}</${tag}>`;
      }
    }
    return out;
  };

  const renderInlineNode = (node: InlineNode): string => {
    if (node.type === 'text') return wrapMarks(escapeXml(node.text), node.marks ?? []);
    if (node.type === 'inline-image') {
      const href = node.attrs.href ?? '';
      const pic = href.startsWith('#') ? options.pictures.get(href.slice(1)) : undefined;
      const alt = node.attrs.alt ?? '';
      if (!pic) {
        plan.summary.push({ kind: 'pictureLeftOut', detail: href });
        return wrapMarks(alt ? escapeXml(`[${alt}]`) : '', node.marks ?? []);
      }
      counts.pictures++;
      const src = `kindle:embed:${formatKf8EmbedId(pic.recindex)}?mime=${pic.mediaType}`;
      return wrapMarks(
        `<img src="${escapeAttr(src)}" class="fb2-inline-image" alt="${escapeAttr(alt)}"/>`,
        node.marks ?? [],
      );
    }
    return wrapMarks(escapeXml(rawText(node.attrs.xml)), node.marks ?? []);
  };

  const renderLink = (link: Extract<Mark, { type: 'link' }>, inner: string): string => {
    const href = link.attrs.href ?? '';
    if (href.startsWith('#') && href.length > 1) {
      const target = href.slice(1);
      const xmlTarget = plan.targets.get(target);
      if (!xmlTarget) {
        plan.summary.push({ kind: 'linkAsText', detail: href });
        return inner;
      }
      const targetBody = plan.bodyOfId.get(target);
      const isNote =
        link.attrs.type === 'note' ||
        (targetBody !== undefined && plan.notesBodies.has(targetBody));
      if (isNote) {
        const refId = plan.ids.allocate(`ref${++refSeq}`);
        if (!backRefs.has(target)) backRefs.set(target, refId);
        const epubAttr = options.kf8PopupFootnotes ? ' epub:type="noteref"' : '';
        return `<sup><a id="${escapeAttr(refId)}"${epubAttr} href="#${escapeAttr(xmlTarget)}" data-kf8-target="${escapeAttr(xmlTarget)}">${inner}</a></sup>`;
      }
      return `<a href="#${escapeAttr(xmlTarget)}" data-kf8-target="${escapeAttr(xmlTarget)}">${inner}</a>`;
    }
    if (EXTERNAL_RE.test(href)) {
      return `<a href="${escapeAttr(href)}">${inner}</a>`;
    }
    plan.summary.push({ kind: 'linkAsText', detail: href });
    return inner;
  };

  const renderInline = (nodes: readonly InlineNode[]): string => {
    let out = '';
    let i = 0;
    while (i < nodes.length) {
      const link = linkOf((nodes[i] as { marks?: Mark[] }).marks);
      if (!link) {
        out += renderInlineNode(nodes[i]!);
        i++;
        continue;
      }
      let end = i + 1;
      while (end < nodes.length) {
        const next = linkOf((nodes[end] as { marks?: Mark[] }).marks);
        if (!next || next.attrs.href !== link.attrs.href || next.attrs.type !== link.attrs.type)
          break;
        end++;
      }
      const inner = nodes.slice(i, end).map(renderInlineNode).join('');
      out += renderLink(link, inner);
      i = end;
    }
    return out;
  };

  const renderTitle = (title: TitleNode, level: number | null, kind = 'fb2-title'): string => {
    const lines = title.content.map((line) => {
      if (line.type !== 'p') return '\u0000empty';
      const inner = renderInline(line.content);
      const id = idAttrOf(line.attrs.nodeId);
      return id ? `<span${id}>${inner}</span>` : inner;
    });
    if (level === null) {
      return `<div${idAttrOf(title.attrs.nodeId)}${classAttr(kind)}${langAttrs(title.attrs.lang)}>${lines
        .map((l) => (l === '\u0000empty' ? '<p class="fb2-empty-line">&#160;</p>' : `<p>${l}</p>`))
        .join('')}</div>`;
    }
    const tag = `h${Math.min(Math.max(level, 1), 6)}`;
    const shown = lines.map((l) =>
      l === '\u0000empty' ? '<span class="fb2-empty-line"></span>' : l,
    );
    return `<${tag}${idAttrOf(title.attrs.nodeId)}${classAttr(kind)}${langAttrs(title.attrs.lang)}>${shown.join('<br/>')}</${tag}>`;
  };

  const renderImage = (node: ImageNode): string => {
    const href = node.attrs.href ?? '';
    const pic = href.startsWith('#') ? options.pictures.get(href.slice(1)) : undefined;
    if (!pic) {
      plan.summary.push({ kind: 'pictureLeftOut', detail: href });
      return '';
    }
    counts.pictures++;
    const alt = node.attrs.alt ?? '';
    const src = `kindle:embed:${formatKf8EmbedId(pic.recindex)}?mime=${pic.mediaType}`;
    const caption = node.attrs.title
      ? `<figcaption>${escapeXml(node.attrs.title)}</figcaption>`
      : '';
    return `<figure${idAttrOf(node.attrs.nodeId)} class="fb2-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"/>${caption}</figure>`;
  };

  const renderCell = (node: CellNode, row: RowNode): string => {
    const tag = node.type;
    const align = node.attrs.align ?? row.attrs.align;
    const span =
      (node.attrs.colspan && node.attrs.colspan > 1 ? ` colspan="${node.attrs.colspan}"` : '') +
      (node.attrs.rowspan && node.attrs.rowspan > 1 ? ` rowspan="${node.attrs.rowspan}"` : '');
    const style = node.attrs.style ? plan.styleClass(node.attrs.style) : undefined;
    return (
      `<${tag}${idAttrOf(node.attrs.nodeId)}${span}` +
      `${classAttr(align && `fb2-align-${align}`, node.attrs.valign && `fb2-valign-${node.attrs.valign}`, style)}` +
      `${langAttrs(node.attrs.lang)}>${renderInline(node.content)}</${tag}>`
    );
  };

  const renderTable = (node: TableNode): string => {
    counts.tables++;
    const style = node.attrs.style ? plan.styleClass(node.attrs.style) : undefined;
    const rows = node.content
      .map(
        (row) =>
          `<tr${idAttrOf(row.attrs.nodeId)}>${row.content.map((c) => renderCell(c, row)).join('')}</tr>`,
      )
      .join('');
    return `<table${idAttrOf(node.attrs.nodeId)}${classAttr('fb2-table', style)}><tbody>${rows}</tbody></table>`;
  };

  const renderStanza = (node: StanzaNode): string => {
    const parts = node.content.map((child) => {
      if (child.type === 'title') return renderTitle(child, null, 'fb2-stanza-title');
      if (child.type === 'subtitle') {
        return `<p${idAttrOf(child.attrs.nodeId)}${classAttr('fb2-subtitle', child.attrs.style && plan.styleClass(child.attrs.style))}${langAttrs(child.attrs.lang)}>${renderInline(child.content)}</p>`;
      }
      return `<p${idAttrOf(child.attrs.nodeId)}${classAttr('fb2-v', child.attrs.style && plan.styleClass(child.attrs.style))}${langAttrs(child.attrs.lang)}>${renderInline(child.content)}</p>`;
    });
    return `<div${idAttrOf(node.attrs.nodeId)} class="fb2-stanza"${langAttrs(node.attrs.lang)}>${parts.join('')}</div>`;
  };

  const renderPoem = (node: PoemNode): string => {
    const parts = node.content.map((child) => {
      switch (child.type) {
        case 'title':
          return renderTitle(child, null, 'fb2-title fb2-poem-title');
        case 'epigraph':
          return renderBlock(child, 0);
        case 'stanza':
          return renderStanza(child);
        case 'subtitle':
          return `<p${idAttrOf(child.attrs.nodeId)}${classAttr('fb2-subtitle', child.attrs.style && plan.styleClass(child.attrs.style))}${langAttrs(child.attrs.lang)}>${renderInline(child.content)}</p>`;
        case 'text-author':
          return `<p${idAttrOf(child.attrs.nodeId)}${classAttr('fb2-text-author', child.attrs.style && plan.styleClass(child.attrs.style))}${langAttrs(child.attrs.lang)}>${renderInline(child.content)}</p>`;
        case 'date': {
          const valAttr = child.attrs.value
            ? ` data-fb2-value="${escapeAttr(child.attrs.value)}"`
            : '';
          return `<p${idAttrOf(child.attrs.nodeId)} class="fb2-date"${valAttr}${langAttrs(child.attrs.lang)}>${renderInline(child.content)}</p>`;
        }
        default:
          return '';
      }
    });
    return `<div${idAttrOf(node.attrs.nodeId)} class="fb2-poem"${langAttrs(node.attrs.lang)}>${parts.join('')}</div>`;
  };

  const renderBlock = (node: AnyNode, level: number): string => {
    switch (node.type) {
      case 'p':
        return `<p${idAttrOf(node.attrs.nodeId)}${classAttr(node.attrs.style && plan.styleClass(node.attrs.style))}${langAttrs(node.attrs.lang)}>${renderInline(node.content)}</p>`;
      case 'subtitle':
        return `<p${idAttrOf(node.attrs.nodeId)}${classAttr('fb2-subtitle', node.attrs.style && plan.styleClass(node.attrs.style))}${langAttrs(node.attrs.lang)}>${renderInline(node.content)}</p>`;
      case 'text-author':
        return `<p${idAttrOf(node.attrs.nodeId)}${classAttr('fb2-text-author', node.attrs.style && plan.styleClass(node.attrs.style))}${langAttrs(node.attrs.lang)}>${renderInline(node.content)}</p>`;
      case 'empty-line':
        return '<p class="fb2-empty-line">&#160;</p>';
      case 'poem':
        return renderPoem(node);
      case 'cite':
        return `<blockquote${idAttrOf(node.attrs.nodeId)} class="fb2-cite"${langAttrs(node.attrs.lang)}>${node.content.map((c: AnyNode) => renderBlock(c, level)).join('')}</blockquote>`;
      case 'epigraph':
        return `<div${idAttrOf(node.attrs.nodeId)} class="fb2-epigraph" epub:type="epigraph">${node.content.map((c: AnyNode) => renderBlock(c, level)).join('')}</div>`;
      case 'annotation':
        return `<div${idAttrOf(node.attrs.nodeId)} class="fb2-annotation"${langAttrs(node.attrs.lang)}>${node.content.map((c: AnyNode) => renderBlock(c, level)).join('')}</div>`;
      case 'table':
        return renderTable(node);
      case 'image':
        return renderImage(node);
      case 'title':
        return renderTitle(node, level);
      case 'section':
        return renderSection(node, level + 1, false);
      case 'raw-xml':
        return `<p class="fb2-unknown">${escapeXml(rawText(node.attrs.xml))}</p>`;
      default:
        return '';
    }
  };

  const renderSection = (node: SectionNode, level: number, topLevel: boolean): string => {
    counts.sections++;
    const secId = ensureId(node.attrs.nodeId, 's')!;
    const hasTitle = node.content.some((c) => c.type === 'title' && titlePlainText(c).length > 0);
    if (!hasTitle && !plan.attrs.untitledSections.includes(secId)) {
      plan.attrs.untitledSections.push(secId);
    }
    const inner = node.content.map((c) => renderBlock(c, level)).join('');
    const tag = topLevel ? 'section' : 'div';
    const cls = topLevel ? 'fb2-section fb2-pagebreak' : 'fb2-section';
    return `<${tag} id="${escapeAttr(secId)}" class="${cls}"${langAttrs(node.attrs.lang)}>${inner}</${tag}>`;
  };

  const renderBodyContent = (body: BodyNode, bodyIndex: number, isMain: boolean): string => {
    const anchor = bodyAnchorIds.get(bodyIndex);
    const parts: string[] = [];
    let firstTop = true;
    for (const child of body.content) {
      if (child.type === 'section') {
        parts.push(renderSection(child, isMain ? 1 : 2, !firstTop));
        firstTop = false;
      } else if (child.type === 'title') {
        parts.push(renderTitle(child, 1, 'fb2-title fb2-body-title'));
      } else {
        parts.push(renderBlock(child, 1));
      }
    }
    const idAttr = anchor ? ` id="${escapeAttr(anchor)}"` : '';
    return `<div${idAttr} class="fb2-body fb2-pagebreak" data-fb2-body="${bodyIndex}"${langAttrs(body.attrs.lang)}>${parts.join('')}</div>`;
  };

  const renderNoteSection = (section: SectionNode): string => {
    counts.notes++;
    const secId = ensureId(section.attrs.nodeId, 'note')!;
    const ownFb2Id = section.attrs.id;
    const backTarget = ownFb2Id ? backRefs.get(ownFb2Id) : undefined;
    const inner = section.content
      .map((c) => (c.type === 'title' ? renderTitle(c, null, 'fb2-note-title') : renderBlock(c, 3)))
      .join('');
    const back = backTarget
      ? `<p class="fb2-backlink"><a href="#${escapeAttr(backTarget)}" data-kf8-target="${escapeAttr(backTarget)}">\u21a9</a></p>`
      : '';
    if (options.kf8PopupFootnotes) {
      return `<aside id="${escapeAttr(secId)}" class="fb2-note" epub:type="footnote"${langAttrs(section.attrs.lang)}>${inner}${back}</aside>`;
    }
    return `<div id="${escapeAttr(secId)}" class="fb2-note"${langAttrs(section.attrs.lang)}>${inner}${back}</div>`;
  };

  // Assemble document in contract order (§1).
  const chunks: string[] = [];
  const guide: MobiGuideItem[] = [];
  const titleInfo = document.description.titleInfo;

  // 1. Cover fragment (KF8)
  const coverHref = titleInfo.coverpage[0]?.href ?? '';
  if (coverHref) {
    const coverPic = coverHref.startsWith('#')
      ? options.pictures.get(coverHref.slice(1))
      : undefined;
    if (coverPic) {
      counts.pictures++;
      const src = `kindle:embed:${formatKf8EmbedId(coverPic.recindex)}?mime=${coverPic.mediaType}`;
      chunks.push(
        `<div id="fb2-cover" class="fb2-cover"><img src="${escapeAttr(src)}" alt="${escapeAttr(plan.words.cover)}"/></div>`,
      );
      guide.push({ type: 'cover', title: plan.words.cover, anchorId: 'fb2-cover' });
    } else {
      plan.summary.push({ kind: 'pictureLeftOut', detail: coverHref });
    }
  }

  // 2. Title page
  if (plan.hasTitlePage) {
    let tp = '<div id="fb2-title-page" class="fb2-title-page fb2-pagebreak" epub:type="titlepage">';
    if (!plan.originalTitleEmpty) {
      tp += `<h1 class="fb2-book-title">${escapeXml(plan.title)}</h1>`;
    }
    for (const seq of flattenSequences(titleInfo.sequences)) {
      if (!seq.name.trim()) continue;
      const num = seq.number ? ` #${seq.number}` : '';
      tp += `<p class="fb2-series">${escapeXml(seq.name.trim() + num)}</p>`;
    }
    for (const author of titleInfo.authors) {
      const name = personDisplayName(author);
      if (name) tp += `<p class="fb2-author">${escapeXml(name)}</p>`;
    }
    if (titleInfo.annotation) {
      tp += renderBlock(titleInfo.annotation, 2);
    }
    tp += '</div>';
    chunks.push(tp);
    guide.push({ type: 'title-page', title: plan.words.titlePage, anchorId: 'fb2-title-page' });
  }

  // 3. Inline TOC afterTitle
  const tocHtml =
    options.tocPlacement === 'none' ? '' : renderInlineTocKf8(nav, plan.words.contents);
  if (options.tocPlacement === 'afterTitle' && tocHtml) {
    chunks.push(`<div class="fb2-pagebreak">${tocHtml}</div>`);
    guide.push({ type: 'toc', title: plan.words.contents, anchorId: 'fb2-toc' });
  }

  // 4. Main body & further bodies
  if (plan.mainBodyIndex >= 0) {
    chunks.push(renderBodyContent(document.bodies[plan.mainBodyIndex]!, plan.mainBodyIndex, true));
  } else {
    chunks.push('<div id="fb2-main-start" class="fb2-body"></div>');
  }
  for (const idx of plan.furtherBodyIndices) {
    chunks.push(renderBodyContent(document.bodies[idx]!, idx, false));
  }

  // 5. Notes bodies
  if (plan.notesBodyIndices.length > 0) {
    const firstNotes = document.bodies[plan.notesBodyIndices[0]!]!;
    const firstTitle = firstNotes.content.find((c): c is TitleNode => c.type === 'title');
    const heading = firstTitle
      ? renderTitle(firstTitle, 1, 'fb2-title fb2-notes-title')
      : `<h1 class="fb2-title fb2-notes-title">${escapeXml(plan.words.notes)}</h1>`;
    const notesParts: string[] = [heading];
    for (const idx of plan.notesBodyIndices) {
      const nb = document.bodies[idx]!;
      const bodyNodes = nb.content
        .filter((c) => !(idx === plan.notesBodyIndices[0] && c === firstTitle))
        .map((c) => (c.type === 'section' ? renderNoteSection(c) : renderBlock(c, 2)))
        .join('');
      notesParts.push(
        `<div class="fb2-body fb2-notes-body" data-fb2-body="${idx}">${bodyNodes}</div>`,
      );
    }
    chunks.push(`<div id="fb2-notes" class="fb2-notes fb2-pagebreak">${notesParts.join('')}</div>`);
  }

  // 6. Inline TOC at end
  if (options.tocPlacement === 'end' && tocHtml) {
    chunks.push(`<div class="fb2-pagebreak">${tocHtml}</div>`);
    guide.push({ type: 'toc', title: plan.words.contents, anchorId: 'fb2-toc' });
  }

  guide.push({ type: 'text', title: plan.words.start, anchorId: plan.openAtAnchorId });

  // Translate FB2 stylesheets via neutral `ebookShared/exportCss`.
  const cssSummary: CssSummaryItem[] = [];
  const css = publicationCss(document.stylesheets, cssSummary, BASE_CSS + KF8_EXTRA_CSS);
  for (const item of cssSummary) {
    plan.summary.push(item);
  }

  const html =
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"` +
    ` xml:lang="${escapeAttr(plan.xhtmlLang)}" lang="${escapeAttr(plan.xhtmlLang)}">` +
    `<head><title>${escapeXml(plan.title)}</title>` +
    '<link rel="stylesheet" type="text/css" href="kindle:flow:0001?mime=text/css"/></head>' +
    `<body aid="0">${chunks.join('')}</body></html>`;

  return { html, css, nav, guide, counts };
}
