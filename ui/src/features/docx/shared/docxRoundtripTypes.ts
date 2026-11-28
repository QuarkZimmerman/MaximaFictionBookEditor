/**
 * Feature 023 (T012; data-model.md §3 & §5): canonical Custom XML reversible round-trip payload
 * schema (v1), SHA-256 normalization helpers, Web deflate/inflate base64 codecs, and conversion
 * summary item types shared between `docx-export` and `docx-import`.
 */

export const DOCX_ROUNDTRIP_NAMESPACE = 'urn:maxima-fbeditor:docx-roundtrip:v1';
export const DOCX_ROUNDTRIP_VERSION = 1;
export const DOCX_MAX_ROUNDTRIP_UNPACKED_BYTES = 4 * 1024 * 1024;

export interface DocxFrontMatterMarkers {
  coverBookmark?: string;
  titleStartBookmark?: string;
  titleEndBookmark?: string;
  annotationStartBookmark?: string;
  annotationEndBookmark?: string;
  tocStartBookmark?: string;
  tocEndBookmark?: string;
  colophonStartBookmark?: string;
  colophonEndBookmark?: string;
}

export interface DocxSkippedLeadingCover {
  binaryId: string;
  alt?: string;
  title?: string;
  id?: string;
}

export interface DocxPictureMetaHint {
  binaryId: string;
  contentType: string;
  alt?: string;
  title?: string;
  id?: string;
}

export interface DocxBodyHint {
  name?: string;
  lang?: string;
  startBookmark: string;
  isNotes?: boolean;
  unreferencedNotesBookmark?: string;
  title?: string[];
}

export interface DocxSectionHint {
  bookmark: string;
  depth: number;
  id?: string;
  lang?: string;
  untitled?: boolean;
  bodyIndex: number;
  hasEpigraph?: boolean;
  hasAnnotation?: boolean;
}

export interface DocxTableCellHint {
  header?: boolean;
  align?: string;
  valign?: string;
  id?: string;
  style?: string;
}

export interface DocxTableRowHint {
  align?: string;
  cells?: DocxTableCellHint[];
}

export interface DocxTableAttrsHint {
  id?: string;
  style?: string;
  rows?: DocxTableRowHint[];
}

export type DocxBlockKind =
  | 'p'
  | 'subtitle'
  | 'epigraph'
  | 'cite'
  | 'poem'
  | 'stanza'
  | 'v'
  | 'text-author'
  | 'date'
  | 'empty-line'
  | 'section-annotation'
  | 'table';

export interface DocxBlockHint {
  bookmark: string;
  fingerprint: string;
  kind: DocxBlockKind;
  id?: string;
  lang?: string;
  style?: string;
  dateValue?: string;
  groupId?: string;
  tableAttrs?: DocxTableAttrsHint;
}

export interface DocxInlineSpanHint {
  start: number;
  end: number;
  kind: 'style' | 'id' | 'lang';
  value: string;
}

export interface DocxInlineHintGroup {
  blockBookmark: string;
  spans: DocxInlineSpanHint[];
}

export interface DocxNoteHint {
  docxNoteId?: number;
  unreferencedBookmark?: string;
  bodyName: string;
  groupPath?: string[];
  sectionId: string;
  label?: string;
  unreferenced?: boolean;
}

export interface DocxRoundtripPayload {
  v: 1;
  descriptionXml: string;
  stylesheets: { type: string; text: string }[];
  frontMatter: DocxFrontMatterMarkers;
  skippedLeadingCover?: DocxSkippedLeadingCover;
  pictures: Record<string, DocxPictureMetaHint>;
  bodies: DocxBodyHint[];
  sections: DocxSectionHint[];
  blocks: DocxBlockHint[];
  inlineHints: DocxInlineHintGroup[];
  notes: DocxNoteHint[];
  cssStyleMap: Record<string, string>;
}

export type DocxExportSummaryKind =
  | 'repairedTitle'
  | 'brokenInternalLink'
  | 'missingPicture'
  | 'remotePicture'
  | 'convertedPicture'
  | 'duplicateId'
  | 'strippedControlChars'
  | 'unsupportedCssRule'
  | 'nonCssStylesheet';

