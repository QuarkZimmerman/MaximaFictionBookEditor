/**
 * Feature 018 (T035, T044, contracts/mobi-import.md §2 & §4):
 * - Verified `MFBE` EXTH 59901 round-trip restoration and partial external-edit fallback.
 * - Full FB2 `<description>` XML serializer from `MfbeRoundTripRecord.description`.
 * - Canonical `Description` comparison (ignoring session `nodeId`s) for archive FBD conflict check.
 */
import type {
  BlockNode,
  CustomInfo,
  DateValue,
  Description,
  DocumentInfo,
  InlineNode,
  Mark,
  Person,
  PublishInfo,
  Sequence,
  Stylesheet,
  TitleInfo,
} from '@/model/document';

import type { MfbeAttrs, MfbeRoundTripRecord } from '../export/metadata';
import type { MobiImportSummaryItem } from './metadata';

export interface MfbeResolution {
  mode: 'full' | 'partial' | 'foreign';
  useMeta: boolean;
  useBody: boolean;
  record: MfbeRoundTripRecord | null;
  summary: MobiImportSummaryItem[];
}

export function parseMfbeRecord(raw: unknown): MfbeRoundTripRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<MfbeRoundTripRecord>;
  if (obj.v !== 1 || !obj.description || typeof obj.description !== 'object') return null;
  const attrs: MfbeAttrs = {
    bodies: Array.isArray(obj.attrs?.bodies) ? obj.attrs.bodies : [],
    dates: obj.attrs?.dates ?? {},
    imageTitles: obj.attrs?.imageTitles ?? {},
    styleNames: obj.attrs?.styleNames ?? {},
    untitledSections: Array.isArray(obj.attrs?.untitledSections) ? obj.attrs.untitledSections : [],
    nodeLangs: obj.attrs?.nodeLangs ?? {},
  };
  return {
    v: 1,
    description: obj.description,
    stylesheets: Array.isArray(obj.stylesheets) ? obj.stylesheets : [],
    binaries: obj.binaries && typeof obj.binaries === 'object' ? obj.binaries : {},
    attrs,
  };
}

/**
 * Resolves verified MFBE status into full round-trip, partial external-edit fallback, or foreign
 * import per FR-041 / contracts/mobi-import.md §2.
 */
export function resolveMfbeMode(input: {
  mfbeStatus: 'none' | 'valid' | 'externallyModified' | 'corrupt';
  mfbeHtmlMatches: boolean;
  mfbeMetaMatches: boolean;
  mfbe?: unknown;
}): MfbeResolution {
  const summary: MobiImportSummaryItem[] = [];
  if (input.mfbeStatus === 'none') {
    return { mode: 'foreign', useMeta: false, useBody: false, record: null, summary };
  }
  if (input.mfbeStatus === 'corrupt') {
    summary.push({ kind: 'listedData', detail: 'MFBE' });
    return { mode: 'foreign', useMeta: false, useBody: false, record: null, summary };
  }
  const record = parseMfbeRecord(input.mfbe);
  if (!record) {
    summary.push({ kind: 'listedData', detail: 'MFBE' });
    return { mode: 'foreign', useMeta: false, useBody: false, record: null, summary };
  }
  if (input.mfbeStatus === 'valid') {
    return { mode: 'full', useMeta: true, useBody: true, record, summary };
  }
  // externallyModified: apply whichever half still matches!
  summary.push({ kind: 'externallyModified', detail: '' });
  return {
    mode: input.mfbeHtmlMatches || input.mfbeMetaMatches ? 'partial' : 'foreign',
    useMeta: input.mfbeMetaMatches,
    useBody: input.mfbeHtmlMatches,
    record,
    summary,
  };
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;');
}

