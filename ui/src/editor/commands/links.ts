/**
 * Links and footnotes (T061) at the ProseMirror level: the `link` mark (`<a l:href>`), the
 * footnote variant (`type="note"`), note sections `n_<N>` in the `notes` body (data-model.md
 * §1.5), and the "Go to footnote or reference" navigation of the original editor
 * (`GoToFootnote` / `GoToReference` in FBEview.cpp).
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';

import { markExtent } from '../plugins/selectionPath';
import { ancestor, emptyParagraph, M, N, paragraphWithText } from './util';

export const NOTES_BODY_NAME = 'notes';
export const NOTE_ID_PREFIX = 'n_';

/* ------------------------------------------------------------------------ */
/* Link mark                                                                */
/* ------------------------------------------------------------------------ */

/** Link mark at the caret and its extent in the document, if any. */
export interface LinkRange {
  from: number;
  to: number;
  href: string;
  type: string | null;
  /** The link's xlink:type as read (feature 006, FR-064); `null` for a link without one. */
  xlinkType: string | null;
}

export function linkRangeAt(state: EditorState): LinkRange | null {
  const { $from, empty } = state.selection;
  const linkType = M.link!;
  const find = (marks: readonly Mark[]) => marks.find((m) => m.type === linkType);
  let mark = find($from.marks());
  if (!mark && $from.nodeAfter) mark = find($from.nodeAfter.marks);
  if (!mark && empty && $from.nodeBefore) mark = find($from.nodeBefore.marks);
  if (!mark) return null;
  const extent = markExtent($from.parent, mark, $from.parentOffset);
  return {
    from: $from.start() + extent.from,
    to: $from.start() + extent.to,
    href: String(mark.attrs.href ?? ''),
    type: (mark.attrs.type as string | null) ?? null,
    xlinkType: (mark.attrs.xlinkType as string | null) ?? null,
  };
}

/** Links can be created on a non-empty inline selection or edited on an existing link. */
export function canCreateLink(state: EditorState): boolean {
  const { $from, $to, empty } = state.selection;
  if (!$from.parent.inlineContent || !$from.sameParent($to)) return false;
  if (!empty) return true;
  return linkRangeAt(state) !== null;
}

/** The first link mark on an inline node of `from`..`to`, if any. */
function firstLinkIn(doc: PMNode, from: number, to: number): Mark | null {
  let found: Mark | null = null;
  doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (node.isInline) found = M.link!.isInSet(node.marks) ?? null;
    return !found;
  });
  return found;
}

/**
 * Applies a link (or footnote link) to the selection / the link run at the caret. A link that
 * replaces an existing one keeps that link's `xlinkType` (feature 006, FR-064); a new link
 * gets none.
 */
export function setLink(href: string, type: string | null = null): Command {
  return (state, dispatch) => {
    if (!canCreateLink(state)) return false;
    if (dispatch) {
      let { from, to } = state.selection;
      let xlinkType: unknown;
      if (state.selection.empty) {
        const range = linkRangeAt(state)!;
        from = range.from;
        to = range.to;
        xlinkType = range.xlinkType;
      } else {
        xlinkType = firstLinkIn(state.doc, from, to)?.attrs.xlinkType ?? null;
      }
      const tr = state.tr.removeMark(from, to, M.link!);
      tr.addMark(from, to, M.link!.create({ href, type, xlinkType }));
      dispatch(tr);
    }
    return true;
  };
}

/** Removes the link marks of the selection (or of the link run at the caret). */
export const removeLink: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  let range: { from: number; to: number } | null = empty ? linkRangeAt(state) : { from, to };
  if (!range) return false;
  if (!empty) {
    let hasLink = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && M.link!.isInSet(node.marks)) hasLink = true;
    });
    if (!hasLink) range = null;
  }
  if (!range) return false;
  if (dispatch) dispatch(state.tr.removeMark(range.from, range.to, M.link!));
  return true;
};

/* ------------------------------------------------------------------------ */
/* Ids and note sections                                                    */
/* ------------------------------------------------------------------------ */

/** All XML `id` attribute values in `doc` (structural nodes). */
export function collectIds(doc: PMNode, into: Set<string> = new Set()): Set<string> {
  doc.descendants((node) => {
    const id = node.attrs?.id;
    if (typeof id === 'string' && id) into.add(id);
    return true;
  });
  return into;
}

