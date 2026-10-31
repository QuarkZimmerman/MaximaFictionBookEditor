// Helper of the "Маркеры сносок" scripts converted from FictionBook Editor 2.7.9 (group 32) that
// edit paragraphs of the page: 60, 70 and 71 carry byte-identical copies (the sandbox only loads
// modules from the script's own folder), beside lib/nav-lib.js, copied unchanged.
//
// FictionBook Editor showed the book as one HTML element, fbw_body: the book's annotation and its
// history (each an empty paragraph when the book has none), then every body; each text block was a
// <P> - paragraphs, title lines, verses, subtitles, text authors, dates, table cells - and so was
// an empty line. lib/nav-lib.js rebuilds that page from the document model (loadBook: `ps` are
// the <P> in document order) with the selection in it (locate). Here: the paragraphs of the
// selection, and the writing back of changed paragraphs - the bodies' with doc.replaceNode, the
// annotation's and the history's with one doc.setDescription.

import { loadBook, locate, t } from './nav-lib.js';

export { loadBook, t };

/**
 * The page and the selection in it: `{ book, where }`, or null when there is no text selection
 * (no book, a caret only, or a selected picture).
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

/** Whether a page paragraph holds text (not an empty line, not a description block's placeholder). */
export function hasContent(item) {
  return item.kind === 'p' && item.type !== 'empty-line' && !item.isPlaceholder && !!item.nodeId;
}

/** The page's part holding the item: 'annotation', 'history' or 'body'. */
function regionOf(item) {
  let node = item;
  while (node.parent && node.parent.type !== 'root') node = node.parent;
  if (node.type === 'annotation-block') return 'annotation';
  if (node.type === 'history-block') return 'history';
  return 'body';
}

/** `{ parent, index }` of the node with this id inside a description tree, or null. */
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

/** The changed paragraphs: the bodies' written at once, the description's at commit(). */
export class PageEdits {
  constructor() {
    this.pending = [];
    this.count = 0;
  }

  async put(item, node) {
    const region = regionOf(item);
    if (region === 'body') await mfbe.doc.replaceNode({ nodeId: item.nodeId, type: item.type }, node);
    else this.pending.push({ item, node, region });
    item.node = node;
    item.type = node.type;
    this.count += 1;
  }

  async commit() {
    if (!this.pending.length) return;
    const description = (await mfbe.doc.get()).description;
    for (const { item, node, region } of this.pending) {
      const holder = region === 'annotation' ? description.titleInfo?.annotation : description.documentInfo?.history;
      const place = findIn(holder, item.nodeId);
      if (place) place.parent.content[place.index] = { ...node, attrs: { ...(node.attrs ?? {}), nodeId: item.nodeId } };
    }
    this.pending = [];
    await mfbe.doc.setDescription(description);
  }
}
