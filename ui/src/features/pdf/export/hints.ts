/**
 * Feature 014 (R10, DP-10, contracts/pdf-file.md `mfbe:fb2Hints`; tasks T037): what the PDF cannot
 * give back of the FB2 book, for a later import to fill in the gaps - not the book again. Blocks are
 * keyed by `b`, their index in the paginator's own order (the engine's tag order may change between
 * versions); each run of keys carries its first block's first 16 characters as an anchor. Spans are
 * `[b, from, to]` in characters of the block's text.
 */
import { FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';
import type { Document } from '@/model/document';

import type { PageMap } from './pageMap';

export interface HintBlock {
  element: Element;
  chain: Element[];
  /** The page (from 0) its first line is on. */
  page: number;
}

export interface HintsInput {
  blocks: HintBlock[];
  book: Pick<Document, 'stylesheets' | 'binaries' | 'bodies'>;
  pageMap: Pick<PageMap, 'pictures' | 'addedWords'>;
  /** Page numbers (from 1) of the cover page (null when none) and the title page. */
  coverPage: number | null;
  titlePage: number;
  /**
   * The first pages (from 1) of the description's annotation and of the document's history, which
   * the export prints after the title page and at the end (null when the book has none): a later
   * import takes them from the description, not as text of the bodies.
   */
  descriptionPages?: { annotation: number | null; history: number | null };
  /** Feature 016 (D6): the blocks whose text goes on onto a next page, once per page break (the paginator's). */
  continued?: number[];
  /** Feature 016 (D19): the pages (from 1) whose foot begins with the rest of a note cut on the page before. */
  carriedPages?: number[];
}

const GENERIC_BLOCKS = new Set(['v', 'subtitle', 'text-author', 'date', 'empty-line']);
const CONTAINERS = new Set(['epigraph', 'cite', 'poem', 'stanza', 'annotation']);
const MARKS = new Set(['strikethrough', 'sub', 'sup']);

// XML 1.0 forbids these; they are left out of every value (D22).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const clean = (text: string): string => text.replace(FORBIDDEN, '');
const squeeze = (text: string): string => clean(text).replace(/\s+/g, ' ').trim();

const isFb2 = (element: Element | null | undefined, name?: string): boolean =>
  element?.namespaceURI === FB2_NS && (name === undefined || element.localName === name);

/** A hyphen or a dash after which a line may break with no space to mark. */
const DASHES = new Set(['-', '\u2010', '\u2012', '\u2013', '\u2014']);
/** Closing punctuation, before which the import puts no space at a line's start. */
const CLOSING = /[.,;:!?)\]}»”’…%]/u;

/** Whitespace as CSS collapses it in printed text (not the no-break space). */
const WHITESPACE = /[ \t\n\r\f]/;

/**
 * The spans of the descendants of `block` matching `pick`: [from, to, value] in its text as it prints -
 * whitespace runs one space, none leading - which is the text the PDF shows the import (D32's library run: a
 * pretty-printed book's line breaks inside a paragraph shifted every span). Offsets count UTF-16 units.
 */
function spans(
  block: Element,
  pick: (element: Element) => string | null,
): [number, number, string][] {
  const out: [number, number, string][] = [];
  let length = 0;
  let space = true;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        const white = WHITESPACE.test(data[i]);
        if (white && space) continue;
        length++;
        space = white;
      }
      return;
    }
    const at = length;
    for (const child of node.childNodes) walk(child);
    if (node !== block && node.nodeType === 1) {
      const value = pick(node as Element);
      if (value) out.push([at, length, value]);
    }
  };
  walk(block);
  return out;
}

/**
 * Feature 016 (D6): the spaces that touch the edge of a text node - between two marks, or between a mark and
 * the text beside it. The engine may draw such a space as no character at all (D32: a space of its own between
 * two marks came as a gap), so the record names them, and the import puts back those its text lacks. Offsets as
 * `spans` counts them.
 */
