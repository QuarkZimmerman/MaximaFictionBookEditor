/**
 * Feature 016 (DP-11, research R4): a tagged PDF's structure as the import's parts - each paragraph, title
 * line, picture and table in reading order, with its runs of text (bold, italic, monospaced, links, inline
 * pictures) - and the footnotes apart. Marked content no element refers to (Chromium leaves bold and italic
 * runs out of its tree) is put back after the run before it.
 */

import {
  isElement,
  isLeaf,
  isObjr,
  type StructElement,
  type StructLeaf,
  type StructNode,
} from './model';

export interface Run {
  text: string;
  page: number;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  /** A smaller word raised or lowered against its line (PDFs without structure). */
  sub?: boolean;
  sup?: boolean;
  uri?: string;
  dest?: string;
  picture?: { alt: string };
  lang?: string;
  size?: number;
  top?: number;
  /** Where the run begins and ends on its line, in points: the spaces between runs are not drawn. */
  left?: number;
  right?: number;
}

export interface TableCell {
  runs: Run[];
  header: boolean;
  rowSpan?: number;
  colSpan?: number;
}

export interface Part {
  kind: 'p' | 'title' | 'figure' | 'table';
  page: number;
  runs: Run[];
  /** A title line's heading level (1 to 6). */
  level?: number;
  alt?: string;
  rows?: TableCell[][];
  lang?: string;
  /** A picture's caption: its title, printed under it (D10; tagged as text right after the figure). */
  caption?: Run[];
}

export interface Footnote {
  /** The note's id, from its label's link back to the reference; null for the rest of a cut note. */
  id: string | null;
  label: string;
  page: number;
  paragraphs: Run[][];
}

export interface Flattened {
  parts: Part[];
  footnotes: Footnote[];
}

const HEADING = /^H([1-6])?$/;
const REF_PREFIX = 'mfbe-ref-';

const linkTarget = (element: StructElement): { uri?: string; dest?: string } => {
  for (const kid of element.kids) {
    if (isObjr(kid) && (kid.uri || kid.dest)) return { uri: kid.uri, dest: kid.dest };
  }
  return {};
};

/** The note id a footnote's label leads back to, else null. */
function footnoteLabel(element: StructElement): { id: string; label: string } | null {
  for (const kid of element.kids) {
    if (!isElement(kid) || kid.type !== 'Link') continue;
    const { dest } = linkTarget(kid);
    if (dest?.startsWith(REF_PREFIX)) {
      return { id: dest.slice(REF_PREFIX.length), label: textOf(kid).trim() };
    }
  }
  return null;
}

function textOf(node: StructNode): string {
  if (isLeaf(node)) return node.text;
  if (isElement(node)) return node.kids.map(textOf).join('');
  return '';
}

export function partText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('');
}

