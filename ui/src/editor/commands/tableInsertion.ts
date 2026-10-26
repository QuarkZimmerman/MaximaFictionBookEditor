/**
 * Where a new table goes (feature 006, FR-004; I9; C3, C25, C26; decision 4; data-model §7.1,
 * §7.2; research R2.10): the placement rule of the Body view and the rich fields, on the
 * schema's ordered content expressions, and the transaction that puts a table there.
 *
 * - **(a)** In a `p` or a `subtitle` B whose container C may hold a table there: an empty `p` is
 *   replaced; at offset 0 of a non-empty B the table goes before it; at B's end after it (an
 *   empty `subtitle` lands here, C25); otherwise B is split around it. Text-author, verse, date
 *   and title lines never take (a).
 * - **(b)** Otherwise outwards: at the innermost level - the text block's container, or the
 *   parent of a position between children, from that position's own gap - then at each further
 *   ancestor, the gaps after the child holding the position, in order, never descending; the
 *   first gap that takes a table wins. In a `section` the gaps start after the heading part
 *   (`headingEnd`): without this guard `title, table, image, p` would silently turn a heading
 *   picture into a content picture (C3; the Source view follows the schema alone). The search
 *   ends at the document node: the Body view's never holds a table, a rich field's is the
 *   `annotation` node, searched last.
 * - **(c)** No gap: null - every way to insert is unavailable with `noTablePlace`.
 *
 * The checks build no node (C21: toolbar buttons evaluate them on every revision): they walk
 * the content expression once per level. The module imports only `ui/src/editor/` and the
 * ProseMirror packages (C8). Its consumers: `insert.table` and *Table…*, the placement sweep
 * hook and the paste router (US4, US9).
 */

import {
  Fragment,
  type ContentMatch,
  type Node as PMNode,
  type NodeType,
  type ResolvedPos,
} from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';

import { fb2Schema } from '../schema';

import { selectInside } from './util';

/** Where a table goes: at a gap, splitting a block, or in place of an empty paragraph. */
export type TablePoint =
  | { kind: 'insert'; pos: number }
  | { kind: 'split'; pos: number }
  | { kind: 'replace'; from: number; to: number };

const TABLE = (): NodeType => fb2Schema.nodes.table!;

/**
 * The index after a section's heading part: `title?`, `epigraph*`, `image?`, `annotation?`,
 * read in the content expression's order (`ui/src/editor/schema.ts`, the section's spec).
 */
export function headingEnd(section: PMNode): number {
  const name = (index: number) =>
    index < section.childCount ? section.child(index).type.name : null;
  let index = 0;
  if (name(index) === 'title') index += 1;
  while (name(index) === 'epigraph') index += 1;
  if (name(index) === 'image') index += 1;
  if (name(index) === 'annotation') index += 1;
  return index;
}

/** The content match of `node` after its first `index` children; null for invalid content. */
function matchAfter(node: PMNode, index: number): ContentMatch | null {
  let match: ContentMatch | null = node.type.contentMatch;
  for (let i = 0; i < index && match; i += 1) match = match.matchType(node.child(i).type);
  return match;
}

/** True when the children of `node` from `index` on lead `match` to a valid end. */
function restFits(node: PMNode, match: ContentMatch | null, index: number): boolean {
  const end = match?.matchFragment(node.content, index);
  return !!end && end.validEnd;
}

/**
 * `node.canReplace(from, to, <nodes of these types>)` without building the nodes: the children
 * `[from, to)` replaced by nodes of `types` leave valid content.
 */
function fitsTypes(node: PMNode, from: number, to: number, types: readonly NodeType[]): boolean {
  let match = matchAfter(node, from);
  for (const type of types) match = match?.matchType(type) ?? null;
  return restFits(node, match, to);
}

/**
 * The first gap of `node` at or after `from` where a table may stand, or −1: one walk over the
 * content expression, the rest of the children matched only where a table fits the prefix.
 */
function firstTableGap(node: PMNode, from: number): number {
  const table = TABLE();
  let match = matchAfter(node, from);
  for (let gap = from; gap <= node.childCount && match; gap += 1) {
    const withTable = match.matchType(table);
    if (withTable && restFits(node, withTable, gap)) return gap;
    if (gap < node.childCount) match = match.matchType(node.child(gap).type);
  }
  return -1;
}

