/**
 * Shared helpers of the Body editor commands: selection analysis (the FBE notions of
 * "selection container" / `GetCP()` - the structural container of the caret), empty node
 * factories, legal insertion positions and caret placement after an edit.
 *
 * All helpers are pure functions over `EditorState` / `Transaction`; none touches the DOM.
 */

import { Fragment, Node as PMNode, type NodeType, type ResolvedPos } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';

import { fb2Schema } from '../schema';

export const { nodes: N, marks: M } = fb2Schema;

/**
 * Transaction meta key of a discrete step (feature 006, FR-045, data-model §6.3): a
 * transaction carrying `tr.setMeta(DISCRETE_STEP, true)` is one undo step of its own, never
 * merged with the typing before or after it. The hosts honour it - the Body controller closes
 * the history group around it (`bodyEditor.ts`, `applyToEditor`) - so a table command, a
 * paste or a cleared block dispatched by a plugin's handler is exactly one Undo and one Redo,
 * like a command run through the menu.
 */
export const DISCRETE_STEP = 'mfbe-discrete-step';

/**
 * Containers that `GetCP()` recognises (FBE main.js): paragraph-holding block containers, plus
 * the annotation and history blocks of the Body view (feature 004, US2), whose content model
 * is the annotation's.
 */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'annotation_block',
  'history_block',
  'body',
  'section',
  'title',
  'epigraph',
  'annotation',
  'poem',
  'stanza',
  'cite',
  'table',
  'tr',
]);

/** Paragraph-like text blocks (`p`, `subtitle`, `text-author`, `v`). */
export const PARAGRAPH_TYPES: ReadonlySet<string> = new Set(['p', 'subtitle', 'text_author', 'v']);

export interface Found {
  node: PMNode;
  pos: number;
  depth: number;
}

/** Nearest ancestor (including the parent at `$pos.depth`) whose type name is in `names`. */
export function ancestor($pos: ResolvedPos, names: ReadonlySet<string> | string[]): Found | null {
  const set = Array.isArray(names) ? new Set(names) : names;
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth);
    if (set.has(node.type.name)) return { node, pos: depth === 0 ? 0 : $pos.before(depth), depth };
  }
  return null;
}

/** The text block containing `$pos`, if any. */
export function textblock($pos: ResolvedPos): Found | null {
  if (!$pos.parent.isTextblock) return null;
  return { node: $pos.parent, pos: $pos.before($pos.depth), depth: $pos.depth };
}

/**
 * FBE `GetCP()`: the structural container of the caret - the parent of a paragraph; a `title`
 * is skipped so the caret inside a section title yields the section (poem, stanza, body...).
 * `skipTitle: false` keeps the title itself.
 */
export function containerOf(state: EditorState, skipTitle = true): Found | null {
  const $head = state.selection.$head;
  let found = ancestor($head, CONTAINER_TYPES);
  if (found && skipTitle && found.node.type === N.title && found.depth > 0) {
    found = ancestor(state.doc.resolve($head.before(found.depth)), CONTAINER_TYPES);
  }
  return found;
}

/** Nearest `section` around the caret (or the body when the caret is in the body header). */
export function sectionOf(state: EditorState): Found | null {
  return ancestor(state.selection.$head, ['section']);
}

export function bodyOf(state: EditorState): Found | null {
  return ancestor(state.selection.$head, ['body']);
}

/** True when the selection lies in a single text block (no block boundary crossed). */
export function selectionInOneTextblock(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return $from.parent.isTextblock && $from.sameParent($to);
}

/* ------------------------------------------------------------------------ */
/* Node factories                                                           */
/* ------------------------------------------------------------------------ */

export function emptyParagraph(type: NodeType = N.p!): PMNode {
  return type.create();
}

export function paragraphWithText(text: string, type: NodeType = N.p!): PMNode {
  return type.create(null, text ? fb2Schema.text(text) : undefined);
}

export function emptyTitle(lines = 1): PMNode {
  return N.title!.create(
    null,
    Array.from({ length: lines }, () => emptyParagraph()),
  );
}

export function emptyStanza(): PMNode {
  return N.stanza!.create(null, N.v!.create());
}

export function emptyPoem(): PMNode {
  return N.poem!.create(null, [emptyTitle(), emptyStanza()]);
}

export function emptyCite(): PMNode {
  return N.cite!.create(null, emptyParagraph());
}

export function emptyEpigraph(): PMNode {
  return N.epigraph!.create(null, emptyParagraph());
}

export function emptyAnnotation(): PMNode {
  return N.annotation!.create(null, emptyParagraph());
}

export function emptySection(withTitle = true): PMNode {
  const children = withTitle ? [emptyTitle(), emptyParagraph()] : [emptyParagraph()];
  return N.section!.create(null, children);
}

export function emptyBody(name?: string): PMNode {
  return N.body!.create(name ? { name } : null, [emptyTitle(), emptySection(false)]);
}

/* ------------------------------------------------------------------------ */
/* Insertion                                                                */
/* ------------------------------------------------------------------------ */

/** True when `type` may be inserted into `parent` at child `index`. */
export function canInsertAt(parent: PMNode, index: number, type: NodeType): boolean {
  return parent.canReplaceWith(index, index, type);
}

/**
 * Index in `container` of the first child that is not one of `skip` (FBE `SkipOver()`): the
 * position where the next header element (title, epigraph, image, annotation) belongs.
 */
export function indexAfter(container: PMNode, skip: readonly string[]): number {
  let index = 0;
  while (index < container.childCount && skip.includes(container.child(index).type.name)) {
    index += 1;
  }
  return index;
}

/** Absolute document position of child `index` of the node at `containerPos`. */
export function childPos(containerPos: number, container: PMNode, index: number): number {
  let pos = containerPos + 1;
  for (let i = 0; i < index; i += 1) pos += container.child(i).nodeSize;
  return pos;
}

/** First text block position inside `node` (placed at `pos`), or the position itself. */
export function firstTextblockPos(node: PMNode, pos: number): number | null {
  let result: number | null = null;
  if (node.isTextblock) return pos + 1;
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

/** Last text block end position inside `node` (placed at `pos`). */
export function lastTextblockEnd(node: PMNode, pos: number): number | null {
  let result: number | null = null;
  if (node.isTextblock) return pos + 1 + node.content.size;
  node.descendants((child, offset) => {
    if (child.isTextblock) result = pos + 1 + offset + 1 + child.content.size;
    return !child.isTextblock;
  });
  return result;
}

/** Puts the caret at the start of the first text block of the node inserted at `pos`. */
export function selectInside(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!node) return tr;
  const target = firstTextblockPos(node, pos);
  if (target !== null) return tr.setSelection(TextSelection.create(tr.doc, target));
  if (NodeSelection.isSelectable(node)) return tr.setSelection(NodeSelection.create(tr.doc, pos));
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
}

/** Text of a fragment with inline leaves counted as one object character (for offsets). */
export function fragmentText(fragment: Fragment): string {
  let text = '';
  fragment.forEach((child) => {
    text += child.isText ? (child.text ?? '') : '\uFFFC';
  });
  return text;
}

/** Deletes the node at `pos` (if any) in `tr`. */
export function deleteNodeAt(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  return node ? tr.delete(pos, pos + node.nodeSize) : tr;
}

/** Re-resolves a position after the transaction's own mapping. */
export function mapped(tr: Transaction, pos: number, assoc: -1 | 1 = 1): number {
  return tr.mapping.map(pos, assoc);
}
