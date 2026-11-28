/**
 * Feature 023 (T018/T030): pure string serializer for FB2 `<description>` XML and `<stylesheet>`
 * elements. Lives in `docx-shared` so both `docx-export` (including parallel Web Workers) and
 * `docx-import` can round-trip complete FB2 descriptions without DOM APIs or cross-chunk imports.
 */
import type {
  AnnotationNode,
  CiteNode,
  CustomInfo,
  DateNode,
  DateValue,
  Description,
  DocumentInfo,
  InlineNode,
  Mark,
  ParagraphNode,
  Person,
  PoemNode,
  PublishInfo,
  Sequence,
  StanzaNode,
  Stylesheet,
  TableNode,
  TitleInfo,
  TitleNode,
} from '@/model/document';

import { escapeXmlAttr, escapeXmlText } from './docxRoundtripTypes';

function wrapMarks(inner: string, marks: readonly Mark[] | undefined): string {
  if (!marks || marks.length === 0) return inner;
  let out = inner;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]!;
    if (m.type === 'link') {
      const href = ` l:href="${escapeXmlAttr(m.attrs.href)}"`;
      const type = m.attrs.type ? ` type="${escapeXmlAttr(m.attrs.type)}"` : '';
      const xlinkType = m.attrs.xlinkType ? ` l:type="${escapeXmlAttr(m.attrs.xlinkType)}"` : '';
      out = `<a${href}${type}${xlinkType}>${out}</a>`;
    } else if (m.type === 'style') {
      const lang = m.attrs.lang ? ` xml:lang="${escapeXmlAttr(m.attrs.lang)}"` : '';
      out = `<style name="${escapeXmlAttr(m.attrs.name)}"${lang}>${out}</style>`;
    } else {
      const lang = m.attrs?.lang ? ` xml:lang="${escapeXmlAttr(m.attrs.lang)}"` : '';
      out = `<${m.type}${lang}>${out}</${m.type}>`;
    }
  }
  return out;
}

export function serializeFb2InlineNodes(nodes: readonly InlineNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';
  return nodes
    .map((node) => {
      if (node.type === 'text') {
        return wrapMarks(escapeXmlText(node.text), node.marks);
      }
      if (node.type === 'inline-image') {
        const alt = node.attrs.alt ? ` alt="${escapeXmlAttr(node.attrs.alt)}"` : '';
        return wrapMarks(`<image l:href="${escapeXmlAttr(node.attrs.href)}"${alt}/>`, node.marks);
      }
      return wrapMarks(node.attrs.xml, node.marks);
    })
    .join('');
}

function pAttrs(attrs: { id?: string; lang?: string; style?: string } | undefined): string {
  if (!attrs) return '';
  let out = '';
  if (attrs.id) out += ` id="${escapeXmlAttr(attrs.id)}"`;
  if (attrs.lang) out += ` xml:lang="${escapeXmlAttr(attrs.lang)}"`;
  if (attrs.style) out += ` style="${escapeXmlAttr(attrs.style)}"`;
  return out;
}

function serializeTitleNode(title: TitleNode): string {
  const lang = title.attrs?.lang ? ` xml:lang="${escapeXmlAttr(title.attrs.lang)}"` : '';
  const body = title.content
    .map((child) =>
      child.type === 'empty-line'
        ? '<empty-line/>'
        : `<p${pAttrs(child.attrs)}>${serializeFb2InlineNodes(child.content)}</p>`,
    )
    .join('');
  return `<title${lang}>${body}</title>`;
}

function serializeStanzaNode(stanza: StanzaNode): string {
  const lang = stanza.attrs?.lang ? ` xml:lang="${escapeXmlAttr(stanza.attrs.lang)}"` : '';
  const body = stanza.content
    .map((child) => {
      if (child.type === 'title') return serializeTitleNode(child);
      if (child.type === 'subtitle') {
        return `<subtitle${pAttrs(child.attrs)}>${serializeFb2InlineNodes(child.content)}</subtitle>`;
      }
      return `<v${pAttrs(child.attrs)}>${serializeFb2InlineNodes(child.content)}</v>`;
    })
    .join('');
  return `<stanza${lang}>${body}</stanza>`;
}

