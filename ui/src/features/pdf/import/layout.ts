/**
 * Feature 016 (User Story 2 and 3; D11, D12, D17, plan DP-12): a PDF without the editor's record and without a
 * structure - made from text, or a scan with a text layer - read from its words and their places: lines,
 * columns, page furniture left out, paragraphs, headings, bold, italic, monospaced, sub- and superscripts, and
 * words broken at a line's end joined. The result has the parts' shape, so the same FB2 writer serves it.
 */

import { lineJoin } from '@/features/text/joinWords';
import type { OutlineNode, PdfPageModel, PdfWord } from './model';
import type { Part, Run, TableCell } from './parts';

export interface Line {
  page: number;
  words: PdfWord[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  base: number;
  size: number;
  text: string;
}

export interface LayoutOptions {
  /** True when the joined word is known to the spelling dictionary of the book's language (DP-13). */
  known?: (word: string) => boolean;
  outline?: readonly OutlineNode[];
}

export interface LayoutResult {
  parts: Part[];
  /** The first page's one large picture without text: the cover (D14); its reader id. */
  cover: string | null;
  /** Page pictures without text not imported (a scan's plates and blank pages, D17, D19). */
  skippedPictures: number;
  /** Pages without text whose picture comes in (the plates of a PDF made from text, D11). */
  platesImported: number;
  /** Lines of page furniture left out (running heads, page numbers). */
  furniture: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The page's words as lines, column by column (a gap running down the page's height splits columns). */
/** The words a drawing or a form's labels hold: they belong to that picture or table, not to the text (D16). */
function claimed(page: PdfPageModel, word: PdfWord): boolean {
  const x = word.box[0] + word.box[2] / 2;
  const y = word.box[1] + word.box[3] / 2;
  const inside = (box: number[]): boolean =>
    box.length === 4 && x >= box[0] && x <= box[0] + box[2] && y >= box[1] && y <= box[1] + box[3];
  return (
    (page.drawings ?? []).some((drawing) => inside(drawing.box)) ||
    (page.forms ?? []).some((form) => inside(form.labelBox))
  );
}

export function linesOf(page: PdfPageModel): Line[] {
  const words = page.words.filter((w) => w.t.trim() && !claimed(page, w));
  if (words.length === 0) return [];
  // Columns: a vertical band free of words between text, wider than a few characters.
  const sizes = median(words.map((w) => w.s)) || 10;
  const lines: Line[] = [];
  // The lines of a set of words, top to bottom.
  const build = (set: PdfWord[]): Line[] => {
    const out: Line[] = [];
    const sorted = [...set].sort((a, b) => a.base - b.base || a.box[0] - b.box[0]);
    let current: PdfWord[] = [];
    let base = Number.NaN;
    const flush = (): void => {
      if (current.length === 0) return;
      current.sort((a, b) => a.box[0] - b.box[0]);
      const left = current[0].box[0];
      const right = Math.max(...current.map((w) => w.box[0] + w.box[2]));
      const top = Math.min(...current.map((w) => w.box[1]));
      const bottom = Math.max(...current.map((w) => w.box[1] + w.box[3]));
      const size = median(current.map((w) => w.s));
      out.push({
        page: page.n,
        words: current,
        left,
        right,
        top,
        bottom,
        base: median(current.map((w) => w.base)),
        size,
        text: current.map((w) => w.t).join(' '),
      });
      current = [];
    };
    for (const word of sorted) {
      // A sub- or superscript stays on its line: its baseline moves less than half a line.
      if (!Number.isNaN(base) && Math.abs(word.base - base) > Math.max(word.s, sizes) * 0.6)
        flush();
      if (current.length === 0) base = word.base;
      current.push(word);
    }
    flush();
    return out;
  };
  const inBand = (set: PdfWord[], [from, to]: [number, number]): PdfWord[] =>
    set.filter((w) => w.box[0] + w.box[2] / 2 >= from && w.box[0] + w.box[2] / 2 < to);
  const columns = columnBands(words, page.width, sizes);
  // A line across the whole text - a heading, a sidebar's title - hides the gutter of columns beside it: the
  // gutters are looked for again among the narrow lines (D32's library run read two columns line by line, their
  // words interleaved).
  // The page's lines, cut where a gap wider than half a character runs between words (two columns' lines at one
  // height are two lines).
  const rough = build(words).flatMap((line) => {
    const pieces: PdfWord[][] = [[]];
    line.words.forEach((word, index) => {
      const before = line.words[index - 1];
      if (before && word.box[0] - (before.box[0] + before.box[2]) > sizes * 0.5) pieces.push([]);
      pieces[pieces.length - 1].push(word);
    });
    return pieces.length === 1 ? [line] : pieces.flatMap((piece) => build(piece));
  });
  const textLeft = Math.min(...words.map((w) => w.box[0]));
  const textRight = Math.max(...words.map((w) => w.box[0] + w.box[2]));
  const wide = (line: Line): boolean => line.right - line.left > (textRight - textLeft) * 0.6;
  const narrow = rough.filter((line) => !wide(line));
  const bands =
    columns.length > 1
      ? columns
      : narrow.length >= rough.length * 0.5 && narrow.length >= 10
        ? columnBands(
            narrow.flatMap((line) => line.words),
            page.width,
            sizes,
          )
        : columns;
  // Text set around pictures narrower than it - two columns either side of a column of pictures (D32's
  // library run): each stretch between the pictures' tops and bottoms has its own columns; a stretch's column
  // goes on in the one under it that it overlaps by half, and the columns so joined are read in turn.
  const flows = aroundPictures(page, words, sizes, textRight - textLeft);
  if (flows) {
    for (const set of flows) lines.push(...build(set));
  } else if (bands.length > 1) {
    // The lines across a gutter cut the page into stretches, and so does a blank band across the page (above
    // and below an epigraph, a picture): each stretch is read column by column.
    const gutters = bands.slice(1).map(([from]) => from);
    const across = (line: Line): boolean =>
      gutters.some((x) => line.left < x - 2 && line.right > x + 2);
    const cuts = rough.filter(across).sort((a, b) => a.top - b.top);
    const inColumns = rough.filter((line) => !across(line));
    const stretches: { from: number; to: number; cut: Line | null }[] = [];
    let from = Number.NEGATIVE_INFINITY;
    for (const cut of [...cuts, null]) {
      // By the cut line's baseline: the columns' lines beside it, at its height, stay in a stretch.
      const to = cut ? cut.base : Number.POSITIVE_INFINITY;
      // Blank bands across the page within the stretch.
      const spans = inColumns
        .filter((line) => line.base > from && line.base <= to)
        .map((line) => [line.top, line.bottom] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      let start = from;
      let reach = Number.NEGATIVE_INFINITY;
      for (const [top, bottom] of spans) {
        if (reach > Number.NEGATIVE_INFINITY && top - reach > sizes * 2.5) {
          stretches.push({ from: start, to: (reach + top) / 2, cut: null });
          start = (reach + top) / 2;
        }
        reach = Math.max(reach, bottom);
      }
      stretches.push({ from: start, to, cut });
      if (cut) from = cut.base;
    }
    const columnWords = inColumns.flatMap((line) => line.words);
    for (const stretch of stretches) {
      const here = columnWords.filter((w) => w.base > stretch.from && w.base <= stretch.to);
      for (const band of bands) lines.push(...build(inBand(here, band)));
      if (stretch.cut) lines.push(stretch.cut);
    }
  } else for (const band of columns) lines.push(...build(inBand(words, band)));
  // A drop cap (D11): one letter set far larger than the page's text at a paragraph's start, beside its first
  // lines. Its baseline falls on a later line, so it begins the first word of the first line beside its top
  // (D32's library run found "алеко-далеко ... простран- Д ство").
  const fit = (line: Line): void => {
    line.words.sort((a, b) => a.box[0] - b.box[0]);
    line.left = line.words[0].box[0];
    line.right = Math.max(...line.words.map((w) => w.box[0] + w.box[2]));
    line.top = Math.min(...line.words.map((w) => w.box[1]));
    line.bottom = Math.max(...line.words.map((w) => w.box[1] + w.box[3]));
    line.size = median(line.words.map((w) => w.s));
    line.text = line.words.map((w) => w.t).join(' ');
  };
  for (const cap of words.filter((w) => /^\p{L}$/u.test(w.t.trim()) && w.s >= sizes * 1.8)) {
    const own = lines.find((line) => line.words.includes(cap));
    const capRight = cap.box[0] + cap.box[2];
    const beside = lines
      .filter((line) => line.words.some((w) => w !== cap && w.box[0] >= capRight - sizes * 0.5))
      .filter((line) => {
        const first = line.words.find((w) => w !== cap)!;
        return first.box[1] + first.box[3] > cap.box[1] && first.box[1] < cap.box[1] + cap.box[3];
      })
      // By the tops of their own words: the letter's box would lift the top of the line it was put in.
      .map((line) => ({
        line,
        top: Math.min(...line.words.filter((w) => w !== cap).map((w) => w.box[1])),
      }))
      .sort((a, b) => a.top - b.top)[0]?.line;
    if (!own || !beside) continue;
    own.words = own.words.filter((w) => w !== cap);
    const index = beside.words.findIndex((w) => w.box[0] >= capRight - sizes * 0.5);
    const first = beside.words[index];
    beside.words[index] = {
      ...first,
      t: `${cap.t.trim()}${first.t}`,
      box: [cap.box[0], first.box[1], first.box[0] + first.box[2] - cap.box[0], first.box[3]],
    };
    if (own.words.length === 0) lines.splice(lines.indexOf(own), 1);
    else fit(own);
    fit(beside);
  }
  return lines;
}

function columnBands(
  words: PdfWord[],
  width: number,
  size: number,
  /** The words a column left of a gutter holds at least: 20 on a page, fewer in a stretch between pictures. */
  minimum = 20,
): [number, number][] {
  const step = 2;
  const cells = Math.max(1, Math.ceil(width / step));
  const used = new Array<number>(cells).fill(0);
  for (const w of words) {
    for (
      let x = Math.max(0, Math.floor(w.box[0] / step));
      x < Math.min(cells, Math.ceil((w.box[0] + w.box[2]) / step));
      x++
    )
      used[x]++;
  }
  const first = used.findIndex((n) => n > 0);
  const last = cells - 1 - [...used].reverse().findIndex((n) => n > 0);
  const bands: [number, number][] = [];
  let start = first * step;
  let gap = 0;
  // A band that a word or two cross is still free: a stray word, a heading across both columns (D32's library
  // run) - at most a twentieth of the busiest place's words.
  const crossing = Math.floor(Math.max(...used) * 0.05);
  for (let x = first; x <= last; x++) {
    if (used[x] <= crossing) gap++;
    else {
      // A gutter: a free band wider than half a character with text on both sides, holding at least 20 lines,
      // each side a fifth of the text's width at least - a list's numbers are no column (D32's library run:
      // gutters of 6 points).
      const textWidth = (last - first) * step;
      if (
        gap * step > size * 0.5 &&
        (x - gap) * step - start >= textWidth * 0.2 &&
        last * step - x * step >= textWidth * 0.2 &&
        words.filter((w) => w.box[0] < x * step && w.box[0] + w.box[2] < x * step).length > minimum
      ) {
        bands.push([start, (x - gap) * step + (gap * step) / 2]);
        start = (x - gap) * step + (gap * step) / 2;
      }
      gap = 0;
    }
  }
  bands.push([start, Number.POSITIVE_INFINITY]);
  bands[0][0] = Number.NEGATIVE_INFINITY;
  return bands;
}

/**
 * The words of a page set around pictures, in reading order as sets of a column each, or null when the
 * pictures make no columns of the text.
 */
function aroundPictures(
  page: PdfPageModel,
  words: PdfWord[],
  size: number,
  textWidth: number,
): PdfWord[][] | null {
  const boxes = (page.pictures ?? [])
    .map((picture) => picture.box)
    .filter((box) => box[2] < textWidth * 0.8);
  if (boxes.length === 0) return null;
  const edges = [
    Number.NEGATIVE_INFINITY,
    ...[...new Set(boxes.flatMap((box) => [box[1], box[1] + box[3]]))].sort((a, b) => a - b),
    Number.POSITIVE_INFINITY,
  ];
  interface Flow {
    sets: PdfWord[][];
    left: number;
    right: number;
    start: number;
    used: number;
    spanning: boolean;
  }
  const flows: Flow[] = [];
  let columns = false;
  for (let i = 0; i + 1 < edges.length; i++) {
    const here = words.filter((w) => w.base > edges[i] && w.base <= edges[i + 1]);
    if (here.length === 0) continue;
    const bands = columnBands(here, page.width, size, 2);
    if (bands.length > 1) columns = true;
    for (const [from, to] of bands) {
      const set = here.filter(
        (w) => w.box[0] + w.box[2] / 2 >= from && w.box[0] + w.box[2] / 2 < to,
      );
      if (set.length === 0) continue;
      const left = Math.min(...set.map((w) => w.box[0]));
      const right = Math.max(...set.map((w) => w.box[0] + w.box[2]));
      const overlap = (flow: Flow): number =>
        Math.min(flow.right, right) - Math.max(flow.left, left);
      const flow = flows
        .filter(
          (f) =>
            !f.spanning &&
            f.used < i &&
            overlap(f) >= Math.min(f.right - f.left, right - left) * 0.5,
        )
        .sort((a, b) => overlap(b) - overlap(a))[0];
      if (flow) {
        flow.sets.push(set);
        flow.left = left;
        flow.right = right;
        flow.used = i;
      } else
        flows.push({
          sets: [set],
          left,
          right,
          start: i,
          used: i,
          spanning: right - left > textWidth * 0.8,
        });
    }
  }
  if (!columns) return null;
  return flows
    .sort((a, b) => a.start - b.start || a.sets[0][0].box[0] - b.sets[0][0].box[0])
    .flatMap((flow) => flow.sets);
}

/** Running heads and page numbers: the first and last lines that repeat on most pages, numbers masked. */
/** The letters of a line, for comparing running heads (the page number and marks left out). */
const letters = (text: string): string => text.toLowerCase().replace(/[^\p{L}]/gu, '');

/** How alike two strings are: the share of their letter pairs in common (Dice). */
function alike(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i + 1 < a.length; i++)
    pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) ?? 0) + 1);
  let common = 0;
  for (let i = 0; i + 1 < b.length; i++) {
    const pair = b.slice(i, i + 2);
    const left = pairs.get(pair) ?? 0;
    if (left > 0) {
      common++;
      pairs.set(pair, left - 1);
    }
  }
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/**
 * Running heads and page numbers (D12): the first and the last line of a page when it is a lone number, or
 * when the page two before or after, or the next or the one before, has a line much like it at that edge -
 * running heads alternate between left and right pages and change with the chapter or the story, and a
 * scan's layer spells them a little differently on each page (the calibration of SC-007 found).
 */
