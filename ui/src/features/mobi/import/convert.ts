/**
 * Feature 018 (T030, T035, contracts/mobi-import.md §2–§3):
 * Converts parsed MOBI 7, KF8, and plain PalmDOC content into valid FB2 2.1 XML bodies,
 * supporting both verified `MFBE` round-trip (`editorBook`) and broad foreign books
 * (Calibre, fb2converter, maxlibmobi, KF8 CSS, inline SVG unwrap/rasterise, MathML, notes).
 */
import type { MarkdownStylesheet } from '@/features/markdown/convert';

import {
  planClasses,
  type ClassPlan,
  type ClassUse,
  type Fb2Form,
} from '../../ebookShared/importCss';
import { XmlNameAllocator } from '../../ebookShared/names';
import { singleFramedImageHref } from '../../ebookShared/svg';
import type { MfbeRoundTripRecord } from '../export/metadata';
import { isConverterStructuralClass, semanticRoleOfClasses } from '../shared/format';
import type { MobiImportSummaryItem, MobiReadMetadata } from './metadata';
import { parsePictureIndexFromHref, type MobiPictureInfo } from './pictures';

export interface MobiNavInput {
  label: string;
  anchorId: string;
  depth: number;
  offset: number;
}

export interface MobiGuideInput {
  type: string;
  title: string;
  anchorId: string;
  offset: number;
}

export interface DrawnPlaceholder {
  id: string;
  markup: string;
  alt: string;
  display: boolean;
}

export interface ConvertMobiOptions {
  activePart: 'mobi7' | 'kf8' | 'palmdoc';
  htmlOrText: string;
  cssFlows: readonly string[];
  metadata: MobiReadMetadata;
  navigation: readonly MobiNavInput[];
  guide: readonly MobiGuideInput[];
  pictures: readonly MobiPictureInfo[];
  coverIndex?: number;
  thumbnailIndex?: number;
  /** Non-null when MFBE body restoration is active (`mfbeHtmlMatches == true`). */
  mfbeBodyRecord?: MfbeRoundTripRecord | null;
  /** Cooperative yield hook (SC-007: progress bar cadence <= 1 s and responsive Cancel). */
  yieldStep?: () => Promise<void>;
}

export interface ConvertedMobiBook {
  bodyXml: string;
  notesXml: string | null;
  /** Structured `<annotation>...</annotation>` extracted from `#fb2-annotation` when present. */
  annotationXml: string | null;
  /** Structured `<history>...</history>` extracted from `#fb2-history` or foreign `colophon`. */
  historyXml: string | null;
  stylesheets: MarkdownStylesheet[];
  /** 1-based picture index -> allocated FB2 binary ID. */
  neededPictures: Map<number, string>;
  /** Binary ID for `<coverpage>` if a valid cover image exists. */
  coverBinaryId?: string;
  drawings: DrawnPlaceholder[];
  formulas: DrawnPlaceholder[];
  summary: MobiImportSummaryItem[];
  counts: { sections: number; pictures: number; tables: number; notes: number };
}

function escText(s: string): string {
  return stripControlChars(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;');
}

/** Strips XML 1.0 illegal control characters while preserving tab, LF, CR. */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function normSpace(s: string): string {
  return stripControlChars(s).replace(/\s+/g, ' ');
}

function extForMime(ct: string): string {
  if (ct === 'image/png') return '.png';
  if (ct === 'image/jpeg') return '.jpg';
  return '.jpg';
}

function isSafeExternalHref(href: string): boolean {
  return /^(https?:|mailto:|ftp:)/i.test(href.trim());
}

/** Converts plain PalmDOC text into a single valid FB2 `<body><section>`. */
function convertPlainPalmDoc(text: string): ConvertedMobiBook {
  const cleaned = stripControlChars(text).replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n');
  const blocks: string[] = [];
  let para: string[] = [];
  let emptyRun = 0;

  const flushPara = (): void => {
    if (para.length === 0) return;
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) blocks.push(`<p>${escText(joined)}</p>`);
    para = [];
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushPara();
      emptyRun++;
    } else {
      if (emptyRun >= 2 && blocks.length > 0) {
        blocks.push('<empty-line/>');
      }
      emptyRun = 0;
      para.push(t);
    }
  }
  flushPara();
  if (blocks.length === 0) blocks.push('<p/>');

  return {
    bodyXml: `<body><section>${blocks.join('')}</section></body>`,
    notesXml: null,
    annotationXml: null,
    historyXml: null,
    stylesheets: [],
    neededPictures: new Map(),
    drawings: [],
    formulas: [],
    summary: [],
    counts: { sections: 1, pictures: 0, tables: 0, notes: 0 },
  };
}

/** Collects CSS class usage statistics across the parsed DOM for `planClasses`. */
function collectClassUse(root: Element): ClassUse {
  const used = new Set<string>();
  const paragraphs = new Map<string, number>();
  const walk = (el: Element): void => {
    const tag = el.tagName.toLowerCase();
    for (const cls of Array.from(el.classList)) {
      if (!cls || isConverterStructuralClass(cls)) continue;
      used.add(cls);
      if (tag === 'p') {
        paragraphs.set(cls, (paragraphs.get(cls) ?? 0) + 1);
      }
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return { used, paragraphs };
}

function isPagebreak(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'mbp:pagebreak') return true;
  return tag === 'hr' && el.classList.contains('mfbe-pagebreak');
}

function isIgnoredElement(tag: string): boolean {
  return (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'noscript' ||
    tag === 'iframe' ||
    tag === 'object' ||
    tag === 'embed' ||
    tag === 'applet' ||
    tag === 'link' ||
    tag === 'meta' ||
    tag === 'title' ||
    tag === 'head'
  );
}

/** Detects whether an element is a cover, inline TOC, or metadata-only title page to skip. */
function isFrontMatterBlock(
  el: Element,
  guideTypesById: ReadonlyMap<string, string>,
  coverIndex: number | undefined,
  meta: MobiReadMetadata,
  isEditorRoundTrip: boolean,
): 'cover' | 'toc' | 'title-page' | null {
  const id = el.getAttribute('id') ?? '';
  const role = semanticRoleOfClasses(el.classList);
  if (id === 'fb2-cover' || role === 'cover') return 'cover';
  if (id === 'fb2-toc' || role === 'toc') return 'toc';
  if (id === 'fb2-title-page' || role === 'title-page') return 'title-page';
  if (
    id === 'fb2-annotation' ||
    el.classList.contains('fb2-annotation-page') ||
    id === 'fb2-history' ||
    el.classList.contains('fb2-history-page')
  ) {
    return 'title-page';
  }
  if (isEditorRoundTrip) return null;

  const gtype = id ? guideTypesById.get(id) : undefined;
  if (gtype === 'cover') return 'cover';
  if (gtype === 'toc') return 'toc';
  if (gtype === 'title-page') return 'title-page';

  // Cover-only container (only image(s), referencing coverIndex, zero body text).
  const text = (el.textContent ?? '').trim();
  if (!text && coverIndex !== undefined) {
    const imgs = el.querySelectorAll('img');
    if (imgs.length === 1) {
      const idx = extractImgPictureIndex(imgs[0]!);
      if (idx === coverIndex) return 'cover';
    }
    const svgs = el.querySelectorAll('svg');
    if (svgs.length === 1) {
      const href = singleFramedImageHref(svgs[0]!);
      if (href && parsePictureIndexFromHref(href) === coverIndex) return 'cover';
    }
  }

  // Metadata-only title block repeating only title and authors.
  if (text.length > 0 && text.length < 300) {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\u0400-\u04ff]+/gi, ' ')
        .trim();
    const tNorm = norm(text);
    const titleNorm = norm(meta.updatedTitle || meta.title);
    if (titleNorm && tNorm === titleNorm && el.tagName.toLowerCase() === 'div') {
      return 'title-page';
    }
  }
  return null;
}