function serializeMarks(text: string, marks: readonly Mark[] | undefined): string {
  if (!marks || marks.length === 0) return escText(text);
  let out = escText(text);
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]!;
    switch (m.type) {
      case 'strong':
        out = `<strong>${out}</strong>`;
        break;
      case 'emphasis':
        out = `<emphasis>${out}</emphasis>`;
        break;
      case 'strikethrough':
        out = `<strikethrough>${out}</strikethrough>`;
        break;
      case 'sub':
        out = `<sub>${out}</sub>`;
        break;
      case 'sup':
        out = `<sup>${out}</sup>`;
        break;
      case 'code':
        out = `<code>${out}</code>`;
        break;
      case 'style': {
        const name = m.attrs?.name ? ` name="${escAttr(m.attrs.name)}"` : '';
        out = `<style${name}>${out}</style>`;
        break;
      }
      case 'link': {
        const href = m.attrs?.href ? ` l:href="${escAttr(m.attrs.href)}"` : '';
        const type = m.attrs?.type === 'note' ? ' type="note"' : '';
        out = `<a${href}${type}>${out}</a>`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function serializeInlines(nodes: readonly InlineNode[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += serializeMarks(node.text, node.marks);
    } else if (node.type === 'inline-image') {
      const alt = node.attrs.alt ? ` alt="${escAttr(node.attrs.alt)}"` : '';
      out += `<image l:href="${escAttr(node.attrs.href)}"${alt}/>`;
    } else if (node.type === 'raw-xml') {
      out += node.attrs.xml;
    }
  }
  return out;
}

function serializeAnnotationBlocks(blocks: readonly BlockNode[] | undefined): string {
  if (!blocks || blocks.length === 0) return '<p/>';
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'p':
        parts.push(`<p>${serializeInlines(b.content)}</p>`);
        break;
      case 'subtitle':
        parts.push(`<subtitle>${serializeInlines(b.content)}</subtitle>`);
        break;
      case 'empty-line':
        parts.push('<empty-line/>');
        break;
      case 'cite': {
        const inner = (
          b.content as readonly (BlockNode | { type: 'text-author'; content?: InlineNode[] })[]
        )
          .map((c) =>
            c.type === 'text-author'
              ? `<text-author>${serializeInlines(c.content)}</text-author>`
              : serializeAnnotationBlocks([c as BlockNode]),
          )
          .join('');
        parts.push(`<cite>${inner || '<p/>'}</cite>`);
        break;
      }
      case 'poem': {
        const inner = b.content
          .map((c) => {
            if (c.type === 'stanza') {
              const vs = c.content
                .map((v) => (v.type === 'v' ? `<v>${serializeInlines(v.content)}</v>` : ''))
                .join('');
              return `<stanza>${vs}</stanza>`;
            }
            if (c.type === 'text-author') {
              return `<text-author>${serializeInlines(c.content)}</text-author>`;
            }
            return '';
          })
          .join('');
        parts.push(`<poem>${inner}</poem>`);
        break;
      }
      case 'raw-xml':
        parts.push(b.attrs.xml);
        break;
      default:
        break;
    }
  }
  return parts.join('') || '<p/>';
}

function serializePerson(tag: string, p: Person): string {
  const hasName = Boolean(p.firstName || p.middleName || p.lastName);
  const parts: string[] = [];
  if (hasName) {
    parts.push(`<first-name>${escText(p.firstName ?? '')}</first-name>`);
    if (p.middleName) parts.push(`<middle-name>${escText(p.middleName)}</middle-name>`);
    parts.push(`<last-name>${escText(p.lastName ?? '')}</last-name>`);
    if (p.nickname) parts.push(`<nickname>${escText(p.nickname)}</nickname>`);
  } else if (p.nickname) {
    parts.push(`<nickname>${escText(p.nickname)}</nickname>`);
  } else {
    parts.push('<first-name/><last-name/>');
  }
  for (const hp of p.homePages ?? []) {
    if (hp) parts.push(`<home-page>${escText(hp)}</home-page>`);
  }
  for (const em of p.emails ?? []) {
    if (em) parts.push(`<email>${escText(em)}</email>`);
  }
  if (p.id) parts.push(`<id>${escText(p.id)}</id>`);
  return `<${tag}>${parts.join('')}</${tag}>`;
}

function serializeDate(d: DateValue): string {
  const val = d.value && /^\d{4}-\d{2}-\d{2}$/.test(d.value) ? ` value="${escAttr(d.value)}"` : '';
  const lang = d.lang ? ` xml:lang="${escAttr(d.lang)}"` : '';
  return `<date${val}${lang}>${escText(d.text ?? '')}</date>`;
}

function serializeSequence(seq: Sequence): string {
  const num = seq.number !== undefined ? ` number="${seq.number}"` : '';
  const lang = seq.lang ? ` xml:lang="${escAttr(seq.lang)}"` : '';
  const children = (seq.children ?? []).map(serializeSequence).join('');
  return children
    ? `<sequence name="${escAttr(seq.name)}"${num}${lang}>${children}</sequence>`
    : `<sequence name="${escAttr(seq.name)}"${num}${lang}/>`;
}

function serializeTitleInfo(
  tag: 'title-info' | 'src-title-info',
  ti: TitleInfo,
  coverRemap?: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  const genres = ti.genres.length > 0 ? ti.genres : [{ code: 'unrecognised' }];
  for (const g of genres) {
    const match = g.match !== undefined && g.match !== 100 ? ` match="${g.match}"` : '';
    parts.push(`<genre${match}>${escText(g.code)}</genre>`);
  }
  const authors =
    ti.authors.length > 0
      ? ti.authors
      : [{ homePages: [], emails: [], firstName: '', lastName: '' }];
  for (const a of authors) parts.push(serializePerson('author', a));
  parts.push(`<book-title>${escText(ti.bookTitle ?? '')}</book-title>`);
  if (ti.annotation) {
    const id = ti.annotation.attrs?.id ? ` id="${escAttr(ti.annotation.attrs.id)}"` : '';
    const lang = ti.annotation.attrs?.lang
      ? ` xml:lang="${escAttr(ti.annotation.attrs.lang)}"`
      : '';
    parts.push(
      `<annotation${id}${lang}>${serializeAnnotationBlocks(ti.annotation.content)}</annotation>`,
    );
  }
  if (ti.keywords) parts.push(`<keywords>${escText(ti.keywords)}</keywords>`);
  if (ti.date) parts.push(serializeDate(ti.date));
  if (ti.coverpage && ti.coverpage.length > 0) {
    const imgs = ti.coverpage
      .map((img) => {
        let href = img.href;
        if (href.startsWith('#') && coverRemap) {
          const mapped = coverRemap.get(href.slice(1));
          if (mapped) href = `#${mapped}`;
        }
        const alt = img.alt ? ` alt="${escAttr(img.alt)}"` : '';
        const title = img.title ? ` title="${escAttr(img.title)}"` : '';
        const id = img.id ? ` id="${escAttr(img.id)}"` : '';
        return `<image l:href="${escAttr(href)}"${alt}${title}${id}/>`;
      })
      .join('');
    parts.push(`<coverpage>${imgs}</coverpage>`);
  }
  parts.push(`<lang>${escText(ti.lang || 'en')}</lang>`);
  if (ti.srcLang) parts.push(`<src-lang>${escText(ti.srcLang)}</src-lang>`);
  for (const tr of ti.translators ?? []) parts.push(serializePerson('translator', tr));
  for (const seq of ti.sequences ?? []) parts.push(serializeSequence(seq));
  return `<${tag}>${parts.join('')}</${tag}>`;
}

