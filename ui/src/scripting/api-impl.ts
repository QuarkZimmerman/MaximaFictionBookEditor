/**
 * Host side of the `mfbe` script API (T103) - exactly the members of
 * contracts/script-api.d.ts, nothing else. Every call arrives from the sandbox worker as
 * `{method, args}` (see sandbox.ts) and is validated here before touching the document.
 *
 * The run reads and writes its working copy of the document (workingCopy.ts): a write costs
 * no editor transaction, store notification or render. Before the script's dialogs and
 * selection calls the working copy is shown in the editor (`showChanges`), so they see what
 * the script did so far; the host replaces the document with the result when the run ends
 * and keeps the run as one undo entry (host.ts).
 */

import type { TFunction } from 'i18next';
import { Fragment, type Node as PMNode, type NodeType } from 'prosemirror-model';
import { Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';

import type { Dialogs } from '@/dialogs/types';
import { createReport, nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import {
  assignNodeIds,
  createNodeIdGenerator,
  fb2NameFor,
  fb2Schema,
  findNodeById,
  nodeTypeFor,
} from '@/editor/schema';
import { DEFAULT_NBSP_DISPLAY_CHAR } from '@/editor/plugins/nbsp';
import { nodeToModel } from '@/editor/toModel';
import { replaceSectionsInModel } from '@/editor/virtualization';
import { allMatches, buildSearchRegExp, expandReplacement } from '@/features/search/replacement';
import type { Description, Document } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import type { RpcClient } from '@/rpc/client';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import { showScriptForm, showScriptMessage, showScriptPrompt } from './dialogs';
import {
  API_METHODS,
  type ApiMethod,
  type ButtonSpec,
  type DocStats,
  type FindQuery,
  type FormSpec,
  type FormValues,
  type Match,
  type MessageOptions,
  type NodeRef,
  type Position,
  type PromptOptions,
  type RunEnd,
  type ScriptSettings,
  type SelectionInfo,
  type SymbolInfo,
} from './types';
import { WorkingCopy, type NodePlace } from './workingCopy';

/** Document snapshots above this JSON size are refused (script-manifest.md §3.5). */
export const SNAPSHOT_LIMIT_BYTES = 64 * 1024 * 1024;

/** `jobId` of the progress a script reports (`mfbe.ui.progress`). */
export const SCRIPT_PROGRESS_JOB = 'script';

const TEXTBLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const MARK_NAMES = new Set(['strong', 'emphasis', 'strikethrough', 'sub', 'sup', 'code']);
const STANDARD_BUTTONS = new Set([
  'ok',
  'cancel',
  'yes',
  'no',
  'abort',
  'retry',
  'ignore',
  'close',
]);

/**
 * Machine-readable reason of a `ScriptApiError` (travels to the worker as `error.code`):
 * `invalidNode` - a node passed to `insertNode`/`replaceNode` violates the FB2 schema
 * (the message names the offending path); `notAllowed` - the edit would make the parent
 * invalid (wrong position, last section of a body, first body); `unknownNode` - a nodeId that
 * is not in the document; `apiError` - any other argument or state problem.
 */
export type ScriptApiErrorCode = 'apiError' | 'invalidNode' | 'notAllowed' | 'unknownNode';

export class ScriptApiError extends Error {
  readonly code: ScriptApiErrorCode;

  constructor(message: string, code: ScriptApiErrorCode = 'apiError') {
    super(message);
    this.name = 'ScriptApiError';
    this.code = code;
  }
}

/** A result already serialised as JSON text (large snapshots: parsed in the worker). */
export class JsonText {
  constructor(readonly text: string) {}
}

export interface ScriptApiDeps {
  store: AppStore;
  /** Body controller (null without an editing feature: selection calls then fail cleanly). */
  controller: BodyEditorController | null;
  dialogs: Dialogs;
  rpc: RpcClient | null;
  t: TFunction;
  /** Display name of the running script (default dialog caption). */
  scriptName: string;
  uiLanguage: string;
  /** Called with `true` while a modal dialog of the script is open (pauses the watchdog). */
  onUiActivity?: (active: boolean) => void;
  /** Progress reports (`ui.progress`). */
  onProgress?: (done: number, total: number | undefined, label: string | undefined) => void;
  /** Read by `ui.progress` to let cooperative scripts observe a pending cancellation. */
  isCancelRequested?: () => boolean;
  /** The end of the run: closes the script's dialogs that are still open (Cancel, failure). */
  runEnd?: RunEnd;
  /** Snapshot size guard override (tests). */
  snapshotLimit?: number;
}

export interface ScriptApi {
  call(method: string, args: unknown[]): Promise<unknown>;
  /** True when the script asked for a sticky status (kept after the run). */
  readonly stickyStatus: boolean;
  /** Clears transient UI state at the end of the run (progress, non-sticky status). */
  finish(): void;
  /** The document the run produced; null when the script changed nothing. */
  result(): Document | null;
}

/* ------------------------------------------------------------------------ */
/* Model helpers (pure)                                                     */
/* ------------------------------------------------------------------------ */

export function refOf(node: ModelNodeJson): NodeRef {
  return { nodeId: String(node.attrs?.nodeId ?? ''), type: node.type };
}

/** Plain text of a subtree: inline leaves become U+FFFC, text blocks are joined with `\n`. */
export function plainText(node: ModelNodeJson): string {
  if (node.type === 'text') return node.text ?? '';
  if (!node.content) return '';
  if (TEXTBLOCK_TYPES.has(node.type)) {
    return node.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '\uFFFC')).join('');
  }
  const parts: string[] = [];
  for (const child of node.content) {
    if (child.type === 'text') {
      parts.push(child.text ?? '');
      continue;
    }
    const text = plainText(child);
    if (text || TEXTBLOCK_TYPES.has(child.type)) parts.push(text);
  }
  return parts.join('\n');
}