function extractImgPictureIndex(img: Element): number | null {
  const rec = img.getAttribute('recindex') ?? img.getAttribute('mediarecindex');
  if (rec) {
    const idx = parsePictureIndexFromHref(rec);
    if (idx !== null) return idx;
  }
  const src = img.getAttribute('src') ?? '';
  if (src) {
    const idx = parsePictureIndexFromHref(src);
    if (idx !== null) return idx;
  }
  return null;
}

function getAttrIgnoreNs(el: Element, local: string): string | null {
  return (
    el.getAttribute(`epub:${local}`) ??
    el.getAttributeNS('http://www.idpf.org/2007/ops', local) ??
    el.getAttribute(local)
  );
}

/** Represents a tree node while assembling strictly schema-valid FB2 sections. */
interface SectionBuilder {
  id?: string;
  lang?: string;
  level: number; // 0 = body root, 1..6 = heading level
  titleLines: string[];
  epigraphs: string[];
  leadingImages: string[];
  annotationXml?: string;
  blocks: string[];
  children: SectionBuilder[];
}

function makeSection(level: number, id?: string, lang?: string): SectionBuilder {
  return {
    level,
    id,
    lang,
    titleLines: [],
    epigraphs: [],
    leadingImages: [],
    blocks: [],
    children: [],
  };
}

function serializeSection(sec: SectionBuilder): string {
  const attrs: string[] = [];
  if (sec.id) attrs.push(`id="${escAttr(sec.id)}"`);
  if (sec.lang) attrs.push(`xml:lang="${escAttr(sec.lang)}"`);
  const open = attrs.length > 0 ? `<section ${attrs.join(' ')}>` : '<section>';

  const head: string[] = [];
  if (sec.titleLines.length > 0) {
    head.push(`<title>${sec.titleLines.map((l) => `<p>${l}</p>`).join('')}</title>`);
  }
  head.push(...sec.epigraphs);
  const leading = [...sec.leadingImages];
  const blocks = [...sec.blocks];
  // FB2 2.1 schema: section allows AT MOST ONE leading <image> before <annotation>,
  // and block sequences cannot start with <image> (prepend <empty-line/> if needed).
  if (leading.length > 1) {
    blocks.unshift(...leading.splice(1));
  }
  const startsWithImage = (b: string): boolean =>
    b.startsWith('<image ') ||
    b.startsWith('<!--mfbe-svg-block:') ||
    b.startsWith('<!--mfbe-math-block:');
  if (blocks.length > 0 && startsWithImage(blocks[0]!)) {
    if (!sec.annotationXml && leading.length === 0 && blocks[0]!.startsWith('<image ')) {
      leading.push(blocks.shift()!);
    }
    if (blocks.length > 0 && startsWithImage(blocks[0]!)) {
      blocks.unshift('<empty-line/>');
    }
  }
  head.push(...leading);
  if (sec.annotationXml) head.push(sec.annotationXml);

  if (sec.children.length > 0) {
    // FB2 2.1 schema: a section cannot mix direct blocks and child sections.
    // Wrap any direct blocks before child sections inside an untitled child section.
    const childXml: string[] = [];
    if (blocks.length > 0) {
      const wrapped = startsWithImage(blocks[0]!) ? ['<empty-line/>', ...blocks] : blocks;
      childXml.push(`<section>${wrapped.join('')}</section>`);
    }
    for (const ch of sec.children) {
      childXml.push(serializeSection(ch));
    }
    return `${open}${head.join('')}${childXml.join('')}</section>`;
  }

  const body = blocks.length > 0 ? blocks.join('') : '<p/>';
  return `${open}${head.join('')}${body}</section>`;
}

