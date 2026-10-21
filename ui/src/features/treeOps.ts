/**
 * Document Tree operations on the document model (T083, FR-022), after the original editor's
 * `CMainFrame` tree handlers (reference `FBE/mainfrm.cpp`):
 *
 *  - **Move Right** (`ID_DT_RIGHT_ONE` -> `MoveRightElementWithoutChildren`, mainfrm.cpp
 *    4251-4282): the section becomes the last child of its previous sibling section
 *    (`MoveRightElement`, 4284-4317); its own child sections are then moved out and appended
 *    after it inside the new parent, so only this one node changes depth.
 *  - **Move With Children** ("smart", `ID_DT_RIGHT_SMART` -> `RecoursiveMoveRightElement`,
 *    3125-3187, single selection branch 3169-3185): `MoveRightElement` alone - the section moves
 *    together with its whole subtree. (The multi-selection range mode of the original is not
 *    reproduced: the tree has a single selection.)
 *  - **Move Left** (`ID_DT_LEFT` -> `MoveLeftElement`, 4319-4349): the following siblings of the
 *    section become its children and the section is inserted right after its parent section;
 *    top-level sections of a body cannot be lifted.
 *  - **Merge** (`ID_DT_MERGE` -> `MergeContainers`, mainfrm.cpp 3243-3260 / main.js): the next
 *    sibling section is appended to the selected one with the rules of the Edit menu command
 *    (`editor/commands/structure.ts`): its title becomes subtitles, its epigraphs / image /
 *    annotation disappear unless the first section has nested sections, in which case the next
 *    section (or its nested sections, with its header items moved into the first of them) are
 *    appended as nested sections.
 *  - **Delete** (`ID_DT_DELETE`, 3212-3240): removes the element (the confirmation prompt is the
 *    caller's job).
 *
 * Schema validity (the original produced invalid mixed content at times): when a target section
 * holds text blocks they are first wrapped into a new nested section (`CreateNestedSection`,
 * mainfrm.cpp 4534-4572), and a section that would end up without any section or block gets an
 * empty paragraph. The result of every operation is checked against the ProseMirror schema; an
 * operation that would add a problem is refused (`invalidResult`).
 *
 * The functions are pure: they return a new model, the node to select afterwards and a
 * `ModelStep` (replacement of the smallest changed container by nodeId) so the Body controller
 * records the operation as ONE entry of the `body-model` undo view.
 */

