/**
 * Feature 016 (User Story 1; D5 to D8, plan DP-11, research R4): the editor's own PDF back as the book it was.
 * The parts of the structure are numbered as the export's paginator numbered its blocks; the hints give each
 * block back what the PDF cannot show (its FB2 element, containers, sections, styles, ids); the anchors check
 * that the numbering still fits, and what no longer fits is counted (D8).
 */

import { attr, FB2_NS, inline, text, XLINK_NS, type Span } from './fb2';
import type { HintsV1, PdfPageModel } from './model';
import { partText, type Flattened, type Footnote, type Part, type Run } from './parts';

export interface PictureWanted {
  /** The reader's id of the picture, and its page. */
  readerId: string;
  page: number;
  /** The book's own binary id, restored (014 R4: the picture map keeps it). */
  binaryId: string;
}

export interface OursResult {
  /** The book without its binaries: the core adds them (pdfImport.addPictures). */
  xml: string;
  pictures: PictureWanted[];
  /** Blocks whose anchor the PDF's text no longer matches (D8). */
  mismatches: number;
  counts: { sections: number; pictures: number; tables: number; notes: number };
}

interface Block {
  b: number;
  /** The hints' path: containers and the generic element ('' for a paragraph). */
  kind: string;
  part: Part | null;
  page: number;
}

const CONTAINER_NAMES = new Set(['epigraph', 'cite', 'poem', 'stanza', 'annotation']);
const GENERIC = new Set(['v', 'subtitle', 'text-author', 'date']);
const squeeze = (value: string): string => value.replace(/\s+/g, ' ').trim();

function kindsOf(hints: HintsV1): string[] {
  const kinds = new Array<string>(hints.blocks).fill('');
  for (const [b, count, path] of hints.kinds) {
    for (let i = b; i < b + count && i < kinds.length; i++) kinds[i] = path;
  }
  return kinds;
}

/**
 * The spaces between runs, which the PDF does not draw: where a run begins a new line, or stands apart from
 * the run before on its line (an inline picture too); never before closing punctuation, never in a sub- or
 * superscript's step. A soft hyphen at a line's end is dropped and the word joined.
 */
const styled = (run: Run): boolean =>
  !!(run.bold || run.italic || run.mono || run.sub || run.sup || run.uri || run.dest);

export function spaceRuns(
  runs: readonly Run[],
  /** A gap between two text runs is a space: for a record of 0.0.11, which names no spaces (D7). */
  { gaps = false }: { gaps?: boolean } = {},
): Run[] {
  const out = runs.map((run) => ({ ...run }));
  let previous: Run | null = null;
  // The run before `previous`: a hyphen may be a run of its own, its word in the run before it.
  let earlier: Run | null = null;
  for (const run of out) {
    if (!run.text && !run.picture) continue;
    if (previous) {
      const size = Math.max(run.size ?? 0, previous.size ?? 0) || 10;
      // Where the run before ends and this one begins: their last and first characters, not their boxes,
      // which span every line of a run over several (D32's library run: a space before each note mark).
      const left = run.startLeft ?? run.left;
      const top = run.startTop ?? run.top;
      const right = previous.endRight ?? previous.right;
      const bottomTop = previous.endTop ?? previous.top;
      const known = left !== undefined && right !== undefined;
      const newLine =
        run.page !== previous.page ||
        (!run.picture &&
          !previous.picture &&
          top !== undefined &&
          bottomTop !== undefined &&
          top - bottomTop > 0.8 * size) ||
        (known && left! < right! - 2 * size);
      // Between text runs on one line nothing is added: the engine draws the book's spaces as characters
      // (D32's library run: a gap between two fonts was taken for a space). Beside an inline picture it
      // draws none, so a gap there is one.
      const apart =
        known && (gaps || !!run.picture || !!previous.picture) && left! - right! > 0.15 * size;
      const before = !previous.picture && /\s$/.test(previous.text);
      const after = !run.picture && /^\s/.test(run.text);
      const closing = !run.picture && /^[.,;:!?)\]}»”’…%]/u.test(run.text);
      // A word's own hyphen at a line's end: the word goes on, without a space (D32).
      const hyphen =
        newLine &&
        !previous.picture &&
        /\S[-\u2010\u2012\u2013\u2014]\u00ad*$/u.test(
          `${earlier && !earlier.picture ? earlier.text.slice(-4) : ''}${previous.text}`,
        );
      if ((newLine || apart) && !before && !after && !closing && !hyphen) {
        if (!previous.picture) {
          if (previous.text.endsWith('\u00ad')) previous.text = previous.text.slice(0, -1);
          // A line's end after marked text: the space goes outside the mark, as FB2 sets it (D32).
          else if (!run.picture && styled(previous) && !styled(run)) run.text = ` ${run.text}`;
          else previous.text += ' ';
        } else if (!run.picture) run.text = ` ${run.text}`;
      }
    }
    earlier = previous;
    previous = run;
  }
  return out;
}

/** Runs without the bold and italic that every run with text has (the block's look, not its markup). */
export function stripWhole(runs: readonly Run[]): Run[] {
  const texts = runs.filter((run) => run.text.trim());
  const bold = texts.length > 0 && texts.every((run) => run.bold);
  const italic = texts.length > 0 && texts.every((run) => run.italic);
  if (!bold && !italic) return [...runs];
  return runs.map((run) => {
    const copy = { ...run };
    if (bold) delete copy.bold;
    if (italic) delete copy.italic;
    return copy;
  });
}