/** Whether a page's edge line is set close to the lines beside it, at their size: one of their block. */
function inBlock(lines: Line[], line: Line, edge: 'head' | 'foot'): boolean {
  const beside = lines.filter(
    (other) =>
      other !== line &&
      other.right > line.left &&
      other.left < line.right &&
      (edge === 'foot' ? other.bottom <= line.top + 1 : other.top >= line.bottom - 1),
  );
  const next =
    edge === 'foot'
      ? beside.sort((a, b) => b.bottom - a.bottom)[0]
      : beside.sort((a, b) => a.top - b.top)[0];
  if (!next) return false;
  const gap = edge === 'foot' ? line.top - next.bottom : next.top - line.bottom;
  return gap < line.size * 0.6 && Math.abs(next.size - line.size) <= line.size * 0.1;
}

export function furnitureOf(pages: Line[][]): Set<Line> {
  const out = new Set<Line>();
  const lone = (line: Line): boolean =>
    /^[\divxlc\-–—.\s]+$/i.test(line.text.trim()) && line.text.trim().length <= 8;
  const sizes = pages.flat().flatMap((line) => line.words.map((w) => w.s));
  const body = median(sizes) || 10;
  for (const edge of ['head', 'foot'] as const) {
    // The edge's line, and the one after it when it is a lone number (a number above or below the head).
    const candidates = pages.map((lines) => {
      const ordered = edge === 'head' ? lines : [...lines].reverse();
      const picked: Line[] = [];
      for (const line of ordered.slice(0, 2)) {
        picked.push(line);
        if (!lone(line)) break;
      }
      return picked;
    });
    candidates.forEach((picked, index) => {
      for (const line of picked) {
        if (lone(line)) {
          out.add(line);
          continue;
        }
        const key = letters(line.text);
        // A running head is short, and not set larger than the text (a chapter's title is).
        if (key.length < 4 || line.text.trim().length > 60 || line.size > body * 1.15) continue;
        const near = [index - 2, index - 1, index + 1, index + 2].filter(
          (i) => i >= 0 && i < pages.length,
        );
        // ... and stands apart from the text: a line set close under (or over) lines of its own size belongs to
        // them - a note's last line citing one book again and again (D32's library run lost such lines as a
        // running foot).
        if (inBlock(pages[index], line, edge)) continue;
        if (
          near.some((i) =>
            candidates[i].some((other) => !lone(other) && alike(key, letters(other.text)) >= 0.7),
          )
        )
          out.add(line);
      }
    });
  }
  return out;
}

