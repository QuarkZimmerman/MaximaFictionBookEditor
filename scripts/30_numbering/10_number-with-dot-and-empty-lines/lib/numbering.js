// Shared engine of the "'Числовые' скрипты" converted from FictionBook Editor 2.7.9 (group 30):
// numbering or list markers put at the starts of the selected paragraphs, and their removal. Each
// package carries a byte-identical copy (the sandbox only loads modules from the script's own
// folder), beside lib/nav-lib.js and lib/legacy-html.js, copied unchanged from earlier packages.
//
// The page. FictionBook Editor showed the book as one HTML element, fbw_body: the book's
// annotation and its history (each an empty paragraph when the book has none), then the bodies;
// every text block was a <P> - a paragraph, a title line, a verse, a subtitle, a text author, a
// date, a table cell - and so was an empty line (an empty <P>). lib/nav-lib.js rebuilds that page
// from the document model, with the selection in it (loadBook, locate).
//
// What the originals did, and what is reproduced here:
// - The numbering scripts (Sclex, v1.2/1.3; 45 by Haliz and DeepSeek) pasted an empty marker
//   element at each end of the selection and walked the page from the element under the
//   selection's start: the <P> holding the start marker and every <P> met after it, up to and
//   including the one holding the end marker, got the number (or marker) before its content
//   (insertAdjacentHTML("afterbegin", ...): plain text before everything else of the paragraph,
//   outside its formatting). An empty line or a paragraph of spaces only was skipped by the
//   variants "не нумеровать пустые строки" (isLineEmpty) and numbered by the others: such a <P>
//   with text was saved as a paragraph, and the empty paragraph of a missing annotation or history
//   as a new annotation or history with that paragraph.
// - The removal scripts (Sclex, v1.3) walked from the <P> holding the start marker to the one
//   holding the end marker and removed, in each, one (or every) layer of "<number>." / "<number>)"
//   with the spaces after it, counting characters outside the tags of the paragraph's innerHTML
//   (removeSymbolsBeyondTags, kept as written). They meant to leave out a paragraph at whose very
//   start the selection ends (nextPAfterBlockEndP); 2.7.9 missed that test whenever that paragraph
//   directly followed the previous one and then went on to the end of the book - here the walk
//   stops there (a recorded fix). A paragraph left with nothing but white space was saved by
//   FictionBook Editor as an empty line (a verse as a verse holding one space).
// - Afterwards both re-selected the selection between the two markers, which had moved with the
//   text: by the inserted characters, or back by the removed ones before them.

import { NBSP, parseInline, serializeInline } from './legacy-html.js';
import { loadBook, locate, t } from './nav-lib.js';

export { NBSP, t };

/* ------------------------------------------------------------------------------------------ */
/* The page and the selection                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * The page and the selection in it: `{ book, where }` (lib/nav-lib.js), or null when there is no
 * text selection - no book, a caret only (the originals' compareEndPoints test) or a selected
 * picture (the originals stopped with a script error on a picture).
 */
export async function textSelection() {
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where || where.collapsed || where.picture) return null;
  return { book, where };
}

/** The paragraphs from the one holding the selection's start to the one holding its end. */
export function paragraphsOfSelection(book, where) {
  const first = Math.max(0, Math.ceil(where.start.index));
  const last = Math.floor(where.end.index);
  return book.ps.slice(first, last + 1);
}

/**
 * The paragraphs the removal scripts process: those of paragraphsOfSelection, except a last one
 * at whose very start the selection ends (the originals' nextPAfterBlockEndP).
 */
export function paragraphsForRemoval(book, where) {
  const first = Math.max(0, Math.ceil(where.start.index));
  let last = Math.floor(where.end.index);
  if (where.end.item && where.end.item.kind === 'p' && where.end.index === last && where.end.offset === 0 && last > first) {
    last -= 1;
  }
  return book.ps.slice(first, last + 1);
}

/* ------------------------------------------------------------------------------------------ */
/* Paragraphs                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * The originals' isLineEmpty: the paragraph's innerHTML without its tags - an inline picture's
 * <IMG> excepted - holds nothing but spaces and non-breaking spaces. An empty line and the empty
 * paragraph of a missing annotation or history are empty.
 */
export function isLineEmpty(item) {
  if (item.type === 'empty-line' || item.isPlaceholder) return true;
  return (item.node?.content ?? []).every((c) => c.type === 'text' && /^[  ]*$/.test(c.text ?? ''));
}

/** The number of characters a paragraph holds in selection offsets (an inline node is one). */
function contentLength(content) {
  return (content ?? []).reduce((n, c) => n + (c.type === 'text' ? (c.text ?? '').length : 1), 0);
}

/**
 * insertAdjacentHTML("afterbegin", text): the paragraph with `text`, unformatted, before its
 * content. An empty line becomes a paragraph.
 */
