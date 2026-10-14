/**
 * Find / Replace target of the Body view (T066). Searches run over the document *model* (all
 * bodies, including sections that are not mounted in the editor window), so a hit in an
 * unmounted section moves the window there before showing it (feature 002 FR-030). A search
 * starts from the selection, collapsed to its end (to its start searching up); a selected
 * element without text starts it at the nearest text (FR-031). Replace and Replace All are one
 * model-level step each, recorded in the Body history whatever part of the book is displayed
 * afterwards (FR-034).
 *
 * Offsets inside a text block count inline leaves (inline images, unknown inline elements) as
 * one character (`U+FFFC`), matching ProseMirror positions.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2Schema } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import type { Document } from '@/model/document';
import type { BodyEditorController, ModelStep, TextblockChange } from '@/views/body/bodyEditor';

import { allMatches, buildSearchRegExp, expandReplacement, type StyledRange } from './replacement';
import type { FindMode, FindOptions, FindResult, SearchTarget } from './search';

/* ------------------------------------------------------------------------ */
/* Model text blocks                                                        */
/* ------------------------------------------------------------------------ */

export interface ModelTextblock {
  nodeId: string;
  text: string;
  json: ModelNodeJson;
}

const TEXTBLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

/** Plain text of a model text block (inline leaves become U+FFFC). */
export function textOf(json: ModelNodeJson): string {
  let text = '';
  for (const child of json.content ?? []) {
    text += child.type === 'text' ? (child.text ?? '') : '\uFFFC';
  }
  return text;
}

/** Every text block of the model in document order (blocks without nodeId are skipped). */
export function collectTextblocks(model: Pick<Document, 'bodies'>): ModelTextblock[] {
  const out: ModelTextblock[] = [];
  const visit = (json: ModelNodeJson) => {
    if (TEXTBLOCK_TYPES.has(json.type)) {
      const nodeId = json.attrs?.nodeId;
      if (typeof nodeId === 'string' && nodeId) out.push({ nodeId, text: textOf(json), json });
      return;
    }
    for (const child of json.content ?? []) visit(child);
  };
  for (const body of model.bodies) visit(body as unknown as ModelNodeJson);
  return out;
}

