/**
 * Feature 014 (D9, D10, D11, research R7; tasks T022, T023): the pages of the PDF. The book is built
 * as Preview shows it in a hidden frame of the text width (document.ts). Each block (a paragraph, a
 * verse, a picture, a table...) is measured line by line there. The planner decides the breaks
 * (plan.ts), and the pages are composed as fixed-size boxes that the browser engine prints one per
 * PDF page.
 *
 * - The book's elements keep their FB2 names and namespace, so the book's stylesheets and Preview's
 *   base sheet style them as in Preview. A block's containers (section, epigraph, poem...) are
 *   cloned onto each page it reaches.
 * - A paragraph split between pages is cut where its line ends; the part on the next page carries
 *   no first-line indent (`mfbe-continued`).
 * - The cover page and the title page come first (D11). Every other page carries its number at its
 *   foot (D9), hidden from the structure.
 * - The page map records the bookmarks, the picture boxes, the pages' text and the language.
 * - The pages are serialised as XHTML parts of at most a thousand pages (DP-3), which keeps the
 *   book's elements in their namespace through the print browser.
 */
import type { CommandContext } from '@/app/commands';
import { FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';
import type { Document } from '@/model/document';
import type { Settings } from '@/rpc/types';

import type { PdfPageSize } from '../pageSizes';
import { createPrintFrame, pictureBox, pictureElement } from './document';
import { layoutFor, type PrintLayout } from './layout';
import { PX_TO_PT, type PageMap, type PageMapBookmark, type PageMapPicture } from './pageMap';
import { footnoteElement, isNotesBody, noteRefs, noteSections, referenceId } from './footnotes';
import { buildHints } from './hints';
import { FOOT_SHARE, planPage, type PlanBlock, type PlanCursor, type PlannedPage } from './plan';
import { pdfWords, wordsLanguage } from './words';

export const PAGES_PER_PART = 1000;

/** FB2 elements that hold blocks rather than being one. */
const CONTAINERS = new Set([
  'FictionBook',
  'body',
  'section',
  'title',
  'epigraph',
  'poem',
  'stanza',
  'cite',
  'annotation',
]);
const SPLITTABLE = new Set(['p', 'v', 'text-author']);

/** DP-19: a book beyond the export's limits, refused before printing. */
export class PdfLimitError extends Error {
  constructor(
    readonly limit: 'pages' | 'notes',
    readonly count: number,
    readonly max: number,
  ) {
    super(`${limit}: ${count} of at most ${max}`);
  }
}

export interface PaginateOptions {
  /** DP-19, from pdf.export.begin. */
  limits?: { pages: number; notes: number; nesting: number; pixels?: number };
  pageSize: PdfPageSize;
  settings: Settings['pdf'];
  /** D7(c): the text font, when it is one the user added. */
  addedFont?: { id: string; kind: 'serif' | 'sans-serif' | 'monospace' };
  cancelled: () => boolean;
  progress: (done: number, total: number) => void;
}

export interface Paginated {
  parts: string[];
  pageMap: PageMap;
  /** Pictures left out (D12), for the summary. */
  leftOut: string[];
  /** The book's font names replaced by D7's families, for the summary. */
  replacedFonts: string[];
  /** D18: links to ids the book does not have, written as text. */
  linksAsText: string[];
  /** D22: ids used twice, kept by the first. */
  idsTwice: string[];
  /**
   * D23: the parts of the bodies the editor keeps as XML it cannot show (not valid FB2 there,
   * kept for the round trip): Preview draws them as nothing, so the PDF prints them as nothing.
   */
  rawParts: string[];
  /** D23 / FR-042: what the status line counts. */
  counts: { pictures: number; tables: number; notes: number };
  /** R10: the editor's hints (mfbe:fb2Hints, JSON). */
  hints: string;
}

class PaginationCancelled extends Error {}

interface Block {
  element: Element;
  chain: Element[];
  plan: PlanBlock;
  /** Line tops relative to the block's top, px (splittable blocks). */
  tops: number[];
  /** The section whose title this block starts, for its bookmark. */
  titleOf: Element | null;
  depth: number;
}

const yieldToPage = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function isFb2(element: Element, name: string): boolean {
  return element.namespaceURI === FB2_NS && element.localName === name;
}

/** The blocks of the book in reading order, each with its containers. */
function collectBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  let breakNext = false;
  let bodyCount = 0;
  const walk = (element: Element, chain: Element[]): void => {
    for (const child of [...element.children]) {
      const name = child.localName;
      if (child.namespaceURI === FB2_NS && CONTAINERS.has(name)) {
        // D19: the notes bodies are printed at the feet of the pages (footnotes.ts).
        if (name === 'body' && isNotesBody(child)) continue;
        if (name === 'body') {
          bodyCount++;
          breakNext = bodyCount > 1;
        }
        if (name === 'section' && isFb2(element, 'body')) breakNext = true;
        walk(child, [...chain, child]);
        continue;
      }
      const inTitle = chain.some((c) => isFb2(c, 'title'));
      const titleElement = chain[chain.length - 1];
      const section = chain.length >= 2 ? chain[chain.length - 2] : null;
      const startsTitle =
        inTitle &&
        isFb2(titleElement, 'title') &&
        section !== null &&
        isFb2(section, 'section') &&
        titleElement.firstElementChild === child;
      blocks.push({
        element: child,
        chain,
        plan: {
          lines: [],
          spaceBefore: 0,
          splittable: child.namespaceURI === FB2_NS && SPLITTABLE.has(name) && !inTitle,
          keepWithNext: inTitle || isFb2(child, 'subtitle'),
          breakBefore: breakNext,
        },
        tops: [],
        titleOf: startsTitle ? section : null,
        depth: chain.filter((c) => isFb2(c, 'section')).length,
      });
      breakNext = false;
    }
  };
  walk(root, [root]);
  if (blocks[0]) blocks[0].plan.breakBefore = false;
  return blocks;
}