export function withTextBefore(item, text) {
  const content = item.node?.content ?? [];
  const first = content[0];
  const next =
    first && first.type === 'text' && !(first.marks ?? []).length
      ? [{ ...first, text: text + (first.text ?? '') }, ...content.slice(1)]
      : [{ type: 'text', text }, ...content];
  const type = item.type === 'empty-line' || item.isPlaceholder ? 'p' : item.type;
  return { type, attrs: { ...(item.node?.attrs ?? {}) }, content: next };
}

// The containers where FictionBook Editor saved an emptied <P> as <empty-line/> (the empty-line
// places of FB2; the two description blocks are annotations).
const EMPTY_LINE_PARENTS = new Set(['section', 'title', 'epigraph', 'annotation', 'cite', 'annotation-block', 'history-block']);

/**
 * The node FictionBook Editor saved for a <P> of this new content (FBDoc.cpp): a <P> - not a
 * table cell - that holds nothing or a single unformatted run of white space became an empty
 * line, or a verse holding one space inside a stanza; where FB2 allows no empty line the block
 * stays.
 */
export function savedNode(item, content) {
  const type = item.type === 'empty-line' || item.isPlaceholder ? 'p' : item.type;
  const attrs = { ...(item.node?.attrs ?? {}) };
  const blank =
    content.length === 0 ||
    (content.length === 1 && content[0].type === 'text' && !(content[0].marks ?? []).length && /^\s*$/.test(content[0].text ?? ''));
  if (blank && type !== 'td' && type !== 'th') {
    const parent = item.parent?.type;
    if (parent === 'stanza') return { type: 'v', attrs, content: [{ type: 'text', text: ' ' }] };
    if (EMPTY_LINE_PARENTS.has(parent)) return { type: 'empty-line', attrs: {} };
  }
  return { type, attrs, content };
}

/* ------------------------------------------------------------------------------------------ */
/* Removing a layer of numbering (the originals' processP, kept as written)                    */
/* ------------------------------------------------------------------------------------------ */

// The original's removeNotAllTagsRegExp: every tag but <IMG> and <A>.
const REMOVE_NOT_ALL_TAGS = /<\/?(?!(IMG|A))[a-z]+( [^>]+)?>/gi;

/** The original's removeSymbolsBeyondTags, as written: characters outside the tags, 1-based. */
export function removeSymbolsBeyondTags(str, beginIndex, howManySymbolsToRemove, substrToInsert) {
  let i = 0;
  let removedSymbolsCnt = 0;
  let insideTag = false;
  const len = str.length;
  let symbolBeyondTagsCnt = 0;
  let str2 = '';
  let ch;
  while (i < len) {
    ch = str.charAt(i);
    if (ch == '<') {
      insideTag = true;
      str2 += ch;
    }
    if (!insideTag && ch != '<' && ch != '>') {
      symbolBeyondTagsCnt++;
      if (symbolBeyondTagsCnt < beginIndex || symbolBeyondTagsCnt + 1 > beginIndex + howManySymbolsToRemove) str2 += ch;
      else {
        if (removedSymbolsCnt == 0) str2 += substrToInsert;
        removedSymbolsCnt++;
      }
    }
    if (insideTag && ch != '<' && ch != '>') str2 += ch;
    if (ch == '>') {
      insideTag = false;
      str2 += ch;
    }
    i++;
  }
  return str2;
}

/**
 * The originals' processP on the paragraph's innerHTML (the notation of lib/legacy-html.js):
 * when its text without the tags (but <IMG> and <A>) starts with `re3`, the characters of that
 * match go. Returns `{ node, removed }` - the node as it was saved, the number of characters
 * removed at the start - or null when the paragraph does not start so.
 */
export function removeLeadingNumbering(item, re3) {
  if (item.kind !== 'p' || item.isPlaceholder || item.type === 'empty-line') return null;
  const extras = [];
  let pInnerHTML = serializeInline(item.node.content ?? [], extras);
  if (pInnerHTML.replace(REMOVE_NOT_ALL_TAGS, '').search(re3) < 0) return null;
  pInnerHTML = pInnerHTML.replace(/&nbsp;/g, NBSP);
  const myPos = pInnerHTML.replace(REMOVE_NOT_ALL_TAGS, '').search(re3) + 1;
  const myLen = pInnerHTML.replace(REMOVE_NOT_ALL_TAGS, '').match(re3)[0].length;
  pInnerHTML = removeSymbolsBeyondTags(pInnerHTML, myPos, myLen, '');
  return { node: savedNode(item, parseInline(pInnerHTML, extras)), removed: myLen };
}

/* ------------------------------------------------------------------------------------------ */
/* Writing the paragraphs back                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** The page's part holding the item: 'annotation', 'history' or 'body'. */
function regionOf(item) {
  let node = item;
  while (node.parent && node.parent.type !== 'root') node = node.parent;
  if (node.type === 'annotation-block') return 'annotation';
  if (node.type === 'history-block') return 'history';
  return 'body';
}

