/**
 * Feature 023 (T026 & T032; contracts/docx-file.md §4): converts a `ParsedDocxDocument` into
 * schema-valid UTF-8 FB2 2.1 XML (both foreign DOCX via `features/markdown/describe` and
 * reversible round-trip `exact` / externally `modified` modes), transfers raster pictures via
 * `docxImport.picture`, and rasterizes standalone SVG drawings via the Chromium canvas helper.
 */
import { uploadBinary } from '@/features/images/binaries';
import { buildBook } from '@/features/markdown/describe';
import type { MarkdownDescription, MarkdownPerson } from '@/features/markdown/convert';
import { docxImportPartUrl } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';
import type { RpcClient } from '@/rpc/client';

import { serializeFb2StylesheetsXml } from '../shared/docxDescriptionXml';
import {
  escapeXmlAttr,
  escapeXmlText,
  type DocxInlineSpanHint,
  type DocxSummaryItem,
} from '../shared/docxRoundtripTypes';
import type {
  ParsedBlock,
  ParsedDocxDocument,
  ParsedDocxImageNeed,
  ParsedDocxNote,
  ParsedInlineSegment,
  ParsedTableRow,
} from './docxOoxmlParser';

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export interface AssembledDocxFb2 {
  fb2Xml: string;
  useEmbeddedMeta: boolean;
  counts: {
    sections: number;
    pictures: number;
    tables: number;
    notes: number;
  };
  neededImages: Map<string, ParsedDocxImageNeed>;
  summary: DocxSummaryItem[];
}

class NcNameAllocator {
  private readonly used = new Set<string>();

  allocate(wanted: string): string {
    let base = wanted.replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!base || !/^[A-Za-z_]/.test(base)) base = `id_${base}`;
    let name = base;
    for (let n = 2; this.used.has(name); n++) name = `${base}_${n}`;
    this.used.add(name);
    return name;
  }

  has(name: string): boolean {
    return this.used.has(name);
  }
}

function splitAuthorName(raw: string): MarkdownPerson {
  const trimmed = raw.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  if (trimmed.includes(',')) {
    const [last, rest] = trimmed.split(',', 2);
    const parts = (rest ?? '').trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] ?? '',
      middleName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
      lastName: (last ?? '').trim(),
    };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { nickname: parts[0]! };
  if (parts.length === 2) return { firstName: parts[0]!, lastName: parts[1]! };
  return {
    firstName: parts[0]!,
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1]!,
  };
}

function normalizeLanguage(raw: string | undefined): string {
  const clean = (raw ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(clean)) return clean.split('-')[0]!;
  return 'en';
}

function pAttrsXml(attrs: { id?: string; lang?: string; style?: string } | undefined): string {
  if (!attrs) return '';
  let out = '';
  if (attrs.id) out += ` id="${escapeXmlAttr(attrs.id)}"`;
  if (attrs.lang) out += ` xml:lang="${escapeXmlAttr(attrs.lang)}"`;
  if (attrs.style) out += ` style="${escapeXmlAttr(attrs.style)}"`;
  return out;
}

/**
 * Pure FB2 2.1 XML assembler — requires no RPC or binary uploads, using predicted binary IDs
 * (from `mediaEntry -> binaryId` map or `suggestedBinaryId`), so unit tests and import jobs share
 * one exact conversion pipeline.
 */