function boundarySpaces(block: Element): number[] {
  if (![...block.childNodes].some((node) => node.nodeType === 1)) return [];
  const units: { node: Text; char: string; offset: number }[] = [];
  let length = 0;
  let space = true;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      for (const char of (node as Text).data) {
        const white = WHITESPACE.test(char);
        if (white && space) continue;
        units.push({ node: node as Text, char: white ? ' ' : char, offset: length });
        length += char.length;
        space = white;
      }
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(block);
  const out: number[] = [];
  for (let i = 1; i + 1 < units.length; i++) {
    const unit = units[i];
    if (unit.char !== ' ') continue;
    if (units[i - 1].node !== unit.node || units[i + 1].node !== unit.node) out.push(unit.offset);
  }
  return out;
}

/**
 * Feature 016 (D6): the spaces after a hyphen where a line ends ("Koraiten- und"). The PDF shows such a line
 * ending with the hyphen and nothing of the space, as it shows a word going on after its own hyphen
 * ("Jakka-Mongolen"); the import joins those, and puts these spaces back. Offsets as `spans` counts them; the
 * block must be laid out (the measured book), else none are found.
 */
function lineEndSpaces(block: Element): number[] {
  if (!/\S[-\u2010\u2012\u2013\u2014]\s|\S\s+[.,;:!?)\]}»”’…%]/u.test(block.textContent ?? ''))
    return [];
  const units: { node: Text; index: number; char: string; offset: number }[] = [];
  let length = 0;
  let space = true;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        const white = WHITESPACE.test(data[i]);
        if (white && space) continue;
        units.push({ node: node as Text, index: i, char: white ? ' ' : data[i], offset: length });
        length++;
        space = white;
      }
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(block);
  const range = block.ownerDocument.createRange();
  // Without a layout (a document never shown) nothing can be measured.
  if (typeof range.getClientRects !== 'function') return [];
  const top = (unit: { node: Text; index: number }): number | null => {
    range.setStart(unit.node, unit.index);
    range.setEnd(unit.node, unit.index + 1);
    const rects = range.getClientRects();
    return rects.length ? rects[0].top : null;
  };
  const out: number[] = [];
  for (let i = 1; i + 2 < units.length; i++) {
    if (!DASHES.has(units[i].char) || units[i - 1].char === ' ' || units[i + 1].char !== ' ')
      continue;
    const before = top(units[i]);
    const after = top(units[i + 2]);
    if (before !== null && after !== null && after > before + 1) out.push(units[i + 1].offset);
  }
  // A space before closing punctuation where the line breaks at it ("ru ," - D32): the import puts none there.
  for (let i = 1; i + 1 < units.length; i++) {
    if (units[i].char !== ' ' || units[i - 1].char === ' ' || !CLOSING.test(units[i + 1].char))
      continue;
    const before = top(units[i - 1]);
    const after = top(units[i + 1]);
    if (before !== null && after !== null && after > before + 1) out.push(units[i].offset);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Feature 016 (D6): where a line breaks with no space in the text - before a note's mark or another inline
 * element, after an ellipsis or a slash. The import puts a space at every line's end it cannot tell apart, and
 * takes these out again. Offsets as `spans` counts them; only places where two text nodes meet or such a sign
 * stands are measured.
 */
function lineBreakJoins(block: Element): number[] {
  const units: { node: Text; index: number; char: string; offset: number }[] = [];
  let length = 0;
  let space = true;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        const white = WHITESPACE.test(data[i]);
        if (white && space) continue;
        units.push({ node: node as Text, index: i, char: white ? ' ' : data[i], offset: length });
        length++;
        space = white;
      }
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(block);
  const range = block.ownerDocument.createRange();
  // Without a layout (a document never shown) nothing can be measured.
  if (typeof range.getClientRects !== 'function') return [];
  const top = (unit: { node: Text; index: number }): number | null => {
    range.setStart(unit.node, unit.index);
    range.setEnd(unit.node, unit.index + 1);
    const rects = range.getClientRects();
    return rects.length ? rects[0].top : null;
  };
  const out: number[] = [];
  for (let i = 1; i < units.length; i++) {
    const before = units[i - 1];
    const unit = units[i];
    if (before.char === ' ' || unit.char === ' ' || DASHES.has(before.char)) continue;
    // Where a line may break with no space: where two text nodes meet, after an ellipsis or a slash, before an
    // em dash (Unicode's line breaking, UAX #14).
    if (
      before.node === unit.node &&
      !/[\u2026/]/.test(before.char) &&
      !/[\u2014\u2e3a\u2e3b]/.test(unit.char)
    )
      continue;
    const a = top(before);
    const b = top(unit);
    if (a !== null && b !== null && b > a + 1) out.push(unit.offset);
  }
  // A word longer than its line - an address - breaks anywhere (overflow-wrap: anywhere): its breaks are looked
  // for where its first and last letters stand on different lines (D32: "merrif ield-bio.html").
  const recorded = new Set(out);
  for (let i = 0; i < units.length;) {
    if (units[i].char === ' ') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < units.length && units[j + 1].char !== ' ') j++;
    const first = j - i >= 8 ? top(units[i]) : null;
    const last = first !== null ? top(units[j]) : null;
    if (first !== null && last !== null && last > first + 1) {
      for (let k = i + 1; k <= j; k++) {
        if (recorded.has(units[k].offset) || DASHES.has(units[k - 1].char)) continue;
        const a = top(units[k - 1]);
        const b = top(units[k]);
        if (a !== null && b !== null && b > a + 1) {
          out.push(units[k].offset);
          recorded.add(units[k].offset);
        }
      }
    }
    i = j + 1;
  }
  return out.sort((x, y) => x - y);
}

