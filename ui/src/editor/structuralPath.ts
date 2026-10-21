/**
 * Structural paths (feature 004, data-model §0.1; research R5.2, R5.3): the document-order path
 * of a structural node in the core's own form - a root prefix (`body[n]`,
 * `title-info/annotation[1]`, `document-info/history[1]`), then `type[i]` segments with
 * 1-based per-type indices among the siblings of one parent - as `node_path()` produces it for
 * validation issues and the `doc.fromXml` remap. One helper serves the status bar
 * (`selectionPath.ts`), the remembered position of "Restore position" (`doc.position`) and the
 * Body <-> Source mapping. Parity with the core is pinned by
 * `tests/fixtures/books/modern-utf8.paths.json` (dumped by `tests/core/test_node_ids.cpp`).
 *
 * `pathOfNode` / `pathOfCaret` read the editor document (window offsets applied);
 * `resolvePosition` walks the Document JSON the controller windows over and applies FR-101's
 * fallback - the same character of the paragraph that now holds that place, clamped - without
 * a message or a log.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

import type { Document } from '@/model/document';

import { FIXED_BLOCK_IDS, fb2NameFor } from './schema';
import type { SectionWindow } from './virtualization';

/** A remembered or mapped place: a structural path and a model offset inside its text block. */
export interface StructuralPosition {
  path: string;
  /** UTF-16 code units of text plus 1 per inline atom, as ProseMirror counts them. */
  offset: number;
}

export interface ResolvedPosition {
  nodeId: string;
  offset: number;
  /** The path named an existing node and the offset was within its content (tests). */
  exact: boolean;
}

/* ------------------------------------------------------------------------ */
/* Editor document -> path                                                  */
/* ------------------------------------------------------------------------ */

/** Root prefix of a depth-1 node of the editor document (`window` offsets applied). */
function rootSegment(
  node: PMNode,
  parent: PMNode,
  indexInParent: number,
  window: SectionWindow | null,
): string {
  if (node.type.name === 'annotation_block') return 'title-info/annotation[1]';
  if (node.type.name === 'history_block') return 'document-info/history[1]';
  if (window && !window.wholeBook) return `body[${window.bodyIndex + 1}]`;
  return `${fb2NameFor(node.type)}[${sameTypeIndex(parent, indexInParent, node.type.name)}]`;
}

/** 1-based index of the child at `index` among the children of `parent` of the same type. */
function sameTypeIndex(parent: PMNode, index: number, typeName: string): number {
  let count = 0;
  for (let i = 0; i <= index && i < parent.childCount; i += 1) {
    if (parent.child(i).type.name === typeName) count += 1;
  }
  return Math.max(1, count);
}

/** Segments of the ancestors of `$pos` (depth 1 .. `$pos.depth`). */
function ancestorSegments(
  $pos: ReturnType<PMNode['resolve']>,
  window: SectionWindow | null,
): string[] {
  const parts: string[] = [];
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const node = $pos.node(depth);
    const parent = $pos.node(depth - 1);
    const indexInParent = $pos.index(depth - 1);
    if (depth === 1) {
      parts.push(rootSegment(node, parent, indexInParent, window));
      continue;
    }
    let index = sameTypeIndex(parent, indexInParent, node.type.name);
    // A windowed body mounts the sections `[start, start + count)`: their indices are shifted.
    if (
      depth === 2 &&
      node.type.name === 'section' &&
      parent.type.name === 'body' &&
      window &&
      !window.wholeBook
    ) {
      index += window.start;
    }
    parts.push(`${fb2NameFor(node.type)}[${index}]`);
  }
  return parts;
}

/**
 * Path of the node at `pos` of the editor document: the node that starts at `pos` when there is
 * one (a block, an image, an inline image, an empty line), else the text block (or container)
 * around the position. `window` supplies the body and section offsets of a windowed view.
 */
export function pathOfNode(state: EditorState, pos: number, window: SectionWindow | null): string {
  const doc = state.doc;
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  const parts = ancestorSegments($pos, window);
  const at = doc.nodeAt(clamped);
  if (at && !at.isText) {
    const parent = $pos.parent;
    const index = $pos.index();
    if (parts.length === 0) {
      // A depth-0 position before a root node: the root itself.
      parts.push(rootSegment(at, parent, index, window));
    } else {
      let sameType = sameTypeIndex(parent, index, at.type.name);
      if (
        $pos.depth === 1 &&
        at.type.name === 'section' &&
        parent.type.name === 'body' &&
        window &&
        !window.wholeBook
      ) {
        sameType += window.start;
      }
      parts.push(`${fb2NameFor(at.type)}[${sameType}]`);
    }
  }
  return parts.join('/');
}

/**
 * Path of the selection head - the text block around a caret, the selected node itself for a
 * node selection (an image, an unknown element) - `body[1]/section[3]/p[12]`, 1-based like the
 * core, window offsets applied. Empty for an empty document.
 */