export function assembleDocxToFb2Xml(
  parsed: ParsedDocxDocument,
  options: {
    templateXml: string;
    fallbackTitle: string;
    binaryIdByMedia?: ReadonlyMap<string, string>;
    genreMap?: ReadonlyMap<string, string>;
  },
): AssembledDocxFb2 {
  const summary: DocxSummaryItem[] = [...parsed.summary];
  const ids = new NcNameAllocator();
  const payload =
    parsed.roundtrip.mode === 'exact' || parsed.roundtrip.mode === 'modified'
      ? parsed.roundtrip.payload
      : null;
  const useEmbeddedMeta = Boolean(payload);

  // Clone neededImages and ensure cover / skippedLeadingCover / description images are included!
  const neededImages = new Map<string, ParsedDocxImageNeed>(parsed.neededImages);
  if (payload) {
    for (const [mediaPath, picHint] of Object.entries(payload.pictures)) {
      const referencedInDesc = payload.descriptionXml.includes(`#${picHint.binaryId}`);
      const isSkippedCover = payload.skippedLeadingCover?.binaryId === picHint.binaryId;
      if ((referencedInDesc || isSkippedCover) && !neededImages.has(mediaPath)) {
        neededImages.set(mediaPath, {
          mediaEntry: mediaPath,
          isSvg: /\.svg$/i.test(mediaPath),
          suggestedBinaryId: picHint.binaryId,
          alt: picHint.alt,
          title: picHint.title,
          id: picHint.id,
        });
      }
    }
  }

  const resolveBinaryId = (mediaEntry: string): string | null => {
    if (options.binaryIdByMedia) {
      return options.binaryIdByMedia.get(mediaEntry) ?? null;
    }
    return neededImages.get(mediaEntry)?.suggestedBinaryId ?? null;
  };

  // Pre-register note IDs and map note keys (`fn_1`, `en_1`) -> FB2 note section ID.
  const noteKeyToFb2Id = new Map<string, string>();
  const noteSectionsByKey = new Map<
    string,
    {
      fb2Id: string;
      bodyName: string;
      groupPath: string[];
      label: string;
      blocks: ParsedBlock[];
    }
  >();

  // Separate unreferenced notes blocks from main/further story blocks when round-tripping.
  const storyBlocks: ParsedBlock[] = [];
  const unrefNoteRecords: ParsedDocxNote[] = [];
  let inUnrefSection = false;
  let currentUnrefNote: ParsedDocxNote | null = null;

  for (const blk of parsed.blocks) {
    if (blk.isUnreferencedNotesStart) {
      inUnrefSection = true;
      currentUnrefNote = null;
      continue;
    }
    if (inUnrefSection) {
      if (blk.unreferencedNoteHint) {
        const hint = blk.unreferencedNoteHint;
        currentUnrefNote = {
          key: `un_${unrefNoteRecords.length + 1}`,
          source: 'unreferenced',
          label: hint.label ?? '',
          blocks: [],
          hint,
        };
        unrefNoteRecords.push(currentUnrefNote);
        // Skip the subtitle label paragraph if it matches the hint's title label.
        const text = (blk.inlines ?? [])
          .map((s) => s.text ?? '')
          .join('')
          .trim();
        if (blk.styleId === 'MfbeSubtitle' && hint.label && text === hint.label) {
          continue;
        }
      }
      if (currentUnrefNote) {
        currentUnrefNote.blocks.push(blk);
      }
      continue;
    }
    storyBlocks.push(blk);
  }

  const allNotes: ParsedDocxNote[] = [...parsed.notes, ...unrefNoteRecords];
  for (const note of allNotes) {
    const wantedId = note.hint?.sectionId || `n_${note.key}`;
    const existing = [...noteSectionsByKey.values()].find(
      (n) => note.hint?.sectionId && n.fb2Id === note.hint.sectionId,
    );
    if (existing) {
      // Multiple Word footnotes pointing to the same original FB2 note section merge back cleanly!
      noteKeyToFb2Id.set(note.key, existing.fb2Id);
      continue;
    }
    const fb2Id = ids.allocate(wantedId);
    noteKeyToFb2Id.set(note.key, fb2Id);
    noteSectionsByKey.set(note.key, {
      fb2Id,
      bodyName: note.hint?.bodyName || 'notes',
      groupPath: note.hint?.groupPath ?? [],
      label: note.label,
      blocks: note.blocks,
    });
  }

  const isSyntheticRoundtripBookmark = (name: string): boolean =>
    /^(?:blk|el|dt|tbl|sec|mfbe)_/.test(name);

  // Pre-allocate bookmark -> FB2 id mappings for story blocks & sections so internal links resolve.
  const bookmarkToFb2Id = new Map<string, string>();
  const registerBlockBookmarks = (blk: ParsedBlock): string | undefined => {
    const wanted = blk.sectionHint?.id || blk.blockHint?.id || blk.imageId;
    let allocated: string | undefined;
    if (wanted) {
      allocated = ids.allocate(wanted);
    } else if (!payload && blk.bookmarks.length > 0) {
      const bm = blk.bookmarks.find((name) => !isSyntheticRoundtripBookmark(name));
      if (bm) {
        allocated = ids.allocate(bm.startsWith('id_') ? bm.slice(3) : bm);
      }
    }
    if (allocated) {
      for (const bm of blk.bookmarks) {
        if (!bookmarkToFb2Id.has(bm)) bookmarkToFb2Id.set(bm, allocated);
      }
    }
    return allocated;
  };
  const blockAllocatedId = new Map<ParsedBlock, string>();
  for (const blk of storyBlocks) {
    const id = registerBlockBookmarks(blk);
    if (id) blockAllocatedId.set(blk, id);
  }

  const counts = { sections: 0, pictures: 0, tables: 0, notes: noteSectionsByKey.size };

  // Render inline segments to valid FB2 inline XML (applying round-trip inline style/lang spans).
  const renderInlines = (
    segments: readonly ParsedInlineSegment[] | undefined,
    inlineSpans?: readonly DocxInlineSpanHint[],
  ): string => {
    if (!segments || segments.length === 0) return '';

    // Expand character-level inline style/lang spans if present and matching.
    const expanded: ParsedInlineSegment[] = [];
    if (inlineSpans && inlineSpans.length > 0) {
      let pos = 0;
      for (const seg of segments) {
        if (seg.kind !== 'text' || !seg.text) {
          expanded.push(seg);
          continue;
        }
        const segStart = pos;
        const segEnd = pos + seg.text.length;
        pos = segEnd;

        const cuts = new Set<number>([0, seg.text.length]);
        for (const sp of inlineSpans) {
          if (sp.start > segStart && sp.start < segEnd) cuts.add(sp.start - segStart);
          if (sp.end > segStart && sp.end < segEnd) cuts.add(sp.end - segStart);
        }
        const sorted = [...cuts].sort((a, b) => a - b);
        for (let i = 0; i + 1 < sorted.length; i++) {
          const a = sorted[i]!;
          const b = sorted[i + 1]!;
          const slice = seg.text.slice(a, b);
          const absMid = segStart + a;
          let styleName = seg.styleName;
          let lang = seg.lang;
          for (const sp of inlineSpans) {
            if (absMid >= sp.start && absMid < sp.end) {
              if (sp.kind === 'style' && !styleName) styleName = sp.value;
              if (sp.kind === 'lang' && !lang) lang = sp.value;
            }
          }
          expanded.push({ ...seg, text: slice, styleName, lang });
        }
      }
    } else {
      expanded.push(...segments);
    }

    const parts: string[] = [];
    for (const seg of expanded) {
      if (seg.kind === 'noteRef' && seg.noteKey) {
        const fb2NoteId = noteKeyToFb2Id.get(seg.noteKey);
        if (fb2NoteId) {
          const noteRec = noteSectionsByKey.get(seg.noteKey);
          const lbl = noteRec?.label ? `[${noteRec.label}]` : '[*]';
          parts.push(
            `<a l:href="#${escapeXmlAttr(fb2NoteId)}" type="note">${escapeXmlText(lbl)}</a>`,
          );
        }
        continue;
      }
      if (seg.kind === 'image' && seg.mediaEntry) {
        const binId = resolveBinaryId(seg.mediaEntry);
        if (binId) {
          counts.pictures++;
          const alt = seg.alt ? ` alt="${escapeXmlAttr(seg.alt)}"` : '';
          parts.push(`<image l:href="#${escapeXmlAttr(binId)}"${alt}/>`);
        }
        continue;
      }
      const raw = seg.text ?? '';
      if (!raw) continue;
      // Preserve single line breaks as spaces inside inline text (FB2 `<p>` has no `<br/>`).
      let inner = escapeXmlText(raw.replace(/\n+/g, ' '));
      const langAttr = seg.lang ? ` xml:lang="${escapeXmlAttr(seg.lang)}"` : '';
      if (seg.styleName) {
        inner = `<style name="${escapeXmlAttr(seg.styleName)}"${langAttr}>${inner}</style>`;
      }
      if (seg.code) inner = `<code>${inner}</code>`;
      if (seg.sup) inner = `<sup>${inner}</sup>`;
      else if (seg.sub) inner = `<sub>${inner}</sub>`;
      if (seg.strike) inner = `<strikethrough>${inner}</strikethrough>`;
      if (seg.italic) inner = `<emphasis>${inner}</emphasis>`;
      if (seg.bold) inner = `<strong>${inner}</strong>`;

      if (seg.linkHref) {
        if (seg.linkExternal) {
          inner = `<a l:href="${escapeXmlAttr(seg.linkHref)}">${inner}</a>`;
        } else if (seg.linkHref.startsWith('#')) {
          const targetBm = seg.linkHref.slice(1);
          const resolvedId =
            bookmarkToFb2Id.get(targetBm) ?? (ids.has(targetBm) ? targetBm : undefined);
          if (resolvedId) {
            inner = `<a l:href="#${escapeXmlAttr(resolvedId)}">${inner}</a>`;
          } else {
            summary.push({ kind: 'brokenInternalLink', detail: seg.linkHref });
          }
        }
      }
      parts.push(inner);
    }
    return parts.join('');
  };

  const renderTableXml = (blk: ParsedBlock): string => {
    const rows = blk.rows ?? [];
    if (rows.length === 0) return '';
    counts.tables++;
    const tid = blk.tableAttrs?.id ? ` id="${escapeXmlAttr(ids.allocate(blk.tableAttrs.id))}"` : '';
    const tstyle = blk.tableAttrs?.style ? ` style="${escapeXmlAttr(blk.tableAttrs.style)}"` : '';
    const rowXml = rows
      .map((row: ParsedTableRow) => {
        const ra = row.align ? ` align="${row.align}"` : '';
        const cells = row.cells
          .map((cell) => {
            const tag = cell.header ? 'th' : 'td';
            let ca = '';
            if (cell.id) ca += ` id="${escapeXmlAttr(ids.allocate(cell.id))}"`;
            if (cell.style) ca += ` style="${escapeXmlAttr(cell.style)}"`;
            if (cell.colspan > 1) ca += ` colspan="${cell.colspan}"`;
            if (cell.rowspan > 1) ca += ` rowspan="${cell.rowspan}"`;
            if (cell.align) ca += ` align="${cell.align}"`;
            if (cell.valign) ca += ` valign="${cell.valign}"`;
            return `<${tag}${ca}>${renderInlines(cell.inlines)}</${tag}>`;
          })
          .join('');
        return `<tr${ra}>${cells}</tr>`;
      })
      .join('');
    return `<table${tid}${tstyle}>${rowXml}</table>`;
  };

  const renderImageXml = (blk: ParsedBlock): string => {
    if (!blk.mediaEntry) return '';
    const binId = resolveBinaryId(blk.mediaEntry);
    if (!binId) return '';
    counts.pictures++;
    const alt = blk.alt ? ` alt="${escapeXmlAttr(blk.alt)}"` : '';
    const title = blk.title ? ` title="${escapeXmlAttr(blk.title)}"` : '';
    const id = blk.imageId
      ? ` id="${escapeXmlAttr(blockAllocatedId.get(blk) ?? ids.allocate(blk.imageId))}"`
      : '';
    return `<image l:href="#${escapeXmlAttr(binId)}"${alt}${title}${id}/>`;
  };

  // Group sequential FB2-specialized blocks (`cite`, `epigraph`, `poem`/`stanza`, `section-annotation`)
  // into schema-valid FB2 container elements.
  const renderBlockSequence = (
    seq: readonly ParsedBlock[],
    allowEpigraphAndAnnotationAtStart: boolean,
  ): {
    epigraphsXml: string[];
    leadingImageXml: string | null;
    annotationXml: string | null;
    bodyXml: string[];
  } => {
    const epigraphsXml: string[] = [];
    let leadingImageXml: string | null = null;
    let annotationXml: string | null = null;
    const bodyXml: string[] = [];
    let hasBodyBlock = false;

    let i = 0;
    while (i < seq.length) {
      const blk = seq[i]!;
      const kind = blk.semanticKind ?? 'p';

      // Epigraph group (allowed only before header image, annotation, and normal body blocks).
      if (
        kind === 'epigraph' &&
        allowEpigraphAndAnnotationAtStart &&
        !leadingImageXml &&
        !annotationXml &&
        !hasBodyBlock
      ) {
        const gid = blk.blockHint?.groupId;
        const epInner: string[] = [];
        const epAuthors: string[] = [];
        while (i < seq.length) {
          const cur = seq[i]!;
          const ck = cur.semanticKind ?? 'p';
          const sameGroup = gid
            ? cur.blockHint?.groupId === gid
            : ck === 'epigraph' || ck === 'text-author';
          if (!sameGroup) break;
          if (ck === 'epigraph') {
            epInner.push(
              `<p${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</p>`,
            );
          } else if (ck === 'text-author') {
            epAuthors.push(
              `<text-author${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</text-author>`,
            );
          } else if (ck === 'empty-line') {
            epInner.push('<empty-line/>');
          } else {
            break;
          }
          i++;
        }
        if (epInner.length > 0 || epAuthors.length > 0) {
          epigraphsXml.push(`<epigraph>${epInner.join('')}${epAuthors.join('')}</epigraph>`);
        }
        continue;
      }

      // Optional section header `<image/>` (FB2 2.1 XSD places a single `<image/>` between
      // `<epigraph>*` and `<annotation>?`, allowed even when the section holds child `<section>`s).
      if (
        blk.type === 'image' &&
        allowEpigraphAndAnnotationAtStart &&
        !leadingImageXml &&
        !annotationXml &&
        !hasBodyBlock
      ) {
        const im = renderImageXml(blk);
        if (im) leadingImageXml = im;
        i++;
        continue;
      }

      // Section annotation group (at most one per section, before normal body blocks).
      if (
        kind === 'section-annotation' &&
        allowEpigraphAndAnnotationAtStart &&
        !hasBodyBlock &&
        !annotationXml
      ) {
        const gid = blk.blockHint?.groupId;
        const annInner: string[] = [];
        while (i < seq.length) {
          const cur = seq[i]!;
          const ck = cur.semanticKind ?? 'p';
          const sameGroup = gid ? cur.blockHint?.groupId === gid : ck === 'section-annotation';
          if (!sameGroup) break;
          annInner.push(
            `<p${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</p>`,
          );
          i++;
        }
        if (annInner.length > 0) {
          annotationXml = `<annotation>${annInner.join('')}</annotation>`;
        }
        continue;
      }

      // Poem / stanza / verse group
      if (kind === 'poem' || kind === 'stanza' || kind === 'v') {
        const rootGid = blk.blockHint?.groupId?.split(':st_')[0];
        const poemTitles: string[] = [];
        const stanzas: Array<{ title?: string; verses: string[] }> = [];
        let curStanzaId: string | undefined;
        let curStanza: { title?: string; verses: string[] } | null = null;
        const poemAuthors: string[] = [];
        let poemDate: string | null = null;

        while (i < seq.length) {
          const cur = seq[i]!;
          const ck = cur.semanticKind ?? 'p';
          const curRoot = cur.blockHint?.groupId?.split(':st_')[0];
          const inPoem = rootGid
            ? curRoot === rootGid
            : ck === 'v' ||
              ck === 'poem' ||
              ck === 'stanza' ||
              ck === 'text-author' ||
              ck === 'date';
          if (!inPoem) break;
          if (ck === 'poem') {
            poemTitles.push(`<p>${renderInlines(cur.inlines, cur.inlineSpans)}</p>`);
          } else if (ck === 'stanza' || ck === 'v') {
            const sgid = cur.blockHint?.groupId;
            if (!curStanza || (sgid && sgid !== curStanzaId)) {
              curStanzaId = sgid;
              curStanza = { verses: [] };
              stanzas.push(curStanza);
            }
            if (ck === 'stanza') {
              curStanza.title = `<title><p>${renderInlines(cur.inlines, cur.inlineSpans)}</p></title>`;
            } else {
              curStanza.verses.push(
                `<v${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</v>`,
              );
            }
          } else if (ck === 'text-author') {
            poemAuthors.push(
              `<text-author${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</text-author>`,
            );
          } else if (ck === 'date') {
            const dText = (cur.inlines ?? []).map((s) => s.text ?? '').join('');
            const dVal =
              cur.blockHint?.dateValue && /^\d{4}-\d{2}-\d{2}$/.test(cur.blockHint.dateValue)
                ? ` value="${escapeXmlAttr(cur.blockHint.dateValue)}"`
                : '';
            poemDate = `<date${dVal}>${escapeXmlText(dText)}</date>`;
          } else {
            break;
          }
          i++;
        }
        const validStanzas = stanzas
          .filter((s) => s.verses.length > 0)
          .map((s) => `<stanza>${s.title ?? ''}${s.verses.join('')}</stanza>`);
        if (validStanzas.length > 0) {
          hasBodyBlock = true;
          const tXml = poemTitles.length > 0 ? `<title>${poemTitles.join('')}</title>` : '';
          bodyXml.push(
            `<poem>${tXml}${validStanzas.join('')}${poemAuthors.join('')}${poemDate ?? ''}</poem>`,
          );
        }
        continue;
      }

      // Cite / blockquote group
      if (kind === 'cite') {
        const gid = blk.blockHint?.groupId;
        const citeBody: string[] = [];
        const citeAuthors: string[] = [];
        while (i < seq.length) {
          const cur = seq[i]!;
          const ck = cur.semanticKind ?? 'p';
          const sameGroup = gid
            ? cur.blockHint?.groupId === gid
            : ck === 'cite' || ck === 'text-author';
          if (!sameGroup) break;
          if (ck === 'cite') {
            citeBody.push(
              `<p${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</p>`,
            );
          } else if (ck === 'text-author') {
            citeAuthors.push(
              `<text-author${pAttrsXml(cur.blockHint)}>${renderInlines(cur.inlines, cur.inlineSpans)}</text-author>`,
            );
          } else if (ck === 'empty-line') {
            citeBody.push('<empty-line/>');
          } else if (cur.type === 'table') {
            citeBody.push(renderTableXml(cur));
          } else {
            break;
          }
          i++;
        }
        if (citeBody.length > 0 || citeAuthors.length > 0) {
          hasBodyBlock = true;
          bodyXml.push(`<cite>${citeBody.join('')}${citeAuthors.join('')}</cite>`);
        }
        continue;
      }

      // Single block items
      hasBodyBlock = true;
      if (blk.type === 'empty-line') {
        bodyXml.push('<empty-line/>');
      } else if (blk.type === 'table') {
        const t = renderTableXml(blk);
        if (t) bodyXml.push(t);
      } else if (blk.type === 'image') {
        const im = renderImageXml(blk);
        if (im) bodyXml.push(im);
      } else if (kind === 'subtitle') {
        const id = blockAllocatedId.get(blk);
        bodyXml.push(
          `<subtitle${pAttrsXml({ id, lang: blk.blockHint?.lang, style: blk.blockHint?.style })}>${renderInlines(blk.inlines, blk.inlineSpans)}</subtitle>`,
        );
      } else {
        const id = blockAllocatedId.get(blk);
        const content = renderInlines(blk.inlines, blk.inlineSpans);
        if (content.length > 0) {
          bodyXml.push(
            `<p${pAttrsXml({ id, lang: blk.blockHint?.lang, style: blk.blockHint?.style })}>${content}</p>`,
          );
        }
      }
      i++;
    }

    return { epigraphsXml, leadingImageXml, annotationXml, bodyXml };
  };

  // FB2 2.1 XSD requires a section's body sequence to begin with `p`, `poem`, `subtitle`, `cite`,
  // `empty-line`, or `table` (never directly with a bare `<image/>`).
  const ensureValidSectionBody = (bodyXml: readonly string[]): string => {
    if (bodyXml.length === 0) return '<empty-line/>';
    if (bodyXml[0]!.startsWith('<image')) {
      return `<empty-line/>${bodyXml.join('')}`;
    }
    return bodyXml.join('');
  };

  // --- Build Hierarchical FB2 Bodies & Sections (always XSD-valid: never mixing blocks + subsections!) ---
  interface TreeSection {
    level: number;
    id?: string;
    lang?: string;
    titleLines: ParsedInlineSegment[][];
    blocks: ParsedBlock[];
    children: TreeSection[];
  }

  interface TreeBody {
    name?: string;
    lang?: string;
    leadingImageXml?: string;
    titleLines: string[];
    rootSections: TreeSection[];
    orphanBlocks: ParsedBlock[];
  }

  const bodies: TreeBody[] = [];
  const ensureBody = (hint?: { name?: string; lang?: string; title?: string[] }): TreeBody => {
    const b: TreeBody = {
      name: hint?.name,
      lang: hint?.lang,
      titleLines: hint?.title ?? [],
      rootSections: [],
      orphanBlocks: [],
    };
    bodies.push(b);
    return b;
  };

  let activeBody = ensureBody();
  let sectionStack: TreeSection[] = [];

  // Restore exact-match skipped leading main-body cover image on round-trip!
  if (payload?.skippedLeadingCover) {
    const sc = payload.skippedLeadingCover;
    const matchedMedia = Object.entries(payload.pictures).find(
      ([, h]) => h.binaryId === sc.binaryId,
    )?.[0];
    const resolvedCoverId = matchedMedia ? resolveBinaryId(matchedMedia) : sc.binaryId;
    if (resolvedCoverId) {
      counts.pictures++;
      const alt = sc.alt ? ` alt="${escapeXmlAttr(sc.alt)}"` : '';
      const title = sc.title ? ` title="${escapeXmlAttr(sc.title)}"` : '';
      const id = sc.id ? ` id="${escapeXmlAttr(ids.allocate(sc.id))}"` : '';
      activeBody.leadingImageXml = `<image l:href="#${escapeXmlAttr(resolvedCoverId)}"${alt}${title}${id}/>`;
    }
  }

  const pushSection = (sec: TreeSection): void => {
    while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1]!.level >= sec.level) {
      sectionStack.pop();
    }
    if (sectionStack.length === 0) {
      activeBody.rootSections.push(sec);
    } else {
      sectionStack[sectionStack.length - 1]!.children.push(sec);
    }
    sectionStack.push(sec);
  };

  const splitInlinesByLineBreak = (
    segs: readonly ParsedInlineSegment[] | undefined,
  ): ParsedInlineSegment[][] => {
    if (!segs || segs.length === 0) return [];
    const lines: ParsedInlineSegment[][] = [[]];
    for (const s of segs) {
      if (s.kind === 'text' && s.text && s.text.includes('\n')) {
        const pieces = s.text.split('\n');
        pieces.forEach((piece, idx) => {
          if (idx > 0) lines.push([]);
          if (piece) lines[lines.length - 1]!.push({ ...s, text: piece });
        });
      } else {
        lines[lines.length - 1]!.push(s);
      }
    }
    return lines.filter((line) => line.length > 0);
  };

  let isFirstBody = true;
  for (const blk of storyBlocks) {
    if (blk.bodyHint) {
      if (
        isFirstBody &&
        activeBody.rootSections.length === 0 &&
        activeBody.orphanBlocks.length === 0
      ) {
        activeBody.name = blk.bodyHint.name;
        activeBody.lang = blk.bodyHint.lang;
        if (blk.bodyHint.title) activeBody.titleLines = blk.bodyHint.title;
        isFirstBody = false;
      } else {
        activeBody = ensureBody(blk.bodyHint);
        sectionStack = [];
      }
      // If this paragraph was the rendered body title (`MfbeBodyTitle`), consume it without duplicating.
      if (blk.styleId === 'MfbeBodyTitle') {
        continue;
      }
      if (blk.type === 'heading' && blk.bodyHint.title && !blk.sectionHint) {
        continue;
      }
    }

    if (blk.type === 'heading') {
      const level = blk.sectionHint?.depth ?? blk.level ?? 1;
      const id = blockAllocatedId.get(blk);
      pushSection({
        level,
        id,
        lang: blk.sectionHint?.lang,
        titleLines: splitInlinesByLineBreak(blk.inlines),
        blocks: [],
        children: [],
      });
      continue;
    }

    // Untitled round-trip section start
    if (blk.sectionHint && blk.sectionHint.untitled) {
      const id = blockAllocatedId.get(blk);
      pushSection({
        level: blk.sectionHint.depth,
        id,
        lang: blk.sectionHint.lang,
        titleLines: [],
        blocks: [],
        children: [],
      });
    }

    if (sectionStack.length > 0) {
      sectionStack[sectionStack.length - 1]!.blocks.push(blk);
    } else {
      activeBody.orphanBlocks.push(blk);
    }
  }

  const serializeTreeSection = (sec: TreeSection): string => {
    counts.sections++;
    const attrs =
      (sec.id ? ` id="${escapeXmlAttr(sec.id)}"` : '') +
      (sec.lang ? ` xml:lang="${escapeXmlAttr(sec.lang)}"` : '');
    const titleXml =
      sec.titleLines.length > 0
        ? `<title>${sec.titleLines.map((line) => `<p>${renderInlines(line)}</p>`).join('')}</title>`
        : '';

    const rendered = renderBlockSequence(sec.blocks, true);
    const epXml = rendered.epigraphsXml.join('');
    const imgXml = rendered.leadingImageXml ?? '';
    const annXml = rendered.annotationXml ?? '';

    if (sec.children.length > 0) {
      // FB2 2.1 forbids mixing direct body blocks with child `<section>`s: wrap intro blocks in an untitled child section.
      const introSec =
        rendered.bodyXml.length > 0
          ? `<section>${ensureValidSectionBody(rendered.bodyXml)}</section>`
          : '';
      if (introSec) counts.sections++;
      const childXml = sec.children.map(serializeTreeSection).join('');
      return `<section${attrs}>${titleXml}${epXml}${imgXml}${annXml}${introSec}${childXml}</section>`;
    }

    const bodyContent = ensureValidSectionBody(rendered.bodyXml);
    return `<section${attrs}>${titleXml}${epXml}${imgXml}${annXml}${bodyContent}</section>`;
  };

  const bodyXmls: string[] = [];
  for (const b of bodies) {
    const bAttrs =
      (b.name ? ` name="${escapeXmlAttr(b.name)}"` : '') +
      (b.lang ? ` xml:lang="${escapeXmlAttr(b.lang)}"` : '');
    const bTitle =
      b.titleLines.length > 0
        ? `<title>${b.titleLines.map((line) => `<p>${escapeXmlText(line)}</p>`).join('')}</title>`
        : '';

    const sectionsOut: string[] = [];
    if (b.orphanBlocks.length > 0) {
      const rendered = renderBlockSequence(b.orphanBlocks, true);
      const inner =
        rendered.epigraphsXml.join('') +
        (rendered.leadingImageXml ?? '') +
        (rendered.annotationXml ?? '') +
        ensureValidSectionBody(rendered.bodyXml);
      counts.sections++;
      sectionsOut.push(`<section>${inner}</section>`);
    }
    for (const sec of b.rootSections) {
      sectionsOut.push(serializeTreeSection(sec));
    }
    if (sectionsOut.length === 0) {
      counts.sections++;
      sectionsOut.push('<section><empty-line/></section>');
    }
    bodyXmls.push(
      `<body${bAttrs}>${b.leadingImageXml ?? ''}${bTitle}${sectionsOut.join('')}</body>`,
    );
  }

  // --- Assemble Notes Bodies ---
  let notesXml = '';
  if (noteSectionsByKey.size > 0) {
    const byBodyName = new Map<
      string,
      Array<typeof noteSectionsByKey extends Map<string, infer V> ? V : never>
    >();
    for (const entry of noteSectionsByKey.values()) {
      const list = byBodyName.get(entry.bodyName) ?? [];
      list.push(entry);
      byBodyName.set(entry.bodyName, list);
    }

    const notesBodyParts: string[] = [];
    for (const [bodyName, entries] of byBodyName) {
      // Group notes preserving optional round-trip `groupPath`.
      interface NoteGroupNode {
        title?: string;
        leafXmls: string[];
        subgroups: Map<string, NoteGroupNode>;
      }
      const root: NoteGroupNode = { leafXmls: [], subgroups: new Map() };
      for (const entry of entries) {
        const rendered = renderBlockSequence(entry.blocks, false);
        const titleXml = entry.label ? `<title><p>${escapeXmlText(entry.label)}</p></title>` : '';
        const content = ensureValidSectionBody(rendered.bodyXml);
        const secXml = `<section id="${escapeXmlAttr(entry.fb2Id)}">${titleXml}${content}</section>`;

        let target = root;
        for (const groupTitle of entry.groupPath) {
          let next = target.subgroups.get(groupTitle);
          if (!next) {
            next = { title: groupTitle, leafXmls: [], subgroups: new Map() };
            target.subgroups.set(groupTitle, next);
          }
          target = next;
        }
        target.leafXmls.push(secXml);
      }

      const emitGroup = (g: NoteGroupNode): string => {
        const inner = [
          ...g.leafXmls,
          ...[...g.subgroups.values()].map((sg) => {
            const st = sg.title ? `<title><p>${escapeXmlText(sg.title)}</p></title>` : '';
            return `<section>${st}${emitGroup(sg)}</section>`;
          }),
        ].join('');
        return inner;
      };

      const inner = emitGroup(root);
      if (inner) {
        notesBodyParts.push(`<body name="${escapeXmlAttr(bodyName)}">${inner}</body>`);
      }
    }
    notesXml = notesBodyParts.join('');
  }

  // --- Final FictionBook XML Assembly ---
  let fb2Xml: string;
  if (useEmbeddedMeta && payload) {
    const cssXml = serializeFb2StylesheetsXml(payload.stylesheets);
    fb2Xml =
      `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
      `${cssXml}${payload.descriptionXml}${bodyXmls.join('')}${notesXml}` +
      `</FictionBook>\n`;
  } else {
    const title = parsed.core.title || parsed.titleFallback || options.fallbackTitle;
    const authors = parsed.core.creators.map(splitAuthorName);
    const genres: string[] = [];
    const extraKeywords: string[] = [];
    const tryMatchGenre = (raw: string): boolean => {
      const token = raw.trim();
      if (!token) return false;
      const mapped = options.genreMap?.get(token.toLowerCase());
      if (mapped) {
        if (!genres.includes(mapped)) genres.push(mapped);
        return true;
      }
      if (!options.genreMap && /^[a-z0-9_]+$/i.test(token)) {
        if (!genres.includes(token)) genres.push(token);
        return true;
      }
      return false;
    };
    for (const s of parsed.core.subjects) {
      if (!tryMatchGenre(s)) extraKeywords.push(s.trim());
    }
    if (parsed.core.keywords) {
      for (const kw of parsed.core.keywords.split(/[,;]+/)) {
        const trimmed = kw.trim();
        if (!trimmed) continue;
        // Tools like Calibre place FB2 genre codes in `cp:keywords`; map recognized genres into
        // `<genre>` and preserve remaining terms in `<keywords>`.
        if (!tryMatchGenre(trimmed)) extraKeywords.push(trimmed);
      }
    }
    // FB2 2.1 requires at least one valid `<genre>` code; `template.xml` ships an empty `<genre/>`.
    if (genres.length === 0) {
      genres.push('unrecognised');
    }
    const keywords = extraKeywords.filter(Boolean).join(', ') || undefined;
    const coverBinId = parsed.coverMediaEntry ? resolveBinaryId(parsed.coverMediaEntry) : null;
    const desc: MarkdownDescription = {
      title,
      authors,
      genres,
      annotation: parsed.core.description
        ? parsed.core.description
            .split(/\r?\n+/)
            .map((p) => p.trim())
            .filter(Boolean)
        : [],
      keywords,
      date: parsed.core.created || undefined,
      cover: coverBinId ? `#${coverBinId}` : undefined,
      lang: normalizeLanguage(parsed.core.language),
      translators: [],
      sequences: [],
      custom: [],
    };
    fb2Xml = buildBook(options.templateXml, {
      description: desc,
      bodyXml: bodyXmls.join(''),
      notesXml: notesXml || null,
      stylesheets: [],
      pictures: [],
      formulas: [],
      chars: [],
      diagrams: [],
      summary: [],
      cssFiles: [],
      stats: counts,
    });
  }

  return {
    fb2Xml,
    useEmbeddedMeta,
    counts,
    neededImages,
    summary,
  };
}