import { createReport, nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { createNodeIdGenerator } from '@/editor/schema';
import type { BodyNode, Document } from '@/model/document';
import type { ModelStep } from '@/views/body/bodyEditor';

export type TreeOp = 'moveRight' | 'moveWithChildren' | 'moveLeft' | 'merge' | 'delete';

export const TREE_OPS: readonly TreeOp[] = [
  'moveRight',
  'moveWithChildren',
  'moveLeft',
  'merge',
  'delete',
];

export type TreeOpFailure =
  | 'notFound'
  | 'notASection'
  | 'noPreviousSibling'
  | 'cannotLift'
  | 'noNextSibling'
  | 'lastSection'
  | 'lastBody'
  | 'cannotDelete'
  | 'invalidResult';

export interface TreeOpSuccess {
  ok: true;
  model: Document;
  /** Node to select in the tree / Body after the operation (null when nothing sensible). */
  selectNodeId: string | null;
  /** Reversible step relative to the current model (for `BodyEditorController.applyModelStep`). */
  step: ModelStep;
}

export interface TreeOpError {
  ok: false;
  reason: TreeOpFailure;
}

export type TreeOpResult = TreeOpSuccess | TreeOpError;

export interface TreeOpOptions {
  /** Generator of nodeIds for the elements an operation creates (wrapper sections, paragraphs). */
  nextId?: () => string;
}

type Json = ModelNodeJson;

const HEADER_TYPES: ReadonlySet<string> = new Set(['title', 'epigraph', 'image', 'annotation']);

/** Element types the tree shows as leaf rows and allows to delete (besides sections/bodies). */
export const DELETABLE_LEAF_TYPES: ReadonlySet<string> = new Set([
  'title',
  'epigraph',
  'annotation',
  'image',
  'poem',
  'cite',
  'table',
  'subtitle',
  'empty-line',
  'p',
  'raw-xml',
]);

const defaultIds = createNodeIdGenerator('tree_');

/* ------------------------------------------------------------------------ */
/* Model helpers                                                            */
/* ------------------------------------------------------------------------ */

export function isSectionJson(node: Json | undefined): boolean {
  return node?.type === 'section';
}

function isHeader(node: Json): boolean {
  return HEADER_TYPES.has(node.type);
}

/** Content block (paragraph, poem, cite, table, image after the header...) of a section. */
function isBlock(node: Json): boolean {
  return !isSectionJson(node) && !isHeader(node);
}

export function nodeIdOf(node: Json | undefined): string | null {
  const id = node?.attrs?.nodeId;
  return typeof id === 'string' && id ? id : null;
}

export function childSections(node: Json): Json[] {
  return (node.content ?? []).filter(isSectionJson);
}

function childBlocks(node: Json): Json[] {
  return (node.content ?? []).filter(isBlock);
}

export interface Located {
  node: Json;
  /** Ancestors from the body (index 0) down to the direct parent of `node`. */
  ancestors: Json[];
  /** Index of `node` within its parent's content (or within `model.bodies` for a body). */
  index: number;
}

/** Depth-first search of `nodeId` in the bodies of the model. */
export function locateNode(model: Pick<Document, 'bodies'>, nodeId: string): Located | null {
  const visit = (node: Json, ancestors: Json[]): Located | null => {
    const content = node.content ?? [];
    for (let i = 0; i < content.length; i += 1) {
      const child = content[i]!;
      if (nodeIdOf(child) === nodeId)
        return { node: child, ancestors: [...ancestors, node], index: i };
      if (child.content && child.type !== 'text') {
        const found = visit(child, [...ancestors, node]);
        if (found) return found;
      }
    }
    return null;
  };
  for (let i = 0; i < model.bodies.length; i += 1) {
    const body = model.bodies[i] as unknown as Json;
    if (nodeIdOf(body) === nodeId) return { node: body, ancestors: [], index: i };
    const found = visit(body, []);
    if (found) return found;
  }
  return null;
}

/**
 * The description block - the title-info annotation or the document-info history - that holds
 * the node `nodeId` (the root node itself included), or null (feature 004, US2: the Body view's
 * blocks and their tree rows).
 */
export function descriptionBlockOf(
  description: Document['description'],
  nodeId: string,
): 'annotation' | 'history' | null {
  const contains = (node: Json | undefined): boolean => {
    if (!node) return false;
    if (nodeIdOf(node) === nodeId) return true;
    return (node.content ?? []).some((child) => child.type !== 'text' && contains(child));
  };
  if (contains(description.titleInfo.annotation as unknown as Json | undefined)) {
    return 'annotation';
  }
  if (contains(description.documentInfo.history as unknown as Json | undefined)) return 'history';
  return null;
}

/** Replaces the node `nodeId` (a body or any descendant) by `replacement`; `null` removes it. */
export function replaceNodeInDocument<D extends Pick<Document, 'bodies'>>(
  model: D,
  nodeId: string,
  replacement: Json | null,
): D {
  const visit = (node: Json): Json => {
    if (!node.content || node.type === 'text') return node;
    let changed = false;
    const content: Json[] = [];
    for (const child of node.content) {
      if (nodeIdOf(child) === nodeId) {
        changed = true;
        if (replacement) content.push(replacement);
        continue;
      }
      const next = visit(child);
      if (next !== child) changed = true;
      content.push(next);
    }
    return changed ? { ...node, content } : node;
  };
  let changed = false;
  const bodies: BodyNode[] = [];
  for (const body of model.bodies) {
    const json = body as unknown as Json;
    if (nodeIdOf(json) === nodeId) {
      changed = true;
      if (replacement) bodies.push(replacement as unknown as BodyNode);
      continue;
    }
    const next = visit(json);
    if (next !== json) changed = true;
    bodies.push(next as unknown as BodyNode);
  }
  return changed ? { ...model, bodies } : model;
}

function withContent(node: Json, content: Json[]): Json {
  return { ...node, content };
}

function emptyParagraph(nextId: () => string): Json {
  return { type: 'p', attrs: { nodeId: nextId() }, content: [] };
}

/**
 * `CreateNestedSection` (mainfrm.cpp 4534-4572): when the section holds text blocks, everything
 * from the first block on is wrapped into a new nested section so that further sections can be
 * appended without mixing blocks and sections.
 */
export function wrapBlocksInSection(section: Json, nextId: () => string = defaultIds): Json {
  const content = section.content ?? [];
  const first = content.findIndex(isBlock);
  if (first < 0) return section;
  const wrapper: Json = {
    type: 'section',
    attrs: { nodeId: nextId() },
    content: content.slice(first),
  };
  return withContent(section, [...content.slice(0, first), wrapper]);
}

/** A section without sections and without blocks gets an empty paragraph (schema: one is required). */
export function ensureSectionContent(section: Json, nextId: () => string = defaultIds): Json {
  if (!isSectionJson(section)) return section;
  if (childSections(section).length > 0 || childBlocks(section).length > 0) return section;
  return withContent(section, [...(section.content ?? []), emptyParagraph(nextId)]);
}

/* ------------------------------------------------------------------------ */
/* Validity                                                                 */
/* ------------------------------------------------------------------------ */

/** Number of schema problems the ProseMirror conversion reports for `node`. */
export function conversionProblems(node: Json): number {
  const report = createReport();
  nodeFromModel(node, report);
  return report.problems.length;
}

/** True when `after` does not introduce schema problems that `before` did not have. */
function staysValid(before: Json, after: Json): boolean {
  return conversionProblems(after) <= conversionProblems(before);
}

function containerStep(containerId: string, before: Json, after: Json): ModelStep {
  return {
    apply: (model) => replaceNodeInDocument(model, containerId, after),
    revert: (model) => replaceNodeInDocument(model, containerId, before),
  };
}

function success(
  model: Document,
  containerId: string,
  before: Json,
  after: Json,
  selectNodeId: string | null,
): TreeOpResult {
  if (!staysValid(before, after)) return { ok: false, reason: 'invalidResult' };
  const step = containerStep(containerId, before, after);
  return { ok: true, model: step.apply(model), selectNodeId, step };
}

/* ------------------------------------------------------------------------ */
/* Operations                                                               */
/* ------------------------------------------------------------------------ */

function previousSectionIndex(parent: Json, index: number): number {
  const content = parent.content ?? [];
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isSectionJson(content[i])) return i;
  }
  return -1;
}