/** Schema node type of a model child in the content of `parentType` (null for unknown types). */
function childNodeType(child: ModelNodeJson, parentType: NodeType): NodeType | null {
  if (child.type === 'text') return fb2Schema.nodes.text!;
  return nodeTypeFor(child.type, parentType.inlineContent) ?? null;
}

/**
 * The equivalent of ProseMirror's `canReplaceWith` for a parent that is not mounted: true when
 * the child sequence of `parentType` stays valid after `[index, index + replaced)` of
 * `siblings` is replaced by `inserted`. Unknown child types (`raw-xml` already covers foreign
 * elements) count as not fitting.
 */
export function contentFits(
  parentType: NodeType,
  siblings: readonly ModelNodeJson[],
  index: number,
  replaced: number,
  inserted: readonly NodeType[],
): boolean {
  const types: NodeType[] = [];
  const at = Math.max(0, Math.min(index, siblings.length));
  for (let i = 0; i < siblings.length; i += 1) {
    if (i === at) types.push(...inserted);
    if (i >= at && i < at + replaced) continue;
    const type = childNodeType(siblings[i]!, parentType);
    if (!type) return false;
    types.push(type);
  }
  if (at >= siblings.length) types.push(...inserted);
  let match = parentType.contentMatch;
  for (const type of types) {
    const next = match.matchType(type);
    if (!next) return false;
    match = next;
  }
  return match.validEnd;
}

/* ------------------------------------------------------------------------ */
/* Statistics                                                               */
/* ------------------------------------------------------------------------ */

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function documentStats(document: Document): DocStats {
  const stats: DocStats = {
    characters: 0,
    words: 0,
    paragraphs: 0,
    sections: 0,
    images: 0,
    notes: 0,
    binaryBytes: 0,
  };
  const visit = (node: ModelNodeJson, inNotes: boolean) => {
    if (node.type === 'text') {
      const text = node.text ?? '';
      stats.characters += text.length;
      stats.words += text.match(WORD_RE)?.length ?? 0;
      return;
    }
    if (node.type === 'p') stats.paragraphs += 1;
    if (node.type === 'section') {
      stats.sections += 1;
      if (inNotes) stats.notes += 1;
    }
    if (node.type === 'image' || node.type === 'inline-image') stats.images += 1;
    for (const child of node.content ?? []) visit(child, inNotes);
  };
  for (const body of document.bodies) {
    const name = body.attrs.name ?? '';
    visit(body as unknown as ModelNodeJson, name === 'notes' || name === 'comments');
  }
  for (const binary of document.binaries) stats.binaryBytes += binary.size;
  return stats;
}

/* ------------------------------------------------------------------------ */
/* Argument validation                                                      */
/* ------------------------------------------------------------------------ */

function refId(value: unknown, what = 'node'): string {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof (value as NodeRef).nodeId === 'string') {
    return (value as NodeRef).nodeId;
  }
  throw new ScriptApiError(`${what}: expected a NodeRef or a nodeId string`);
}

function asString(value: unknown, what: string): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) throw new ScriptApiError(`${what}: expected a string`);
  return String(value);
}

function asObject<T extends object>(value: unknown, what: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScriptApiError(`${what}: expected an object`);
  }
  return value as T;
}

function optionalObject<T extends object>(value: unknown, what: string): T {
  if (value === undefined || value === null) return {} as T;
  return asObject<T>(value, what);
}

/* ------------------------------------------------------------------------ */
/* The implementation                                                       */
/* ------------------------------------------------------------------------ */

