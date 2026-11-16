/**
 * Feature 016: a PDF not made by the editor, read as plain lines of text - the first, simplest conversion,
 * which User Story 2's layout analysis (layout.ts) replaces.
 */

import { text } from './fb2';
import type { PdfPageModel } from './model';

export function plainBody(pages: readonly PdfPageModel[]): { xml: string; paragraphs: number } {
  const paragraphs: string[] = [];
  for (const page of pages) {
    let line = '';
    let base: number | null = null;
    for (const word of page.words) {
      if (base !== null && Math.abs(word.base - base) > word.s * 0.5) {
        if (line.trim()) paragraphs.push(line.trim());
        line = '';
      }
      line += (line ? ' ' : '') + word.t.replace(/\u00ad$/, '');
      base = word.base;
    }
    if (line.trim()) paragraphs.push(line.trim());
  }
  const body = paragraphs.map((p) => `<p>${text(p)}</p>`).join('');
  return {
    xml: `<body><section>${body || '<p/>'}</section></body>`,
    paragraphs: paragraphs.length,
  };
}

/** The template's description with the book's title (D13: what FB2 requires and the PDF lacks). */
export function templateDescription(templateXml: string, title: string): string {
  const description =
    /<description[\s\S]*?<\/description>/.exec(templateXml)?.[0] ?? '<description/>';
  return description.replace(
    /<book-title>[\s\S]*?<\/book-title>/,
    `<book-title>${text(title)}</book-title>`,
  );
}