export function pathOfCaret(state: EditorState, window: SectionWindow | null): string {
  const selection = state.selection as { node?: PMNode; from: number };
  // A selected leaf (image, unknown element) is not an ancestor of the head: name it; a selected
  // container keeps the path of its surroundings, as the status bar always showed it.
  if (selection.node && selection.node.isLeaf && !selection.node.isTextblock) {
    return pathOfNode(state, selection.from, window);
  }
  return ancestorSegments(state.selection.$head, window).join('/');
}

/* ------------------------------------------------------------------------ */
/* Path -> Document JSON node (FR-101)                                      */
/* ------------------------------------------------------------------------ */

interface ModelNodeLike {
  type: string;
  attrs?: { nodeId?: string };
  content?: unknown[];
  text?: string;
}

/** The text containers: a caret offset counts inside one of these. */
const TEXT_CONTAINERS: ReadonlySet<string> = new Set([
  'p',
  'subtitle',
  'text-author',
  'v',
  'td',
  'th',
  'date',
]);

const SEGMENT = /^([a-z-]+)\[([1-9]\d*)\]$/;

function children(node: ModelNodeLike): ModelNodeLike[] {
  return Array.isArray(node.content) ? (node.content as ModelNodeLike[]) : [];
}

function isTextContainer(node: ModelNodeLike): boolean {
  return TEXT_CONTAINERS.has(node.type);
}

/** Model offset size of a text container's inline content (text units plus 1 per atom). */
export function contentSize(node: ModelNodeLike): number {
  let size = 0;
  for (const child of children(node)) {
    if (child.type === 'text') size += (child.text ?? '').length;
    else size += 1; // inline image, inline raw XML: one atom each
  }
  return size;
}

/** The first text container below `node` in document order (`node` itself when it is one). */
function firstTextContainer(node: ModelNodeLike): ModelNodeLike | null {
  if (isTextContainer(node)) return node;
  for (const child of children(node)) {
    if (child.type === 'text') continue;
    const found = firstTextContainer(child);
    if (found) return found;
  }
  return null;
}

function nodeIdOf(node: ModelNodeLike): string {
  return typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : '';
}

/**
 * The document's start (FR-071): the first body's first text block (the body itself when it has
 * none), or the annotation block of a body-less document.
 */
function documentStart(model: Pick<Document, 'bodies'>): ResolvedPosition {
  const body = model.bodies[0];
  if (!body) return { nodeId: FIXED_BLOCK_IDS.annotation, offset: 0, exact: false };
  const text = firstTextContainer(body as ModelNodeLike);
  return { nodeId: nodeIdOf(text ?? (body as ModelNodeLike)), offset: 0, exact: false };
}

/**
 * Resolves a structural path and offset against the document model: walks the path segment by
 * segment with a per-segment clamp to the last sibling of that type; no child of the type at all
 * stops the walk at the node reached; a result that is not a text container descends to its
 * first text block; the offset is clamped to the content size; a root the document no longer
 * has (no such body, no annotation) yields the document's start. Never throws, never logs.
 */
export function resolvePosition(
  model: Pick<Document, 'bodies' | 'description'>,
  position: StructuralPosition,
): ResolvedPosition {
  const segments = position.path.split('/');
  let exact = true;
  let current: ModelNodeLike;
  let rest: string[];
  const first = segments[0] ?? '';
  if (first === 'title-info' || first === 'document-info') {
    const second = segments[1] ?? '';
    const root =
      first === 'title-info' && second === 'annotation[1]'
        ? model.description.titleInfo.annotation
        : first === 'document-info' && second === 'history[1]'
          ? model.description.documentInfo.history
          : undefined;
    if (!root) return documentStart(model);
    current = root as ModelNodeLike;
    rest = segments.slice(2);
  } else {
    const match = SEGMENT.exec(first);
    const body =
      match && match[1] === 'body'
        ? model.bodies[Math.min(Number(match[2]), model.bodies.length) - 1]
        : undefined;
    if (!match || !body) return documentStart(model);
    if (Number(match[2]) > model.bodies.length) exact = false;
    current = body as ModelNodeLike;
    rest = segments.slice(1);
  }

  for (const segment of rest) {
    const match = SEGMENT.exec(segment);
    if (!match) {
      exact = false;
      break;
    }
    const [, type, number] = match;
    const wanted = Number(number);
    const candidates = children(current).filter((child) => child.type === type);
    if (candidates.length === 0) {
      exact = false;
      break; // no child of that type: stop at the node reached
    }
    if (wanted > candidates.length) exact = false;
    current = candidates[Math.min(wanted, candidates.length) - 1]!;
  }

  const text = isTextContainer(current) ? current : firstTextContainer(current);
  if (text && text !== current) exact = false;
  const target = text ?? current;
  const size = text ? contentSize(text) : 0;
  const offset = Math.max(0, Math.min(Math.floor(position.offset) || 0, size));
  if (offset !== position.offset) exact = false;
  const nodeId = nodeIdOf(target);
  if (!nodeId) return documentStart(model);
  return { nodeId, offset, exact };
}