const copyPart = (part: Part): Part => ({
  ...part,
  runs: [...part.runs],
  ...(part.rows ? { rows: [...part.rows] } : {}),
});

/** A part on the next page joined to the part it goes on from. */
function joinInto(last: Part, part: Part): void {
  if (last.kind === 'table') {
    // A continued table repeats its header rows: they are not rows of their own.
    const header = (last.rows ?? []).filter((row) => row.every((cell) => cell.header));
    const rows = (part.rows ?? []).filter(
      (row, index) =>
        !(
          index < header.length &&
          row.length === header[index].length &&
          row.every((cell, c) => partText(cell.runs) === partText(header[index][c].runs))
        ),
    );
    last.rows = [...(last.rows ?? []), ...rows];
    return;
  }
  const runs = [...part.runs];
  const tail = last.runs[last.runs.length - 1];
  const head = runs[0];
  if (tail && head && !/\s$/.test(tail.text) && !/^\s/.test(head.text)) {
    if (tail.text.endsWith('\u00ad'))
      last.runs[last.runs.length - 1] = { ...tail, text: tail.text.slice(0, -1) };
    // A word's own hyphen or dash at the page's end: the word goes on (D32: "ток-шоу").
    else if (!/\S[-\u2010\u2012\u2013\u2014]\u00ad*$/u.test(tail.text)) {
      // After marked text the space goes outside the mark, as at a line's end.
      if (styled(tail) && !styled(head)) runs[0] = { ...head, text: ` ${head.text}` };
      else last.runs[last.runs.length - 1] = { ...tail, text: `${tail.text} ` };
    }
  }
  last.runs.push(...runs);
}

/**
 * Feature 016 (D6): the parts joined where the record says a block goes on onto the next page - each block takes
 * its part and, once per page break the paginator recorded, the next one.
 */
function joinRecorded(
  parts: Part[],
  kinds: readonly string[],
  continued: readonly number[],
): Part[] {
  const breaks = new Map<number, number>();
  for (const b of continued) breaks.set(b, (breaks.get(b) ?? 0) + 1);
  const out: Part[] = [];
  let cursor = 0;
  for (let b = 0; b < kinds.length && cursor < parts.length; b++) {
    if (kinds[b].endsWith('empty-line')) continue;
    const joined = copyPart(parts[cursor++]);
    for (let n = breaks.get(b) ?? 0; n > 0 && cursor < parts.length; n--)
      joinInto(joined, parts[cursor++]);
    out.push(joined);
  }
  while (cursor < parts.length) out.push(copyPart(parts[cursor++]));
  return out;
}

/**
 * The parts a page break split, joined: as many as the hints' count of blocks needs (R4). The export cuts a
 * paragraph where a line ends and sets its part on the next page without the first-line indent
 * (`mfbe-continued`), so a part that begins at the page's left margin after one that ends with a full line is
 * most likely the rest of it; a small letter at its start and no full stop before count too (D32's library
 * run: German nouns begin with capitals, and its quotes close with "“").
 */
function joinSplit(
  parts: Part[],
  needed: number,
  starts: ReadonlySet<number> = new Set(),
  /** The blocks' anchors (their first 16 characters): a part that begins with one begins its block. */
  anchors: ReadonlySet<string> = new Set(),
): Part[] {
  const extra = parts.length - needed;
  if (extra <= 0) return parts;
  // The text block: where its lines begin and end, over the pages of one side (odd or even, which a book may
  // mirror) - a page of a few short lines tells nothing of its own (D32's library run).
  const sides = [0, 1].map(() => ({ left: Infinity, right: -Infinity }));
  for (const part of parts)
    for (const run of part.runs) {
      if (run.left === undefined || run.right === undefined || !run.text.trim()) continue;
      const side = sides[run.page % 2];
      side.left = Math.min(side.left, run.left);
      side.right = Math.max(side.right, run.right);
    }
  const margins = { get: (page: number) => sides[page % 2] };
  const scored: { i: number; score: number }[] = [];
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const part = parts[i];
    // A page where a flow begins - the annotation, the history, a body - continues nothing (D32).
    if (part.page <= before.page || before.kind !== part.kind || starts.has(part.page)) continue;
    if (part.kind !== 'p' && part.kind !== 'table') continue;
    let score = part.kind === 'table' ? 3 : 0;
    const first = part.runs.find((run) => run.text.trim());
    const last = [...before.runs].reverse().find((run) => run.text.trim());
    const size = first?.size ?? 10;
    const here = margins.get(part.page);
    if (
      first?.startLeft !== undefined &&
      Number.isFinite(here.left) &&
      first.startLeft - here.left < size * 0.3
    )
      score += 4;
    const there = last ? margins.get(last.page) : undefined;
    // A part of one line ends a full line only if it also begins at the margin: a line set to the right (an
    // author's line under a quote) ends at the margin however short (D32's library run).
    const opening = before.runs.find((run) => run.text.trim());
    const oneLine =
      opening?.startTop !== undefined &&
      last?.endTop !== undefined &&
      opening.page === last.page &&
      Math.abs(opening.startTop - last.endTop) < 2;
    const widthOf = there && Number.isFinite(there.left) ? there.left : undefined;
    if (
      last?.endRight !== undefined &&
      there &&
      Number.isFinite(there.right) &&
      there.right - last.endRight < size * 2.5 &&
      (!oneLine ||
        (opening?.startLeft !== undefined &&
          widthOf !== undefined &&
          opening.startLeft - widthOf < size * 2))
    )
      score += 2;
    const start = partText(part.runs).trimStart();
    const end = partText(before.runs).trimEnd();
    const head = start.replace(/\s+/g, ' ').slice(0, 16);
    if (head.length >= 8 && anchors.has(head)) score -= 10;
    if (/^\p{Ll}/u.test(start)) score += 1;
    if (!/[.!?…:;»"”“)\]]$/u.test(end)) score += 1;
    scored.push({ i, score });
  }
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  const join = new Set(scored.slice(0, extra).map((entry) => entry.i));
  const out: Part[] = [];
  parts.forEach((part, i) => {
    const last = out[out.length - 1];
    if (!join.has(i) || !last) out.push(copyPart(part));
    else joinInto(last, part);
  });
  return out;
}

const RTL =
  '\\p{Script=Hebrew}\\p{Script=Arabic}\\p{Script=Syriac}\\p{Script=Thaana}\\p{Script=Nko}';
const RTL_RUN = new RegExp(
  `[${RTL}](?:[${RTL}\\d\\s.,:;!?'"()\\[\\]{}<>\\-\u2013\u2014]*[${RTL}])?`,
  'gu',
);
const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
};