function moveRightImpl(
  model: Document,
  nodeId: string,
  withChildren: boolean,
  options: TreeOpOptions,
): TreeOpResult {
  const nextId = options.nextId ?? defaultIds;
  const located = locateNode(model, nodeId);
  if (!located) return { ok: false, reason: 'notFound' };
  const { node, ancestors, index } = located;
  if (!isSectionJson(node)) return { ok: false, reason: 'notASection' };
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return { ok: false, reason: 'notASection' };
  const prevIndex = previousSectionIndex(parent, index);
  if (prevIndex < 0) return { ok: false, reason: 'noPreviousSibling' };
  const prev = parent.content![prevIndex]!;

  // Make the section the last child of its previous sibling (wrapping that sibling's blocks).
  let target = wrapBlocksInSection(prev, nextId);
  let moved = node;
  let promoted: Json[] = [];
  if (!withChildren) {
    // Move Right (one): the node's own child sections follow it at the new level.
    promoted = childSections(node);
    moved = ensureSectionContent(
      withContent(
        node,
        (node.content ?? []).filter((child) => !isSectionJson(child)),
      ),
      nextId,
    );
  }
  target = withContent(target, [...(target.content ?? []), moved, ...promoted]);

  const content = [...(parent.content ?? [])];
  content[prevIndex] = target;
  content.splice(index, 1);
  const after = withContent(parent, content);
  const containerId = nodeIdOf(parent);
  if (!containerId) return { ok: false, reason: 'notFound' };
  return success(model, containerId, parent, after, nodeId);
}

/** Move Right: the section becomes a child of its previous sibling; its children stay at this level. */
export function moveRight(
  model: Document,
  nodeId: string,
  options: TreeOpOptions = {},
): TreeOpResult {
  return moveRightImpl(model, nodeId, false, options);
}

/** Move With Children ("smart"): the section and its subtree become children of the previous sibling. */
export function moveWithChildren(
  model: Document,
  nodeId: string,
  options: TreeOpOptions = {},
): TreeOpResult {
  return moveRightImpl(model, nodeId, true, options);
}

