/**
 * Add-menu structure commands (T059), each enabled only where the FB2 content model permits
 * the element (FR-031). The rules follow the original editor's `main.js` (`AddTitle`,
 * `AddEpigraph`, `AddAnnotation`, `AddTA`, `AddImage`, `InsImage`, `InsInlineImage`, `AddBody`)
 * and `FBEview.cpp` (`InsertPoem`, `InsertCite`):
 *
 *  - Title: on the container of the caret (body, section, poem, stanza) when it has none; the
 *    selected text becomes the title line, otherwise an empty line is created;
 *  - Epigraph: body, section or poem, after the existing title/epigraphs; selected paragraphs
 *    move into it;
 *  - Annotation: section only, after title/epigraphs/image, one per section;
 *  - Text author: appended to the enclosing poem / epigraph / cite unless it already ends with one;
 *  - Image: block image after the current paragraph of a section (never the first block);
 *  - Inline image: at the caret inside a paragraph of a section, annotation, title, epigraph,
 *    cite or stanza;
 *  - Section image: the header image of a body or section (after title/epigraphs);
 *  - Poem / Cite: wrap the selected paragraphs (whole paragraphs; blank lines separate stanzas)
 *    in a section, epigraph, annotation or cite (poem) / section, epigraph, annotation (cite);
 *  - Body: a new body with a title and one section appended to the document.
 */

import { Fragment, Node as PMNode, type NodeType } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

import {
  ancestor,
  canInsertAt,
  childPos,
  CONTAINER_TYPES,
  containerOf,
  emptyBody,
  emptyParagraph,
  emptyTitle,
  indexAfter,
  N,
  paragraphWithText,
  selectInside,
  type Found,
} from './util';

export const CLEAR_IMAGE_HREF = '#undefined';

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

/** Selected plain text when the selection lies inside one text block of `container`. */
function selectedTextIn(state: EditorState, container: Found): string {
  const { $from, $to, empty } = state.selection;
  if (empty || !$from.sameParent($to) || !$from.parent.isTextblock) return '';
  if ($from.pos < container.pos || $to.pos > container.pos + container.node.nodeSize) return '';
  return state.doc.textBetween($from.pos, $to.pos, '\n', '');
}

/** Inserts `node` as child `index` of `container`, deletes the selection first if asked. */
function insertChild(
  state: EditorState,
  container: Found,
  index: number,
  node: PMNode,
  deleteSelection: boolean,
) {
  const tr = state.tr;
  if (deleteSelection) tr.deleteSelection();
  const pos = tr.mapping.map(childPos(container.pos, container.node, index), -1);
  tr.insert(pos, node);
  return { tr, pos };
}

/** Paragraph-like blocks covered by the selection within one container. */
interface ParagraphRange {
  container: Found;
  from: number;
  to: number;
  blocks: PMNode[];
  /** Child index of the first selected block. */
  index: number;
}

const WRAP_SOURCE_TYPES = new Set([
  'p',
  'subtitle',
  'empty_line',
  'cite',
  'poem',
  'table',
  'text_author',
  'v',
]);

/**
 * Expands the selection to whole blocks of the nearest container among `parents`
 * (FBE `ExpandTxtRangeToParagraphs`). Null when the selection spans several containers.
 */
export function paragraphRange(
  state: EditorState,
  parents: ReadonlySet<string>,
): ParagraphRange | null {
  const { $from, $to } = state.selection;
  // The nearest container of the caret must be one of `parents` (FBE `GetHP`): inside a cite
  // or a stanza the section above is not considered.
  const container = ancestor($from, CONTAINER_TYPES);
  if (!container || !parents.has(container.node.type.name)) return null;
  const containerEnd = container.pos + container.node.nodeSize;
  if ($to.pos > containerEnd) return null;
  const depth = container.depth;
  if ($from.depth <= depth || $to.depth <= depth) return null;
  const startIndex = $from.index(depth);
  const endIndex = $to.index(depth);
  const blocks: PMNode[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const child = container.node.child(i);
    if (!WRAP_SOURCE_TYPES.has(child.type.name)) return null;
    blocks.push(child);
  }
  return {
    container,
    from: $from.before(depth + 1),
    to: $to.after(depth + 1),
    blocks,
    index: startIndex,
  };
}

/** Text content of a block (nested containers flattened), lines split on paragraphs. */
function blockLines(block: PMNode): PMNode[] {
  const lines: PMNode[] = [];
  if (block.isTextblock) {
    lines.push(block);
  } else if (block.type === N.empty_line) {
    lines.push(block);
  } else {
    block.descendants((child) => {
      if (child.isTextblock) {
        lines.push(child);
        return false;
      }
      return true;
    });
  }
  return lines;
}

/* ------------------------------------------------------------------------ */
/* Title / Epigraph / Annotation / Text author                              */
/* ------------------------------------------------------------------------ */

const TITLE_PARENTS = new Set(['body', 'section', 'poem', 'stanza']);

