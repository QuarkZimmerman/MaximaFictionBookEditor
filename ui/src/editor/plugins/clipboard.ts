/**
 * Clipboard handling of the Body editor (T065).
 *
 * Copy / cut write three flavours: the structured slice as `application/x-mfbe-fb2+json`
 * (lossless inside the editor: a poem stays a poem), `text/html` (ProseMirror's serialisation
 * with the `fb-*` classes, readable by other editors) and `text/plain`.
 *
 * Paste prefers the structured flavour; the slice is inserted with its structure where the
 * schema accepts it at the caret and flattened to plain paragraphs otherwise (FR-030, spec US2
 * scenario 6). HTML from other applications (no structured flavour, no ProseMirror marker) is
 * always flattened to paragraphs keeping only the supported inline styles; plain text becomes
 * one paragraph per line. Images in pasted content are handled by US7 (`features/images`).
 */

import { DOMParser as PMDOMParser, Fragment, Node as PMNode, Slice } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { fb2Schema } from '../schema';
import { N, PARAGRAPH_TYPES } from '../commands/util';

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
    if (payload.format !== 'mfbe-fb2' || !payload.slice) return null;
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

/** Applies pasted data (structured JSON, HTML or plain text) to the view. */
export function pasteData(view: EditorView, data: PasteData): boolean {
  const structured = data.json ? sliceFromPayload(data.json) : null;
  if (structured) {
    view.dispatch(insertSlice(view.state, structured).scrollIntoView());
    return true;
  }
  if (data.html) {
    // ProseMirror's own HTML (another MFBE window) keeps its structure where legal.
    if (/data-pm-slice=/.test(data.html)) return view.pasteHTML(data.html);
    view.dispatch(insertSlice(view.state, sliceFromExternalHtml(data.html)).scrollIntoView());
    return true;
  }
  if (data.text) {
    view.dispatch(insertSlice(view.state, sliceFromPlainText(data.text)).scrollIntoView());
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------------ */
/* Plugin                                                                   */
/* ------------------------------------------------------------------------ */

export function clipboardPlugin(): Plugin {
  return new Plugin({
    key: clipboardPluginKey,
    props: {
      transformPasted: (slice) => stripNodeIds(slice),
      handleDOMEvents: {
        copy: (view, event) => writeClipboard(view, event, false),
        cut: (view, event) => writeClipboard(view, event, true),
      },
      handlePaste(view, event, slice) {
        const data = event.clipboardData;
        if (!data) return false;
        const json = data.getData(MFBE_CLIPBOARD_MIME);
        if (json) {
          const structured = sliceFromPayload(json);
          if (structured) {
            view.dispatch(insertSlice(view.state, structured).scrollIntoView());
            return true;
          }
        }
        const html = data.getData('text/html');
        if (html && !/data-pm-slice=/.test(html)) {
          view.dispatch(insertSlice(view.state, sliceFromExternalHtml(html)).scrollIntoView());
          return true;
        }
        if (!html) {
          const text = data.getData('text/plain');
          if (text) {
            view.dispatch(insertSlice(view.state, sliceFromPlainText(text)).scrollIntoView());
            return true;
          }
          return false;
        }
        // ProseMirror HTML from another editor window: fit or flatten.
        view.dispatch(insertSlice(view.state, slice).scrollIntoView());
        return true;
      },
    },
  });
}

function writeClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
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
  if (cut && view.editable) {
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  }
  return true;
}
