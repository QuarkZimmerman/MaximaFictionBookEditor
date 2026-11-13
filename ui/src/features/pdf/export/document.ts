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

export async function createPrintFrame(
  book: Document,
  docId: string,
  layout: PrintLayout,
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
      const size = meta?.decodable ? pictureBox(meta, layout) : null;
      if (!size) {
        leftOut.push(href || '(no reference)');
        image.remove();
        continue;
      }
      const box = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
      box.className = 'mfbe-picture';
      box.setAttribute('data-binary-id', id);
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', img?.alt ?? '');
      box.style.width = `${size.width}px`;
      box.style.height = `${size.height}px`;
      if (img) img.replaceWith(box);
      else image.append(box);
    }
    await doc.fonts.ready;
    return { doc, root, flow, css, leftOut, replacedFonts: [...replaced], dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
