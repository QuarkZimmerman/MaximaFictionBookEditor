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

/** The spans of the descendants of `block` matching `pick`: [from, to, value] in its text. */
function spans(
  block: Element,
  pick: (element: Element) => string | null,
): [number, number, string][] {
  const out: [number, number, string][] = [];
  const walk = (node: Node, at: number): number => {
    if (node.nodeType === 3) return at + (node as Text).data.length;
    let end = at;
    for (const child of node.childNodes) end = walk(child, end);
    if (node !== block && node.nodeType === 1) {
      const value = pick(node as Element);
      if (value) out.push([at, end, value]);
    }
    return end;
  };
  walk(block, 0);
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
  const langs: [number, number, number, string][] = [];
  const ids: [number, string][] = [];
  const tables: [number, number, string][] = [];
  const bodies: { name: string; page: number }[] = [];
  const seenSections = new Set<Element>();
  const seenBodies = new Set<Element>();
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
    const path = chain
      .filter((c) => isFb2(c) && CONTAINERS.has(c.localName))
      .map((c) => c.localName);
    if (isFb2(element) && GENERIC_BLOCKS.has(element.localName)) path.push(element.localName);
    if (isFb2(element, 'image') && element.parentElement?.localName === 'section')
      path.push('picture');
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
