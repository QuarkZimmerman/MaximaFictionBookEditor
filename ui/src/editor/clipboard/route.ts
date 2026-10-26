/**
 * The one paste router of the Body view (feature 006; FR-004 for pastes, FR-011, FR-012,
 * FR-046; C4, C43, C47; I14; U30; decision 4; data-model §8.1 to §8.3, §8.7; resource-formats.md
 * §20; research R5.1, R5.6 to R5.8). Every paste - a real paste event, `view.pasteHTML()` and
 * Edit → Paste (`pasteData`) - comes here through the clipboard plugin
 * (`ui/src/editor/plugins/clipboard.ts`), as one transaction:
 *
 * - **First the selection**: a selected table is removed at its place through `removeTable`
 *   (the *Delete table* transform), a selected block image through `deleteSelection`, a text
 *   selection is deleted (decision 4; a block stays for its own rule). The rule then runs at the
 *   resulting caret - or at the place the removed node stood (U30) -; a refused paste returns
 *   null, so the selection and the document stay as they were.
 * - **An own single table** (a block's `content()` or a whole table, C43): with the caret in a
 *   cell or a block selected, the paste-block plan anchored at the caret's cell or the block's
 *   top-left position, committed by `commitTableEdit`; elsewhere a new table, its grid kept
 *   (`normalisePastedBlock`; analyze decision 4), at the FR-004 point, or the status-bar message
 *   `tables.msg.pasteNoPlace` without one (US4 sc.7). Pasted `table`, `td` and `th` ids the book
 *   uses are removed (`dedupeIds`, C47).
 * - **Any other content** in a cell or over a block (cleared first) goes in as one inline run:
 *   inline content and one line of text as they are, everything else - several lines, own mixed
 *   content, foreign HTML - joined with single spaces (`joinInlineParts`; decision 5), so no
 *   paste splits a table. Elsewhere it goes through today's `insertSlice` unchanged (US9 adds
 *   foreign tables).
 * - `DISCRETE_STEP` exactly for table pastes, cell overwrites, joins into a cell, block clears
 *   and a replaced table; the NBSP marker is converted on every input kind (own HTML by the
 *   marker plugin's `transformPasted`, as today; the JSON flavour holds the real characters).
 * - Pasted nodes get their node ids from `opts.nextNodeId` before dispatch (`stampNodeIds`,
 *   R5.8), so the node-id plugin has nothing left to append.
 *
 * The module imports only `ui/src/model/` and `ui/src/editor/`.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { applyTablePoint, findTablePoint } from '../commands/tableInsertion';
import { DISCRETE_STEP } from '../commands/util';
import {
  flattenToParagraphs,
  insertSlice,
  isInlineSlice,
  sliceFromExternalHtml,
  sliceFromPlainText,
  withoutNodeIds,
} from '../plugins/clipboard';
import { currentNbspMarker, markersToNbsp } from '../plugins/nbsp';
import { assignNodeIds } from '../schema';
import { commitTableEdit, isRefusal, removeTable, tableTarget } from '../table/edit';
import { joinInlineParts, normalisePastedBlock, pasteBlockPlan } from '../table/ops';
import { CellBlockSelection, cellRefAround } from '../table/selection';

/** What a paste brings: the editor's own slice, another program's HTML, or plain text. */
export type PasteInput =
  | { kind: 'own'; slice: Slice }
  | { kind: 'foreign'; html: string }
  | { kind: 'text'; text: string };

/** What the router needs from its host (I14): the Body controller or a rich field. */
export interface ClipboardOptions {
  /** Every FB2 id of the book (`collectBookIds`), for the pasted ids (C47). */
  bookIds(): ReadonlySet<string>;
  /** The host's node-id generator (data-model §1.6). */
  nextNodeId(): string;
  /** Shows a catalogue text in the status bar (a refused paste). */
  message(key: string): void;
}