/** Measures a block's lines in the flow (the text width). */
function measure(block: Block): void {
  const element = block.element as HTMLElement;
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const marginBottom = Number.parseFloat(style.marginBottom) || 0;
  block.plan.spaceBefore = marginTop;
  // A table splits between its rows, which the planner takes as lines (DP-19's 10,000 rows).
  if (isTable(element)) {
    const rows = [...(element as HTMLTableElement).rows];
    if (rows.length >= 4) {
      const tops = rows.map((row) => row.getBoundingClientRect().top - rect.top);
      block.tops = tops;
      block.plan.splittable = true;
      block.plan.lines = tops.map((top, i) =>
        i + 1 < tops.length ? tops[i + 1] - (i === 0 ? 0 : top) : rect.height - top + marginBottom,
      );
      // Its header row is repeated on every page it continues on (tableRows).
      if (headerRow(element as HTMLTableElement)) block.plan.repeat = block.plan.lines[0];
      return;
    }
  }
  if (!block.plan.splittable) {
    block.plan.lines = [rect.height + marginBottom];
    return;
  }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const tops: number[] = [];
  for (const r of range.getClientRects()) {
    if (r.width === 0 && r.height === 0) continue;
    const top = r.top - rect.top;
    if (!tops.some((t) => Math.abs(t - top) < 1)) tops.push(top);
  }
  tops.sort((a, b) => a - b);
  if (tops.length <= 1) {
    block.plan.lines = [rect.height + marginBottom];
    block.tops = [0];
    return;
  }
  block.tops = tops;
  block.plan.lines = tops.map((top, i) =>
    i + 1 < tops.length ? tops[i + 1] - (i === 0 ? 0 : top) : rect.height - top + marginBottom,
  );
}

const isTable = (element: Element): boolean =>
  element.namespaceURI === XHTML_NS && element.localName === 'table';

/** A table's first row is its header when all its cells are header cells. */
const headerRow = (table: HTMLTableElement): boolean => {
  const first = table.rows[0];
  return (
    !!first && first.cells.length > 0 && [...first.cells].every((cell) => cell.localName === 'th')
  );
};

/**
 * Rows [from, to) of a table, in a copy of the table; a continued part repeats the table's header
 * row (a first row of header cells only), as printed tables do.
 */
