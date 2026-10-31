// Shared helper of the scripts converted from FictionBook Editor 2.7.9's group
// 16_Поиск форматирования (the "select the next/previous ..." scripts). Each package carries its
// own copy: the sandbox only loads modules from the script's own folder.
//
// FictionBook Editor showed the book in one HTML element (fbw_body): first the book's annotation
// and its history, as DIVs of class "annotation" and "history" that hold one empty paragraph
// when the book has none, then every body. A text block was a P - an empty line an empty P, a
// subtitle a P of class "subtitle", a text author and a poem's date a P of class "text-author",
// a table cell a P of class "td" / "th" - and every container a DIV whose class is the FB2 name
// (a block picture a DIV of class "image"). The scripts walked that tree from the caret. The
// Body view has the same shape - the annotation and history blocks above the first body, with
// an empty paragraph to type into when the book has none - so this module rebuilds it from the
// document model: `loadBook()` gives the tree and its paragraphs in document order, `locate()`
// the selection in it, and the select helpers put the selection where the originals put it.

export const NBSP = '\u00A0';
const OBJECT = '\uFFFC';

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);

// The class FictionBook Editor 2.7.9 gave the element of each model type (files/fb2.xsl).
const CLASS_OF = {
  body: 'body',
  section: 'section',
  title: 'title',
  epigraph: 'epigraph',
  annotation: 'annotation',
  cite: 'cite',
  poem: 'poem',
  stanza: 'stanza',
  table: 'table',
  tr: 'tr',
  image: 'image',
  p: '',
  v: '',
  'empty-line': '',
  subtitle: 'subtitle',
  'text-author': 'text-author',
  date: 'text-author',
  td: 'td',
  th: 'th',
};

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/**
 * The book as FictionBook Editor's fbw_body. Items: `{ kind: 'p' | 'div', type, cls, nodeId,
 * selectId, node, parent, children, at }`; paragraphs (`kind: 'p'`) also carry `index`, their
 * place in `ps`, the paragraphs in document order. `selectId` is what `selection.selectNode`
 * takes for the item (the fixed ids of the two description blocks for them and for their empty
 * paragraph). Without a description (a snapshot over the API's size limit) the two blocks are
 * left out.
 */
export async function loadBook() {
  let description = null;
  let bodies;
  try {
    const doc = await mfbe.doc.get();
    description = doc.description ?? null;
    bodies = doc.bodies ?? [];
  } catch {
    bodies = [];
    for (const ref of await mfbe.doc.getElementsByTagName('body')) {
      bodies.push(await mfbe.doc.getNode(ref));
    }
  }
  const root = { kind: 'div', type: 'root', cls: '', nodeId: null, parent: null, children: [] };
  const ps = [];
  const byId = new Map();
  const add = (parent, item) => {
    item.parent = parent;
    item.at = parent.children.length;
    parent.children.push(item);
    if (item.nodeId) byId.set(item.nodeId, item);
    if (item.kind === 'p') {
      item.index = ps.length;
      ps.push(item);
    }
    return item;
  };
  const build = (node, parent) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    const isP = TEXT_BLOCKS.has(node.type) || node.type === 'empty-line';
    const nodeId = node.attrs?.nodeId ?? null;
    const item = add(parent, {
      kind: isP ? 'p' : 'div',
      type: node.type,
      cls: CLASS_OF[node.type] ?? node.type,
      nodeId,
      selectId: nodeId,
      node,
      children: [],
    });
    if (isP || node.type === 'image' || node.type === 'raw-xml') return;
    for (const child of node.content ?? []) build(child, item);
  };
  const block = (kind, node) => {
    const selectId = `desc:${kind}`;
    const item = add(root, {
      kind: 'div',
      type: `${kind}-block`,
      cls: kind,
      nodeId: selectId,
      selectId,
      node: node ?? null,
      children: [],
    });
    const content = node?.content ?? [];
    for (const child of content) build(child, item);
    if (item.children.length === 0) {
      // The empty paragraph the Body view shows to type into (it has a UI id of its own).
      item.placeholder = add(item, {
        kind: 'p',
        type: 'p',
        cls: '',
        nodeId: null,
        selectId,
        node: { type: 'p', content: [] },
        children: [],
        isPlaceholder: true,
      });
    }
  };
  if (description) {
    block('annotation', description.titleInfo?.annotation);
    block('history', description.documentInfo?.history);
  }
  for (const body of bodies) build(body, root);
  return { root, ps, byId, hasDescription: !!description };
}