/** The editor's own content as classified (C43). */
export type OwnContent =
  | { kind: 'table'; table: PMNode }
  | { kind: 'inline'; slice: Slice }
  | { kind: 'mixed'; slice: Slice };

/* ------------------------------------------------------------------------ */
/* Classification (C43; data-model §8.2)                                    */
/* ------------------------------------------------------------------------ */

/**
 * True for HTML the editor wrote: a `fb-` class on the slice root - the element carrying
 * `data-pm-slice`, below the wrappers ProseMirror adds there (`-N`), else the body's first
 * element. `data-pm-slice` alone never counts: every ProseMirror editor writes it (C43).
 */
export function isOwnHtml(html: string): boolean {
  if (!html.includes('fb-')) return false;
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  let root: Element | null = dom.querySelector('[data-pm-slice]');
  if (root) {
    const wrappers = /^\d+ \d+ -(\d+)/.exec(root.getAttribute('data-pm-slice') ?? '');
    for (let count = Number(wrappers?.[1] ?? 0); count > 0 && root; count -= 1) {
      root = root.firstElementChild;
    }
  } else {
    root = dom.body.firstElementChild;
  }
  return !!root && [...root.classList].some((name) => name.startsWith('fb-'));
}

/**
 * The editor's own slice classified (C43; data-model §8.2): the wrappers both ends share are
 * stripped first (a single child while the open start and end are above 0); then one closed
 * table is an own single table - a block's `content()` or a whole table -, inline content (a word
 * copied inside one cell) is inline, never a 1 × 1 block, and anything else - a slice cut by a
 * table edge included - is mixed.
 */
export function classifyOwnSlice(slice: Slice): OwnContent {
  let { content, openStart, openEnd } = slice;
  while (openStart > 0 && openEnd > 0 && content.childCount === 1) {
    const only = content.firstChild!;
    if (only.isInline || only.isLeaf) break;
    content = only.content;
    openStart -= 1;
    openEnd -= 1;
  }
  const first = content.firstChild;
  if (
    content.childCount === 1 &&
    openStart === 0 &&
    openEnd === 0 &&
    first!.type.name === 'table'
  ) {
    return { kind: 'table', table: first! };
  }
  let inline = content.childCount > 0;
  content.forEach((node) => {
    if (!node.isInline) inline = false;
  });
  return inline ? { kind: 'inline', slice: new Slice(content, 0, 0) } : { kind: 'mixed', slice };
}

/* ------------------------------------------------------------------------ */
/* Ids and node ids (C47; data-model §8.7; R5.8)                            */
/* ------------------------------------------------------------------------ */

const ID_NODES: ReadonlySet<string> = new Set(['table', 'td', 'th']);

/**
 * `node` without the `table`, `td` and `th` ids that `bookIds` holds (C47); paragraph and section
 * ids are left as they are. The same node when nothing changes.
 */
export function dedupeIds(node: PMNode, bookIds: ReadonlySet<string>): PMNode {
  const id = node.attrs.id;
  const drop = ID_NODES.has(node.type.name) && typeof id === 'string' && bookIds.has(id);
  let changed = false;
  const children: PMNode[] = [];
  if (node.type.name === 'table' || node.type.name === 'tr') {
    node.forEach((child) => {
      const next = dedupeIds(child, bookIds);
      if (next !== child) changed = true;
      children.push(next);
    });
  }
  if (!drop && !changed) return node;
  return node.type.create(
    drop ? { ...node.attrs, id: null } : node.attrs,
    changed ? Fragment.from(children) : node.content,
    node.marks,
  );
}

/**
 * The pasted nodes with fresh node ids: every id of the clipboard stripped (`withoutNodeIds`),
 * then one from `nextNodeId` on every node that takes one (`assignNodeIds`, pre-order).
 */
export function stampNodeIds(fragment: Fragment, nextNodeId: () => string): Fragment {
  const out: PMNode[] = [];
  withoutNodeIds(fragment).forEach((node) => {
    out.push(assignNodeIds(node, nextNodeId));
  });
  return Fragment.from(out);
}

