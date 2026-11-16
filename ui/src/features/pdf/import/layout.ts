/**
 * Feature 016 (User Story 2 and 3; D11, D12, D17, plan DP-12): a PDF without the editor's record and without a
 * structure - made from text, or a scan with a text layer - read from its words and their places: lines,
 * columns, page furniture left out, paragraphs, headings, bold, italic, monospaced, sub- and superscripts, and
 * words broken at a line's end joined. The result has the parts' shape, so the same FB2 writer serves it.
 */

import type { OutlineNode, PdfPageModel, PdfWord } from './model';
import type { Part, Run } from './parts';

interface Line {
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
  /** Lines of page furniture left out (running heads, page numbers). */
  furniture: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The page's words as lines, column by column (a gap running down the page's height splits columns). */
function linesOf(page: PdfPageModel): Line[] {
  const words = page.words.filter((w) => w.t.trim());
  if (words.length === 0) return [];
  // Columns: a vertical band free of words between text, wider than a few characters.
  const sizes = median(words.map((w) => w.s)) || 10;
  const columns = columnBands(words, page.width, sizes);
  const lines: Line[] = [];
  for (const [from, to] of columns) {
    const inColumn = words
      .filter((w) => w.box[0] + w.box[2] / 2 >= from && w.box[0] + w.box[2] / 2 < to)
      .sort((a, b) => a.base - b.base || a.box[0] - b.box[0]);
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
      lines.push({
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
    for (const word of inColumn) {
      // A sub- or superscript stays on its line: its baseline moves less than half a line.
      if (!Number.isNaN(base) && Math.abs(word.base - base) > Math.max(word.s, sizes) * 0.6)
        flush();
      if (current.length === 0) base = word.base;
      current.push(word);
    }
    flush();
  }
  return lines;
}

function columnBands(words: PdfWord[], width: number, size: number): [number, number][] {
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
  for (let x = first; x <= last; x++) {
    if (used[x] === 0) gap++;
    else {
      // A gutter: a free band wider than two characters with text on both sides, holding at least 20 lines.
      if (
        gap * step > size * 2 &&
        words.filter((w) => w.box[0] < x * step && w.box[0] + w.box[2] < x * step).length > 20
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

/** Running heads and page numbers: the first and last lines that repeat on most pages, numbers masked. */
function furnitureOf(pages: Line[][]): Set<Line> {
  const out = new Set<Line>();
  const mask = (text: string): string =>
    text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const edge of ['head', 'foot'] as const) {
    const counts = new Map<string, number>();
    const pick = (lines: Line[]): Line[] => (edge === 'head' ? lines.slice(0, 2) : lines.slice(-2));
    for (const lines of pages)
      for (const line of pick(lines))
        counts.set(mask(line.text), (counts.get(mask(line.text)) ?? 0) + 1);
    const enough = Math.max(3, Math.floor(pages.length * 0.4));
    for (const lines of pages) {
      for (const line of pick(lines)) {
        const key = mask(line.text);
        const lone = /^[\divxlc\-–—.\s]+$/i.test(line.text.trim()) && line.text.trim().length <= 8;
        if (lone || (pages.length >= 3 && (counts.get(key) ?? 0) >= enough)) out.add(line);
      }
    }
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
    if (small && shift > word.s * 0.25) (run as Run & { sup?: boolean }).sup = true;
    if (small && shift < -word.s * 0.15) (run as Run & { sub?: boolean }).sub = true;
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
  const leftEdge = median(lines.map((line) => line.left));
  const rightEdge = median(lines.map((line) => line.right));
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
      (line.size >= bodySize * 1.2 && text.length < 120 && !/[.,;:]$/.test(text));
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
      const gap = line.top - previous.bottom;
      const indent = line.left - leftEdge > bodySize * 0.8;
      const shortBefore = rightEdge - previous.right > bodySize * 3;
      starts = gap > line.size * 0.8 || indent || shortBefore;
    } else if (previous && previous.page !== line.page) {
      // A new page: the paragraph goes on unless this line is indented or the last one ended short.
      const indent = line.left - leftEdge > bodySize * 0.8;
      const shortBefore = rightEdge - previous.right > bodySize * 3;
      starts = indent || shortBefore;
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
        const soft = last.text.endsWith('\u00ad');
        const hard = /\p{L}-$/u.test(last.text);
        const tail = last.text.trim().split(/\s+/).pop() ?? '';
        const joined =
          `${tail.replace(/[\u00ad-]$/, '')}${head.text.trim().split(/\s+/)[0] ?? ''}`.replace(
            /[^\p{L}]/gu,
            '',
          );
        if (soft || (hard && options.known?.(joined))) {
          last.text = last.text.replace(/[\u00ad-]$/, '');
          head.text = head.text.replace(/^\s+/, '');
        } else head.text = head.text.startsWith(' ') ? head.text : ` ${head.text}`;
      }
      paragraph.push(...runs);
    }
    previous = line;
  }
  flush();
  return { parts, furniture: furniture.size };
}