function serializeDateNode(node: DateNode): string {
  const val =
    node.attrs?.value && /^\d{4}-\d{2}-\d{2}$/.test(node.attrs.value)
      ? ` value="${escapeXmlAttr(node.attrs.value)}"`
      : '';
  const lang = node.attrs?.lang ? ` xml:lang="${escapeXmlAttr(node.attrs.lang)}"` : '';
  const text = (node.content ?? []).map((t) => escapeXmlText(t.text)).join('');
  return `<date${val}${lang}>${text}</date>`;
}

function serializePoemNode(poem: PoemNode): string {
  const id = poem.attrs?.id ? ` id="${escapeXmlAttr(poem.attrs.id)}"` : '';
  const lang = poem.attrs?.lang ? ` xml:lang="${escapeXmlAttr(poem.attrs.lang)}"` : '';
  const body = poem.content
    .map((child) => {
      if (child.type === 'title') return serializeTitleNode(child);
      if (child.type === 'epigraph') {
        const eid = child.attrs?.id ? ` id="${escapeXmlAttr(child.attrs.id)}"` : '';
        return `<epigraph${eid}>${serializeMixedBlocks(child.content)}</epigraph>`;
      }
      if (child.type === 'stanza') return serializeStanzaNode(child);
      if (child.type === 'subtitle') {
        return `<subtitle${pAttrs(child.attrs)}>${serializeFb2InlineNodes(child.content)}</subtitle>`;
      }
      if (child.type === 'text-author') {
        return `<text-author${pAttrs(child.attrs)}>${serializeFb2InlineNodes(child.content)}</text-author>`;
      }
      if (child.type === 'date') return serializeDateNode(child);
      return '';
    })
    .join('');
  return `<poem${id}${lang}>${body}</poem>`;
}

function serializeTableNode(table: TableNode): string {
  const id = table.attrs?.id ? ` id="${escapeXmlAttr(table.attrs.id)}"` : '';
  const style = table.attrs?.style ? ` style="${escapeXmlAttr(table.attrs.style)}"` : '';
  const rows = table.content
    .map((row) => {
      const rAlign = row.attrs?.align ? ` align="${escapeXmlAttr(row.attrs.align)}"` : '';
      const cells = row.content
        .map((cell) => {
          let ca = pAttrs(cell.attrs);
          if (cell.attrs?.colspan && cell.attrs.colspan > 1)
            ca += ` colspan="${cell.attrs.colspan}"`;
          if (cell.attrs?.rowspan && cell.attrs.rowspan > 1)
            ca += ` rowspan="${cell.attrs.rowspan}"`;
          if (cell.attrs?.align) ca += ` align="${escapeXmlAttr(cell.attrs.align)}"`;
          if (cell.attrs?.valign) ca += ` valign="${escapeXmlAttr(cell.attrs.valign)}"`;
          return `<${cell.type}${ca}>${serializeFb2InlineNodes(cell.content)}</${cell.type}>`;
        })
        .join('');
      return `<tr${rAlign}>${cells}</tr>`;
    })
    .join('');
  return `<table${id}${style}>${rows}</table>`;
}

function serializeCiteNode(cite: CiteNode): string {
  const id = cite.attrs?.id ? ` id="${escapeXmlAttr(cite.attrs.id)}"` : '';
  const lang = cite.attrs?.lang ? ` xml:lang="${escapeXmlAttr(cite.attrs.lang)}"` : '';
  return `<cite${id}${lang}>${serializeMixedBlocks(cite.content)}</cite>`;
}

function serializeMixedBlocks(
  blocks: readonly (
    | ParagraphNode
    | PoemNode
    | CiteNode
    | TableNode
    | { type: string; attrs?: Record<string, unknown>; content?: InlineNode[] }
  )[],
): string {
  return blocks
    .map((b) => {
      if (b.type === 'p') {
        const p = b as ParagraphNode;
        return `<p${pAttrs(p.attrs)}>${serializeFb2InlineNodes(p.content)}</p>`;
      }
      if (b.type === 'subtitle') {
        return `<subtitle${pAttrs(b.attrs as { id?: string; lang?: string; style?: string })}>${serializeFb2InlineNodes(b.content)}</subtitle>`;
      }
      if (b.type === 'text-author') {
        return `<text-author${pAttrs(b.attrs as { id?: string; lang?: string; style?: string })}>${serializeFb2InlineNodes(b.content)}</text-author>`;
      }
      if (b.type === 'empty-line') return '<empty-line/>';
      if (b.type === 'poem') return serializePoemNode(b as PoemNode);
      if (b.type === 'cite') return serializeCiteNode(b as CiteNode);
      if (b.type === 'table') return serializeTableNode(b as TableNode);
      return '';
    })
    .join('');
}

