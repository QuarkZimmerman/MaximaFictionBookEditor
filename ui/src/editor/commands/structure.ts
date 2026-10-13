/**
 * Container operations of the Edit menu (T060), after the original editor:
 *
 *  - Clone container (`CloneContainer`): a new empty section / poem / stanza / cite / epigraph of
 *    the same kind right after the current one (sections and poems get an empty title);
 *  - Split container (`SplitContainer`): splits the section or stanza of the caret at the
 *    selection - the text before the caret stays, the selected text becomes the title of the
 *    new section (or the text after the caret starts it), the rest moves into the new one;
 *  - Merge containers (`MergeContainers`): appends the next sibling section / stanza / cite to
 *    the current one - a merged section's title becomes subtitles, its epigraphs / annotation /
 *    image disappear unless the first section has nested sections, in which case the header
 *    items of the merged section move into its first nested section; a merged cite's text
 *    authors become plain paragraphs;
 *  - Remove outer container (`RemoveOuterContainer`): a section that only holds nested sections
 *    is replaced by them.
 *
 * Every operation yields a schema-valid document (the content expressions decide where the
 * commands are enabled).
 */

import { Fragment, Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

import {
  ancestor,
  containerOf,
  emptyParagraph,
  emptyStanza,
  emptyTitle,
  N,
  selectInside,
  type Found,
} from './util';

/* ------------------------------------------------------------------------ */
/* Clone                                                                    */
/* ------------------------------------------------------------------------ */

const CLONABLE = new Set(['section', 'poem', 'stanza', 'cite', 'epigraph']);

function emptyClone(node: PMNode): PMNode {
  const attrs = { lang: node.attrs.lang ?? null };
  switch (node.type.name) {
    case 'section':
      return N.section!.create(attrs, [emptyTitle(), emptyParagraph()]);
    case 'poem':
      return N.poem!.create(attrs, [emptyTitle(), emptyStanza()]);
    case 'stanza':
      return emptyStanza();
    case 'cite':
      return N.cite!.create(attrs, emptyParagraph());
    default:
      return N.epigraph!.create(null, emptyParagraph());
  }
}

export const cloneContainer: Command = (state, dispatch) => {
  const container = containerOf(state);
  if (!container || !CLONABLE.has(container.node.type.name)) return false;
  const $pos = state.doc.resolve(container.pos);
  const index = $pos.index();
  if (!$pos.parent.canReplaceWith(index + 1, index + 1, container.node.type)) return false;
  if (dispatch) {
    const after = container.pos + container.node.nodeSize;
    const tr = state.tr.insert(after, emptyClone(container.node));
    dispatch(selectInside(tr, after).scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------------ */
/* Split                                                                    */
/* ------------------------------------------------------------------------ */

const SPLITTABLE = new Set(['section', 'stanza']);

interface SplitPlan {
  container: Found;
  /** Index of the block holding the selection start. */
  startIndex: number;
  endIndex: number;
}

function splitPlan(state: EditorState): SplitPlan | null {
  const { $from, $to } = state.selection;
  const container = ancestor($from, SPLITTABLE);
  if (!container) return null;
  const depth = container.depth;
  // The whole selection inside this container, in text blocks that are direct children.
  if ($to.pos > container.pos + container.node.nodeSize) return null;
  if ($from.depth !== depth + 1 || $to.depth !== depth + 1) return null;
  if (!$from.parent.isTextblock) return null;
  const startIndex = $from.index(depth);
  const endIndex = $to.index(depth);
  // Nothing before the split point: refuse (as the original: caret at the very start).
  if (startIndex === 0 && $from.parentOffset === 0) return null;
  if (container.node.type === N.stanza && $from.parent.type !== N.v) return null;
  return { container, startIndex, endIndex };
}

export const splitContainer: Command = (state, dispatch) => {
  const plan = splitPlan(state);
  if (!plan) return false;
  const { container, startIndex, endIndex } = plan;
  const node = container.node;
  const { $from, $to, empty } = state.selection;
  const $container = state.doc.resolve(container.pos);
  const parentIndex = $container.index();
  if (!$container.parent.canReplaceWith(parentIndex + 1, parentIndex + 1, node.type)) {
    return false;
  }
  if (dispatch) {
    // Blocks: [0, startIndex) stay; the start block is cut at $from; the selection becomes the
    // title (sections) or is removed (stanzas); the end block's tail and later blocks move.
    const before: PMNode[] = [];
    for (let i = 0; i < startIndex; i += 1) before.push(node.child(i));
    const head = node.child(startIndex).cut(0, $from.parentOffset);
    if (head.content.size > 0) before.push(head);

    const after: PMNode[] = [];
    const tail = node.child(endIndex).cut($to.parentOffset);
    if (tail.content.size > 0) after.push(tail);
    for (let i = endIndex + 1; i < node.childCount; i += 1) after.push(node.child(i));

    const selectedTitle = empty ? '' : state.doc.textBetween($from.pos, $to.pos, '\n', '');

    const newChildren: PMNode[] = [];
    if (node.type === N.section) {
      if (selectedTitle.trim()) {
        newChildren.push(
          N.title!.create(
            null,
            selectedTitle
              .split('\n')
              .map((line) => N.p!.create(null, line ? state.schema.text(line) : undefined)),
          ),
        );
      }
      // A section needs a block: keep at least one paragraph.
      newChildren.push(...(after.length > 0 ? after : [emptyParagraph()]));
    } else {
      const verses = after.filter((child) => child.type === N.v);
      newChildren.push(...(verses.length > 0 ? verses : [N.v!.create()]));
    }
    const newNode = node.type.create({ lang: node.attrs.lang ?? null }, newChildren);

    // Keep the first container valid too (a section must still hold a block).
    const keep = before.length > 0 ? before : [emptyParagraph()];
    if (node.type === N.section && !keep.some((c) => c.type !== N.title))
      keep.push(emptyParagraph());
    const first = node.type.create(node.attrs, keep);

    const tr = state.tr.replaceWith(container.pos, container.pos + node.nodeSize, [first, newNode]);
    const newPos = container.pos + first.nodeSize;
    dispatch(selectInside(tr, newPos).scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------------ */
/* Merge                                                                    */
/* ------------------------------------------------------------------------ */

const MERGEABLE = new Set(['section', 'stanza', 'cite']);

function hasChildSections(section: PMNode): boolean {
  let found = false;
  section.forEach((child) => {
    if (child.type === N.section) found = true;
  });
  return found;
}

function isHeader(node: PMNode): boolean {
  return [N.title, N.epigraph, N.image, N.annotation].includes(node.type);
}

/** Title paragraphs become subtitles (original behaviour when merging sections). */
function titleToSubtitles(title: PMNode): PMNode[] {
  const out: PMNode[] = [];
  title.forEach((child) => {
    if (child.type === N.p)
      out.push(N.subtitle!.create({ id: child.attrs.id, lang: child.attrs.lang }, child.content));
    else out.push(child);
  });
  return out;
}

/** Content of `next` appended to `current` (both sections), per the original rules. */
function mergeSections(current: PMNode, next: PMNode): PMNode {
  const children: PMNode[] = [];
  current.forEach((child) => children.push(child));
  if (!hasChildSections(current)) {
    // Flat section: drop the merged header items except the title (-> subtitles).
    next.forEach((child) => {
      if (child.type === N.title) children.push(...titleToSubtitles(child));
      else if (!isHeader(child)) children.push(child);
    });
    // A section cannot mix blocks and sections: nested sections of `next` are flattened.
    const flat: PMNode[] = [];
    for (const child of children) {
      if (child.type === N.section) flat.push(...flattenSection(child));
      else flat.push(child);
    }
    return current.type.create(current.attrs, flat);
  }
  if (!hasChildSections(next)) {
    // Current has nested sections: `next` becomes one more nested section.
    children.push(next);
    return current.type.create(current.attrs, children);
  }
  // Both have nested sections: the header items of `next` go to its first nested section.
  const headers: PMNode[] = [];
  const sections: PMNode[] = [];
  next.forEach((child) => {
    if (child.type === N.section) sections.push(child);
    else if (isHeader(child)) headers.push(child);
  });
  if (headers.length > 0 && sections.length > 0) {
    const first = sections[0]!;
    const firstChildren: PMNode[] = [];
    first.forEach((child) => firstChildren.push(child));
    sections[0] = first.type.create(first.attrs, mergeHeaders(headers, firstChildren));
  }
  children.push(...sections);
  return current.type.create(current.attrs, children);
}

/** Inserts header items into a section's children respecting title/epigraph/image/annotation order. */
function mergeHeaders(headers: PMNode[], children: PMNode[]): PMNode[] {
  const order = (node: PMNode) =>
    node.type === N.title
      ? 0
      : node.type === N.epigraph
        ? 1
        : node.type === N.image
          ? 2
          : node.type === N.annotation
            ? 3
            : 4;
  const existing = children.filter(isHeader);
  const rest = children.filter((c) => !isHeader(c));
  const merged: PMNode[] = [];
  for (const header of [...headers, ...existing]) {
    const same = merged.find((m) => m.type === header.type && header.type !== N.epigraph);
    if (same) {
      // Join titles / annotations; a second image is dropped.
      if (header.type === N.image) continue;
      const index = merged.indexOf(same);
      merged[index] = same.type.create(same.attrs, same.content.append(header.content));
    } else {
      merged.push(header);
    }
  }
  merged.sort((a, b) => order(a) - order(b));
  return [...merged, ...rest];
}

/** A section flattened to blocks (title -> subtitles, nested sections recursively). */
function flattenSection(section: PMNode): PMNode[] {
  const out: PMNode[] = [];
  section.forEach((child) => {
    if (child.type === N.title) out.push(...titleToSubtitles(child));
    else if (child.type === N.section) out.push(...flattenSection(child));
    else if (!isHeader(child)) out.push(child);
  });
  return out;
}

export const mergeContainers: Command = (state, dispatch) => {
  const container = containerOf(state);
  if (!container || !MERGEABLE.has(container.node.type.name)) return false;
  const $pos = state.doc.resolve(container.pos);
  const next = $pos.parent.maybeChild($pos.index() + 1);
  if (!next || next.type !== container.node.type) return false;
  if (dispatch) {
    const current = container.node;
    let merged: PMNode;
    if (current.type === N.section) {
      merged = mergeSections(current, next);
    } else if (current.type === N.cite) {
      const children: PMNode[] = [];
      current.forEach((child) => {
        // Text authors of the first cite become plain paragraphs (original behaviour).
        children.push(
          child.type === N.text_author
            ? N.p!.create({ id: child.attrs.id, lang: child.attrs.lang }, child.content)
            : child,
        );
      });
      next.forEach((child) => children.push(child));
      merged = current.type.create(current.attrs, children);
    } else {
      const children: PMNode[] = [];
      current.forEach((child) => children.push(child));
      next.forEach((child) => {
        // A merged stanza's title / subtitle lines become verses.
        if (child.type === N.v) children.push(child);
        else if (child.type === N.title) {
          child.forEach((line) => children.push(N.v!.create(null, line.content)));
        } else if (child.type === N.subtitle) {
          children.push(N.v!.create(null, child.content));
        }
      });
      merged = current.type.create(current.attrs, children);
    }
    if (!merged.type.validContent(merged.content)) return false;
    const from = container.pos;
    const to = from + current.nodeSize + next.nodeSize;
    const tr = state.tr.replaceWith(from, to, merged);
    const selectionPos = Math.min(state.selection.from, tr.doc.content.size);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos))).scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------------ */
/* Remove outer container                                                   */
/* ------------------------------------------------------------------------ */

export const removeOuterContainer: Command = (state, dispatch) => {
  const container = containerOf(state);
  if (!container || container.node.type !== N.section || !hasChildSections(container.node)) {
    return false;
  }
  const $pos = state.doc.resolve(container.pos);
  const parent = $pos.parent;
  const sections: PMNode[] = [];
  container.node.forEach((child) => {
    if (child.type === N.section) sections.push(child);
  });
  const index = $pos.index();
  if (!parent.canReplace(index, index + 1, Fragment.from(sections))) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(
      container.pos,
      container.pos + container.node.nodeSize,
      sections,
    );
    const selectionPos = Math.min(state.selection.from, tr.doc.content.size);
    dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos))).scrollIntoView());
  }
  return true;
};