/** Main entry point: converts MOBI 7 / KF8 / PalmDOC content to FB2 XML. */
export async function convertMobiToFb2(options: ConvertMobiOptions): Promise<ConvertedMobiBook> {
  if (options.activePart === 'palmdoc') {
    return convertPlainPalmDoc(options.htmlOrText);
  }

  const SLICE_MS = 40;
  let lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const maybeYield = async (force = false): Promise<void> => {
    if (!options.yieldStep) return;
    const now = nowMs();
    if (!force && now - lastYield < SLICE_MS) return;
    await options.yieldStep();
    lastYield = nowMs();
  };

  const parser = new DOMParser();
  const normalizedHtml = options.htmlOrText.replace(
    /<mbp:pagebreak\b[^>]*\/?>/gi,
    '<hr class="mfbe-pagebreak"/>',
  );
  const doc = parser.parseFromString(normalizedHtml, 'text/html');
  await maybeYield(true);
  const body = doc.body ?? doc.documentElement;
  const mfbe = options.mfbeBodyRecord ?? null;
  const isEditorRoundTrip = mfbe !== null;

  const summary: MobiImportSummaryItem[] = [];

  // Record hostile/active elements, embedded media, and remote resources that are stripped and never run/fetched.
  if (!isEditorRoundTrip) {
    const scripts = doc.querySelectorAll('script');
    if (scripts.length > 0) {
      summary.push({ kind: 'droppedScripts', detail: `<script> (${scripts.length})` });
    }
    const media = doc.querySelectorAll('iframe, object, embed, applet, audio, video');
    if (media.length > 0) {
      summary.push({ kind: 'droppedMedia', detail: `${media.length}` });
    }
    for (const el of Array.from(doc.querySelectorAll('img[src], link[href], iframe[src]'))) {
      const url = (el.getAttribute('src') ?? el.getAttribute('href') ?? '').trim();
      if (/^https?:\/\//i.test(url)) {
        summary.push({ kind: 'remote', detail: url });
      }
    }
    for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
      const href = (a.getAttribute('href') ?? '').trim();
      if (/^javascript:/i.test(href)) {
        summary.push({ kind: 'droppedScripts', detail: 'javascript:' });
      }
    }
  }

  const pictureInfoByIdx = new Map<number, MobiPictureInfo>(
    options.pictures.map((p) => [p.index, p]),
  );

  // Allocate clean XML NCName binary IDs (restoring original binary IDs when MFBE matches!).
  const picNames = new XmlNameAllocator();
  const neededPictures = new Map<number, string>();
  const preferredIdByIdx = new Map<number, string>();
  if (mfbe?.binaries) {
    for (const [k, origId] of Object.entries(mfbe.binaries)) {
      const idx = Number.parseInt(k, 10);
      if (Number.isFinite(idx) && idx >= 1 && origId) {
        preferredIdByIdx.set(idx, origId);
      }
    }
  }

  const allocatePictureId = (picIdx: number, isCover = false): string | null => {
    if (options.thumbnailIndex !== undefined && picIdx === options.thumbnailIndex) {
      return null; // Never import the cover thumbnail as a book binary!
    }
    const existing = neededPictures.get(picIdx);
    if (existing) return existing;
    const info = pictureInfoByIdx.get(picIdx);
    if (!info) return null;
    if (info.tooLarge) {
      summary.push({ kind: 'pictureTooLarge', detail: `picture-${picIdx}` });
      return null;
    }
    const pref = preferredIdByIdx.get(picIdx);
    let id: string;
    if (pref) {
      id = picNames.allocate(pref);
    } else {
      const base = isCover ? 'cover' : `img_${picIdx}`;
      id = picNames.allocate(`${base}${extForMime(info.contentType)}`);
    }
    neededPictures.set(picIdx, id);
    return id;
  };

  let coverBinaryId: string | undefined;
  if (options.coverIndex !== undefined) {
    const cid = allocatePictureId(options.coverIndex, true);
    if (cid) coverBinaryId = cid;
  }

  // Stylesheets & CSS class planning (foreign KF8/MOBI only; editor round-trip restores verbatim).
  let classPlan: ClassPlan = {
    forms: new Map(),
    named: new Set(),
    stylesheet: '',
    dropped: [],
  };
  const stylesheets: MarkdownStylesheet[] = [];
  if (!isEditorRoundTrip) {
    const rawSheets: string[] = [...options.cssFlows];
    for (const styleEl of Array.from(doc.querySelectorAll('style'))) {
      if (styleEl.textContent) rawSheets.push(styleEl.textContent);
    }
    if (rawSheets.length > 0 && body) {
      const use = collectClassUse(body);
      classPlan = planClasses(rawSheets, use);
      if (classPlan.stylesheet.trim()) {
        stylesheets.push({ type: 'text/css', text: classPlan.stylesheet, foreign: true });
      }
      for (const d of classPlan.dropped) {
        summary.push({ kind: 'cssDropped', detail: d });
      }
    }
  } else if (mfbe.stylesheets.length > 0) {
    for (const s of mfbe.stylesheets) {
      stylesheets.push({ type: s.type, text: s.content, foreign: false });
    }
  }

  // Track unique XML IDs across BOTH binaries and body/note elements (shared xs:ID space!).
  const idAllocator = picNames;
  const idMap = new Map<string, string>(); // raw HTML id -> first allocated FB2 NCName id
  const emittedIds = new Set<string>();
  const registerId = (raw: string | null | undefined): string | undefined => {
    const cleaned = (raw ?? '').trim();
    if (!cleaned) return undefined;
    const alloc = idAllocator.allocate(cleaned);
    if (!idMap.has(cleaned)) idMap.set(cleaned, alloc);
    emittedIds.add(alloc);
    return alloc;
  };

  const drawings: DrawnPlaceholder[] = [];
  const formulas: DrawnPlaceholder[] = [];
  const counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };

  const guideTypesById = new Map<string, string>();
  for (const g of options.guide) {
    if (g.anchorId) guideTypesById.set(g.anchorId, g.type);
  }
  const navByAnchorId = new Map<string, MobiNavInput>();
  for (const n of options.navigation) {
    if (n.anchorId && !navByAnchorId.has(n.anchorId)) {
      navByAnchorId.set(n.anchorId, n);
    }
  }

  // Note detection: identify footnote elements & note target IDs BEFORE body walk.
  const noteElements = new Set<Element>();
  const noteTargetIds = new Set<string>();

  if (body) {
    // 1. Explicit KF8 / editor footnote containers
    for (const el of Array.from(body.querySelectorAll('[id="fb2-notes"], .fb2-notes'))) {
      noteElements.add(el);
    }
    for (const el of Array.from(body.querySelectorAll('aside, div, p, section'))) {
      const etype = (getAttrIgnoreNs(el, 'type') ?? '').toLowerCase();
      const role = (el.getAttribute('role') ?? '').toLowerCase();
      if (
        etype === 'footnote' ||
        etype === 'endnote' ||
        etype === 'rearnote' ||
        role === 'doc-footnote' ||
        role === 'doc-endnote' ||
        el.classList.contains('fb2-note')
      ) {
        noteElements.add(el);
        const nid = el.getAttribute('id');
        if (nid) noteTargetIds.add(nid);
      }
    }

    // 2. Explicit noteref links -> target element becomes a note
    for (const a of Array.from(body.querySelectorAll('a[href^="#"]'))) {
      const etype = (getAttrIgnoreNs(a, 'type') ?? '').toLowerCase();
      const role = (a.getAttribute('role') ?? '').toLowerCase();
      const cls = a.classList.contains('fb2-noteref');
      if (etype === 'noteref' || role === 'doc-noteref' || cls) {
        const tgtId = (a.getAttribute('href') ?? '').slice(1);
        if (tgtId) noteTargetIds.add(tgtId);
      }
    }

    // 3. Bidirectional links in foreign MOBIs (link in body -> target with backlink)
    if (!isEditorRoundTrip) {
      const refIdsByTarget = new Map<string, string[]>();
      for (const a of Array.from(body.querySelectorAll('a[href^="#"]'))) {
        const href = (a.getAttribute('href') ?? '').slice(1);
        const aid = a.getAttribute('id') ?? a.parentElement?.getAttribute('id') ?? '';
        if (href && aid) {
          const list = refIdsByTarget.get(href) ?? [];
          list.push(aid);
          refIdsByTarget.set(href, list);
        }
      }
      for (const [tgtId, refIds] of refIdsByTarget) {
        const tgtEl = doc.getElementById(tgtId);
        if (!tgtEl) continue;
        const container = tgtEl.closest('aside, p, div, li') ?? tgtEl;
        const backLinks = Array.from(container.querySelectorAll('a[href^="#"]'));
        const hasBack = backLinks.some((bl) =>
          refIds.includes((bl.getAttribute('href') ?? '').slice(1)),
        );
        if (hasBack) {
          noteTargetIds.add(tgtId);
          noteElements.add(container);
        }
      }
    }
  }

  // Check if an element is inside an already-captured notes container.
  const isInsideNoteContainer = (el: Element): boolean => {
    let cur: Element | null = el;
    while (cur && cur !== body) {
      if (noteElements.has(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  // Inline renderer (returns valid FB2 inline XML: text, strong, emphasis, strikethrough, sub, sup,
  // code, style, a, image).
  const renderInlines = (node: Node, insideLink = false): string => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      return escText(normSpace(node.textContent ?? ''));
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (isIgnoredElement(tag) || el.classList.contains('fb2-backlink')) return '';

    // Inline image
    if (tag === 'img') {
      const idx = extractImgPictureIndex(el);
      if (idx === null) return '';
      const bid = allocatePictureId(idx);
      if (!bid) return '';
      const alt = el.getAttribute('alt') ?? '';
      const altAttr = alt ? ` alt="${escAttr(alt)}"` : '';
      return `<image l:href="#${escAttr(bid)}"${altAttr}/>`;
    }

    // Inline SVG
    if (tag === 'svg') {
      const framed = singleFramedImageHref(el);
      if (framed) {
        const idx = parsePictureIndexFromHref(framed);
        if (idx !== null) {
          const bid = allocatePictureId(idx);
          if (bid) return `<image l:href="#${escAttr(bid)}"/>`;
        }
      }
      const id = picNames.allocate(`svg_${drawings.length + 1}.png`);
      const alt = (
        el.querySelector('title')?.textContent ??
        el.getAttribute('aria-label') ??
        ''
      ).trim();
      const markup = new XMLSerializer().serializeToString(el);
      const n = drawings.length;
      drawings.push({ id, markup, alt, display: false });
      return `<!--mfbe-svg:${n}-->`;
    }

    // Inline MathML
    if (tag === 'math') {
      const id = picNames.allocate(`math_${formulas.length + 1}.png`);
      const alt = (el.getAttribute('alttext') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const markup = new XMLSerializer().serializeToString(el);
      const display = el.getAttribute('display') === 'block';
      const n = formulas.length;
      formulas.push({ id, markup, alt, display });
      return `<!--mfbe-math:${n}-->`;
    }

    if (tag === 'br') return ' ';

    const childrenXml = () =>
      Array.from(el.childNodes)
        .map((c) => renderInlines(c, insideLink || tag === 'a'))
        .join('');

    // Anchor / link
    if (tag === 'a') {
      const rawHref = (el.getAttribute('href') ?? '').trim();
      const inner = childrenXml();
      if (insideLink || !rawHref || /^javascript:/i.test(rawHref)) return inner;
      if (rawHref.startsWith('#')) {
        const tgtRaw = rawHref.slice(1);
        const isNote =
          noteTargetIds.has(tgtRaw) ||
          (getAttrIgnoreNs(el, 'type') ?? '').toLowerCase() === 'noteref' ||
          (el.getAttribute('role') ?? '').toLowerCase() === 'doc-noteref' ||
          el.classList.contains('fb2-noteref');
        // Placeholder token resolved after full pass once all emitted IDs are known!
        return `<!--mfbe-link:${escAttr(tgtRaw)}:${isNote ? 'note' : 'int'}-->${inner}<!--/mfbe-link-->`;
      }
      if (isSafeExternalHref(rawHref)) {
        return `<a l:href="${escAttr(rawHref)}">${inner}</a>`;
      }
      return inner;
    }

    let content = childrenXml();
    if (!content) return '';

    // Apply native FB2 formatting marks
    const forms: Fb2Form[] = [];
    if (tag === 'strong' || tag === 'b') forms.push('strong');
    else if (tag === 'em' || tag === 'i' || tag === 'cite') forms.push('emphasis');
    else if (tag === 's' || tag === 'del' || tag === 'strike') forms.push('strikethrough');
    else if (tag === 'sup') forms.push('sup');
    else if (tag === 'sub') forms.push('sub');
    else if (tag === 'code' || tag === 'tt' || tag === 'kbd') forms.push('code');

    // Named styles & CSS-derived forms
    let styleName: string | undefined;
    for (const cls of Array.from(el.classList)) {
      if (isEditorRoundTrip) {
        if (cls in mfbe.attrs.styleNames) {
          styleName = mfbe.attrs.styleNames[cls];
        } else if (tag === 'span' && !isConverterStructuralClass(cls)) {
          styleName = cls;
        }
      } else {
        for (const f of classPlan.forms.get(cls) ?? []) {
          if (!forms.includes(f)) forms.push(f);
        }
        if (classPlan.named.has(cls) && !styleName) {
          styleName = cls;
        }
      }
    }

    // FB2 2.1 schema rule: <a> MUST always be outermost — never nested inside <sup>, <strong>,
    // <emphasis>, <style>, etc. Drop redundant <sup> around note references (which MOBI 7 / KF8
    // emit around note links) and push any other inline wrapper inside link text.
    const wrapAvoidingLinks = (
      openTag: string,
      closeTag: string,
      xml: string,
      dropForNoteLink: boolean,
    ): string => {
      if (!xml.includes('<!--mfbe-link:') && !xml.includes('<a ')) {
        return `${openTag}${xml}${closeTag}`;
      }
      if (
        dropForNoteLink &&
        /^\s*<!--mfbe-link:[^:]*:note-->[\s\S]*?<!--\/mfbe-link-->\s*$/.test(xml)
      ) {
        return xml;
      }
      // Wrap inner text of each link and plain segments outside links so <a> stays outermost.
      const linkRe =
        /(<!--mfbe-link:[^:]*:(?:note|int)-->)([\s\S]*?)(<!--\/mfbe-link-->)|(<a\b[^>]*>)([\s\S]*?)(<\/a>)/g;
      let result = '';
      let last = 0;
      for (const m of xml.matchAll(linkRe)) {
        const start = m.index!;
        if (start > last) {
          const before = xml.slice(last, start);
          result += before.trim() ? `${openTag}${before}${closeTag}` : before;
        }
        const lOpen = m[1] ?? m[4]!;
        const lInner = m[2] ?? m[5]!;
        const lClose = m[3] ?? m[6]!;
        const isNote = m[1]?.endsWith(':note-->') ?? false;
        if (dropForNoteLink && isNote) {
          result += `${lOpen}${lInner}${lClose}`;
        } else {
          result += `${lOpen}${openTag}${lInner}${closeTag}${lClose}`;
        }
        last = start + m[0].length;
      }
      if (last < xml.length) {
        const tail = xml.slice(last);
        result += tail.trim() ? `${openTag}${tail}${closeTag}` : tail;
      }
      return result;
    };

    for (const f of forms) {
      content = wrapAvoidingLinks(`<${f}>`, `</${f}>`, content, f === 'sup');
    }
    if (
      styleName &&
      !insideLink &&
      !content.includes('<!--mfbe-link:') &&
      !content.includes('<a ')
    ) {
      content = `<style name="${escAttr(styleName)}">${content}</style>`;
    }
    return content;
  };

  // Block-level image renderer
  const renderBlockImage = (img: Element, captionTitle?: string): string | null => {
    const idx = extractImgPictureIndex(img);
    if (idx === null) return null;
    const bid = allocatePictureId(idx);
    if (!bid) return null;
    counts.pictures++;
    const rawId = img.getAttribute('id') ?? img.parentElement?.getAttribute('id');
    const id = registerId(rawId);
    const alt = img.getAttribute('alt') ?? '';
    const title =
      captionTitle ?? (rawId && mfbe?.attrs.imageTitles[rawId]) ?? img.getAttribute('title') ?? '';
    const attrs = [`l:href="#${escAttr(bid)}"`];
    if (alt) attrs.push(`alt="${escAttr(alt)}"`);
    if (title) attrs.push(`title="${escAttr(title)}"`);
    if (id) attrs.push(`id="${escAttr(id)}"`);
    return `<image ${attrs.join(' ')}/>`;
  };

  // Render an HTML table into FB2 <table>
  const renderTable = (table: Element): string | null => {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return null;
    const fb2Rows: string[] = [];
    for (const tr of rows) {
      const cells = Array.from(tr.children).filter((c) => {
        const t = c.tagName.toLowerCase();
        return t === 'td' || t === 'th';
      });
      if (cells.length === 0) continue;
      const cellXml = cells.map((cell) => {
        const ctag = cell.tagName.toLowerCase() === 'th' ? 'th' : 'td';
        const cattrs: string[] = [];
        const cs = Number.parseInt(cell.getAttribute('colspan') ?? '', 10);
        if (Number.isFinite(cs) && cs > 1) cattrs.push(`colspan="${cs}"`);
        const rs = Number.parseInt(cell.getAttribute('rowspan') ?? '', 10);
        if (Number.isFinite(rs) && rs > 1) cattrs.push(`rowspan="${rs}"`);
        const align = (cell.getAttribute('align') ?? '').toLowerCase();
        if (align === 'left' || align === 'right' || align === 'center') {
          cattrs.push(`align="${align}"`);
        }
        const valign = (cell.getAttribute('valign') ?? '').toLowerCase();
        if (valign === 'top' || valign === 'middle' || valign === 'bottom') {
          cattrs.push(`valign="${valign}"`);
        }
        const inner = Array.from(cell.childNodes)
          .map((c) => renderInlines(c))
          .join('')
          .trim();
        const attrStr = cattrs.length > 0 ? ` ${cattrs.join(' ')}` : '';
        return `<${ctag}${attrStr}>${inner}</${ctag}>`;
      });
      fb2Rows.push(`<tr>${cellXml.join('')}</tr>`);
    }
    if (fb2Rows.length === 0) return null;
    counts.tables++;
    const tid = registerId(table.getAttribute('id'));
    return tid
      ? `<table id="${escAttr(tid)}">${fb2Rows.join('')}</table>`
      : `<table>${fb2Rows.join('')}</table>`;
  };

  // Render poem / epigraph / cite / annotation containers
  const renderPoem = (el: Element): string => {
    const pid = registerId(el.getAttribute('id'));
    const parts: string[] = [];
    const stanzas: string[] = [];
    const looseVerses: string[] = [];
    const textAuthors: string[] = [];
    let dateXml = '';

    const flushLoose = (): void => {
      if (looseVerses.length > 0) {
        stanzas.push(`<stanza>${looseVerses.join('')}</stanza>`);
        looseVerses.length = 0;
      }
    };

    for (const ch of Array.from(el.children)) {
      const role = semanticRoleOfClasses(ch.classList);
      const ctag = ch.tagName.toLowerCase();
      if (role === 'title' || /^h[1-6]$/.test(ctag)) {
        const t = renderInlines(ch).trim();
        if (t && parts.length === 0) parts.push(`<title><p>${t}</p></title>`);
      } else if (role === 'stanza') {
        flushLoose();
        const vs: string[] = [];
        for (const v of Array.from(ch.children)) {
          const line = renderInlines(v).trim();
          if (line) vs.push(`<v>${line}</v>`);
        }
        if (vs.length > 0) stanzas.push(`<stanza>${vs.join('')}</stanza>`);
      } else if (role === 'text-author') {
        flushLoose();
        const t = renderInlines(ch).trim();
        if (t) textAuthors.push(`<text-author>${t}</text-author>`);
      } else if (role === 'date' || ctag === 'time') {
        flushLoose();
        const rawId = ch.getAttribute('id') ?? '';
        const val =
          (rawId && mfbe?.attrs.dates[rawId]) ||
          ch.getAttribute('data-fb2-value') ||
          ch.getAttribute('datetime') ||
          ch.getAttribute('data-value') ||
          '';
        const valAttr = val && /^\d{4}-\d{2}-\d{2}$/.test(val) ? ` value="${escAttr(val)}"` : '';
        dateXml = `<date${valAttr}>${escText((ch.textContent ?? '').trim())}</date>`;
      } else {
        const line = renderInlines(ch).trim();
        if (line) looseVerses.push(`<v>${line}</v>`);
      }
    }
    flushLoose();
    if (stanzas.length === 0) {
      const fallback = (el.textContent ?? '').trim();
      stanzas.push(`<stanza><v>${escText(fallback)}</v></stanza>`);
    }
    const open = pid ? `<poem id="${escAttr(pid)}">` : '<poem>';
    return `${open}${parts.join('')}${stanzas.join('')}${textAuthors.join('')}${dateXml}</poem>`;
  };

  const renderEpigraph = (el: Element): string => {
    const eid = registerId(el.getAttribute('id'));
    const bodyParts: string[] = [];
    const authors: string[] = [];
    for (const ch of Array.from(el.children)) {
      const role = semanticRoleOfClasses(ch.classList);
      if (role === 'text-author') {
        const t = renderInlines(ch).trim();
        if (t) authors.push(`<text-author>${t}</text-author>`);
      } else if (role === 'poem') {
        bodyParts.push(renderPoem(ch));
      } else if (role === 'empty-line') {
        bodyParts.push('<empty-line/>');
      } else {
        const t = renderInlines(ch).trim();
        if (t) bodyParts.push(`<p>${t}</p>`);
      }
    }
    if (bodyParts.length === 0) {
      const t = renderInlines(el).trim();
      if (t) bodyParts.push(`<p>${t}</p>`);
    }
    if (bodyParts.length === 0 && authors.length === 0) return '';
    const open = eid ? `<epigraph id="${escAttr(eid)}">` : '<epigraph>';
    return `${open}${bodyParts.join('')}${authors.join('')}</epigraph>`;
  };

  const renderCite = (el: Element): string => {
    const cid = registerId(el.getAttribute('id'));
    const bodyParts: string[] = [];
    const authors: string[] = [];
    for (const ch of Array.from(el.children)) {
      const role = semanticRoleOfClasses(ch.classList);
      if (role === 'text-author') {
        const t = renderInlines(ch).trim();
        if (t) authors.push(`<text-author>${t}</text-author>`);
      } else if (role === 'poem') {
        bodyParts.push(renderPoem(ch));
      } else if (role === 'subtitle') {
        const t = renderInlines(ch).trim();
        if (t) bodyParts.push(`<subtitle>${t}</subtitle>`);
      } else if (role === 'empty-line') {
        bodyParts.push('<empty-line/>');
      } else {
        const t = renderInlines(ch).trim();
        if (t) bodyParts.push(`<p>${t}</p>`);
      }
    }
    if (bodyParts.length === 0) {
      const t = renderInlines(el).trim();
      if (t) bodyParts.push(`<p>${t}</p>`);
    }
    if (bodyParts.length === 0 && authors.length === 0) return '';
    const open = cid ? `<cite id="${escAttr(cid)}">` : '<cite>';
    return `${open}${bodyParts.join('')}${authors.join('')}</cite>`;
  };

  // Render an `<div class="fb2-section">` directly in editor round-trip mode.
  let walkedNodes = 0;
  const renderRoundTripSection = async (el: Element): Promise<SectionBuilder> => {
    const rawId = el.getAttribute('id');
    const sec = makeSection(
      1,
      registerId(rawId),
      (rawId && mfbe?.attrs.nodeLangs[rawId]) || el.getAttribute('lang') || undefined,
    );
    counts.sections++;
    for (const ch of Array.from(el.children)) {
      if ((++walkedNodes & 63) === 0) await maybeYield();
      const role = semanticRoleOfClasses(ch.classList);
      const tag = ch.tagName.toLowerCase();
      if (isPagebreak(ch) || isIgnoredElement(tag)) continue;
      if (role === 'section' || tag === 'section') {
        sec.children.push(await renderRoundTripSection(ch));
      } else if (role === 'title') {
        const lines = Array.from(ch.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6'));
        if (lines.length > 0) {
          for (const l of lines) {
            const txt = renderInlines(l).trim();
            if (txt) sec.titleLines.push(txt);
          }
        } else {
          const txt = renderInlines(ch).trim();
          if (txt) sec.titleLines.push(txt);
        }
      } else if (role === 'epigraph') {
        const ep = renderEpigraph(ch);
        if (ep) sec.epigraphs.push(ep);
      } else if (role === 'annotation') {
        const ps = Array.from(ch.children)
          .map((p) => {
            const t = renderInlines(p).trim();
            return t ? `<p>${t}</p>` : '';
          })
          .filter(Boolean);
        if (ps.length > 0) sec.annotationXml = `<annotation>${ps.join('')}</annotation>`;
      } else {
        appendBlockToSection(ch, sec);
      }
    }
    return sec;
  };

  const appendBlockToSection = (el: Element, sec: SectionBuilder): void => {
    const tag = el.tagName.toLowerCase();
    if (isIgnoredElement(tag) || isPagebreak(el) || isInsideNoteContainer(el)) return;
    if (el.classList.contains('fb2-caption')) return;
    const role = semanticRoleOfClasses(el.classList);

    if (role === 'empty-line') {
      sec.blocks.push('<empty-line/>');
      return;
    }
    if (role === 'epigraph') {
      const ep = renderEpigraph(el);
      if (ep) {
        if (sec.blocks.length === 0 && sec.children.length === 0) sec.epigraphs.push(ep);
        else sec.blocks.push(renderCite(el));
      }
      return;
    }
    if (role === 'poem') {
      sec.blocks.push(renderPoem(el));
      return;
    }
    if (role === 'cite' || tag === 'blockquote') {
      const c = renderCite(el);
      if (c) sec.blocks.push(c);
      return;
    }
    if (role === 'subtitle') {
      const sid = registerId(el.getAttribute('id'));
      const t = renderInlines(el).trim();
      if (t)
        sec.blocks.push(
          sid ? `<subtitle id="${escAttr(sid)}">${t}</subtitle>` : `<subtitle>${t}</subtitle>`,
        );
      return;
    }
    if (tag === 'table') {
      const tbl = renderTable(el);
      if (tbl) sec.blocks.push(tbl);
      return;
    }
    const pushBlockImage = (imgXml: string): void => {
      if (
        sec.blocks.length === 0 &&
        sec.children.length === 0 &&
        !sec.annotationXml &&
        sec.leadingImages.length === 0
      ) {
        sec.leadingImages.push(imgXml);
      } else {
        sec.blocks.push(imgXml);
      }
    };
    if (tag === 'figure' || el.classList.contains('fb2-image')) {
      const img = el.querySelector('img');
      const cap = (el.querySelector('figcaption')?.textContent ?? '').trim() || undefined;
      if (img) {
        const blockImg = renderBlockImage(img, cap);
        if (blockImg) pushBlockImage(blockImg);
        return;
      }
    }
    if (tag === 'img') {
      const blockImg = renderBlockImage(el);
      if (blockImg) pushBlockImage(blockImg);
      return;
    }
    if (tag === 'svg') {
      const framed = singleFramedImageHref(el);
      if (framed) {
        const idx = parsePictureIndexFromHref(framed);
        if (idx !== null) {
          const bid = allocatePictureId(idx);
          if (bid) {
            counts.pictures++;
            sec.blocks.push(`<image l:href="#${escAttr(bid)}"/>`);
            return;
          }
        }
      }
      const id = picNames.allocate(`svg_${drawings.length + 1}.png`);
      const alt = (
        el.querySelector('title')?.textContent ??
        el.getAttribute('aria-label') ??
        ''
      ).trim();
      const markup = new XMLSerializer().serializeToString(el);
      const n = drawings.length;
      drawings.push({ id, markup, alt, display: true });
      sec.blocks.push(`<!--mfbe-svg-block:${n}-->`);
      return;
    }
    if (tag === 'math') {
      const id = picNames.allocate(`math_${formulas.length + 1}.png`);
      const alt = (el.getAttribute('alttext') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const markup = new XMLSerializer().serializeToString(el);
      const n = formulas.length;
      formulas.push({ id, markup, alt, display: true });
      sec.blocks.push(`<!--mfbe-math-block:${n}-->`);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      let idx = 1;
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        const inner = renderInlines(li).trim();
        if (inner) {
          const prefix = tag === 'ol' ? `${idx}. ` : '\u2022 ';
          sec.blocks.push(`<p>${escText(prefix)}${inner}</p>`);
        }
        idx++;
      }
      return;
    }
    if (tag === 'hr') {
      sec.blocks.push('<empty-line/>');
      return;
    }
    if (tag === 'pre') {
      const t = escText(el.textContent ?? '').trim();
      if (t) sec.blocks.push(`<p><code>${t}</code></p>`);
      return;
    }

    // Paragraph (or simple block holding only a single image/svg/math)
    if (
      tag === 'p' ||
      tag === 'div' ||
      tag === 'h1' ||
      tag === 'h2' ||
      tag === 'h3' ||
      tag === 'h4' ||
      tag === 'h5' ||
      tag === 'h6'
    ) {
      // Single standalone image inside <p> -> block <image/>
      if (
        el.children.length === 1 &&
        el.children[0]!.tagName.toLowerCase() === 'img' &&
        (el.textContent ?? '').trim() === ''
      ) {
        const blockImg = renderBlockImage(el.children[0]!);
        if (blockImg) {
          sec.blocks.push(blockImg);
          return;
        }
      }
      const rawId = el.getAttribute('id');
      const pid = registerId(rawId);
      const lang = (rawId && mfbe?.attrs.nodeLangs[rawId]) || el.getAttribute('lang') || '';
      const inner = Array.from(el.childNodes)
        .map((c) => renderInlines(c))
        .join('')
        .trim();
      if (!inner) return;

      const pattrs: string[] = [];
      if (pid) pattrs.push(`id="${escAttr(pid)}"`);
      if (lang) pattrs.push(`xml:lang="${escAttr(lang)}"`);
      // Named paragraph style
      for (const cls of Array.from(el.classList)) {
        if (isEditorRoundTrip) {
          if (cls in mfbe.attrs.styleNames) {
            pattrs.push(`style="${escAttr(mfbe.attrs.styleNames[cls]!)}"`);
            break;
          }
          if (!isConverterStructuralClass(cls)) {
            pattrs.push(`style="${escAttr(cls)}"`);
            break;
          }
        } else if (classPlan.named.has(cls) && cls !== classPlan.paragraphClass) {
          pattrs.push(`style="${escAttr(cls)}"`);
          break;
        }
      }
      const attrStr = pattrs.length > 0 ? ` ${pattrs.join(' ')}` : '';
      sec.blocks.push(`<p${attrStr}>${inner}</p>`);
    }
  };

  // Render an `<annotation>` or `<history>` container (`annotationType`: p | poem | cite | subtitle | empty-line | table).
  const renderAnnotationContainer = (
    container: Element,
    tag: 'annotation' | 'history',
  ): string | null => {
    const innerWrapper =
      Array.from(container.children).find((c) => c.classList.contains(`fb2-${tag}`)) ?? container;
    const rawId = innerWrapper.getAttribute('id');
    const aid =
      rawId && rawId !== 'fb2-annotation' && rawId !== 'fb2-history'
        ? registerId(rawId)
        : undefined;
    const lang =
      (rawId && mfbe?.attrs.nodeLangs[rawId]) ||
      innerWrapper.getAttribute('lang') ||
      container.getAttribute('lang') ||
      '';
    const parts: string[] = [];

    const visitBlocks = (parent: Element): void => {
      for (const ch of Array.from(parent.children)) {
        const ctag = ch.tagName.toLowerCase();
        if (isIgnoredElement(ctag) || isPagebreak(ch) || ch.classList.contains('fb2-doc-version')) {
          continue;
        }
        const role = semanticRoleOfClasses(ch.classList);
        if (role === 'empty-line' || ctag === 'hr') {
          parts.push('<empty-line/>');
        } else if (role === 'poem') {
          parts.push(renderPoem(ch));
        } else if (role === 'cite' || ctag === 'blockquote') {
          const c = renderCite(ch);
          if (c) parts.push(c);
        } else if (role === 'subtitle' || /^h[1-6]$/.test(ctag)) {
          const sid = registerId(ch.getAttribute('id'));
          const t = renderInlines(ch).trim();
          if (t) {
            parts.push(
              sid ? `<subtitle id="${escAttr(sid)}">${t}</subtitle>` : `<subtitle>${t}</subtitle>`,
            );
          }
        } else if (ctag === 'table') {
          const tbl = renderTable(ch);
          if (tbl) parts.push(tbl);
        } else if (ctag === 'ul' || ctag === 'ol') {
          let idx = 1;
          for (const li of Array.from(ch.children)) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            const inner = renderInlines(li).trim();
            if (inner) {
              const prefix = ctag === 'ol' ? `${idx}. ` : '\u2022 ';
              parts.push(`<p>${escText(prefix)}${inner}</p>`);
            }
            idx++;
          }
        } else if (
          ctag === 'div' &&
          Array.from(ch.children).some((gc) =>
            /^(div|p|h[1-6]|ul|ol|table|blockquote|hr)$/i.test(gc.tagName),
          )
        ) {
          visitBlocks(ch);
        } else {
          const pid = registerId(ch.getAttribute('id'));
          const plang =
            (ch.getAttribute('id') && mfbe?.attrs.nodeLangs[ch.getAttribute('id')!]) ||
            ch.getAttribute('lang') ||
            '';
          const inner = Array.from(ch.childNodes)
            .map((c) => renderInlines(c))
            .join('')
            .trim();
          if (inner) {
            const pattrs: string[] = [];
            if (pid) pattrs.push(`id="${escAttr(pid)}"`);
            if (plang) pattrs.push(`xml:lang="${escAttr(plang)}"`);
            parts.push(
              pattrs.length > 0 ? `<p ${pattrs.join(' ')}>${inner}</p>` : `<p>${inner}</p>`,
            );
          }
        }
      }
    };

    visitBlocks(innerWrapper);
    if (parts.length === 0) {
      const t = renderInlines(innerWrapper).trim();
      if (t) parts.push(`<p>${t}</p>`);
    }
    if (parts.length === 0) return null;
    const attrs: string[] = [];
    if (aid) attrs.push(`id="${escAttr(aid)}"`);
    if (lang) attrs.push(`xml:lang="${escAttr(lang)}"`);
    return attrs.length > 0
      ? `<${tag} ${attrs.join(' ')}>${parts.join('')}</${tag}>`
      : `<${tag}>${parts.join('')}</${tag}>`;
  };

  // Extract dedicated annotation & history pages (editor exports) or safe foreign colophon back-matter.
  const capturedDescriptionEls = new Set<Element>();
  let annotationXml: string | null = null;
  let historyXml: string | null = null;

  if (body) {
    const annEl = body.querySelector('#fb2-annotation, .fb2-annotation-page');
    if (annEl) {
      annotationXml = renderAnnotationContainer(annEl, 'annotation');
      capturedDescriptionEls.add(annEl);
    }
    const histEl = body.querySelector('#fb2-history, .fb2-history-page');
    if (histEl) {
      historyXml = renderAnnotationContainer(histEl, 'history');
      capturedDescriptionEls.add(histEl);
    } else if (!isEditorRoundTrip) {
      // Foreign colophon back-matter -> `<document-info><history>` only when safe (text-based,
      // no block images / subsections, and not the sole content of the book).
      const totalBodyText = (body.textContent ?? '').trim().length;
      for (const el of Array.from(body.querySelectorAll('div, section, aside, article'))) {
        if (isInsideNoteContainer(el)) continue;
        const eid = el.getAttribute('id') ?? '';
        const etype = (getAttrIgnoreNs(el, 'type') ?? '').toLowerCase();
        const isColophon =
          etype === 'colophon' || (eid !== '' && guideTypesById.get(eid) === 'colophon');
        if (!isColophon) continue;
        const elTextLen = (el.textContent ?? '').trim().length;
        const hasOtherText = totalBodyText - elTextLen > 0;
        const hasBlockImg =
          el.querySelector('figure, svg') !== null ||
          Array.from(el.querySelectorAll('img')).some(
            (img) => (img.parentElement?.textContent ?? '').trim().length === 0,
          );
        const hasSubsections =
          el.querySelector('section') !== null || el.querySelectorAll('h1, h2, h3').length > 1;
        if (hasOtherText && !hasBlockImg && !hasSubsections) {
          historyXml = renderAnnotationContainer(el, 'history');
          if (historyXml) {
            capturedDescriptionEls.add(el);
            break;
          }
        }
      }
    }
  }

  const isInsideCapturedDescription = (el: Element): boolean => {
    let cur: Element | null = el;
    while (cur && cur !== body) {
      if (capturedDescriptionEls.has(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  // Build bodies XML (editor round-trip vs foreign heading-driven hierarchy).
  const bodiesXml: string[] = [];

  if (isEditorRoundTrip && body && body.querySelector('.fb2-body')) {
    const bodyEls = Array.from(body.querySelectorAll('.fb2-body'));
    let emittedMainBody = false;
    for (let bi = 0; bi < bodyEls.length; bi++) {
      const bEl = bodyEls[bi]!;
      const bodyIdx = Number.parseInt(
        bEl.getAttribute('data-fb2-body') ?? bEl.getAttribute('data-body-idx') ?? String(bi),
        10,
      );
      const bodyAttr = mfbe.attrs.bodies.find((b) => b.index === bodyIdx);
      const bName = bodyAttr?.name ?? bEl.getAttribute('data-body-name') ?? '';
      if (bEl.id === 'fb2-notes' || bEl.classList.contains('fb2-notes') || bName === 'notes') {
        continue;
      }
      const bLang = bodyAttr?.lang ?? bEl.getAttribute('lang') ?? '';
      const bAttrs: string[] = [];
      if (bName) bAttrs.push(`name="${escAttr(bName)}"`);
      if (bLang) bAttrs.push(`xml:lang="${escAttr(bLang)}"`);
      const openBody = bAttrs.length > 0 ? `<body ${bAttrs.join(' ')}>` : '<body>';

      let leadingCoverXml = '';
      if (!emittedMainBody && mfbe.attrs.bodyLeadingCover) {
        const lc = mfbe.attrs.bodyLeadingCover;
        const attrs: string[] = [`l:href="${escAttr(lc.href)}"`];
        if (lc.alt) attrs.push(`alt="${escAttr(lc.alt)}"`);
        if (lc.title) attrs.push(`title="${escAttr(lc.title)}"`);
        const cid = registerId(lc.id);
        if (cid) attrs.push(`id="${escAttr(cid)}"`);
        leadingCoverXml = `<image ${attrs.join(' ')}/>`;
      }
      emittedMainBody = true;

      const secs: string[] = [];
      for (const ch of Array.from(bEl.children)) {
        await maybeYield();
        const role = semanticRoleOfClasses(ch.classList);
        if (role === 'section' || ch.tagName.toLowerCase() === 'section') {
          secs.push(serializeSection(await renderRoundTripSection(ch)));
        }
      }
      if (secs.length === 0) {
        const fallback = makeSection(1);
        for (const ch of Array.from(bEl.children)) {
          if ((++walkedNodes & 63) === 0) await maybeYield();
          appendBlockToSection(ch, fallback);
        }
        counts.sections++;
        secs.push(serializeSection(fallback));
      }
      bodiesXml.push(`${openBody}${leadingCoverXml}${secs.join('')}</body>`);
    }
  } else if (body) {
    // Foreign book: heading-driven & nav-aware section hierarchy.
    const root = makeSection(0);
    const stack: SectionBuilder[] = [root];

    const openHeadingSection = (level: number, titleHtml: string, rawId?: string | null): void => {
      while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
        stack.pop();
      }
      const sec = makeSection(level, registerId(rawId));
      if (titleHtml) sec.titleLines.push(titleHtml);
      counts.sections++;
      stack[stack.length - 1]!.children.push(sec);
      stack.push(sec);
    };

    const currentSection = (): SectionBuilder => {
      if (stack.length === 1) {
        const sec = makeSection(1);
        counts.sections++;
        root.children.push(sec);
        stack.push(sec);
      }
      return stack[stack.length - 1]!;
    };

    const walkForeign = async (container: Element): Promise<void> => {
      for (const child of Array.from(container.children)) {
        if ((++walkedNodes & 63) === 0) await maybeYield();
        const tag = child.tagName.toLowerCase();
        if (
          isIgnoredElement(tag) ||
          isInsideNoteContainer(child) ||
          isInsideCapturedDescription(child)
        )
          continue;

        const fm = isFrontMatterBlock(
          child,
          guideTypesById,
          options.coverIndex,
          options.metadata,
          isEditorRoundTrip,
        );
        if (fm) continue;

        if (isPagebreak(child)) continue;

        const role = semanticRoleOfClasses(child.classList);
        const hMatch = /^h([1-6])$/.exec(tag);
        if (hMatch || role === 'title') {
          const level = hMatch ? Number.parseInt(hMatch[1]!, 10) : 2;
          const rawId = child.getAttribute('id');
          const titleHtml = renderInlines(child).trim();
          if (titleHtml) {
            openHeadingSection(level, titleHtml, rawId);
            continue;
          }
        }

        // Check if element matches an INDX nav entry and wraps multiple blocks
        const elId = child.getAttribute('id') ?? '';
        const navHit = elId ? navByAnchorId.get(elId) : undefined;
        if (navHit && (tag === 'div' || tag === 'section' || tag === 'article')) {
          const headingChild = Array.from(child.children).find((c) =>
            /^h[1-6]$/.test(c.tagName.toLowerCase()),
          );
          if (!headingChild && navHit.label.trim()) {
            openHeadingSection(
              Math.min(6, Math.max(1, navHit.depth + 1)),
              escText(navHit.label),
              elId,
            );
            await walkForeign(child);
            continue;
          }
        }

        // Structural wrapper div/section/article/main -> descend unless semantic block
        if (
          (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main') &&
          role !== 'epigraph' &&
          role !== 'poem' &&
          role !== 'cite' &&
          role !== 'subtitle' &&
          role !== 'empty-line'
        ) {
          // If it only has inline text directly without block children, treat as a paragraph
          const hasBlockChild = Array.from(child.children).some((c) =>
            /^(div|section|article|p|h[1-6]|ul|ol|table|blockquote|figure|pre|hr|svg|math)$/i.test(
              c.tagName,
            ),
          );
          if (hasBlockChild) {
            await walkForeign(child);
            continue;
          }
        }

        appendBlockToSection(child, currentSection());
      }
    };

    await walkForeign(body);

    const topSections =
      root.children.length > 0
        ? root.children.map(serializeSection)
        : [serializeSection(makeSection(1))];
    if (root.children.length === 0) counts.sections = 1;
    bodiesXml.push(`<body>${topSections.join('')}</body>`);
  }

  // Build `<body name="notes">` from detected footnotes.
  const noteSectionsXml: string[] = [];
  if (body) {
    const processedNoteEls = new Set<Element>();
    const addNoteSection = (noteEl: Element, fallbackId?: string): void => {
      if (processedNoteEls.has(noteEl)) return;
      processedNoteEls.add(noteEl);
      const rawId =
        noteEl.getAttribute('id') ??
        noteEl.querySelector('[id]')?.getAttribute('id') ??
        fallbackId ??
        undefined;
      const nid = registerId(rawId);
      const sec = makeSection(1, nid);
      const titleEl = noteEl.querySelector('.fb2-note-title, h2, h3, h4');
      if (titleEl) {
        const t = renderInlines(titleEl).trim();
        if (t) sec.titleLines.push(t);
      }
      if (noteEl.tagName.toLowerCase() === 'p') {
        const inner = Array.from(noteEl.childNodes)
          .map((c) => renderInlines(c))
          .join('')
          .trim();
        if (inner) sec.blocks.push(`<p>${inner}</p>`);
      } else {
        for (const ch of Array.from(noteEl.children)) {
          if (ch === titleEl || ch.classList.contains('fb2-backlink')) continue;
          const inner = Array.from(ch.childNodes)
            .map((c) => renderInlines(c))
            .join('')
            .trim();
          if (inner) sec.blocks.push(`<p>${inner}</p>`);
        }
        if (sec.blocks.length === 0) {
          const inner = Array.from(noteEl.childNodes)
            .map((c) => renderInlines(c))
            .join('')
            .trim();
          if (inner) sec.blocks.push(`<p>${inner}</p>`);
        }
      }
      counts.notes++;
      noteSectionsXml.push(serializeSection(sec));
    };

    const notesContainer = body.querySelector('#fb2-notes, .fb2-notes');
    if (notesContainer) {
      for (const item of Array.from(notesContainer.children)) {
        if (
          item.classList.contains('fb2-note') ||
          item.tagName.toLowerCase() === 'aside' ||
          item.getAttribute('id')
        ) {
          addNoteSection(item);
        }
      }
    }
    for (const el of noteElements) {
      if (el === notesContainer) continue;
      if (notesContainer && notesContainer.contains(el)) continue;
      addNoteSection(el);
    }
    for (const tgtId of noteTargetIds) {
      if (idMap.has(tgtId)) continue;
      const el = doc.getElementById(tgtId);
      if (el) addNoteSection(el, tgtId);
    }
  }

  let bodyXml = bodiesXml.join('') || '<body><section><p/></section></body>';
  let notesXml =
    noteSectionsXml.length > 0 ? `<body name="notes">${noteSectionsXml.join('')}</body>` : null;

  // Final pass: resolve internal link placeholders; degrade dangling `#id` links to plain text
  // so imported FB2 is always 100% valid against FictionBook.xsd!
  const resolveLinks = (xml: string): string =>
    xml.replace(
      /<!--mfbe-link:([^:]*):(note|int)-->([\s\S]*?)<!--\/mfbe-link-->/g,
      (_, rawTarget: string, kind: string, inner: string) => {
        const mapped = idMap.get(rawTarget);
        if (mapped && emittedIds.has(mapped)) {
          const typeAttr = kind === 'note' ? ' type="note"' : '';
          return `<a l:href="#${escAttr(mapped)}"${typeAttr}>${inner}</a>`;
        }
        return inner;
      },
    );

  await maybeYield(true);
  bodyXml = resolveLinks(bodyXml);
  if (notesXml !== null) notesXml = resolveLinks(notesXml);
  if (annotationXml !== null) annotationXml = resolveLinks(annotationXml);
  if (historyXml !== null) historyXml = resolveLinks(historyXml);
  await maybeYield(true);

  return {
    bodyXml,
    notesXml,
    annotationXml,
    historyXml,
    stylesheets,
    neededPictures,
    coverBinaryId,
    drawings,
    formulas,
    summary,
    counts,
  };
}
