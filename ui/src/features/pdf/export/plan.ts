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
  /**
   * The height each continued part of the block adds at its top, px: a table's header row, which
   * every page of the table repeats.
   */
  repeat?: number;
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

/** Where a page starts: a block, and its first line there. */
export interface PlanCursor {
  block: number;
  fromLine: number;
}

/** D19: the share of a page its text's footnotes may take; a longer note continues on the next. */
export const FOOT_SHARE = 0.5;

/**
 * One page from `start`, and where the next page starts (null after the last block). The paginator
 * plans a page, composes and measures it, and plans the next from where that page really ended, so
 * that a page that ends earlier than planned never pushes its lines into a page planned already.
 * `footGap` is the space between the text and the first footnote of a page (the short rule).
 */
export function planPage(
  blocks: readonly PlanBlock[],
  start: PlanCursor,
  pageHeight: number,
  footGap = 0,
): { page: PlannedPage; next: PlanCursor | null } {
  const page: PlannedPage = [];
  let used = 0;
  let footUsed = 0;
  const room = (): number => pageHeight - used - (footUsed > 0 ? footUsed + footGap : 0);
  // The room a block's own footnotes take when its first lines go on the current page: at most
  // FOOT_SHARE of the page - a longer note continues at the foot of the next page (D19).
  const footOf = (block: PlanBlock): number => Math.min(block.foot ?? 0, pageHeight * FOOT_SHARE);
  const footFor = (block: PlanBlock, from: number): number =>
    from === 0 && footOf(block) > 0 ? footOf(block) + (footUsed > 0 ? 0 : footGap) : 0;
  const stop = (block: number, fromLine: number) => ({ page, next: { block, fromLine } });

  for (let index = start.block; index < blocks.length; index++) {
    const block = blocks[index];
    const from = index === start.block ? start.fromLine : 0;
    if (block.breakBefore && from === 0 && page.length > 0) return stop(index, 0);
    const lines = block.lines;
    while (from < lines.length) {
      const space =
        (page.length > 0 && from === 0 ? block.spaceBefore : 0) +
        (from > 0 ? (block.repeat ?? 0) : 0);
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
        if (from === 0) footUsed += footOf(block);
        break;
      }
      if (block.keepWithNext && from === 0 && page.length > 0 && space + rest <= pageHeight) {
        return stop(index, from);
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
        return stop(index, from + fit);
      }
      if (canSplit && fit >= MIN_LINES && remaining - fit < MIN_LINES && fit - 1 >= MIN_LINES) {
        // Leave two lines for the next page.
        const keep = remaining - MIN_LINES;
        if (keep >= MIN_LINES) {
          page.push({ block: index, fromLine: from, toLine: from + keep });
          return stop(index, from + keep);
        }
      }
      if (page.length > 0) return stop(index, from);
      // An empty page and still too tall: cut where the page ends (at least one line).
      const cut = Math.max(1, fit);
      page.push({ block: index, fromLine: from, toLine: from + cut });
      if (from + cut < lines.length) return stop(index, from + cut);
      used += height;
      break;
    }
  }
  return { page, next: null };
}

/** The whole plan, page after page (the planner as the tests read it). */
export function planPages(
  blocks: readonly PlanBlock[],
  pageHeight: number,
  footGap = 0,
): PlannedPage[] {
  const pages: PlannedPage[] = [];
  for (let cursor: PlanCursor | null = { block: 0, fromLine: 0 }; cursor;) {
    const { page, next } = planPage(blocks, cursor, pageHeight, footGap);
    if (page.length > 0) pages.push(page);
    cursor = next;
  }
  return pages;
}