/**
 * Node ids for the nodes a transaction created without one (today's `insertSlice` strips them),
 * in the same transaction: the node-id plugin then has nothing to append.
 */
function assignMissingNodeIds(tr: Transaction, nextNodeId: () => string): Transaction {
  if (!tr.docChanged) return tr;
  const size = tr.doc.content.size;
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  const seen = new Set<number>();
  const missing: number[] = [];
  for (const [start, end] of ranges) {
    const from = Math.max(0, Math.min(start, size));
    const to = Math.max(from, Math.min(end, size));
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText || seen.has(pos)) return;
      seen.add(pos);
      if (node.type.spec.attrs?.nodeId && !node.attrs.nodeId) missing.push(pos);
    });
  }
  for (const pos of missing) tr.setNodeAttribute(pos, 'nodeId', nextNodeId());
  return tr;
}

/* ------------------------------------------------------------------------ */
/* The router (data-model §8.3)                                             */
/* ------------------------------------------------------------------------ */

/** The input as the router routes it. */
type Pasted =
  /** An own single table. */
  | { kind: 'table'; table: PMNode }
  /** Inline content or one line of text: as it is, without `DISCRETE_STEP`. */
  | { kind: 'inline'; run: Fragment; slice: Slice }
  /** Several lines, own mixed content, foreign HTML: joined in a cell; `slice` elsewhere. */
  | { kind: 'join'; slice: Slice };

function readInput(state: EditorState, input: PasteInput): Pasted {
  const marker = currentNbspMarker(state);
  if (input.kind === 'own') {
    const own = classifyOwnSlice(input.slice);
    if (own.kind === 'table') return own;
    if (own.kind === 'inline')
      return { kind: 'inline', run: own.slice.content, slice: input.slice };
    return { kind: 'join', slice: input.slice };
  }
  if (input.kind === 'foreign') {
    return { kind: 'join', slice: markersToNbsp(sliceFromExternalHtml(input.html), marker) };
  }
  const slice = markersToNbsp(sliceFromPlainText(input.text), marker);
  return isInlineSlice(slice)
    ? { kind: 'inline', run: slice.content, slice }
    : { kind: 'join', slice };
}

/** The inline content of the slice's text blocks, joined into one run (decision 5). */
function joined(slice: Slice): Fragment {
  return joinInlineParts(
    flattenToParagraphs(slice.content).map((node) =>
      node.isTextblock ? node.content : Fragment.empty,
    ),
  );
}

/** True when an end of the selection lies in a table cell. */
function touchesTable(selection: Selection): boolean {
  return !!cellRefAround(selection.$from) || !!cellRefAround(selection.$to);
}

/**
 * The place a removed node stood: inside the empty `p` that took its place (`filled`), else the
 * gap between its former siblings - never the selection ProseMirror maps through the deletion,
 * which moves forward into the next sibling's text or out of the container (U30).
 */
function placeOf(tr: Transaction, nodePos: number, filled: boolean): number {
  const left = tr.mapping.map(nodePos, -1);
  return filled ? left + 1 : left;
}

/**
 * The paste of `input` on `state` as one transaction (data-model §8.3), or null for a refusal -
 * no point for a table, a too-large target -, after `opts.message` showed why.
 */
