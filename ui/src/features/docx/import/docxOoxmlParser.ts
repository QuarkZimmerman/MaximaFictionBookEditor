/**
 * Feature 023 (T025 & T032; contracts/docx-file.md §4): OOXML WordprocessingML parser supporting
 * both foreign `.docx` documents (headings, semantic inline marks, tracked changes `w:ins`/`w:del`,
 * comments, OMML equations -> plain text, `numbering.xml` lists, tables with spans + nested table
 * flattening, footnotes/endnotes, SVG paired raster preference, `Title` style fallback) and
 * editor-exported reversible round-trip documents (`exact` and externally `modified` modes).
 */
import {
  INVALID_XML_CHARS,
  type DocxBlockHint,
  type DocxBlockKind,
  type DocxBodyHint,
  type DocxInlineSpanHint,
  type DocxNoteHint,
  type DocxSectionHint,
  type DocxSummaryItem,
  type DocxTableAttrsHint,
} from '../shared/docxRoundtripTypes';
import {
  createRoundtripLookup,
  type DocxRoundtripLookup,
  type ResolvedDocxRoundtrip,
} from './docxRoundtripRestorer';

export class DocxEmptyError extends Error {
  constructor() {
    super('DOCX document contains no importable content');
    this.name = 'DocxEmptyError';
  }
}

export interface ParsedDocxCoreProps {
  title: string;
  creators: string[];
  description: string;
  subjects: string[];
  keywords: string;
  language: string;
  created: string;
}

export interface ParsedInlineSegment {
  kind: 'text' | 'image' | 'noteRef';
  text?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  sub?: boolean;
  sup?: boolean;
  code?: boolean;
  styleName?: string;
  lang?: string;
  linkHref?: string;
  linkExternal?: boolean;
  /** For `kind === 'image'` */
  mediaEntry?: string;
  isSvg?: boolean;
  alt?: string;
  /** For `kind === 'noteRef'` */
  noteKey?: string;
}

export interface ParsedTableCell {
  header: boolean;
  colspan: number;
  rowspan: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  id?: string;
  style?: string;
  inlines: ParsedInlineSegment[];
}

export interface ParsedTableRow {
  align?: 'left' | 'center' | 'right';
  cells: ParsedTableCell[];
}

export interface ParsedBlock {
  type: 'paragraph' | 'heading' | 'image' | 'table' | 'empty-line';
  /** Heading level 1..6 when `type === 'heading'` */
  level?: number;
  /** Semantic style hint inferred from Word styles (foreign) or round-trip hints */
  semanticKind?: DocxBlockKind;
  bookmarks: string[];
  styleId?: string;
  inlines?: ParsedInlineSegment[];
  /** Block image fields */
  mediaEntry?: string;
  isSvg?: boolean;
  alt?: string;
  title?: string;
  imageId?: string;
  /** Table fields */
  rows?: ParsedTableRow[];
  tableAttrs?: DocxTableAttrsHint;
  /** Round-trip hints attached to this block */
  bodyHint?: DocxBodyHint;
  sectionHint?: DocxSectionHint;
  blockHint?: DocxBlockHint;
  inlineSpans?: DocxInlineSpanHint[];
  unreferencedNoteHint?: DocxNoteHint;
  isUnreferencedNotesStart?: boolean;
}

export interface ParsedDocxNote {
  key: string; // e.g. "fn_1", "en_2", or "un_1"
  docxNoteId?: number;
  source: 'footnote' | 'endnote' | 'unreferenced';
  label: string;
  blocks: ParsedBlock[];
  hint?: DocxNoteHint;
}

export interface ParsedDocxImageNeed {
  mediaEntry: string;
  isSvg: boolean;
  suggestedBinaryId: string;
  alt?: string;
  title?: string;
  id?: string;
}

export interface ParsedDocxDocument {
  core: ParsedDocxCoreProps;
  titleFallback: string;
  blocks: ParsedBlock[];
  notes: ParsedDocxNote[];
  neededImages: Map<string, ParsedDocxImageNeed>;
  coverMediaEntry?: string;
  coverAlt?: string;
  roundtrip: ResolvedDocxRoundtrip;
  summary: DocxSummaryItem[];
}

export interface ParseDocxInput {
  documentXml: string;
  documentRelsXml?: string;
  stylesXml?: string;
  numberingXml?: string;
  footnotesXml?: string;
  footnotesRelsXml?: string;
  endnotesXml?: string;
  endnotesRelsXml?: string;
  coreXml?: string;
  headerFooterCount?: number;
  roundtrip: ResolvedDocxRoundtrip;
}

interface RelTarget {
  type: string;
  target: string;
  external: boolean;
}

interface StyleDef {
  id: string;
  name: string;
  basedOn?: string;
  outlineLvl?: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  sub?: boolean;
  sup?: boolean;
  isCode?: boolean;
}

interface NumberingLevel {
  numFmt: string;
  lvlText: string;
  start: number;
}

function parseXmlDoc(xml: string): globalThis.Document | null {
  if (!xml.trim()) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) return null;
  return doc;
}

function localNameOf(el: Element): string {
  return el.localName || el.nodeName.split(':').pop() || '';
}

function attrVal(el: Element, localName: string): string | null {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]!;
    const ln = a.localName || a.name.split(':').pop();
    if (ln === localName) return a.value;
  }
  return null;
}

function childElements(parent: Element, localName?: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const el = n as Element;
      if (!localName || localNameOf(el) === localName) out.push(el);
    }
  }
  return out;
}

function firstChild(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && localNameOf(n as Element) === localName) return n as Element;
  }
  return null;
}

