/**
 * Feature 018 (T021, contracts/mobi-export.md §1, §4): FB2 -> MOBI 7 HTML 3.2 renderer.
 * Emits `<mbp:pagebreak/>`, `filepos="0000000000" data-target="..."` placeholders patched by core,
 * `<img recindex="NNNNN"/>`, tables, links, classic jump-to-end notes + back-links, and `fb2-*`
 * semantic markers for lossless round-trip.
 */
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
  formatMobi7RecIndex,
  personDisplayName,
  titlePlainText,
  type BookExportPlan,
  type MobiExportBuildOptions,
  type MobiGuideItem,
  type MobiNavItem,
} from './metadata';
import { buildNavTree, renderInlineTocMobi7 } from './toc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export interface Mobi7BuildResult {
  html: string;
  nav: MobiNavItem[];
  guide: MobiGuideItem[];
  counts: { sections: number; pictures: number; tables: number; notes: number };
}

const EXTERNAL_RE = /^(https?|mailto|ftp):/i;
const MARK_ORDER = ['style', 'strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code'] as const;
const MOBI7_MARK_TAG: Record<string, string> = {
  strong: 'b',
  emphasis: 'i',
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

export function buildMobi7(
  options: MobiExportBuildOptions,
  plan: BookExportPlan,
): Mobi7BuildResult {
  const { document } = options;
  const { nav, bodyAnchorIds } = buildNavTree(document.bodies, plan);
  const backRefs = new Map<string, string>();
  let refSeq = 0;
  const counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };

  const ensureId = (nodeId: string | undefined, prefix = 'n'): string | undefined => {
    if (!nodeId) return undefined;
    const existing = plan.elementIds.get(nodeId);
    if (existing) return existing;
    const allocated = plan.ids.allocate(prefix);
    plan.elementIds.set(nodeId, allocated);
    return allocated;
  };

  const idAttrOf = (nodeId: string | undefined, forcePrefix?: string): string => {
    const id = forcePrefix
      ? ensureId(nodeId, forcePrefix)
      : nodeId
        ? plan.elementIds.get(nodeId)
        : undefined;
    return id ? ` id="${escapeAttr(id)}"` : '';
  };

  const recordLang = (nodeId: string | undefined, lang: string | undefined): void => {
    if (!lang || !nodeId) return;
    const id = ensureId(nodeId, 'lg');
    if (id) plan.attrs.nodeLangs[id] = lang;
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
      if (mark.type === 'style') {
        out = `<span class="${escapeAttr(plan.styleClass(mark.attrs.name))}">${out}</span>`;
      } else {
        const tag = MOBI7_MARK_TAG[mark.type];
        if (tag) out = `<${tag}>${out}</${tag}>`;
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
      return wrapMarks(
        `<img recindex="${formatMobi7RecIndex(pic.recindex)}" class="fb2-inline-image" alt="${escapeAttr(alt)}"/>`,
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
        return `<sup><a id="${escapeAttr(refId)}" filepos="0000000000" data-target="${escapeAttr(xmlTarget)}">${inner}</a></sup>`;
      }
      return `<a filepos="0000000000" data-target="${escapeAttr(xmlTarget)}">${inner}</a>`;
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
    recordLang(title.attrs.nodeId, title.attrs.lang);
    const lines = title.content.map((line) => {
      if (line.type !== 'p') return '\u0000empty';
      const inner = renderInline(line.content);
      const id = idAttrOf(line.attrs.nodeId);
      return id ? `<span${id}>${inner}</span>` : inner;
    });
    if (level === null) {
      return `<div${idAttrOf(title.attrs.nodeId)}${classAttr(kind)}>${lines
        .map((l) =>
          l === '\u0000empty'
            ? '<div height="1em" class="fb2-empty-line">&nbsp;</div>'
            : `<p width="0"><b>${l}</b></p>`,
        )
        .join('')}</div>`;
    }
    const tag = `h${Math.min(Math.max(level, 1), 6)}`;
    const shown = lines.map((l) =>
      l === '\u0000empty' ? '<span class="fb2-empty-line"></span>' : l,
    );
    return `<${tag}${idAttrOf(title.attrs.nodeId)}${classAttr(kind)}>${shown.join('<br/>')}</${tag}>`;
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
    const id = node.attrs.title
      ? ensureId(node.attrs.nodeId, 'img')
      : plan.elementIds.get(node.attrs.nodeId);
    if (id && node.attrs.title) {
      plan.attrs.imageTitles[id] = node.attrs.title;
    }
    const idPart = id ? ` id="${escapeAttr(id)}"` : '';
    const caption = node.attrs.title
      ? `<p align="center" width="0" class="fb2-caption"><i>${escapeXml(node.attrs.title)}</i></p>`
      : '';
    return `<p${idPart} align="center" width="0" class="fb2-image"><img recindex="${formatMobi7RecIndex(pic.recindex)}" alt="${escapeAttr(alt)}"/></p>${caption}`;
  };

  const renderCell = (node: CellNode, row: RowNode): string => {
    recordLang(node.attrs.nodeId, node.attrs.lang);
    const tag = node.type;
    const align = node.attrs.align ?? row.attrs.align;
    const attrs =
      idAttrOf(node.attrs.nodeId) +
      (node.attrs.colspan && node.attrs.colspan > 1 ? ` colspan="${node.attrs.colspan}"` : '') +
      (node.attrs.rowspan && node.attrs.rowspan > 1 ? ` rowspan="${node.attrs.rowspan}"` : '') +
      (align ? ` align="${escapeAttr(align)}"` : '') +
      (node.attrs.valign ? ` valign="${escapeAttr(node.attrs.valign)}"` : '') +
      classAttr(node.attrs.style && plan.styleClass(node.attrs.style));
    return `<${tag}${attrs}>${renderInline(node.content)}</${tag}>`;
  };

  const renderTable = (node: TableNode): string => {
    counts.tables++;
    const rows = node.content
      .map(
        (row) =>
          `<tr${idAttrOf(row.attrs.nodeId)}>${row.content.map((c) => renderCell(c, row)).join('')}</tr>`,
      )
      .join('');
    return `<table${idAttrOf(node.attrs.nodeId)} border="1"${classAttr('fb2-table', node.attrs.style && plan.styleClass(node.attrs.style))}>${rows}</table>`;
  };

  const renderStanza = (node: StanzaNode): string => {
    recordLang(node.attrs.nodeId, node.attrs.lang);
    const parts = node.content.map((child) => {
      if (child.type === 'title') return renderTitle(child, null, 'fb2-stanza-title');
      if (child.type === 'subtitle') {
        return `<p${idAttrOf(child.attrs.nodeId)} align="center" width="0" height="1em" class="fb2-subtitle"><b>${renderInline(child.content)}</b></p>`;
      }
      recordLang(child.attrs.nodeId, child.attrs.lang);
      return `<p${idAttrOf(child.attrs.nodeId)} width="0"${classAttr('fb2-v', child.attrs.style && plan.styleClass(child.attrs.style))}>${renderInline(child.content)}</p>`;
    });
    return `<div${idAttrOf(node.attrs.nodeId)} class="fb2-stanza">${parts.join('')}</div>`;
  };

  const renderPoem = (node: PoemNode): string => {
    recordLang(node.attrs.nodeId, node.attrs.lang);
    const parts = node.content.map((child) => {
      switch (child.type) {
        case 'title':
          return renderTitle(child, null, 'fb2-title fb2-poem-title');
        case 'epigraph':
          return renderBlock(child, 0);
        case 'stanza':
          return renderStanza(child);
        case 'subtitle':
          return `<p${idAttrOf(child.attrs.nodeId)} align="center" width="0" height="1em" class="fb2-subtitle"><b>${renderInline(child.content)}</b></p>`;
        case 'text-author':
          return `<p${idAttrOf(child.attrs.nodeId)} align="right" width="0" class="fb2-text-author"><i>${renderInline(child.content)}</i></p>`;
        case 'date': {
          const id = child.attrs.value
            ? ensureId(child.attrs.nodeId, 'dt')
            : plan.elementIds.get(child.attrs.nodeId);
          if (id && child.attrs.value) plan.attrs.dates[id] = child.attrs.value;
          recordLang(child.attrs.nodeId, child.attrs.lang);
          return `<p${id ? ` id="${escapeAttr(id)}"` : ''} align="right" width="0" class="fb2-date">${renderInline(child.content)}</p>`;
        }
        default:
          return '';
      }
    });
    return `<blockquote${idAttrOf(node.attrs.nodeId)} class="fb2-poem">${parts.join('')}</blockquote>`;
  };

  const renderBlock = (node: AnyNode, level: number): string => {
    switch (node.type) {
      case 'p': {
        recordLang(node.attrs.nodeId, node.attrs.lang);
        return `<p${idAttrOf(node.attrs.nodeId)} width="1.5em"${classAttr(node.attrs.style && plan.styleClass(node.attrs.style))}>${renderInline(node.content)}</p>`;
      }
      case 'subtitle':
        recordLang(node.attrs.nodeId, node.attrs.lang);
        return `<p${idAttrOf(node.attrs.nodeId)} align="center" width="0" height="1em"${classAttr('fb2-subtitle', node.attrs.style && plan.styleClass(node.attrs.style))}><b>${renderInline(node.content)}</b></p>`;
      case 'text-author':
        recordLang(node.attrs.nodeId, node.attrs.lang);
        return `<p${idAttrOf(node.attrs.nodeId)} align="right" width="0"${classAttr('fb2-text-author', node.attrs.style && plan.styleClass(node.attrs.style))}><i>${renderInline(node.content)}</i></p>`;
      case 'empty-line':
        return '<div height="1em" class="fb2-empty-line">&nbsp;</div>';
      case 'poem':
        return renderPoem(node);
      case 'cite':
        recordLang(node.attrs.nodeId, node.attrs.lang);
        return `<blockquote${idAttrOf(node.attrs.nodeId)} class="fb2-cite">${node.content.map((c: AnyNode) => renderBlock(c, level)).join('')}</blockquote>`;
      case 'epigraph':
        return `<blockquote${idAttrOf(node.attrs.nodeId)} class="fb2-epigraph"><i>${node.content.map((c: AnyNode) => renderBlock(c, level)).join('')}</i></blockquote>`;
      case 'annotation':
        recordLang(node.attrs.nodeId, node.attrs.lang);
        return `<div${idAttrOf(node.attrs.nodeId)} class="fb2-annotation"><i>${node.content.map((c: AnyNode) => renderBlock(c, level)).join('')}</i></div>`;
      case 'table':
        return renderTable(node);
      case 'image':
        return renderImage(node);
      case 'title':
        return renderTitle(node, level);
      case 'section':
        return renderSection(node, level + 1, false);
      case 'raw-xml':
        return `<p width="1.5em" class="fb2-unknown">${escapeXml(rawText(node.attrs.xml))}</p>`;
      default:
        return '';
    }
  };

  const renderSection = (node: SectionNode, level: number, pageBreakBefore: boolean): string => {
    counts.sections++;
    recordLang(node.attrs.nodeId, node.attrs.lang);
    const secId = ensureId(node.attrs.nodeId, 's')!;
    const hasTitle = node.content.some((c) => c.type === 'title' && titlePlainText(c).length > 0);
    if (!hasTitle) plan.attrs.untitledSections.push(secId);
    const inner = node.content.map((child) => renderBlock(child, level)).join('');
    const brk = pageBreakBefore ? '<mbp:pagebreak/>' : '';
    return `${brk}<div id="${escapeAttr(secId)}" class="fb2-section">${inner}</div>`;
  };

  const renderBodyContent = (body: BodyNode, bodyIndex: number, isMain: boolean): string => {
    const anchor = bodyAnchorIds.get(bodyIndex);
    const parts: string[] = [];
    let firstTopSection = true;
    for (const child of body.content) {
      if (child.type === 'section') {
        const needBreak = !firstTopSection;
        firstTopSection = false;
        parts.push(renderSection(child, isMain ? 1 : 2, needBreak));
      } else if (child.type === 'title') {
        parts.push(renderTitle(child, 1, 'fb2-title fb2-body-title'));
      } else {
        parts.push(renderBlock(child, 1));
      }
    }
    const idAttr = anchor ? ` id="${escapeAttr(anchor)}"` : '';
    return `<div${idAttr} class="fb2-body" data-fb2-body="${bodyIndex}">${parts.join('')}</div>`;
  };

  const renderNoteSection = (section: SectionNode): string => {
    counts.notes++;
    recordLang(section.attrs.nodeId, section.attrs.lang);
    const secId = ensureId(section.attrs.nodeId, 'note')!;
    const ownFb2Id = section.attrs.id;
    const backTarget = ownFb2Id ? backRefs.get(ownFb2Id) : undefined;
    const inner = section.content
      .map((child) =>
        child.type === 'title' ? renderTitle(child, null, 'fb2-note-title') : renderBlock(child, 3),
      )
      .join('');
    const back = backTarget
      ? `<p width="0" class="fb2-backlink"><a filepos="0000000000" data-target="${escapeAttr(backTarget)}">\u21a9</a></p>`
      : '';
    return `<div id="${escapeAttr(secId)}" class="fb2-note">${inner}${back}</div>`;
  };

  // Assemble document sections in contract order (§1).
  const chunks: string[] = [];
  const guide: MobiGuideItem[] = [];
  const titleInfo = document.description.titleInfo;

  // 1. Cover: MOBI 7 renders EXTH 201 natively without duplicating an inline cover page (contract §1).
  const coverHref = titleInfo.coverpage[0]?.href ?? '';
  if (coverHref) {
    const coverPic = coverHref.startsWith('#')
      ? options.pictures.get(coverHref.slice(1))
      : undefined;
    if (coverPic) {
      counts.pictures++;
    } else {
      plan.summary.push({ kind: 'pictureLeftOut', detail: coverHref });
    }
  }

  // 2. Title page (omitted only if title, series, authors, and annotation are all empty).
  if (plan.hasTitlePage) {
    let tp = '<div id="fb2-title-page" class="fb2-title-page">';
    if (!plan.originalTitleEmpty) {
      tp += `<h1 class="fb2-book-title">${escapeXml(plan.title)}</h1>`;
    }
    for (const seq of flattenSequences(titleInfo.sequences)) {
      if (!seq.name.trim()) continue;
      const num = seq.number ? ` #${seq.number}` : '';
      tp += `<p align="center" width="0" class="fb2-series"><i>${escapeXml(seq.name.trim() + num)}</i></p>`;
    }
    for (const author of titleInfo.authors) {
      const name = personDisplayName(author);
      if (name) tp += `<p align="center" width="0" class="fb2-author">${escapeXml(name)}</p>`;
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
    options.tocPlacement === 'none' ? '' : renderInlineTocMobi7(nav, plan.words.contents);
  if (options.tocPlacement === 'afterTitle' && tocHtml) {
    if (chunks.length > 0) chunks.push('<mbp:pagebreak/>');
    chunks.push(tocHtml);
    guide.push({ type: 'toc', title: plan.words.contents, anchorId: 'fb2-toc' });
  }

  // 4. Main body & further non-notes bodies
  if (chunks.length > 0) chunks.push('<mbp:pagebreak/>');
  if (plan.mainBodyIndex >= 0) {
    chunks.push(renderBodyContent(document.bodies[plan.mainBodyIndex]!, plan.mainBodyIndex, true));
  } else {
    chunks.push('<div id="fb2-main-start" class="fb2-body"></div>');
  }
  for (const idx of plan.furtherBodyIndices) {
    chunks.push('<mbp:pagebreak/>');
    chunks.push(renderBodyContent(document.bodies[idx]!, idx, false));
  }

  // 5. Notes bodies (rendered AFTER main & further bodies so `backRefs` is fully populated!)
  if (plan.notesBodyIndices.length > 0) {
    chunks.push('<mbp:pagebreak/>');
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
    chunks.push(`<div id="fb2-notes" class="fb2-notes">${notesParts.join('')}</div>`);
  }

  // 6. Inline TOC at end
  if (options.tocPlacement === 'end' && tocHtml) {
    chunks.push('<mbp:pagebreak/>');
    chunks.push(tocHtml);
    guide.push({ type: 'toc', title: plan.words.contents, anchorId: 'fb2-toc' });
  }

  guide.push({ type: 'text', title: plan.words.start, anchorId: plan.openAtAnchorId });

  const html =
    `<html><head><title>${escapeXml(plan.title)}</title></head><body>` +
    chunks.join('') +
    '</body></html>';

  return { html, nav, guide, counts };
}