/** Replaces text blocks of the model by node id in one pass (structural copy). */
export function replaceTextblocksInModel<D extends Pick<Document, 'bodies'>>(
  model: D,
  replacements: ReadonlyMap<string, ModelNodeJson>,
): D {
  const visit = (json: ModelNodeJson): ModelNodeJson => {
    const nodeId = json.attrs?.nodeId;
    if (typeof nodeId === 'string' && replacements.has(nodeId)) return replacements.get(nodeId)!;
    if (!json.content) return json;
    let changed = false;
    const content = json.content.map((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...json, content } : json;
  };
  let changed = false;
  const bodies = model.bodies.map((body) => {
    const next = visit(body as unknown as ModelNodeJson);
    if (next !== (body as unknown as ModelNodeJson)) changed = true;
    return next as unknown as D['bodies'][number];
  });
  return changed ? { ...model, bodies } : model;
}

/* ------------------------------------------------------------------------ */
/* Matching                                                                 */
/* ------------------------------------------------------------------------ */

export interface Match {
  nodeId: string;
  from: number;
  to: number;
  groups: string[];
  /** Found after continuing from the other end of the document. */
  wrapped?: boolean;
}

/**
 * Where a search starts: down after `to`, up before `from`, inside the text block `nodeId`
 * (null: the start of the document, or its end searching up). `from`/`to` may lie before the
 * block's start (-1) or after its end (`AFTER_END`) to start at that edge.
 */
interface Cursor {
  nodeId: string | null;
  from: number;
  to: number;
}

const AFTER_END = Number.MAX_SAFE_INTEGER;

function matchesIn(block: ModelTextblock, re: RegExp): Match[] {
  return allMatches(re, block.text).map((m) => ({
    nodeId: block.nodeId,
    from: m.index,
    to: m.index + m[0].length,
    groups: [...m],
  }));
}

/**
 * Next match after `cursor` in `direction`, continuing from the other end up to the start
 * (`wrapped` set then); `cursor.nodeId === null` starts at the beginning (down) / end (up).
 * Returns null when there is no match at all.
 */
export function findMatch(
  blocks: ModelTextblock[],
  re: RegExp,
  cursor: Cursor,
  direction: 'up' | 'down',
): Match | null {
  if (blocks.length === 0) return null;
  let index = cursor.nodeId ? blocks.findIndex((b) => b.nodeId === cursor.nodeId) : -1;
  if (index < 0) {
    index = direction === 'down' ? 0 : blocks.length - 1;
    cursor = { nodeId: null, from: direction === 'down' ? -1 : Number.MAX_SAFE_INTEGER, to: 0 };
  }
  const total = blocks.length;
  const pick = (candidates: Match[]) =>
    candidates.length === 0
      ? null
      : direction === 'down'
        ? candidates[0]!
        : candidates[candidates.length - 1]!;
  for (let step = 0; step <= total; step += 1) {
    const raw = direction === 'down' ? index + step : index - step;
    const i = ((raw % total) + total) % total;
    const wrapped = raw >= total || raw < 0;
    const matches = matchesIn(blocks[i]!, re);
    if (matches.length === 0) continue;
    if (step === 0) {
      // Same block: the selection is collapsed to its end (down) / start (up) first (FBE).
      const found = pick(
        direction === 'down'
          ? matches.filter((m) => m.from >= cursor.to)
          : matches.filter((m) => m.to <= cursor.from),
      );
      if (found) return found;
      continue;
    }
    if (step === total) {
      // Back in the start block: only matches on the far side of the selection.
      const found = pick(
        direction === 'down'
          ? matches.filter((m) => m.from < cursor.from)
          : matches.filter((m) => m.from > cursor.from),
      );
      return found ? { ...found, wrapped: true } : null;
    }
    const found = pick(matches)!;
    return wrapped ? { ...found, wrapped: true } : found;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Replacement helpers                                                      */
/* ------------------------------------------------------------------------ */

function replacementFor(options: FindOptions, replacement: string, match: Match) {
  if (!options.regex) return { text: replacement, ranges: [] as StyledRange[] };
  return expandReplacement(replacement, match.groups);
}

/** Applies `text` + styled ranges at `[from, to)` of the text block whose content starts at `contentStart`. */
function applyReplacement(
  tr: Transform,
  contentStart: number,
  from: number,
  to: number,
  text: string,
  ranges: StyledRange[],
): void {
  const start = contentStart + from;
  const end = contentStart + to;
  const $start = tr.doc.resolve(start);
  const marks = $start.marks();
  if (text) {
    tr.replaceWith(start, end, fb2Schema.text(text, marks));
  } else {
    tr.delete(start, end);
  }
  for (const range of ranges) {
    const a = start + range.start;
    const b = a + range.length;
    if (range.strong) tr.addMark(a, b, fb2Schema.marks.strong!.create());
    if (range.emphasis) tr.addMark(a, b, fb2Schema.marks.emphasis!.create());
  }
}

/** The model JSON of `block` with `matches` replaced (null when it cannot be converted). */
function replacedBlock(
  block: ModelTextblock,
  matches: Match[],
  options: FindOptions,
  replacement: string,
): ModelNodeJson | null {
  const node = nodeFromModel(block.json);
  if (!node) return null;
  const transform = new Transform(node);
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i]!;
    const { text, ranges } = replacementFor(options, replacement, match);
    applyReplacement(transform, 0, match.from, match.to, text, ranges);
  }
  return nodeToModel(transform.doc);
}

/** One undoable model-level step replacing the content of text blocks. */
function textblockStep(changes: TextblockChange[]): ModelStep {
  const after = new Map(changes.map((change) => [change.nodeId, change.after]));
  const before = new Map(changes.map((change) => [change.nodeId, change.before]));
  return {
    apply: (model) => replaceTextblocksInModel(model, after),
    revert: (model) => replaceTextblocksInModel(model, before),
    textblocks: changes,
  };
}

/** Node id of a text block (null for blocks without one). */
function textblockId(node: PMNode): string | null {
  return node.isTextblock && typeof node.attrs.nodeId === 'string' && node.attrs.nodeId
    ? node.attrs.nodeId
    : null;
}

/**
 * Start of a search from a selection that is not inside one text block (an image, an empty
 * line, a table, a selection over several blocks): the nearest text block on the search side,
 * entered at its edge; the start of the document when the window has no text at all.
 */
function edgeCursor(state: EditorState, direction: 'up' | 'down'): Cursor {
  const { $from, $to, from, to } = state.selection;
  // Searching down starts after the selection's end, up before its start (FBE).
  if (direction === 'down' && textblockId($to.parent)) {
    return { nodeId: textblockId($to.parent), from: $to.parentOffset, to: $to.parentOffset };
  }
  if (direction === 'up' && textblockId($from.parent)) {
    return { nodeId: textblockId($from.parent), from: $from.parentOffset, to: $from.parentOffset };
  }
  let before: string | null = null;
  let after: string | null = null;
  state.doc.descendants((node, pos) => {
    if (after) return false;
    const id = textblockId(node);
    if (!id) return true;
    if (pos + node.nodeSize <= from) before = id;
    else if (pos >= to) after = id;
    return false;
  });
  // The text block on the near side, entered at the edge facing the selection, so the search
  // goes on into the blocks beyond it, also outside the mounted window.
  if (direction === 'down') {
    if (before) return { nodeId: before, from: AFTER_END, to: AFTER_END };
    if (after) return { nodeId: after, from: -1, to: -1 };
  } else {
    if (after) return { nodeId: after, from: -1, to: -1 };
    if (before) return { nodeId: before, from: AFTER_END, to: AFTER_END };
  }
  return { nodeId: null, from: 0, to: 0 };
}

/* ------------------------------------------------------------------------ */
/* The target                                                               */
/* ------------------------------------------------------------------------ */

export class BodySearchTarget implements SearchTarget {
  readonly view = 'body' as const;
  private lastMatch: Match | null = null;
  private anchor: Cursor | null = null;

  constructor(private readonly controller: BodyEditorController) {}

  /** The selection when it lies inside one text block (a match to replace). */
  private selectionRange(): Cursor | null {
    const state = this.controller.selectionState;
    if (!state) return null;
    const { $from, $to } = state.selection;
    const nodeId = textblockId($from.parent);
    if (!nodeId || !$from.sameParent($to)) return null;
    return { nodeId, from: $from.parentOffset, to: $to.parentOffset };
  }

  /** Where a search in `direction` starts. */
  private cursor(direction: 'up' | 'down'): Cursor {
    const state = this.controller.selectionState;
    if (!state) return { nodeId: null, from: 0, to: 0 };
    return this.selectionRange() ?? edgeCursor(state, direction);
  }

  private blocks(): ModelTextblock[] {
    const model = this.controller.currentModel;
    return model ? collectTextblocks(model) : [];
  }

  findNext(options: FindOptions, mode: FindMode = 'next'): FindResult {
    const re = buildSearchRegExp(options);
    if (!re) return false;
    const cursor =
      mode === 'fromAnchor' && this.anchor ? this.anchor : this.cursor(options.direction);
    const start = mode === 'fromAnchor' ? { ...cursor, to: cursor.from } : cursor;
    const match = findMatch(this.blocks(), re, start, options.direction);
    // No match: the selection stays where it is ("Failing Incremental Search" keeps the last hit).
    if (!match) return false;
    if (!this.controller.showSearchMatch(match.nodeId, match.from, match.to)) return false;
    this.lastMatch = match;
    return match.wrapped ? 'wrapped' : true;
  }

  replaceCurrent(options: FindOptions, replacement: string): boolean {
    const match = this.lastMatch;
    const selection = this.selectionRange();
    if (
      !match ||
      !selection ||
      selection.nodeId !== match.nodeId ||
      selection.from !== match.from ||
      selection.to !== match.to
    ) {
      return false;
    }
    const block = this.blocks().find((candidate) => candidate.nodeId === match.nodeId);
    const after = block ? replacedBlock(block, [match], options, replacement) : null;
    if (!block || !after) return false;
    this.controller.applyModelStep(
      textblockStep([{ nodeId: block.nodeId, before: block.json, after }]),
    );
    this.lastMatch = null;
    return true;
  }

  replaceAll(options: FindOptions, replacement: string): number {
    const re = buildSearchRegExp(options);
    if (!re) return 0;
    let count = 0;
    const changes: TextblockChange[] = [];
    for (const block of this.blocks()) {
      const matches: Match[] = allMatches(re, block.text).map((m) => ({
        nodeId: block.nodeId,
        from: m.index,
        to: m.index + m[0].length,
        groups: [...m],
      }));
      if (matches.length === 0) continue;
      const after = replacedBlock(block, matches, options, replacement);
      if (!after) continue;
      changes.push({ nodeId: block.nodeId, before: block.json, after });
      count += matches.length;
    }
    if (changes.length > 0) this.controller.applyModelStep(textblockStep(changes));
    this.lastMatch = null;
    return count;
  }

  selectedText(): string {
    return this.controller.getContext().selectedText;
  }

  markAnchor(): void {
    this.anchor = this.cursor('down');
  }

  restoreAnchor(): void {
    if (this.anchor?.nodeId) {
      this.controller.selectRange(this.anchor.nodeId, this.anchor.from, this.anchor.to);
    }
    this.anchor = null;
  }

  clearAnchor(): void {
    this.anchor = null;
  }
}
