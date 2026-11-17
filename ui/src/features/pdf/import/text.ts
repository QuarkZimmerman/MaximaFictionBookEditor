/**
 * Feature 016 (User Story 2 and 3; D11): the parts of a PDF not made by the editor - from its structure when
 * tagged, else from its layout - as an FB2 body: titles open sections by their levels, paragraphs, pictures and
 * tables in reading order.
 */

import { attr, inline } from './fb2';
import { stripWhole } from './ours';
import type { Part, Run } from './parts';

export interface TextBody {
  xml: string;
  counts: { sections: number; pictures: number; tables: number; notes: number };
}

/**
 * `link` maps a run's target to an FB2 reference; `picture` gives the binary id of a picture part or run
 * (null leaves it out).
 */
export function textBody(
  parts: readonly Part[],
  link: (run: Run) => { href: string; note: boolean } | null,
  picture: (page: number, alt: string, readerId?: string) => string | null,
): TextBody {
  const counts = { sections: 0, pictures: 0, tables: 0, notes: 0 };
  const pictureRun = (run: Run): string | null => {
    const id = picture(run.page, run.picture?.alt ?? '');
    if (id) counts.pictures++;
    return id;
  };
  // The sections as a tree first: FB2 lets a section hold either its own text or subsections after its
  // title, never both, and a section must hold more than a title (the library's PDFs, D32).
  interface Section {
    level: number;
    title: string[];
    content: string[];
    children: Section[];
  }
  const top: Section[] = [];
  const open: Section[] = [];
  let inTitle = false;
  const openSection = (level: number): Section => {
    while (open.length && open[open.length - 1].level >= level) open.pop();
    const section: Section = { level, title: [], content: [], children: [] };
    (open.length ? open[open.length - 1].children : top).push(section);
    open.push(section);
    counts.sections++;
    return section;
  };
  for (const part of parts) {
    if (part.kind === 'title') {
      const level = part.level ?? 1;
      const current = open[open.length - 1];
      // Consecutive title lines of one level make one title; a title after text opens a section.
      const section = inTitle && current?.level === level ? current : openSection(level);
      inTitle = true;
      // A title's bold or italic over the whole line is its look, not markup.
      section.title.push(`<p>${inline(stripWhole(part.runs), [], link, pictureRun)}</p>`);
      continue;
    }
    inTitle = false;
    const section = open[open.length - 1] ?? openSection(1);
    if (part.kind === 'figure') {
      const id = picture(part.page, part.alt ?? '', part.readerId);
      if (id) {
        counts.pictures++;
        const alt = part.alt ? ` alt="${attr(part.alt)}"` : '';
        section.content.push(`<image l:href="#${attr(id)}"${alt}/>`);
      }
      // Its caption, a paragraph under it: its words are the book's (D32).
      if (part.caption?.some((run) => run.text.trim()))
        section.content.push(`<p>${inline(part.caption, [], link, pictureRun)}</p>`);
      continue;
    }
    if (part.kind === 'table') {
      // FB2 2.1 wants a cell in every row and a row in every table: a structure's table without them holds
      // nothing to keep (D32's library run: tables of no rows made the book invalid).
      const filled = (part.rows ?? []).filter((row) => row.length > 0);
      if (filled.length === 0) continue;
      counts.tables++;
      const rows = filled.map(
        (row) =>
          `<tr>${row
            .map((cell) => {
              const name = cell.header ? 'th' : 'td';
              const spans = `${cell.colSpan ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : ''}`;
              return `<${name}${spans}>${inline(cell.runs, [], link, pictureRun)}</${name}>`;
            })
            .join('')}</tr>`,
      );
      section.content.push(`<table>${rows.join('')}</table>`);
      continue;
    }
    const lang = part.lang ? ` xml:lang="${attr(part.lang)}"` : '';
    section.content.push(`<p${lang}>${inline(part.runs, [], link, pictureRun)}</p>`);
  }
  // A section's text: one picture may stand at its top, but the text itself starts with a paragraph, a
  // table or an empty line - never a picture (FB2's sectionType) - and is never empty.
  const contentOf = (content: readonly string[]): string => {
    if (content.length === 0) return '<empty-line/>';
    if (!content[0].startsWith('<image')) return content.join('');
    const [top, ...rest] = content;
    return (
      top +
      (rest.length === 0 || rest[0].startsWith('<image') ? '<empty-line/>' : '') +
      rest.join('')
    );
  };
  const render = (section: Section): string => {
    const title = section.title.length ? `<title>${section.title.join('')}</title>` : '';
    let inner: string;
    if (section.children.length === 0) inner = contentOf(section.content);
    else {
      // Its own text before its subsections goes into an untitled first subsection.
      const own = section.content.length ? `<section>${contentOf(section.content)}</section>` : '';
      inner = own + section.children.map(render).join('');
    }
    return `<section>${title}${inner}</section>`;
  };
  const out = top.map(render).join('');
  return { xml: `<body>${out || '<section><empty-line/></section>'}</body>`, counts };
}