/** Move Left: lift the section after its parent; the following siblings become its children. */
export function moveLeft(
  model: Document,
  nodeId: string,
  options: TreeOpOptions = {},
): TreeOpResult {
  const nextId = options.nextId ?? defaultIds;
  const located = locateNode(model, nodeId);
  if (!located) return { ok: false, reason: 'notFound' };
  const { node, ancestors, index } = located;
  if (!isSectionJson(node)) return { ok: false, reason: 'notASection' };
  const parent = ancestors[ancestors.length - 1];
  const grandparent = ancestors[ancestors.length - 2];
  if (!parent || !grandparent || !isSectionJson(parent)) return { ok: false, reason: 'cannotLift' };

  const siblings = parent.content ?? [];
  const following = siblings.slice(index + 1);
  let lifted = node;
  if (following.length > 0) {
    lifted = wrapBlocksInSection(lifted, nextId);
    lifted = withContent(lifted, [...(lifted.content ?? []), ...following]);
  }
  const remaining = ensureSectionContent(withContent(parent, siblings.slice(0, index)), nextId);

  const parentIndex = (grandparent.content ?? []).indexOf(parent);
  if (parentIndex < 0) return { ok: false, reason: 'notFound' };
  const content = [...(grandparent.content ?? [])];
  content.splice(parentIndex, 1, remaining, lifted);
  const after = withContent(grandparent, content);
  const containerId = nodeIdOf(grandparent);
  if (!containerId) return { ok: false, reason: 'notFound' };
  return success(model, containerId, grandparent, after, nodeId);
}

/* ---- Merge (port of editor/commands/structure.ts mergeSections to the JSON model) ---- */

function titleToSubtitles(title: Json): Json[] {
  return (title.content ?? []).map((child) =>
    child.type === 'p' ? { ...child, type: 'subtitle' } : child,
  );
}

/** A section flattened to blocks (title -> subtitles, nested sections recursively). */
function flattenSection(section: Json): Json[] {
  const out: Json[] = [];
  for (const child of section.content ?? []) {
    if (child.type === 'title') out.push(...titleToSubtitles(child));
    else if (isSectionJson(child)) out.push(...flattenSection(child));
    else if (!isHeader(child)) out.push(child);
  }
  return out;
}

const HEADER_ORDER: Record<string, number> = { title: 0, epigraph: 1, image: 2, annotation: 3 };

/** Inserts header items into a section's children respecting title/epigraph/image/annotation order. */
function mergeHeaders(headers: Json[], children: Json[]): Json[] {
  const existing = children.filter(isHeader);
  const rest = children.filter((child) => !isHeader(child));
  const merged: Json[] = [];
  for (const header of [...headers, ...existing]) {
    const same =
      header.type === 'epigraph' ? undefined : merged.find((item) => item.type === header.type);
    if (same) {
      if (header.type === 'image') continue; // a second image is dropped
      const at = merged.indexOf(same);
      merged[at] = withContent(same, [...(same.content ?? []), ...(header.content ?? [])]);
    } else {
      merged.push(header);
    }
  }
  merged.sort((a, b) => (HEADER_ORDER[a.type] ?? 4) - (HEADER_ORDER[b.type] ?? 4));
  return [...merged, ...rest];
}

/** Content of `next` appended to `current` (both sections), per the original rules. */
export function mergeSectionsJson(current: Json, next: Json): Json {
  const children = [...(current.content ?? [])];
  if (childSections(current).length === 0) {
    for (const child of next.content ?? []) {
      if (child.type === 'title') children.push(...titleToSubtitles(child));
      else if (!isHeader(child)) children.push(child);
    }
    const flat: Json[] = [];
    for (const child of children) {
      if (isSectionJson(child)) flat.push(...flattenSection(child));
      else flat.push(child);
    }
    return withContent(current, flat);
  }
  if (childSections(next).length === 0) {
    return withContent(current, [...children, next]);
  }
  const headers: Json[] = [];
  const sections: Json[] = [];
  for (const child of next.content ?? []) {
    if (isSectionJson(child)) sections.push(child);
    else if (isHeader(child)) headers.push(child);
  }
  if (headers.length > 0 && sections.length > 0) {
    const first = sections[0]!;
    sections[0] = withContent(first, mergeHeaders(headers, first.content ?? []));
  }
  return withContent(current, [...children, ...sections]);
}

/** Merge: appends the next sibling section to the selected section. */
export function mergeWithNext(
  model: Document,
  nodeId: string,
  options: TreeOpOptions = {},
): TreeOpResult {
  void options;
  const located = locateNode(model, nodeId);
  if (!located) return { ok: false, reason: 'notFound' };
  const { node, ancestors, index } = located;
  if (!isSectionJson(node)) return { ok: false, reason: 'notASection' };
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return { ok: false, reason: 'notASection' };
  const next = parent.content?.[index + 1];
  if (!next || !isSectionJson(next)) return { ok: false, reason: 'noNextSibling' };
  const merged = mergeSectionsJson(node, next);
  const content = [...(parent.content ?? [])];
  content.splice(index, 2, merged);
  const after = withContent(parent, content);
  const containerId = nodeIdOf(parent);
  if (!containerId) return { ok: false, reason: 'notFound' };
  return success(model, containerId, parent, after, nodeId);
}