export function createScriptApi(deps: ScriptApiDeps): ScriptApi {
  const { store, controller, dialogs, rpc, t } = deps;
  const nextNodeId = createNodeIdGenerator('sc_');
  const start = store.getState().document;
  const copy = start ? new WorkingCopy(start) : null;
  /** Whether a children list, as it is, fits its parent (reused while only same-type nodes replace its children). */
  const checkedContent = new WeakMap<readonly ModelNodeJson[], boolean>();
  let stickyStatus = false;
  let touchedStatus = false;
  let touchedProgress = false;

  const requireCopy = (): WorkingCopy => {
    if (!copy) throw new ScriptApiError('no document is open');
    return copy;
  };

  const requireDocument = (): Document => requireCopy().document;

  const requireController = (): BodyEditorController => {
    if (!controller || !controller.editorState) {
      throw new ScriptApiError('the Body editor is not available');
    }
    return controller;
  };

  /** Shows the changes made so far in the editor (before the script's dialogs and selection calls). */
  const showChanges = () => {
    if (!copy?.pending) return;
    const next = copy.release();
    if (controller) controller.showModel(next);
    else actions.updateDocument(store, next);
  };

  const placeOf = (value: unknown, what = 'node'): NodePlace => {
    const id = refId(value, what);
    const place = requireCopy().place(id);
    if (!place) throw new ScriptApiError(`${what}: unknown nodeId "${id}"`, 'unknownNode');
    return place;
  };

  /**
   * Converts script-supplied JSON into a checked ProseMirror node with node ids. The whole
   * subtree is validated first (`nodeFromModel` runs `createChecked` on every node and
   * collects each violation with its path); nothing reaches the document unless the subtree is
   * schema-valid, so an invalid node is a clear `invalidNode` error instead of an unchecked
   * node in the document.
   */
  const nodeFromScript = (value: unknown, what: string, keepId?: string): PMNode => {
    const json = asObject<ModelNodeJson>(value, what);
    if (typeof json.type !== 'string') throw new ScriptApiError(`${what}: node.type is required`);
    if (json.type === 'text') throw new ScriptApiError(`${what}: a text node cannot stand alone`);
    const copy: ModelNodeJson = { ...json, attrs: { ...(json.attrs ?? {}) } };
    if (keepId) copy.attrs!.nodeId = keepId;
    const report = createReport();
    const node = nodeFromModel(copy, report);
    if (!node) {
      throw new ScriptApiError(`${what}: cannot build a "${json.type}" node`, 'invalidNode');
    }
    const problem = report.problems[0];
    if (problem) {
      const more = report.problems.length - 1;
      throw new ScriptApiError(
        `${what}: invalid node at "${problem.path}": ${problem.message}` +
          (more > 0 ? ` (and ${more} more problem${more === 1 ? '' : 's'})` : ''),
        'invalidNode',
      );
    }
    return assignNodeIds(node, nextNodeId);
  };

  const notAllowed = (what: string, node: NodeType, parent: NodeType) =>
    new ScriptApiError(
      `${what}: a "${fb2NameFor(node)}" is not allowed inside "${fb2NameFor(parent)}" at this position`,
      'notAllowed',
    );

  /** Schema type of the parent of a place (the `doc` for a body). */
  const parentTypeOf = (place: NodePlace): NodeType =>
    place.parent
      ? (nodeTypeFor(place.parent.type) ?? fb2Schema.nodes.raw_xml!)
      : fb2Schema.nodes.doc!;

  /** Refuses `node` at `[index, index + replaced)` of `siblings` when the parent would not allow it. */
  const checkParent = (
    parentType: NodeType,
    siblings: readonly ModelNodeJson[],
    index: number,
    replaced: number,
    node: PMNode,
    what: string,
  ) => {
    if (!contentFits(parentType, siblings, index, replaced, [node.type])) {
      throw notAllowed(what, node.type, parentType);
    }
  };

  /**
   * `checkParent` for a node that takes the place of one of the same type: the children keep
   * their types, so the check of the children as they are is reused (a clean-up replacing
   * every paragraph of a long section checks the section once).
   */
  const checkSameType = (place: NodePlace, node: PMNode, what: string) => {
    const parentType = parentTypeOf(place);
    let fits = checkedContent.get(place.siblings);
    if (fits === undefined) {
      fits = contentFits(parentType, place.siblings, place.index, 1, [node.type]);
      checkedContent.set(place.siblings, fits);
    }
    if (!fits) throw notAllowed(what, node.type, parentType);
  };

  /* ------------------------------------------------------------- doc */

  const doc = {
    get: async () => {
      const document = requireDocument();
      const text = JSON.stringify(document);
      const limit = deps.snapshotLimit ?? SNAPSHOT_LIMIT_BYTES;
      if (text.length > limit) {
        throw new ScriptApiError(
          `the document snapshot is larger than ${Math.round(limit / (1024 * 1024))} MB; use getNode()/getElementsByTagName() with a subtree instead`,
        );
      }
      return new JsonText(text);
    },

    getNode: async (ref: unknown) => placeOf(ref).node,

    replaceNode: async (ref: unknown, value: unknown): Promise<NodeRef> => {
      const place = placeOf(ref);
      const id = refId(ref);
      const node = nodeFromScript(value, 'replaceNode', id);
      const sameType = childNodeType(place.node, parentTypeOf(place)) === node.type;
      if (sameType) checkSameType(place, node, 'replaceNode');
      else checkParent(parentTypeOf(place), place.siblings, place.index, 1, node, 'replaceNode');
      requireCopy().replace(id, nodeToModel(node));
      if (!sameType) checkedContent.delete(place.siblings);
      return { nodeId: id, type: fb2NameFor(node.type) };
    },

    insertNode: async (where: unknown, ref: unknown, value: unknown): Promise<NodeRef> => {
      if (where !== 'before' && where !== 'after' && where !== 'append') {
        throw new ScriptApiError('insertNode: where must be "before", "after" or "append"');
      }
      const place = placeOf(ref);
      const id = refId(ref);
      const node = nodeFromScript(value, 'insertNode');
      const newId = String(node.attrs.nodeId);
      if (where === 'append') {
        const children = place.node.content ?? [];
        const type = nodeTypeFor(place.node.type) ?? fb2Schema.nodes.raw_xml!;
        checkParent(type, children, children.length, 0, node, 'insertNode');
        requireCopy().insert(where, id, nodeToModel(node));
        checkedContent.delete(children);
      } else {
        const index = place.index + (where === 'after' ? 1 : 0);
        checkParent(parentTypeOf(place), place.siblings, index, 0, node, 'insertNode');
        requireCopy().insert(where, id, nodeToModel(node));
        checkedContent.delete(place.siblings);
      }
      return { nodeId: newId, type: fb2NameFor(node.type) };
    },

    removeNode: async (ref: unknown): Promise<void> => {
      const place = placeOf(ref);
      const id = refId(ref);
      // FB2 needs at least one body and the first one is the book itself; any other body
      // (notes, comments, a stray copy) may go, like any node whose parent stays valid.
      if (!place.parent && place.index === 0) {
        throw new ScriptApiError('removeNode: the first body cannot be removed', 'notAllowed');
      }
      if (!contentFits(parentTypeOf(place), place.siblings, place.index, 1, [])) {
        throw new ScriptApiError(
          `removeNode: "${place.parent ? place.parent.type : 'doc'}" needs this "${place.node.type}"`,
          'notAllowed',
        );
      }
      requireCopy().remove(id);
      checkedContent.delete(place.siblings);
    },

    setDescription: async (value: unknown): Promise<void> => {
      const description = asObject<Description>(value, 'setDescription');
      if (!description.titleInfo || !description.documentInfo) {
        throw new ScriptApiError('setDescription: titleInfo and documentInfo are required');
      }
      const previous = requireDocument().description;
      requireCopy().setDescription({
        titleInfo: description.titleInfo,
        documentInfo: description.documentInfo,
        customInfo: description.customInfo ?? [],
        outputs: description.outputs ?? previous.outputs,
        ...(description.srcTitleInfo ? { srcTitleInfo: description.srcTitleInfo } : {}),
        ...(description.publishInfo ? { publishInfo: description.publishInfo } : {}),
      });
    },

    getElementsByTagName: async (name: unknown, within?: unknown): Promise<NodeRef[]> => {
      const tag = asString(name, 'getElementsByTagName');
      const document = requireDocument();
      const roots: ModelNodeJson[] = within
        ? [placeOf(within, 'within').node]
        : (document.bodies as unknown as ModelNodeJson[]);
      const out: NodeRef[] = [];
      const isMark = MARK_NAMES.has(tag) || tag === 'style' || tag === 'link' || tag === 'a';
      const visit = (node: ModelNodeJson) => {
        if (node.type === 'text') return;
        if (!isMark && node.type === tag && node.attrs?.nodeId) out.push(refOf(node));
        if (isMark && TEXTBLOCK_TYPES.has(node.type) && node.attrs?.nodeId) {
          const markType = tag === 'a' ? 'link' : tag;
          const has = (node.content ?? []).some(
            (c) => c.type === 'text' && c.marks?.some((m) => m.type === markType),
          );
          if (has) out.push(refOf(node));
        }
        for (const child of node.content ?? []) visit(child);
      };
      roots.forEach(visit);
      return out;
    },

    textOf: async (ref: unknown): Promise<string> => plainText(placeOf(ref).node),

    setText: async (ref: unknown, value: unknown): Promise<void> => {
      const text = asString(value, 'setText');
      const place = placeOf(ref);
      if (!TEXTBLOCK_TYPES.has(place.node.type)) {
        throw new ScriptApiError(`setText: "${place.node.type}" is not a text block`);
      }
      requireCopy().replace(refId(ref), {
        ...place.node,
        content: text ? [{ type: 'text', text }] : [],
      });
    },

    parentOf: async (ref: unknown): Promise<NodeRef | null> => {
      const place = placeOf(ref);
      return place.parent ? refOf(place.parent) : null;
    },

    childrenOf: async (ref: unknown): Promise<NodeRef[]> =>
      (placeOf(ref).node.content ?? [])
        .filter((c) => c.type !== 'text' && c.attrs?.nodeId)
        .map(refOf),

    find: async (query: unknown): Promise<Match[]> => {
      const q = asObject<FindQuery>(query, 'find');
      const re = searchRegExp(q, 'find');
      const out: Match[] = [];
      for (const block of textblocksIn(
        requireDocument(),
        q.within ? placeOf(q.within, 'within').node : null,
      )) {
        for (const m of allMatches(re, block.text)) {
          out.push({ nodeId: block.nodeId, from: m.index, to: m.index + m[0].length, text: m[0] });
        }
      }
      return out;
    },

    replaceAll: async (query: unknown, replacement: unknown): Promise<{ count: number }> => {
      const q = asObject<FindQuery>(query, 'replaceAll');
      const repl = asString(replacement, 'replaceAll');
      const re = searchRegExp(q, 'replaceAll');
      const working = requireCopy();
      const blocks = textblocksIn(
        working.document,
        q.within ? placeOf(q.within, 'within').node : null,
      );
      let count = 0;
      for (const block of blocks) {
        const matches = allMatches(re, block.text);
        if (matches.length === 0) continue;
        const after = rebuildBlock(block.json, matches, (m) =>
          q.regex ? expandReplacement(repl, m) : { text: repl, ranges: [] },
        );
        if (after === block.json) continue;
        working.replace(block.nodeId, after);
        count += matches.length;
      }
      return { count };
    },

    binaries: async () => requireDocument().binaries,

    stats: async (): Promise<DocStats> => documentStats(requireDocument()),
  };

  /* ------------------------------------------------------- selection */

  /**
   * A selection edit (replaceText, wrap, unwrap) is built on the editor, which shows the
   * working copy; the edited part goes into the working copy and is shown at once, with the
   * selection the edit leaves.
   */
  const applySelectionEdit = (ctrl: BodyEditorController, tr: Transaction) => {
    if (!tr.docChanged) return;
    const window = ctrl.currentWindow;
    if (!window) throw new ScriptApiError('the Body editor is not available');
    const working = requireCopy();
    working.reset(replaceSectionsInModel(working.document, window, tr.doc).model);
    showChanges();
    const state = ctrl.editorState!;
    if (state.doc.eq(tr.doc)) {
      ctrl.apply(state.tr.setSelection(Selection.fromJSON(state.doc, tr.selection.toJSON())));
    }
  };

  const selection = {
    get: async (): Promise<SelectionInfo | null> => {
      if (!controller) return null;
      showChanges();
      const state = controller.selectionState;
      if (!state || !copy) return null;
      const { $anchor, $head, from, to } = state.selection;
      const idOf = ($pos: typeof $anchor) => {
        for (let depth = $pos.depth; depth >= 1; depth -= 1) {
          const id = $pos.node(depth).attrs.nodeId;
          if (typeof id === 'string' && id) return { nodeId: id, offset: $pos.parentOffset };
        }
        return null;
      };
      const anchor = idOf($anchor);
      const head = idOf($head);
      if (!anchor || !head) return null;
      const nodes: NodeRef[] = [];
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isTextblock) {
          const id = node.attrs.nodeId;
          if (typeof id === 'string' && id) nodes.push({ nodeId: id, type: fb2NameFor(node.type) });
          return false;
        }
        return true;
      });
      return { anchor, head, text: state.doc.textBetween(from, to, '\n', '￼'), nodes };
    },

    set: async (anchor: unknown, head?: unknown): Promise<void> => {
      const ctrl = requireController();
      const a = asObject<Position>(anchor, 'selection.set');
      const h = head ? asObject<Position>(head, 'selection.set') : undefined;
      showChanges();
      setBodySelection(ctrl, a, h, 'selection.set');
    },

    replaceText: async (value: unknown): Promise<void> => {
      const text = asString(value, 'selection.replaceText');
      const ctrl = requireController();
      showChanges();
      const state = ctrl.editorState!;
      const { from, to, $from } = state.selection;
      if (!$from.parent.inlineContent) {
        throw new ScriptApiError('selection.replaceText: the selection is not inside text');
      }
      const tr = state.tr;
      if (text) tr.replaceWith(from, to, fb2Schema.text(text, $from.marks()));
      else tr.delete(from, to);
      applySelectionEdit(ctrl, tr);
    },

    wrap: async (mark: unknown): Promise<void> => {
      const ctrl = requireController();
      showChanges();
      const state = ctrl.editorState!;
      const { from, to, empty } = state.selection;
      if (empty) throw new ScriptApiError('selection.wrap: nothing is selected');
      const type = markFor(mark, 'selection.wrap');
      applySelectionEdit(ctrl, state.tr.addMark(from, to, type));
    },

    unwrap: async (mark: unknown): Promise<void> => {
      const ctrl = requireController();
      showChanges();
      const state = ctrl.editorState!;
      const { from, to, empty } = state.selection;
      if (empty) throw new ScriptApiError('selection.unwrap: nothing is selected');
      const name = asString(mark, 'selection.unwrap');
      const markType = fb2Schema.marks[name];
      if (!markType) throw new ScriptApiError(`selection.unwrap: unknown mark "${name}"`);
      applySelectionEdit(ctrl, state.tr.removeMark(from, to, markType));
    },

    selectNode: async (ref: unknown): Promise<void> => {
      const ctrl = requireController();
      const id = refId(ref, 'selection.selectNode');
      showChanges();
      if (!ctrl.moveWindowTo(id)) throw new ScriptApiError(`selectNode: unknown nodeId "${id}"`);
      const state = ctrl.editorState!;
      const found = findNodeById(state.doc, id);
      if (!found) throw new ScriptApiError(`selectNode: node "${id}" is not mounted`);
      const $from = state.doc.resolve(found.pos + 1);
      const $to = state.doc.resolve(found.pos + found.node.nodeSize - 1);
      ctrl.apply(state.tr.setSelection(TextSelection.between($from, $to)).scrollIntoView());
    },

    scrollIntoView: async (): Promise<void> => {
      const ctrl = requireController();
      showChanges();
      ctrl.apply(ctrl.editorState!.tr.scrollIntoView());
    },
  };

  /* -------------------------------------------------------------- ui */

  const withDialog = async <T>(fn: () => Promise<T>): Promise<T> => {
    showChanges();
    deps.onUiActivity?.(true);
    try {
      return await fn();
    } finally {
      deps.onUiActivity?.(false);
    }
  };

  const ui = {
    message: async (text: unknown, options?: unknown): Promise<string> => {
      const o = optionalObject<MessageOptions>(options, 'ui.message');
      const buttons: ButtonSpec[] = (
        o.buttons?.length ? o.buttons : [{ id: 'ok', label: '', default: true, cancel: true }]
      ).map((b) => ({
        ...b,
        label: b.label || (STANDARD_BUTTONS.has(b.id) ? t(`dialog.buttons.${b.id}`) : b.id),
      }));
      return withDialog(() =>
        showScriptMessage(
          dialogs,
          {
            text: asString(text, 'ui.message'),
            caption: o.caption ?? deps.scriptName,
            buttons,
            icon: o.icon,
          },
          deps.runEnd,
        ),
      );
    },

    prompt: async (text: unknown, options?: unknown): Promise<string | null> => {
      const o = optionalObject<PromptOptions>(options, 'ui.prompt');
      return withDialog(async () => {
        const result = await showScriptPrompt(
          dialogs,
          {
            prompt: asString(text, 'ui.prompt'),
            caption: o.caption ?? deps.scriptName,
            defaultValue: o.defaultValue === undefined ? undefined : String(o.defaultValue),
            buttons: o.yesNoCancel ? 'yesNoCancel' : 'okCancel',
            testId: 'dialog-script-prompt',
          },
          deps.runEnd,
        );
        if (result.button === 'cancel') return null;
        if (result.button === 'no') return '';
        return result.value;
      });
    },

    form: async (spec: unknown): Promise<FormValues | null> => {
      const s = asObject<FormSpec>(spec, 'ui.form');
      if (!Array.isArray(s.fields)) throw new ScriptApiError('ui.form: fields must be an array');
      return withDialog(() =>
        showScriptForm(dialogs, { ...s, title: s.title ?? deps.scriptName }, deps.runEnd),
      );
    },

    status: async (text: unknown, options?: unknown): Promise<void> => {
      const o = optionalObject<{ sticky?: boolean }>(options, 'ui.status');
      touchedStatus = true;
      stickyStatus = !!o.sticky;
      actions.setStatusMessage(store, asString(text, 'ui.status'));
    },

    progress: async (
      done: unknown,
      total?: unknown,
      label?: unknown,
    ): Promise<{ cancelled: boolean }> => {
      touchedProgress = true;
      const d = Number(done) || 0;
      const tot = total === undefined || total === null ? undefined : Number(total) || 0;
      const text = label === undefined || label === null ? undefined : String(label);
      actions.setProgress(store, {
        jobId: SCRIPT_PROGRESS_JOB,
        phase: text ?? deps.scriptName,
        done: d,
        total: tot ?? 0,
      });
      deps.onProgress?.(d, tot, text);
      return { cancelled: deps.isCancelRequested?.() ?? false };
    },
  };

  /* ------------------------------------------------------- edit / env */

  const edit = {
    label: async (): Promise<void> => {
      // Informational only: the run is already one undo entry with the manifest label.
    },
    symbols: async (): Promise<SymbolInfo[]> => {
      if (!rpc) return [];
      const entries = await rpc.call('resources.symbols');
      return entries.map((e) => ({
        codepoint: e.codepoint,
        name: e.names[deps.uiLanguage] ?? e.names.en ?? String.fromCodePoint(e.codepoint),
      }));
    },
  };

  const env = {
    settings: async (): Promise<ScriptSettings> => {
      const settings = store.getState().settings;
      return {
        nbspDisplayChar: settings?.other.nbspDisplayChar ?? DEFAULT_NBSP_DISPLAY_CHAR,
        pasteImageFormat: settings?.other.pasteImageFormat ?? 'jpeg',
        jpegQuality: settings?.other.jpegQuality ?? 90,
        uiLanguage: deps.uiLanguage,
      };
    },
    docLanguage: async (): Promise<string> => requireDocument().description.titleInfo.lang ?? '',
  };

  const table: Record<ApiMethod, (...args: unknown[]) => Promise<unknown>> = {
    'doc.get': doc.get,
    'doc.getNode': doc.getNode,
    'doc.replaceNode': doc.replaceNode,
    'doc.insertNode': doc.insertNode,
    'doc.removeNode': doc.removeNode,
    'doc.setDescription': doc.setDescription,
    'doc.getElementsByTagName': doc.getElementsByTagName,
    'doc.textOf': doc.textOf,
    'doc.setText': doc.setText,
    'doc.parentOf': doc.parentOf,
    'doc.childrenOf': doc.childrenOf,
    'doc.find': doc.find,
    'doc.replaceAll': doc.replaceAll,
    'doc.binaries': doc.binaries,
    'doc.stats': doc.stats,
    'selection.get': selection.get,
    'selection.set': selection.set,
    'selection.replaceText': selection.replaceText,
    'selection.wrap': selection.wrap,
    'selection.unwrap': selection.unwrap,
    'selection.selectNode': selection.selectNode,
    'selection.scrollIntoView': selection.scrollIntoView,
    'ui.message': ui.message,
    'ui.prompt': ui.prompt,
    'ui.form': ui.form,
    'ui.status': ui.status,
    'ui.progress': ui.progress,
    'edit.label': edit.label,
    'edit.symbols': edit.symbols,
    'env.settings': env.settings,
    'env.docLanguage': env.docLanguage,
  };

  return {
    call(method, args) {
      if (!(API_METHODS as readonly string[]).includes(method)) {
        return Promise.reject(new ScriptApiError(`unknown API method "${method}"`));
      }
      const fn = table[method as ApiMethod];
      try {
        return fn(...(Array.isArray(args) ? args : []));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new ScriptApiError(String(error)));
      }
    },
    get stickyStatus() {
      return stickyStatus;
    },
    finish() {
      if (touchedProgress) actions.setProgress(store, null);
      if (touchedStatus && !stickyStatus) actions.setStatusMessage(store, null);
    },
    result() {
      return copy?.changed ? copy.release() : null;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Selection helper                                                         */
/* ------------------------------------------------------------------------ */

function positionFor(state: { doc: PMNode }, position: Position, what: string): number {
  if (!position || typeof position !== 'object' || typeof position.nodeId !== 'string') {
    throw new ScriptApiError(`${what}: expected {nodeId, offset}`);
  }
  const found = findNodeById(state.doc, position.nodeId);
  if (!found) throw new ScriptApiError(`${what}: node "${position.nodeId}" is not mounted`);
  const offset = Math.max(0, Math.min(Number(position.offset) || 0, found.node.content.size));
  return found.pos + 1 + offset;
}

/**
 * Moves the Body selection to `anchor` (a caret) or to the range `anchor`..`head`, which may
 * span several text blocks of the mounted window; the window is moved onto the anchor's
 * section first. Shared by `selection.set` and the test hooks (`__mfbeTest.scripts.selectRange`).
 */
export function setBodySelection(
  ctrl: BodyEditorController,
  anchor: Position,
  head: Position | undefined,
  what = 'selection.set',
): void {
  if (!anchor || typeof anchor !== 'object' || !ctrl.moveWindowTo(String(anchor.nodeId))) {
    throw new ScriptApiError(`${what}: unknown nodeId "${anchor?.nodeId}"`, 'unknownNode');
  }
  const state = ctrl.editorState;
  if (!state) throw new ScriptApiError('the Body editor is not available');
  const from = positionFor(state, anchor, what);
  const to = head ? positionFor(state, head, what) : from;
  ctrl.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView());
}

