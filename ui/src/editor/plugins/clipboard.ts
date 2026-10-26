/**
 * Clipboard handling of the Body editor (T065).
 *
 * Copy / cut write three flavours: the structured slice as `application/x-mfbe-fb2+json`
 * (lossless inside the editor: a poem stays a poem), `text/html` (ProseMirror's serialisation
 * with the `fb-*` classes, readable by other editors) and `text/plain`.
 *
 * Paste prefers the structured flavour; the slice is inserted with its structure where the
 * schema accepts it at the caret and flattened to plain paragraphs otherwise (FR-030, spec US2
 * scenario 6). HTML from other applications (no structured flavour, no `fb-` class on its slice
 * root) is always flattened to paragraphs keeping only the supported inline styles; plain text
 * becomes one paragraph per line. Images in pasted content are handled by US7
 * (`features/images`).
 *
 * Feature 006 (C4, I14; data-model §8.1): `clipboardPlugin(opts)` routes every paste of its host
 * through the one router of `ui/src/editor/clipboard/route.ts` - a real paste event read before
 * ProseMirror parses anything (`handleDOMEvents.paste`), `view.pasteHTML()` (`handlePaste`) and
 * Edit → Paste (`pasteData`, with the options the plugin carries) - so tables paste by position
 * and by FR-004, and no paste splits a table. US9 (FR-060; data-model §8.8): a copied table or
 * block reaches other programs as an HTML table and as tab-separated text (`copyOut.ts`, as the
 * plugin's `clipboardSerializer`, `clipboardTextSerializer` and `transformCopied`), and the cut
 * of a selected table removes it through the *Delete table* transform (C24).
 */

import { DOMParser as PMDOMParser, Fragment, Node as PMNode, Slice } from 'prosemirror-model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { clipboardText, tableClipboardSerializer, transformCopied } from '../clipboard/copyOut';
import { isOwnHtml, routePaste, type ClipboardOptions } from '../clipboard/route';
import { deleteTableTransform } from '../table/edit';
import { createNodeIdGenerator, fb2Schema } from '../schema';
import { N, PARAGRAPH_TYPES } from '../commands/util';

export type { ClipboardOptions, PasteInput } from '../clipboard/route';

export const MFBE_CLIPBOARD_MIME = 'application/x-mfbe-fb2+json';
/** Chromium exposes custom formats written with the async clipboard API under this prefix. */
export const MFBE_CLIPBOARD_WEB_MIME = `web ${MFBE_CLIPBOARD_MIME}`;

export const clipboardPluginKey = new PluginKey('mfbe-clipboard');

export interface ClipboardPayload {
  format: 'mfbe-fb2';
  version: 1;
  slice: ReturnType<Slice['toJSON']>;
}

/* ------------------------------------------------------------------------ */
/* Normalisation                                                            */
/* ------------------------------------------------------------------------ */

/** Every text block of `fragment` as a plain paragraph (inline content and marks kept). */
export function flattenToParagraphs(fragment: Fragment): PMNode[] {
  const out: PMNode[] = [];
  let pending: PMNode[] = [];
  const flush = () => {
    if (pending.length > 0) out.push(N.p!.create(null, pending));
    pending = [];
  };
  const visit = (node: PMNode) => {
    if (node.isInline) {
      pending.push(node);
      return;
    }
    flush();
    if (node.isTextblock) out.push(N.p!.create(null, node.content));
    else if (node.type === N.empty_line) out.push(N.empty_line!.create());
    else node.forEach(visit);
  };
  fragment.forEach(visit);
  flush();
  const nonEmpty = out.filter((p) => p.type !== N.p || p.content.size > 0);
  return nonEmpty.length > 0 ? nonEmpty : out.slice(0, 1);
}

/** True when the slice is inline-only (text within a single block). */
export function isInlineSlice(slice: Slice): boolean {
  let inline = true;
  slice.content.forEach((node) => {
    if (!node.isInline) inline = false;
  });
  return inline;
}

/** Characters of the slice's text blocks (inline leaves count as one). */
function sliceTextLength(fragment: Fragment): number {
  let length = 0;
  fragment.descendants((node) => {
    if (node.isText) length += node.nodeSize;
    else if (node.isInline) length += 1;
    return true;
  });
  return length;
}

function docTextLength(doc: PMNode): number {
  return sliceTextLength(doc.content);
}

/** Number of block containers (non-text, non-leaf blocks) in a fragment. */
function containerCount(fragment: Fragment): number {
  let count = 0;
  fragment.descendants((node) => {
    if (node.isBlock && !node.isTextblock && !node.isLeaf) count += 1;
    return true;
  });
  return count;
}

/** Number of text blocks in a fragment. */
function textblockCount(fragment: Fragment): number {
  let count = 0;
  fragment.descendants((node) => {
    if (node.isTextblock) count += 1;
    return !node.isTextblock;
  });
  return count;
}

/**
 * True when `attempt` is not an acceptable structured paste of `slice`: inline content was
 * dropped (the schema refused part of it), an ancestor of the caret was split to make room for
 * the slice (more containers than before plus the slice's own), separate lines of the slice
 * were merged into one block (an open slice fitted as inline text), or the text landed outside
 * the caret's container (a paste into a title must stay in the title).
 */
