/**
 * Feature 023 (T018 & T030; contracts/docx-file.md, data-model.md §3): pure OOXML WordprocessingML
 * document package builder. Converts an FB2 `Document` + staged media table + `DocxSettings` into
 * complete UTF-8 OOXML XML parts plus the reversible Custom XML round-trip record (`customXml/`).
 * Zero DOM dependencies so it executes identically on the main thread and inside Batch Web Workers.
 */
import type {
  AnnotationNode,
  BlockNode,
  BodyNode,
  CiteNode,
  DateNode,
  Document,
  EpigraphNode,
  ImageNode,
  InlineNode,
  Mark,
  ParagraphNode,
  Person,
  PoemNode,
  SectionNode,
  Sequence,
  TableNode,
  TitleNode,
} from '@/model/document';

import {
  docxMarginMm,
  resolveDocxFontFamily,
  resolveDocxSettings,
  type DocxSettings,
} from '../docxSettingsSchema';
import { serializeFb2DescriptionXml } from '../shared/docxDescriptionXml';
import {
  blockFingerprint,
  compressPayloadBase64,
  computeDocxContentDigests,
  DOCX_ROUNDTRIP_NAMESPACE,
  DOCX_ROUNDTRIP_VERSION,
  escapeXmlAttr,
  escapeXmlText,
  INVALID_XML_CHARS,
  type DocxBlockHint,
  type DocxBlockKind,
  type DocxBodyHint,
  type DocxFrontMatterMarkers,
  type DocxInlineHintGroup,
  type DocxInlineSpanHint,
  type DocxNoteHint,
  type DocxPictureMetaHint,
  type DocxRoundtripPayload,
  type DocxSectionHint,
  type DocxSkippedLeadingCover,
  type DocxSummaryItem,
  type DocxTableAttrsHint,
} from '../shared/docxRoundtripTypes';
import {
  computeDocxPageGeometry,
  EMUS_PER_INCH,
  fitImageToBoxEmu,
  ptToHalfPoints,
} from '../shared/docxUnits';
import { docxAddedWords } from '../shared/docxWords';
import {
  buildParagraphPropsXml,
  buildRunPropsXml,
  mapFb2CssToWordStyles,
  type DocxStyleProperties,
} from './docxCssMapper';

export interface StagedDocxPicture {
  binaryId: string;
  mediaName: string; // e.g. "word/media/image1.jpg"
  contentType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  converted: boolean;
}

export interface DocxBuildOptions {
  document: Document;
  pictures: ReadonlyMap<string, StagedDocxPicture>;
  settings?: Partial<DocxSettings>;
  fallbackTitle: string;
  appVersion: string;
  genreNames?: ReadonlyMap<string, string>;
}

export interface DocxXmlPart {
  name: string;
  content: string;
}

export interface DocxExportCounts {
  sections: number;
  pictures: number;
  tables: number;
  notes: number;
}