/* ------------------------------------------------------------------------ */
/* Search helpers                                                           */
/* ------------------------------------------------------------------------ */

interface Textblock {
  nodeId: string;
  text: string;
  json: ModelNodeJson;
}

function textblocksIn(document: Document, within: ModelNodeJson | null): Textblock[] {
  const out: Textblock[] = [];
  const visit = (json: ModelNodeJson) => {
    if (json.type === 'text') return;
    if (TEXTBLOCK_TYPES.has(json.type)) {
      const nodeId = json.attrs?.nodeId;
      if (typeof nodeId === 'string' && nodeId) out.push({ nodeId, text: plainText(json), json });
      return;
    }
    for (const child of json.content ?? []) visit(child);
  };
  if (within) visit(within);
  else for (const body of document.bodies) visit(body as unknown as ModelNodeJson);
  return out;
}

function searchRegExp(query: FindQuery, what: string): RegExp {
  if (typeof query.text !== 'string' || !query.text) {
    throw new ScriptApiError(`${what}: query.text is required`);
  }
  const re = buildSearchRegExp({
    query: query.text,
    regex: !!query.regex,
    matchCase: !!query.matchCase,
    wholeWord: !!query.wholeWord,
  });
  if (!re) throw new ScriptApiError(`${what}: invalid regular expression "${query.text}"`);
  return re;
}

