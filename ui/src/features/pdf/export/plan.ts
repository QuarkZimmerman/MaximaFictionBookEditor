/**
 * Feature 014 (D10, research R7): where the pages break, decided from measured heights only, so that
 * the rules are tested without a browser (tests/unit/pdf/paginator.test.ts). The paginator measures
 * each block's lines in the page's text width, asks this planner, then composes the pages.
 *
 * Rules (D10):
 * - a block that asks for it (a top-level section, another body) starts a new page;
 * - a title is never the last thing on a page: it moves with the first lines of what follows;
 * - a paragraph of four lines or more splits only between lines, with at least two on each side;
 *   a shorter one moves whole;
 * - a block that may not split (a picture, a stanza that fits, a table row) moves whole;
 * - only a block taller than a whole page is cut where the page ends.
 */

export interface PlanBlock {
  /** The heights of the block's lines, px; one entry for a block that never splits. */
  lines: number[];
  /** The space above the block, px; dropped at the top of a page. */
  spaceBefore: number;
  /** Splits between lines (paragraphs); false for pictures, tables, stanzas. */
  splittable: boolean;
  /** Stays with the first lines of the next block (titles). */
  keepWithNext: boolean;
  /** Starts a new page (top-level sections, bodies). */
  breakBefore: boolean;
  /**
   * D19: the height of the footnotes this block refers to first, px. They go to the foot of the page
   * of its first lines, and take that much of the page's text area.
   */
  foot?: number;
}

/** Lines [fromLine, toLine) of block `block`. */
export interface PlannedPiece {
  block: number;
  fromLine: number;
  toLine: number;
}

export type PlannedPage = PlannedPiece[];

const MIN_LINES = 2;
const SPLIT_FROM = 4;

const sum = (values: readonly number[], from = 0, to = values.length): number => {
  let total = 0;
  for (let i = from; i < to; i++) total += values[i];
  return total;
};

/** The height the first piece of `block` needs at least, to keep a title above it company. */
function minimumStart(block: PlanBlock): number {
  if (block.splittable && block.lines.length >= SPLIT_FROM) return sum(block.lines, 0, MIN_LINES);
  return sum(block.lines);
}

/**
 * `footGap` is the space between the text and the first footnote of a page (the short rule).
 */
export function planPages(
  blocks: readonly PlanBlock[],
  pageHeight: number,
  footGap = 0,
): PlannedPage[] {
  const pages: PlannedPage[] = [];
  let page: PlannedPage = [];
  let used = 0;
  let footUsed = 0;
  const newPage = (): void => {
    if (page.length > 0) pages.push(page);
    page = [];
    used = 0;
    footUsed = 0;
  };
  const room = (): number => pageHeight - used - (footUsed > 0 ? footUsed + footGap : 0);
  // The room a block's own footnotes take when its first lines go on the current page.
  const footFor = (block: PlanBlock, from: number): number =>
    from === 0 && (block.foot ?? 0) > 0 ? (block.foot ?? 0) + (footUsed > 0 ? 0 : footGap) : 0;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.breakBefore) newPage();
    let from = 0;
    const lines = block.lines;
    while (from < lines.length) {
      const space = page.length > 0 && from === 0 ? block.spaceBefore : 0;
      const rest = sum(lines, from);
      // A title takes with it the start of the blocks that follow (titles of several lines too).
      let needed = space + rest;
      if (block.keepWithNext && from === 0) {
        for (let next = index + 1; next < blocks.length; next++) {
          needed += blocks[next].spaceBefore + minimumStart(blocks[next]);
          if (!blocks[next].keepWithNext || blocks[next].breakBefore) break;
        }
      }
      const foot = footFor(block, from);
      if (needed + foot <= room()) {
        page.push({ block: index, fromLine: from, toLine: lines.length });
        used += space + rest;
        if (from === 0) footUsed += block.foot ?? 0;
        break;
      }
      if (block.keepWithNext && from === 0 && page.length > 0 && space + rest <= pageHeight) {
        newPage();
        continue;
      }
      // Lines that fit in the room left.
      let fit = 0;
      let height = space;
      while (from + fit < lines.length && height + lines[from + fit] + foot <= room()) {
        height += lines[from + fit];
        fit++;
      }
      const remaining = lines.length - from;
      const canSplit = block.splittable && lines.length >= SPLIT_FROM;
      if (canSplit && fit >= MIN_LINES && remaining - fit >= MIN_LINES) {
        page.push({ block: index, fromLine: from, toLine: from + fit });
        if (from === 0) footUsed += block.foot ?? 0;
        from += fit;
        newPage();
        continue;
      }
      if (canSplit && fit >= MIN_LINES && remaining - fit < MIN_LINES && fit - 1 >= MIN_LINES) {
        // Leave two lines for the next page.
        const keep = remaining - MIN_LINES;
        if (keep >= MIN_LINES) {
          page.push({ block: index, fromLine: from, toLine: from + keep });
          if (from === 0) footUsed += block.foot ?? 0;
          from += keep;
          newPage();
          continue;
        }
      }
      if (page.length > 0) {
        newPage();
        continue;
      }
      // An empty page and still too tall: cut where the page ends (at least one line).
      const cut = Math.max(1, fit);
      page.push({ block: index, fromLine: from, toLine: from + cut });
      if (from === 0) footUsed += block.foot ?? 0;
      from += cut;
      if (from < lines.length) newPage();
      else used += height;
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