function runsOfLine(
  line: Line,
  bodySize: number,
  fonts: Map<string, { bold: boolean; italic: boolean; mono: boolean }>,
): Run[] {
  const runs: Run[] = [];
  line.words.forEach((word, index) => {
    const font = fonts.get(`${line.page}:${word.f}`);
    const small = word.s < line.size * 0.85;
    const shift = line.base - word.base;
    const run: Run = {
      text: (index > 0 ? ' ' : '') + word.t,
      page: line.page,
      size: word.s,
      top: word.box[1],
      left: word.box[0],
      right: word.box[0] + word.box[2],
      ...(font?.bold ? { bold: true } : {}),
      ...(font?.italic ? { italic: true } : {}),
      ...(font?.mono ? { mono: true } : {}),
    };
    // A smaller word raised or lowered against the line's baseline: a superscript or a subscript (D11).
    if (small && shift > word.s * 0.25) run.sup = true;
    if (small && shift < -word.s * 0.15) run.sub = true;
    runs.push(run);
    void bodySize;
  });
  return runs;
}

export function layoutParts(
  pages: readonly PdfPageModel[],
  options: LayoutOptions = {},
): LayoutResult {
  const fonts = new Map<string, { bold: boolean; italic: boolean; mono: boolean }>();
  for (const page of pages) {
    for (const font of page.fonts) {
      const name = font.name;
      fonts.set(`${page.n}:${font.id}`, {
        bold: font.bold || /Bold|Black|Heavy|Semibold/i.test(name),
        italic: font.italic || /Italic|Oblique/i.test(name),
        mono: font.mono || /Mono|Courier/i.test(name),
      });
    }
  }
  const perPage = pages.map(linesOf);
  const furniture = furnitureOf(perPage);
  const lines = perPage.flat().filter((line) => !furniture.has(line));
  const bodySize = median(lines.flatMap((line) => line.words.map((w) => w.s))) || 10;
  // Headings by size only where sizes hold: a scan's layer gives its words sizes that wander (the
  // calibration of SC-007 found 5 to 10 points on one page of 7-point text), a PDF made from text does not.
  const offSize = lines.filter((line) => Math.abs(line.size / bodySize - 1) > 0.15).length;
  const sizesHold = offSize < lines.length * 0.1;
  // Each page's own edges: a scan's pages lie a little apart, odd ones and even ones to either side. The
  // left edge is where most lines begin, the right where most end.
  const edges = new Map<number, { left: number; right: number }>();
  perPage.forEach((pageLines, index) => {
    const kept = pageLines.filter((line) => !furniture.has(line));
    if (kept.length === 0) return;
    const lefts = kept.map((line) => line.left).sort((a, b) => a - b);
    const rights = kept.map((line) => line.right).sort((a, b) => a - b);
    edges.set(pages[index].n, {
      left: lefts[Math.floor(lefts.length * 0.25)],
      right: rights[Math.floor(rights.length * 0.75)],
    });
  });
  // Each page's line pitch: the usual step from one line's top to the next one's.
  const pitches = new Map<number, number>();
  perPage.forEach((pageLines, index) => {
    const steps: number[] = [];
    for (let i = 1; i < pageLines.length; i++) {
      const step = pageLines[i].top - pageLines[i - 1].top;
      if (step > 0) steps.push(step);
    }
    if (steps.length) pitches.set(pages[index].n, median(steps));
  });
  const indentOf = (line: Line): number => line.left - (edges.get(line.page)?.left ?? line.left);
  const shortOf = (line: Line): number => (edges.get(line.page)?.right ?? line.right) - line.right;
  // A book that marks its paragraphs by indenting their first lines: there a line ending short is no
  // paragraph's end (a scan's layer ends its lines short of the margin, the calibration of SC-007 found);
  // in a book of block paragraphs it is.
  const indented = lines.filter((line) => {
    const by = indentOf(line);
    return by > bodySize * 0.8 && by < bodySize * 8;
  }).length;
  const indentMode = lines.length >= 20 && indented >= lines.length * 0.04;
  const titles = new Set<string>();
  const walk = (nodes: readonly OutlineNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      titles.add(node.title.replace(/\s+/g, ' ').trim().toLowerCase());
      walk(node.kids);
    }
  };
  walk(options.outline);

  const parts: Part[] = [];
  let paragraph: Run[] = [];
  let paragraphPage = 0;
  let previous: Line | null = null;
  const flush = (): void => {
    if (paragraph.length) parts.push({ kind: 'p', page: paragraphPage, runs: paragraph });
    paragraph = [];
  };
  const level = (line: Line): number => {
    const ratio = line.size / bodySize;
    return ratio >= 1.8 ? 1 : ratio >= 1.45 ? 2 : 3;
  };
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    const heading =
      titles.has(text.toLowerCase()) ||
      (sizesHold && line.size >= bodySize * 1.2 && text.length < 120 && !/[.,;:]$/.test(text));
    if (heading) {
      flush();
      parts.push({
        kind: 'title',
        page: line.page,
        runs: runsOfLine(line, bodySize, fonts),
        level: level(line),
      });
      previous = null;
      continue;
    }
    const runs = runsOfLine(line, bodySize, fonts);
    let starts = previous === null || previous.page !== line.page;
    if (previous && previous.page === line.page) {
      // A space between paragraphs: a gap, and a step clearly wider than the page's pitch (a scan's layer
      // draws its line boxes unevenly, the calibration of SC-007 found).
      const gap = line.top - previous.bottom;
      const step = line.top - previous.top;
      const spaced = gap > line.size * 0.8 && step > (pitches.get(line.page) ?? step) * 1.35;
      const indent = indentOf(line) > bodySize * 0.8;
      const shortBefore = !indentMode && shortOf(previous) > bodySize * 3;
      // A line ending with a hyphen never ends a paragraph: its word goes on (D12).
      const broken = /[\u00ad-]$/.test(previous.text);
      starts = !broken && (spaced || indent || shortBefore);
    } else if (previous && previous.page !== line.page) {
      // A new page: the paragraph goes on unless this line is indented or the last one ended short.
      const indent = indentOf(line) > bodySize * 0.8;
      const shortBefore = !indentMode && shortOf(previous) > bodySize * 3;
      starts = !/[\u00ad-]$/.test(previous.text) && (indent || shortBefore);
    }
    if (starts) {
      flush();
      paragraphPage = line.page;
      paragraph = runs;
    } else {
      // A word broken at the line's end: a soft hyphen always, a plain hyphen when the word is known (D12).
      const last = paragraph[paragraph.length - 1];
      const head = runs[0];
      if (last && head) {
        // The line's last run may end with the space the reader set after it (D32's library run: no word
        // broken there was joined): it is judged without it.
        const end = last.text.replace(/\s+$/, '');
        // Feature 017 (DP-13): the rule both imports share; an unknown word keeps its hyphen and joins
        // without a space ("north-east"), as the tags' text always did.
        const join = lineJoin(end, head.text, options.known);
        if (join === 'drop-hyphen') {
          last.text = end.replace(/[\u00ad-]$/, '');
          head.text = head.text.replace(/^\s+/, '');
        } else if (join === 'keep-hyphen') {
          last.text = end;
          head.text = head.text.replace(/^\s+/, '');
        } else head.text = head.text.startsWith(' ') ? head.text : ` ${head.text}`;
      }
      paragraph.push(...runs);
    }
    previous = line;
  }
  flush();
  // Pictures (D11, D14, D17): ornaments and pictures behind text are left out; a page that is only one large
  // picture is the cover on the first page, and a plate elsewhere - imported in a PDF made from text, not in a
  // scan, whose page pictures are the pages themselves.
  let cover: string | null = null;
  let skippedPictures = 0;
  let platesImported = 0;
  const scanned =
    pages.filter((p) => p.pictures.some((pic) => covers(pic.box, p))).length > pages.length / 2;
  const figures: Part[] = [];
  for (const page of pages) {
    // A blank page's picture is no plate (the reader called the page blank; the summary counts it).
    if (page.kind === 'blank') continue;
    const hasText = page.words.some((w) => w.t.trim());
    for (const picture of page.pictures) {
      const [, , w, h] = picture.box;
      if (w < 6 || h < 6) continue;
      const large = covers(picture.box, page);
      if (large && hasText) continue;
      if (large && !hasText) {
        if (page.n === 1 && !cover) {
          cover = picture.id;
          continue;
        }
        if (scanned) {
          skippedPictures++;
          continue;
        }
        platesImported++;
      }
      figures.push({
        kind: 'figure',
        page: page.n,
        runs: [],
        alt: '',
        readerId: picture.id,
        top: picture.box[1],
      } as Part & { top: number });
    }
  }
  // Drawings (D16): a picture each, where it stands; a form in labelled rows: a table of labels and values.
  for (const page of pages) {
    for (const drawing of page.drawings ?? []) {
      figures.push({
        kind: 'figure',
        page: page.n,
        runs: [],
        alt: '',
        readerId: drawing.id,
        top: drawing.box[1],
      } as Part & { top: number });
    }
    const forms = page.forms ?? [];
    if (forms.length > 0) {
      const cell = (text: string): TableCell => ({
        runs: [{ text, page: page.n }],
        header: false,
      });
      figures.push({
        kind: 'table',
        page: page.n,
        runs: [],
        rows: forms.map((form) => [cell(form.label), cell(form.value)]),
        top: Math.min(...forms.map((form) => form.box[1])),
      } as Part & { top: number });
    }
  }
  // Each figure goes before the first part of its page that starts below it.
  for (const figure of figures) {
    const top = (figure as Part & { top?: number }).top ?? 0;
    const at = parts.findIndex(
      (part) =>
        part.page > figure.page || (part.page === figure.page && (part.runs[0]?.top ?? 0) > top),
    );
    if (at < 0) parts.push(figure);
    else parts.splice(at, 0, figure);
  }
  return { parts, furniture: furniture.size, cover, skippedPictures, platesImported };
}

/** A picture covering most of its page. */
function covers(box: [number, number, number, number], page: PdfPageModel): boolean {
  return box[2] * box[3] > page.width * page.height * 0.6;
}