export type DocxImportSummaryKind =
  | 'fbdApplied'
  | 'externallyModified'
  | 'mfbeDamagedFallback'
  | 'skippedDeletions'
  | 'skippedComments'
  | 'equationsAsText'
  | 'svgRasterized'
  | 'droppedStyling'
  | 'droppedUnsupportedDrawings'
  | 'droppedHeadersFooters'
  | 'droppedOleOrMedia'
  | 'droppedRemoteImages'
  | 'strayMacrosIgnored'
  | 'flattenedNestedTables'
  | 'brokenInternalLink'
  | 'strippedControlChars'
  | 'outsideArchiveEntry';

export interface DocxSummaryItem {
  kind: DocxExportSummaryKind | DocxImportSummaryKind;
  detail: string;
  count?: number;
}

// eslint-disable-next-line no-control-regex
export const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Escapes XML text content and strips XML 1.0 illegal control characters. */
export function escapeXmlText(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escapes XML attribute values and strips XML 1.0 illegal control characters. */
export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/** Decodes basic XML character and named entities without requiring a browser DOM. */
export function decodeXmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, ent: string) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = parseInt(ent.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : '';
    }
    if (ent.startsWith('#')) {
      const cp = parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : '';
    }
    return '';
  });
}

function parseRelsMap(relsXml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml) return map;
  const re = /<Relationship\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml)) !== null) {
    const attrs = m[1]!;
    const id = /\bId="([^"]+)"/i.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/i.exec(attrs)?.[1];
    if (id && target) map.set(id, decodeXmlEntities(target));
  }
  return map;
}

function normalizeParagraphForDigest(pXml: string, rels: ReadonlyMap<string, string>): string {
  // Omit tracked deletions so accepted-change text matches consistently.
  const withoutDel = pXml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');
  const tokens: string[] = [];
  const tokenRe =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<a:blip\b[^>]*\br:embed="([^"]+)"[^>]*\/?>|<w:(?:footnote|endnote)Reference\b[^>]*\bw:id="([^"]+)"[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(withoutDel)) !== null) {
    if (m[1] !== undefined) {
      tokens.push(decodeXmlEntities(m[1]));
    } else if (m[2] !== undefined) {
      const target = rels.get(m[2]) ?? m[2];
      tokens.push(`[IMG:${target}]`);
    } else if (m[3] !== undefined) {
      tokens.push(`[NOTE:${m[3]}]`);
    } else if (m[0].startsWith('<w:tab')) {
      tokens.push('\t');
    } else if (m[0].startsWith('<w:br')) {
      tokens.push('\n');
    }
  }
  return tokens
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractFrontMatterRangeSet(fm: DocxFrontMatterMarkers | undefined): {
  single: Set<string>;
  ranges: Array<[string, string]>;
} {
  const single = new Set<string>();
  const ranges: Array<[string, string]> = [];
  if (!fm) return { single, ranges };
  if (fm.coverBookmark) single.add(fm.coverBookmark);
  if (fm.titleStartBookmark && fm.titleEndBookmark) {
    ranges.push([fm.titleStartBookmark, fm.titleEndBookmark]);
  }
  if (fm.annotationStartBookmark && fm.annotationEndBookmark) {
    ranges.push([fm.annotationStartBookmark, fm.annotationEndBookmark]);
  }
  if (fm.tocStartBookmark && fm.tocEndBookmark) {
    ranges.push([fm.tocStartBookmark, fm.tocEndBookmark]);
  }
  if (fm.colophonStartBookmark && fm.colophonEndBookmark) {
    ranges.push([fm.colophonStartBookmark, fm.colophonEndBookmark]);
  }
  return { single, ranges };
}

/**
 * Computes canonical SHA-256 digests of body content, notes content, and core properties.
 * Pure string-based so export (UI & Web Workers) and import produce identical digests regardless
 * of insignificant XML formatting or Word `rsid*` edits, while detecting any text/image/note edits.
 */
export async function computeDocxContentDigests(input: {
  documentXml: string;
  documentRelsXml?: string;
  notesXml?: string;
  notesRelsXml?: string;
  coreXml?: string;
  frontMatter?: DocxFrontMatterMarkers;
}): Promise<{ bodyDigest: string; notesDigest: string; propsDigest: string }> {
  const docRels = parseRelsMap(input.documentRelsXml);
  const notesRels = parseRelsMap(input.notesRelsXml);
  const { single, ranges } = extractFrontMatterRangeSet(input.frontMatter);
  const startToEnd = new Map<string, string>(ranges);

  const bodyMatch = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/i.exec(input.documentXml);
  const bodyInner = bodyMatch ? bodyMatch[1]! : input.documentXml;

  // Walk paragraphs in document order, skipping front/back-matter bookmark regions.
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
  const bmRe = /<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"/g;
  const bodyLines: string[] = [];
  let skipUntilBookmark: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(bodyInner)) !== null) {
    const pXml = m[0];
    const names: string[] = [];
    bmRe.lastIndex = 0;
    let bm: RegExpExecArray | null;
    while ((bm = bmRe.exec(pXml)) !== null) {
      names.push(decodeXmlEntities(bm[1]!));
    }

    let isSingleSkipped = false;
    for (const name of names) {
      if (single.has(name)) isSingleSkipped = true;
      const endTarget = startToEnd.get(name);
      if (endTarget) skipUntilBookmark = endTarget;
    }

    if (skipUntilBookmark !== null) {
      if (names.includes(skipUntilBookmark)) {
        skipUntilBookmark = null;
      }
      continue;
    }
    if (isSingleSkipped) continue;

    const norm = normalizeParagraphForDigest(pXml, docRels);
    if (norm.length > 0) bodyLines.push(norm);
  }

  const noteLines: string[] = [];
  if (input.notesXml) {
    const noteRe = /<w:(?:footnote|endnote)\b([^>]*)>([\s\S]*?)<\/w:(?:footnote|endnote)>/g;
    let nm: RegExpExecArray | null;
    while ((nm = noteRe.exec(input.notesXml)) !== null) {
      const attrs = nm[1]!;
      const idStr = /\bw:id="(-?\d+)"/.exec(attrs)?.[1];
      const id = idStr ? parseInt(idStr, 10) : 0;
      if (id <= 0) continue;
      const inner = nm[2]!;
      const innerLines: string[] = [];
      let pm: RegExpExecArray | null;
      const pRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
      while ((pm = pRe.exec(inner)) !== null) {
        const line = normalizeParagraphForDigest(pm[0], notesRels);
        if (line.length > 0) innerLines.push(line);
      }
      noteLines.push(`${id}:${innerLines.join('|')}`);
    }
  }

  const core = input.coreXml ?? '';
  const coreField = (tag: string): string => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const hit = re.exec(core);
    return hit ? decodeXmlEntities(hit[1]!).replace(/\s+/g, ' ').trim() : '';
  };
  const propsCanonical = [
    coreField('dc:title'),
    coreField('dc:creator'),
    coreField('dc:description'),
    coreField('dc:subject'),
    coreField('cp:keywords'),
    coreField('dc:language'),
  ].join('\u001f');

  const [bodyDigest, notesDigest, propsDigest] = await Promise.all([
    sha256Hex(bodyLines.join('\n')),
    sha256Hex(noteLines.join('\n')),
    sha256Hex(propsCanonical),
  ]);
  return { bodyDigest, notesDigest, propsDigest };
}