function serializeAnnotation(tag: 'annotation' | 'history', node: AnnotationNode): string {
  const id = node.attrs?.id ? ` id="${escapeXmlAttr(node.attrs.id)}"` : '';
  const lang = node.attrs?.lang ? ` xml:lang="${escapeXmlAttr(node.attrs.lang)}"` : '';
  if (!node.content || node.content.length === 0) {
    return `<${tag}${id}${lang}/>`;
  }
  return `<${tag}${id}${lang}>${serializeMixedBlocks(node.content)}</${tag}>`;
}

function serializePerson(tag: 'author' | 'translator' | 'publisher', p: Person): string {
  const parts: string[] = [];
  const hasName = Boolean(p.firstName || p.middleName || p.lastName);
  if (hasName) {
    parts.push(`<first-name>${escapeXmlText(p.firstName ?? '')}</first-name>`);
    if (p.middleName) parts.push(`<middle-name>${escapeXmlText(p.middleName)}</middle-name>`);
    parts.push(`<last-name>${escapeXmlText(p.lastName ?? '')}</last-name>`);
    if (p.nickname) parts.push(`<nickname>${escapeXmlText(p.nickname)}</nickname>`);
  } else if (p.nickname) {
    parts.push(`<nickname>${escapeXmlText(p.nickname)}</nickname>`);
  } else {
    parts.push('<first-name/><last-name/>');
  }
  for (const hp of p.homePages ?? []) {
    if (hp) parts.push(`<home-page>${escapeXmlText(hp)}</home-page>`);
  }
  for (const em of p.emails ?? []) {
    if (em) parts.push(`<email>${escapeXmlText(em)}</email>`);
  }
  if (p.id) parts.push(`<id>${escapeXmlText(p.id)}</id>`);
  return `<${tag}>${parts.join('')}</${tag}>`;
}

function serializeDateValue(d: DateValue): string {
  const val =
    d.value && /^\d{4}-\d{2}-\d{2}$/.test(d.value) ? ` value="${escapeXmlAttr(d.value)}"` : '';
  const lang = d.lang ? ` xml:lang="${escapeXmlAttr(d.lang)}"` : '';
  return `<date${val}${lang}>${escapeXmlText(d.text ?? '')}</date>`;
}

function serializeSequence(seq: Sequence): string {
  const num = seq.number !== undefined ? ` number="${seq.number}"` : '';
  const lang = seq.lang ? ` xml:lang="${escapeXmlAttr(seq.lang)}"` : '';
  const children = (seq.children ?? []).map(serializeSequence).join('');
  return children
    ? `<sequence name="${escapeXmlAttr(seq.name)}"${num}${lang}>${children}</sequence>`
    : `<sequence name="${escapeXmlAttr(seq.name)}"${num}${lang}/>`;
}

function serializeTitleInfo(tag: 'title-info' | 'src-title-info', ti: TitleInfo): string {
  const parts: string[] = [];
  const genres = ti.genres.length > 0 ? ti.genres : [{ code: 'unrecognised' }];
  for (const g of genres) {
    const match = g.match !== undefined && g.match !== 100 ? ` match="${g.match}"` : '';
    parts.push(`<genre${match}>${escapeXmlText(g.code)}</genre>`);
  }
  const authors =
    ti.authors.length > 0
      ? ti.authors
      : [{ homePages: [], emails: [], firstName: '', lastName: '' }];
  for (const a of authors) parts.push(serializePerson('author', a));
  parts.push(`<book-title>${escapeXmlText(ti.bookTitle ?? '')}</book-title>`);
  if (ti.annotation) parts.push(serializeAnnotation('annotation', ti.annotation));
  if (ti.keywords) parts.push(`<keywords>${escapeXmlText(ti.keywords)}</keywords>`);
  if (ti.date) parts.push(serializeDateValue(ti.date));
  if (ti.coverpage && ti.coverpage.length > 0) {
    const imgs = ti.coverpage
      .map((img) => {
        const alt = img.alt ? ` alt="${escapeXmlAttr(img.alt)}"` : '';
        const title = img.title ? ` title="${escapeXmlAttr(img.title)}"` : '';
        const id = img.id ? ` id="${escapeXmlAttr(img.id)}"` : '';
        return `<image l:href="${escapeXmlAttr(img.href)}"${alt}${title}${id}/>`;
      })
      .join('');
    parts.push(`<coverpage>${imgs}</coverpage>`);
  }
  parts.push(`<lang>${escapeXmlText(ti.lang || 'en')}</lang>`);
  if (ti.srcLang) parts.push(`<src-lang>${escapeXmlText(ti.srcLang)}</src-lang>`);
  for (const tr of ti.translators ?? []) parts.push(serializePerson('translator', tr));
  for (const seq of ti.sequences ?? []) parts.push(serializeSequence(seq));
  return `<${tag}>${parts.join('')}</${tag}>`;
}