function normalizeWordTarget(target: string): string {
  const clean = target.replace(/\\/g, '/').replace(/^\.\//, '');
  if (clean.startsWith('/')) return clean.slice(1);
  if (clean.startsWith('../')) return clean.replace(/^\.\.\//, '');
  if (clean.startsWith('word/')) return clean;
  return `word/${clean}`;
}

function parseRels(xml: string | undefined): Map<string, RelTarget> {
  const map = new Map<string, RelTarget>();
  if (!xml) return map;
  const doc = parseXmlDoc(xml);
  if (!doc) return map;
  for (const el of childElements(doc.documentElement, 'Relationship')) {
    const id = attrVal(el, 'Id');
    const type = attrVal(el, 'Type') ?? '';
    const target = attrVal(el, 'Target') ?? '';
    const mode = (attrVal(el, 'TargetMode') ?? '').toLowerCase();
    if (id && target) {
      map.set(id, {
        type,
        target: mode === 'external' ? target : normalizeWordTarget(target),
        external: mode === 'external',
      });
    }
  }
  return map;
}

function parseBoolProp(rPr: Element, tag: string): boolean | undefined {
  const el = firstChild(rPr, tag);
  if (!el) return undefined;
  const v = (attrVal(el, 'val') ?? 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'none';
}

function parseStyles(xml: string | undefined): Map<string, StyleDef> {
  const map = new Map<string, StyleDef>();
  if (!xml) return map;
  const doc = parseXmlDoc(xml);
  if (!doc) return map;
  for (const st of childElements(doc.documentElement, 'style')) {
    const id = attrVal(st, 'styleId');
    if (!id) continue;
    const nameEl = firstChild(st, 'name');
    const name = attrVal(nameEl ?? st, 'val') ?? id;
    const basedOnEl = firstChild(st, 'basedOn');
    const basedOn = basedOnEl ? (attrVal(basedOnEl, 'val') ?? undefined) : undefined;
    const pPr = firstChild(st, 'pPr');
    const outlineEl = pPr ? firstChild(pPr, 'outlineLvl') : null;
    const outlineStr = outlineEl ? attrVal(outlineEl, 'val') : null;
    const outlineLvl = outlineStr !== null ? parseInt(outlineStr, 10) : undefined;
    const rPr = firstChild(st, 'rPr');
    let bold: boolean | undefined;
    let italic: boolean | undefined;
    let strike: boolean | undefined;
    let sub: boolean | undefined;
    let sup: boolean | undefined;
    let isCode: boolean | undefined;
    if (rPr) {
      bold = parseBoolProp(rPr, 'b');
      italic = parseBoolProp(rPr, 'i');
      strike = parseBoolProp(rPr, 'strike') ?? parseBoolProp(rPr, 'dstrike');
      const va = firstChild(rPr, 'vertAlign');
      const vaVal = va ? (attrVal(va, 'val') ?? '').toLowerCase() : '';
      if (vaVal === 'subscript') sub = true;
      else if (vaVal === 'superscript') sup = true;
      const rFonts = firstChild(rPr, 'rFonts');
      const ascii = rFonts ? (attrVal(rFonts, 'ascii') ?? '').toLowerCase() : '';
      if (/courier|consolas|mono|menlo|dejavu sans mono/.test(ascii)) isCode = true;
    }
    if (/code|verbatim|preformatted/i.test(id) || /code|verbatim/i.test(name)) isCode = true;
    map.set(id, {
      id,
      name,
      basedOn,
      outlineLvl: Number.isFinite(outlineLvl) ? outlineLvl : undefined,
      bold,
      italic,
      strike,
      sub,
      sup,
      isCode,
    });
  }
  return map;
}

function resolveHeadingLevel(
  styleId: string | undefined,
  pPr: Element | null,
  styles: ReadonlyMap<string, StyleDef>,
): number | null {
  const directOutline = pPr ? firstChild(pPr, 'outlineLvl') : null;
  if (directOutline) {
    const v = parseInt(attrVal(directOutline, 'val') ?? '', 10);
    if (v >= 0 && v <= 5) return v + 1;
  }
  if (!styleId) return null;
  // Walk basedOn chain up to 8 hops.
  let cur: string | undefined = styleId;
  const visited = new Set<string>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const def = styles.get(cur);
    if (def?.outlineLvl !== undefined && def.outlineLvl >= 0 && def.outlineLvl <= 5) {
      return def.outlineLvl + 1;
    }
    const probe = `${cur} ${def?.name ?? ''}`;
    const hm = /\bheading\s*([1-6])\b/i.exec(probe) ?? /\bзаголовок\s*([1-6])\b/i.exec(probe);
    if (hm) return parseInt(hm[1]!, 10);
    cur = def?.basedOn;
  }
  return null;
}

function resolveStyleName(
  styleId: string | undefined,
  styles: ReadonlyMap<string, StyleDef>,
): string {
  if (!styleId) return '';
  return `${styleId} ${styles.get(styleId)?.name ?? ''}`.toLowerCase();
}

function parseNumbering(xml: string | undefined): Map<string, Map<number, NumberingLevel>> {
  const result = new Map<string, Map<number, NumberingLevel>>();
  if (!xml) return result;
  const doc = parseXmlDoc(xml);
  if (!doc) return result;
  const abstractMap = new Map<string, Map<number, NumberingLevel>>();
  for (const abs of childElements(doc.documentElement, 'abstractNum')) {
    const absId = attrVal(abs, 'abstractNumId');
    if (!absId) continue;
    const levels = new Map<number, NumberingLevel>();
    for (const lvl of childElements(abs, 'lvl')) {
      const ilvl = parseInt(attrVal(lvl, 'ilvl') ?? '0', 10);
      const numFmtEl = firstChild(lvl, 'numFmt');
      const lvlTextEl = firstChild(lvl, 'lvlText');
      const startEl = firstChild(lvl, 'start');
      levels.set(ilvl, {
        numFmt: (numFmtEl ? attrVal(numFmtEl, 'val') : null) ?? 'bullet',
        lvlText: (lvlTextEl ? attrVal(lvlTextEl, 'val') : null) ?? '•',
        start: parseInt((startEl ? attrVal(startEl, 'val') : null) ?? '1', 10) || 1,
      });
    }
    abstractMap.set(absId, levels);
  }
  for (const num of childElements(doc.documentElement, 'num')) {
    const numId = attrVal(num, 'numId');
    const absRef = firstChild(num, 'abstractNumId');
    const absId = absRef ? attrVal(absRef, 'val') : null;
    if (numId && absId && abstractMap.has(absId)) {
      result.set(numId, abstractMap.get(absId)!);
    }
  }
  return result;
}

function formatListNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter':
      return String.fromCharCode(97 + ((n - 1) % 26));
    case 'upperLetter':
      return String.fromCharCode(65 + ((n - 1) % 26));
    case 'lowerRoman':
      return toRoman(n).toLowerCase();
    case 'upperRoman':
      return toRoman(n);
    default:
      return String(n);
  }
}

function toRoman(num: number): string {
  const vals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rem = Math.max(1, Math.min(3999, num));
  let out = '';
  for (const [v, sym] of vals) {
    while (rem >= v) {
      out += sym;
      rem -= v;
    }
  }
  return out;
}