function serializeDocumentInfo(di: DocumentInfo): string {
  const parts: string[] = [];
  const authors =
    di.authors.length > 0 ? di.authors : [{ homePages: [], emails: [], nickname: 'unknown' }];
  for (const a of authors) parts.push(serializePerson('author', a));
  if (di.programUsed) parts.push(`<program-used>${escText(di.programUsed)}</program-used>`);
  parts.push(serializeDate(di.date ?? { text: '' }));
  for (const u of di.srcUrls ?? []) {
    if (u) parts.push(`<src-url>${escText(u)}</src-url>`);
  }
  if (di.srcOcr) parts.push(`<src-ocr>${escText(di.srcOcr)}</src-ocr>`);
  parts.push(`<id>${escText(di.id ?? '')}</id>`);
  parts.push(`<version>${escText(di.version || '1.0')}</version>`);
  if (di.history) {
    const id = di.history.attrs?.id ? ` id="${escAttr(di.history.attrs.id)}"` : '';
    const lang = di.history.attrs?.lang ? ` xml:lang="${escAttr(di.history.attrs.lang)}"` : '';
    parts.push(`<history${id}${lang}>${serializeAnnotationBlocks(di.history.content)}</history>`);
  }
  for (const pub of di.publishers ?? []) parts.push(serializePerson('publisher', pub));
  return `<document-info>${parts.join('')}</document-info>`;
}

function serializePublishInfo(pi: PublishInfo): string {
  const parts: string[] = [];
  if (pi.bookName) parts.push(`<book-name>${escText(pi.bookName)}</book-name>`);
  if (pi.publisher) parts.push(`<publisher>${escText(pi.publisher)}</publisher>`);
  if (pi.city) parts.push(`<city>${escText(pi.city)}</city>`);
  if (pi.year) parts.push(`<year>${escText(pi.year)}</year>`);
  if (pi.isbn) parts.push(`<isbn>${escText(pi.isbn)}</isbn>`);
  for (const seq of pi.sequences ?? []) parts.push(serializeSequence(seq));
  return `<publish-info>${parts.join('')}</publish-info>`;
}

function serializeCustomInfo(ci: CustomInfo): string {
  const lang = ci.lang ? ` xml:lang="${escAttr(ci.lang)}"` : '';
  return `<custom-info info-type="${escAttr(ci.infoType)}"${lang}>${escText(ci.text)}</custom-info>`;
}

/** Serializes a restored `MfbeRoundTripRecord.description` to complete FB2 `<description>` XML. */
export function serializeDescriptionXml(
  desc: Description,
  coverRemap?: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [serializeTitleInfo('title-info', desc.titleInfo, coverRemap)];
  if (desc.srcTitleInfo) parts.push(serializeTitleInfo('src-title-info', desc.srcTitleInfo));
  parts.push(serializeDocumentInfo(desc.documentInfo));
  if (desc.publishInfo) parts.push(serializePublishInfo(desc.publishInfo));
  for (const ci of desc.customInfo ?? []) parts.push(serializeCustomInfo(ci));
  for (const out of desc.outputs ?? []) parts.push(out.attrs.xml);
  return `<description>${parts.join('')}</description>`;
}

/** Serializes restored `<stylesheet>` elements verbatim. */
export function serializeStylesheetsXml(stylesheets: readonly Stylesheet[]): string {
  return stylesheets
    .map((s) => `<stylesheet type="${escAttr(s.type)}">${escText(s.content)}</stylesheet>`)
    .join('');
}

function stripTransientFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTransientFields);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'nodeId') continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = stripTransientFields(v);
    }
    return out;
  }
  return value;
}

/**
 * Canonical field-by-field equality for two `Description` values returned by `doc.readDescription`
 * (ignoring session-local `nodeId`s). Used for US5 archive FBD vs embedded MFBE conflict detection.
 */
export function descriptionsCanonicallyEqual(a: Description, b: Description): boolean {
  return JSON.stringify(stripTransientFields(a)) === JSON.stringify(stripTransientFields(b));
}