/** The text of `block` as it prints: whitespace runs one space, none leading (as `spans` counts it). */
function printed(block: Element): string {
  let out = '';
  let space = true;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      for (const char of (node as Text).data) {
        const white = WHITESPACE.test(char);
        if (white && space) continue;
        out += white ? ' ' : char;
        space = white;
      }
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(block);
  return out;
}

/**
 * Feature 016 (D6): letters the book writes with combining marks (e + U+0301) that the font draws as one
 * letter - the PDF holds the composed letter (é) then. Each such cluster, where its composed form differs:
 * its offset as `spans` counts and its text, so that the import writes it as the book did.
 */
function decomposed(block: Element): [number, string][] {
  const text = printed(block);
  if (!/\p{M}/u.test(text)) return [];
  const out: [number, string][] = [];
  for (const match of text.matchAll(/\P{M}\p{M}+/gu))
    if (match[0].normalize('NFC') !== match[0]) out.push([match.index, match[0]]);
  return out;
}

/** FB2's inline marks, which a space may belong to. */
const MARK_NAMES = new Set([
  'strong',
  'emphasis',
  'style',
  'a',
  'strikethrough',
  'sub',
  'sup',
  'code',
]);

/**
 * Feature 016 (D6): a mark's own space where a line breaks at it ("[emphasis]что [/emphasis]" at a line's end).
 * The PDF draws no space there; the import puts one outside the marks, and these go back in: [offset, side] -
 * side 1 when the space is the mark's last character, 0 when its first. Offsets as `spans` counts them.
 */
function markSpaces(block: Element): [number, number][] {
  const ranges = spans(block, (e) =>
    isFb2(e) && MARK_NAMES.has(e.localName) ? e.localName : null,
  );
  if (ranges.length === 0) return [];
  const units: { node: Text; index: number; char: string }[] = [];
  let space = true;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) {
        const white = WHITESPACE.test(data[i]);
        if (white && space) continue;
        units.push({ node: node as Text, index: i, char: white ? ' ' : data[i] });
        space = white;
      }
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(block);
  const range = block.ownerDocument.createRange();
  // Without a layout (a document never shown) nothing can be measured.
  if (typeof range.getClientRects !== 'function') return [];
  const top = (at: number): number | null => {
    const unit = units[at];
    if (!unit) return null;
    range.setStart(unit.node, unit.index);
    range.setEnd(unit.node, unit.index + 1);
    const rects = range.getClientRects();
    return rects.length ? rects[0].top : null;
  };
  const breaks = (before: number, after: number): boolean => {
    const a = top(before);
    const b = top(after);
    return a !== null && b !== null && b > a + 1;
  };
  const out: [number, number][] = [];
  for (const [from, to] of ranges) {
    if (to - from < 2) continue;
    if (units[to - 1]?.char === ' ' && to < units.length && breaks(to - 2, to))
      out.push([to - 1, 1]);
    if (units[from]?.char === ' ' && from > 0 && breaks(from - 1, from + 1)) out.push([from, 0]);
  }
  return out;
}

