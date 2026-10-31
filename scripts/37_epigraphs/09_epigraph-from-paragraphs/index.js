// Converted from FictionBook Editor 2.7.9: Scripts/37_Эпиграфы/09_Создать эпиграф из полных абзацев.js
// Makes an epigraph of whole paragraphs: the selection is widened to the whole paragraphs it
// touches (a caret: its paragraph), and the element holding them all - the paragraph's section,
// body or poem; a title counts as its section (body, poem) - gets a new epigraph after its title
// and epigraphs (in a body after its picture, title and epigraphs), as FictionBook Editor's own
// Add epigraph placed it. Inside a citation, an epigraph, an annotation, a stanza or the book's
// annotation or history nothing happens. Every paragraph of the selection - title lines,
// subtitles, verses and table cells too - becomes a paragraph of the epigraph with its text and
// formatting (without its id and style); an empty one an empty line. Of two or more, the last
// becomes the text author when one formatting element spans its whole text. The paragraphs then
// leave their places, from the last to the first: the last paragraph of a section stays as an
// empty line, a title, an epigraph or a citation left empty goes. The caret goes to the end of
// the new epigraph. The original's Run() returned nothing, nor does run().
// Differences from the original: a stanza, a table row or a table left without content goes too,
// and a result that would still not be valid FB2 (a poem left without stanzas) changes nothing
// and says so (2.7.9 wrote such a book and refused to save it before it was mended by hand); the
// editor scrolls the caret into view (the original's own scrolling is not reproduced). Fixed
// (FR-023): a selection starting or ending inside formatting (italics, bold, a link...) took the
// paragraph only from or up to that formatting element - the original widened the selection to
// the element holding its end (parentElement), which then is the formatting element - and then
// removed only that element from the paragraph, or stopped with a script error; and a selected
// picture now gets the message the original wrote for it, which its code never reached (its range
// of a picture has no duplicate()). Notes: docs/scripting/notes-279-drafts/37.md.
// The original's notice, kept as written (FR-029):
// Скрипт "Создать эпиграф из полных абзацев"
// Версия 1.2
// Автор Sclex
  //alert("endEl: "+endEl.outerHTML);

import { loadBook, locate, t } from './nav-lib.js';

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);

/** The lowest container holding both items (tr.parentElement() of the widened range). */
function commonAncestor(a, b) {
  if (a === b) return a;
  const up = new Set();
  for (let node = a; node; node = node.parent) up.add(node);
  for (let node = b; node; node = node.parent) if (up.has(node)) return node;
  return null;
}

/** GetCP() of main.js: a paragraph counts as its container, a title as the title's container. */
function containerPoint(item) {
  let cp = item;
  if (cp && cp.kind === 'p') cp = cp.parent;
  if (cp && cp.kind === 'div' && cp.cls === 'title') cp = cp.parent;
  return cp && cp.kind === 'div' ? cp : null;
}

/** The plain text of inline content: what IE's text and innerText held (pictures are none). */
function plainText(content) {
  return content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
}

/**
 * The original's text-author test: one element of the last paragraph whose innerText is the
 * paragraph's (for (pptag in pptags) ran over the indices, so the paragraph before it never
 * mattered, see the notes). An element is a maximal run of inline nodes carrying one mark; it
 * must cover the paragraph's text from its first to its last non-space character.
 */
function wholeUnderOneElement(content) {
  const units = [];
  for (const node of content) {
    const text = node.type === 'text' ? (node.text ?? '') : '';
    units.push({ node, text });
  }
  const full = units.map((u) => u.text).join('');
  const start = full.search(/[^ \t\r\n]/);
  if (start < 0) return false;
  const end = full.length - full.split('').reverse().join('').search(/[^ \t\r\n]/);
  // The nodes touching [start, end): their text offsets.
  let at = 0;
  const touching = [];
  for (const unit of units) {
    const from = at;
    at += unit.text.length;
    const inside = unit.text.length > 0 ? from < end && at > start : from > start && from < end;
    if (inside) touching.push(unit.node);
  }
  const same = (a, b) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
  const first = touching[0]?.marks ?? [];
  return first.some((mark) => touching.every((node) => (node.marks ?? []).some((m) => same(m, mark))));
}

/** A paragraph of the epigraph made of a <P> of the selection (pwt.innerHTML = pps[i].innerHTML). */
function epigraphLine(item, lastOfSeveral) {
  const content = item.type === 'empty-line' || item.isPlaceholder ? [] : (item.node.content ?? []);
  // FictionBook Editor saved an empty <P> - or one of a single text of spaces - as an empty line.
  const blank =
    content.length === 0 ||
    (content.length === 1 &&
      content[0].type === 'text' &&
      !(content[0].marks ?? []).length &&
      /^[ \t\n\r\f\v ]*$/.test(content[0].text ?? ''));
  if (blank) return { type: 'empty-line', attrs: {} };
  const type = lastOfSeveral && wholeUnderOneElement(content) ? 'text-author' : 'p';
  return { type, attrs: {}, content: JSON.parse(JSON.stringify(content)) };
}

/** A copy of a model subtree with parent links: `{ node, parent }` by node id. */
function indexTree(root) {
  const byId = new Map();
  const visit = (node, parent) => {
    if (!node || node.type === 'text') return;
    if (node.attrs?.nodeId) byId.set(node.attrs.nodeId, { node, parent });
    for (const child of node.content ?? []) visit(child, node);
  };
  visit(root, null);
  return byId;
}