export interface DocxBuildResult {
  parts: DocxXmlPart[];
  counts: DocxExportCounts;
  summary: DocxSummaryItem[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

const CUSTOM_XML_ITEM_ID = '{7E3A8B9C-4D21-4F65-9B2E-1C8D5A3F0231}';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const REL_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_CORE_PROPS =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const REL_APP_PROPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
const REL_STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const REL_SETTINGS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const REL_FOOTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const REL_FOOTNOTES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const REL_ENDNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const REL_HYPERLINK =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const REL_CUSTOM_XML =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
const REL_CUSTOM_XML_PROPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';

function forEachNode(node: AnyNode, visit: (n: AnyNode) => void): void {
  visit(node);
  if (Array.isArray(node.content)) {
    for (const child of node.content) forEachNode(child, visit);
  }
}

/** Collects referenced binary IDs in document order (cover first, then annotation, history, bodies). */
export function collectDocxPictures(document: Document): { id: string; isCover: boolean }[] {
  const result: { id: string; isCover: boolean }[] = [];
  const seen = new Set<string>();
  const known = new Set(document.binaries.map((b) => b.id));

  const add = (href: string | undefined, isCover: boolean): void => {
    if (!href?.startsWith('#')) return;
    const id = href.slice(1);
    if (!known.has(id) || seen.has(id)) return;
    seen.add(id);
    result.push({ id, isCover });
  };

  for (const cov of document.description.titleInfo.coverpage) {
    add(cov.href, true);
  }
  const visit = (node: AnyNode): void => {
    if (node.type === 'image' || node.type === 'inline-image') add(node.attrs?.href, false);
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };
  if (document.description.titleInfo.annotation) visit(document.description.titleInfo.annotation);
  if (document.description.documentInfo.history) visit(document.description.documentInfo.history);
  for (const body of document.bodies) visit(body);
  return result;
}

function personDisplayName(p: Person): string {
  const parts = [p.firstName, p.middleName, p.lastName]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  return parts.join(' ') || (p.nickname ?? '').trim();
}

function flattenSequences(sequences: readonly Sequence[]): Sequence[] {
  return sequences.flatMap((seq) => [seq, ...flattenSequences(seq.children ?? [])]);
}

function inlinePlainText(nodes: readonly InlineNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((n) =>
      n.type === 'text' ? n.text : n.type === 'raw-xml' ? n.attrs.xml.replace(/<[^>]*>/g, '') : '',
    )
    .join('');
}

function titlePlainText(title: TitleNode | undefined): string {
  if (!title) return '';
  return title.content
    .filter((line): line is ParagraphNode => line.type === 'p')
    .map((line) => inlinePlainText(line.content))
    .filter((line) => line.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainTextOfNodes(nodes: readonly AnyNode[]): string {
  const parts: string[] = [];
  const visit = (node: AnyNode): void => {
    if (node.type === 'text') parts.push(node.text);
    else if (node.type === 'raw-xml') {
      parts.push(String(node.attrs?.xml ?? '').replace(/<[^>]*>/g, ''));
    } else if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
      parts.push(' ');
    }
  };
  for (const node of nodes) visit(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Allocates OOXML-compliant unique bookmark names (`<= 40` ASCII identifier chars) and integer IDs. */
class BookmarkAllocator {
  private nextId = 1;
  private readonly usedNames = new Set<string>();

  allocateName(preferred: string): string {
    let base = preferred.replace(/[^A-Za-z0-9_]/g, '_');
    if (!base || !/^[A-Za-z_]/.test(base)) base = `bm_${base}`;
    base = base.slice(0, 34);
    let candidate = base;
    for (let n = 2; this.usedNames.has(candidate.toLowerCase()); n++) {
      candidate = `${base.slice(0, 34 - String(n).length - 1)}_${n}`;
    }
    this.usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  nextNumericId(): number {
    return this.nextId++;
  }
}

interface RelEntry {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

class RelRegistry {
  private seq = 1;
  private readonly list: RelEntry[] = [];
  private readonly byKey = new Map<string, string>();

  add(type: string, target: string, external = false, fixedId?: string): string {
    const key = `${type}\u0000${target}\u0000${external ? '1' : '0'}`;
    if (!fixedId) {
      const existing = this.byKey.get(key);
      if (existing) return existing;
    }
    const id = fixedId ?? `rId${this.seq++}`;
    this.list.push({ id, type, target, external });
    if (!fixedId) this.byKey.set(key, id);
    return id;
  }

  toXml(): string {
    const items = this.list
      .map((r) => {
        const mode = r.external ? ' TargetMode="External"' : '';
        return `<Relationship Id="${escapeXmlAttr(r.id)}" Type="${escapeXmlAttr(r.type)}" Target="${escapeXmlAttr(r.target)}"${mode}/>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${items}</Relationships>`;
  }

  get size(): number {
    return this.list.length;
  }
}

interface LeafNoteEntry {
  bodyName: string;
  groupPath: string[];
  sectionId: string;
  section: SectionNode;
  label: string;
}

function collectLeafNotes(body: BodyNode, bodyName: string, out: LeafNoteEntry[]): void {
  const walkSec = (sec: SectionNode, groupPath: string[]): void => {
    const childSections = sec.content.filter((c): c is SectionNode => c.type === 'section');
    const titleNode = sec.content.find((c): c is TitleNode => c.type === 'title');
    const titleText = titlePlainText(titleNode);
    const hasOwnId = Boolean(sec.attrs.id);
    if (childSections.length > 0 && !hasOwnId) {
      const nextGroup = titleText ? [...groupPath, titleText] : groupPath;
      for (const child of childSections) walkSec(child, nextGroup);
      return;
    }
    if (hasOwnId) {
      out.push({
        bodyName,
        groupPath,
        sectionId: sec.attrs.id!,
        section: sec,
        label: titleText,
      });
    }
    for (const child of childSections) {
      const nextGroup = titleText ? [...groupPath, titleText] : groupPath;
      walkSec(child, nextGroup);
    }
  };
  for (const child of body.content) {
    if (child.type === 'section') walkSec(child, []);
  }
}

function sanitizeText(raw: string, controlCounter: { count: number }): string {
  if (INVALID_XML_CHARS.test(raw)) {
    INVALID_XML_CHARS.lastIndex = 0;
    const cleaned = raw.replace(INVALID_XML_CHARS, '');
    controlCounter.count += raw.length - cleaned.length;
    return cleaned;
  }
  return raw;
}

function buildDrawingXml(
  docPrId: number,
  relId: string,
  cx: number,
  cy: number,
  name: string,
  descr?: string,
): string {
  const descrAttr = descr ? ` descr="${escapeXmlAttr(descr)}"` : '';
  return (
    `<w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${escapeXmlAttr(name)}"${descrAttr}/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A_NS}">` +
    `<a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="${docPrId}" name="${escapeXmlAttr(name)}"${descrAttr}/>` +
    `<pic:cNvPicPr/>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${escapeXmlAttr(relId)}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>`
  );
}

/**
 * Generates all OOXML XML parts for a complete, valid `.docx` package (including reversible
 * Custom XML round-trip metadata in `customXml/item1.xml`).
 */
export async function buildDocxPackage(options: DocxBuildOptions): Promise<DocxBuildResult> {
  const { document, pictures } = options;
  const settings = resolveDocxSettings(options.settings);
  const fontFamily = resolveDocxFontFamily(settings);
  const marginMm = docxMarginMm(settings.defaultPageSize, settings);
  const geom = computeDocxPageGeometry(settings.defaultPageSize, marginMm);
  const baseHalfPt = ptToHalfPoints(settings.textSizePt);
  const summary: DocxSummaryItem[] = [];
  const controlCounter = { count: 0 };

  const mappedCss = mapFb2CssToWordStyles(document.stylesheets, settings.textSizePt, summary);

  const titleInfo = document.description.titleInfo;
  const docInfo = document.description.documentInfo;
  const publishInfo = document.description.publishInfo;

  const rawTitle = titleInfo.bookTitle.trim();
  const bookTitle = rawTitle || options.fallbackTitle;
  if (!rawTitle) {
    summary.push({ kind: 'repairedTitle', detail: options.fallbackTitle });
  }
  const words = docxAddedWords(titleInfo.lang);

  // Classify bodies into main, further, and notes bodies.
  const noteTargets = new Set<string>();
  for (const body of document.bodies) {
    forEachNode(body, (node) => {
      for (const mark of (node.marks ?? []) as Mark[]) {
        if (
          mark.type === 'link' &&
          mark.attrs.type === 'note' &&
          mark.attrs.href?.startsWith('#')
        ) {
          noteTargets.add(mark.attrs.href.slice(1));
        }
      }
    });
  }

  const bodyOfId = new Map<string, number>();
  document.bodies.forEach((body, idx) =>
    forEachNode(body, (node) => {
      const id = node.attrs?.id as string | undefined;
      if (id && !bodyOfId.has(id)) bodyOfId.set(id, idx);
    }),
  );

  const notesBodySet = new Set<number>();
  document.bodies.forEach((body, idx) => {
    const name = (body.attrs.name ?? '').trim().toLowerCase();
    if (name === 'notes' || name === 'comments') notesBodySet.add(idx);
  });
  for (const target of noteTargets) {
    const idx = bodyOfId.get(target);
    if (idx !== undefined && idx > 0) notesBodySet.add(idx);
  }

  const mainBodyIndex = document.bodies.findIndex((_, idx) => !notesBodySet.has(idx));
  const furtherBodyIndices: number[] = [];
  const notesBodyIndices: number[] = [];
  document.bodies.forEach((_, idx) => {
    if (notesBodySet.has(idx)) notesBodyIndices.push(idx);
    else if (idx !== mainBodyIndex) furtherBodyIndices.push(idx);
  });

  // Collect leaf notes from all notes bodies.
  const allLeafNotes: LeafNoteEntry[] = [];
  const leafNoteById = new Map<string, LeafNoteEntry>();
  for (const idx of notesBodyIndices) {
    const body = document.bodies[idx]!;
    const bodyName = body.attrs.name || 'notes';
    const before = allLeafNotes.length;
    collectLeafNotes(body, bodyName, allLeafNotes);
    for (let i = before; i < allLeafNotes.length; i++) {
      const entry = allLeafNotes[i]!;
      if (!leafNoteById.has(entry.sectionId)) {
        leafNoteById.set(entry.sectionId, entry);
      }
    }
  }

  // Pre-allocate bookmarks for all FB2 IDs so internal hyperlinks can resolve forward targets.
  const bookmarks = new BookmarkAllocator();
  const nodeIdToBookmark = new Map<string, string>();
  const fb2IdToBookmark = new Map<string, string>();
  const claimId = (node: AnyNode): void => {
    const own = node.attrs?.id as string | undefined;
    if (!own || !node.attrs?.nodeId) return;
    if (fb2IdToBookmark.has(own)) {
      summary.push({ kind: 'duplicateId', detail: own });
    }
    const bm = bookmarks.allocateName(`id_${own}`);
    nodeIdToBookmark.set(node.attrs.nodeId, bm);
    if (!fb2IdToBookmark.has(own)) {
      fb2IdToBookmark.set(own, bm);
    }
  };
  for (const body of document.bodies) forEachNode(body, claimId);
  if (titleInfo.annotation) forEachNode(titleInfo.annotation, claimId);
  if (docInfo.history) forEachNode(docInfo.history, claimId);

  // Relationships & counters
  const docRels = new RelRegistry();
  docRels.add(REL_STYLES, 'styles.xml', false, 'rIdStyles');
  docRels.add(REL_SETTINGS, 'settings.xml', false, 'rIdSettings');
  docRels.add(REL_FOOTER, 'footer1.xml', false, 'rIdFooter1');
  docRels.add(REL_CUSTOM_XML, '../customXml/item1.xml', false, 'rIdCustomXml1');

  const notesRels = new RelRegistry();
  let nextDocPrId = 1;
  let nextNoteId = 1;
  let groupCounter = 1;
  const counts: DocxExportCounts = { sections: 0, pictures: 0, tables: 0, notes: 0 };

  const frontMatter: DocxFrontMatterMarkers = {};
  let skippedLeadingCover: DocxSkippedLeadingCover | undefined;
  const pictureHints: Record<string, DocxPictureMetaHint> = {};
  const bodyHints: DocxBodyHint[] = [];
  const sectionHints: DocxSectionHint[] = [];
  const blockHints: DocxBlockHint[] = [];
  const inlineHints: DocxInlineHintGroup[] = [];
  const noteHints: DocxNoteHint[] = [];
  const referencedNoteSectionIds = new Set<string>();
  const renderedWordNotes: { id: number; xml: string }[] = [];
  const tocEntries: { title: string; bookmark: string; level: number }[] = [];

  const pictureMetaLookup = new Map<string, { alt?: string; title?: string; id?: string }>();
  for (const c of titleInfo.coverpage) {
    if (c.href.startsWith('#')) {
      pictureMetaLookup.set(c.href.slice(1), { alt: c.alt, title: c.title, id: c.id });
    }
  }

  for (const pic of pictures.values()) {
    if (pic.converted) {
      summary.push({ kind: 'convertedPicture', detail: `#${pic.binaryId}` });
    }
    const meta = pictureMetaLookup.get(pic.binaryId);
    pictureHints[pic.mediaName] = {
      binaryId: pic.binaryId,
      contentType: pic.contentType,
      ...(meta?.alt ? { alt: meta.alt } : {}),
      ...(meta?.title ? { title: meta.title } : {}),
      ...(meta?.id ? { id: meta.id } : {}),
    };
  }

  // Helper to wrap a paragraph's inner XML with optional start/end bookmarks.
  const wrapParagraph = (
    pPrInner: string,
    runsXml: string,
    bookmarkNames: string[] = [],
  ): string => {
    const starts: string[] = [];
    const ends: string[] = [];
    for (const name of bookmarkNames) {
      const id = bookmarks.nextNumericId();
      starts.push(`<w:bookmarkStart w:id="${id}" w:name="${escapeXmlAttr(name)}"/>`);
      ends.push(`<w:bookmarkEnd w:id="${id}"/>`);
    }
    const pPr = pPrInner ? `<w:pPr>${pPrInner}</w:pPr>` : '';
    return `<w:p>${pPr}${starts.join('')}${runsXml}${ends.join('')}</w:p>`;
  };

  // Renders an image into a `<w:r>` containing `<w:drawing>`, registering its media rel.
  const renderImageRun = (
    href: string,
    alt: string | undefined,
    title: string | undefined,
    imgId: string | undefined,
    rels: RelRegistry,
    maxW: number,
    maxH: number,
    inNote: boolean,
  ): string => {
    if (/^https?:\/\//i.test(href)) {
      summary.push({ kind: 'remotePicture', detail: href });
      return '';
    }
    if (!href.startsWith('#')) {
      summary.push({ kind: 'missingPicture', detail: href });
      return '';
    }
    const binaryId = href.slice(1);
    const pic = pictures.get(binaryId);
    if (!pic) {
      summary.push({ kind: 'missingPicture', detail: href });
      return '';
    }
    // Update picture hint with alt/title/id if not already recorded.
    const existingHint = pictureHints[pic.mediaName];
    if (existingHint) {
      if (alt && !existingHint.alt) existingHint.alt = alt;
      if (title && !existingHint.title) existingHint.title = title;
      if (imgId && !existingHint.id) existingHint.id = imgId;
    }
    const relTarget = pic.mediaName.startsWith('word/')
      ? pic.mediaName.slice('word/'.length)
      : pic.mediaName;
    const relId = rels.add(REL_IMAGE, relTarget, false);
    const { cx, cy } = fitImageToBoxEmu(pic.width, pic.height, maxW, maxH, false);
    const docPrId = nextDocPrId++;
    if (!inNote) counts.pictures++;
    return `<w:r>${buildDrawingXml(docPrId, relId, cx, cy, `Picture ${docPrId}`, alt || title)}</w:r>`;
  };

  // Forward callback box for rendering note sections when encountered via `type="note"` links.
  const noteRenderer: { fn: (entry: LeafNoteEntry) => number } = {
    fn: () => 0,
  };

  const renderInlineNodes = (
    nodes: readonly InlineNode[] | undefined,
    rels: RelRegistry,
    blockBookmark: string | undefined,
    inNote: boolean,
  ): string => {
    if (!nodes || nodes.length === 0) return '';
    const spans: DocxInlineSpanHint[] = [];
    let charOffset = 0;

    const out: string[] = [];
    for (const node of nodes) {
      if (node.type === 'inline-image') {
        const imgRun = renderImageRun(
          node.attrs.href,
          node.attrs.alt,
          undefined,
          undefined,
          rels,
          Math.round(geom.contentWidthEmu * 0.5),
          Math.round(EMUS_PER_INCH * 1.5),
          inNote,
        );
        if (imgRun) out.push(imgRun);
        continue;
      }

      const rawText = node.type === 'text' ? node.text : node.attrs.xml.replace(/<[^>]*>/g, '');
      const cleanText = sanitizeText(rawText, controlCounter);
      const marks = node.marks ?? [];
      const startOff = charOffset;
      charOffset += cleanText.length;

      // Record inline style/lang spans for round-trip restoration.
      if (blockBookmark && cleanText.length > 0) {
        for (const m of marks) {
          if (m.type === 'style' && m.attrs.name) {
            spans.push({ start: startOff, end: charOffset, kind: 'style', value: m.attrs.name });
            if (m.attrs.lang) {
              spans.push({ start: startOff, end: charOffset, kind: 'lang', value: m.attrs.lang });
            }
          } else if (m.type !== 'link' && m.attrs?.lang) {
            spans.push({ start: startOff, end: charOffset, kind: 'lang', value: m.attrs.lang });
          }
        }
      }

      // Check for link mark (at most one per FB2 schema).
      const linkMark = marks.find((m): m is Extract<Mark, { type: 'link' }> => m.type === 'link');

      // Note reference -> emit native Word footnoteReference / endnoteReference!
      if (
        !inNote &&
        linkMark &&
        linkMark.attrs.type === 'note' &&
        linkMark.attrs.href.startsWith('#')
      ) {
        const targetId = linkMark.attrs.href.slice(1);
        const noteEntry = leafNoteById.get(targetId);
        if (noteEntry) {
          const wordNoteId = noteRenderer.fn(noteEntry);
          const refStyle =
            settings.notesPlacement === 'endnotes' ? 'EndnoteReference' : 'FootnoteReference';
          const refElem =
            settings.notesPlacement === 'endnotes'
              ? `<w:endnoteReference w:id="${wordNoteId}"/>`
              : `<w:footnoteReference w:id="${wordNoteId}"/>`;
          out.push(`<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr>${refElem}</w:r>`);
          continue;
        }
      }

      // Build run properties from semantic + CSS style marks.
      const rPrParts: string[] = [];
      let bold = false;
      let italic = false;
      let strike = false;
      let sub = false;
      let sup = false;
      let isCode = false;
      let cssCharStyleId: string | undefined;

      for (const m of marks) {
        if (m.type === 'strong') bold = true;
        else if (m.type === 'emphasis') italic = true;
        else if (m.type === 'strikethrough') strike = true;
        else if (m.type === 'sub') sub = true;
        else if (m.type === 'sup') sup = true;
        else if (m.type === 'code') isCode = true;
        else if (m.type === 'style') {
          const mapped = mappedCss.characterStyleFor(m.attrs.name);
          if (mapped) cssCharStyleId = mapped;
        }
      }

      const isLink = Boolean(linkMark);
      if (isLink) rPrParts.push('<w:rStyle w:val="Hyperlink"/>');
      else if (cssCharStyleId) rPrParts.push(`<w:rStyle w:val="${cssCharStyleId}"/>`);
      else if (isCode) rPrParts.push('<w:rStyle w:val="Code"/>');

      if (bold) rPrParts.push('<w:b/>');
      if (italic) rPrParts.push('<w:i/>');
      if (strike) rPrParts.push('<w:strike/>');
      if (sup) rPrParts.push('<w:vertAlign w:val="superscript"/>');
      else if (sub) rPrParts.push('<w:vertAlign w:val="subscript"/>');

      const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
      const runXml = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(cleanText)}</w:t></w:r>`;

      if (linkMark) {
        const href = linkMark.attrs.href ?? '';
        if (href.startsWith('#')) {
          const anchor = fb2IdToBookmark.get(href.slice(1));
          if (anchor) {
            out.push(`<w:hyperlink w:anchor="${escapeXmlAttr(anchor)}">${runXml}</w:hyperlink>`);
          } else {
            summary.push({ kind: 'brokenInternalLink', detail: href });
            out.push(`<w:r><w:t xml:space="preserve">${escapeXmlText(cleanText)}</w:t></w:r>`);
          }
        } else if (/^(?:https?:|mailto:|ftp:)/i.test(href)) {
          const relId = rels.add(REL_HYPERLINK, href, true);
          out.push(`<w:hyperlink r:id="${escapeXmlAttr(relId)}">${runXml}</w:hyperlink>`);
        } else {
          out.push(`<w:r><w:t xml:space="preserve">${escapeXmlText(cleanText)}</w:t></w:r>`);
        }
      } else {
        out.push(runXml);
      }
    }

    if (blockBookmark && spans.length > 0) {
      inlineHints.push({ blockBookmark, spans });
    }
    return out.join('');
  };

  const renderParagraphBlock = (
    p: ParagraphNode | { type: string; attrs?: Record<string, unknown>; content: InlineNode[] },
    kind: DocxBlockKind,
    defaultStyleId: string,
    rels: RelRegistry,
    inNote: boolean,
    groupId?: string,
    extraBookmarks: string[] = [],
    recordHint = true,
  ): string => {
    const attrs = (p.attrs ?? {}) as {
      nodeId?: string;
      id?: string;
      lang?: string;
      style?: string;
    };
    const fb2Style = attrs.style;
    const styleId = (fb2Style && mappedCss.paragraphStyleFor(fb2Style)) || defaultStyleId;
    const bm =
      (attrs.nodeId && nodeIdToBookmark.get(attrs.nodeId)) ||
      (recordHint ? bookmarks.allocateName(`blk_${blockHints.length + 1}`) : undefined);
    const allBookmarks = [...extraBookmarks, ...(bm ? [bm] : [])];
    const runs = renderInlineNodes(p.content, rels, recordHint ? bm : undefined, inNote);

    if (recordHint && bm && !inNote) {
      blockHints.push({
        bookmark: bm,
        fingerprint: blockFingerprint(inlinePlainText(p.content)),
        kind,
        ...(attrs.id ? { id: attrs.id } : {}),
        ...(attrs.lang ? { lang: attrs.lang } : {}),
        ...(fb2Style ? { style: fb2Style } : {}),
        ...(groupId ? { groupId } : {}),
      });
    }
    return wrapParagraph(`<w:pStyle w:val="${styleId}"/>`, runs, allBookmarks);
  };

  const renderTableBlock = (
    table: TableNode,
    rels: RelRegistry,
    inNote: boolean,
    extraBookmarks: string[] = [],
    recordHint = true,
  ): string => {
    if (!inNote) counts.tables++;
    const tableBm =
      (table.attrs.nodeId && nodeIdToBookmark.get(table.attrs.nodeId)) ||
      (recordHint ? bookmarks.allocateName(`tbl_${blockHints.length + 1}`) : undefined);

    // Determine column count across all rows (respecting colspan and active rowspans).
    let maxCols = 0;
    const spanOccupancy: number[] = [];
    for (const row of table.content) {
      let col = 0;
      for (const cell of row.content) {
        while ((spanOccupancy[col] ?? 0) > 0) col++;
        const cs = Math.max(1, cell.attrs.colspan ?? 1);
        const rs = Math.max(1, cell.attrs.rowspan ?? 1);
        for (let k = 0; k < cs; k++) {
          spanOccupancy[col + k] = Math.max(spanOccupancy[col + k] ?? 0, rs);
        }
        col += cs;
      }
      while (col < spanOccupancy.length && (spanOccupancy[col] ?? 0) > 0) col++;
      if (col > maxCols) maxCols = col;
      for (let c = 0; c < spanOccupancy.length; c++) {
        if (spanOccupancy[c]! > 0) spanOccupancy[c] = spanOccupancy[c]! - 1;
      }
    }
    maxCols = Math.max(1, maxCols);

    const contentWidthTwips = Math.max(1440, geom.widthTwips - geom.marginTwips * 2);
    const colWidthTwips = Math.max(360, Math.floor(contentWidthTwips / maxCols));
    const gridCols = Array.from(
      { length: maxCols },
      () => `<w:gridCol w:w="${colWidthTwips}"/>`,
    ).join('');

    const tableAttrsHint: DocxTableAttrsHint = {
      ...(table.attrs.id ? { id: table.attrs.id } : {}),
      ...(table.attrs.style ? { style: table.attrs.style } : {}),
      rows: [],
    };
    const cellTextSamples: string[] = [];

    // Emit rows with accurate `w:vMerge` continuation cells for vertical spans.
    const activeVSpans: Array<{ remaining: number; colspan: number }> = [];
    let firstCellBookmarksAttached = false;
    const rowXmls: string[] = [];

    for (const row of table.content) {
      const isHeaderRow = row.content.length > 0 && row.content.every((c) => c.type === 'th');
      const rowHintCells: NonNullable<NonNullable<DocxTableAttrsHint['rows']>[number]['cells']> =
        [];
      const cellsXml: string[] = [];

      let col = 0;
      const emitContinuations = (): void => {
        while (col < activeVSpans.length && activeVSpans[col] && activeVSpans[col]!.remaining > 0) {
          const span = activeVSpans[col]!;
          const cs = span.colspan;
          const tcPr =
            `<w:tcPr>` +
            `<w:tcW w:w="${colWidthTwips * cs}" w:type="dxa"/>` +
            (cs > 1 ? `<w:gridSpan w:val="${cs}"/>` : '') +
            `<w:vMerge/>` +
            `</w:tcPr>`;
          cellsXml.push(`<w:tc>${tcPr}<w:p/></w:tc>`);
          for (let k = 0; k < cs; k++) {
            if (activeVSpans[col + k]) activeVSpans[col + k]!.remaining--;
          }
          col += cs;
        }
      };

      for (const cell of row.content) {
        emitContinuations();
        const cs = Math.max(1, cell.attrs.colspan ?? 1);
        const rs = Math.max(1, cell.attrs.rowspan ?? 1);
        if (rs > 1) {
          for (let k = 0; k < cs; k++) {
            activeVSpans[col + k] = { remaining: rs - 1, colspan: k === 0 ? cs : 0 };
          }
        }
        const align = cell.attrs.align ?? row.attrs.align;
        const jcVal =
          align === 'center'
            ? 'center'
            : align === 'right'
              ? 'right'
              : align === 'left'
                ? 'left'
                : undefined;
        const valign = cell.attrs.valign;
        const vAlignVal =
          valign === 'middle'
            ? 'center'
            : valign === 'bottom'
              ? 'bottom'
              : valign === 'top'
                ? 'top'
                : undefined;

        const tcPrParts: string[] = [`<w:tcW w:w="${colWidthTwips * cs}" w:type="dxa"/>`];
        if (cs > 1) tcPrParts.push(`<w:gridSpan w:val="${cs}"/>`);
        if (rs > 1) tcPrParts.push('<w:vMerge w:val="restart"/>');
        if (cell.type === 'th') {
          tcPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
        }
        if (vAlignVal) tcPrParts.push(`<w:vAlign w:val="${vAlignVal}"/>`);

        const pPrParts: string[] = [
          `<w:pStyle w:val="${cell.type === 'th' ? 'MfbeTableHeader' : 'MfbeTableCell'}"/>`,
        ];
        if (jcVal) pPrParts.push(`<w:jc w:val="${jcVal}"/>`);

        const cellBookmarks: string[] = [];
        if (!firstCellBookmarksAttached) {
          cellBookmarks.push(...extraBookmarks);
          if (tableBm) cellBookmarks.push(tableBm);
          firstCellBookmarksAttached = true;
        }
        if (cell.attrs.nodeId && nodeIdToBookmark.has(cell.attrs.nodeId)) {
          cellBookmarks.push(nodeIdToBookmark.get(cell.attrs.nodeId)!);
        }

        const runs = renderInlineNodes(cell.content, rels, undefined, inNote);
        cellTextSamples.push(inlinePlainText(cell.content));
        rowHintCells.push({
          ...(cell.type === 'th' ? { header: true } : {}),
          ...(cell.attrs.align ? { align: cell.attrs.align } : {}),
          ...(cell.attrs.valign ? { valign: cell.attrs.valign } : {}),
          ...(cell.attrs.id ? { id: cell.attrs.id } : {}),
          ...(cell.attrs.style ? { style: cell.attrs.style } : {}),
        });

        cellsXml.push(
          `<w:tc><w:tcPr>${tcPrParts.join('')}</w:tcPr>${wrapParagraph(pPrParts.join(''), runs, cellBookmarks)}</w:tc>`,
        );
        col += cs;
      }
      emitContinuations();

      tableAttrsHint.rows!.push({
        ...(row.attrs.align ? { align: row.attrs.align } : {}),
        cells: rowHintCells,
      });
      const trPr = isHeaderRow ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
      rowXmls.push(`<w:tr>${trPr}${cellsXml.join('')}</w:tr>`);
    }

    if (recordHint && tableBm && !inNote) {
      blockHints.push({
        bookmark: tableBm,
        fingerprint: blockFingerprint(cellTextSamples.join(' | ')),
        kind: 'table',
        ...(table.attrs.id ? { id: table.attrs.id } : {}),
        ...(table.attrs.style ? { style: table.attrs.style } : {}),
        tableAttrs: tableAttrsHint,
      });
    }

    const tblBorders =
      `<w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>` +
      `<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>` +
      `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>` +
      `<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>` +
      `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>` +
      `</w:tblBorders>`;
    const tblCellMar =
      `<w:tblCellMar>` +
      `<w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>` +
      `<w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/>` +
      `</w:tblCellMar>`;

    return (
      `<w:tbl>` +
      `<w:tblPr><w:tblW w:w="${contentWidthTwips}" w:type="dxa"/>${tblBorders}${tblCellMar}</w:tblPr>` +
      `<w:tblGrid>${gridCols}</w:tblGrid>` +
      `${rowXmls.join('')}` +
      `</w:tbl>`
    );
  };

  const renderBlockImage = (
    img: ImageNode,
    rels: RelRegistry,
    inNote: boolean,
    extraBookmarks: string[] = [],
  ): string => {
    const run = renderImageRun(
      img.attrs.href,
      img.attrs.alt,
      img.attrs.title,
      img.attrs.id,
      rels,
      geom.contentWidthEmu,
      Math.round(geom.contentHeightEmu * 0.85),
      inNote,
    );
    if (!run) return '';
    const bmList = [...extraBookmarks];
    if (img.attrs.nodeId && nodeIdToBookmark.has(img.attrs.nodeId)) {
      bmList.push(nodeIdToBookmark.get(img.attrs.nodeId)!);
    }
    const parts = [
      wrapParagraph('<w:pStyle w:val="MfbeImage"/><w:jc w:val="center"/>', run, bmList),
    ];
    if (img.attrs.title) {
      const capText = sanitizeText(img.attrs.title, controlCounter);
      parts.push(
        wrapParagraph(
          '<w:pStyle w:val="MfbeCaption"/>',
          `<w:r><w:t xml:space="preserve">${escapeXmlText(capText)}</w:t></w:r>`,
        ),
      );
    }
    return parts.join('');
  };

  const renderEpigraph = (
    ep: EpigraphNode,
    rels: RelRegistry,
    inNote: boolean,
    pendingBookmarks: string[],
    recordHint: boolean,
  ): string => {
    const gid = `ep_${groupCounter++}`;
    const out: string[] = [];
    let pending = [...pendingBookmarks];
    if (ep.attrs.nodeId && nodeIdToBookmark.has(ep.attrs.nodeId)) {
      pending.push(nodeIdToBookmark.get(ep.attrs.nodeId)!);
    }
    for (const child of ep.content) {
      if (child.type === 'p') {
        out.push(
          renderParagraphBlock(
            child,
            'epigraph',
            'MfbeEpigraph',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'text-author') {
        out.push(
          renderParagraphBlock(
            child,
            'text-author',
            'MfbeTextAuthor',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'empty-line') {
        out.push(renderEmptyLine(pending, recordHint, inNote, gid));
        pending = [];
      } else if (child.type === 'poem') {
        out.push(renderPoem(child, rels, inNote, pending, recordHint, gid));
        pending = [];
      } else if (child.type === 'cite') {
        out.push(renderCite(child, rels, inNote, pending, recordHint));
        pending = [];
      }
    }
    return out.join('');
  };

  const renderEmptyLine = (
    extraBookmarks: string[],
    recordHint: boolean,
    inNote: boolean,
    groupId?: string,
  ): string => {
    const bm = recordHint ? bookmarks.allocateName(`el_${blockHints.length + 1}`) : undefined;
    if (recordHint && bm && !inNote) {
      blockHints.push({
        bookmark: bm,
        fingerprint: '',
        kind: 'empty-line',
        ...(groupId ? { groupId } : {}),
      });
    }
    return wrapParagraph('<w:pStyle w:val="MfbeEmptyLine"/>', '', [
      ...extraBookmarks,
      ...(bm ? [bm] : []),
    ]);
  };

  const renderPoem = (
    poem: PoemNode,
    rels: RelRegistry,
    inNote: boolean,
    pendingBookmarks: string[],
    recordHint: boolean,
    parentGroupId?: string,
  ): string => {
    const gid = parentGroupId
      ? `${parentGroupId}:poem_${groupCounter++}`
      : `poem_${groupCounter++}`;
    const out: string[] = [];
    let pending = [...pendingBookmarks];
    if (poem.attrs.nodeId && nodeIdToBookmark.has(poem.attrs.nodeId)) {
      pending.push(nodeIdToBookmark.get(poem.attrs.nodeId)!);
    }
    for (const child of poem.content) {
      if (child.type === 'title') {
        for (const tp of child.content) {
          if (tp.type === 'p') {
            out.push(
              renderParagraphBlock(
                tp,
                'poem',
                'MfbePoemTitle',
                rels,
                inNote,
                gid,
                pending,
                recordHint,
              ),
            );
            pending = [];
          }
        }
      } else if (child.type === 'epigraph') {
        out.push(renderEpigraph(child, rels, inNote, pending, recordHint));
        pending = [];
      } else if (child.type === 'subtitle') {
        out.push(
          renderParagraphBlock(
            child,
            'subtitle',
            'MfbeSubtitle',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'stanza') {
        const sgid = `${gid}:st_${groupCounter++}`;
        for (const sc of child.content) {
          if (sc.type === 'title') {
            for (const tp of sc.content) {
              if (tp.type === 'p') {
                out.push(
                  renderParagraphBlock(
                    tp,
                    'stanza',
                    'MfbePoemTitle',
                    rels,
                    inNote,
                    sgid,
                    pending,
                    recordHint,
                  ),
                );
                pending = [];
              }
            }
          } else if (sc.type === 'subtitle') {
            out.push(
              renderParagraphBlock(
                sc,
                'subtitle',
                'MfbeSubtitle',
                rels,
                inNote,
                sgid,
                pending,
                recordHint,
              ),
            );
            pending = [];
          } else if (sc.type === 'v') {
            out.push(
              renderParagraphBlock(sc, 'v', 'MfbeVerse', rels, inNote, sgid, pending, recordHint),
            );
            pending = [];
          }
        }
      } else if (child.type === 'text-author') {
        out.push(
          renderParagraphBlock(
            child,
            'text-author',
            'MfbeTextAuthor',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'date') {
        out.push(renderDateBlock(child, pending, recordHint, inNote, gid));
        pending = [];
      }
    }
    return out.join('');
  };

  const renderDateBlock = (
    dateNode: DateNode,
    pendingBookmarks: string[],
    recordHint: boolean,
    inNote: boolean,
    groupId?: string,
  ): string => {
    const text = sanitizeText((dateNode.content ?? []).map((t) => t.text).join(''), controlCounter);
    const bm = recordHint ? bookmarks.allocateName(`dt_${blockHints.length + 1}`) : undefined;
    if (recordHint && bm && !inNote) {
      blockHints.push({
        bookmark: bm,
        fingerprint: blockFingerprint(text),
        kind: 'date',
        ...(dateNode.attrs.value ? { dateValue: dateNode.attrs.value } : {}),
        ...(dateNode.attrs.lang ? { lang: dateNode.attrs.lang } : {}),
        ...(groupId ? { groupId } : {}),
      });
    }
    return wrapParagraph(
      '<w:pStyle w:val="MfbeDate"/>',
      `<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`,
      [...pendingBookmarks, ...(bm ? [bm] : [])],
    );
  };

  const renderCite = (
    cite: CiteNode,
    rels: RelRegistry,
    inNote: boolean,
    pendingBookmarks: string[],
    recordHint: boolean,
  ): string => {
    const gid = `cite_${groupCounter++}`;
    const out: string[] = [];
    let pending = [...pendingBookmarks];
    if (cite.attrs.nodeId && nodeIdToBookmark.has(cite.attrs.nodeId)) {
      pending.push(nodeIdToBookmark.get(cite.attrs.nodeId)!);
    }
    for (const child of cite.content) {
      if (child.type === 'p') {
        out.push(
          renderParagraphBlock(child, 'cite', 'Quote', rels, inNote, gid, pending, recordHint),
        );
        pending = [];
      } else if (child.type === 'subtitle') {
        out.push(
          renderParagraphBlock(
            child,
            'subtitle',
            'MfbeSubtitle',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'text-author') {
        out.push(
          renderParagraphBlock(
            child,
            'text-author',
            'MfbeTextAuthor',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'empty-line') {
        out.push(renderEmptyLine(pending, recordHint, inNote, gid));
        pending = [];
      } else if (child.type === 'poem') {
        out.push(renderPoem(child, rels, inNote, pending, recordHint, gid));
        pending = [];
      } else if (child.type === 'table') {
        out.push(renderTableBlock(child, rels, inNote, pending, recordHint));
        pending = [];
      }
    }
    return out.join('');
  };

  const renderAnnotationBlocks = (
    annot: AnnotationNode,
    rels: RelRegistry,
    inNote: boolean,
    defaultStyle: string,
    kind: DocxBlockKind,
    pendingBookmarks: string[],
    recordHint: boolean,
  ): string => {
    const gid = kind === 'section-annotation' ? `sann_${groupCounter++}` : undefined;
    const out: string[] = [];
    let pending = [...pendingBookmarks];
    for (const child of annot.content) {
      if (child.type === 'p') {
        out.push(
          renderParagraphBlock(child, kind, defaultStyle, rels, inNote, gid, pending, recordHint),
        );
        pending = [];
      } else if (child.type === 'subtitle') {
        out.push(
          renderParagraphBlock(
            child,
            'subtitle',
            'MfbeSubtitle',
            rels,
            inNote,
            gid,
            pending,
            recordHint,
          ),
        );
        pending = [];
      } else if (child.type === 'empty-line') {
        out.push(renderEmptyLine(pending, recordHint, inNote, gid));
        pending = [];
      } else if (child.type === 'poem') {
        out.push(renderPoem(child, rels, inNote, pending, recordHint, gid));
        pending = [];
      } else if (child.type === 'cite') {
        out.push(renderCite(child, rels, inNote, pending, recordHint));
        pending = [];
      } else if (child.type === 'table') {
        out.push(renderTableBlock(child, rels, inNote, pending, recordHint));
        pending = [];
      }
    }
    return out.join('');
  };

  const renderBlockNode = (
    node: BlockNode,
    rels: RelRegistry,
    inNote: boolean,
    pendingBookmarks: string[],
    recordHint: boolean,
  ): string => {
    switch (node.type) {
      case 'p':
        return renderParagraphBlock(
          node,
          'p',
          'Normal',
          rels,
          inNote,
          undefined,
          pendingBookmarks,
          recordHint,
        );
      case 'subtitle':
        return renderParagraphBlock(
          node,
          'subtitle',
          'MfbeSubtitle',
          rels,
          inNote,
          undefined,
          pendingBookmarks,
          recordHint,
        );
      case 'empty-line':
        return renderEmptyLine(pendingBookmarks, recordHint, inNote);
      case 'poem':
        return renderPoem(node, rels, inNote, pendingBookmarks, recordHint);
      case 'cite':
        return renderCite(node, rels, inNote, pendingBookmarks, recordHint);
      case 'table':
        return renderTableBlock(node, rels, inNote, pendingBookmarks, recordHint);
      case 'image':
        return renderBlockImage(node, rels, inNote, pendingBookmarks);
      case 'raw-xml': {
        const text = sanitizeText(node.attrs.xml.replace(/<[^>]*>/g, ''), controlCounter).trim();
        if (!text) return '';
        return wrapParagraph(
          '<w:pStyle w:val="Normal"/>',
          `<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`,
          pendingBookmarks,
        );
      }
    }
  };

  // Implementation of native Word footnote/endnote emitter.
  noteRenderer.fn = (entry: LeafNoteEntry): number => {
    const id = nextNoteId++;
    referencedNoteSectionIds.add(entry.sectionId);
    counts.notes++;
    noteHints.push({
      docxNoteId: id,
      bodyName: entry.bodyName,
      ...(entry.groupPath.length > 0 ? { groupPath: entry.groupPath } : {}),
      sectionId: entry.sectionId,
      ...(entry.label ? { label: entry.label } : {}),
      unreferenced: false,
    });

    const isEndnote = settings.notesPlacement === 'endnotes';
    const refStyle = isEndnote ? 'EndnoteReference' : 'FootnoteReference';
    const noteStyle = isEndnote ? 'EndnoteText' : 'FootnoteText';
    const selfRef = isEndnote ? '<w:endnoteRef/>' : '<w:footnoteRef/>';
    const prefixRun = `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr>${selfRef}</w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`;

    const noteParas: string[] = [];
    let prependedRef = false;
    const pushNoteBlock = (xml: string): void => {
      if (!xml) return;
      if (!prependedRef && xml.startsWith('<w:p>')) {
        prependedRef = true;
        const pPrEnd = xml.indexOf('</w:pPr>');
        if (pPrEnd >= 0) {
          noteParas.push(xml.slice(0, pPrEnd + 8) + prefixRun + xml.slice(pPrEnd + 8));
          return;
        }
        noteParas.push('<w:p>' + prefixRun + xml.slice(5));
        return;
      }
      noteParas.push(xml);
    };

    for (const child of entry.section.content) {
      if (child.type === 'title') continue; // Word numbers footnotes automatically; label stored in hint.
      if (child.type === 'p') {
        const runs = renderInlineNodes(child.content, notesRels, undefined, true);
        pushNoteBlock(wrapParagraph(`<w:pStyle w:val="${noteStyle}"/>`, runs));
      } else if (child.type === 'epigraph') {
        pushNoteBlock(renderEpigraph(child, notesRels, true, [], false));
      } else if (child.type === 'annotation') {
        pushNoteBlock(
          renderAnnotationBlocks(
            child,
            notesRels,
            true,
            noteStyle,
            'section-annotation',
            [],
            false,
          ),
        );
      } else if (child.type !== 'section') {
        pushNoteBlock(renderBlockNode(child, notesRels, true, [], false));
      }
    }
    if (noteParas.length === 0) {
      noteParas.push(
        wrapParagraph(
          `<w:pStyle w:val="${noteStyle}"/>`,
          prefixRun +
            `<w:r><w:t xml:space="preserve">${escapeXmlText(entry.label || '')}</w:t></w:r>`,
        ),
      );
    } else if (!prependedRef) {
      noteParas.unshift(wrapParagraph(`<w:pStyle w:val="${noteStyle}"/>`, prefixRun));
    }

    const tag = isEndnote ? 'w:endnote' : 'w:footnote';
    renderedWordNotes.push({
      id,
      xml: `<${tag} w:id="${id}">${noteParas.join('')}</${tag}>`,
    });
    return id;
  };

  // --- Front Matter: Cover page & Title page ---
  const frontMatterXml: string[] = [];

  const firstCoverRef = titleInfo.coverpage[0];
  let coverBinaryId: string | undefined;
  let coverSha256: string | undefined;
  if (firstCoverRef?.href?.startsWith('#')) {
    const id = firstCoverRef.href.slice(1);
    const pic = pictures.get(id);
    if (pic) {
      coverBinaryId = id;
      coverSha256 = pic.sha256;
      const covBm = bookmarks.allocateName('mfbe_fm_cover');
      frontMatter.coverBookmark = covBm;
      const run = renderImageRun(
        firstCoverRef.href,
        firstCoverRef.alt,
        firstCoverRef.title,
        firstCoverRef.id,
        docRels,
        geom.contentWidthEmu,
        Math.round(geom.contentHeightEmu * 0.92),
        false,
      );
      if (run) {
        frontMatterXml.push(
          wrapParagraph('<w:pStyle w:val="MfbeCover"/><w:jc w:val="center"/>', run, [covBm]),
        );
      }
    }
  }

  const authors = titleInfo.authors.map(personDisplayName).filter((n) => n.length > 0);
  const translators = titleInfo.translators.map(personDisplayName).filter((n) => n.length > 0);
  const flatSeqs = flattenSequences(titleInfo.sequences).filter((s) => s.name.trim().length > 0);
  const imprintLine = [publishInfo?.publisher, publishInfo?.city, publishInfo?.year]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join(', ');
  const hasTitlePage =
    Boolean(rawTitle) || authors.length > 0 || flatSeqs.length > 0 || Boolean(imprintLine);

  if (hasTitlePage) {
    if (frontMatterXml.length > 0) {
      frontMatterXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
    const titleStartBm = bookmarks.allocateName('mfbe_fm_title_s');
    const titleEndBm = bookmarks.allocateName('mfbe_fm_title_e');
    frontMatter.titleStartBookmark = titleStartBm;
    frontMatter.titleEndBookmark = titleEndBm;

    const titleParas: Array<{ style: string; text: string }> = [];
    if (authors.length > 0) {
      titleParas.push({ style: 'MfbeTitleAuthor', text: authors.join(', ') });
    }
    titleParas.push({ style: 'Title', text: sanitizeText(bookTitle, controlCounter) });
    for (const seq of flatSeqs) {
      const seqText =
        seq.number !== undefined ? `${seq.name.trim()} #${seq.number}` : seq.name.trim();
      titleParas.push({ style: 'Subtitle', text: sanitizeText(seqText, controlCounter) });
    }
    if (translators.length > 0) {
      titleParas.push({ style: 'MfbeTitleMeta', text: translators.join(', ') });
    }
    if (imprintLine) {
      titleParas.push({
        style: 'MfbeTitleImprint',
        text: sanitizeText(imprintLine, controlCounter),
      });
    }
    titleParas.forEach((tp, idx) => {
      const bms: string[] = [];
      if (idx === 0) bms.push(titleStartBm);
      if (idx === titleParas.length - 1) bms.push(titleEndBm);
      frontMatterXml.push(
        wrapParagraph(
          `<w:pStyle w:val="${tp.style}"/>`,
          `<w:r><w:t xml:space="preserve">${escapeXmlText(tp.text)}</w:t></w:r>`,
          bms,
        ),
      );
    });
  }

  // Section break after front matter (no footer on cover/title pages!).
  const sectPgSz = `<w:pgSz w:w="${geom.widthTwips}" w:h="${geom.heightTwips}"/>`;
  const sectPgMar = `<w:pgMar w:top="${geom.marginTwips}" w:right="${geom.marginTwips}" w:bottom="${geom.marginTwips}" w:left="${geom.marginTwips}" w:header="720" w:footer="720" w:gutter="0"/>`;
  if (frontMatterXml.length > 0) {
    frontMatterXml.push(`<w:p><w:pPr><w:sectPr>${sectPgSz}${sectPgMar}</w:sectPr></w:pPr></w:p>`);
  }

  // --- Body Section: Annotation ---
  const annotationXml: string[] = [];
  if (titleInfo.annotation && titleInfo.annotation.content.length > 0) {
    const annStartBm = bookmarks.allocateName('mfbe_fm_annot_s');
    const annEndBm = bookmarks.allocateName('mfbe_fm_annot_e');
    frontMatter.annotationStartBookmark = annStartBm;
    frontMatter.annotationEndBookmark = annEndBm;
    annotationXml.push(
      wrapParagraph(
        '<w:pStyle w:val="MfbeFrontHeading"/>',
        `<w:r><w:t xml:space="preserve">${escapeXmlText(words.annotation)}</w:t></w:r>`,
        [annStartBm],
      ),
    );
    annotationXml.push(
      renderAnnotationBlocks(
        titleInfo.annotation,
        docRels,
        false,
        'MfbeAnnotation',
        'p',
        [],
        false,
      ),
    );
    annotationXml.push(wrapParagraph('<w:pStyle w:val="MfbeEmptyLine"/>', '', [annEndBm]));
  }

  // --- Render Main & Further Bodies (recording TOC entries & hints) ---
  const bodiesXml: string[] = [];

  const renderSection = (
    sec: SectionNode,
    depth: number,
    bodyIndex: number,
    pendingBookmarks: string[],
  ): void => {
    counts.sections++;
    const clampedLevel = Math.max(1, Math.min(6, depth));
    const secBm =
      (sec.attrs.nodeId && nodeIdToBookmark.get(sec.attrs.nodeId)) ||
      bookmarks.allocateName(`sec_${sectionHints.length + 1}`);
    const titleNode = sec.content.find((c): c is TitleNode => c.type === 'title');
    const titleText = titlePlainText(titleNode);
    const hasEpigraph = sec.content.some((c) => c.type === 'epigraph');
    const hasAnnotation = sec.content.some((c) => c.type === 'annotation');

    sectionHints.push({
      bookmark: secBm,
      depth,
      ...(sec.attrs.id ? { id: sec.attrs.id } : {}),
      ...(sec.attrs.lang ? { lang: sec.attrs.lang } : {}),
      ...(titleNode ? {} : { untitled: true }),
      bodyIndex,
      ...(hasEpigraph ? { hasEpigraph: true } : {}),
      ...(hasAnnotation ? { hasAnnotation: true } : {}),
    });

    let pending = [...pendingBookmarks, secBm];

    if (titleNode) {
      if (titleText) {
        tocEntries.push({
          title: sanitizeText(titleText, controlCounter),
          bookmark: secBm,
          level: clampedLevel,
        });
      }
      // Render multi-paragraph titles in a single Heading paragraph separated by `<w:br/>` so
      // Word's native TOC creates a single clean entry per section.
      const runChunks: string[] = [];
      let lineIdx = 0;
      for (const child of titleNode.content) {
        if (child.type === 'p') {
          if (lineIdx > 0) runChunks.push('<w:r><w:br/></w:r>');
          runChunks.push(renderInlineNodes(child.content, docRels, undefined, false));
          lineIdx++;
        } else if (child.type === 'empty-line' && lineIdx > 0) {
          runChunks.push('<w:r><w:br/></w:r>');
        }
      }
      bodiesXml.push(
        wrapParagraph(`<w:pStyle w:val="Heading${clampedLevel}"/>`, runChunks.join(''), pending),
      );
      pending = [];
    }

    for (const child of sec.content) {
      if (child.type === 'title') continue;
      if (child.type === 'epigraph') {
        bodiesXml.push(renderEpigraph(child, docRels, false, pending, true));
        pending = [];
      } else if (child.type === 'image') {
        const xml = renderBlockImage(child, docRels, false, pending);
        if (xml) {
          bodiesXml.push(xml);
          pending = [];
        }
      } else if (child.type === 'annotation') {
        bodiesXml.push(
          renderAnnotationBlocks(
            child,
            docRels,
            false,
            'MfbeAnnotation',
            'section-annotation',
            pending,
            true,
          ),
        );
        pending = [];
      } else if (child.type === 'section') {
        renderSection(child, depth + 1, bodyIndex, pending);
        pending = [];
      } else {
        const xml = renderBlockNode(child, docRels, false, pending, true);
        if (xml) {
          bodiesXml.push(xml);
          pending = [];
        }
      }
    }

    // Ensure an empty untitled section still carries its bookmark anchor.
    if (pending.length > 0) {
      bodiesXml.push(wrapParagraph('<w:pStyle w:val="Normal"/>', '', pending));
    }
  };

  const renderStoryBody = (bodyIndex: number, isMain: boolean): void => {
    const body = document.bodies[bodyIndex]!;
    const bodyBm = bookmarks.allocateName(`mfbe_b_${bodyIndex}`);
    const bodyTitleNode = body.content.find((c): c is TitleNode => c.type === 'title');
    const bodyTitleLines = bodyTitleNode
      ? bodyTitleNode.content
          .filter((c): c is ParagraphNode => c.type === 'p')
          .map((p) => inlinePlainText(p.content))
      : undefined;

    bodyHints.push({
      ...(body.attrs.name ? { name: body.attrs.name } : {}),
      ...(body.attrs.lang ? { lang: body.attrs.lang } : {}),
      startBookmark: bodyBm,
      ...(bodyTitleLines && bodyTitleLines.length > 0 ? { title: bodyTitleLines } : {}),
    });

    let pending: string[] = [bodyBm];
    if (!isMain && bodiesXml.length > 0) {
      bodiesXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }

    let leadingImageChecked = false;
    for (const child of body.content) {
      if (child.type === 'image') {
        // Exact-match duplicate leading cover suppression (Clarify Pass 2 Q2): skip ONLY when
        // main body's leading image matches coverpage by binary ID or identical SHA-256 bytes.
        if (isMain && !leadingImageChecked && coverBinaryId && child.attrs.href.startsWith('#')) {
          leadingImageChecked = true;
          const leadId = child.attrs.href.slice(1);
          const leadPic = pictures.get(leadId);
          if (leadId === coverBinaryId || (coverSha256 && leadPic?.sha256 === coverSha256)) {
            skippedLeadingCover = {
              binaryId: leadId,
              ...(child.attrs.alt ? { alt: child.attrs.alt } : {}),
              ...(child.attrs.title ? { title: child.attrs.title } : {}),
              ...(child.attrs.id ? { id: child.attrs.id } : {}),
            };
            continue;
          }
        }
        leadingImageChecked = true;
        const xml = renderBlockImage(child, docRels, false, pending);
        if (xml) {
          bodiesXml.push(xml);
          pending = [];
        }
      } else if (child.type === 'title') {
        leadingImageChecked = true;
        const text = titlePlainText(child);
        if (!isMain && text) {
          tocEntries.push({
            title: sanitizeText(text, controlCounter),
            bookmark: bodyBm,
            level: 1,
          });
        }
        const runChunks: string[] = [];
        let lineIdx = 0;
        for (const tc of child.content) {
          if (tc.type === 'p') {
            if (lineIdx > 0) runChunks.push('<w:r><w:br/></w:r>');
            runChunks.push(renderInlineNodes(tc.content, docRels, undefined, false));
            lineIdx++;
          }
        }
        bodiesXml.push(
          wrapParagraph(
            `<w:pStyle w:val="${isMain ? 'MfbeBodyTitle' : 'Heading1'}"/>`,
            runChunks.join(''),
            pending,
          ),
        );
        pending = [];
      } else if (child.type === 'epigraph') {
        leadingImageChecked = true;
        bodiesXml.push(renderEpigraph(child, docRels, false, pending, true));
        pending = [];
      } else if (child.type === 'section') {
        leadingImageChecked = true;
        renderSection(child, 1, bodyIndex, pending);
        pending = [];
      }
    }
    if (pending.length > 0) {
      bodiesXml.push(wrapParagraph('<w:pStyle w:val="Normal"/>', '', pending));
    }
  };

  if (mainBodyIndex >= 0) {
    renderStoryBody(mainBodyIndex, true);
  }
  for (const idx of furtherBodyIndices) {
    renderStoryBody(idx, false);
  }

  // --- Unreferenced Notes Section (Clarify Pass 2 Q5) ---
  const unreferencedNotes = allLeafNotes.filter((n) => !referencedNoteSectionIds.has(n.sectionId));
  const unrefNotesXml: string[] = [];
  if (unreferencedNotes.length > 0) {
    const unrefBm = bookmarks.allocateName('mfbe_unref_notes');
    tocEntries.push({ title: words.notes, bookmark: unrefBm, level: 1 });
    unrefNotesXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    unrefNotesXml.push(
      wrapParagraph(
        '<w:pStyle w:val="Heading1"/>',
        `<w:r><w:t xml:space="preserve">${escapeXmlText(words.notes)}</w:t></w:r>`,
        [unrefBm],
      ),
    );
    for (const idx of notesBodyIndices) {
      const b = document.bodies[idx]!;
      bodyHints.push({
        name: b.attrs.name || 'notes',
        ...(b.attrs.lang ? { lang: b.attrs.lang } : {}),
        startBookmark: unrefBm,
        isNotes: true,
        unreferencedNotesBookmark: unrefBm,
      });
    }

    for (let i = 0; i < unreferencedNotes.length; i++) {
      const entry = unreferencedNotes[i]!;
      counts.notes++;
      const noteBm =
        (entry.section.attrs.nodeId && nodeIdToBookmark.get(entry.section.attrs.nodeId)) ||
        bookmarks.allocateName(`mfbe_un_${i + 1}`);
      noteHints.push({
        unreferencedBookmark: noteBm,
        bodyName: entry.bodyName,
        ...(entry.groupPath.length > 0 ? { groupPath: entry.groupPath } : {}),
        sectionId: entry.sectionId,
        ...(entry.label ? { label: entry.label } : {}),
        unreferenced: true,
      });

      let pending: string[] = [noteBm];
      if (entry.label) {
        unrefNotesXml.push(
          wrapParagraph(
            '<w:pStyle w:val="MfbeSubtitle"/>',
            `<w:r><w:t xml:space="preserve">${escapeXmlText(sanitizeText(entry.label, controlCounter))}</w:t></w:r>`,
            pending,
          ),
        );
        pending = [];
      }
      for (const child of entry.section.content) {
        if (child.type === 'title' || child.type === 'section') continue;
        if (child.type === 'epigraph') {
          unrefNotesXml.push(renderEpigraph(child, docRels, false, pending, false));
          pending = [];
        } else if (child.type === 'annotation') {
          unrefNotesXml.push(
            renderAnnotationBlocks(
              child,
              docRels,
              false,
              'MfbeAnnotation',
              'section-annotation',
              pending,
              false,
            ),
          );
          pending = [];
        } else {
          const xml = renderBlockNode(child, docRels, false, pending, false);
          if (xml) {
            unrefNotesXml.push(xml);
            pending = [];
          }
        }
      }
      if (pending.length > 0) {
        unrefNotesXml.push(wrapParagraph('<w:pStyle w:val="Normal"/>', '', pending));
      }
    }
  } else {
    for (const idx of notesBodyIndices) {
      const b = document.bodies[idx]!;
      bodyHints.push({
        name: b.attrs.name || 'notes',
        ...(b.attrs.lang ? { lang: b.attrs.lang } : {}),
        startBookmark: bookmarks.allocateName(`mfbe_nb_${idx}`),
        isNotes: true,
      });
    }
  }

  // --- Pre-Populated Native Word TOC (zero `w:updateFields` startup popup!) ---
  const buildTocXml = (): string => {
    if (settings.tocPlacement === 'none' || tocEntries.length === 0) return '';
    const tocStartBm = bookmarks.allocateName('mfbe_fm_toc_s');
    const tocEndBm = bookmarks.allocateName('mfbe_fm_toc_e');
    frontMatter.tocStartBookmark = tocStartBm;
    frontMatter.tocEndBookmark = tocEndBm;

    const sdtParts: string[] = [];
    sdtParts.push(
      wrapParagraph(
        '<w:pStyle w:val="MfbeFrontHeading"/>',
        `<w:r><w:t xml:space="preserve">${escapeXmlText(words.contents)}</w:t></w:r>`,
        [tocStartBm],
      ),
    );
    // Open native TOC field & immediately separate to pre-populated clickable hyperlinks.
    sdtParts.push(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-6" \\h \\z \\u </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>',
    );
    for (const entry of tocEntries) {
      const tocStyle = `TOC${Math.max(1, Math.min(6, entry.level))}`;
      sdtParts.push(
        `<w:p><w:pPr><w:pStyle w:val="${tocStyle}"/></w:pPr>` +
          `<w:hyperlink w:anchor="${escapeXmlAttr(entry.bookmark)}">` +
          `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>` +
          `<w:t xml:space="preserve">${escapeXmlText(entry.title)}</w:t></w:r>` +
          `</w:hyperlink></w:p>`,
      );
    }
    sdtParts.push(wrapParagraph('', '<w:r><w:fldChar w:fldCharType="end"/></w:r>', [tocEndBm]));

    const leadBreak =
      settings.tocPlacement === 'end' ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '';
    const trailBreak =
      settings.tocPlacement === 'afterTitle' ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '';
    return (
      leadBreak +
      `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr>` +
      `<w:sdtContent>${sdtParts.join('')}</w:sdtContent></w:sdt>` +
      trailBreak
    );
  };
  const tocXml = buildTocXml();

  // --- Revision History Colophon ---
  const colophonXml: string[] = [];
  if (docInfo.history && docInfo.history.content.length > 0) {
    const colStartBm = bookmarks.allocateName('mfbe_fm_col_s');
    const colEndBm = bookmarks.allocateName('mfbe_fm_col_e');
    frontMatter.colophonStartBookmark = colStartBm;
    frontMatter.colophonEndBookmark = colEndBm;
    colophonXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    colophonXml.push(
      wrapParagraph(
        '<w:pStyle w:val="MfbeFrontHeading"/>',
        `<w:r><w:t xml:space="preserve">${escapeXmlText(words.history)}</w:t></w:r>`,
        [colStartBm],
      ),
    );
    if (docInfo.version?.trim()) {
      colophonXml.push(
        wrapParagraph(
          '<w:pStyle w:val="MfbeTitleMeta"/>',
          `<w:r><w:t xml:space="preserve">${escapeXmlText(`${words.version} ${docInfo.version.trim()}`)}</w:t></w:r>`,
        ),
      );
    }
    colophonXml.push(
      renderAnnotationBlocks(docInfo.history, docRels, false, 'Normal', 'p', [], false),
    );
    colophonXml.push(wrapParagraph('<w:pStyle w:val="MfbeEmptyLine"/>', '', [colEndBm]));
  }

  // Register footnotes.xml or endnotes.xml relationship if any referenced note exists.
  const hasWordNotes = renderedWordNotes.length > 0;
  const isEndnotes = settings.notesPlacement === 'endnotes';
  if (hasWordNotes) {
    if (isEndnotes) {
      docRels.add(REL_ENDNOTES, 'endnotes.xml', false, 'rIdEndnotes');
    } else {
      docRels.add(REL_FOOTNOTES, 'footnotes.xml', false, 'rIdFootnotes');
    }
  }

  // Assemble `word/document.xml`
  const bodyOrder: string[] = [
    ...frontMatterXml,
    ...annotationXml,
    ...(settings.tocPlacement === 'afterTitle' && tocXml ? [tocXml] : []),
    ...bodiesXml,
    ...unrefNotesXml,
    ...(settings.tocPlacement === 'end' && tocXml ? [tocXml] : []),
    ...colophonXml,
  ];
  if (bodyOrder.length === 0) {
    bodyOrder.push('<w:p/>');
  }
  const finalSectPr =
    `<w:sectPr>` +
    `<w:footerReference w:type="default" r:id="rIdFooter1"/>` +
    `${sectPgSz}${sectPgMar}` +
    `<w:pgNumType w:start="1"/>` +
    `</w:sectPr>`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${bodyOrder.join('')}${finalSectPr}</w:body>` +
    `</w:document>`;

  // Assemble `word/footnotes.xml` or `word/endnotes.xml`
  let notesPartName: string | null = null;
  let notesXml = '';
  if (hasWordNotes) {
    notesPartName = isEndnotes ? 'word/endnotes.xml' : 'word/footnotes.xml';
    const rootTag = isEndnotes ? 'w:endnotes' : 'w:footnotes';
    const itemTag = isEndnotes ? 'w:endnote' : 'w:footnote';
    const seps =
      `<${itemTag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></${itemTag}>` +
      `<${itemTag} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></${itemTag}>`;
    notesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<${rootTag} xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
      `${seps}${renderedWordNotes.map((n) => n.xml).join('')}` +
      `</${rootTag}>`;
  }

  // Assemble `word/styles.xml`
  const stylesXml = buildStylesXml(
    fontFamily,
    baseHalfPt,
    mappedCss.wordStylesXml,
    mappedCss.typeOverrides,
  );

  // Assemble `word/settings.xml` (explicitly omits `<w:updateFields/>` so Word shows no popup).
  const settingsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:settings xmlns:w="${W_NS}">` +
    `<w:defaultTabStop w:val="720"/>` +
    `</w:settings>`;

  // Assemble `word/footer1.xml` (centered page number field).
  const footerXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:ftr xmlns:w="${W_NS}">` +
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>1</w:t></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
    `</w:p></w:ftr>`;

  // Assemble `docProps/core.xml` & `docProps/app.xml`
  const genresText = titleInfo.genres
    .map((g) => options.genreNames?.get(g.code.trim()) ?? g.code.trim())
    .filter((s) => s.length > 0)
    .join(', ');
  const descriptionPlain = titleInfo.annotation
    ? sanitizeText(plainTextOfNodes(titleInfo.annotation.content), controlCounter)
    : '';
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coreXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:dcmitype="http://purl.org/dc/dcmitype/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${escapeXmlText(sanitizeText(bookTitle, controlCounter))}</dc:title>` +
    (authors.length > 0
      ? `<dc:creator>${escapeXmlText(sanitizeText(authors.join('; '), controlCounter))}</dc:creator>`
      : '') +
    (descriptionPlain
      ? `<dc:description>${escapeXmlText(descriptionPlain)}</dc:description>`
      : '') +
    (genresText
      ? `<dc:subject>${escapeXmlText(sanitizeText(genresText, controlCounter))}</dc:subject>`
      : '') +
    (titleInfo.keywords?.trim()
      ? `<cp:keywords>${escapeXmlText(sanitizeText(titleInfo.keywords.trim(), controlCounter))}</cp:keywords>`
      : '') +
    (titleInfo.lang?.trim()
      ? `<dc:language>${escapeXmlText(titleInfo.lang.trim())}</dc:language>`
      : '') +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>` +
    `</cp:coreProperties>`;

  const appXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    `<Application>Maxima Fiction Book Editor</Application>` +
    `<AppVersion>${escapeXmlText(options.appVersion || '0.0.16')}</AppVersion>` +
    `</Properties>`;

  // Assemble `_rels/.rels`
  const pkgRels = new RelRegistry();
  pkgRels.add(REL_DOCUMENT, 'word/document.xml', false, 'rId1');
  pkgRels.add(REL_CORE_PROPS, 'docProps/core.xml', false, 'rId2');
  pkgRels.add(REL_APP_PROPS, 'docProps/app.xml', false, 'rId3');

  const docRelsXml = docRels.toXml();
  const notesRelsXml = hasWordNotes && notesRels.size > 0 ? notesRels.toXml() : '';

  // --- Custom XML Reversible Round-Trip Record (T030) ---
  const payload: DocxRoundtripPayload = {
    v: DOCX_ROUNDTRIP_VERSION,
    descriptionXml: serializeFb2DescriptionXml(document.description),
    stylesheets: document.stylesheets.map((s) => ({ type: s.type, text: s.content })),
    frontMatter,
    ...(skippedLeadingCover ? { skippedLeadingCover } : {}),
    pictures: pictureHints,
    bodies: bodyHints,
    sections: sectionHints,
    blocks: blockHints,
    inlineHints,
    notes: noteHints,
    cssStyleMap: mappedCss.cssStyleMap,
  };

  const digests = await computeDocxContentDigests({
    documentXml,
    documentRelsXml: docRelsXml,
    notesXml: hasWordNotes ? notesXml : '',
    notesRelsXml,
    coreXml,
    frontMatter,
  });
  const encodedPayload = await compressPayloadBase64(JSON.stringify(payload));

  const producerLabel = `Maxima Fiction Book Editor ${options.appVersion || '0.0.16'}`.trim();
  const customXmlItem =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<mfbeRecord xmlns="${DOCX_ROUNDTRIP_NAMESPACE}" version="${DOCX_ROUNDTRIP_VERSION}" ` +
    `producer="${escapeXmlAttr(producerLabel)}" ` +
    `bodyDigest="${digests.bodyDigest}" notesDigest="${digests.notesDigest}" propsDigest="${digests.propsDigest}">` +
    `${encodedPayload}</mfbeRecord>`;

  const customXmlProps =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<ds:datastoreItem ds:itemID="${CUSTOM_XML_ITEM_ID}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
    `<ds:schemaRefs><ds:schemaRef ds:uri="${DOCX_ROUNDTRIP_NAMESPACE}"/></ds:schemaRefs>` +
    `</ds:datastoreItem>`;

  const customXmlRels = new RelRegistry();
  customXmlRels.add(REL_CUSTOM_XML_PROPS, 'itemProps1.xml', false, 'rId1');

  // Assemble `[Content_Types].xml`
  const overrides: Array<[string, string]> = [
    [
      '/word/document.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    ],
    [
      '/word/styles.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
    ],
    [
      '/word/settings.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    ],
    [
      '/word/footer1.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
    ],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    [
      '/customXml/itemProps1.xml',
      'application/vnd.openxmlformats-officedocument.customXmlProperties+xml',
    ],
  ];
  if (hasWordNotes && notesPartName) {
    overrides.push([
      `/${notesPartName}`,
      isEndnotes
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
    ]);
  }
  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="${CT_NS}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    overrides
      .map(
        ([partName, ct]) =>
          `<Override PartName="${escapeXmlAttr(partName)}" ContentType="${escapeXmlAttr(ct)}"/>`,
      )
      .join('') +
    `</Types>`;

  if (controlCounter.count > 0) {
    summary.push({
      kind: 'strippedControlChars',
      detail: String(controlCounter.count),
      count: controlCounter.count,
    });
  }

  const parts: DocxXmlPart[] = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: pkgRels.toXml() },
    { name: 'docProps/core.xml', content: coreXml },
    { name: 'docProps/app.xml', content: appXml },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: docRelsXml },
    { name: 'word/styles.xml', content: stylesXml },
    { name: 'word/settings.xml', content: settingsXml },
    { name: 'word/footer1.xml', content: footerXml },
    { name: 'customXml/item1.xml', content: customXmlItem },
    { name: 'customXml/itemProps1.xml', content: customXmlProps },
    { name: 'customXml/_rels/item1.xml.rels', content: customXmlRels.toXml() },
  ];
  if (hasWordNotes && notesPartName) {
    parts.push({ name: notesPartName, content: notesXml });
    if (notesRels.size > 0) {
      const relPath = isEndnotes ? 'word/_rels/endnotes.xml.rels' : 'word/_rels/footnotes.xml.rels';
      parts.push({ name: relPath, content: notesRelsXml });
    }
  }

  return { parts, counts, summary };
}

function buildStylesXml(
  fontFamily: string,
  baseHalfPt: number,
  customWordStylesXml: readonly string[],
  typeOverrides: ReadonlyMap<string, DocxStyleProperties>,
): string {
  const f = escapeXmlAttr(fontFamily);
  const hSizes = [
    Math.round(baseHalfPt * 1.65),
    Math.round(baseHalfPt * 1.4),
    Math.round(baseHalfPt * 1.25),
    Math.round(baseHalfPt * 1.15),
    Math.round(baseHalfPt * 1.08),
    baseHalfPt,
  ];
  const noteHalfPt = Math.max(16, baseHalfPt - 4);
  const titleHalfPt = Math.round(baseHalfPt * 2.0);
  const subtitleHalfPt = Math.round(baseHalfPt * 1.2);

  const mergePPr = (base: string, overrideKey: string): string => {
    const ov = typeOverrides.get(overrideKey);
    return ov ? base + buildParagraphPropsXml(ov) : base;
  };
  const mergeRPr = (base: string, overrideKey: string): string => {
    const ov = typeOverrides.get(overrideKey);
    return ov ? base + buildRunPropsXml(ov, false) : base;
  };

  const headings = hSizes
    .map((sz, i) => {
      const n = i + 1;
      const before = n === 1 ? 360 : n === 2 ? 280 : 200;
      return (
        `<w:style w:type="paragraph" w:styleId="Heading${n}">` +
        `<w:name w:val="heading ${n}"/>` +
        `<w:basedOn w:val="Normal"/>` +
        `<w:next w:val="Normal"/>` +
        `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="${i}"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>` +
        `</w:style>`
      );
    })
    .join('');

  const tocStyles = [1, 2, 3, 4, 5, 6]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="TOC${n}">` +
        `<w:name w:val="toc ${n}"/>` +
        `<w:basedOn w:val="Normal"/>` +
        `<w:pPr><w:spacing w:before="40" w:after="40"/><w:ind w:left="${(n - 1) * 240}" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
        `</w:style>`,
    )
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W_NS}">` +
    `<w:docDefaults>` +
    `<w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>` +
    `<w:sz w:val="${baseHalfPt}"/><w:szCs w:val="${baseHalfPt}"/>` +
    `</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
    `<w:name w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:ind w:firstLine="360"/><w:jc w:val="both"/>', 'p')}</w:pPr>` +
    (typeOverrides.has('p') ? `<w:rPr>${mergeRPr('', 'p')}</w:rPr>` : '') +
    `</w:style>` +
    headings +
    `<w:style w:type="paragraph" w:styleId="Title">` +
    `<w:name w:val="Title"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="480" w:after="200"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${titleHalfPt}"/><w:szCs w:val="${titleHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:styleId="Subtitle">` +
    `<w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="120" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:i/><w:sz w:val="${subtitleHalfPt}"/><w:szCs w:val="${subtitleHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:styleId="Quote">` +
    `<w:name w:val="Quote"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="999999"/></w:pBdr><w:spacing w:before="100" w:after="100"/><w:ind w:left="720" w:right="720" w:firstLine="0"/>', 'cite')}</w:pPr>` +
    `<w:rPr>${mergeRPr('<w:i/>', 'cite')}</w:rPr>` +
    `</w:style>` +
    tocStyles +
    `<w:style w:type="paragraph" w:styleId="FootnoteText">` +
    `<w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
    `<w:rPr><w:sz w:val="${noteHalfPt}"/><w:szCs w:val="${noteHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:styleId="EndnoteText">` +
    `<w:name w:val="endnote text"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
    `<w:rPr><w:sz w:val="${noteHalfPt}"/><w:szCs w:val="${noteHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="character" w:styleId="FootnoteReference">` +
    `<w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="character" w:styleId="EndnoteReference">` +
    `<w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="character" w:styleId="Hyperlink">` +
    `<w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="character" w:styleId="Code">` +
    `<w:name w:val="Code"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeCover">` +
    `<w:name w:val="FB2 Cover"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="0" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeTitleAuthor">` +
    `<w:name w:val="FB2 Title Author"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="1440" w:after="160"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:sz w:val="${subtitleHalfPt}"/><w:szCs w:val="${subtitleHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeTitleMeta">` +
    `<w:name w:val="FB2 Title Meta"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="80" w:after="80"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:i/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeTitleImprint">` +
    `<w:name w:val="FB2 Title Imprint"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="1440" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:sz w:val="${noteHalfPt}"/><w:szCs w:val="${noteHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeFrontHeading">` +
    `<w:name w:val="FB2 Front Heading"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${hSizes[1]}"/><w:szCs w:val="${hSizes[1]}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeBodyTitle">` +
    `<w:name w:val="FB2 Body Title"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${hSizes[0]}"/><w:szCs w:val="${hSizes[0]}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeSubtitle">` +
    `<w:name w:val="FB2 Subtitle"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:keepNext/><w:spacing w:before="160" w:after="100"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>', 'subtitle')}</w:pPr>` +
    `<w:rPr>${mergeRPr('<w:b/>', 'subtitle')}</w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeEpigraph">` +
    `<w:name w:val="FB2 Epigraph"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:spacing w:before="80" w:after="80"/><w:ind w:left="2880" w:firstLine="0"/><w:jc w:val="left"/>', 'epigraph')}</w:pPr>` +
    `<w:rPr>${mergeRPr('<w:i/>', 'epigraph')}</w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeAnnotation">` +
    `<w:name w:val="FB2 Annotation"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="80" w:after="80"/><w:ind w:left="360" w:right="360" w:firstLine="0"/></w:pPr>` +
    `<w:rPr><w:i/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbePoemTitle">` +
    `<w:name w:val="FB2 Poem Title"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:ind w:left="720" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
    `<w:rPr><w:b/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeVerse">` +
    `<w:name w:val="FB2 Verse"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:spacing w:before="0" w:after="40"/><w:ind w:left="720" w:firstLine="0"/><w:jc w:val="left"/>', 'v')}</w:pPr>` +
    (typeOverrides.has('v') ? `<w:rPr>${mergeRPr('', 'v')}</w:rPr>` : '') +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeTextAuthor">` +
    `<w:name w:val="FB2 Text Author"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:spacing w:before="40" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="right"/>', 'text-author')}</w:pPr>` +
    `<w:rPr>${mergeRPr('<w:i/>', 'text-author')}</w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeDate">` +
    `<w:name w:val="FB2 Date"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr>${mergePPr('<w:spacing w:before="40" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="right"/>', 'date')}</w:pPr>` +
    (typeOverrides.has('date') ? `<w:rPr>${mergeRPr('', 'date')}</w:rPr>` : '') +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeEmptyLine">` +
    `<w:name w:val="FB2 Empty Line"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="60" w:after="60"/><w:ind w:firstLine="0"/></w:pPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeImage">` +
    `<w:name w:val="FB2 Image"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="120" w:after="60"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeCaption">` +
    `<w:name w:val="FB2 Caption"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="20" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:i/><w:sz w:val="${noteHalfPt}"/><w:szCs w:val="${noteHalfPt}"/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeTableHeader">` +
    `<w:name w:val="FB2 Table Header"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="20" w:after="20"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
    `<w:rPr><w:b/></w:rPr>` +
    `</w:style>` +
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="MfbeTableCell">` +
    `<w:name w:val="FB2 Table Cell"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="20" w:after="20"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
    `</w:style>` +
    customWordStylesXml.join('') +
    `</w:styles>`
  );
}
