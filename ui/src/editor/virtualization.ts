/**
 * Section windowing for the Body view (T049; T069 hardens it around the caret/tree selection).
 *
 * ProseMirror keeps the whole editor document in the DOM, so a large book is never mounted
 * completely: the editor document holds *one body* with its header (image/title/epigraphs)
 * and a window of `count` consecutive top-level sections starting at `start`. Small books
 * (total top-level sections of all bodies <= 2 x windowSize) use **whole-book mode**: every
 * body with all its sections, exactly as the original editor showed them.
 *
 * `createWindow()` builds the editor document for a window, `extendWindow()` grows it towards
 * the hidden sections ("... N more sections" placeholders), `replaceSectionsInModel()` writes
 * an edited window back into the document model, and `windowAround()` / `locateSection()`
 * position a window on the section that contains a given nodeId (navigation, caret restore).
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { BodyNode, Document, SectionNode } from '@/model/document';

import {
  bodyFromModel,
  createReport,
  docFromBodies,
  docFromModel,
  type ConversionReport,
} from './fromModel';
import { fb2Schema, nodeTypeFor } from './schema';
import { bodyToModel, docToBodies } from './toModel';

export const DEFAULT_WINDOW_SIZE = 20;

/**
 * Content budget of a freshly positioned window (T150): the number of element nodes
 * (paragraphs, titles, containers... text excluded) the mounted sections may hold together.
 * A window is `windowSize` sections for ordinary books and fewer when sections are huge
 * (a 10 MB book with 120 long paragraphs per section mounts 4 sections, not 20), which keeps
 * tree navigation and the first paint under the 100 ms / 3 s budgets.
 */
export const WINDOW_NODE_BUDGET = 600;

/** Books above this many element nodes are always windowed, whatever their section count. */
export const WHOLE_BOOK_NODE_BUDGET = 10_000;

export interface WindowSpec {
  bodyIndex: number;
  /** Index of the first mounted top-level section within the body's sections. */
  start: number;
  /** Number of mounted top-level sections. */
  count: number;
}

export interface SectionWindow extends WindowSpec {
  /** Every body fully mounted (small documents). */
  wholeBook: boolean;
  /** Top-level sections of the active body (windowed mode) or of all bodies (whole book). */
  totalSections: number;
  /** Hidden sections before / after the window (0 in whole-book mode). */
  before: number;
  after: number;
  /** Number of bodies in the model. */
  bodyCount: number;
  doc: PMNode;
  report: ConversionReport;
}

export interface WindowOptions extends Partial<WindowSpec> {
  windowSize?: number;
  /** Force windowed mode even for small books (tests, Fast mode experiments). */
  forceWindowed?: boolean;
}

type BodyChild = BodyNode['content'][number];

function isSection(child: BodyChild): child is SectionNode {
  return child.type === 'section';
}

/** Number of top-level sections of a body. */
export function countSections(body: BodyNode | undefined): number {
  if (!body) return 0;
  return body.content.filter(isSection).length;
}

/** Top-level sections of all bodies. */
export function totalSectionCount(model: Pick<Document, 'bodies'>): number {
  return model.bodies.reduce((sum, body) => sum + countSections(body), 0);
}

/* ------------------------------------------------------------------------ */
/* Content weights                                                          */
/* ------------------------------------------------------------------------ */

interface WeightedNode {
  type: string;
  content?: unknown[];
}

/** Memoised per model object: the model is immutable, edited nodes are new objects. */
const weights = new WeakMap<object, number>();

/** Number of element nodes (text excluded) in the subtree of `node`, including itself. */
export function nodeWeight(node: WeightedNode): number {
  if (node.type === 'text') return 0;
  const cached = weights.get(node);
  if (cached !== undefined) return cached;
  let total = 1;
  for (const child of (node.content ?? []) as WeightedNode[]) total += nodeWeight(child);
  weights.set(node, total);
  return total;
}

