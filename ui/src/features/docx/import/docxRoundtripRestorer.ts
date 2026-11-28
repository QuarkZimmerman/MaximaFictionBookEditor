/**
 * Feature 023 (T031; data-model.md §3): Custom XML reversible round-trip detector, bounded deflate
 * decoder, SHA-256 untouched vs externally modified mode resolver, front/back-matter stripper,
 * bookmark + fingerprint hint re-aligner, and canonical `Description` equality comparator.
 */
import type { Description } from '@/model/document';

import {
  blockFingerprint,
  computeDocxContentDigests,
  decompressPayloadBase64,
  DOCX_MAX_ROUNDTRIP_UNPACKED_BYTES,
  DOCX_ROUNDTRIP_NAMESPACE,
  DOCX_ROUNDTRIP_VERSION,
  type DocxBlockHint,
  type DocxBodyHint,
  type DocxInlineSpanHint,
  type DocxNoteHint,
  type DocxPictureMetaHint,
  type DocxRoundtripPayload,
  type DocxSectionHint,
  type DocxSummaryItem,
} from '../shared/docxRoundtripTypes';

export type DocxRoundtripMode = 'foreign' | 'exact' | 'modified' | 'foreignFallback';

export interface ResolvedDocxRoundtrip {
  mode: DocxRoundtripMode;
  payload: DocxRoundtripPayload | null;
  summary: DocxSummaryItem[];
}

export interface DocxRoundtripLookup {
  readonly mode: 'exact' | 'modified';
  readonly payload: DocxRoundtripPayload;
  /** Returns true when a paragraph carrying `bookmarks` lies inside generated front/back matter. */
  shouldSkipParagraph: (bookmarks: readonly string[]) => boolean;
  findBodyHint: (bookmarks: readonly string[]) => DocxBodyHint | undefined;
  findSectionHint: (bookmarks: readonly string[]) => DocxSectionHint | undefined;
  findBlockHint: (bookmarks: readonly string[], text: string) => DocxBlockHint | undefined;
  findInlineSpans: (blockBookmark: string, text: string) => DocxInlineSpanHint[] | undefined;
  findPictureHint: (mediaPath: string) => DocxPictureMetaHint | undefined;
  findNoteHintById: (docxNoteId: number) => DocxNoteHint | undefined;
  findUnreferencedNoteHint: (bookmarks: readonly string[]) => DocxNoteHint | undefined;
  isUnreferencedNotesHeading: (bookmarks: readonly string[]) => boolean;
  lookupCssFb2Style: (wordStyleId: string) => string | undefined;
}

interface ParsedRecordEnvelope {
  version: number;
  bodyDigest: string;
  notesDigest: string;
  propsDigest: string;
  encodedPayload: string;
}

/** Extracts an `<mfbeRecord>` envelope from a candidate `customXml/*.xml` string, or null if unrelated. */
export function parseMfbeCustomXmlEnvelope(xml: string): ParsedRecordEnvelope | null {
  if (!xml.includes(DOCX_ROUNDTRIP_NAMESPACE)) return null;
  const openRe =
    /<(?:[A-Za-z0-9_]+:)?mfbeRecord\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?mfbeRecord>/;
  const m = openRe.exec(xml);
  if (!m) return null;
  const attrs = m[1]!;
  if (!attrs.includes(DOCX_ROUNDTRIP_NAMESPACE)) return null;
  const attr = (name: string): string => {
    const r = new RegExp(`\\b${name}="([^"]*)"`);
    return r.exec(attrs)?.[1] ?? '';
  };
  const version = parseInt(attr('version'), 10);
  return {
    version,
    bodyDigest: attr('bodyDigest'),
    notesDigest: attr('notesDigest'),
    propsDigest: attr('propsDigest'),
    encodedPayload: m[2]!.trim(),
  };
}

function isValidPayload(value: unknown): value is DocxRoundtripPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === DOCX_ROUNDTRIP_VERSION &&
    typeof p.descriptionXml === 'string' &&
    Array.isArray(p.stylesheets) &&
    typeof p.frontMatter === 'object' &&
    p.frontMatter !== null &&
    typeof p.pictures === 'object' &&
    p.pictures !== null &&
    Array.isArray(p.bodies) &&
    Array.isArray(p.sections) &&
    Array.isArray(p.blocks) &&
    Array.isArray(p.inlineHints) &&
    Array.isArray(p.notes) &&
    typeof p.cssStyleMap === 'object' &&
    p.cssStyleMap !== null
  );
}