export function buildHints(input: HintsInput): string {
  const { blocks, book, pageMap } = input;
  const targets = new Set<string>();
  for (const { element } of blocks) {
    for (const link of element.getElementsByTagNameNS(FB2_NS, 'a')) {
      const href = link.getAttribute('data-href') ?? '';
      if (href.startsWith('#')) targets.add(href.slice(1));
    }
  }
  const sections: [number, number][] = [];
  const kinds: [number, number, string][] = [];
  const styles: (number | string)[][] = [];
  const marks: [number, number, number, string][] = [];
  // Feature 016 (D6): [block, offset] of each space after a hyphen at a line's end.
  const spaces: [number, number][] = [];
  // Feature 016 (D6): [block, offset] of each line break with no space in the text.
  const joins: [number, number][] = [];
  // Feature 016 (D6): [block, offset, text] of each letter written with combining marks the PDF composes.
  const clusters: [number, number, string][] = [];
  // Feature 016 (D6): [block, offset, side] of each mark's own space where a line breaks at it.
  const inner: [number, number, number][] = [];
  const langs: [number, number, number, string][] = [];
  const ids: [number, string][] = [];
  const tables: [number, number, string][] = [];
  const bodies: { name: string; page: number }[] = [];
  const seenSections = new Set<Element>();
  const seenBodies = new Set<Element>();
  // Feature 016 (D6): [block, depth] where a container begins anew under the same names (two epigraphs in a
  // row), which the run-length paths cannot show.
  const fresh: [number, number][] = [];
  let previousContainers: Element[] = [];
  blocks.forEach(({ element, chain, page }, b) => {
    for (const container of chain) {
      if (isFb2(container, 'body') && !seenBodies.has(container)) {
        seenBodies.add(container);
        bodies.push({ name: clean(container.getAttribute('name') ?? ''), page });
      }
      if (isFb2(container, 'section') && !seenSections.has(container)) {
        seenSections.add(container);
        sections.push([b, chain.filter((c) => isFb2(c, 'section')).indexOf(container) + 1]);
        const id = container.getAttribute('id');
        if (id && !targets.has(id)) ids.push([b, clean(id)]);
      }
    }
    // The FB2 element of a block whose PDF tag is generic, with its containers (run-length).
    const containers = chain.filter((c) => isFb2(c) && CONTAINERS.has(c.localName));
    const path = containers.map((c) => c.localName);
    const depth = containers.findIndex((c, i) => previousContainers[i] !== c);
    if (depth >= 0 && previousContainers[depth]?.localName === containers[depth].localName)
      fresh.push([b, depth]);
    previousContainers = containers;
    if (isFb2(element) && GENERIC_BLOCKS.has(element.localName)) {
      // Feature 016 (D6): an empty line draws nothing the import could see - inside a title its path says so.
      if (element.localName === 'empty-line' && chain.some((c) => isFb2(c, 'title')))
        path.push('title');
      path.push(element.localName);
    }
    if (isFb2(element, 'image') && element.parentElement?.localName === 'section')
      path.push(element.querySelector('.mfbe-caption') ? 'picture caption' : 'picture');
    const kind = path.join('/');
    const last = kinds[kinds.length - 1];
    if (kind && last && last[2] === kind && last[0] + last[1] === b) last[1]++;
    else if (kind) kinds.push([b, 1, kind]);
    const style = element.getAttribute('class');
    if (style) styles.push([b, clean(style)]);
    for (const [from, to, name] of spans(element, (e) =>
      isFb2(e, 'style') ? e.getAttribute('class') : null,
    ))
      styles.push([b, from, to, clean(name)]);
    for (const [from, to, name] of spans(element, (e) =>
      isFb2(e) && MARKS.has(e.localName) ? e.localName : null,
    ))
      marks.push([b, from, to, name]);
    // Feature 016 (D6): strong and emphasis where the block's look hides them - a title, an epigraph, a
    // subtitle, an author line, a date, a block with a named style are printed bold or italic already.
    const looked =
      chain.some((c) => isFb2(c, 'title') || isFb2(c, 'epigraph')) ||
      (isFb2(element) && ['subtitle', 'text-author', 'date'].includes(element.localName)) ||
      element.hasAttribute('class');
    if (looked)
      for (const [from, to, name] of spans(element, (e) =>
        isFb2(e) && (e.localName === 'strong' || e.localName === 'emphasis') ? e.localName : null,
      ))
        marks.push([b, from, to, name]);
    for (const offset of [...new Set([...lineEndSpaces(element), ...boundarySpaces(element)])].sort(
      (x, y) => x - y,
    ))
      spaces.push([b, offset]);
    for (const offset of lineBreakJoins(element)) joins.push([b, offset]);
    for (const [offset, text] of decomposed(element)) clusters.push([b, offset, clean(text)]);
    for (const [offset, side] of markSpaces(element)) inner.push([b, offset, side]);
    const lang = element.getAttribute('lang');
    if (lang) langs.push([b, 0, element.textContent?.length ?? 0, clean(lang)]);
    for (const [from, to, value] of spans(element, (e) => e.getAttribute('lang')))
      langs.push([b, from, to, clean(value)]);
    const id = element.getAttribute('id');
    if (id && !targets.has(id)) ids.push([b, clean(id)]);
    if (element.namespaceURI === XHTML_NS && element.localName === 'table') {
      [...element.querySelectorAll('td, th')].forEach((cell, index) => {
        const align = cell.getAttribute('align');
        if (align) tables.push([b, index, clean(align)]);
      });
    }
  });
  const contentTypes = new Map(book.binaries.map((binary) => [binary.id, binary.contentType]));
  const inline = new Set(
    blocks.flatMap(({ element }) =>
      [...element.getElementsByTagNameNS(FB2_NS, 'image')]
        .filter((image) => image !== element)
        .map((image) => image.getAttribute('data-href')?.slice(1) ?? ''),
    ),
  );
  // Each run of keys: its first block's first 16 characters.
  const keyed = new Set<number>();
  for (const list of [sections, kinds, styles, marks, langs, ids, tables])
    for (const entry of list) keyed.add(entry[0] as number);
  const anchors: Record<number, string> = {};
  let previous = -2;
  for (const b of [...keyed].sort((x, y) => x - y)) {
    if (b !== previous + 1) anchors[b] = squeeze(blocks[b].element.textContent ?? '').slice(0, 16);
    previous = b;
  }
  return JSON.stringify({
    v: 1,
    blocks: blocks.length,
    generated: {
      cover: input.coverPage,
      titlePage: input.titlePage,
      annotationPage: input.descriptionPages?.annotation ?? null,
      historyPage: input.descriptionPages?.history ?? null,
      words: pageMap.addedWords,
      pageNumbers: 'foot',
    },
    bodies,
    sections,
    kinds,
    styles,
    marks,
    // Always written: an import tells by it a record that names the spaces the PDF may not draw.
    spaces,
    ...(joins.length ? { joins } : {}),
    ...(clusters.length ? { clusters } : {}),
    ...(inner.length ? { inner } : {}),
    ...(fresh.length ? { fresh } : {}),
    ...(input.continued ? { continued: input.continued } : {}),
    ...(input.carriedPages ? { carried: input.carriedPages } : {}),
    langs,
    ids,
    tables,
    pictures: pageMap.pictures.map((picture) => ({
      page: picture.page + 1,
      box: [picture.x, picture.y, picture.width, picture.height].map(
        (n) => Math.round(n * 100) / 100,
      ),
      binaryId: picture.binaryId,
      contentType: contentTypes.get(picture.binaryId) ?? '',
      inline: inline.has(picture.binaryId),
    })),
    stylesheets: book.stylesheets.map((sheet) => ({
      type: sheet.type,
      text: clean(sheet.content),
    })),
    anchors,
  });
}
