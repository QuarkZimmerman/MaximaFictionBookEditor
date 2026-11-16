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
  let out = '';
  const depths: number[] = [];
  let inTitle = false;
  let titleLevel = 0;
  let sectionHasContent = false;
  const closeTitle = (): void => {
    if (inTitle) out += '</title>';
    inTitle = false;
  };
  const openSection = (level: number): void => {
    closeTitle();
    // A section holds more than its title (FB2): one that got nothing else gets an empty line.
    if (depths.length && !sectionHasContent && depths[depths.length - 1] >= level)
      out += '<empty-line/>';
    while (depths.length && depths[depths.length - 1] >= level) {
      out += '</section>';
      depths.pop();
    }
    if (depths.length && !sectionHasContent) sectionHasContent = true; // its subsection is its content
    out += '<section>';
    depths.push(level);
    counts.sections++;
    sectionHasContent = false;
  };
  for (const part of parts) {
    if (part.kind === 'title') {
      const level = part.level ?? 1;
      // Consecutive title lines of one level make one title; a title after text opens a section.
      if (!(inTitle && level === titleLevel)) {
        openSection(level);
        out += '<title>';
        inTitle = true;
        titleLevel = level;
      }
      // A title's bold or italic over the whole line is its look, not markup.
      out += `<p>${inline(stripWhole(part.runs), [], link, pictureRun)}</p>`;
      continue;
    }
    closeTitle();
    if (depths.length === 0) openSection(1);
    sectionHasContent = true;
    if (part.kind === 'figure') {
      const id = picture(part.page, part.alt ?? '', part.readerId);
      if (id) {
        counts.pictures++;
        const alt = part.alt ? ` alt="${attr(part.alt)}"` : '';
        out += `<image l:href="#${attr(id)}"${alt}/>`;
      }
      continue;
    }
    if (part.kind === 'table') {
      counts.tables++;
      const rows = (part.rows ?? []).map(
        (row) =>
          `<tr>${row
            .map((cell) => {
              const name = cell.header ? 'th' : 'td';
              const spans = `${cell.colSpan ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : ''}`;
              return `<${name}${spans}>${inline(cell.runs, [], link, pictureRun)}</${name}>`;
            })
            .join('')}</tr>`,
      );
      out += `<table>${rows.join('')}</table>`;
      continue;
    }
    const lang = part.lang ? ` xml:lang="${attr(part.lang)}"` : '';
    out += `<p${lang}>${inline(part.runs, [], link, pictureRun)}</p>`;
  }
  closeTitle();
  // A section must hold more than a title (FB2): an empty one gets an empty line.
  if (!sectionHasContent && depths.length) out += '<empty-line/>';
  while (depths.length) {
    out += '</section>';
    depths.pop();
  }
  return { xml: `<body>${out || '<section><empty-line/></section>'}</body>`, counts };
}