export function flatten(
  structure: readonly StructElement[],
  orphans: readonly StructLeaf[] = [],
): Flattened {
  const parts: Part[] = [];
  const footnotes: Footnote[] = [];
  // Where each marked-content run went: the orphans go after the run before them.
  const placed = new Map<string, { list: Run[]; run: Run }>();
  const key = (page: number, mcid: number): string => `${page}:${mcid}`;

  const leafRun = (leaf: StructLeaf, context: Partial<Run>): Run => ({
    text: leaf.text,
    page: leaf.page,
    ...(leaf.bold || context.bold ? { bold: true } : {}),
    ...(leaf.italic || context.italic ? { italic: true } : {}),
    ...(leaf.mono || context.mono ? { mono: true } : {}),
    ...(context.uri ? { uri: context.uri } : {}),
    ...(context.dest ? { dest: context.dest } : {}),
    ...(context.lang ? { lang: context.lang } : {}),
    ...(leaf.size !== undefined ? { size: leaf.size } : {}),
    ...(leaf.top !== undefined ? { top: leaf.top } : {}),
    ...(leaf.left !== undefined ? { left: leaf.left } : {}),
    ...(leaf.right !== undefined ? { right: leaf.right } : {}),
  });

  const runsOf = (node: StructNode, list: Run[], context: Partial<Run>): void => {
    if (isLeaf(node)) {
      const run = leafRun(node, context);
      list.push(run);
      placed.set(key(node.page, node.mcid), { list, run });
      return;
    }
    if (!isElement(node)) return;
    const inner: Partial<Run> = { ...context, ...(node.lang ? { lang: node.lang } : {}) };
    switch (node.type) {
      case 'Link':
        Object.assign(inner, linkTarget(node));
        break;
      case 'Code':
        inner.mono = true;
        break;
      case 'Strong':
        inner.bold = true;
        break;
      case 'Em':
        inner.italic = true;
        break;
      case 'Figure': {
        const page = firstPage(node);
        const leaf = node.kids.find(isLeaf);
        list.push({
          text: '',
          page,
          picture: { alt: node.alt ?? '' },
          ...(leaf?.top !== undefined ? { top: leaf.top } : {}),
          ...(leaf?.left !== undefined ? { left: leaf.left } : {}),
          ...(leaf?.right !== undefined ? { right: leaf.right } : {}),
        });
        return;
      }
      default:
        break;
    }
    for (const kid of node.kids) runsOf(kid, list, inner);
  };

  const firstPage = (node: StructNode): number => {
    if (isLeaf(node) || isObjr(node)) return node.page;
    for (const kid of node.kids) {
      const page = firstPage(kid);
      if (page > 0) return page;
    }
    return 0;
  };

  const block = (element: StructElement): void => {
    const heading = HEADING.exec(element.type);
    if (heading) {
      const level = Number(heading[1] ?? 1);
      // One title line a part: each child holding text (the export tags each line of a title).
      const lines = element.kids.filter((kid) => isElement(kid) && textOf(kid).trim());
      if (lines.length === 0 || element.kids.some(isLeaf)) {
        const runs: Run[] = [];
        runsOf(element, runs, {});
        parts.push({ kind: 'title', page: firstPage(element), runs, level });
        return;
      }
      for (const line of lines) {
        const runs: Run[] = [];
        runsOf(line, runs, element.lang ? { lang: element.lang } : {});
        parts.push({ kind: 'title', page: firstPage(line), runs, level });
      }
      return;
    }
    switch (element.type) {
      case 'P':
      case 'LBody':
      case 'Caption':
      case 'BlockQuote': {
        const runs: Run[] = [];
        runsOf(element, runs, {});
        parts.push({
          kind: 'p',
          page: firstPage(element),
          runs,
          ...(element.lang ? { lang: element.lang } : {}),
        });
        return;
      }
      case 'Figure':
        parts.push({ kind: 'figure', page: firstPage(element), runs: [], alt: element.alt ?? '' });
        return;
      case 'Table': {
        const rows: TableCell[][] = [];
        const walkRows = (node: StructElement): void => {
          for (const kid of node.kids) {
            if (!isElement(kid)) continue;
            if (kid.type === 'TR') {
              rows.push(
                kid.kids.filter(isElement).map((cell) => {
                  const runs: Run[] = [];
                  runsOf(cell, runs, {});
                  const rowSpan = Number(cell.attributes?.RowSpan ?? 1);
                  const colSpan = Number(cell.attributes?.ColSpan ?? 1);
                  return {
                    runs,
                    header: cell.type === 'TH',
                    ...(rowSpan > 1 ? { rowSpan } : {}),
                    ...(colSpan > 1 ? { colSpan } : {}),
                  };
                }),
              );
            } else walkRows(kid);
          }
        };
        walkRows(element);
        parts.push({ kind: 'table', page: firstPage(element), runs: [], rows });
        return;
      }
      case 'Lbl':
        return;
      default:
        break;
    }
    // A footnote: its label's link leads back to the reference; the paragraphs after it are the note.
    const label = footnoteLabel(element);
    if (label) {
      const paragraphs: Run[][] = [];
      for (const kid of element.kids) {
        if (isElement(kid) && kid.type === 'P') {
          const runs: Run[] = [];
          runsOf(kid, runs, {});
          paragraphs.push(runs);
        }
      }
      footnotes.push({ id: label.id, label: label.label, page: firstPage(element), paragraphs });
      return;
    }
    // A container of the footnotes (the foot of a page): its children without a label are the rest of a
    // note cut on the page before.
    if (element.kids.some((kid) => isElement(kid) && footnoteLabel(kid))) {
      for (const kid of element.kids) {
        if (!isElement(kid)) continue;
        if (footnoteLabel(kid)) block(kid);
        else {
          const paragraphs: Run[][] = [];
          const collect = (node: StructElement): void => {
            for (const inner of node.kids) {
              if (!isElement(inner)) continue;
              if (inner.type === 'P') {
                const runs: Run[] = [];
                runsOf(inner, runs, {});
                paragraphs.push(runs);
              } else collect(inner);
            }
          };
          collect(kid);
          if (paragraphs.length)
            footnotes.push({ id: null, label: '', page: firstPage(kid), paragraphs });
        }
      }
      return;
    }
    const kids = element.kids.filter(isElement);
    kids.forEach((kid, index) => {
      const previous = kids[index - 1];
      const last = parts[parts.length - 1];
      // A picture's caption: text, not a paragraph, right after the figure it belongs to.
      if (
        previous?.type === 'Figure' &&
        last?.kind === 'figure' &&
        !last.caption &&
        !HEADING.test(kid.type) &&
        !['P', 'Figure', 'Table', 'Link', 'L'].includes(kid.type) &&
        textOf(kid).trim() &&
        !footnoteLabel(kid)
      ) {
        const runs: Run[] = [];
        runsOf(kid, runs, {});
        last.caption = runs;
        return;
      }
      block(kid);
    });
  };

  for (const element of structure) block(element);

  // The orphans, in reverse order so that each goes right after its predecessor.
  const sorted = [...orphans].sort((a, b) => b.page - a.page || b.mcid - a.mcid);
  for (const orphan of sorted) {
    let before: { list: Run[]; run: Run } | undefined;
    for (let mcid = orphan.mcid - 1; mcid >= 0 && !before; mcid--)
      before = placed.get(key(orphan.page, mcid));
    if (!before) continue;
    const at = before.list.indexOf(before.run);
    const run = leafRun(orphan, {
      ...(before.run.uri ? { uri: before.run.uri } : {}),
      ...(before.run.lang ? { lang: before.run.lang } : {}),
    });
    before.list.splice(at + 1, 0, run);
    placed.set(key(orphan.page, orphan.mcid), { list: before.list, run });
  }
  return { parts, footnotes };
}