/** FR-004 (a): the point at a caret in a `p` or a `subtitle`, when its container takes it. */
function pointInBlock($pos: ResolvedPos): TablePoint | null {
  const block = $pos.parent;
  const name = block.type.name;
  if ((name !== 'p' && name !== 'subtitle') || $pos.depth < 1) return null;
  const depth = $pos.depth;
  const container = $pos.node(depth - 1);
  const index = $pos.index(depth - 1);
  const start = $pos.before(depth);
  const end = start + block.nodeSize;
  const table = TABLE();
  if (name === 'p' && block.content.size === 0) {
    return fitsTypes(container, index, index + 1, [table])
      ? { kind: 'replace', from: start, to: end }
      : null;
  }
  if ($pos.parentOffset === block.content.size) {
    return fitsTypes(container, index + 1, index + 1, [table])
      ? { kind: 'insert', pos: end }
      : null;
  }
  if ($pos.parentOffset === 0) {
    return fitsTypes(container, index, index, [table]) ? { kind: 'insert', pos: start } : null;
  }
  return fitsTypes(container, index, index + 1, [block.type, table, block.type])
    ? { kind: 'split', pos: $pos.pos }
    : null;
}

/** The position before child `index` of the node at `depth` of `$pos`. */
function gapPos($pos: ResolvedPos, depth: number, index: number): number {
  const node = $pos.node(depth);
  let pos = $pos.start(depth);
  for (let i = 0; i < index; i += 1) pos += node.child(i).nodeSize;
  return pos;
}

/**
 * The point FR-004 finds for a position of the host's document (a caret, a selection's end, the
 * gap after a selected node), or null. The paste router needs this form: it deletes the
 * selection first, in the same transaction (data-model §7.1).
 */
export function findTablePoint(doc: PMNode, pos: number): TablePoint | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  const atCaret = pointInBlock($pos);
  if (atCaret) return atCaret;
  let depth: number;
  let from: number;
  if ($pos.parent.isTextblock) {
    if ($pos.depth < 1) return null;
    depth = $pos.depth - 1;
    from = $pos.index(depth) + 1;
  } else {
    depth = $pos.depth;
    from = $pos.index(depth);
  }
  for (; depth >= 0; depth -= 1) {
    const node = $pos.node(depth);
    const start = node.type.name === 'section' ? Math.max(from, headingEnd(node)) : from;
    const gap = firstTableGap(node, start);
    if (gap >= 0) return { kind: 'insert', pos: gapPos($pos, depth, gap) };
    if (depth > 0) from = $pos.index(depth - 1) + 1;
  }
  return null;
}

/**
 * The point at the end of the state's selection: the caret, the end of a text selection, the
 * gap after a selected node, a block's cell. A non-empty selection is left as it is (decision 4).
 */
export function findTablePointAt(state: EditorState): TablePoint | null {
  return findTablePoint(state.doc, state.selection.to);
}

/** The position just before the first table among the nodes inserted at `start`. */
function firstTablePos(nodes: Fragment, start: number): number | null {
  let pos = start;
  for (let i = 0; i < nodes.childCount; i += 1) {
    const child = nodes.child(i);
    if (child.type.name === 'table') return pos;
    pos += child.nodeSize;
  }
  return null;
}

/**
 * Puts `nodes` - a table, or `[caption paragraph, table]` from a paste (data-model §8) - at
 * `point`: `insert` at the gap, `replace` the empty paragraph, `split` the block as Enter splits
 * it (the first half keeps `id`, `style`, `lang` and `nodeId`; the second keeps `style` and
 * `lang`, gets no `id`, and the `nodeId` `nextId()` gives - else none, for the host's
 * `nodeIdPlugin`) and the nodes between the halves; then a caret in the first cell of the first
 * table among them, and `scrollIntoView`.
 */
export function applyTablePoint(
  tr: Transaction,
  point: TablePoint,
  nodes: PMNode | Fragment | readonly PMNode[],
  nextId?: () => string,
): Transaction {
  const content = nodes instanceof Fragment ? nodes : Fragment.from(nodes as PMNode | PMNode[]);
  let start: number;
  if (point.kind === 'insert') {
    tr.insert(point.pos, content);
    start = point.pos;
  } else if (point.kind === 'replace') {
    tr.replaceWith(point.from, point.to, content);
    start = point.from;
  } else {
    const block = tr.doc.resolve(point.pos).parent;
    tr.split(point.pos, 1, [
      { type: block.type, attrs: { ...block.attrs, id: null, nodeId: nextId ? nextId() : null } },
    ]);
    start = point.pos + 1;
    tr.insert(start, content);
  }
  const tablePos = firstTablePos(content, start);
  if (tablePos !== null) selectInside(tr, tablePos);
  else tr.setSelection(TextSelection.near(tr.doc.resolve(start + content.size), -1));
  return tr.scrollIntoView();
}

/**
 * Inserts `table` where FR-004 finds a point at the selection's end, in one transaction; false
 * without a point. A non-empty selection stays in the document (decision 4).
 */
export function insertTableCommand(table: PMNode | Fragment, nextId?: () => string): Command {
  return (state, dispatch) => {
    const point = findTablePointAt(state);
    if (!point) return false;
    if (dispatch) dispatch(applyTablePoint(state.tr, point, table, nextId));
    return true;
  };
}