/** Converts an OOXML OMML `<m:oMath>` element into clean readable plain text (Clarify Pass 1 Q4). */
export function extractOmmlPlainText(node: Element): string {
  const ln = localNameOf(node);
  if (ln === 't') return node.textContent ?? '';
  if (ln === 'f') {
    const num = firstChild(node, 'num');
    const den = firstChild(node, 'den');
    const nt = num ? extractOmmlPlainText(num).trim() : '';
    const dt = den ? extractOmmlPlainText(den).trim() : '';
    return `(${nt})/(${dt})`;
  }
  if (ln === 'sSup') {
    const e = firstChild(node, 'e');
    const sup = firstChild(node, 'sup');
    return `${e ? extractOmmlPlainText(e) : ''}^(${sup ? extractOmmlPlainText(sup) : ''})`;
  }
  if (ln === 'sSub') {
    const e = firstChild(node, 'e');
    const sub = firstChild(node, 'sub');
    return `${e ? extractOmmlPlainText(e) : ''}_(${sub ? extractOmmlPlainText(sub) : ''})`;
  }
  if (ln === 'sSubSup') {
    const e = firstChild(node, 'e');
    const sub = firstChild(node, 'sub');
    const sup = firstChild(node, 'sup');
    return `${e ? extractOmmlPlainText(e) : ''}_(${sub ? extractOmmlPlainText(sub) : ''})^(${sup ? extractOmmlPlainText(sup) : ''})`;
  }
  if (ln === 'rad') {
    const deg = firstChild(node, 'deg');
    const e = firstChild(node, 'e');
    const degText = deg ? extractOmmlPlainText(deg).trim() : '';
    const eText = e ? extractOmmlPlainText(e).trim() : '';
    return degText ? `root(${degText}, ${eText})` : `sqrt(${eText})`;
  }
  if (ln === 'nary') {
    const naryPr = firstChild(node, 'naryPr');
    const chrEl = naryPr ? firstChild(naryPr, 'chr') : null;
    const chr = (chrEl ? attrVal(chrEl, 'val') : null) || '∑';
    const sub = firstChild(node, 'sub');
    const sup = firstChild(node, 'sup');
    const e = firstChild(node, 'e');
    const bounds = [
      sub ? extractOmmlPlainText(sub).trim() : '',
      sup ? extractOmmlPlainText(sup).trim() : '',
    ]
      .filter(Boolean)
      .join('..');
    return `${chr}${bounds ? `(${bounds})` : ''} ${e ? extractOmmlPlainText(e).trim() : ''}`.trim();
  }
  let out = '';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) out += extractOmmlPlainText(child as Element);
  }
  return out;
}