/** Finds the node with this id inside a description tree: `{ parent, index }` or null. */
function findIn(root, nodeId) {
  const stack = root ? [root] : [];
  while (stack.length) {
    const parent = stack.pop();
    const content = parent.content ?? [];
    for (let index = 0; index < content.length; index += 1) {
      const node = content[index];
      if (!node || node.type === 'text') continue;
      if (node.attrs?.nodeId === nodeId) return { parent, index };
      stack.push(node);
    }
  }
  return null;
}

/**
 * The paragraphs a script changed: the bodies' are written at once (doc.replaceNode), the
 * annotation's and the history's with one doc.setDescription at the end (commit). `shift`
 * records, per paragraph, how the selection's offsets there move (characters inserted at the
 * start, or removed from it).
 */
export class PageEdits {
  constructor() {
    this.pending = [];
    this.inserted = new Map();
    this.removed = new Map();
  }

  async put(item, node) {
    const region = regionOf(item);
    if (region === 'body') await mfbe.doc.replaceNode({ nodeId: item.nodeId, type: item.type }, node);
    else this.pending.push({ item, node, region });
    item.node = node;
    item.type = node.type;
  }

  async commit() {
    if (!this.pending.length) return;
    const description = (await mfbe.doc.get()).description;
    for (const { item, node, region } of this.pending) {
      const holderOf = () => (region === 'annotation' ? description.titleInfo?.annotation : description.documentInfo?.history);
      if (item.isPlaceholder) {
        // The empty paragraph of a missing annotation or history: the element is created.
        let holder = holderOf();
        if (!holder) {
          holder = { type: 'annotation', attrs: {}, content: [] };
          if (region === 'annotation') description.titleInfo.annotation = holder;
          else description.documentInfo.history = holder;
        }
        holder.content = [...(holder.content ?? []), node];
        continue;
      }
      const place = findIn(holderOf(), item.nodeId);
      if (place) place.parent.content[place.index] = { ...node, attrs: { ...(node.attrs ?? {}), nodeId: item.nodeId } };
    }
    this.pending = [];
    await mfbe.doc.setDescription(description);
  }

  /** The selection's offset `offset` of paragraph `item` after the edits. */
  offsetAfter(item, offset) {
    const inserted = this.inserted.get(item) ?? 0;
    const removed = this.removed.get(item) ?? 0;
    return Math.max(0, offset + inserted - Math.min(offset, removed));
  }
}

/**
 * Re-selects between the two ends of the original selection, which moved with the text (the
 * originals' tr1.setEndPoint(...) / tr1.select()). An end in a paragraph that is an empty line
 * now goes right after it, to the start of the next text block (the Body view holds no caret on
 * an empty line); the selection is left as it is when an end has no place (the empty paragraph
 * of a description block became a new element, or no text block follows).
 */
export async function reselect(book, where, edits) {
  const isText = (item) => item && item.kind === 'p' && !item.isPlaceholder && item.type !== 'empty-line' && item.nodeId;
  const point = (p) => {
    const item = p.item;
    if (!item || item.kind !== 'p' || item.isPlaceholder) return null;
    if (!isText(item)) {
      const next = book.ps.slice(item.index + 1).find(isText);
      return next ? { nodeId: next.nodeId, offset: 0 } : null;
    }
    const length = contentLength(item.node?.content);
    return { nodeId: item.nodeId, offset: Math.min(length, edits.offsetAfter(item, p.offset)) };
  };
  const anchor = point(where.start);
  const head = point(where.end);
  if (!anchor || !head) return;
  try {
    await mfbe.selection.set(anchor, head);
  } catch (error) {
    if (error?.name !== 'ScriptApiError') throw error;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The two kinds of script                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Puts `prefix(n)` before the content of each paragraph of the selection (n = 1, 2, ...), the
 * empty ones (isLineEmpty) left out when `skipEmpty`. Returns the number of paragraphs numbered.
 */
export async function numberParagraphs(ctx, { book, where }, { prefix, skipEmpty }) {
  const edits = new PageEdits();
  const items = paragraphsOfSelection(book, where);
  let cnt = 1;
  for (let k = 0; k < items.length; k += 1) {
    if (ctx.cancelled) return 0;
    if (k % 200 === 199) await mfbe.ui.progress(k, items.length);
    const item = items[k];
    if (skipEmpty && isLineEmpty(item)) continue;
    const text = prefix(cnt);
    await edits.put(item, withTextBefore(item, text));
    edits.inserted.set(item, text.length);
    cnt++;
  }
  await edits.commit();
  await reselect(book, where, edits);
  return cnt - 1;
}

/** Removes the start matching `re3` of each paragraph the removal walk takes (see above). */
export async function removeNumbering(ctx, { book, where }, re3) {
  const edits = new PageEdits();
  const items = paragraphsForRemoval(book, where);
  for (let k = 0; k < items.length; k += 1) {
    if (ctx.cancelled) return;
    if (k % 200 === 199) await mfbe.ui.progress(k, items.length);
    const item = items[k];
    const done = removeLeadingNumbering(item, re3);
    if (!done) continue;
    edits.removed.set(item, done.removed);
    await edits.put(item, done.node);
  }
  await edits.commit();
  await reselect(book, where, edits);
}
