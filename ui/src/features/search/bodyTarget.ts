/**
 * Find / Replace target of the Body view (T066). Searches run over the document *model* (all
 * bodies, including sections that are not mounted in the editor window), so a hit in an
 * unmounted section moves the window there before selecting it. Replacements of mounted text
 * go through ProseMirror transactions; replacements in unmounted text blocks are model-level
 * steps recorded in the same Body history, so Replace All stays one undo entry.
 *
 * Offsets inside a text block count inline leaves (inline images, unknown inline elements) as
 * one character (`U+FFFC`), matching ProseMirror positions.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';

import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2Schema, findNodeById } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import type { Document } from '@/model/document';
import type { BodyEditorController, ModelStep } from '@/views/body/bodyEditor';

import { allMatches, buildSearchRegExp, expandReplacement, type StyledRange } from './replacement';
import type { FindMode, FindOptions, SearchTarget } from './search';

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

/** Replaces the text block `nodeId` in the model by `replacement` (structural copy). */
export function replaceTextblockInModel<D extends Pick<Document, 'bodies'>>(
  model: D,
  nodeId: string,
  replacement: ModelNodeJson,
): D {
  const visit = (json: ModelNodeJson): ModelNodeJson => {
    if (json.attrs?.nodeId === nodeId) return replacement;
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
}

interface Cursor {
  nodeId: string | null;
  from: number;
  to: number;
}

function matchesIn(block: ModelTextblock, re: RegExp): Match[] {
  return allMatches(re, block.text).map((m) => ({
    nodeId: block.nodeId,
    from: m.index,
    to: m.index + m[0].length,
    groups: [...m],
  }));
}

/**
 * Next match after `cursor` in `direction`, wrapping around; `cursor.nodeId === null` starts at
 * the beginning (down) / end (up). Returns null when there is no match at all.
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
    const i = (((direction === 'down' ? index + step : index - step) % total) + total) % total;
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
      // Wrapped around to the start block: only matches on the far side of the selection.
      return pick(
        direction === 'down'
          ? matches.filter((m) => m.from < cursor.from)
          : matches.filter((m) => m.from > cursor.from),
      );
    }
    return pick(matches)!;
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

/* ------------------------------------------------------------------------ */
/* The target                                                               */
/* ------------------------------------------------------------------------ */

export class BodySearchTarget implements SearchTarget {
  readonly view = 'body' as const;
  private lastMatch: Match | null = null;
  private anchor: Cursor | null = null;

  constructor(private readonly controller: BodyEditorController) {}

  private cursor(): Cursor {
    const state = this.controller.selectionState;
    if (!state) return { nodeId: null, from: 0, to: 0 };
    const { $from, $to } = state.selection;
    const block = $from.parent;
    const nodeId = typeof block.attrs.nodeId === 'string' ? block.attrs.nodeId : null;
    if (!nodeId || !block.isTextblock) {
      // Caret in a non-text position: use the enclosing node id and start from its beginning.
      const context = this.controller.getContext();
      return { nodeId: context.nodeId, from: 0, to: 0 };
    }
    return {
      nodeId,
      from: $from.parentOffset,
      to: $from.sameParent($to) ? $to.parentOffset : $from.parentOffset,
    };
  }

  private blocks(): ModelTextblock[] {
    const model = this.controller.currentModel;
    return model ? collectTextblocks(model) : [];
  }

  findNext(options: FindOptions, mode: FindMode = 'next'): boolean {
    const re = buildSearchRegExp(options);
    if (!re) return false;
    const cursor = mode === 'fromAnchor' && this.anchor ? this.anchor : this.cursor();
    const start = mode === 'fromAnchor' ? { ...cursor, to: cursor.from } : cursor;
    const match = findMatch(this.blocks(), re, start, options.direction);
    // No match: the selection stays where it is ("Failing Incremental Search" keeps the last hit).
    if (!match) return false;
    if (!this.controller.selectRange(match.nodeId, match.from, match.to)) return false;
    this.lastMatch = match;
    return true;
  }

  replaceCurrent(options: FindOptions, replacement: string): boolean {
    const match = this.lastMatch;
    const cursor = this.cursor();
    if (
      !match ||
      cursor.nodeId !== match.nodeId ||
      cursor.from !== match.from ||
      cursor.to !== match.to
    ) {
      return false;
    }
    const state = this.controller.editorState;
    if (!state) return false;
    const found = findNodeById(state.doc, match.nodeId);
    if (!found) return false;
    const { text, ranges } = replacementFor(options, replacement, match);
    const tr = state.tr;
    applyReplacement(tr, found.pos + 1, match.from, match.to, text, ranges);
    this.controller.apply(tr);
    this.lastMatch = null;
    return true;
  }

  replaceAll(options: FindOptions, replacement: string): number {
    const re = buildSearchRegExp(options);
    const state = this.controller.editorState;
    if (!re || !state) return 0;
    let count = 0;
    // Mounted blocks: one transaction (one history event).
    const tr = state.tr;
    const mounted = new Set<string>();
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const nodeId = typeof node.attrs.nodeId === 'string' ? node.attrs.nodeId : null;
      if (nodeId) mounted.add(nodeId);
      const text = textOfNode(node);
      const matches = allMatches(re, text);
      for (let i = matches.length - 1; i >= 0; i -= 1) {
        const m = matches[i]!;
        const match: Match = {
          nodeId: nodeId ?? '',
          from: m.index,
          to: m.index + m[0].length,
          groups: [...m],
        };
        const { text: repl, ranges } = replacementFor(options, replacement, match);
        applyReplacement(tr, tr.mapping.map(pos) + 1, match.from, match.to, repl, ranges);
        count += 1;
      }
      return false;
    });
    if (count > 0) this.controller.apply(tr);

    // Unmounted blocks (windowed documents): model-level steps.
    const model = this.controller.currentModel;
    if (model) {
      for (const block of collectTextblocks(model)) {
        if (mounted.has(block.nodeId)) continue;
        const matches = allMatches(re, block.text);
        if (matches.length === 0) continue;
        const node = nodeFromModel(block.json);
        if (!node) continue;
        const transform = new Transform(node);
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          const m = matches[i]!;
          const match: Match = {
            nodeId: block.nodeId,
            from: m.index,
            to: m.index + m[0].length,
            groups: [...m],
          };
          const { text: repl, ranges } = replacementFor(options, replacement, match);
          applyReplacement(transform, 0, match.from, match.to, repl, ranges);
          count += 1;
        }
        const before = block.json;
        const after = nodeToModel(transform.doc);
        const step: ModelStep = {
          apply: (m) => replaceTextblockInModel(m, block.nodeId, after),
          revert: (m) => replaceTextblockInModel(m, block.nodeId, before),
        };
        this.controller.applyModelStep(step);
      }
    }
    this.lastMatch = null;
    return count;
  }

  selectedText(): string {
    return this.controller.getContext().selectedText;
  }

  markAnchor(): void {
    this.anchor = this.cursor();
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

/** Text of a ProseMirror text block with inline leaves as U+FFFC. */
function textOfNode(node: PMNode): string {
  let text = '';
  node.forEach((child) => {
    text += child.isText ? (child.text ?? '') : '\uFFFC';
  });
  return text;
}