export const addTitle: Command = (state, dispatch) => {
  const container = containerOf(state);
  if (!container || !TITLE_PARENTS.has(container.node.type.name)) return false;
  const node = container.node;
  const index = node.type === N.body ? indexAfter(node, ['image']) : 0;
  if (node.maybeChild(index)?.type === N.title) return false;
  if (!canInsertAt(node, index, N.title!)) return false;
  if (dispatch) {
    const text = selectedTextIn(state, container);
    const title =
      text && node.type !== N.body
        ? N.title!.create(
            null,
            text.split('\n').map((line) => paragraphWithText(line)),
          )
        : emptyTitle();
    const { tr, pos } = insertChild(state, container, index, title, !!text && node.type !== N.body);
    dispatch(selectInside(tr, pos).scrollIntoView());
  }
  return true;
};

const EPIGRAPH_PARENTS = new Set(['body', 'section', 'poem']);

export const addEpigraph: Command = (state, dispatch) => {
  const container = containerOf(state);
  if (!container || !EPIGRAPH_PARENTS.has(container.node.type.name)) return false;
  const node = container.node;
  const index =
    node.type === N.body
      ? indexAfter(node, ['image', 'title', 'epigraph'])
      : indexAfter(node, ['title', 'epigraph']);
  if (!canInsertAt(node, index, N.epigraph!)) return false;
  if (dispatch) {
    const text = selectedTextIn(state, container);
    const epigraph = N.epigraph!.create(
      null,
      text ? text.split('\n').map((line) => paragraphWithText(line)) : emptyParagraph(),
    );
    const { tr, pos } = insertChild(state, container, index, epigraph, !!text);
    dispatch(selectInside(tr, pos).scrollIntoView());
  }
  return true;
};

export const addAnnotation: Command = (state, dispatch) => {
  const container = containerOf(state);
  if (!container || container.node.type !== N.section) return false;
  const node = container.node;
  const index = indexAfter(node, ['title', 'epigraph', 'image']);
  if (node.maybeChild(index)?.type === N.annotation) return false;
  if (!canInsertAt(node, index, N.annotation!)) return false;
  if (dispatch) {
    const annotation = N.annotation!.create(null, emptyParagraph());
    const { tr, pos } = insertChild(state, container, index, annotation, false);
    dispatch(selectInside(tr, pos).scrollIntoView());
  }
  return true;
};

const TEXT_AUTHOR_PARENTS = new Set(['poem', 'epigraph', 'cite']);

export const addTextAuthor: Command = (state, dispatch) => {
  const container = ancestor(state.selection.$head, TEXT_AUTHOR_PARENTS);
  if (!container) return false;
  const node = container.node;
  // Before a trailing <date> of a poem.
  let index = node.childCount;
  if (index > 0 && node.child(index - 1).type === N.date) index -= 1;
  if (index > 0 && node.child(index - 1).type === N.text_author) return false;
  if (!canInsertAt(node, index, N.text_author!)) return false;
  if (dispatch) {
    const { tr, pos } = insertChild(state, container, index, N.text_author!.create(), false);
    dispatch(selectInside(tr, pos).scrollIntoView());
  }
  return true;
};

/* ------------------------------------------------------------------------ */
/* Images                                                                   */
/* ------------------------------------------------------------------------ */

export interface ImageAttrs {
  href: string;
  alt?: string | null;
  title?: string | null;
}

/** Block image after the current paragraph of a section (`InsImage`). */
export function insertImage(attrs: ImageAttrs = { href: CLEAR_IMAGE_HREF }): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const section = ancestor($from, ['section']);
    if (!section || !$from.parent.isTextblock) return false;
    // The paragraph must be a direct child of the section.
    if ($from.depth !== section.depth + 1) return false;
    const index = $from.index(section.depth) + 1;
    if (!canInsertAt(section.node, index, N.image!)) return false;
    if (dispatch) {
      const pos = $from.after();
      const image = N.image!.create({
        href: attrs.href,
        alt: attrs.alt ?? null,
        title: attrs.title ?? null,
      });
      const tr = state.tr.insert(pos, image);
      dispatch(selectInside(tr, pos).scrollIntoView());
    }
    return true;
  };
}

const INLINE_IMAGE_CONTEXTS = new Set([
  'section',
  'annotation',
  'title',
  'epigraph',
  'cite',
  'stanza',
]);