interface Expanded {
  text: string;
  ranges: { start: number; length: number; strong: boolean; emphasis: boolean }[];
}

/** Replaces `[from, to)` of the text block whose content starts at `contentStart`. */
function replaceRange(
  tr: Transform,
  contentStart: number,
  from: number,
  to: number,
  expanded: Expanded,
) {
  const start = contentStart + from;
  const end = contentStart + to;
  const marks = tr.doc.resolve(start).marks();
  if (expanded.text) tr.replaceWith(start, end, fb2Schema.text(expanded.text, marks));
  else tr.delete(start, end);
  for (const range of expanded.ranges) {
    const a = start + range.start;
    const b = a + range.length;
    if (range.strong) tr.addMark(a, b, fb2Schema.marks.strong!.create());
    if (range.emphasis) tr.addMark(a, b, fb2Schema.marks.emphasis!.create());
  }
}

/** Applies the replacements to an unmounted block through a detached ProseMirror transform. */
function rebuildBlock(
  json: ModelNodeJson,
  matches: RegExpExecArray[],
  expand: (match: RegExpExecArray) => Expanded,
): ModelNodeJson {
  const node = nodeFromModel(json);
  if (!node) return json;
  // A temporary section holding only this block gives content positions starting at 2.
  const holder = fb2Schema.nodes.doc!.create(null, [
    nodeTypeFor('section')!.create(null, Fragment.from([node])),
  ]);
  const transform = new Transform(holder);
  const contentStart = 2; // doc > section(0) > block(1) > content(2)
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const m = matches[i]!;
    replaceRange(transform, contentStart, m.index, m.index + m[0].length, expand(m));
  }
  const rebuilt = transform.doc.firstChild?.firstChild;
  return rebuilt ? nodeToModel(rebuilt) : json;
}

function markFor(mark: unknown, what: string) {
  if (typeof mark === 'string') {
    if (!MARK_NAMES.has(mark)) throw new ScriptApiError(`${what}: unknown mark "${mark}"`);
    return fb2Schema.marks[mark]!.create();
  }
  const spec = asObject<{ style?: string; link?: string; note?: boolean }>(mark, what);
  if (typeof spec.style === 'string') return fb2Schema.marks.style!.create({ name: spec.style });
  if (typeof spec.link === 'string') {
    return fb2Schema.marks.link!.create({ href: spec.link, type: spec.note ? 'note' : null });
  }
  throw new ScriptApiError(`${what}: expected a mark name, {style} or {link}`);
}