function parseCoreProps(xml: string | undefined): ParsedDocxCoreProps {
  const empty: ParsedDocxCoreProps = {
    title: '',
    creators: [],
    description: '',
    subjects: [],
    keywords: '',
    language: '',
    created: '',
  };
  if (!xml) return empty;
  const doc = parseXmlDoc(xml);
  if (!doc) return empty;
  const textOf = (localName: string): string => {
    for (const el of childElements(doc.documentElement)) {
      if (localNameOf(el) === localName) return (el.textContent ?? '').trim();
    }
    return '';
  };
  const creatorRaw = textOf('creator');
  const creators = creatorRaw
    ? creatorRaw
        .split(/[;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const subjRaw = textOf('subject');
  const subjects = subjRaw
    ? subjRaw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const createdRaw = textOf('created');
  const created = /^\d{4}-\d{2}-\d{2}/.test(createdRaw) ? createdRaw.slice(0, 10) : createdRaw;
  return {
    title: textOf('title'),
    creators,
    description: textOf('description'),
    subjects,
    keywords: textOf('keywords'),
    language: textOf('language'),
    created,
  };
}

function isRasterEntry(path: string): boolean {
  return /\.(?:png|jpe?g|gif|bmp|webp|tiff?)$/i.test(path);
}

function isSvgEntry(path: string): boolean {
  return /\.svg$/i.test(path);
}

function isUnsupportedVectorEntry(path: string): boolean {
  return /\.(?:wmf|emf|emz|wmz)$/i.test(path);
}

function defaultBinaryIdFromMedia(entry: string, seq: number): string {
  const base = entry.split('/').pop() || `image${seq}`;
  const clean = base.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(clean) ? clean : `img_${clean}`;
}

export function parseDocxOoxml(input: ParseDocxInput): ParsedDocxDocument {
  const doc = parseXmlDoc(input.documentXml);
  if (!doc) {
    throw new Error('Malformed word/document.xml');
  }
  const bodyEl = firstChild(doc.documentElement, 'body');
  if (!bodyEl) {
    throw new DocxEmptyError();
  }

  const docRels = parseRels(input.documentRelsXml);
  const styles = parseStyles(input.stylesXml);
  const numbering = parseNumbering(input.numberingXml);
  const core = parseCoreProps(input.coreXml);

  const lookup: DocxRoundtripLookup | null =
    input.roundtrip.payload &&
    (input.roundtrip.mode === 'exact' || input.roundtrip.mode === 'modified')
      ? createRoundtripLookup(input.roundtrip.payload, input.roundtrip.mode)
      : null;

  const isForeign = !lookup;
  const summary: DocxSummaryItem[] = [...input.roundtrip.summary];

  // Counters for clean aggregated summary reporting.
  let deletedCount = 0;
  const commentIds = new Set<string>();
  let equationCount = 0;
  let droppedStylingCount = 0;
  let droppedUnsupportedDrawingsCount = 0;
  let droppedOleCount = 0;
  let droppedRemoteImagesCount = 0;
  let flattenedNestedTablesCount = 0;
  let strippedControlCharsCount = 0;

  const neededImages = new Map<string, ParsedDocxImageNeed>();
  const usedSuggestedIds = new Set<string>();
  let imageSeq = 0;

  const uniqueSuggestedId = (raw: string): string => {
    let candidate = raw;
    for (let n = 2; usedSuggestedIds.has(candidate); n++) {
      const dot = raw.lastIndexOf('.');
      candidate = dot > 0 ? `${raw.slice(0, dot)}_${n}${raw.slice(dot)}` : `${raw}_${n}`;
    }
    usedSuggestedIds.add(candidate);
    return candidate;
  };

  const registerImageNeed = (
    mediaEntry: string,
    isSvg: boolean,
    alt?: string,
    title?: string,
    id?: string,
  ): void => {
    if (neededImages.has(mediaEntry)) return;
    imageSeq++;
    const hint = lookup?.findPictureHint(mediaEntry);
    const baseId = hint?.binaryId || defaultBinaryIdFromMedia(mediaEntry, imageSeq);
    const finalId = uniqueSuggestedId(isSvg ? baseId.replace(/\.svg$/i, '.png') : baseId);
    neededImages.set(mediaEntry, {
      mediaEntry,
      isSvg,
      suggestedBinaryId: finalId,
      alt: alt || hint?.alt,
      title: title || hint?.title,
      id: id || hint?.id,
    });
  };

  const cleanText = (s: string): string => {
    if (INVALID_XML_CHARS.test(s)) {
      INVALID_XML_CHARS.lastIndex = 0;
      const cleaned = s.replace(INVALID_XML_CHARS, '');
      strippedControlCharsCount += s.length - cleaned.length;
      return cleaned;
    }
    return s;
  };

  // List counters per `(numId, ilvl)`
  const listCounters = new Map<string, number[]>();
  const nextListPrefix = (numId: string, ilvl: number): string => {
    const levels = numbering.get(numId);
    const def = levels?.get(ilvl);
    if (!def || def.numFmt === 'bullet' || def.numFmt === 'none') {
      return def?.numFmt === 'none' ? '' : '• ';
    }
    let stack = listCounters.get(numId);
    if (!stack) {
      stack = [];
      listCounters.set(numId, stack);
    }
    if (stack[ilvl] === undefined) stack[ilvl] = def.start;
    else stack[ilvl] = stack[ilvl]! + 1;
    // Reset deeper levels
    for (let d = ilvl + 1; d < stack.length; d++) {
      const deeperDef = levels?.get(d);
      stack[d] = (deeperDef?.start ?? 1) - 1;
    }
    let formatted = def.lvlText;
    for (let d = 0; d <= ilvl; d++) {
      const lvDef = levels?.get(d);
      const count = stack[d] ?? lvDef?.start ?? 1;
      formatted = formatted.replace(
        `%${d + 1}`,
        formatListNumber(count, lvDef?.numFmt ?? 'decimal'),
      );
    }
    return `${formatted} `;
  };

  // Extract drawing image (preferring paired raster `<a:blip>` over `<asvg:svgBlip>`!).
  const extractDrawing = (
    drawingEl: Element,
    rels: ReadonlyMap<string, RelTarget>,
  ): { mediaEntry: string; isSvg: boolean; alt?: string } | { textboxText: string } | null => {
    // Check for chart / SmartArt
    const allDescendants = Array.from(drawingEl.getElementsByTagName('*'));
    const hasChartOrDiagram = allDescendants.some((el) => {
      const ln = localNameOf(el);
      return ln === 'chart' || ln === 'relIds';
    });
    if (hasChartOrDiagram) {
      droppedUnsupportedDrawingsCount++;
      return null;
    }

    // Grab alt description from wp:docPr if present.
    let alt: string | undefined;
    for (const el of allDescendants) {
      if (localNameOf(el) === 'docPr') {
        const d = attrVal(el, 'descr') ?? attrVal(el, 'title');
        if (d?.trim()) {
          alt = cleanText(d.trim());
          break;
        }
      }
    }

    // Look for `<a:blip>` (main raster or SVG) and `<asvg:svgBlip>`.
    let rasterEntry: string | null = null;
    let svgEntry: string | null = null;
    let sawRemote = false;
    let sawUnsupportedVector = false;

    for (const el of allDescendants) {
      const ln = localNameOf(el);
      if (ln === 'blip' || ln === 'svgBlip' || ln === 'imagedata') {
        const linkId = attrVal(el, 'link');
        if (linkId) {
          sawRemote = true;
          continue;
        }
        const embedId = attrVal(el, 'embed') ?? attrVal(el, 'id');
        if (!embedId) continue;
        const rel = rels.get(embedId);
        if (!rel) continue;
        if (rel.external || /^https?:\/\//i.test(rel.target)) {
          sawRemote = true;
          continue;
        }
        if (ln === 'svgBlip' || isSvgEntry(rel.target)) {
          if (!svgEntry) svgEntry = rel.target;
        } else if (isRasterEntry(rel.target)) {
          if (!rasterEntry) rasterEntry = rel.target;
        } else if (isUnsupportedVectorEntry(rel.target)) {
          sawUnsupportedVector = true;
        }
      }
    }

    if (rasterEntry) {
      return { mediaEntry: rasterEntry, isSvg: false, alt };
    }
    if (svgEntry) {
      return { mediaEntry: svgEntry, isSvg: true, alt };
    }
    if (sawRemote) {
      droppedRemoteImagesCount++;
      return null;
    }
    if (sawUnsupportedVector) {
      droppedUnsupportedDrawingsCount++;
      return null;
    }

    // Extract text from Word textbox if present instead of silently losing it.
    const txbx = allDescendants.find((el) => localNameOf(el) === 'txbxContent');
    if (txbx) {
      const txt = cleanText((txbx.textContent ?? '').replace(/\s+/g, ' ').trim());
      if (txt) return { textboxText: txt };
    }
    droppedUnsupportedDrawingsCount++;
    return null;
  };

  // Parse inline content of a `<w:p>` (or `<w:ins>` / `<w:hyperlink>`).
  const parseParagraphInlines = (
    container: Element,
    rels: ReadonlyMap<string, RelTarget>,
    inNote: boolean,
    noteSourceTag: 'footnote' | 'endnote' | null,
    linkCtx?: { href: string; external: boolean },
  ): { inlines: ParsedInlineSegment[]; bookmarks: string[] } => {
    const inlines: ParsedInlineSegment[] = [];
    const bookmarks: string[] = [];

    const walkInlineNode = (
      node: Element,
      activeLink?: { href: string; external: boolean },
    ): void => {
      const ln = localNameOf(node);
      if (ln === 'pPr') return;
      if (ln === 'bookmarkStart') {
        const name = attrVal(node, 'name');
        if (name && !name.startsWith('_')) bookmarks.push(name);
        return;
      }
      if (ln === 'commentRangeStart' || ln === 'commentRangeEnd') {
        const cid = attrVal(node, 'id');
        if (cid) commentIds.add(cid);
        return;
      }
      if (ln === 'del' || ln === 'moveFrom') {
        deletedCount++;
        return;
      }
      if (
        ln === 'ins' ||
        ln === 'moveTo' ||
        ln === 'smartTag' ||
        ln === 'sdt' ||
        ln === 'sdtContent'
      ) {
        for (const ch of childElements(node)) walkInlineNode(ch, activeLink);
        return;
      }
      if (ln === 'hyperlink') {
        const anchor = attrVal(node, 'anchor');
        const rId = attrVal(node, 'id');
        let nextLink: { href: string; external: boolean } | undefined;
        if (rId) {
          const rel = rels.get(rId);
          if (rel) {
            nextLink = {
              href: rel.target,
              external: rel.external || /^https?:|^mailto:/i.test(rel.target),
            };
          }
        } else if (anchor) {
          nextLink = { href: `#${anchor}`, external: false };
        }
        for (const ch of childElements(node)) walkInlineNode(ch, nextLink ?? activeLink);
        return;
      }
      if (ln === 'oMathPara' || ln === 'oMath') {
        const eqText = cleanText(extractOmmlPlainText(node).trim());
        if (eqText) {
          equationCount++;
          inlines.push({ kind: 'text', text: eqText });
        }
        return;
      }
      if (ln === 'r') {
        const rPr = firstChild(node, 'rPr');
        let bold = false;
        let italic = false;
        let strike = false;
        let sub = false;
        let sup = false;
        let code = false;
        let styleName: string | undefined;

        if (rPr) {
          const rStyleEl = firstChild(rPr, 'rStyle');
          const rStyleId = rStyleEl ? (attrVal(rStyleEl, 'val') ?? undefined) : undefined;
          if (rStyleId) {
            const mapped = lookup?.lookupCssFb2Style(rStyleId);
            if (mapped) styleName = mapped;
            const stDef = styles.get(rStyleId);
            if (stDef?.bold) bold = true;
            if (stDef?.italic) italic = true;
            if (stDef?.strike) strike = true;
            if (stDef?.sub) sub = true;
            if (stDef?.sup) sup = true;
            if (stDef?.isCode) code = true;
          }
          const b = parseBoolProp(rPr, 'b');
          if (b !== undefined) bold = b;
          const i = parseBoolProp(rPr, 'i');
          if (i !== undefined) italic = i;
          const s = parseBoolProp(rPr, 'strike') ?? parseBoolProp(rPr, 'dstrike');
          if (s !== undefined) strike = s;
          const va = firstChild(rPr, 'vertAlign');
          const vaVal = va ? (attrVal(va, 'val') ?? '').toLowerCase() : '';
          if (vaVal === 'subscript') sub = true;
          else if (vaVal === 'superscript') sup = true;

          const rFonts = firstChild(rPr, 'rFonts');
          const ascii = rFonts ? (attrVal(rFonts, 'ascii') ?? '').toLowerCase() : '';
          if (/courier|consolas|mono|menlo|dejavu sans mono/.test(ascii)) code = true;

          if (
            isForeign &&
            (firstChild(rPr, 'color') ||
              firstChild(rPr, 'highlight') ||
              firstChild(rPr, 'shd') ||
              firstChild(rPr, 'sz') ||
              (rFonts && !code))
          ) {
            droppedStylingCount++;
          }
        }

        for (const rc of childElements(node)) {
          const rcln = localNameOf(rc);
          if (rcln === 'rPr' || rcln === 'instrText' || rcln === 'fldChar' || rcln === 'delText') {
            continue;
          }
          if (rcln === 'commentReference') {
            const cid = attrVal(rc, 'id');
            if (cid) commentIds.add(cid);
            continue;
          }
          if (rcln === 'footnoteRef' || rcln === 'endnoteRef') {
            // Word's own auto-number placeholder inside footnotes.xml / endnotes.xml — skip.
            continue;
          }
          if (rcln === 'footnoteReference' && !inNote) {
            const idStr = attrVal(rc, 'id');
            const nid = idStr ? parseInt(idStr, 10) : 0;
            if (nid > 0) {
              inlines.push({ kind: 'noteRef', noteKey: `fn_${nid}` });
            }
            continue;
          }
          if (rcln === 'endnoteReference' && !inNote) {
            const idStr = attrVal(rc, 'id');
            const nid = idStr ? parseInt(idStr, 10) : 0;
            if (nid > 0) {
              inlines.push({ kind: 'noteRef', noteKey: `en_${nid}` });
            }
            continue;
          }
          if (rcln === 't') {
            const txt = cleanText(rc.textContent ?? '');
            if (txt.length > 0) {
              inlines.push({
                kind: 'text',
                text: txt,
                ...(bold ? { bold: true } : {}),
                ...(italic ? { italic: true } : {}),
                ...(strike ? { strike: true } : {}),
                ...(sub ? { sub: true } : {}),
                ...(sup ? { sup: true } : {}),
                ...(code ? { code: true } : {}),
                ...(styleName ? { styleName } : {}),
                ...(activeLink
                  ? { linkHref: activeLink.href, linkExternal: activeLink.external }
                  : {}),
              });
            }
          } else if (rcln === 'tab') {
            inlines.push({ kind: 'text', text: ' ' });
          } else if (rcln === 'br' || rcln === 'cr') {
            const brType = (attrVal(rc, 'type') ?? '').toLowerCase();
            if (brType !== 'page' && brType !== 'column') {
              inlines.push({ kind: 'text', text: '\n' });
            }
          } else if (rcln === 'drawing' || rcln === 'pict') {
            const extracted = extractDrawing(rc, rels);
            if (extracted && 'mediaEntry' in extracted) {
              registerImageNeed(extracted.mediaEntry, extracted.isSvg, extracted.alt);
              inlines.push({
                kind: 'image',
                mediaEntry: extracted.mediaEntry,
                isSvg: extracted.isSvg,
                alt: extracted.alt,
              });
            } else if (extracted && 'textboxText' in extracted) {
              inlines.push({ kind: 'text', text: extracted.textboxText });
            }
          } else if (rcln === 'object' || rcln === 'movie' || rcln === 'audio') {
            droppedOleCount++;
          }
        }
        return;
      }
      // Recurse into unexpected wrapper containers (e.g. `w:fldSimple`) without losing visible text.
      if (ln === 'fldSimple') {
        for (const ch of childElements(node)) walkInlineNode(ch, activeLink);
      }
    };

    for (const ch of childElements(container)) {
      walkInlineNode(ch, linkCtx);
    }

    // In footnotes/endnotes, strip a single leading whitespace left after omitting `<w:footnoteRef/>`.
    if (inNote && noteSourceTag && inlines.length > 0 && inlines[0]!.kind === 'text') {
      const trimmed = inlines[0]!.text!.replace(/^\s+/, '');
      if (trimmed.length === 0) inlines.shift();
      else inlines[0] = { ...inlines[0]!, text: trimmed };
    }

    return { inlines, bookmarks };
  };

  // Flatten a nested `<w:tbl>` inside a table cell into inline text.
  const flattenNestedTableToText = (tblEl: Element): string => {
    flattenedNestedTablesCount++;
    const rowTexts: string[] = [];
    for (const tr of childElements(tblEl, 'tr')) {
      const cellTexts: string[] = [];
      for (const tc of childElements(tr, 'tc')) {
        const parts: string[] = [];
        for (const child of childElements(tc)) {
          const cln = localNameOf(child);
          if (cln === 'p') {
            const t = cleanText((child.textContent ?? '').replace(/\s+/g, ' ').trim());
            if (t) parts.push(t);
          } else if (cln === 'tbl') {
            const sub = flattenNestedTableToText(child);
            if (sub) parts.push(sub);
          }
        }
        cellTexts.push(parts.join(' '));
      }
      const line = cellTexts.filter(Boolean).join(' | ');
      if (line) rowTexts.push(line);
    }
    return rowTexts.join('; ');
  };

  const parseTableElement = (
    tblEl: Element,
    rels: ReadonlyMap<string, RelTarget>,
    inNote: boolean,
  ): ParsedBlock => {
    const rawRows: Array<{
      isHeaderRow: boolean;
      cells: Array<{
        colspan: number;
        vMerge: 'none' | 'restart' | 'continue';
        align?: 'left' | 'center' | 'right';
        valign?: 'top' | 'middle' | 'bottom';
        inlines: ParsedInlineSegment[];
        bookmarks: string[];
      }>;
    }> = [];

    const tableBookmarks: string[] = [];
    const sampleTexts: string[] = [];

    for (const tr of childElements(tblEl, 'tr')) {
      const trPr = firstChild(tr, 'trPr');
      const isHeaderRow = Boolean(trPr && firstChild(trPr, 'tblHeader'));
      const rowCells: (typeof rawRows)[number]['cells'] = [];

      for (const tc of childElements(tr, 'tc')) {
        const tcPr = firstChild(tc, 'tcPr');
        const gsEl = tcPr ? firstChild(tcPr, 'gridSpan') : null;
        const colspan = Math.max(1, parseInt((gsEl ? attrVal(gsEl, 'val') : null) ?? '1', 10) || 1);
        const vmEl = tcPr ? firstChild(tcPr, 'vMerge') : null;
        let vMerge: 'none' | 'restart' | 'continue' = 'none';
        if (vmEl) {
          const v = (attrVal(vmEl, 'val') ?? '').toLowerCase();
          vMerge = v === 'restart' ? 'restart' : 'continue';
        }
        const vaEl = tcPr ? firstChild(tcPr, 'vAlign') : null;
        const vaRaw = (vaEl ? attrVal(vaEl, 'val') : null)?.toLowerCase();
        const valign =
          vaRaw === 'center'
            ? 'middle'
            : vaRaw === 'bottom'
              ? 'bottom'
              : vaRaw === 'top'
                ? 'top'
                : undefined;

        let cellAlign: 'left' | 'center' | 'right' | undefined;
        const cellInlines: ParsedInlineSegment[] = [];
        const cellBookmarks: string[] = [];

        let paraCount = 0;
        for (const child of childElements(tc)) {
          const cln = localNameOf(child);
          if (cln === 'p') {
            const pPr = firstChild(child, 'pPr');
            const jc = pPr ? firstChild(pPr, 'jc') : null;
            const jcVal = (jc ? attrVal(jc, 'val') : null)?.toLowerCase();
            if (!cellAlign && (jcVal === 'left' || jcVal === 'center' || jcVal === 'right')) {
              cellAlign = jcVal;
            }
            const parsed = parseParagraphInlines(child, rels, inNote, null);
            cellBookmarks.push(...parsed.bookmarks);
            if (paraCount > 0 && parsed.inlines.length > 0 && cellInlines.length > 0) {
              cellInlines.push({ kind: 'text', text: ' ' });
            }
            cellInlines.push(...parsed.inlines);
            paraCount++;
          } else if (cln === 'tbl') {
            const flattened = flattenNestedTableToText(child);
            if (flattened) {
              if (cellInlines.length > 0) cellInlines.push({ kind: 'text', text: ' ' });
              cellInlines.push({ kind: 'text', text: flattened });
            }
          }
        }
        tableBookmarks.push(...cellBookmarks);
        sampleTexts.push(cellInlines.map((s) => s.text ?? '').join(''));
        rowCells.push({
          colspan,
          vMerge,
          align: cellAlign,
          valign,
          inlines: cellInlines,
          bookmarks: cellBookmarks,
        });
      }
      rawRows.push({ isHeaderRow, cells: rowCells });
    }

    // Resolve `vMerge` restart/continue into clean FB2 `rowspan` numbers and omit continuation cells.
    const outRows: ParsedTableRow[] = [];
    const activeByCol: Array<ParsedTableCell | null> = [];

    for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
      const rawRow = rawRows[rIdx]!;
      const outCells: ParsedTableCell[] = [];
      let col = 0;
      for (const rc of rawRow.cells) {
        if (rc.vMerge === 'continue') {
          const owner = activeByCol[col];
          if (owner) owner.rowspan++;
          col += rc.colspan;
          continue;
        }
        const cell: ParsedTableCell = {
          header: rawRow.isHeaderRow,
          colspan: rc.colspan,
          rowspan: 1,
          align: rc.align,
          valign: rc.valign,
          inlines: rc.inlines,
        };
        outCells.push(cell);
        for (let k = 0; k < rc.colspan; k++) {
          activeByCol[col + k] = rc.vMerge === 'restart' ? cell : null;
        }
        col += rc.colspan;
      }
      if (outCells.length > 0) {
        outRows.push({ cells: outCells });
      }
    }

    const blockHint = !inNote
      ? lookup?.findBlockHint(tableBookmarks, sampleTexts.join(' | '))
      : undefined;
    const tableAttrs = blockHint?.tableAttrs;
    if (tableAttrs?.rows) {
      outRows.forEach((row, ri) => {
        const rh = tableAttrs.rows?.[ri];
        if (rh?.align === 'left' || rh?.align === 'center' || rh?.align === 'right') {
          row.align = rh.align;
        }
        row.cells.forEach((cell, ci) => {
          const ch = rh?.cells?.[ci];
          if (!ch) return;
          if (ch.header) cell.header = true;
          if (ch.align === 'left' || ch.align === 'center' || ch.align === 'right')
            cell.align = ch.align;
          if (ch.valign === 'top' || ch.valign === 'middle' || ch.valign === 'bottom')
            cell.valign = ch.valign;
          if (ch.id) cell.id = ch.id;
          if (ch.style) cell.style = ch.style;
        });
      });
    }

    return {
      type: 'table',
      semanticKind: 'table',
      bookmarks: tableBookmarks,
      rows: outRows,
      tableAttrs,
      blockHint,
      bodyHint: !inNote ? lookup?.findBodyHint(tableBookmarks) : undefined,
      sectionHint: !inNote ? lookup?.findSectionHint(tableBookmarks) : undefined,
    };
  };

  // Parse a `<w:p>` element into zero or one `ParsedBlock`.
  const parseParagraphElement = (
    pEl: Element,
    rels: ReadonlyMap<string, RelTarget>,
    inNote: boolean,
    noteSourceTag: 'footnote' | 'endnote' | null,
  ): ParsedBlock | null => {
    const pPr = firstChild(pEl, 'pPr');
    const pStyleEl = pPr ? firstChild(pPr, 'pStyle') : null;
    const styleId = pStyleEl ? (attrVal(pStyleEl, 'val') ?? undefined) : undefined;
    const { inlines, bookmarks } = parseParagraphInlines(pEl, rels, inNote, noteSourceTag);

    if (!inNote && lookup && lookup.shouldSkipParagraph(bookmarks)) {
      return null;
    }

    // Track arbitrary paragraph shading/border styling dropped in foreign mode.
    if (isForeign && pPr && (firstChild(pPr, 'pBdr') || firstChild(pPr, 'shd'))) {
      droppedStylingCount++;
    }

    const bodyHint = !inNote ? lookup?.findBodyHint(bookmarks) : undefined;
    const sectionHint = !inNote ? lookup?.findSectionHint(bookmarks) : undefined;
    const unrefNoteHint = !inNote ? lookup?.findUnreferencedNoteHint(bookmarks) : undefined;
    const isUnrefStart = !inNote && Boolean(lookup?.isUnreferencedNotesHeading(bookmarks));

    // Prefix numbering list text when `w:numPr` is present on a foreign or newly added paragraph.
    const numPr = pPr ? firstChild(pPr, 'numPr') : null;
    if (numPr && inlines.length > 0) {
      const ilvlEl = firstChild(numPr, 'ilvl');
      const numIdEl = firstChild(numPr, 'numId');
      const numId = numIdEl ? attrVal(numIdEl, 'val') : null;
      const ilvl = parseInt((ilvlEl ? attrVal(ilvlEl, 'val') : null) ?? '0', 10) || 0;
      if (numId && numId !== '0') {
        const prefix = nextListPrefix(numId, ilvl);
        if (prefix) {
          inlines.unshift({ kind: 'text', text: prefix });
        }
      }
    }

    const plainText = inlines.map((s) => s.text ?? '').join('');
    const blockHint = !inNote ? lookup?.findBlockHint(bookmarks, plainText) : undefined;

    // Empty paragraph
    const hasNonSpaceText = plainText.trim().length > 0;
    const hasImage = inlines.some((s) => s.kind === 'image');
    const hasNoteRef = inlines.some((s) => s.kind === 'noteRef');
    if (!hasNonSpaceText && !hasImage && !hasNoteRef) {
      if (blockHint?.kind === 'empty-line' || styleId === 'MfbeEmptyLine') {
        return {
          type: 'empty-line',
          semanticKind: 'empty-line',
          bookmarks,
          styleId,
          bodyHint,
          sectionHint,
          blockHint,
          unreferencedNoteHint: unrefNoteHint,
        };
      }
      // Preserve section/body bookmark anchor even on empty paragraph if needed.
      if (sectionHint || bodyHint) {
        return {
          type: 'empty-line',
          semanticKind: 'empty-line',
          bookmarks,
          styleId,
          bodyHint,
          sectionHint,
          blockHint,
        };
      }
      return null;
    }

    // Standalone block image paragraph (single image segment, no meaningful surrounding text).
    if (hasImage && !hasNonSpaceText && !hasNoteRef) {
      const imgSeg = inlines.find((s) => s.kind === 'image')!;
      const picHint = lookup?.findPictureHint(imgSeg.mediaEntry!);
      return {
        type: 'image',
        bookmarks,
        styleId,
        mediaEntry: imgSeg.mediaEntry,
        isSvg: imgSeg.isSvg,
        alt: imgSeg.alt || picHint?.alt,
        title: picHint?.title,
        imageId: picHint?.id,
        bodyHint,
        sectionHint,
        unreferencedNoteHint: unrefNoteHint,
      };
    }

    // Heading detection
    const headingLvl = resolveHeadingLevel(styleId, pPr, styles);
    if (headingLvl !== null && !inNote && !blockHint) {
      return {
        type: 'heading',
        level: headingLvl,
        bookmarks,
        styleId,
        inlines,
        bodyHint,
        sectionHint,
        isUnreferencedNotesStart: isUnrefStart,
      };
    }

    // Infer semantic kind from round-trip hint or Word style name.
    let semanticKind: DocxBlockKind = blockHint?.kind ?? 'p';
    if (!blockHint) {
      const sn = resolveStyleName(styleId, styles);
      if (/\bquote\b|blockquote|citation/.test(sn)) semanticKind = 'cite';
      else if (styleId === 'MfbeSubtitle' || /\bsubtitle\b/.test(sn)) semanticKind = 'subtitle';
      else if (styleId === 'MfbeEpigraph') semanticKind = 'epigraph';
      else if (styleId === 'MfbeVerse') semanticKind = 'v';
      else if (styleId === 'MfbeTextAuthor') semanticKind = 'text-author';
      else if (styleId === 'MfbeDate') semanticKind = 'date';
      else if (styleId === 'MfbeAnnotation') semanticKind = 'section-annotation';
    }

    const inlineSpans =
      blockHint && lookup ? lookup.findInlineSpans(blockHint.bookmark, plainText) : undefined;

    return {
      type: 'paragraph',
      semanticKind,
      bookmarks,
      styleId,
      inlines,
      bodyHint,
      sectionHint,
      blockHint,
      inlineSpans,
      unreferencedNoteHint: unrefNoteHint,
      isUnreferencedNotesStart: isUnrefStart,
    };
  };

  // Walk body-level elements (unwrapping `<w:sdt>` unless skipped by round-trip front-matter).
  const blocks: ParsedBlock[] = [];
  const walkBodyContainer = (container: Element): void => {
    for (const child of childElements(container)) {
      const ln = localNameOf(child);
      if (ln === 'p') {
        const blk = parseParagraphElement(child, docRels, false, null);
        if (blk) blocks.push(blk);
      } else if (ln === 'tbl') {
        blocks.push(parseTableElement(child, docRels, false));
      } else if (ln === 'sdt') {
        // In foreign mode, skip Table of Contents SDTs so TOC entries aren't imported as prose!
        const sdtPr = firstChild(child, 'sdtPr');
        const docPart = sdtPr ? firstChild(sdtPr, 'docPartObj') : null;
        const gallery = docPart ? firstChild(docPart, 'docPartGallery') : null;
        const galVal = (gallery ? attrVal(gallery, 'val') : null)?.toLowerCase() ?? '';
        const sdtContent = firstChild(child, 'sdtContent');
        if (!sdtContent) continue;
        if (isForeign && galVal.includes('table of contents')) {
          continue;
        }
        walkBodyContainer(sdtContent);
      }
    }
  };
  walkBodyContainer(bodyEl);

  // Merge image captions (`MfbeCaption` immediately following a block `image`).
  for (let i = 0; i + 1 < blocks.length; i++) {
    const cur = blocks[i]!;
    const next = blocks[i + 1]!;
    if (cur.type === 'image' && next.type === 'paragraph' && next.styleId === 'MfbeCaption') {
      const capText = (next.inlines ?? [])
        .map((s) => s.text ?? '')
        .join('')
        .trim();
      if (capText && !cur.title) cur.title = capText;
      blocks.splice(i + 1, 1);
    }
  }

  // Parse footnotes.xml and endnotes.xml
  const notes: ParsedDocxNote[] = [];
  const parseNotesXml = (
    xml: string | undefined,
    relsXml: string | undefined,
    source: 'footnote' | 'endnote',
  ): void => {
    if (!xml) return;
    const ndoc = parseXmlDoc(xml);
    if (!ndoc) return;
    const nRels = parseRels(relsXml);
    const itemTag = source === 'footnote' ? 'footnote' : 'endnote';
    const prefix = source === 'footnote' ? 'fn_' : 'en_';
    for (const item of childElements(ndoc.documentElement, itemTag)) {
      const idStr = attrVal(item, 'id');
      const nid = idStr ? parseInt(idStr, 10) : 0;
      if (!Number.isFinite(nid) || nid <= 0) continue; // skip separator (-1) & continuationSeparator (0)
      const nBlocks: ParsedBlock[] = [];
      for (const ch of childElements(item)) {
        const cln = localNameOf(ch);
        if (cln === 'p') {
          const pb = parseParagraphElement(ch, nRels, true, source);
          if (pb) nBlocks.push(pb);
        } else if (cln === 'tbl') {
          nBlocks.push(parseTableElement(ch, nRels, true));
        }
      }
      if (nBlocks.length === 0) continue;
      const hint = lookup?.findNoteHintById(nid);
      notes.push({
        key: `${prefix}${nid}`,
        docxNoteId: nid,
        source,
        label: hint?.label || String(nid),
        blocks: nBlocks,
        hint,
      });
    }
  };
  parseNotesXml(input.footnotesXml, input.footnotesRelsXml, 'footnote');
  parseNotesXml(input.endnotesXml, input.endnotesRelsXml, 'endnote');

  // Foreign-mode helpers: leading `Title` style fallback (Clarify Pass 2 Q3) & leading cover promotion.
  let titleFallback = '';
  let coverMediaEntry: string | undefined;
  let coverAlt: string | undefined;

  if (isForeign) {
    // Promote standalone opening image to coverpage if it appears first before text.
    if (blocks.length > 0 && blocks[0]!.type === 'image' && blocks[0]!.mediaEntry) {
      coverMediaEntry = blocks[0]!.mediaEntry;
      coverAlt = blocks[0]!.alt;
      blocks.shift();
    }
    // If dc:title is empty, inspect leading `Title`-styled paragraph.
    if (!core.title && blocks.length > 0 && blocks[0]!.type === 'paragraph') {
      const sn = resolveStyleName(blocks[0]!.styleId, styles);
      if (/\btitle\b/.test(sn) && !/\bsubtitle\b/.test(sn)) {
        const tText = (blocks[0]!.inlines ?? [])
          .map((s) => s.text ?? '')
          .join('')
          .trim();
        if (tText) {
          titleFallback = tText;
          blocks.shift();
        }
      }
    }
  }

  // Empty-content check: refuse documents with no importable text, tables, or images!
  const hasAnyContent =
    blocks.some(
      (b) =>
        b.type === 'table' ||
        b.type === 'image' ||
        (b.inlines ?? []).some((s) => s.kind === 'image' || (s.text ?? '').trim().length > 0),
    ) ||
    notes.length > 0 ||
    Boolean(coverMediaEntry) ||
    Boolean(titleFallback);

  if (!hasAnyContent) {
    throw new DocxEmptyError();
  }

  // Push aggregated summary items.
  if (deletedCount > 0) {
    summary.push({ kind: 'skippedDeletions', detail: String(deletedCount), count: deletedCount });
  }
  if (commentIds.size > 0) {
    summary.push({
      kind: 'skippedComments',
      detail: String(commentIds.size),
      count: commentIds.size,
    });
  }
  if (equationCount > 0) {
    summary.push({ kind: 'equationsAsText', detail: String(equationCount), count: equationCount });
  }
  if (isForeign && droppedStylingCount > 0) {
    summary.push({
      kind: 'droppedStyling',
      detail: String(droppedStylingCount),
      count: droppedStylingCount,
    });
  }
  if (droppedUnsupportedDrawingsCount > 0) {
    summary.push({
      kind: 'droppedUnsupportedDrawings',
      detail: String(droppedUnsupportedDrawingsCount),
      count: droppedUnsupportedDrawingsCount,
    });
  }
  if (isForeign && (input.headerFooterCount ?? 0) > 0) {
    summary.push({
      kind: 'droppedHeadersFooters',
      detail: String(input.headerFooterCount),
      count: input.headerFooterCount,
    });
  }
  if (droppedOleCount > 0) {
    summary.push({
      kind: 'droppedOleOrMedia',
      detail: String(droppedOleCount),
      count: droppedOleCount,
    });
  }
  if (droppedRemoteImagesCount > 0) {
    summary.push({
      kind: 'droppedRemoteImages',
      detail: String(droppedRemoteImagesCount),
      count: droppedRemoteImagesCount,
    });
  }
  if (flattenedNestedTablesCount > 0) {
    summary.push({
      kind: 'flattenedNestedTables',
      detail: String(flattenedNestedTablesCount),
      count: flattenedNestedTablesCount,
    });
  }
  if (strippedControlCharsCount > 0) {
    summary.push({
      kind: 'strippedControlChars',
      detail: String(strippedControlCharsCount),
      count: strippedControlCharsCount,
    });
  }

  return {
    core,
    titleFallback,
    blocks,
    notes,
    neededImages,
    coverMediaEntry,
    coverAlt,
    roundtrip: input.roundtrip,
    summary,
  };
}