/**
 * Inspects candidate `customXml/*.xml` files and resolves the DOCX import mode:
 * - `foreign` when no editor round-trip record exists;
 * - `exact` when record decodes cleanly and both `bodyDigest` & `notesDigest` match;
 * - `modified` when record decodes cleanly but content was edited externally (Word/LibreOffice);
 * - `foreignFallback` when a record exists but is damaged, oversized, or an unsupported version.
 */
export async function resolveDocxRoundtrip(input: {
  customXmlParts: readonly string[];
  documentXml: string;
  documentRelsXml?: string;
  notesXml?: string;
  notesRelsXml?: string;
  coreXml?: string;
}): Promise<ResolvedDocxRoundtrip> {
  let envelope: ParsedRecordEnvelope | null = null;
  for (const part of input.customXmlParts) {
    const parsed = parseMfbeCustomXmlEnvelope(part);
    if (parsed) {
      envelope = parsed;
      break;
    }
  }
  if (!envelope) {
    return { mode: 'foreign', payload: null, summary: [] };
  }

  if (envelope.version !== DOCX_ROUNDTRIP_VERSION || !envelope.encodedPayload) {
    return {
      mode: 'foreignFallback',
      payload: null,
      summary: [{ kind: 'mfbeDamagedFallback', detail: `version ${envelope.version}` }],
    };
  }

  let payload: DocxRoundtripPayload;
  try {
    const jsonText = await decompressPayloadBase64(
      envelope.encodedPayload,
      DOCX_MAX_ROUNDTRIP_UNPACKED_BYTES,
    );
    const parsed: unknown = JSON.parse(jsonText);
    if (!isValidPayload(parsed)) {
      throw new Error('invalid payload structure');
    }
    payload = parsed;
  } catch (err) {
    return {
      mode: 'foreignFallback',
      payload: null,
      summary: [
        {
          kind: 'mfbeDamagedFallback',
          detail: err instanceof Error ? err.message : 'corrupt payload',
        },
      ],
    };
  }

  const live = await computeDocxContentDigests({
    documentXml: input.documentXml,
    documentRelsXml: input.documentRelsXml,
    notesXml: input.notesXml,
    notesRelsXml: input.notesRelsXml,
    coreXml: input.coreXml,
    frontMatter: payload.frontMatter,
  });

  if (live.bodyDigest === envelope.bodyDigest && live.notesDigest === envelope.notesDigest) {
    return { mode: 'exact', payload, summary: [] };
  }

  return {
    mode: 'modified',
    payload,
    summary: [{ kind: 'externallyModified', detail: '' }],
  };
}