/* ------------------------------------------------------------------------------------------ */
/* Items                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** True for a text block of the book (not an empty line, not a description block's placeholder). */
export function isTextBlock(item) {
  return item.kind === 'p' && item.type !== 'empty-line' && !item.isPlaceholder;
}

/** The paragraph's text: inline pictures (and other inline objects) count as one character. */
export function textOf(item) {
  if (!isTextBlock(item)) return '';
  let text = '';
  for (const child of item.node.content ?? []) {
    text += child.type === 'text' ? child.text : OBJECT;
  }
  return text;
}

/** The text with the pictures left out, as the originals saw it once the tags were removed. */
export function plainText(item) {
  return textOf(item).replace(/\uFFFC/g, '');
}

/** FictionBook Editor's isLineEmpty: nothing but spaces and non-breaking spaces. */
export function isLineEmpty(item) {
  return /^[ \u00A0]*$/.test(plainText(item));
}

/** The nearest container (DIV) of class `cls` holding the item (the item itself included). */
export function containerOf(item, cls) {
  for (let node = item; node && node.type !== 'root'; node = node.parent) {
    if (node.kind === 'div' && node.cls === cls) return node;
  }
  return null;
}

export function hasContainer(item, cls) {
  return containerOf(item, cls) !== null;
}

/** The paragraphs inside a container, in document order. */
export function paragraphsIn(item) {
  const out = [];
  const visit = (node) => {
    if (node.kind === 'p') out.push(node);
    else for (const child of node.children) visit(child);
  };
  visit(item);
  return out;
}

export function nextSibling(item) {
  return item.parent ? (item.parent.children[item.at + 1] ?? null) : null;
}

export function previousSibling(item) {
  return item.parent && item.at > 0 ? item.parent.children[item.at - 1] : null;
}

/** FictionBook Editor's getNextNode over the block tree (a paragraph is not entered). */
export function nextNode(item) {
  if (item.kind === 'div' && item.children.length) return item.children[0];
  let node = item;
  while (node && !nextSibling(node)) node = node.parent;
  return node ? nextSibling(node) : null;
}

/** FictionBook Editor's getPreviousNode: a container comes before its own content. */
export function previousNode(item) {
  if (item.kind === 'div' && item.children.length) return item.children[item.children.length - 1];
  let node = item;
  while (node && !previousSibling(node)) node = node.parent;
  return node ? previousSibling(node) : null;
}

/* ------------------------------------------------------------------------------------------ */
/* The selection                                                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * Where the selection is: `{ selection, picture, collapsed, start, end }`, null without a book.
 * `start` / `end` are points `{ index, offset, item }` in the paragraph order: `index` is the
 * paragraph's place, or - when the point is not in a paragraph - a place between paragraphs
 * (`item` then is the container the caret is in, or null for an unknown place, which counts as
 * the document's start). A point in a container counts, as FictionBook Editor counted the caret
 * in a DIV, from the container's first paragraph (`forward`) or its last one.
 * `picture` is true when a picture is selected rather than text.
 */
