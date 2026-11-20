/**
 * Feature 017 (D27, DP-12; clarify): the paragraphs of a text file the editor did not make, told by
 * its layout read over the whole file - blank lines between wrapped paragraphs, an indent at each
 * paragraph's start, or one paragraph per line. Blank lines beyond the layout's own give one empty
 * line; control characters are left out and counted; words broken at a line's end are joined as the
 * PDF import joins them (features/text/joinWords.ts).
 */
import { brokenWordCandidate, joinLines } from '@/features/text/joinWords';

export type ForeignLayout = 'blank-separated' | 'indented' | 'per-line';

export interface ForeignParagraphs {
  layout: ForeignLayout;
  /** The paragraphs in order; `null` is an empty line. */
  items: (string | null)[];
  /** Control characters left out. */
  controlsLeftOut: number;
}

// C0 controls but tab, line feed, carriage return and form feed; DEL; the C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F]/g;
const INDENT = /^(?: {2,}|\t|\u3000)/;

/** The file's lines, control characters left out, form feeds as line ends, ends trimmed. */
export function linesOf(text: string): { lines: string[]; controlsLeftOut: number } {
  let controlsLeftOut = 0;
  const clean = text.replace(/^\uFEFF/, '').replace(CONTROLS, () => {
    controlsLeftOut++;
    return '';
  });
  const lines = clean.split(/\r\n|\n|\r|\f/).map((line) => line.replace(/\s+$/, ''));
  return { lines, controlsLeftOut };
}

/** The words a plain hyphen breaks at a line's end, for the dictionaries (DP-13). */
export function brokenCandidates(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < lines.length; i++) {
    const candidate =
      lines[i] && lines[i + 1] ? brokenWordCandidate(lines[i]!, lines[i + 1]!) : null;
    if (candidate) out.add(candidate);
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** The layout of the file, read over all its lines (DP-12). */
export function detectLayout(lines: readonly string[]): {
  layout: ForeignLayout;
  ownBlank: number;
} {
  // The blocks of consecutive filled lines, and the blank lines between them.
  const blocks: string[][] = [];
  const gaps: number[] = [];
  let blank = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blank++;
      continue;
    }
    if (blocks.length === 0 || blank > 0) {
      if (blocks.length > 0) gaps.push(blank);
      blocks.push([]);
    }
    blocks[blocks.length - 1]!.push(line);
    blank = 0;
  }
  const filled = blocks.flat();
  if (filled.length === 0) return { layout: 'per-line', ownBlank: 0 };
  const width = percentile(
    filled.map((line) => line.trim().length),
    0.9,
  );
  const ownBlank =
    gaps.length > 0 && gaps.filter((g) => g === 1).length / gaps.length >= 0.5 ? 1 : 0;
  // Wrapped text: within a block, every line but the last reaches near the width a person wraps at;
  // lines of a book written one paragraph per line run far longer (DP-12).
  const nearWidth = (line: string): boolean => line.trim().length >= width * 0.6;
  const heads = blocks.filter((b) => b.length >= 2).flatMap((b) => b.slice(0, -1));
  const wrapped =
    width <= 100 && heads.length > 0 && heads.filter(nearWidth).length / heads.length >= 0.8;
  if (ownBlank === 1 && wrapped) return { layout: 'blank-separated', ownBlank: 1 };
  // An indent at each paragraph's start: the lines without one go on a line that reached the width.
  const indented = filled.filter((line) => INDENT.test(line));
  const continued: boolean[] = [];
  for (const block of blocks)
    block.forEach((line, i) => {
      if (!INDENT.test(line)) continued.push(i > 0 && nearWidth(block[i - 1]!));
    });
  if (
    width <= 100 &&
    indented.length / filled.length >= 0.05 &&
    continued.length > 0 &&
    continued.filter(Boolean).length / continued.length >= 0.9
  )
    return { layout: 'indented', ownBlank: 0 };
  return { layout: 'per-line', ownBlank };
}

/** The paragraphs of a foreign text file (D27). `known` tells the words the dictionaries know. */
export function foreignParagraphs(
  text: string,
  known?: (word: string) => boolean,
): ForeignParagraphs {
  const { lines, controlsLeftOut } = linesOf(text);
  const { layout, ownBlank } = detectLayout(lines);
  const items: (string | null)[] = [];
  let paragraph: string | null = null;
  let blanks = 0;
  const flush = (): void => {
    if (paragraph !== null) {
      const tidy = paragraph.replace(/[\t ]+/g, ' ').trim();
      if (tidy) items.push(tidy);
    }
    paragraph = null;
  };
  const emptyLine = (): void => {
    if (items.length > 0 && items[items.length - 1] !== null) items.push(null);
  };
  for (const line of lines) {
    if (line.trim() === '') {
      blanks++;
      continue;
    }
    if (blanks > 0) {
      flush();
      if (blanks > ownBlank) emptyLine();
    }
    const isStart =
      blanks > 0 ||
      paragraph === null ||
      layout === 'per-line' ||
      (layout === 'indented' && INDENT.test(line));
    blanks = 0;
    if (isStart) {
      flush();
      paragraph = line.trim();
    } else paragraph = joinLines(paragraph ?? '', line.trim(), known);
  }
  flush();
  while (items.length && items[items.length - 1] === null) items.pop();
  return { layout, items, controlsLeftOut };
}