/** Rasterizes a standalone SVG entry via the lazy Chromium canvas helper. */
async function rasterizeSvgPart(
  token: string,
  entry: string,
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(docxImportPartUrl(token, entry));
  if (!response.ok) {
    throw new Error(`SVG fetch failed: HTTP ${response.status}`);
  }
  const svgText = await response.text();
  const { MAX_HEIGHT, MAX_WIDTH, rasterise, sized } =
    await import('@/features/markdown/diagrams/raster');
  const drawing = sized(svgText, (w, h) => Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h));
  const drawn = await rasterise(drawing.text, drawing.width, drawing.height, '', 'svg');
  return { blob: drawn.blob, contentType: drawn.contentType };
}

/**
 * Transfers all referenced DOCX pictures directly into `docId`'s `BinaryStore`:
 * - Raster formats (JPEG/PNG byte-for-byte, GIF/BMP/WebP/TIFF converted in core) via `docxImport.picture`
 * - Standalone SVGs (no paired PNG fallback) rasterized via Chromium canvas + `uploadBinary`
 */
export async function transferDocxPictures(options: {
  rpc: RpcClient;
  token: string;
  docId: string;
  needed: ReadonlyMap<string, ParsedDocxImageNeed>;
  jpegQuality: number;
  summary: DocxSummaryItem[];
  onStep?: () => Promise<void> | void;
}): Promise<{ added: BinaryMeta[]; binaryIdByMedia: Map<string, string> }> {
  const added: BinaryMeta[] = [];
  const binaryIdByMedia = new Map<string, string>();

  for (const [mediaEntry, need] of options.needed) {
    if (need.isSvg) {
      try {
        const drawn = await rasterizeSvgPart(options.token, mediaEntry);
        const meta = await uploadBinary(options.docId, drawn.blob, {
          contentType: drawn.contentType,
          suggestedId: need.suggestedBinaryId.replace(/\.svg$/i, '.png'),
        });
        added.push(meta);
        binaryIdByMedia.set(mediaEntry, meta.id);
        options.summary.push({ kind: 'svgRasterized', detail: mediaEntry });
      } catch {
        options.summary.push({ kind: 'droppedUnsupportedDrawings', detail: mediaEntry });
      }
    } else {
      const res = await options.rpc.call('docxImport.picture', {
        token: options.token,
        docId: options.docId,
        entry: mediaEntry,
        binaryId: need.suggestedBinaryId,
        jpegQuality: options.jpegQuality,
      });
      if (res.ok) {
        added.push(res.binary);
        binaryIdByMedia.set(mediaEntry, res.binary.id);
      } else {
        options.summary.push({ kind: 'droppedUnsupportedDrawings', detail: mediaEntry });
      }
    }
    if (options.onStep) await options.onStep();
  }

  return { added, binaryIdByMedia };
}
