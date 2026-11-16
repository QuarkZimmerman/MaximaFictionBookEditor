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
export function spaceRuns(runs: readonly Run[]): Run[] {
  const out = runs.map((run) => ({ ...run }));
  let previous: Run | null = null;
  for (const run of out) {
    if (!run.text && !run.picture) continue;
    if (previous) {
      const size = Math.max(run.size ?? 0, previous.size ?? 0) || 10;
      const known = run.left !== undefined && previous.right !== undefined;
      const newLine =
        run.page !== previous.page ||
        (!run.picture &&
          !previous.picture &&
          run.top !== undefined &&
          previous.top !== undefined &&
          run.top - previous.top > 0.8 * size) ||
        (known && run.left! < previous.right! - 2 * size);
      const apart = known && run.left! - previous.right! > 0.15 * size;
      const before = !previous.picture && /\s$/.test(previous.text);
      const after = !run.picture && /^\s/.test(run.text);
      const closing = !run.picture && /^[.,;:!?)\]}»”’…%]/u.test(run.text);
      if ((newLine || apart) && !before && !after && !closing) {
        if (!previous.picture) {
          if (previous.text.endsWith('\u00ad')) previous.text = previous.text.slice(0, -1);
          else previous.text += ' ';
        } else if (!run.picture) run.text = ` ${run.text}`;
      }
    }
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

/** The parts a page break split, joined: as many as the hints' count of blocks needs (R4). */
function joinSplit(parts: Part[], needed: number): Part[] {
  const extra = parts.length - needed;
  if (extra <= 0) return parts;
  const scored: { i: number; score: number }[] = [];
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const part = parts[i];
    if (part.page <= before.page || before.kind !== part.kind) continue;
    if (part.kind !== 'p' && part.kind !== 'table') continue;
    let score = part.kind === 'table' ? 3 : 0;
    const start = partText(part.runs).trimStart();
    const end = partText(before.runs).trimEnd();
    if (/^\p{Ll}/u.test(start)) score += 2;
    if (!/[.!?…:;»"”)\]]$/u.test(end)) score += 2;
    scored.push({ i, score });
  }
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  const join = new Set(scored.slice(0, extra).map((entry) => entry.i));
  const out: Part[] = [];
  parts.forEach((part, i) => {
    const last = out[out.length - 1];
    if (!join.has(i) || !last) {
      out.push({ ...part, runs: [...part.runs], ...(part.rows ? { rows: [...part.rows] } : {}) });
      return;
    }
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
    } else {
      const tail = last.runs[last.runs.length - 1];
      const head = part.runs[0];
      if (tail && head && !/\s$/.test(tail.text) && !/^\s/.test(head.text)) {
        if (tail.text.endsWith('\u00ad')) tail.text = tail.text.slice(0, -1);
        else last.runs[last.runs.length - 1] = { ...tail, text: `${tail.text} ` };
      }
      last.runs.push(...part.runs);
    }
  });
  return out;
}

export function convertOurs(
  hints: HintsV1,
  flat: Flattened,
  pages: readonly PdfPageModel[],
  description: string,
): OursResult {
  const kinds = kindsOf(hints);
  const generated = new Set(
    [hints.generated.cover, hints.generated.titlePage].filter((n): n is number => !!n),
  );
  const spaced = flat.parts
    .filter((part) => !generated.has(part.page))
    .map((part) => ({
      ...part,
      runs: spaceRuns(part.runs),
      ...(part.rows
        ? {
            rows: part.rows.map((row) =>
              row.map((cell) => ({ ...cell, runs: spaceRuns(cell.runs) })),
            ),
          }
        : {}),
    }));
  let needed = 0;
  for (const kind of kinds) needed += kind.endsWith('empty-line') ? 0 : 1;
  const parts = joinSplit(spaced, needed);

  // The blocks, numbered as the paginator numbered them.
  const blocks: Block[] = [];
  let cursor = 0;
  let lastPage = parts[0]?.page ?? 1;
  for (let b = 0; b < hints.blocks; b++) {
    const kind = kinds[b];
    if (kind.endsWith('empty-line')) {
      blocks.push({ b, kind, part: null, page: lastPage });
      continue;
    }
    const part = parts[cursor++] ?? null;
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

  const noteIds = new Set(flat.footnotes.filter((f) => f.id).map((f) => f.id!));
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
    }
    return spans;
  };
  const blockStyle = new Map<number, string>();
  for (const entry of hints.styles)
    if (entry.length === 2) blockStyle.set(entry[0] as number, String(entry[1]));
  const blockLang = new Map<number, string>();
  for (const [b, from, to, lang] of hints.langs) {
    const block = blocks[b];
    const length = block?.part ? partText(block.part.runs).length : 0;
    if (from === 0 && to >= length) blockLang.set(b, lang);
  }
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
      ? { ...block.part!, runs: stripWhole(block.part!.runs) }
      : block.part!;
    const attrs: string[] = [];
    const id = idAt.get(block.b);
    if (id && !sectionAt.has(block.b)) attrs.push(`id="${attr(id)}"`);
    const style = blockStyle.get(block.b);
    if (style) attrs.push(`style="${attr(style)}"`);
    const lang = blockLang.get(block.b);
    if (lang) attrs.push(`xml:lang="${attr(lang)}"`);
    const open = attrs.length ? `<${name} ${attrs.join(' ')}>` : `<${name}>`;
    return `${open}${inline(part.runs, spansOf(block.b), link, pictureFor)}</${name}>`;
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
    const alt = block.part?.alt ? ` alt="${attr(block.part.alt)}"` : '';
    const caption = block.part?.caption ? squeeze(partText(block.part.caption)) : '';
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
    list.forEach((block) => {
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
      if (shared < open.length || block.part?.kind !== 'title') closeTo(shared);
      while (open.length < containers.length) {
        closeTitle();
        const name = containers[open.length];
        open.push(name);
        out += `<${name}>`;
      }
      lastVerseTop = isVerse ? (top ?? lastVerseTop) : null;
      if (block.part?.kind === 'title') {
        if (!titleOpen) out += '<title>';
        titleOpen = true;
        out += paragraph('p', block);
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
  const annotationBlocks = annotationPage
    ? blocks.filter((block) => block.page >= annotationPage && block.page < firstBodyPage)
    : [];
  const historyBlocks = historyPage ? blocks.filter((block) => block.page >= historyPage) : [];
  const bodyBlocks = blocks.filter(
    (block) => !annotationBlocks.includes(block) && !historyBlocks.includes(block),
  );

  // Bodies: each begins at the first block on its first page; sections as the hints number them.
  let bodiesXml = '';
  let bodyIndex = -1;
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
    const name = hints.bodies[bodyIndex]?.name;
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
  const notes = notesBody(flat.footnotes, bodyBlocks, link, pictureFor);
  counts.notes = notes.count;

  const annotation = annotationBlocks.length
    ? `<annotation>${render(annotationBlocks, 1)}</annotation>`
    : '';
  const history = historyBlocks.length ? `<history>${render(historyBlocks)}</history>` : '';
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