/** Element nodes of the whole model (all bodies). */
export function modelWeight(model: Pick<Document, 'bodies'>): number {
  return model.bodies.reduce((sum, body) => sum + nodeWeight(body), 0);
}

/**
 * Number of consecutive top-level sections of `body`, starting at `start` and walking
 * forwards (`after`) or backwards (`before`, from `start - 1` down), that fit the node budget:
 * at least one (a single oversized section is mounted alone), at most `max`.
 */
export function fitSections(
  body: BodyNode | undefined,
  start: number,
  max: number,
  direction: 'after' | 'before' = 'after',
  budget: number = WINDOW_NODE_BUDGET,
): number {
  if (!body || max <= 0) return 0;
  const sections = body.content.filter(isSection);
  let count = 0;
  let weight = 0;
  for (let step = 0; step < max; step += 1) {
    const index = direction === 'after' ? start + step : start - 1 - step;
    const section = sections[index];
    if (!section) break;
    const next = weight + nodeWeight(section);
    if (count > 0 && next > budget) break;
    weight = next;
    count += 1;
  }
  return count;
}

/** Whole-book mode applies when the book is small enough to mount completely. */
export function isWholeBook(
  model: Pick<Document, 'bodies'>,
  windowSize: number = DEFAULT_WINDOW_SIZE,
): boolean {
  return totalSectionCount(model) <= 2 * windowSize && modelWeight(model) <= WHOLE_BOOK_NODE_BUDGET;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Builds a body node holding the header children plus the sections `[start, start + count)`. */
function windowedBody(
  body: BodyNode,
  bodyIndex: number,
  start: number,
  count: number,
  report: ConversionReport,
): PMNode {
  const header = body.content.filter((child) => !isSection(child));
  const sections = body.content.filter(isSection).slice(start, start + count);
  const partial: BodyNode = { ...body, content: [...header, ...sections] };
  return bodyFromModel(partial, report, `bodies[${bodyIndex + 1}]`);
}

/** Creates the editor document for the requested window (clamped to the model). */
export function createWindow(
  model: Pick<Document, 'bodies'>,
  options: WindowOptions = {},
): SectionWindow {
  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
  const bodyCount = model.bodies.length;

  if (!options.forceWindowed && isWholeBook(model, windowSize)) {
    const { node, report } = docFromModel(model);
    const total = totalSectionCount(model);
    return {
      wholeBook: true,
      bodyIndex: clamp(options.bodyIndex ?? 0, 0, Math.max(0, bodyCount - 1)),
      start: 0,
      count: total,
      totalSections: total,
      before: 0,
      after: 0,
      bodyCount,
      doc: node,
      report,
    };
  }

  const bodyIndex = clamp(options.bodyIndex ?? 0, 0, Math.max(0, bodyCount - 1));
  const body = model.bodies[bodyIndex];
  const total = countSections(body);
  const start = clamp(options.start ?? 0, 0, Math.max(0, total));
  // A fresh window (no explicit count) is bounded by the node budget as well as windowSize.
  const count = clamp(options.count ?? fitSections(body, start, windowSize), 0, total - start);
  const report = createReport();
  const doc = body
    ? docFromBodies([windowedBody(body, bodyIndex, start, count, report)])
    : docFromBodies([]);
  return {
    wholeBook: false,
    bodyIndex,
    start,
    count,
    totalSections: total,
    before: start,
    after: total - start - count,
    bodyCount,
    doc,
    report,
  };
}

/** The window never holds more than this many times `windowSize` sections (T069). */
export const MAX_WINDOW_FACTOR = 3;

/**
 * Grows the window by up to `by` sections towards the hidden ones (no-op in whole-book mode);
 * the step is bounded by the node budget like a fresh window. When the window would exceed
 * `MAX_WINDOW_FACTOR` times what a fresh window holds at its start (at most
 * `MAX_WINDOW_FACTOR x windowSize` sections), the far end is unmounted so the DOM stays
 * bounded while the user scrolls through a large book.
 */
export function extendWindow(
  model: Pick<Document, 'bodies'>,
  window: SectionWindow,
  direction: 'before' | 'after',
  by: number = DEFAULT_WINDOW_SIZE,
  options: Pick<WindowOptions, 'windowSize' | 'forceWindowed'> = {},
): SectionWindow {
  if (window.wholeBook) return window;
  const body = model.bodies[window.bodyIndex];
  const grow = Math.max(
    1,
    direction === 'after'
      ? fitSections(body, window.start + window.count, by)
      : fitSections(body, window.start, by, 'before'),
  );
  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
  let start = direction === 'before' ? Math.max(0, window.start - grow) : window.start;
  let end =
    direction === 'after' ? window.start + window.count + grow : window.start + window.count;
  const limit = MAX_WINDOW_FACTOR * Math.max(1, fitSections(body, start, windowSize));
  if (end - start > limit) {
    if (direction === 'after') start = end - limit;
    else end = start + limit;
  }
  return createWindow(model, {
    ...options,
    forceWindowed: options.forceWindowed ?? true,
    bodyIndex: window.bodyIndex,
    start,
    count: end - start,
  });
}

/** The header children and mounted sections of a windowed body (by reference). */
function windowSlice(model: Pick<Document, 'bodies'>, window: SectionWindow): BodyChild[] {
  if (window.wholeBook) return model.bodies as unknown as BodyChild[];
  const body = model.bodies[window.bodyIndex];
  if (!body) return [];
  const header = body.content.filter((child) => !isSection(child));
  const sections = body.content.filter(isSection).slice(window.start, window.start + window.count);
  return [...header, ...sections];
}

/**
 * True when the content mounted by `window` is the same (same node objects) in `previous` and
 * `next`: the change happened elsewhere (another body, unmounted sections) and the editor
 * state can be kept, together with its history.
 */
export function windowSliceUnchanged(
  previous: Pick<Document, 'bodies'>,
  next: Pick<Document, 'bodies'>,
  window: SectionWindow,
): boolean {
  if (window.wholeBook) {
    return (
      previous.bodies.length === next.bodies.length &&
      previous.bodies.every((body, index) => body === next.bodies[index])
    );
  }
  const before = windowSlice(previous, window);
  const after = windowSlice(next, window);
  const bodyBefore = previous.bodies[window.bodyIndex];
  const bodyAfter = next.bodies[window.bodyIndex];
  if (!bodyBefore || !bodyAfter) return false;
  // The body's own attributes (name, id, lang) are part of the mounted body node.
  if (
    bodyBefore.attrs !== bodyAfter.attrs &&
    JSON.stringify(bodyBefore.attrs) !== JSON.stringify(bodyAfter.attrs)
  ) {
    return false;
  }
  return before.length === after.length && before.every((child, index) => child === after[index]);
}

/** Recomputes the counters of `window` for `model` (after a change outside the window). */
export function windowCounts(
  model: Pick<Document, 'bodies'>,
  window: SectionWindow,
): Pick<SectionWindow, 'totalSections' | 'before' | 'after' | 'bodyCount' | 'count'> {
  if (window.wholeBook) {
    const total = totalSectionCount(model);
    return {
      totalSections: total,
      before: 0,
      after: 0,
      bodyCount: model.bodies.length,
      count: total,
    };
  }
  const total = countSections(model.bodies[window.bodyIndex]);
  const count = Math.min(window.count, Math.max(0, total - window.start));
  return {
    totalSections: total,
    before: window.start,
    after: Math.max(0, total - window.start - count),
    bodyCount: model.bodies.length,
    count,
  };
}

/** Finds the body and top-level section that contain the node with `nodeId`. */
export function locateSection(
  model: Pick<Document, 'bodies'>,
  nodeId: string,
): { bodyIndex: number; sectionIndex: number } | null {
  const contains = (node: { attrs?: { nodeId?: string }; content?: unknown[] }): boolean => {
    if (node.attrs?.nodeId === nodeId) return true;
    const children = (node.content ?? []) as { attrs?: { nodeId?: string }; content?: unknown[] }[];
    return children.some((child) => contains(child));
  };
  for (let bodyIndex = 0; bodyIndex < model.bodies.length; bodyIndex += 1) {
    const body = model.bodies[bodyIndex]!;
    if (body.attrs.nodeId === nodeId) return { bodyIndex, sectionIndex: 0 };
    let sectionIndex = 0;
    for (const child of body.content) {
      if (isSection(child)) {
        if (contains(child)) return { bodyIndex, sectionIndex };
        sectionIndex += 1;
      } else if (contains(child)) {
        return { bodyIndex, sectionIndex: 0 }; // header element: the window starts at the top
      }
    }
  }
  return null;
}

/** A window centred on the section containing `nodeId`; null when the node is unknown. */
export function windowAround(
  model: Pick<Document, 'bodies'>,
  nodeId: string,
  options: Pick<WindowOptions, 'windowSize' | 'forceWindowed'> = {},
): SectionWindow | null {
  const location = locateSection(model, nodeId);
  if (!location) return null;
  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
  // Centre the window on the target; when the node budget shrinks it, re-centre the smaller
  // window so the target itself is always mounted.
  const body = model.bodies[location.bodyIndex];
  const target = location.sectionIndex;
  let start = Math.max(0, target - Math.floor(windowSize / 2));
  let count = fitSections(body, start, windowSize);
  if (start + count <= target) {
    const fitted = Math.max(1, fitSections(body, target, windowSize));
    start = Math.max(0, target - Math.floor(fitted / 2));
    count = Math.max(fitSections(body, start, windowSize), target - start + 1);
  }
  return createWindow(model, {
    ...options,
    bodyIndex: location.bodyIndex,
    start,
    count,
  });
}

/**
 * Writes the (possibly edited) editor document of `window` back into the model and returns
 * the updated model together with the window description that now matches it (the number
 * of mounted sections may have changed through edits).
 */
export function replaceSectionsInModel<D extends Pick<Document, 'bodies'>>(
  model: D,
  window: SectionWindow,
  doc: PMNode,
): { model: D; window: SectionWindow } {
  if (window.wholeBook) {
    const bodies = docToBodies(doc);
    const next = { ...model, bodies };
    const total = totalSectionCount(next);
    return {
      model: next,
      window: { ...window, doc, count: total, totalSections: total, bodyCount: bodies.length },
    };
  }

  const bodyNode = doc.firstChild;
  const original = model.bodies[window.bodyIndex];
  if (!bodyNode || bodyNode.type !== fb2Schema.nodes.body || !original) {
    return { model, window: { ...window, doc } };
  }
  const edited = bodyToModel(bodyNode);
  const editedHeader = edited.content.filter((child) => !isSection(child));
  const editedSections = edited.content.filter(isSection);
  const sections = original.content.filter(isSection);
  const before = sections.slice(0, window.start);
  const after = sections.slice(window.start + window.count);
  const body: BodyNode = {
    ...edited,
    content: [...editedHeader, ...before, ...editedSections, ...after],
  };
  const bodies = model.bodies.map((item, index) => (index === window.bodyIndex ? body : item));
  const total = before.length + editedSections.length + after.length;
  return {
    model: { ...model, bodies },
    window: {
      ...window,
      doc,
      count: editedSections.length,
      totalSections: total,
      before: before.length,
      after: after.length,
    },
  };
}

/**
 * Maps a top-level section index of the editor document to the index within the body of the
 * model (windowed mode offsets by `start`).
 */
export function modelSectionIndex(window: SectionWindow, editorIndex: number): number {
  return window.wholeBook ? editorIndex : window.start + editorIndex;
}

/** True when `node` is a top-level section node (direct child of a body). */
export function isSectionNode(node: PMNode): boolean {
  return node.type === nodeTypeFor('section');
}