export async function locate(book, forward = true) {
  const selection = await mfbe.selection.get();
  if (!selection) return null;
  const picture = selection.nodes.length === 0 && selection.text === OBJECT;
  const placeholders = await placeholderIds(book, selection);
  const point = (where) => {
    const item = book.byId.get(where.nodeId) ?? placeholders.get(where.nodeId) ?? null;
    if (item && item.kind === 'p') return { index: item.index, offset: where.offset, item };
    if (item) {
      const inside = paragraphsIn(item);
      if (inside.length) {
        const index = forward ? inside[0].index - 0.5 : inside[inside.length - 1].index + 0.5;
        return { index, offset: 0, item };
      }
    }
    return { index: -0.5, offset: 0, item: null };
  };
  const anchor = point(selection.anchor);
  const head = point(selection.head);
  const headFirst = comparePoints(head, anchor) < 0;
  return {
    selection,
    picture,
    collapsed:
      selection.anchor.nodeId === selection.head.nodeId &&
      selection.anchor.offset === selection.head.offset,
    start: headFirst ? head : anchor,
    end: headFirst ? anchor : head,
  };
}

export function comparePoints(a, b) {
  if (a.index !== b.index) return a.index - b.index;
  return a.offset - b.offset;
}

/**
 * The selection in an empty description block names the block's own paragraph by a UI id the
 * document model does not know. With one such paragraph it can only be that one; with two (no
 * annotation and no history) each block is selected once to learn its paragraph's id, and the
 * selection is put back.
 */
async function placeholderIds(book, selection) {
  const map = new Map();
  const unknown = [selection.anchor.nodeId, selection.head.nodeId].filter(
    (id) => !book.byId.has(id),
  );
  if (!unknown.length) return map;
  const blocks = book.root.children.filter((item) => item.placeholder);
  if (blocks.length === 1) {
    for (const id of unknown) map.set(id, blocks[0].placeholder);
    return map;
  }
  if (blocks.length === 0) return map;
  try {
    for (const block of blocks) {
      await mfbe.selection.selectNode(block.selectId);
      const probe = await mfbe.selection.get();
      if (probe) map.set(probe.anchor.nodeId, block.placeholder);
    }
  } finally {
    // The points are taken from `selection` itself; a failed restore only leaves the caret there.
    await mfbe.selection.set(selection.anchor, selection.head).catch(() => {});
  }
  return map;
}

/** Selects a container's whole text (moveToElementText of the original). */
export async function selectContainer(item) {
  await mfbe.selection.selectNode(item.selectId);
}

/**
 * Selects a paragraph's whole text. An empty line holds no caret in the Body view: the caret
 * goes right after it (to the start of the next text), where Backspace removes it.
 */
export async function selectParagraph(item) {
  await mfbe.selection.selectNode(item.selectId);
}

/** Puts the caret at `offset` of a paragraph (after an empty line, see selectParagraph). */
export async function setCaret(item, offset) {
  if (!isTextBlock(item)) {
    await mfbe.selection.selectNode(item.selectId);
    return;
  }
  await mfbe.selection.set({ nodeId: item.nodeId, offset });
}

/** Selects from `fromOffset` of one paragraph to `toOffset` of another (or the same). */
export async function setRange(from, fromOffset, to, toOffset) {
  if (!isTextBlock(from) || !isTextBlock(to)) {
    await mfbe.selection.selectNode((isTextBlock(from) ? to : from).selectId);
    return;
  }
  await mfbe.selection.set(
    { nodeId: from.nodeId, offset: fromOffset },
    { nodeId: to.nodeId, offset: toOffset },
  );
}

/**
 * A selected picture: the scripts work from a caret or a text selection (025/026 said so in
 * this message, the others stopped with a script error).
 */
export async function refusePicture(ctx) {
  await mfbe.ui.message(
    t(
      ctx,
      'Ошибка.\n\nВы используете тип выделения,\nкоторый не поддерживатся этим скриптом –\nвыделение картинок, а не текста.\nПожалуйста, используйте выделение текста.',
      'Error.\n\nThis script does not support the kind of selection you use:\na selected picture, not text.\nPlease select text.',
    ),
    { icon: 'error' },
  );
}
