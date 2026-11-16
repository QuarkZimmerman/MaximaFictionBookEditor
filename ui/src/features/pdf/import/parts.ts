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
  /** Its first character's left and its last character's right (the reader's startLeft, endRight). */
  startLeft?: number;
  endRight?: number;
  /** Its first character's top and its last character's top (the reader's startTop, endTop). */
  startTop?: number;
  endTop?: number;
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
  /** The reader's id of a picture the layout placed (PDFs without structure). */
  readerId?: string;
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
  // Every marked-content run in the order of the structure, and each part's place among them: the number of
  // runs before it. An element whose content the reader could not reach is an empty part at its place.
  const leaves: { page: number; mcid: number; list: Run[]; run: Run }[] = [];
  const slotOf = new Map<Part, number>();
  const add = (part: Part): void => {
    slotOf.set(part, leaves.length);
    parts.push(part);
  };

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
    ...(leaf.startLeft !== undefined ? { startLeft: leaf.startLeft } : {}),
    ...(leaf.endRight !== undefined ? { endRight: leaf.endRight } : {}),
    ...(leaf.startTop !== undefined ? { startTop: leaf.startTop } : {}),
    ...(leaf.endTop !== undefined ? { endTop: leaf.endTop } : {}),
  });

  const runsOf = (node: StructNode, list: Run[], context: Partial<Run>): void => {
    if (isLeaf(node)) {
      const run = leafRun(node, context);
      list.push(run);
      placed.set(key(node.page, node.mcid), { list, run });
      leaves.push({ page: node.page, mcid: node.mcid, list, run });
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
        add({ kind: 'title', page: firstPage(element), runs, level });
        return;
      }
      for (const line of lines) {
        const runs: Run[] = [];
        runsOf(line, runs, element.lang ? { lang: element.lang } : {});
        add({ kind: 'title', page: firstPage(line), runs, level });
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
        add({
          kind: 'p',
          page: firstPage(element),
          runs,
          ...(element.lang ? { lang: element.lang } : {}),
        });
        return;
      }
      case 'Figure':
        add({ kind: 'figure', page: firstPage(element), runs: [], alt: element.alt ?? '' });
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
        add({ kind: 'table', page: firstPage(element), runs: [], rows });
        return;
      }
      case 'Lbl':
        return;
      case 'LI': {
        // A list item: its text without its label (FB2 has no lists; each item is a paragraph).
        const body = element.kids.filter((kid) => !(isElement(kid) && kid.type === 'Lbl'));
        if (body.some((kid) => isElement(kid) && kid.type === 'LBody')) break;
        const runs: Run[] = [];
        for (const kid of body) runsOf(kid, runs, {});
        if (runs.some((run) => run.text.trim()))
          add({
            kind: 'p',
            page: firstPage(element),
            runs,
            ...(element.lang ? { lang: element.lang } : {}),
          });
        return;
      }
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

  // The orphans: marked content the structure holds but the reader could not reach - Poppler drops the
  // elements of types it does not know, such as PDF 2.0's Strong and Em that Chromium writes for bold and
  // italic (D32's library run: every bold title came back empty). Each is placed by its marked content's
  // order among the runs: an element left empty between its neighbours takes it - the orphans of one line
  // together, line by line, element by element; else it joins its neighbours' text, before the next run
  // when it stands on that run's line and not on the previous one's, else after the previous run.
  const order = (page: number, mcid: number): number => page * 1_000_000 + mcid;
  const sortedLeaves = [...leaves].sort((a, b) => order(a.page, a.mcid) - order(b.page, b.mcid));
  const slotFor = (orphan: StructLeaf): number => {
    const at = order(orphan.page, orphan.mcid);
    let low = 0;
    let high = sortedLeaves.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (order(sortedLeaves[middle].page, sortedLeaves[middle].mcid) < at) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const empty = (part: Part): boolean =>
    (part.kind === 'title' || part.kind === 'p') &&
    !part.runs.some((run) => run.text.trim() || run.picture);
  const emptiesAt = new Map<number, Part[]>();
  for (const part of parts) {
    // An empty part's place in the sorted runs: the runs of the structure before it.
    const slot = slotOf.get(part);
    if (slot === undefined || !empty(part)) continue;
    const before = slot > 0 ? leaves[slot - 1] : undefined;
    const sortedSlot = before ? sortedLeaves.indexOf(before) + 1 : 0;
    emptiesAt.set(sortedSlot, [...(emptiesAt.get(sortedSlot) ?? []), part]);
  }
  const orphansAt = new Map<number, StructLeaf[]>();
  for (const orphan of [...orphans].sort((a, b) => order(a.page, a.mcid) - order(b.page, b.mcid))) {
    const slot = slotFor(orphan);
    orphansAt.set(slot, [...(orphansAt.get(slot) ?? []), orphan]);
  }
  const sameLine = (a: { top?: number }, b: { top?: number }): boolean =>
    a.top !== undefined && b.top !== undefined && Math.abs(a.top - b.top) < 2;
  const level = (a: number | undefined, b: number | undefined): boolean =>
    a !== undefined && b !== undefined && Math.abs(a - b) < 2;
  for (const [slot, group] of orphansAt) {
    const empties = emptiesAt.get(slot) ?? [];
    if (empties.length > 0) {
      const lines: StructLeaf[][] = [];
      for (const orphan of group) {
        const line = lines[lines.length - 1];
        if (line && line[0].page === orphan.page && sameLine(line[0], orphan)) line.push(orphan);
        else lines.push([orphan]);
      }
      lines.forEach((line, index) => {
        const part = empties[Math.min(index, empties.length - 1)];
        if (!part.page) part.page = line[0].page;
        for (const orphan of line)
          part.runs.push(leafRun(orphan, part.lang ? { lang: part.lang } : {}));
      });
      continue;
    }
    const previous = slot > 0 ? sortedLeaves[slot - 1] : undefined;
    const next = sortedLeaves[slot];
    let after: { list: Run[]; run: Run } | undefined = previous;
    for (const orphan of group) {
      const onNext =
        next &&
        next.page === orphan.page &&
        // Where it ends against where the next run begins, and where the previous run ends against where it
        // begins: an orphan over several lines (a paragraph's first words in italic) is judged by its ends.
        level(orphan.endTop ?? orphan.top, next.run.startTop ?? next.run.top) &&
        !(
          previous &&
          previous.page === orphan.page &&
          level(previous.run.endTop ?? previous.run.top, orphan.startTop ?? orphan.top)
        );
      if (onNext) {
        const run = leafRun(orphan, {
          ...(next.run.uri ? { uri: next.run.uri } : {}),
          ...(next.run.lang ? { lang: next.run.lang } : {}),
        });
        next.list.splice(next.list.indexOf(next.run), 0, run);
        continue;
      }
      if (!after) continue;
      const run = leafRun(orphan, {
        ...(after.run.uri ? { uri: after.run.uri } : {}),
        ...(after.run.lang ? { lang: after.run.lang } : {}),
      });
      after.list.splice(after.list.indexOf(after.run) + 1, 0, run);
      after = { list: after.list, run };
    }
  }
  return { parts, footnotes };
}