/** Inline image at the caret (`InsInlineImage`). */
export function insertInlineImage(attrs: ImageAttrs = { href: CLEAR_IMAGE_HREF }): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!$from.parent.inlineContent || !$from.sameParent($to)) return false;
    if ($from.depth < 2 || !INLINE_IMAGE_CONTEXTS.has($from.node($from.depth - 1).type.name)) {
      return false;
    }
    if (!$from.parent.type.contentMatch.matchType(N.inline_image!)) return false;
    if (dispatch) {
      const image = N.inline_image!.create({ href: attrs.href, alt: attrs.alt ?? null });
      const tr = state.tr.replaceSelectionWith(image, false);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

const SECTION_IMAGE_PARENTS = new Set(['body', 'section']);

/** Header image of a body or section (`AddImage`). */
export function addSectionImage(attrs: ImageAttrs = { href: CLEAR_IMAGE_HREF }): Command {
  return (state, dispatch) => {
    const container = containerOf(state);
    if (!container || !SECTION_IMAGE_PARENTS.has(container.node.type.name)) return false;
    const node = container.node;
    const index = node.type === N.body ? 0 : indexAfter(node, ['title', 'epigraph']);
    if (node.maybeChild(index)?.type === N.image) return false;
    if (!canInsertAt(node, index, N.image!)) return false;
    if (dispatch) {
      const image = N.image!.create({
        href: attrs.href,
        alt: attrs.alt ?? null,
        title: attrs.title ?? null,
      });
      const { tr, pos } = insertChild(state, container, index, image, false);
      dispatch(selectInside(tr, pos).scrollIntoView());
    }
    return true;
  };
}

/* ------------------------------------------------------------------------ */
/* Poem / Cite                                                              */
/* ------------------------------------------------------------------------ */

const POEM_PARENTS = new Set(['section', 'epigraph', 'annotation', 'cite']);
const CITE_PARENTS = new Set(['section', 'epigraph', 'annotation']);

/** Selected blocks -> stanzas of verses; empty lines / empty paragraphs separate stanzas. */
function stanzasFrom(blocks: PMNode[]): PMNode[] {
  const stanzas: PMNode[] = [];
  let verses: PMNode[] = [];
  const flush = () => {
    if (verses.length > 0) stanzas.push(N.stanza!.create(null, verses));
    verses = [];
  };
  for (const block of blocks) {
    for (const line of blockLines(block)) {
      if (line.type === N.empty_line || line.textContent.trim() === '') {
        flush();
        continue;
      }
      verses.push(
        N.v!.create(
          { id: line.attrs.id, lang: line.attrs.lang, style: line.attrs.style },
          line.content,
        ),
      );
    }
  }
  flush();
  return stanzas;
}

/** Selected blocks -> cite children (paragraph-like blocks kept, others flattened to `p`). */
function citeContentFrom(blocks: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const block of blocks) {
    const name = block.type.name;
    if (['p', 'subtitle', 'empty_line', 'poem', 'table'].includes(name)) {
      out.push(block);
    } else if (name === 'text_author' || name === 'v') {
      out.push(
        N.p!.create(
          { id: block.attrs.id, lang: block.attrs.lang, style: block.attrs.style },
          block.content,
        ),
      );
    } else {
      for (const line of blockLines(block)) {
        out.push(line.type === N.empty_line ? line : N.p!.create(null, line.content));
      }
    }
  }
  return out;
}

function wrapSelection(
  parents: ReadonlySet<string>,
  type: NodeType,
  build: (blocks: PMNode[]) => PMNode[],
  empty: () => PMNode,
): Command {
  return (state, dispatch) => {
    const range = paragraphRange(state, parents);
    if (!range) return false;
    const { container, index, blocks } = range;
    // A selection (or the caret in an empty paragraph) is replaced by the new container; the
    // caret in a non-empty paragraph inserts the container after it.
    const caretInEmptyBlock =
      state.selection.empty && blocks.length === 1 && blocks[0]!.content.size === 0;
    const replace = !state.selection.empty || caretInEmptyBlock;
    if (replace) {
      if (!container.node.canReplaceWith(index, index + blocks.length, type)) return false;
    } else if (!canInsertAt(container.node, index + 1, type)) {
      return false;
    }
    if (dispatch) {
      const children = state.selection.empty ? [] : build(blocks);
      const node = children.length > 0 ? type.create(null, children) : empty();
      if (!replace) {
        const tr = state.tr.insert(range.to, node);
        dispatch(selectInside(tr, range.to).scrollIntoView());
        return true;
      }
      const tr = state.tr.replaceWith(range.from, range.to, node);
      if (state.selection.empty) {
        dispatch(selectInside(tr, range.from).scrollIntoView());
      } else {
        const end = range.from + node.nodeSize;
        dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(end - 1), -1)).scrollIntoView());
      }
    }
    return true;
  };
}

export const insertPoem: Command = wrapSelection(POEM_PARENTS, N.poem!, stanzasFrom, () =>
  N.poem!.create(null, N.stanza!.create(null, N.v!.create())),
);

export const insertCite: Command = wrapSelection(CITE_PARENTS, N.cite!, citeContentFrom, () =>
  N.cite!.create(null, emptyParagraph()),
);

/* ------------------------------------------------------------------------ */
/* Body                                                                     */
/* ------------------------------------------------------------------------ */

/** Appends a new body (title + one section) to the editor document (whole-book mode). */
export const insertBodyAtEnd: Command = (state, dispatch) => {
  const doc = state.doc;
  if (!canInsertAt(doc, doc.childCount, N.body!)) return false;
  if (dispatch) {
    const pos = doc.content.size;
    const tr = state.tr.insert(pos, emptyBody());
    dispatch(selectInside(tr, pos).scrollIntoView());
  }
  return true;
};

/** JSON-free helper for the feature layer: a fresh body node. */
export function newBodyNode(name?: string): PMNode {
  return emptyBody(name);
}

export { Fragment };