/** Creates stateful front-matter range stripping & bookmark/fingerprint hint lookup tables. */
export function createRoundtripLookup(
  payload: DocxRoundtripPayload,
  mode: 'exact' | 'modified',
): DocxRoundtripLookup {
  const fm = payload.frontMatter;
  const singleSkip = new Set<string>();
  const rangeStartToEnd = new Map<string, string>();
  if (fm.coverBookmark) singleSkip.add(fm.coverBookmark);
  if (fm.titleStartBookmark && fm.titleEndBookmark) {
    rangeStartToEnd.set(fm.titleStartBookmark, fm.titleEndBookmark);
  }
  if (fm.annotationStartBookmark && fm.annotationEndBookmark) {
    rangeStartToEnd.set(fm.annotationStartBookmark, fm.annotationEndBookmark);
  }
  if (fm.tocStartBookmark && fm.tocEndBookmark) {
    rangeStartToEnd.set(fm.tocStartBookmark, fm.tocEndBookmark);
  }
  if (fm.colophonStartBookmark && fm.colophonEndBookmark) {
    rangeStartToEnd.set(fm.colophonStartBookmark, fm.colophonEndBookmark);
  }

  let activeRangeEnd: string | null = null;

  const bodyByBm = new Map<string, DocxBodyHint>();
  const unrefHeadings = new Set<string>();
  for (const b of payload.bodies) {
    if (b.unreferencedNotesBookmark) unrefHeadings.add(b.unreferencedNotesBookmark);
    else if (!b.isNotes) bodyByBm.set(b.startBookmark, b);
  }

  const secByBm = new Map<string, DocxSectionHint>(payload.sections.map((s) => [s.bookmark, s]));
  const blkByBm = new Map<string, DocxBlockHint>(payload.blocks.map((b) => [b.bookmark, b]));
  const blkByFingerprint = new Map<string, DocxBlockHint[]>();
  for (const b of payload.blocks) {
    if (!b.fingerprint) continue;
    const arr = blkByFingerprint.get(b.fingerprint);
    if (arr) arr.push(b);
    else blkByFingerprint.set(b.fingerprint, [b]);
  }
  const usedFingerprints = new Set<DocxBlockHint>();

  const inlineByBm = new Map<string, DocxInlineSpanHint[]>(
    payload.inlineHints.map((g) => [g.blockBookmark, g.spans]),
  );

  const picByNormalizedPath = new Map<string, DocxPictureMetaHint>();
  for (const [k, v] of Object.entries(payload.pictures)) {
    const norm = k.replace(/^\/+/, '').toLowerCase();
    picByNormalizedPath.set(norm, v);
    if (norm.startsWith('word/')) picByNormalizedPath.set(norm.slice(5), v);
  }

  const noteById = new Map<number, DocxNoteHint>();
  const unrefNoteByBm = new Map<string, DocxNoteHint>();
  for (const n of payload.notes) {
    if (n.docxNoteId !== undefined) noteById.set(n.docxNoteId, n);
    if (n.unreferencedBookmark) unrefNoteByBm.set(n.unreferencedBookmark, n);
  }

  return {
    mode,
    payload,
    shouldSkipParagraph(bookmarks) {
      let isSingle = false;
      for (const bm of bookmarks) {
        if (singleSkip.has(bm)) isSingle = true;
        const end = rangeStartToEnd.get(bm);
        if (end) activeRangeEnd = end;
      }
      if (activeRangeEnd !== null) {
        if (bookmarks.includes(activeRangeEnd)) activeRangeEnd = null;
        return true;
      }
      return isSingle;
    },
    findBodyHint(bookmarks) {
      for (const bm of bookmarks) {
        const hit = bodyByBm.get(bm);
        if (hit) return hit;
      }
      return undefined;
    },
    findSectionHint(bookmarks) {
      for (const bm of bookmarks) {
        const hit = secByBm.get(bm);
        if (hit) return hit;
      }
      return undefined;
    },
    findBlockHint(bookmarks, text) {
      const fp = blockFingerprint(text);
      for (const bm of bookmarks) {
        const hit = blkByBm.get(bm);
        if (hit) {
          if (mode === 'exact' || hit.fingerprint === fp) return hit;
          // Modified block: still keep non-destructive structural role if empty-line/table/poem/epigraph
          // only when text wasn't completely replaced into something else; otherwise let foreign take over.
          if (
            hit.kind === 'epigraph' ||
            hit.kind === 'cite' ||
            hit.kind === 'v' ||
            hit.kind === 'table'
          ) {
            return hit;
          }
          return undefined;
        }
      }
      // In modified mode, Word may have stripped bookmarks during copy/paste — fall back to unique fingerprint match!
      if (mode === 'modified' && fp.length > 0) {
        const candidates = blkByFingerprint.get(fp);
        if (candidates) {
          const unused = candidates.find((c) => !usedFingerprints.has(c));
          if (unused) {
            usedFingerprints.add(unused);
            return unused;
          }
        }
      }
      return undefined;
    },
    findInlineSpans(blockBookmark, text) {
      const spans = inlineByBm.get(blockBookmark);
      if (!spans) return undefined;
      const blk = blkByBm.get(blockBookmark);
      if (mode === 'modified' && blk && blk.fingerprint !== blockFingerprint(text)) {
        return undefined;
      }
      return spans;
    },
    findPictureHint(mediaPath) {
      const norm = mediaPath.replace(/^\/+/, '').toLowerCase();
      return picByNormalizedPath.get(norm) ?? picByNormalizedPath.get(`word/${norm}`);
    },
    findNoteHintById(docxNoteId) {
      return noteById.get(docxNoteId);
    },
    findUnreferencedNoteHint(bookmarks) {
      for (const bm of bookmarks) {
        const hit = unrefNoteByBm.get(bm);
        if (hit) return hit;
      }
      return undefined;
    },
    isUnreferencedNotesHeading(bookmarks) {
      return bookmarks.some((bm) => unrefHeadings.has(bm));
    },
    lookupCssFb2Style(wordStyleId) {
      return payload.cssStyleMap[wordStyleId];
    },
  };
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

/** Canonical equality of two FB2 `Description` objects (ignoring session-local `nodeId`s). */
export function descriptionsCanonicallyEqual(a: Description, b: Description): boolean {
  return JSON.stringify(stripTransientFields(a)) === JSON.stringify(stripTransientFields(b));
}