function structuredPasteFailed(state: EditorState, slice: Slice, attempt: Transaction): boolean {
  const selected = state.selection.content().content;
  const sliceText = sliceTextLength(slice.content);
  const expected = docTextLength(state.doc) - sliceTextLength(selected) + sliceText;
  if (docTextLength(attempt.doc) < expected) return true;
  const containersBefore = containerCount(state.doc.content) - containerCount(selected);
  if (containerCount(attempt.doc.content) > containersBefore + containerCount(slice.content)) {
    return true;
  }
  // The first block of an open slice merges with the caret's block; every other one must stay.
  const blocksBefore = textblockCount(state.doc.content) - textblockCount(selected);
  if (textblockCount(attempt.doc.content) < blocksBefore + textblockCount(slice.content) - 1) {
    return true;
  }
  const { $from } = state.selection;
  if ($from.depth >= 2) {
    const containerPos = $from.before($from.depth - 1);
    const before = state.doc.nodeAt(containerPos)!;
    const after = attempt.doc.nodeAt(attempt.mapping.map(containerPos, -1));
    if (!after || after.type !== before.type) return true;
    const insideBefore = sliceTextLength(before.content) - sliceTextLength(selected);
    if (sliceTextLength(after.content) < insideBefore + sliceText) return true;
  }
  return false;
}

/**
 * Inserts `slice` at the selection: with its structure when ProseMirror can fit it, otherwise
 * as plain paragraphs (and finally as blocks of the caret's own paragraph type, e.g. verses).
 * Returns the transaction (not yet dispatched).
 */
export function insertSlice(state: EditorState, pasted: Slice): Transaction {
  const slice = stripNodeIds(pasted);
  const structured = state.tr.replaceSelection(slice);
  if (isInlineSlice(slice) || !structuredPasteFailed(state, slice, structured)) return structured;

  const paragraphs = flattenToParagraphs(slice.content);
  const flat = new Slice(Fragment.from(paragraphs), 1, 1);
  const attempt = state.tr.replaceSelection(flat);
  if (!structuredPasteFailed(state, flat, attempt)) return attempt;

  const blockType = state.selection.$from.parent.type;
  if (PARAGRAPH_TYPES.has(blockType.name) && blockType !== N.p) {
    const blocks = paragraphs.map((p) => (p.type === N.p ? blockType.create(null, p.content) : p));
    return state.tr.replaceSelection(new Slice(Fragment.from(blocks), 1, 1));
  }
  return attempt;
}

/** Parses external HTML to paragraphs with supported marks only. */
export function sliceFromExternalHtml(html: string): Slice {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  const parsed = PMDOMParser.fromSchema(fb2Schema).parseSlice(dom.body, {
    preserveWhitespace: false,
  });
  const paragraphs = flattenToParagraphs(parsed.content);
  if (paragraphs.length === 1 && paragraphs[0]!.type === N.p) {
    return new Slice(paragraphs[0]!.content, 0, 0);
  }
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

/** Plain text -> one paragraph per line (blank lines become empty lines). */
export function sliceFromPlainText(text: string): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = lines.map((line) =>
    line.trim() === '' ? N.empty_line!.create() : N.p!.create(null, fb2Schema.text(line)),
  );
  // A single line pastes inline.
  if (paragraphs.length === 1 && paragraphs[0]!.type === N.p) {
    return new Slice(paragraphs[0]!.content, 0, 0);
  }
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

/** Copies of nodes must not share node ids with their originals (the plugin re-assigns). */
export function withoutNodeIds(fragment: Fragment): Fragment {
  const children: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      children.push(node);
      return;
    }
    const attrs = node.type.spec.attrs?.nodeId ? { ...node.attrs, nodeId: null } : node.attrs;
    children.push(node.type.create(attrs, withoutNodeIds(node.content), node.marks));
  });
  return Fragment.from(children);
}

export function stripNodeIds(slice: Slice): Slice {
  return new Slice(withoutNodeIds(slice.content), slice.openStart, slice.openEnd);
}

/* ------------------------------------------------------------------------ */
/* Payload                                                                  */
/* ------------------------------------------------------------------------ */

export function payloadFromSlice(slice: Slice): ClipboardPayload {
  return { format: 'mfbe-fb2', version: 1, slice: slice.toJSON() };
}

export function sliceFromPayload(json: string): Slice | null {
  try {
    const payload = JSON.parse(json) as Partial<ClipboardPayload>;
    // Own content is format "mfbe-fb2", version 1 (resource-formats.md §20).
    if (payload.format !== 'mfbe-fb2' || payload.version !== 1 || !payload.slice) return null;
    return Slice.fromJSON(fb2Schema, payload.slice);
  } catch {
    return null;
  }
}

export interface PasteData {
  json?: string | null;
  html?: string | null;
  text?: string | null;
}

/** The options of the router when a view has no clipboard plugin: no book ids, no messages. */
const FALLBACK_OPTIONS: ClipboardOptions = {
  bookIds: () => new Set(),
  nextNodeId: createNodeIdGenerator('ui_paste_'),
  message: () => {},
};