/** Next free footnote number: max N of the existing `n_<N>` ids + 1 (collisions skipped). */
export function nextNoteNumber(ids: Iterable<string>): number {
  let max = 0;
  const all = new Set<string>();
  for (const id of ids) {
    all.add(id);
    const match = /^n_(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let n = max + 1;
  while (all.has(`${NOTE_ID_PREFIX}${n}`)) n += 1;
  return n;
}

/** `<section id="n_N"><title><p>N</p></title><p/></section>` */
export function createNoteSection(n: number): PMNode {
  return N.section!.create({ id: `${NOTE_ID_PREFIX}${n}` }, [
    N.title!.create(null, paragraphWithText(String(n))),
    emptyParagraph(),
  ]);
}

/** A notes body with the localised title and one note section. */
export function createNotesBody(title: string, firstNote: PMNode): PMNode {
  return N.body!.create({ name: NOTES_BODY_NAME }, [
    N.title!.create(null, paragraphWithText(title)),
    firstNote,
  ]);
}

/** Position of the `notes` body in the editor document (whole-book mode), if mounted. */
export function findNotesBody(doc: PMNode): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.forEach((child, offset) => {
    if (!found && child.type === N.body && child.attrs.name === NOTES_BODY_NAME) {
      found = { node: child, pos: offset };
    }
  });
  return found;
}

/** Position of the node with XML `id` in `doc`. */
export function findById(doc: PMNode, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs?.id === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Appends a note section to the mounted notes body (creating the body when `notesTitle` is
 * given and no notes body exists). Returns the transaction and the id, or null when the notes
 * body is not part of the editor document (windowed mode: the feature layer edits the model).
 */
export function appendNoteSection(
  tr: Transaction,
  n: number,
  notesTitle: string | null,
): { tr: Transaction; id: string; notePos: number } | null {
  const note = createNoteSection(n);
  const notes = findNotesBody(tr.doc);
  if (notes) {
    const pos = notes.pos + notes.node.nodeSize - 1;
    tr.insert(pos, note);
    return { tr, id: String(note.attrs.id), notePos: pos };
  }
  if (notesTitle === null) return null;
  const body = createNotesBody(notesTitle, note);
  const pos = tr.doc.content.size;
  tr.insert(pos, body);
  // body open + title node + section open
  const notePos = pos + 1 + body.child(0).nodeSize;
  return { tr, id: String(note.attrs.id), notePos };
}

/* ------------------------------------------------------------------------ */
/* Navigation                                                               */
/* ------------------------------------------------------------------------ */

/** Target id (`#id` -> `id`) of the link around the caret or of the selected image. */
export function linkTargetAt(state: EditorState): string | null {
  const selection = state.selection as { node?: PMNode };
  const href = selection.node
    ? String(selection.node.attrs.href ?? '')
    : (linkRangeAt(state)?.href ?? '');
  if (!href.startsWith('#') || href.length < 2) return null;
  return href.slice(1);
}

/** Caret inside the node with `id`: its first text block after a title / image (FBE). */
export function selectionIntoTarget(doc: PMNode, target: { node: PMNode; pos: number }) {
  const { node, pos } = target;
  if (node.isTextblock) return TextSelection.create(doc, pos + 1);
  let textPos: number | null = null;
  let offset = pos + 1;
  node.forEach((child) => {
    if (textPos !== null) return;
    if (child.type === N.title || child.type === N.image) {
      offset += child.nodeSize;
      return;
    }
    const inner = firstTextblockIn(child, offset);
    if (inner !== null) textPos = inner;
    offset += child.nodeSize;
  });
  if (textPos === null) textPos = firstTextblockIn(node, pos);
  return TextSelection.near(doc.resolve(textPos ?? pos));
}

function firstTextblockIn(node: PMNode, pos: number): number | null {
  if (node.isTextblock) return pos + 1;
  let result: number | null = null;
  node.descendants((child, offset) => {
    if (result !== null) return false;
    if (child.isTextblock) {
      result = pos + 1 + offset + 1;
      return false;
    }
    return true;
  });
  return result;
}

/** `GoToFootnote`: jumps to the element the link at the caret points to (within `state.doc`). */
export const gotoFootnote: Command = (state, dispatch) => {
  const id = linkTargetAt(state);
  if (!id) return false;
  const target = findById(state.doc, id);
  if (!target) return false;
  if (dispatch) {
    dispatch(state.tr.setSelection(selectionIntoTarget(state.doc, target)).scrollIntoView());
  }
  return true;
};

/** The id a "Go to reference" would look for: the enclosing section's id (notes bodies). */
export function referenceIdAt(state: EditorState): string | null {
  const section = ancestor(state.selection.$head, ['section']);
  const body = ancestor(state.selection.$head, ['body']);
  if (!section || !body) return null;
  const id = section.node.attrs.id as string | null;
  const bodyName = (body.node.attrs.name as string | null) ?? '';
  if (!id && !['notes', 'comments'].includes(bodyName.toLowerCase())) return null;
  return id;
}

/** Position right after the first link to `#id` in `doc`, or null. */
export function findReference(doc: PMNode, id: string): { from: number; to: number } | null {
  const href = `#${id}`;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.marks.some((m) => m.type === M.link && m.attrs.href === href)) {
      found = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return !node.isText;
  });
  return found;
}

/** `GoToReference`: from a note section back to the text that references it. */
export const gotoReference: Command = (state, dispatch) => {
  const id = referenceIdAt(state);
  if (!id) return false;
  const ref = findReference(state.doc, id);
  if (!ref) return false;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, ref.to)).scrollIntoView());
  }
  return true;
};