export function pasteTransaction(
  state: EditorState,
  input: PasteInput,
  opts: ClipboardOptions,
): Transaction | null {
  const pasted = readInput(state, input);
  const tr = state.tr;
  const { selection } = state;
  let place: number | null = null;
  let tableRemoved = false;
  // A paste first replaces the selection (decision 4); a selected node at its place (U30).
  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    let filled = false;
    removeTable(tr, selection.from, () => {
      filled = true;
      return opts.nextNodeId();
    });
    place = placeOf(tr, selection.from, filled);
    tableRemoved = true;
  } else if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
    tr.deleteSelection();
    place = placeOf(tr, selection.from, false);
  } else if (!(selection instanceof CellBlockSelection) && !selection.empty) {
    tr.deleteSelection();
  }
  const found =
    place === null
      ? tableTarget(EditorState.create({ doc: tr.doc, selection: tr.selection }))
      : null;
  const inCell =
    found && (found.selection === 'cell' || found.selection === 'block') ? found : null;

  if (pasted.kind === 'table') {
    const bookIds = opts.bookIds();
    const ctx = { nextId: opts.nextNodeId, bookIds };
    if (inCell) {
      const edit = pasteBlockPlan(inCell.address, dedupeIds(pasted.table, bookIds), ctx);
      if (isRefusal(edit)) {
        opts.message(`tables.reason.${edit.refused}`);
        return null;
      }
      if (!commitTableEdit(tr, inCell.tablePos, edit)) return null;
      return assignMissingNodeIds(tr, opts.nextNodeId);
    }
    const block = normalisePastedBlock(pasted.table, { keepRows: false }, ctx);
    const table = stampNodeIds(
      Fragment.from(dedupeIds(block, bookIds)),
      opts.nextNodeId,
    ).firstChild!;
    const point = findTablePoint(tr.doc, place ?? tr.selection.to);
    if (!point) {
      opts.message('tables.msg.pasteNoPlace');
      return null;
    }
    applyTablePoint(tr, point, table, opts.nextNodeId);
    return assignMissingNodeIds(tr.setMeta(DISCRETE_STEP, true), opts.nextNodeId);
  }

  if (inCell) {
    // One inline run at the caret, or in the cleared block's top-left cell.
    const run = stampNodeIds(
      pasted.kind === 'inline' ? pasted.run : joined(pasted.slice),
      opts.nextNodeId,
    );
    if (tr.selection instanceof CellBlockSelection) {
      tr.replaceSelection(new Slice(run, 0, 0));
      return assignMissingNodeIds(tr.setMeta(DISCRETE_STEP, true), opts.nextNodeId);
    }
    if (run.size === 0 && !tr.docChanged) return null;
    if (run.size > 0) tr.replaceSelection(new Slice(run, 0, 0));
    if (pasted.kind === 'join') tr.setMeta(DISCRETE_STEP, true);
    return assignMissingNodeIds(tr, opts.nextNodeId);
  }

  // Elsewhere: today's insertSlice - on the state itself unless a table was removed or the
  // selection reached into a table, else at the place the paste goes, in the same transaction.
  if (!tableRemoved && place === null && !touchesTable(selection)) {
    return assignMissingNodeIds(insertSlice(state, pasted.slice), opts.nextNodeId);
  }
  let at: Selection = tr.selection;
  if (place !== null) {
    const $place = tr.doc.resolve(place);
    const paragraph = tr.doc.type.schema.nodes.p!;
    if ($place.parent.isTextblock) at = TextSelection.create(tr.doc, place);
    else if ($place.parent.canReplaceWith($place.index(), $place.index(), paragraph)) {
      tr.insert(place, paragraph.create({ nodeId: opts.nextNodeId() }));
      at = TextSelection.create(tr.doc, place + 1);
    } else at = Selection.near($place);
  }
  const inserted = insertSlice(EditorState.create({ doc: tr.doc, selection: at }), pasted.slice);
  for (const step of inserted.steps) tr.step(step);
  tr.setSelection(Selection.fromJSON(tr.doc, inserted.selection.toJSON()));
  if (tableRemoved) tr.setMeta(DISCRETE_STEP, true);
  return assignMissingNodeIds(tr, opts.nextNodeId);
}

/**
 * Routes one paste on the view (I14): dispatches `pasteTransaction` with `scrollIntoView`; true
 * also for a refusal, which only showed its message.
 */
export function routePaste(view: EditorView, input: PasteInput, opts: ClipboardOptions): boolean {
  const tr = pasteTransaction(view.state, input, opts);
  if (tr) view.dispatch(tr.scrollIntoView());
  return true;
}
