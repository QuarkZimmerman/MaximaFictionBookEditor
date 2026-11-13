/**
 * Feature 014 (D8, D12, research R4, R7; tasks T021): the book as the PDF's pages show it, built
 * by Preview's own builder (Preview's base sheet and the book's stylesheets, its elements in the FB2
 * namespace) in a hidden frame of the page's text width, with the print stylesheet after them.
 *
 * Pictures are drawn by the core, from the book's own bytes (R4). Here each becomes an empty box of
 * the size it will have: Preview's size, a picture pixel to a CSS pixel, made smaller to fit the
 * text area (D12). The box keeps the alternative text for the PDF's structure (D20).
 */
import { buildPreview, FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';
import { pdfFontUrl } from '@/model/binaryUrls';
import type { BinaryMeta, Document } from '@/model/document';

import { replaceBookFonts, type TextFont } from './fontKinds';
import { printCss, type PrintLayout } from './layout';

export interface PrintFrame {
  doc: globalThis.Document;
  /** The book's root element (FB2 `FictionBook`), inside the flow container of the text width. */
  root: Element;
  /** The flow container the paginator measures in. */
  flow: HTMLElement;
  /** Every stylesheet of the paged document, in order. */
  css: string[];
  /** Pictures left out: no data, not decodable, or a web address (D12). */
  leftOut: string[];
  /** The font names of the book's stylesheets that were replaced (D7), for the summary. */
  replacedFonts: string[];
  /** D18: links to ids the book does not have, written as text, for the summary. */
  linksAsText: string[];
  /** D22: ids used more than once, kept by their first element only. */
  idsTwice: string[];
  dispose(): void;
}

/** The box size of a picture `meta` in the text area (D12: never enlarged, made smaller to fit). */
export function pictureBox(
  meta: Pick<BinaryMeta, 'width' | 'height'>,
  layout: Pick<PrintLayout, 'contentWidth' | 'contentHeight'>,
): { width: number; height: number } | null {
  if (!meta.width || !meta.height) return null;
  const scale = Math.min(1, layout.contentWidth / meta.width, layout.contentHeight / meta.height);
  return { width: meta.width * scale, height: meta.height * scale };
}

// A white pixel the picture boxes show to the browser engine: its print then tags the box as a
// Figure with the picture's alternative text (an empty box gets no tag), and the core draws the
// real picture over it.
const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC';

/** A picture box (R4): its size, its binary, and its alternative text for the structure (D20). */
export function pictureElement(
  doc: globalThis.Document,
  binaryId: string,
  alt: string,
  size: { width: number; height: number },
): HTMLElement {
  const box = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
  box.className = 'mfbe-picture';
  box.setAttribute('data-binary-id', binaryId);
  box.setAttribute('data-alt', alt);
  box.style.width = `${size.width}px`;
  box.style.height = `${size.height}px`;
  const img = doc.createElementNS(XHTML_NS, 'img') as HTMLImageElement;
  img.src = PLACEHOLDER;
  img.alt = alt;
  img.style.cssText = 'display:block;width:100%;height:100%';
  box.append(img);
  return box;
}

/**
 * D20: the structure the browser engine tags. It tags the book's FB2 elements as plain text only, so
 * they get the ARIA roles it maps to PDF tags: titles become headings (H1 for a body's title, one
 * level deeper per section, H6 at most), paragraphs and verses paragraphs, and emphasis, strong and
 * code text the like. Tables are HTML already. Probed on Playwright's Chromium (m156): with these
 * roles its tagged print gives H1-H6, P, Em, Strong, Code, Figure with Alt, and Table, TR, TH, TD.
 */
function addRoles(root: Element): void {
  const fb2 = (element: Element | null, name: string): boolean =>
    element?.namespaceURI === FB2_NS && element.localName === name;
  const INLINE: Readonly<Record<string, string>> = {
    emphasis: 'emphasis',
    strong: 'strong',
    code: 'code',
    sub: 'subscript',
    sup: 'superscript',
  };
  const PARAGRAPHS = new Set(['p', 'v', 'subtitle', 'text-author', 'date']);
  const walk = (element: Element, depth: number, inTitle: boolean): void => {
    for (const child of element.children) {
      if (child.namespaceURI !== FB2_NS) continue;
      const name = child.localName;
      if (name === 'title') {
        // A body's title is H1, a section's one level below its section's depth, and a poem's or a
        // stanza's one level below the section it stands in.
        const level = fb2(element, 'body')
          ? 1
          : Math.min(6, fb2(element, 'section') ? depth + 1 : depth + 2);
        child.setAttribute('role', 'heading');
        child.setAttribute('aria-level', String(level));
        walk(child, depth, true);
        continue;
      }
      if (!inTitle && PARAGRAPHS.has(name)) child.setAttribute('role', 'paragraph');
      else if (INLINE[name]) child.setAttribute('role', INLINE[name]);
      walk(child, name === 'section' ? depth + 1 : depth, inTitle);
    }
  };
  walk(root, 0, false);
}

/**
 * D18: the book's links as the engine's print makes PDF links of them - HTML anchors (Preview's
 * links are FB2 elements that only name their target). A link inside the book goes to its target's
 * id (a named destination of the file); a link to an id the book does not have keeps its text and is
 * listed; a link outside the book keeps its address as written. Returns the links written as text.
 */
function makeLinks(doc: globalThis.Document, root: Element): string[] {
  const ids = new Set([...root.querySelectorAll('[id]')].map((e) => e.getAttribute('id') ?? ''));
  const asText: string[] = [];
  for (const link of [...root.getElementsByTagNameNS(FB2_NS, 'a')]) {
    const href = link.getAttribute('data-href') ?? '';
    if (href.startsWith('#') && !ids.has(href.slice(1))) {
      asText.push(href);
      link.replaceWith(...link.childNodes);
      continue;
    }
    if (!href) {
      link.replaceWith(...link.childNodes);
      continue;
    }
    const anchor = doc.createElementNS(XHTML_NS, 'a') as HTMLAnchorElement;
    anchor.setAttribute('href', href);
    for (const name of ['data-note', 'title']) {
      const value = link.getAttribute(name);
      if (value !== null) anchor.setAttribute(name, value);
    }
    anchor.append(...link.childNodes);
    link.replaceWith(anchor);
  }
  return asText;
}

export async function createPrintFrame(
  book: Document,
  docId: string,
  layout: PrintLayout,
  /** DP-19: a picture of more pixels is left out and listed, never decoded. */
  maxPixels = 100_000_000,
): Promise<PrintFrame> {
  const frame = window.document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${layout.pageWidth}px`,
    height: `${layout.pageHeight}px`,
    visibility: 'hidden',
    border: '0',
  });
  window.document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();
  const dispose = (): void => frame.remove();
  try {
    await buildPreview(doc, book, { docId });
    // D7: the fonts the book's stylesheets name keep their kind (the first sheet is Preview's base,
    // whose families the print stylesheet below overrides).
    const textFont: TextFont = {
      id: layout.fontId,
      kind: layout.fontId === 'noto-sans' ? 'sans-serif' : 'serif',
    };
    const replaced = new Set<string>();
    for (const sheet of [...doc.head.querySelectorAll('style')].slice(1)) {
      sheet.textContent = await replaceBookFonts(sheet.textContent ?? '', textFont, replaced);
    }
    const style = doc.createElement('style');
    // Absolute addresses: the interface is built with a relative base ('./'), and the paged
    // document is printed from another path of the same core (/pdf/{token}/print/{n}).
    style.textContent = printCss(layout, (id, fontStyle) =>
      new URL(pdfFontUrl(id, fontStyle), window.location.href).toString(),
    );
    doc.head.append(style);
    const css = [...doc.head.querySelectorAll('style')].map((element) => element.textContent ?? '');

    const flow = doc.createElement('div');
    flow.className = 'mfbe-flow';
    flow.style.width = `${layout.contentWidth}px`;
    const root = doc.body.firstElementChild!;
    flow.append(root);
    doc.body.append(flow);

    const binaries = new Map(book.binaries.map((binary) => [binary.id, binary]));
    const leftOut: string[] = [];
    for (const image of [...root.getElementsByTagNameNS(FB2_NS, 'image')]) {
      const href = String(image.getAttribute('data-href') ?? '');
      const img = image.querySelector('img');
      const id = href.startsWith('#') ? href.slice(1) : '';
      const meta = binaries.get(id);
      const pixels = (meta?.width ?? 0) * (meta?.height ?? 0);
      const size = meta?.decodable && pixels <= maxPixels ? pictureBox(meta, layout) : null;
      if (!size) {
        leftOut.push(href || '(no reference)');
        image.remove();
        continue;
      }
      const box = pictureElement(doc, id, img?.alt ?? '', size);
      if (img) img.replaceWith(box);
      else image.append(box);
    }
    addRoles(root);
    // D22: an id used twice is kept by its first element (a destination must be one place).
    const seenIds = new Set<string>();
    const idsTwice: string[] = [];
    for (const element of [...root.querySelectorAll('[id]')]) {
      const id = element.getAttribute('id') ?? '';
      if (!seenIds.has(id)) {
        seenIds.add(id);
        continue;
      }
      element.removeAttribute('id');
      if (!idsTwice.includes(id)) idsTwice.push(id);
    }
    const linksAsText = makeLinks(doc, root);
    await doc.fonts.ready;
    return {
      doc,
      root,
      flow,
      css,
      leftOut,
      replacedFonts: [...replaced],
      linksAsText,
      idsTwice,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
