/**
 * Feature 018 (T020, contracts/mobi-export.md §1–§3): MOBI/KF8 export metadata builder,
 * shelf title formatting (`seriesInTitle`), gap filling, and `MfbeRoundTripRecord` preparation.
 */
import {
  readFbdMakerName,
  ROLE_BY_LABEL,
  type FbdMakerLabel,
} from '@/features/ebookShared/fbdMaker';
import { xmlName, XmlNameAllocator } from '@/features/ebookShared/names';
import type {
  BodyNode,
  Document,
  InlineNode,
  Mark,
  ParagraphNode,
  Person,
  Sequence,
  TitleNode,
} from '@/model/document';
import type { MobiOpenAt, MobiSeriesInTitle, MobiTocPlacement } from '@/rpc/types';

import { mobiBookWords, type MobiBookWords } from '../shared/words';

export type MobiExportSummaryKind =
  | 'pictureConverted'
  | 'pictureDownscaled'
  | 'pictureLeftOut'
  | 'linkAsText'
  | 'cssDropped'
  | 'stylesheetDropped'
  | 'gapFilled'
  | 'idMadeUnique'
  | 'mfbeSkipped';

export interface MobiExportSummaryItem {
  kind: MobiExportSummaryKind;
  detail: string;
}

export interface PlacedMobiPicture {
  recindex: number;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

export interface MobiNavItem {
  label: string;
  anchorId: string;
  depth: number;
}

export interface MobiGuideItem {
  type: 'cover' | 'title-page' | 'toc' | 'text' | 'colophon';
  title: string;
  anchorId: string;
}

export interface MfbeBodyAttr {
  index: number;
  name?: string;
  lang?: string;
}

export interface MfbeBodyCoverAttr {
  href: string;
  alt?: string;
  title?: string;
  id?: string;
}

export interface MfbeAttrs {
  bodies: MfbeBodyAttr[];
  dates: Record<string, string>;
  imageTitles: Record<string, string>;
  styleNames: Record<string, string>;
  untitledSections: string[];
  nodeLangs: Record<string, string>;
  /** Main body's leading `<image>` when omitted from export HTML because it duplicated `<coverpage>`. */
  bodyLeadingCover?: MfbeBodyCoverAttr;
}

export interface MfbeRoundTripRecord {
  v: 1;
  description: Document['description'];
  stylesheets: Document['stylesheets'];
  binaries: Record<string, string>;
  attrs: MfbeAttrs;
}

export interface MobiExportMetadata {
  title: string;
  updatedTitle: string;
  authors: string[];
  contributors: string[];
  publisher: string;
  description: string;
  isbn: string;
  subjects: string[];
  date: string;
  language: string;
  identifier: string;
  openAtAnchorId: string;
}

export interface MobiExportBuildOptions {
  document: Document;
  pictures: ReadonlyMap<string, PlacedMobiPicture>;
  fallbackTitle: string;
  tocPlacement: MobiTocPlacement;
  seriesInTitle: MobiSeriesInTitle;
  openAt: MobiOpenAt;
  kf8PopupFootnotes: boolean;
  genreNames?: ReadonlyMap<string, string>;
  newId?: () => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return escapeXml(value).replace(/"/g, '&quot;');
}

export function personDisplayName(person: Person): string {
  const parts = [person.firstName, person.middleName, person.lastName]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  return parts.join(' ') || (person.nickname ?? '').trim();
}

export function flattenSequences(sequences: readonly Sequence[]): Sequence[] {
  return sequences.flatMap((seq) => [seq, ...flattenSequences(seq.children ?? [])]);
}

/**
 * Formats the reader shelf title according to `seriesInTitle` (contracts/mobi-export.md §3).
 * Never alters the title page or `MfbeRoundTripRecord.description`.
 */
export function formatShelfTitle(
  title: string,
  sequences: readonly Sequence[],
  mode: MobiSeriesInTitle,
): string {
  if (mode === 'off') return title;
  const first = flattenSequences(sequences)[0];
  if (!first) return title;
  const name = (first.name ?? '').trim();
  const num =
    first.number !== undefined && first.number !== null ? String(first.number).trim() : '';
  if (mode === 'numberBefore') {
    return num ? `${num}_${title}` : title;
  }
  if (!name) return title;
  return num ? `${name} #${num} \u2014 ${title}` : `${name} \u2014 ${title}`;
}

export function plainTextOfNodes(nodes: readonly AnyNode[]): string {
  const parts: string[] = [];
  const visit = (node: AnyNode): void => {
    if (node.type === 'text') parts.push(node.text);
    else if (node.type === 'raw-xml') {
      parts.push(String(node.attrs?.xml ?? '').replace(/<[^>]*>/g, ''));
    } else if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
      if (node.type !== 'text' && node.type !== 'inline-image') parts.push(' ');
    }
  };
  for (const node of nodes) visit(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function inlinePlainText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((n) =>
      n.type === 'text' ? n.text : n.type === 'raw-xml' ? n.attrs.xml.replace(/<[^>]*>/g, '') : '',
    )
    .join('');
}

export function titlePlainText(title: TitleNode | undefined): string {
  if (!title) return '';
  return title.content
    .filter((line): line is ParagraphNode => line.type === 'p')
    .map((line) => inlinePlainText(line.content))
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function forEachNode(node: AnyNode, visit: (n: AnyNode) => void): void {
  visit(node);
  if (Array.isArray(node.content)) {
    for (const child of node.content) forEachNode(child, visit);
  }
}

export interface BookExportPlan {
  title: string;
  originalTitleEmpty: boolean;
  shelfTitle: string;
  language: string;
  xhtmlLang: string;
  words: MobiBookWords;
  identifier: string;
  hasTitlePage: boolean;
  hasAnnotationPage: boolean;
  hasHistoryPage: boolean;
  openAtAnchorId: string;
  metadata: MobiExportMetadata;
  notesBodies: ReadonlySet<number>;
  mainBodyIndex: number;
  furtherBodyIndices: number[];
  notesBodyIndices: number[];
  elementIds: Map<string, string>;
  targets: Map<string, string>;
  bodyOfId: Map<string, number>;
  ids: XmlNameAllocator;
  attrs: MfbeAttrs;
  summary: MobiExportSummaryItem[];
  styleClass: (originalName: string) => string;
}

export function buildExportPlan(options: MobiExportBuildOptions): BookExportPlan {
  const { document } = options;
  const summary: MobiExportSummaryItem[] = [];
  const note = (kind: MobiExportSummaryKind, detail: string): void => {
    summary.push({ kind, detail });
  };

  const titleInfo = document.description.titleInfo;
  const publishInfo = document.description.publishInfo;
  const docInfo = document.description.documentInfo;

  // Gap filling (contracts/mobi-export.md §3): in exported file only.
  const rawTitle = titleInfo.bookTitle.trim();
  const originalTitleEmpty = rawTitle.length === 0;
  const title = rawTitle || options.fallbackTitle;
  if (originalTitleEmpty) note('gapFilled', 'title');

  const declaredLang = (titleInfo.lang ?? '').trim();
  const langValid = LANGUAGE_TAG.test(declaredLang) && declaredLang.toLowerCase() !== 'und';
  const language = langValid ? declaredLang : '';
  const xhtmlLang = langValid ? declaredLang : 'und';
  if (!langValid) note('gapFilled', 'language');
  const words = mobiBookWords(language);

  let identifier = (docInfo.id ?? '').trim();
  if (!identifier) {
    identifier = (options.newId ?? (() => crypto.randomUUID()))();
    note('gapFilled', 'identifier');
  }
  if (UUID_RE.test(identifier)) {
    identifier = `urn:uuid:${identifier.toLowerCase()}`;
  }

  const shelfTitle = formatShelfTitle(title, titleInfo.sequences, options.seriesInTitle);

  // Authors and contributors (translators + FBD Maker custom-info roles).
  const authors = titleInfo.authors.map(personDisplayName).filter((n) => n.length > 0);
  const contributors: string[] = [];
  for (const tr of titleInfo.translators) {
    const name = personDisplayName(tr);
    if (name) contributors.push(name);
  }
  for (const ci of document.description.customInfo) {
    const label = ci.infoType.trim().toLowerCase() as FbdMakerLabel;
    if (label in ROLE_BY_LABEL) {
      const person = readFbdMakerName(ci.text);
      const formatted = [person.first, person.middle, person.last].filter(Boolean).join(' ').trim();
      if (formatted) contributors.push(formatted);
    }
  }

  // Subjects: localised genre names + comma-split keywords.
  const subjects: string[] = [];
  for (const g of titleInfo.genres) {
    const code = g.code.trim();
    if (!code) continue;
    const label = options.genreNames?.get(code) ?? code;
    if (!subjects.includes(label)) subjects.push(label);
  }
  if (titleInfo.keywords) {
    for (const kw of titleInfo.keywords.split(/[,;]/)) {
      const cleaned = kw.trim();
      if (cleaned && !subjects.includes(cleaned)) subjects.push(cleaned);
    }
  }

  const descriptionText = titleInfo.annotation
    ? plainTextOfNodes(titleInfo.annotation.content)
    : '';
  const dateText =
    (publishInfo?.year ?? '').trim() ||
    (titleInfo.date?.value ?? '').trim() ||
    (titleInfo.date?.text ?? '').trim();

  // Classify bodies: notes/comments bodies + bodies targeted by note links.
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

  const notesBodies = new Set<number>();
  document.bodies.forEach((body, idx) => {
    const name = (body.attrs.name ?? '').trim().toLowerCase();
    if (name === 'notes' || name === 'comments') notesBodies.add(idx);
  });
  for (const target of noteTargets) {
    const idx = bodyOfId.get(target);
    if (idx !== undefined && idx > 0) notesBodies.add(idx);
  }

  const mainBodyIndex = document.bodies.findIndex((_, idx) => !notesBodies.has(idx));
  const furtherBodyIndices: number[] = [];
  const notesBodyIndices: number[] = [];
  document.bodies.forEach((_, idx) => {
    if (notesBodies.has(idx)) notesBodyIndices.push(idx);
    else if (idx !== mainBodyIndex) furtherBodyIndices.push(idx);
  });

  // Allocate unique XML IDs across the whole book.
  const ids = new XmlNameAllocator();
  // Reserve structural landmark IDs so book IDs never collide with them.
  for (const reserved of [
    'fb2-cover',
    'fb2-title-page',
    'fb2-annotation',
    'fb2-toc',
    'fb2-main-start',
    'fb2-notes',
    'fb2-history',
  ]) {
    ids.allocate(reserved);
  }
  const elementIds = new Map<string, string>();
  const targets = new Map<string, string>();
  const claim = (node: AnyNode): void => {
    const own = node.attrs?.id as string | undefined;
    if (!own || !node.attrs?.nodeId) return;
    const allocated = ids.allocate(own);
    elementIds.set(node.attrs.nodeId, allocated);
    if (targets.has(own)) note('idMadeUnique', own);
    else targets.set(own, allocated);
  };
  for (const body of document.bodies) forEachNode(body, claim);
  if (titleInfo.annotation) forEachNode(titleInfo.annotation, claim);
  if (docInfo.history) forEachNode(docInfo.history, claim);

  let sectionSeq = 0;
  for (const body of document.bodies) {
    forEachNode(body, (node) => {
      if (node.type !== 'section') return;
      sectionSeq++;
      if (!elementIds.has(node.attrs.nodeId)) {
        elementIds.set(node.attrs.nodeId, ids.allocate(`s${sectionSeq}`));
      }
    });
  }

  const hasAnnotationPage = Boolean(
    titleInfo.annotation && titleInfo.annotation.content.length > 0,
  );
  const hasHistoryPage = Boolean(docInfo.history && docInfo.history.content.length > 0);
  const hasImprint = Boolean(
    (publishInfo?.publisher ?? '').trim() || (publishInfo?.year ?? '').trim(),
  );
  const hasTitlePage =
    !originalTitleEmpty ||
    flattenSequences(titleInfo.sequences).some((s) => s.name.trim().length > 0) ||
    authors.length > 0 ||
    hasImprint;

  const openAtAnchorId =
    options.openAt === 'mainText'
      ? 'fb2-main-start'
      : hasTitlePage
        ? 'fb2-title-page'
        : hasAnnotationPage
          ? 'fb2-annotation'
          : 'fb2-main-start';

  const metadata: MobiExportMetadata = {
    title,
    updatedTitle: shelfTitle,
    authors,
    contributors,
    publisher: (publishInfo?.publisher ?? '').trim(),
    description: descriptionText,
    isbn: (publishInfo?.isbn ?? '').trim(),
    subjects,
    date: dateText,
    language,
    identifier,
    openAtAnchorId,
  };

  const attrs: MfbeAttrs = {
    bodies: document.bodies.map((b: BodyNode, idx: number) => ({
      index: idx,
      ...(b.attrs.name ? { name: b.attrs.name } : {}),
      ...(b.attrs.lang ? { lang: b.attrs.lang } : {}),
    })),
    dates: {},
    imageTitles: {},
    styleNames: {},
    untitledSections: [],
    nodeLangs: {},
  };

  const styleClass = (originalName: string): string => {
    const sanitised = xmlName(originalName);
    if (sanitised !== originalName) {
      attrs.styleNames[sanitised] = originalName;
    }
    return sanitised;
  };

  return {
    title,
    originalTitleEmpty,
    shelfTitle,
    language,
    xhtmlLang,
    words,
    identifier,
    hasTitlePage,
    hasAnnotationPage,
    hasHistoryPage,
    openAtAnchorId,
    metadata,
    notesBodies,
    mainBodyIndex,
    furtherBodyIndices,
    notesBodyIndices,
    elementIds,
    targets,
    bodyOfId,
    ids,
    attrs,
    summary,
    styleClass,
  };
}

/**
 * Formats a 1-based picture `recindex` into the 4-digit key used by `MfbeRoundTripRecord.binaries`
 * and KF8 `kindle:embed:` (uppercase base-32, matching Kindle/Calibre).
 */
export function formatKf8EmbedId(recindex: number): string {
  return recindex.toString(32).toUpperCase().padStart(4, '0');
}

/** Formats a 1-based picture `recindex` into the 5-digit decimal string used by MOBI 7 `<img recindex>`. */
export function formatMobi7RecIndex(recindex: number): string {
  return String(recindex).padStart(5, '0');
}

export function buildMfbeRoundTripRecord(
  document: Document,
  pictures: ReadonlyMap<string, PlacedMobiPicture>,
  attrs: MfbeAttrs,
): MfbeRoundTripRecord {
  const binaries: Record<string, string> = {};
  for (const [binaryId, placed] of pictures) {
    binaries[formatKf8EmbedId(placed.recindex)] = binaryId;
  }
  // Annotation and history are rendered as full structured pages (#fb2-annotation, #fb2-history),
  // so omit non-empty copies from the private EXTH 59901 record (matching PDF commit 38357d9b).
  const titleInfo = { ...document.description.titleInfo };
  if (titleInfo.annotation && titleInfo.annotation.content.length > 0) {
    delete titleInfo.annotation;
  }
  const documentInfo = { ...document.description.documentInfo };
  if (documentInfo.history && documentInfo.history.content.length > 0) {
    delete documentInfo.history;
  }
  return {
    v: 1,
    description: {
      ...document.description,
      titleInfo,
      documentInfo,
    },
    stylesheets: document.stylesheets,
    binaries,
    attrs,
  };
}