/** The options the clipboard plugin of `state` carries. */
function optionsOf(state: EditorState): ClipboardOptions {
  const spec = clipboardPluginKey.get(state)?.spec as { clipboardOptions?: ClipboardOptions };
  return spec?.clipboardOptions ?? FALLBACK_OPTIONS;
}

/**
 * Applies pasted data (Edit → Paste: structured JSON, HTML or plain text) through the router,
 * with the options the view's clipboard plugin carries: the own flavour; own HTML through
 * `view.pasteHTML`, so ProseMirror's clipboard parser reads its `data-pm-slice` context and the
 * slice comes back through `handlePaste`; foreign HTML; text.
 */
export function pasteData(view: EditorView, data: PasteData): boolean {
  const opts = optionsOf(view.state);
  const structured = data.json ? sliceFromPayload(data.json) : null;
  if (structured) return routePaste(view, { kind: 'own', slice: structured }, opts);
  if (data.html) {
    if (isOwnHtml(data.html)) return view.pasteHTML(data.html);
    return routePaste(view, { kind: 'foreign', html: data.html }, opts);
  }
  if (data.text) return routePaste(view, { kind: 'text', text: data.text }, opts);
  return false;
}

/* ------------------------------------------------------------------------ */
/* Plugin                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A real paste event, read before ProseMirror parses anything (data-model §8.1): the own
 * flavour, else HTML (own HTML through `view.pasteHTML`, foreign HTML as it is), else text; then
 * `preventDefault`. False without a text flavour (the images feature's capture-phase handler
 * has taken image pastes before), while the view is not editable and while it is composing.
 */
function pasteEvent(view: EditorView, event: ClipboardEvent, opts: ClipboardOptions): boolean {
  if (!view.editable || view.composing) return false;
  const data = event.clipboardData;
  if (!data) return false;
  const json = data.getData(MFBE_CLIPBOARD_MIME);
  const structured = json ? sliceFromPayload(json) : null;
  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  if (!structured && !html && !text) return false;
  event.preventDefault();
  if (structured) routePaste(view, { kind: 'own', slice: structured }, opts);
  else if (html) {
    if (isOwnHtml(html)) view.pasteHTML(html, event);
    else routePaste(view, { kind: 'foreign', html }, opts);
  } else routePaste(view, { kind: 'text', text }, opts);
  return true;
}

/** The clipboard plugin of a host, with the router's options (kept on its spec for `pasteData`). */
export function clipboardPlugin(opts: ClipboardOptions): Plugin {
  return new Plugin({
    key: clipboardPluginKey,
    clipboardOptions: opts,
    props: {
      transformPasted: (slice) => stripNodeIds(slice),
      // Copy out (FR-060): ProseMirror runs every plugin's `transformCopied` in plugin order, so
      // the NBSP marker plugin's still runs after this one.
      transformCopied: (slice) => transformCopied(slice),
      clipboardSerializer: tableClipboardSerializer,
      clipboardTextSerializer: (slice) => clipboardText(slice),
      handleDOMEvents: {
        copy: (view, event) => writeClipboard(view, event, false, opts),
        cut: (view, event) => writeClipboard(view, event, true, opts),
        paste: (view, event) => pasteEvent(view, event, opts),
      },
      /** Reached through `view.pasteHTML()` only: the slice ProseMirror parsed from own HTML. */
      handlePaste(view, _event, slice) {
        if (slice.size === 0) return false;
        return routePaste(view, { kind: 'own', slice }, opts);
      },
    },
  });
}

/**
 * The copy or cut of the selection: the own flavour of the selection's own slice, the HTML and
 * the text of `serializeForClipboard` (the table serializer, `clipboardText`); a cut then removes
 * the selection - a table selected as a whole through the *Delete table* transform (C24), which
 * leaves an empty paragraph where its container needs a block, a block of cells by its clear.
 */
function writeClipboard(
  view: EditorView,
  event: ClipboardEvent,
  cut: boolean,
  opts: ClipboardOptions,
): boolean {
  const data = event.clipboardData;
  const { selection } = view.state;
  if (!data || selection.empty) return false;
  const slice = selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  data.clearData();
  data.setData(MFBE_CLIPBOARD_MIME, JSON.stringify(payloadFromSlice(slice)));
  data.setData('text/html', dom.innerHTML);
  data.setData('text/plain', text);
  event.preventDefault();
  if (cut && view.editable) view.dispatch(cutTransaction(view.state, opts.nextNodeId));
  return true;
}

/**
 * The transaction that removes a cut selection: a table selected as a whole through the
 * *Delete table* transform (C24; ProseMirror's `deleteSelection` throws on a section's only
 * table, vR2 X3), every other selection through `deleteSelection` - a block of cells by its
 * clear-block plan (US4).
 */
export function cutTransaction(state: EditorState, nextNodeId: () => string): Transaction {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    return deleteTableTransform(state.tr, selection.from, nextNodeId).scrollIntoView();
  }
  return state.tr.deleteSelection().scrollIntoView();
}