function tableRows(table: HTMLTableElement, from: number, to: number): Element {
  const copy = table.cloneNode(false) as HTMLTableElement;
  const rows = [...table.rows];
  if (from > 0 && headerRow(table)) copy.append(rows[0].cloneNode(true));
  for (const row of rows.slice(from, to)) copy.append(row.cloneNode(true));
  if (from > 0) copy.classList.add('mfbe-continued');
  return copy;
}

/** The text nodes of `element` with their start offsets in its text. */
function textNodes(element: Element): { node: Text; start: number }[] {
  const out: { node: Text; start: number }[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let start = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    out.push({ node: node as Text, start });
    start += (node as Text).length;
  }
  return out;
}

/** The text offset where line `line` of the measured block starts (binary search on the glyphs). */
function lineStart(block: Block, line: number): number {
  const nodes = textNodes(block.element);
  const total = nodes.length
    ? nodes[nodes.length - 1].start + nodes[nodes.length - 1].node.length
    : 0;
  const top = block.element.getBoundingClientRect().top + block.tops[line] - 0.5;
  const range = block.element.ownerDocument.createRange();
  const topOf = (offset: number): number => {
    let index = nodes.length - 1;
    while (index > 0 && nodes[index].start > offset) index--;
    const { node, start } = nodes[index];
    const local = Math.min(offset - start, Math.max(0, node.length - 1));
    range.setStart(node, local);
    range.setEnd(node, Math.min(local + 1, node.length));
    const rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1].top : Number.POSITIVE_INFINITY;
  };
  let low = 0;
  let high = total;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (topOf(mid) >= top) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** A deep clone of `element` keeping only the text between `from` and `to`. */
function cloneText(element: Element, from: number, to: number): Element {
  const clone = element.cloneNode(true) as Element;
  for (const { node, start } of textNodes(clone)) {
    const end = start + node.length;
    if (end <= from || start >= to) {
      node.remove();
      continue;
    }
    node.data = node.data.slice(Math.max(0, from - start), Math.min(node.length, to - start));
  }
  return clone;
}

function escapeXml(text: string): string {
  return text.replace(
    /[<>&"]/g,
    (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot' }[c]};`,
  );
}

function partDocument(css: string[], lang: string, title: string, pages: string[]): string {
  const styles = css
    .map((text) => `<style><![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]></style>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<html xmlns="${XHTML_NS}" lang="${escapeXml(lang)}"><head><meta charset="utf-8"/>` +
    `<title>${escapeXml(title)}</title>${styles}</head><body>${pages.join('')}</body></html>`
  );
}

/** The raw-XML parts of `bodies`, each as the start of its text (its tags' text when it has none). */
function rawParts(bodies: readonly unknown[]): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: { xml?: string }; content?: unknown[] };
    if (n.type === 'raw-xml' || n.type === 'raw-xml-inline') {
      const xml = n.attrs?.xml ?? '';
      const text = xml
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const shown = text || xml.replace(/\s+/g, ' ').trim();
      out.push(shown.length > 60 ? `${shown.slice(0, 60)}…` : shown);
      return;
    }
    for (const child of n.content ?? []) walk(child);
  };
  for (const body of bodies) walk(body);
  return out;
}

