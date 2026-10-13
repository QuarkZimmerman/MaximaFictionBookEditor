/**
 * Selection analysis for the chrome around the editor (T057/T062): the status-bar element path
 * (`body[1]/section[3]/p[12]`, 1-based like the core), the node id of the selection and the
 * "current element" data shown by the Links bar (ID / Href / Section ID / Image title) and the
 * Table bar (table, row and cell attributes). Pure functions over the editor state; the Body
 * controller publishes the result after every transaction.
 */

import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

import { fb2NameFor } from '../schema';
import type { SectionWindow } from '../virtualization';
import { ancestor } from '../commands/util';

export interface LinkInfo {
  from: number;
  to: number;
  href: string;
  type: string | null;
}

export interface NodeRef {
  pos: number;
  node: PMNode;
}

export interface SelectionContext {
  path: string;
  nodeId: string | null;
  /** Element whose `id` the Links bar edits: the innermost ancestor with an `id` attribute. */
  idElement: NodeRef | null;
  /** Link mark around the caret (or the selected image's href when an image is selected). */
  link: LinkInfo | null;
  section: NodeRef | null;
  /** Selected block or inline image (NodeSelection) or the image around the caret. */
  image: NodeRef | null;
  table: NodeRef | null;
  row: NodeRef | null;
  cell: NodeRef | null;
  /** Selection is empty (caret). */
  empty: boolean;
  /** Selected plain text (for Find "what" prefill). */
  selectedText: string;
}

export const EMPTY_SELECTION_CONTEXT: SelectionContext = {
  path: '',
  nodeId: null,
  idElement: null,
  link: null,
  section: null,
  image: null,
  table: null,
  row: null,
  cell: null,
  empty: true,
  selectedText: '',
};

/** `body[1]/section[3]/p[12]` for the selection head (window offsets applied). */
export function selectionPath(state: EditorState, window: SectionWindow | null): string {
  const $head = state.selection.$head;
  const parts: string[] = [];
  for (let depth = 1; depth <= $head.depth; depth += 1) {
    const node = $head.node(depth);
    const parent = $head.node(depth - 1);
    const indexInParent = $head.index(depth - 1);
    let sameTypeIndex = 0;
    for (let i = 0; i <= indexInParent; i += 1) {
      if (parent.child(i).type === node.type) sameTypeIndex += 1;
    }
    if (window && !window.wholeBook) {
      if (depth === 1) sameTypeIndex = window.bodyIndex + 1;
      if (depth === 2 && node.type.name === 'section') sameTypeIndex += window.start;
    }
    parts.push(`${fb2NameFor(node.type)}[${sameTypeIndex}]`);
  }
  // A selected leaf (image, unknown element) is not an ancestor of the head: append it.
  const selected = selectedNode(state);
  if (selected && !selected.node.isTextblock && selected.node.isLeaf) {
    const parent = $head.parent;
    let sameTypeIndex = 0;
    for (let i = 0; i <= $head.index(); i += 1) {
      if (i < parent.childCount && parent.child(i).type === selected.node.type) sameTypeIndex += 1;
    }
    parts.push(`${fb2NameFor(selected.node.type)}[${Math.max(1, sameTypeIndex)}]`);
  }
  return parts.join('/');
}

/** Nearest ancestor (or the selected node) that carries a nodeId. */
export function selectionNodeId(state: EditorState): string | null {
  const selected = selectedNode(state);
  if (selected && typeof selected.node.attrs.nodeId === 'string' && selected.node.attrs.nodeId) {
    return selected.node.attrs.nodeId;
  }
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth >= 1; depth -= 1) {
    const id = $head.node(depth).attrs.nodeId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/** The node of a NodeSelection, if any. */
export function selectedNode(state: EditorState): NodeRef | null {
  const selection = state.selection as { node?: PMNode; from: number };
  if (selection.node) return { node: selection.node, pos: selection.from };
  return null;
}

/** Link mark touching the caret (inside, or directly before/after it), with its extent. */
export function linkAt(state: EditorState): LinkInfo | null {
  const { $from, empty } = state.selection;
  const linkType = state.schema.marks.link!;
  const marksAt = (marks: readonly Mark[]) => marks.find((m) => m.type === linkType);
  let mark: Mark | undefined;
  if (empty) {
    mark =
      marksAt($from.marks()) ??
      ($from.nodeAfter ? marksAt($from.nodeAfter.marks) : undefined) ??
      ($from.nodeBefore ? marksAt($from.nodeBefore.marks) : undefined);
  } else {
    // A selection counts as linked when its first character carries a link.
    const first = state.doc.nodeAt($from.pos);
    mark = first?.isText ? marksAt(first.marks) : undefined;
    mark ??= marksAt($from.marks());
  }
  if (!mark) return null;
  const extent = markExtent($from.parent, mark, $from.parentOffset);
  const start = $from.start();
  return {
    from: start + extent.from,
    to: start + extent.to,
    href: String(mark.attrs.href ?? ''),
    type: (mark.attrs.type as string | null) ?? null,
  };
}

/** Contiguous run of children of `parent` carrying `mark` around `offset` (parent offsets). */
export function markExtent(
  parent: PMNode,
  mark: Mark,
  offset: number,
): { from: number; to: number } {
  const runs: { from: number; to: number }[] = [];
  parent.forEach((child, childOffset) => {
    if (!child.marks.some((m) => m.eq(mark))) return;
    const last = runs[runs.length - 1];
    if (last && last.to === childOffset) last.to = childOffset + child.nodeSize;
    else runs.push({ from: childOffset, to: childOffset + child.nodeSize });
  });
  return runs.find((run) => run.from <= offset && offset <= run.to) ?? { from: offset, to: offset };
}

/** Innermost ancestor (or selected node) whose type declares an `id` attribute. */
function idElementOf(state: EditorState): NodeRef | null {
  const selected = selectedNode(state);
  if (selected && selected.node.type.spec.attrs?.id) return selected;
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth >= 1; depth -= 1) {
    const node = $head.node(depth);
    if (node.type.spec.attrs?.id) return { node, pos: $head.before(depth) };
  }
  return null;
}

export function computeSelectionContext(
  state: EditorState,
  window: SectionWindow | null,
): SelectionContext {
  const $head = state.selection.$head;
  const selected = selectedNode(state);
  const image =
    selected && (selected.node.type.name === 'image' || selected.node.type.name === 'inline_image')
      ? selected
      : null;
  const section = ancestor($head, ['section']);
  const table = ancestor($head, ['table']);
  const row = ancestor($head, ['tr']);
  const cell = ancestor($head, ['td', 'th']);
  const toRef = (found: { node: PMNode; pos: number } | null): NodeRef | null =>
    found ? { node: found.node, pos: found.pos } : null;
  const link = image
    ? {
        from: image.pos,
        to: image.pos + image.node.nodeSize,
        href: String(image.node.attrs.href ?? ''),
        type: null,
      }
    : linkAt(state);
  return {
    path: selectionPath(state, window),
    nodeId: selectionNodeId(state),
    idElement: idElementOf(state),
    link,
    section: toRef(section),
    image,
    table: toRef(table),
    row: toRef(row),
    cell: toRef(cell),
    empty: state.selection.empty,
    selectedText: state.selection.empty
      ? ''
      : state.doc.textBetween(state.selection.from, state.selection.to, '\n', '\uFFFC'),
  };
}