/** Short deterministic fingerprint of a paragraph/block for external-edit hint re-alignment. */
export function blockFingerprint(text: string): string {
  const norm = text.replace(/\s+/g, ' ').trim();
  if (norm.length <= 48) return norm;
  return `${norm.slice(0, 24)}|${norm.slice(-20)}|${norm.length}`;
}

/** SHA-256 hex digest using standard Web Crypto (available in Chromium 150, Web Workers, Node 24). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error('DOCX round-trip payload exceeds maximum decompressed size');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Compresses a UTF-8 JSON string using standard Web RFC-1950 deflate and encodes as base64. */
export async function compressPayloadBase64(jsonText: string): Promise<string> {
  const raw = new TextEncoder().encode(jsonText);
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const writePromise = writer.write(raw).then(() => writer.close());
  const compressed = await readStreamBounded(cs.readable, DOCX_MAX_ROUNDTRIP_UNPACKED_BYTES);
  await writePromise;
  return bytesToBase64(compressed);
}

/** Decodes base64 and inflates a bounded RFC-1950 deflate stream back to UTF-8 JSON text. */
export async function decompressPayloadBase64(
  b64: string,
  maxBytes = DOCX_MAX_ROUNDTRIP_UNPACKED_BYTES,
): Promise<string> {
  const compressed = base64ToBytes(b64);
  if (compressed.byteLength > maxBytes) {
    throw new Error('DOCX round-trip payload exceeds maximum compressed size');
  }
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const writePromise = writer
    .write(compressed as unknown as BufferSource)
    .then(() => writer.close())
    .catch(() => undefined);
  const inflated = await readStreamBounded(ds.readable, maxBytes);
  await writePromise;
  return new TextDecoder('utf-8', { fatal: true }).decode(inflated);
}