export async function paginate(
  ctx: CommandContext,
  book: Document,
  options: PaginateOptions,
): Promise<Paginated> {
  const layout: PrintLayout = layoutFor(options.pageSize, options.settings, options.addedFont);
  const docId = ctx.store.getState().docId ?? '';
  const frame = await createPrintFrame(book, docId, layout, options.limits?.pixels);
  try {
    const { doc, root, css } = frame;
    const lang = book.description.titleInfo.lang ?? '';
    const title = book.description.titleInfo.bookTitle ?? '';
    // D19: the notes, and which of them a reference points to.
    const notes = noteSections(root);
    const limits = options.limits ?? { pages: 20_000, notes: 100_000, nesting: 64 };
    if (notes.size > limits.notes) throw new PdfLimitError('notes', notes.size, limits.notes);
    const referenced = new Set<string>();
    for (const body of root.getElementsByTagNameNS(FB2_NS, 'body')) {
      if (isNotesBody(body)) continue;
      for (const [id] of noteRefs(body, notes)) referenced.add(id);
    }
    // Notes nothing refers to are printed after the text, under the notes' title, else D11's word.
    const unreferenced = [...notes].filter(([id]) => !referenced.has(id));
    if (unreferenced.length > 0) {
      const notesBody = [...root.getElementsByTagNameNS(FB2_NS, 'body')].find(isNotesBody);
      const heading = notesBody
        ? [...notesBody.children].find((c) => c.localName === 'title')
        : undefined;
      const body = doc.createElementNS(FB2_NS, 'body');
      const section = doc.createElementNS(FB2_NS, 'section');
      const title = heading
        ? (heading.cloneNode(true) as Element)
        : doc.createElementNS(FB2_NS, 'title');
      if (!heading) {
        const line = doc.createElementNS(FB2_NS, 'p');
        line.textContent = pdfWords(lang).notes;
        title.append(line);
      }
      title.setAttribute('role', 'heading');
      title.setAttribute('aria-level', '2');
      section.append(title, ...unreferenced.map(([, note]) => note.cloneNode(true)));
      body.append(section);
      root.append(body);
    }
    const blocks = collectBlocks(root);
    // DP-19: sections deeper than the limit are drawn and bookmarked at its level.
    for (const block of blocks) block.depth = Math.min(block.depth, limits.nesting);
    let lastYield = performance.now();
    const breath = async (done: number, total: number): Promise<void> => {
      if (options.cancelled()) throw new PaginationCancelled();
      if (performance.now() - lastYield > 16) {
        options.progress(done, total);
        await yieldToPage();
        lastYield = performance.now();
      }
    };
    for (let i = 0; i < blocks.length; i++) {
      measure(blocks[i]);
      await breath(i, blocks.length * 2);
    }
    // D19: each block carries the notes it refers to first; their footnotes are measured in the
    // foot's own text size, at the text width.
    const footMeasure = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
    footMeasure.className = 'mfbe-notes-measure';
    footMeasure.style.width = `${layout.contentWidth}px`;
    doc.body.append(footMeasure);
    const footnotes = new Map<string, HTMLElement>();
    const blockNotes: string[][] = blocks.map(() => []);
    blocks.forEach((block, index) => {
      for (const [id, anchor] of noteRefs(block.element, notes)) {
        if (footnotes.has(id)) continue;
        anchor.setAttribute('id', referenceId(id));
        const note = footnoteElement(doc, id, notes.get(id)!, anchor.textContent ?? '');
        footMeasure.append(note);
        footnotes.set(id, note);
        blockNotes[index].push(id);
      }
    });
    const footHeight = (id: string): number => {
      const note = footnotes.get(id)!;
      const style = doc.defaultView!.getComputedStyle(note);
      return note.getBoundingClientRect().height + (Number.parseFloat(style.marginBottom) || 0);
    };
    blocks.forEach((block, index) => {
      // The reference anchors got their ids after the blocks were cloned for measuring: the
      // planner only needs the heights.
      const foot = blockNotes[index].reduce((sum, id) => sum + footHeight(id), 0);
      if (foot > 0) block.plan.foot = foot;
    });
    footMeasure.remove();
    const notesPx = ((layout.textPt * 96) / 72) * 0.8;
    const footGap = notesPx * 1.1 + 2;
    const planBlocks = blocks.map((block) => block.plan);

    const pagesHost = doc.createElement('div');
    doc.body.append(pagesHost);
    const serialised: string[] = [];
    const pictures: PageMapPicture[] = [];
    const text: string[] = [];
    const bookmarks: PageMapBookmark[] = [];
    const stack: { depth: number; mark: PageMapBookmark }[] = [];
    const serializer = new XMLSerializer();
    const blockPage: number[] = [];

    // D17: a bookmark's height is its title's on the composed page.
    const pendingMarks = new Map<number, PageMapBookmark>();
    const finishPage = (page: HTMLElement, numbered: boolean): void => {
      const index = serialised.length;
      if (numbered) {
        const number = doc.createElement('div');
        number.className = 'mfbe-number';
        number.setAttribute('aria-hidden', 'true');
        number.textContent = String(index + 1);
        page.append(number);
      }
      pagesHost.append(page);
      const pageRect = page.getBoundingClientRect();
      for (const marked of page.querySelectorAll('[data-mfbe-mark]')) {
        const mark = pendingMarks.get(Number(marked.getAttribute('data-mfbe-mark')));
        if (mark) mark.y = (marked.getBoundingClientRect().top - pageRect.top) * PX_TO_PT;
        marked.removeAttribute('data-mfbe-mark');
      }
      for (const box of page.querySelectorAll<HTMLElement>('.mfbe-picture')) {
        const r = box.getBoundingClientRect();
        pictures.push({
          page: index,
          x: (r.left - pageRect.left) * PX_TO_PT,
          y: (r.top - pageRect.top) * PX_TO_PT,
          width: r.width * PX_TO_PT,
          height: r.height * PX_TO_PT,
          binaryId: box.getAttribute('data-binary-id') ?? '',
          alt: box.getAttribute('data-alt') ?? '',
        });
      }
      text.push(page.querySelector('.mfbe-content')?.textContent ?? '');
      serialised.push(serializer.serializeToString(page));
      page.remove();
    };
    const newPage = (): { page: HTMLElement; content: HTMLElement } => {
      const page = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
      page.className = 'mfbe-page';
      const content = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
      content.className = 'mfbe-content';
      page.append(content);
      return { page, content };
    };

    // D11: the cover page, the cover picture as large as the page allows (DP-8).
    const coverHref = book.description.titleInfo.coverpage[0]?.href ?? '';
    const coverMeta = book.binaries.find((binary) => `#${binary.id}` === coverHref);
    let cover: string | null = null;
    if (coverMeta?.decodable && coverMeta.width && coverMeta.height) {
      const { page, content } = newPage();
      const scale = Math.min(
        layout.contentWidth / coverMeta.width,
        layout.contentHeight / coverMeta.height,
      );
      // FR-010: the cover picture's alternative text, in the book's language.
      const box = pictureElement(doc, coverMeta.id, pdfWords(lang).cover, {
        width: coverMeta.width * scale,
        height: coverMeta.height * scale,
      });
      content.append(box);
      finishPage(page, false);
      cover = coverMeta.id;
      bookmarks.push({ title: pdfWords(lang).cover, page: 0, y: 0, children: [] });
    }
    // D11: the title page - the title and the authors, as the description gives them.
    {
      const { page, content } = newPage();
      const heading = doc.createElementNS(FB2_NS, 'title');
      const p = doc.createElementNS(FB2_NS, 'p');
      p.textContent = title;
      heading.append(p);
      content.append(heading);
      for (const author of book.description.titleInfo.authors ?? []) {
        const line = doc.createElementNS(FB2_NS, 'subtitle');
        line.textContent =
          [author.firstName, author.middleName, author.lastName].filter(Boolean).join(' ') ||
          (author.nickname ?? '');
        if (line.textContent) content.append(line);
      }
      finishPage(page, false);
      bookmarks.push({
        title: pdfWords(lang).titlePage,
        page: serialised.length - 1,
        y: 0,
        children: [],
      });
    }

    // A page is composed, then measured as composed: the containers cloned onto it (a poem's or a
    // cite's spacing) are not in the blocks' measured heights, so a page that overflows its text
    // area hands its last piece to the next page (the composed page is the one source of truth).
    interface Composed {
      page: HTMLElement;
      area: HTMLElement;
      foot: HTMLElement;
    }
    // D19: the part of a long note that did not fit at the foot of the page before, first at the
    // foot of this one; `carryNext` is the part this page passes on.
    let carriedNote: Element | null = null;
    let carryNext: Element | null = null;
    const compose = (pieces: PlannedPage): Composed => {
      carryNext = null;
      const { page, content } = newPage();
      // The text above, the page's footnotes at the foot under their rule (D19).
      const area = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
      area.className = 'mfbe-area';
      const foot = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
      foot.className = 'mfbe-notes';
      if (carriedNote) foot.append(carriedNote.cloneNode(true));
      content.append(area);
      const open: { original: Element; clone: Element }[] = [];
      for (const piece of pieces) {
        const block = blocks[piece.block];
        // The containers of the block, cloned once per page (shallow).
        let shared = 0;
        while (
          shared < open.length &&
          shared < block.chain.length - 1 &&
          open[shared].original === block.chain[shared + 1]
        ) {
          shared++;
        }
        open.length = shared;
        let parent: Element = shared > 0 ? open[shared - 1].clone : area;
        for (let c = shared + 1; c < block.chain.length; c++) {
          const clone = block.chain[c].cloneNode(false) as Element;
          parent.append(clone);
          open.push({ original: block.chain[c], clone });
          parent = clone;
        }
        const whole = piece.fromLine === 0 && piece.toLine === block.plan.lines.length;
        let node: Element;
        if (!whole && isTable(block.element)) {
          node = tableRows(block.element as HTMLTableElement, piece.fromLine, piece.toLine);
        } else if (whole || block.tops.length <= 1) {
          node = block.element.cloneNode(true) as Element;
        } else {
          const from = piece.fromLine === 0 ? 0 : lineStart(block, piece.fromLine);
          const to =
            piece.toLine >= block.plan.lines.length
              ? Number.MAX_SAFE_INTEGER
              : lineStart(block, piece.toLine);
          node = cloneText(block.element, from, to);
          if (piece.fromLine > 0) node.classList.add('mfbe-continued');
        }
        if (block.titleOf && piece.fromLine === 0) {
          node.setAttribute('data-mfbe-mark', String(piece.block));
        }
        parent.append(node);
        if (piece.fromLine === 0) {
          for (const id of blockNotes[piece.block]) foot.append(footnotes.get(id)!.cloneNode(true));
        }
      }
      if (foot.childElementCount > 0) content.append(foot);
      return { page, area, foot };
    };
    // D19: when the foot takes more than its share and does not fit, its last note is cut after its
    // last whole line there, and the rest goes to the foot of the next page (without the note's id,
    // which links lead to: the first part keeps it).
    const cutFoot = ({ page, area, foot }: Composed): boolean => {
      const note = foot.lastElementChild as HTMLElement | null;
      if (!note) return false;
      pagesHost.append(page);
      try {
        const footBox = foot.getBoundingClientRect();
        if (footBox.height <= layout.contentHeight * FOOT_SHARE) return false;
        const noteTop = note.getBoundingClientRect().top;
        const room = layout.contentHeight - area.scrollHeight - (noteTop - footBox.top);
        const range = doc.createRange();
        range.selectNodeContents(note);
        const tops: number[] = [];
        for (const r of range.getClientRects()) {
          if (r.width === 0 && r.height === 0) continue;
          const top = r.top - noteTop;
          if (!tops.some((t) => Math.abs(t - top) < 1)) tops.push(top);
        }
        tops.sort((a, b) => a - b);
        let keep = 0;
        while (keep + 1 < tops.length && tops[keep + 1] <= room) keep++;
        if (keep < 1) return false;
        const offset = lineStart({ element: note, tops } as unknown as Block, keep);
        const rest = cloneText(note, offset, Number.MAX_SAFE_INTEGER);
        rest.removeAttribute('id');
        for (const marked of rest.querySelectorAll('[id]')) marked.removeAttribute('id');
        rest.classList.add('mfbe-continued');
        note.replaceWith(cloneText(note, 0, offset));
        carryNext = rest;
        return true;
      } finally {
        page.remove();
      }
    };
    const overflows = ({ page, area, foot }: Composed): boolean => {
      pagesHost.append(page);
      const footHeight = foot.isConnected ? foot.getBoundingClientRect().height : 0;
      const tall = area.scrollHeight + footHeight > layout.contentHeight + 0.5;
      page.remove();
      return tall;
    };

    // A page at a time: planned from the measured heights, composed, and checked; when the composed
    // page is taller than the text area, its last piece - or, alone, its last line - goes on, and
    // the next page is planned from where this one really ends.
    for (let cursor: PlanCursor | null = { block: 0, fromLine: 0 }; cursor;) {
      const planned = planPage(planBlocks, cursor, layout.contentHeight, footGap);
      const pieces = planned.page;
      let next = planned.next;
      if (pieces.length === 0) {
        cursor = next;
        continue;
      }
      let composed = compose(pieces);
      while (overflows(composed)) {
        if (cutFoot(composed) && !overflows(composed)) break;
        if (pieces.length > 1) {
          const carried = pieces.pop()!;
          next = { block: carried.block, fromLine: carried.fromLine };
        } else if (pieces[0].toLine - pieces[0].fromLine > 1) {
          pieces[0].toLine--;
          next = { block: pieces[0].block, fromLine: pieces[0].toLine };
        } else {
          break; // one line taller than the page: the check of the finished file reports it
        }
        composed = compose(pieces);
      }
      // DP-19: refused before printing.
      if (serialised.length + 1 > limits.pages) {
        throw new PdfLimitError('pages', serialised.length + 1, limits.pages);
      }
      const { page } = composed;
      for (const piece of pieces) {
        if (piece.fromLine === 0) blockPage[piece.block] = serialised.length;
        const block = blocks[piece.block];
        if (!block.titleOf || piece.fromLine !== 0) continue;
        const mark: PageMapBookmark = {
          // The title's lines, each a paragraph, joined by a space.
          title: [...(block.titleOf.querySelector('title')?.children ?? [])]
            .map((line) => (line.textContent ?? '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' '),
          page: serialised.length,
          y: 0,
          children: [],
        };
        pendingMarks.set(piece.block, mark);
        while (stack.length && stack[stack.length - 1].depth >= block.depth) stack.pop();
        (stack.length ? stack[stack.length - 1].mark.children : bookmarks).push(mark);
        stack.push({ depth: block.depth, mark });
      }
      finishPage(page, true);
      carriedNote = carryNext;
      cursor = next;
      await breath(blocks.length + (cursor?.block ?? blocks.length), blocks.length * 2);
    }
    // D19: the rest of a long note at the end of the text, on pages of their own.
    while (carriedNote) {
      const composed = compose([]);
      if (overflows(composed)) cutFoot(composed);
      if (serialised.length + 1 > limits.pages) {
        throw new PdfLimitError('pages', serialised.length + 1, limits.pages);
      }
      finishPage(composed.page, true);
      carriedNote = carryNext;
    }

    const pageMap: PageMap = {
      pages: serialised.length,
      bookmarks,
      pictures,
      cover,
      text,
      language: lang,
      addedWords: wordsLanguage(lang),
    };
    const hints = buildHints({
      blocks: blocks.map((block, index) => ({
        element: block.element,
        chain: block.chain,
        page: blockPage[index] ?? 0,
      })),
      book,
      pageMap,
      coverPage: cover ? 1 : null,
      titlePage: cover ? 2 : 1,
    });
    const parts: string[] = [];
    for (let at = 0; at < serialised.length; at += PAGES_PER_PART) {
      parts.push(partDocument(css, lang, title, serialised.slice(at, at + PAGES_PER_PART)));
    }
    return {
      parts,
      leftOut: frame.leftOut,
      replacedFonts: frame.replacedFonts,
      linksAsText: frame.linksAsText,
      idsTwice: frame.idsTwice,
      rawParts: rawParts(book.bodies),
      counts: {
        pictures: new Set(pictures.map((picture) => picture.binaryId)).size,
        tables: root.getElementsByTagNameNS(XHTML_NS, 'table').length,
        // The notes are the sections of the notes and comments bodies, as the EPUB export counts them.
        notes: book.bodies
          .filter((body) => /^(notes|comments)$/i.test(body.attrs.name ?? ''))
          .reduce((sum, body) => sum + body.content.filter((n) => n.type === 'section').length, 0),
      },
      pageMap,
      hints,
    };
  } finally {
    frame.dispose();
  }
}

/** For the unit tests: the box a picture gets. */
export { pictureBox };