function serializeDocumentInfo(di: DocumentInfo): string {
  const parts: string[] = [];
  const authors =
    di.authors.length > 0 ? di.authors : [{ homePages: [], emails: [], nickname: 'unknown' }];
  for (const a of authors) parts.push(serializePerson('author', a));
  if (di.programUsed) parts.push(`<program-used>${escapeXmlText(di.programUsed)}</program-used>`);
  parts.push(serializeDateValue(di.date ?? { text: '' }));
  for (const u of di.srcUrls ?? []) {
    if (u) parts.push(`<src-url>${escapeXmlText(u)}</src-url>`);
  }
  if (di.srcOcr) parts.push(`<src-ocr>${escapeXmlText(di.srcOcr)}</src-ocr>`);
  parts.push(`<id>${escapeXmlText(di.id ?? '')}</id>`);
  parts.push(`<version>${escapeXmlText(di.version || '1.0')}</version>`);
  if (di.history) parts.push(serializeAnnotation('history', di.history));
  for (const pub of di.publishers ?? []) parts.push(serializePerson('publisher', pub));
  return `<document-info>${parts.join('')}</document-info>`;
}

function serializePublishInfo(pi: PublishInfo): string {
  const parts: string[] = [];
  if (pi.bookName) parts.push(`<book-name>${escapeXmlText(pi.bookName)}</book-name>`);
  if (pi.publisher) parts.push(`<publisher>${escapeXmlText(pi.publisher)}</publisher>`);
  if (pi.city) parts.push(`<city>${escapeXmlText(pi.city)}</city>`);
  if (pi.year) parts.push(`<year>${escapeXmlText(pi.year)}</year>`);
  if (pi.isbn) parts.push(`<isbn>${escapeXmlText(pi.isbn)}</isbn>`);
  for (const seq of pi.sequences ?? []) parts.push(serializeSequence(seq));
  return `<publish-info>${parts.join('')}</publish-info>`;
}

function serializeCustomInfo(ci: CustomInfo): string {
  const lang = ci.lang ? ` xml:lang="${escapeXmlAttr(ci.lang)}"` : '';
  return `<custom-info info-type="${escapeXmlAttr(ci.infoType)}"${lang}>${escapeXmlText(ci.text)}</custom-info>`;
}

/** Serializes an FB2 `Description` object into schema-valid `<description>...</description>` XML. */
export function serializeFb2DescriptionXml(desc: Description): string {
  const parts: string[] = [serializeTitleInfo('title-info', desc.titleInfo)];
  if (desc.srcTitleInfo) parts.push(serializeTitleInfo('src-title-info', desc.srcTitleInfo));
  parts.push(serializeDocumentInfo(desc.documentInfo));
  if (desc.publishInfo) parts.push(serializePublishInfo(desc.publishInfo));
  for (const ci of desc.customInfo ?? []) parts.push(serializeCustomInfo(ci));
  for (const out of desc.outputs ?? []) parts.push(out.attrs.xml);
  return `<description>${parts.join('')}</description>`;
}

/** Serializes FB2 `<stylesheet>` elements verbatim. */
export function serializeFb2StylesheetsXml(
  stylesheets: readonly (Stylesheet | { type: string; text: string })[],
): string {
  return stylesheets
    .map((s) => {
      const content = 'content' in s ? s.content : s.text;
      return `<stylesheet type="${escapeXmlAttr(s.type || 'text/css')}">${escapeXmlText(content)}</stylesheet>`;
    })
    .join('');
}