/**
 * Right-to-left text in the order the book wrote it (D32's library run: Hebrew came back reversed). The engine
 * draws such text in the order it stands on the line, so each run of it is turned round - its numbers, written
 * left to right, kept as they are, and the brackets it mirrors put back.
 */
export function logicalOrder(text: string): string {
  if (!new RegExp(`[${RTL}]`, 'u').test(text)) return text;
  return text.replace(RTL_RUN, (run) =>
    [...run]
      .reverse()
      .map((char) => MIRRORED[char] ?? char)
      .join('')
      .replace(/\d+/g, (digits) => [...digits].reverse().join('')),
  );
}

const inLogicalOrder = (runs: readonly Run[]): Run[] =>
  // The reader's mark of a hyphen ending a line goes: the editor's PDFs break no words (D12).
  runs.map((run) =>
    run.text ? { ...run, text: logicalOrder(run.text).replace(/\u2063/g, '') } : run,
  );

export function convertOurs(
  hints: HintsV1,
  flat: Flattened,
  pages: readonly PdfPageModel[],
  description: string,
  /** False when an FBD gives the description whole (D23): its annotation and history pages are not used. */
  { descriptionPages = true }: { descriptionPages?: boolean } = {},
): OursResult {
  // A record of 0.0.11 names no spaces: its gaps between runs are read as spaces, as then (D7).
  const legacy = !Array.isArray(hints.spaces);
  // Since feature 016 the record names the code (D6): a monospaced font alone - a symbol's fallback - is none.
  const inOrder = (runs: readonly Run[]): Run[] =>
    inLogicalOrder(runs).map((run) => (!legacy && run.mono ? { ...run, mono: false } : run));
  // Right-to-left text in the book's order, everywhere the PDF gave it (D32).
  flat = {
    parts: flat.parts.map((part) => ({
      ...part,
      runs: inOrder(part.runs),
      ...(part.rows
        ? {
            rows: part.rows.map((row) =>
              row.map((cell) => ({ ...cell, runs: inOrder(cell.runs) })),
            ),
          }
        : {}),
      ...(part.caption ? { caption: inOrder(part.caption) } : {}),
    })),
    footnotes: flat.footnotes.map((note) => ({
      ...note,
      paragraphs: note.paragraphs.map(inLogicalOrder),
    })),
  };
  const kinds = kindsOf(hints);
  const generated = new Set(
    [hints.generated.cover, hints.generated.titlePage].filter((n): n is number => !!n),
  );
  const spaced = flat.parts
    .filter((part) => !generated.has(part.page))
    .map((part) => ({
      ...part,
      runs: spaceRuns(part.runs, { gaps: legacy }),
      ...(part.rows
        ? {
            rows: part.rows.map((row) =>
              row.map((cell) => ({ ...cell, runs: spaceRuns(cell.runs, { gaps: legacy }) })),
            ),
          }
        : {}),
    }));
  let needed = 0;
  for (const kind of kinds) needed += kind.endsWith('empty-line') ? 0 : 1;
  const starts = new Set<number>(
    [
      hints.generated.annotationPage,
      hints.generated.historyPage,
      ...hints.bodies.map((body) => body.page + 1),
    ].filter((n): n is number => !!n),
  );
  const anchors = new Set(Object.values(hints.anchors).filter((anchor) => anchor.length >= 8));
  // Feature 016 (D19, D32): a page whose foot holds only the rest of a note cut on the page before shows no
  // note's label, so its paragraphs came as text. The record names those pages: the parts at the end of such a
  // page in the notes' smaller size go back to the notes, after the note they go on from.
  const footnotes: Footnote[] = [...flat.footnotes];
  let textParts = spaced;
  if (hints.carried?.length) {
    const sizes = new Map<number, number>();
    for (const part of spaced)
      for (const run of part.runs)
        if (run.text.trim() && run.size) {
          const size = Math.round(run.size * 10) / 10;
          sizes.set(size, (sizes.get(size) ?? 0) + run.text.length);
        }
    const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
    const small = (part: Part): boolean =>
      part.kind === 'p' &&
      part.runs.some((run) => run.text.trim()) &&
      part.runs.every((run) => !run.text.trim() || (run.size ?? body) < body * 0.9);
    const moved = new Set<Part>();
    for (const page of hints.carried) {
      if (footnotes.some((note) => note.page === page && note.id === null)) continue;
      const rest: Part[] = [];
      for (let i = spaced.length - 1; i >= 0; i--) {
        if (spaced[i].page !== page) {
          if (rest.length > 0 || spaced[i].page < page) break;
          continue;
        }
        if (!small(spaced[i])) break;
        rest.unshift(spaced[i]);
      }
      if (rest.length === 0) continue;
      for (const part of rest) moved.add(part);
      let at = footnotes.findIndex((note) => note.page > page);
      if (at < 0) at = footnotes.length;
      footnotes.splice(at, 0, {
        id: null,
        label: '',
        page,
        paragraphs: rest.map((part) => part.runs),
      });
    }
    if (moved.size > 0) textParts = spaced.filter((part) => !moved.has(part));
  }
  // The record names the page breaks since feature 016; for a record of 0.0.11 they are judged (R4).
  const parts = Array.isArray(hints.continued)
    ? joinRecorded(textParts, kinds, hints.continued)
    : joinSplit(textParts, needed, starts, anchors);

  const sectionStarts = new Set(hints.sections.map(([b]) => b));
  // The blocks, numbered as the paginator numbered them.
  const blocks: Block[] = [];
  let cursor = 0;
  let lastPage = parts[0]?.page ?? 1;
  for (let b = 0; b < hints.blocks; b++) {
    const kind = kinds[b];
    if (kind.endsWith('empty-line')) {
      // An empty line draws nothing. One that begins a section goes with the block after it, on that block's
      // page (D32's library run found one counted into the annotation); any other stays with the block before
      // it (one ending a body's last section had gone into the next body).
      blocks.push({
        b,
        kind,
        part: null,
        page: sectionStarts.has(b) ? (parts[cursor]?.page ?? lastPage) : lastPage,
      });
      continue;
    }
    let part = parts[cursor++] ?? null;
    // A paragraph that holds a picture alone is tagged as a figure (D32's library run: a title's first line):
    // in a title, where no picture block stands, it is a paragraph of one inline picture (not for a record of
    // 0.0.11, which may name no kinds).
    if (!legacy && part?.kind === 'figure' && /(^|\/)title(\/|$)/.test(kind))
      part = {
        ...part,
        kind: 'p',
        runs: [{ text: '', page: part.page, picture: { alt: part.alt ?? '' } }],
      };
    const block: Block = { b, kind, part, page: part?.page ?? lastPage };
    lastPage = block.page;
    blocks.push(block);
  }
  let mismatches = Math.max(0, parts.length - cursor);
  for (const [key, anchor] of Object.entries(hints.anchors)) {
    const block = blocks[Number(key)];
    const found = block?.part ? squeeze(partText(block.part.runs)).slice(0, 16) : '';
    if (found !== anchor) mismatches++;
  }

  // Pictures: on each page, the book's pictures in the picture map and the reader's, both top to bottom.
  const wanted: PictureWanted[] = [];
  // Every placement, in page order: a binary shown twice is one picture placed twice.
  const placements: { page: number; binaryId: string }[] = [];
  for (const page of pages) {
    const mapped = hints.pictures
      .filter((p) => p.page === page.n)
      .sort((a, b) => a.box[1] - b.box[1]);
    const found = [...page.pictures].sort((a, b) => a.box[1] - b.box[1]);
    mapped.forEach((picture, index) => {
      const reader = found[index];
      if (!reader) return;
      if (!wanted.some((w) => w.binaryId === picture.binaryId))
        wanted.push({ readerId: reader.id, page: page.n, binaryId: picture.binaryId });
      placements.push({ page: page.n, binaryId: picture.binaryId });
    });
  }
  // The pictures of each page, in the order the parts show them.
  const perPage = new Map<number, string[]>();
  for (const placed of placements)
    perPage.set(placed.page, [...(perPage.get(placed.page) ?? []), placed.binaryId]);
  const takePicture = (page: number): string | null => {
    const list = perPage.get(page);
    return list && list.length ? list.shift()! : null;
  };
  // The cover page's picture is the description's (D5); it comes before any part.
  if (hints.generated.cover) takePicture(hints.generated.cover);

  // The notes printed after the text are notes too: links to them carry the note mark (D6).
  const afterIds: string[] = [];
  const afterEntry = hints.bodies.findIndex((entry) => entry.notes);
  if (afterEntry >= 0) {
    const from = hints.bodies[afterEntry].page + 1;
    const to = hints.bodies[afterEntry + 1]
      ? hints.bodies[afterEntry + 1].page + 1
      : Number.POSITIVE_INFINITY;
    const inAfter = new Set(
      blocks.filter((block) => block.page >= from && block.page < to).map((block) => block.b),
    );
    for (const [b, id] of hints.ids) if (inAfter.has(b)) afterIds.push(id);
  }
  const noteIds = new Set([...footnotes.filter((f) => f.id).map((f) => f.id!), ...afterIds]);
  const link = (run: Run): { href: string; note: boolean } | null => {
    if (run.uri) return { href: run.uri, note: false };
    if (run.dest && !run.dest.startsWith('mfbe-ref-'))
      return { href: `#${run.dest}`, note: noteIds.has(run.dest) };
    return null;
  };
  const spansOf = (b: number): Span[] => {
    const spans: Span[] = [];
    for (const entry of hints.styles) {
      if (entry[0] === b && entry.length === 4)
        spans.push({
          from: entry[1] as number,
          to: entry[2] as number,
          kind: 'style',
          name: String(entry[3]),
        });
    }
    for (const [mb, from, to, name] of hints.marks) {
      if (mb === b && (name === 'strikethrough' || name === 'sub' || name === 'sup'))
        spans.push({ from, to, kind: name });
      if (mb === b && name === 'code') spans.push({ from, to, kind: 'mono' });
      // Strong and emphasis the block's look hides (D6), recorded since feature 016.
      if (mb === b && (name === 'strong' || name === 'emphasis'))
        spans.push({ from, to, kind: name === 'strong' ? 'bold' : 'italic' });
    }
    return spans;
  };
  // A record that carries the marks the look hides: a presentational block's markup comes from it alone.
  const looksRecorded = hints.marks.some(
    ([, , , name]) => name === 'strong' || name === 'emphasis',
  );
  const blockStyle = new Map<number, string>();
  for (const entry of hints.styles)
    if (entry.length === 2) blockStyle.set(entry[0] as number, String(entry[1]));
  const blockLang = new Map<number, string>();
  for (const [b, from, to, lang] of hints.langs) {
    const block = blocks[b];
    const length = block?.part ? partText(block.part.runs).length : 0;
    if (from === 0 && to >= length) blockLang.set(b, lang);
  }
  // The text as the book has it at its line breaks (D6): spaces after a hyphen put back, spaces at breaks the
  // text has none taken out - in the order of their places, before the spans, which count them.
  const fixesAt = new Map<
    number,
    { offset: number; space: boolean; cluster?: string; inner?: number }[]
  >();
  for (const [b, offset] of hints.spaces ?? [])
    fixesAt.set(b, [...(fixesAt.get(b) ?? []), { offset, space: true }]);
  for (const [b, offset] of hints.joins ?? [])
    fixesAt.set(b, [...(fixesAt.get(b) ?? []), { offset, space: false }]);
  for (const [b, offset, cluster] of hints.clusters ?? [])
    fixesAt.set(b, [...(fixesAt.get(b) ?? []), { offset, space: false, cluster }]);
  for (const [b, offset, side] of hints.inner ?? [])
    fixesAt.set(b, [...(fixesAt.get(b) ?? []), { offset, space: false, inner: side }]);
  const withSpaces = (
    runs: readonly Run[],
    fixes:
      readonly { offset: number; space: boolean; cluster?: string; inner?: number }[] | undefined,
  ): Run[] => {
    if (!fixes?.length) return [...runs];
    const out = runs.map((run) => ({ ...run }));
    for (const fix of [...fixes].sort((x, y) => x.offset - y.offset)) {
      if (fix.inner !== undefined) {
        // A mark's own space at a line's end: from outside the mark, where the space was put, into it.
        let start = 0;
        for (let i = 0; i < out.length; i++) {
          const run = out[i];
          const local = fix.offset - start;
          if (local >= 0 && local < run.text.length) {
            if (run.text[local] === ' ' && fix.inner === 1 && local === 0 && i > 0) {
              out[i - 1].text += ' ';
              run.text = run.text.slice(1);
            } else if (
              run.text[local] === ' ' &&
              fix.inner === 0 &&
              local === run.text.length - 1 &&
              i + 1 < out.length
            ) {
              run.text = run.text.slice(0, -1);
              out[i + 1].text = ` ${out[i + 1].text}`;
            }
            break;
          }
          start += run.text.length;
        }
        continue;
      }
      let at = 0;
      for (const [index, run] of out.entries()) {
        const local = fix.offset - at;
        if (fix.space && local <= run.text.length && run.text) {
          const next = out[index + 1];
          // The characters on both sides of the place, across the runs: a space already there is kept.
          const after = local < run.text.length ? run.text[local] : next?.text[0];
          if (after !== ' ' && local > 0 && run.text[local - 1] !== ' ') {
            // Where a marked run ends, the space goes outside the mark (D32: "ru[/a] ,").
            if (local === run.text.length && next && styled(run) && !styled(next)) {
              if (!next.text.startsWith(' ')) next.text = ` ${next.text}`;
            } else run.text = `${run.text.slice(0, local)} ${run.text.slice(local)}`;
          }
          break;
        }
        if (fix.cluster && local < run.text.length) {
          // The composed letter the PDF holds, written again as the book wrote it.
          const composed = fix.cluster.normalize('NFC');
          if (run.text.startsWith(composed, local))
            run.text =
              run.text.slice(0, local) + fix.cluster + run.text.slice(local + composed.length);
          break;
        }
        if (!fix.space && !fix.cluster && fix.inner === undefined && local < run.text.length) {
          if (run.text[local] === ' ')
            run.text = run.text.slice(0, local) + run.text.slice(local + 1);
          break;
        }
        at += run.text.length;
      }
    }
    return out;
  };
  // The web addresses as the book wrote them (D6): on the runs of the link whose text begins there.
  const hrefsAt = new Map<number, [number, string][]>();
  for (const [b, offset, href] of hints.hrefs ?? [])
    hrefsAt.set(b, [...(hrefsAt.get(b) ?? []), [offset, href]]);
  const withHrefs = (runs: Run[], list: readonly [number, string][] | undefined): Run[] => {
    if (!list?.length) return runs;
    const out = runs.map((run) => ({ ...run }));
    for (const [offset, href] of list) {
      let at = 0;
      const index = out.findIndex((run) => {
        const hit = offset >= at && offset < at + run.text.length;
        at += run.text.length;
        return hit;
      });
      const first = out[index];
      if (!first?.uri) continue;
      for (const run of out)
        if (run.link !== undefined ? run.link === first.link : run === first) run.uri = href;
    }
    return out;
  };
  const freshAt = new Map(hints.fresh ?? []);
  const sectionAt = new Map(hints.sections);
  const idAt = new Map(hints.ids);
  const counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };
  const pictureFor = (run: Run): string | null => {
    const id = takePicture(run.page);
    if (id) counts.pictures++;
    return id;
  };

  /** Bold or italic over a whole block that its look gives (titles, epigraphs, named styles): not markup. */
  const presentational = (block: Block): boolean => {
    const segments = block.kind ? block.kind.split('/') : [];
    const last = segments[segments.length - 1] ?? '';
    return (
      block.part?.kind === 'title' ||
      ['subtitle', 'text-author', 'date'].includes(last) ||
      segments.includes('epigraph') ||
      blockStyle.has(block.b)
    );
  };
  const paragraph = (name: string, block: Block): string => {
    const part = presentational(block)
      ? {
          ...block.part!,
          runs: looksRecorded
            ? block.part!.runs.map((run) => {
                const copy = { ...run };
                delete copy.bold;
                delete copy.italic;
                return copy;
              })
            : stripWhole(block.part!.runs),
        }
      : block.part!;
    const attrs: string[] = [];
    const id = idAt.get(block.b);
    if (id && !sectionAt.has(block.b)) attrs.push(`id="${attr(id)}"`);
    const style = blockStyle.get(block.b);
    if (style) attrs.push(`style="${attr(style)}"`);
    const lang = blockLang.get(block.b);
    if (lang) attrs.push(`xml:lang="${attr(lang)}"`);
    const open = attrs.length ? `<${name} ${attrs.join(' ')}>` : `<${name}>`;
    const runs = withHrefs(withSpaces(part.runs, fixesAt.get(block.b)), hrefsAt.get(block.b));
    return `${open}${inline(runs, spansOf(block.b), link, pictureFor)}</${name}>`;
  };
  const tableXml = (block: Block): string => {
    counts.tables++;
    let index = 0;
    const align = new Map<number, string>();
    for (const [b, cell, value] of hints.tables) if (b === block.b) align.set(cell, value);
    const rows = (block.part?.rows ?? []).map((row) => {
      const cells = row.map((cell) => {
        const name = cell.header ? 'th' : 'td';
        const extra = [
          cell.colSpan ? ` colspan="${cell.colSpan}"` : '',
          cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : '',
          align.has(index) ? ` align="${attr(align.get(index)!)}"` : '',
        ].join('');
        index++;
        const runs = cell.header ? stripWhole(cell.runs) : cell.runs;
        return `<${name}${extra}>${inline(runs, [], link, pictureFor)}</${name}>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    return `<table>${rows.join('')}</table>`;
  };
  const imageXml = (block: Block): string => {
    const id = takePicture(block.page);
    if (!id) return '';
    counts.pictures++;
    const caption = block.part?.caption ? squeeze(partText(block.part.caption)) : '';
    // The engine names a picture by its caption when it has no alternative text of its own (D32's library
    // run): such a name is no alt.
    const ownAlt = block.part?.alt && squeeze(block.part.alt) !== caption ? block.part.alt : '';
    const alt = ownAlt ? ` alt="${attr(ownAlt)}"` : '';
    const title = caption ? ` title="${attr(caption)}"` : '';
    const own = idAt.get(block.b);
    return `<image l:href="#${attr(id)}"${alt}${title}${own ? ` id="${attr(own)}"` : ''}/>`;
  };

  /** Blocks as FB2: containers opened and closed as the paths change, titles and stanzas kept. */
  const render = (list: readonly Block[], strip = 0): string => {
    let out = '';
    const open: string[] = [];
    let titleOpen = false;
    let lastVerseTop: number | null = null;
    let verseGap: number | null = null;
    const closeTitle = (): void => {
      if (titleOpen) out += '</title>';
      titleOpen = false;
    };
    const closeTo = (depth: number): void => {
      closeTitle();
      while (open.length > depth) out += `</${open.pop()}>`;
    };
    list.forEach((block, index) => {
      const segments = block.kind ? block.kind.split('/') : [];
      const containers = segments.slice(strip).filter((s) => CONTAINER_NAMES.has(s));
      const last = segments[segments.length - 1] ?? '';
      let shared = 0;
      while (
        shared < open.length &&
        shared < containers.length &&
        open[shared] === containers[shared]
      )
        shared++;
      // A container begun anew under the same names (D6): closed and opened again from its depth.
      const again = freshAt.get(block.b);
      if (again !== undefined) shared = Math.min(shared, Math.max(0, again - strip));
      // A new stanza: a title of its own, or a gap between verses wider than their lines (R4).
      const isVerse = last === 'v';
      const top = block.part?.runs.find((run) => run.text)?.top;
      if (
        isVerse &&
        shared === containers.length &&
        containers[containers.length - 1] === 'stanza'
      ) {
        if (lastVerseTop !== null && top !== undefined) {
          const gap = top - lastVerseTop;
          if (verseGap !== null && gap > verseGap * 1.4) shared = containers.length - 1;
          else if (gap > 0) verseGap = verseGap === null ? gap : Math.min(verseGap, gap);
        }
      }
      if (
        block.part?.kind === 'title' &&
        containers.length &&
        containers[containers.length - 1] === open[containers.length - 1] &&
        !titleOpen &&
        open.length === containers.length
      ) {
        // A title begins its container (a poem's or a stanza's title): the container is new.
        const element = containers[containers.length - 1];
        if (element === 'poem' || element === 'stanza')
          shared = Math.min(shared, containers.length - 1);
      }
      // A title's line, or an empty line inside the title: by the hints since feature 016, else one that stands
      // between two of the title's lines (D32's library run: a body's title kept its empty line no more).
      const titleLine =
        block.part?.kind === 'title' ||
        (!block.part &&
          (segments.includes('title') ||
            (titleOpen &&
              list.slice(index + 1).find((next) => next.part)?.part?.kind === 'title')));
      if (shared < open.length || !titleLine) closeTo(shared);
      while (open.length < containers.length) {
        closeTitle();
        const name = containers[open.length];
        open.push(name);
        out += `<${name}>`;
      }
      lastVerseTop = isVerse ? (top ?? lastVerseTop) : null;
      if (titleLine) {
        if (!titleOpen) out += '<title>';
        titleOpen = true;
        out += block.part ? paragraph('p', block) : '<empty-line/>';
        return;
      }
      closeTitle();
      if (!block.part) {
        out += '<empty-line/>';
        return;
      }
      if (block.part.kind === 'figure') {
        out += imageXml(block);
        return;
      }
      if (block.part.kind === 'table') {
        out += tableXml(block);
        return;
      }
      out += paragraph(GENERIC.has(last) ? last : 'p', block);
    });
    closeTo(0);
    return out;
  };

  // The description's pages (the annotation after the title page, the history at the end) and the bodies.
  const firstBodyPage = (hints.bodies[0]?.page ?? 0) + 1;
  const annotationPage = hints.generated.annotationPage;
  const historyPage = hints.generated.historyPage;
  // The annotation's own blocks: on its pages, and marked as an annotation's by the hints.
  const annotationBlocks = annotationPage
    ? blocks.filter(
        (block) =>
          block.page >= annotationPage &&
          block.page < firstBodyPage &&
          (block.kind === 'annotation' || block.kind.startsWith('annotation/')),
      )
    : [];
  // The history's own blocks: on its pages, and an annotation's by the hints (FB2's history is one).
  const historyBlocks = historyPage
    ? blocks.filter(
        (block) =>
          block.page >= historyPage &&
          (block.kind === 'annotation' || block.kind.startsWith('annotation/')),
      )
    : [];
  const bodyBlocks = blocks.filter(
    (block) => !annotationBlocks.includes(block) && !historyBlocks.includes(block),
  );

  // Bodies: each begins at the first block on its first page; sections as the hints number them.
  let bodiesXml = '';
  let bodyIndex = -1;
  let afterNotes = '';
  let bodyList: Block[] = [];
  const sectionDepths: number[] = [];
  const flushBody = (): void => {
    if (bodyIndex < 0) return;
    let out = '';
    let chunk: Block[] = [];
    const flushChunk = (): void => {
      if (chunk.length) out += render(chunk);
      chunk = [];
    };
    for (const block of bodyList) {
      const depth = sectionAt.get(block.b);
      if (depth !== undefined) {
        flushChunk();
        while (sectionDepths.length && sectionDepths[sectionDepths.length - 1] >= depth) {
          out += '</section>';
          sectionDepths.pop();
        }
        const id = idAt.get(block.b);
        out += id ? `<section id="${attr(id)}">` : '<section>';
        counts.sections++;
        sectionDepths.push(depth);
      }
      chunk.push(block);
    }
    flushChunk();
    while (sectionDepths.length) {
      out += '</section>';
      sectionDepths.pop();
    }
    const entry = hints.bodies[bodyIndex];
    // The notes body's part printed after the text is no body of its own: its notes go to the notes (D6).
    if (entry?.notes) {
      afterNotes += out;
      return;
    }
    const name = entry?.name;
    bodiesXml += `<body${name ? ` name="${attr(name)}"` : ''}>${out}</body>`;
  };
  for (const block of bodyBlocks) {
    const next = hints.bodies[bodyIndex + 1];
    if (next && block.page >= next.page + 1 && (bodyIndex < 0 || bodyList.length > 0)) {
      flushBody();
      bodyIndex++;
      bodyList = [];
    }
    if (bodyIndex < 0) bodyIndex = 0;
    bodyList.push(block);
  }
  flushBody();

  // The notes, from the feet of the pages: in the order of their first references (D6), then the rest.
  const notes = notesBody(footnotes, bodyBlocks, link, pictureFor);
  counts.notes = notes.count;
  // The notes printed after the text, under the notes' title: their sections join the notes body, its title
  // theirs when the feet gave none (C1).
  if (afterNotes) {
    const inner = afterNotes
      .replace(/^<section>(<title>[\s\S]*?<\/title>)?/, '')
      .replace(/<\/section>$/, '');
    const heading = /^<section>(<title>[\s\S]*?<\/title>)/.exec(afterNotes)?.[1] ?? '';
    const named = hints.bodies.find((entry) => entry.notes)?.name || 'notes';
    notes.xml = notes.xml
      ? notes.xml.replace(/<\/body>$/, `${inner}</body>`)
      : `<body name="${attr(named)}">${heading}${inner}</body>`;
    counts.notes += (inner.match(/<section[ >]/g) ?? []).length;
  }

  const annotation =
    descriptionPages && annotationBlocks.length
      ? `<annotation>${render(annotationBlocks, 1)}</annotation>`
      : '';
  const history =
    descriptionPages && historyBlocks.length
      ? // The history is an annotation of its own in FB2: its blocks' paths begin with that container.
        `<history>${render(historyBlocks.map((block) => ({ ...block, kind: block.kind.replace(/^annotation(\/|$)/, '') })))}</history>`
      : '';
  const stylesheets = hints.stylesheets
    .map((sheet) => `<stylesheet type="${attr(sheet.type)}">${text(sheet.text)}</stylesheet>`)
    .join('');
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
    stylesheets +
    restoreDescription(description, annotation, history) +
    bodiesXml +
    notes.xml +
    '</FictionBook>';
  return { xml, pictures: wanted, mismatches, counts };
}

function notesBody(
  footnotes: readonly Footnote[],
  blocks: readonly Block[],
  link: (run: Run) => { href: string; note: boolean } | null,
  picture: (run: Run) => string | null,
): { xml: string; count: number } {
  const byId = new Map<string, Run[][]>();
  const labels = new Map<string, string>();
  let current: string | null = null;
  for (const footnote of footnotes) {
    if (footnote.id) {
      current = footnote.id;
      labels.set(current, footnote.label);
      byId.set(current, [...(byId.get(current) ?? []), ...footnote.paragraphs]);
    } else if (current) {
      // The rest of a note cut at the foot of the page before: its first paragraph goes on the last one.
      const list = byId.get(current)!;
      const [first, ...rest] = footnote.paragraphs;
      if (first && list.length)
        list[list.length - 1] = [
          ...list[list.length - 1],
          { ...first[0], text: ` ${first[0]?.text ?? ''}` },
          ...first.slice(1),
        ];
      else if (first) list.push(first);
      list.push(...rest);
    }
  }
  if (byId.size === 0) return { xml: '', count: 0 };
  const order: string[] = [];
  for (const block of blocks) {
    for (const run of block.part?.runs ?? []) {
      if (run.dest && byId.has(run.dest) && !order.includes(run.dest)) order.push(run.dest);
    }
  }
  for (const id of byId.keys()) if (!order.includes(id)) order.push(id);
  const sections = order.map((id) => {
    const label = labels.get(id) ?? '';
    const paragraphs = (byId.get(id) ?? [])
      .map((runs) => `<p>${inline(spaceRuns(runs), [], link, picture)}</p>`)
      .join('');
    return `<section id="${attr(id)}">${label ? `<title><p>${text(label)}</p></title>` : ''}${paragraphs}</section>`;
  });
  return { xml: `<body name="notes">${sections.join('')}</body>`, count: order.length };
}

/** The record's description with its annotation and history put back where FB2 has them (D5). */
export function restoreDescription(
  description: string,
  annotation: string,
  history: string,
): string {
  let out = description.replace(/^<\?xml[^>]*>\s*/, '');
  if (annotation) {
    const after = /<\/book-title>/.exec(out);
    if (after)
      out =
        out.slice(0, after.index + after[0].length) +
        annotation +
        out.slice(after.index + after[0].length);
  }
  if (history) {
    const docInfo = /<document-info[\s\S]*?<\/document-info>/.exec(out);
    if (docInfo) {
      const block = docInfo[0];
      const version = /<\/version>/.exec(block);
      const at = version
        ? version.index + version[0].length
        : (/<publisher/.exec(block)?.index ?? block.length - '</document-info>'.length);
      const updated = block.slice(0, at) + history + block.slice(at);
      out = out.replace(block, updated);
    }
  }
  return out;
}