/** Delete: removes a body, a section or a leaf element shown in the tree. */
export function deleteNode(
  model: Document,
  nodeId: string,
  options: TreeOpOptions = {},
): TreeOpResult {
  const nextId = options.nextId ?? defaultIds;
  const located = locateNode(model, nodeId);
  if (!located) return { ok: false, reason: 'notFound' };
  const { node, ancestors, index } = located;

  if (node.type === 'body') {
    if (model.bodies.length <= 1) return { ok: false, reason: 'lastBody' };
    const removed = model.bodies[index]!;
    const step: ModelStep = {
      apply: (m) => ({
        ...m,
        bodies: m.bodies.filter(
          (body) => body !== removed && nodeIdOf(body as unknown as Json) !== nodeId,
        ),
      }),
      revert: (m) => {
        const bodies = [...m.bodies];
        bodies.splice(Math.min(index, bodies.length), 0, removed);
        return { ...m, bodies };
      },
    };
    const neighbour = model.bodies[index + 1] ?? model.bodies[index - 1];
    return {
      ok: true,
      model: step.apply(model),
      selectNodeId: nodeIdOf(neighbour as unknown as Json),
      step,
    };
  }

  const parent = ancestors[ancestors.length - 1];
  if (!parent) return { ok: false, reason: 'notFound' };
  if (!isSectionJson(node) && !DELETABLE_LEAF_TYPES.has(node.type)) {
    return { ok: false, reason: 'cannotDelete' };
  }
  if (isSectionJson(node) && parent.type === 'body' && childSections(parent).length <= 1) {
    return { ok: false, reason: 'lastSection' };
  }
  const content = [...(parent.content ?? [])];
  content.splice(index, 1);
  const after = ensureSectionContent(withContent(parent, content), nextId);
  const containerId = nodeIdOf(parent);
  if (!containerId) return { ok: false, reason: 'notFound' };
  // Select the following sibling of the same kind (or the previous one, or the parent).
  const sameKind = (candidate: Json | undefined) =>
    candidate && candidate.type === node.type ? nodeIdOf(candidate) : null;
  const select = sameKind(content[index]) ?? sameKind(content[index - 1]) ?? containerId;
  return success(model, containerId, parent, after, select);
}

/* ------------------------------------------------------------------------ */
/* Dispatch / availability                                                  */
/* ------------------------------------------------------------------------ */

export function runTreeOp(
  op: TreeOp,
  model: Document,
  nodeId: string,
  options: TreeOpOptions = {},
): TreeOpResult {
  switch (op) {
    case 'moveRight':
      return moveRight(model, nodeId, options);
    case 'moveWithChildren':
      return moveWithChildren(model, nodeId, options);
    case 'moveLeft':
      return moveLeft(model, nodeId, options);
    case 'merge':
      return mergeWithNext(model, nodeId, options);
    case 'delete':
      return deleteNode(model, nodeId, options);
    default:
      return { ok: false, reason: 'notFound' };
  }
}

/**
 * Cheap enable test (no conversion): the structural preconditions of `op` for `nodeId`. The
 * final schema check happens when the operation runs.
 */
export function canRunTreeOp(op: TreeOp, model: Pick<Document, 'bodies'>, nodeId: string): boolean {
  const located = locateNode(model, nodeId);
  if (!located) return false;
  const { node, ancestors, index } = located;
  const parent = ancestors[ancestors.length - 1];
  switch (op) {
    case 'moveRight':
    case 'moveWithChildren':
      return isSectionJson(node) && !!parent && previousSectionIndex(parent, index) >= 0;
    case 'moveLeft':
      return isSectionJson(node) && !!parent && isSectionJson(parent) && ancestors.length >= 2;
    case 'merge':
      return isSectionJson(node) && !!parent && isSectionJson(parent.content?.[index + 1]);
    case 'delete':
      if (node.type === 'body') return model.bodies.length > 1;
      if (!parent) return false;
      if (isSectionJson(node)) return parent.type !== 'body' || childSections(parent).length > 1;
      return DELETABLE_LEAF_TYPES.has(node.type);
    default:
      return false;
  }
}