function parentOfNode(root, target) {
  let found = null;
  const visit = (node) => {
    if (found || !node || node.type === 'text') return;
    for (const child of node.content ?? []) {
      if (child === target) {
        found = node;
        return;
      }
      visit(child);
    }
  };
  visit(root);
  return found;
}

function removeChild(parent, child) {
  const at = parent.content.indexOf(child);
  if (at >= 0) parent.content.splice(at, 1);
}

/** The last text block of a subtree, or null. */
function lastTextBlock(node) {
  if (!node || node.type === 'text') return null;
  if (TEXT_BLOCKS.has(node.type)) return node;
  const children = node.content ?? [];
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const found = lastTextBlock(children[i]);
    if (found) return found;
  }
  return null;
}

function contentLength(content) {
  return (content ?? []).reduce((n, c) => n + (c.type === 'text' ? (c.text ?? '').length : 1), 0);
}

export default async function run(ctx) {
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return;
  if (where.picture) {
    await mfbe.ui.message(
      t(
        ctx,
        'Вы используете не тот тип выделения, с которым работает вставка эпиграфа. Выделяйте текст для будущего эпиграфа не кликом по картинке, а движением мыши слева направо или справа налево. Либо задайте выделение, используя клавиатуру.',
        'This kind of selection does not work for inserting an epigraph. Select the text of the future epigraph not by clicking a picture but by dragging the mouse from left to right or from right to left, or select it with the keyboard.',
      ),
    );
    return;
  }
  // The selection widened to the whole paragraphs holding its start and its end.
  const first = book.ps[Math.ceil(where.start.index)];
  const last = book.ps[Math.floor(where.end.index)];
  if (!first || !last || first.index > last.index) return;
  const cp = containerPoint(commonAncestor(first, last));
  if (!cp || !['body', 'section', 'poem'].includes(cp.cls)) return;

  // The epigraph, from every <P> of the widened range.
  const blocks = book.ps.slice(first.index, last.index + 1);
  const anyText = blocks.some(
    (item) => item.type !== 'empty-line' && !item.isPlaceholder && plainText(item.node.content ?? []) !== '',
  );
  const lines = anyText
    ? blocks.map((item, i) => epigraphLine(item, blocks.length > 1 && i === blocks.length - 1))
    : [{ type: 'empty-line', attrs: {} }];
  const epigraph = { type: 'epigraph', attrs: {}, content: lines };

  // A copy of the container: the epigraph goes after its title and epigraphs (SkipOver), in a
  // body after its picture, title and epigraphs too.
  const root = JSON.parse(JSON.stringify(cp.node));
  const skip = cp.cls === 'body' ? new Set(['title', 'image', 'epigraph']) : new Set(['title', 'epigraph']);
  let at = 0;
  while (at < root.content.length && skip.has(root.content[at].type)) at += 1;
  root.content.splice(at, 0, epigraph);

  // The paragraphs leave, from the last to the first.
  const byId = indexTree(root);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const place = byId.get(blocks[i].nodeId);
    if (!place || !place.parent) continue;
    const { node, parent } = place;
    const siblings = parent.content;
    const next = siblings[siblings.indexOf(node) + 1];
    if (next || parent.type !== 'section') removeChild(parent, node);
    else siblings[siblings.indexOf(node)] = { type: 'empty-line', attrs: {} }; // el2.innerHTML=""
    const holder = parentOfNode(root, parent);
    if (!holder) continue; // the parent went already
    if (['title', 'epigraph', 'cite'].includes(parent.type) && parent.content.length === 0) {
      removeChild(holder, parent);
    } else if (parent.type === 'stanza' && !parent.content.some((c) => c.type === 'v')) {
      // Not valid FB2 without a verse (2.7.9 left it): it goes.
      removeChild(holder, parent);
    } else if (parent.type === 'tr' && parent.content.length === 0) {
      // Nor a table row without a cell, nor a table without a row.
      removeChild(holder, parent);
      const table = holder.type === 'table' && holder.content.length === 0 ? parentOfNode(root, holder) : null;
      if (table) removeChild(table, holder);
    }
  }

  try {
    await mfbe.doc.replaceNode(cp.nodeId, root);
  } catch (error) {
    if (error?.name !== 'ScriptApiError' || !['invalidNode', 'notAllowed'].includes(error.code)) throw error;
    await mfbe.ui.message(
      t(
        ctx,
        'Эпиграф не создан: после переноса этих абзацев в эпиграф книга не была бы правильным FB2.',
        'The epigraph was not made: with these paragraphs moved into it the book would not be valid FB2.',
      ),
      { icon: 'warning' },
    );
    return;
  }
  // GoToEndOfElement(ep): the caret at the end of the new epigraph.
  const index = root.content.indexOf(epigraph);
  const written = (await mfbe.doc.getNode(cp.nodeId)).content?.[index];
  const end = lastTextBlock(written);
  if (end?.attrs?.nodeId) {
    await mfbe.selection.set({ nodeId: end.attrs.nodeId, offset: contentLength(end.content) });
  } else if (written?.attrs?.nodeId) {
    await mfbe.selection.selectNode(written.attrs.nodeId);
  }
  await mfbe.selection.scrollIntoView();
}
