// Shared helper of the "Примечания" and "Комментарии" scripts converted from FictionBook Editor
// 2.7.9 (each package carries its own byte-identical copy: the sandbox loads modules from the
// script's own folder only).
//
// FictionBook Editor showed the book in one HTML element, fbw_body (files/fb2.xsl): first the
// book's annotation and its history (DIVs of class "annotation" and "history"; an empty P when
// the book has none), then every body. A text block was a P - an empty line an empty P, a
// subtitle a P of class "subtitle", a text author and a poem's date a P of class "text-author",
// a table cell a P of class "td" / "th" -, a container a DIV, a link an A element; the scripts
// walked that page and its document.links. This module gives the same page from the document
// model: a working copy of the description and of the bodies that a script changes in memory,
// the text blocks and the links in the page's order, the renumbering of a notes or comments body
// that the note scripts end with, and commit(), which writes what changed (doc.replaceNode per
// changed body, doc.insertNode for a body the script created, doc.setDescription for the
// annotation and the history).

export const NBSP = '\u00A0';
export const OBJECT = '\uFFFC';
export const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'date', 'td', 'th']);
/** The containers the note scripts took as one piece (poem, cite, table, epigraph). */
export const CONTAINERS = new Set(['poem', 'cite', 'table', 'epigraph']);

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** A deep copy without node ids: a node copied or moved elsewhere gets fresh ones. */
export function withoutIds(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(withoutIds);
  const out = { ...node };
  if (out.attrs) {
    const attrs = { ...out.attrs };
    delete attrs.nodeId;
    out.attrs = attrs;
  }
  if (Array.isArray(out.content)) out.content = out.content.map(withoutIds);
  if (Array.isArray(out.marks)) out.marks = copy(out.marks);
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Inline content                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Length of an inline item in selection offsets: its characters, a picture counts as one. */
export function itemLength(item) {
  return item.type === 'text' ? (item.text ?? '').length : 1;
}

export function contentLength(content) {
  return (content ?? []).reduce((n, item) => n + itemLength(item), 0);
}

/** The block's text, a picture as U+FFFC (mfbe.doc.textOf). */
export function plainText(content) {
  return (content ?? []).map((item) => (item.type === 'text' ? (item.text ?? '') : OBJECT)).join('');
}

/**
 * The text the originals matched: the paragraph's HTML with its tags removed and its entities
 * decoded - pictures, which were tags, leave nothing. `at[i]` is the offset in the block of
 * character i (and `at[text.length]` the block's end), `items[i]` the inline item it belongs to.
 */
export function tagFreeText(content) {
  let text = '';
  const at = [];
  const items = [];
  let pos = 0;
  for (const item of content ?? []) {
    if (item.type === 'text') {
      for (let k = 0; k < item.text.length; k += 1) {
        text += item.text[k];
        at.push(pos + k);
        items.push(item);
      }
    }
    pos += itemLength(item);
  }
  at.push(pos);
  return { text, at, items };
}

function sameMark(a, b) {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

export function sameMarks(a, b) {
  return a.length === b.length && a.every((mark, i) => sameMark(mark, b[i]));
}

export function linkMarkOf(item) {
  return (item.marks ?? []).find((mark) => mark.type === 'link') ?? null;
}

/**
 * The A elements of a block: consecutive inline items under the same link mark, with the same
 * marks outside it (the model lists an item's marks outer first). Each group: `first`/`last`
 * (item indexes), `start`/`end` (offsets), `mark`, `outer` (the marks around the link), `href`,
 * `type`.
 */
export function linkGroups(content) {
  const groups = [];
  let pos = 0;
  let current = null;
  (content ?? []).forEach((item, index) => {
    const marks = item.marks ?? [];
    const at = marks.findIndex((mark) => mark.type === 'link');
    const length = itemLength(item);
    if (at >= 0) {
      const mark = marks[at];
      const outer = marks.slice(0, at);
      if (current && current.last === index - 1 && sameMark(current.mark, mark) && sameMarks(current.outer, outer)) {
        current.last = index;
        current.end = pos + length;
      } else {
        current = {
          first: index,
          last: index,
          start: pos,
          end: pos + length,
          mark,
          outer,
          href: mark.attrs?.href ?? '',
          type: mark.attrs?.type ?? null,
        };
        groups.push(current);
      }
    } else {
      current = null;
    }
    pos += length;
  });
  return groups;
}

/** The text of a link group (pictures as U+FFFC). */
export function linkText(content, group) {
  return plainText(content.slice(group.first, group.last + 1));
}

/**
 * FictionBook Editor's getLocalHref: null without "#"; what follows "main.html#" (the page's
 * own address); else the address without its first character - the id for "#id", nothing an
 * id could equal for an external address.
 */
export function localHref(href) {
  if (typeof href !== 'string' || href.indexOf('#') < 0) return null;
  const at = href.search(/main.html#/i);
  if (at >= 0) return href.slice(at + 10);
  return href.substring(1);
}

/** Splits the inline content at an offset; returns the index of the first item at or after it. */
export function splitAt(content, offset) {
  let pos = 0;
  for (let i = 0; i < content.length; i += 1) {
    const item = content[i];
    const length = itemLength(item);
    if (offset <= pos) return i;
    if (offset < pos + length) {
      // only text items are longer than one
      content.splice(i, 1, { ...item, text: item.text.slice(0, offset - pos) }, { ...item, text: item.text.slice(offset - pos) });
      return i + 1;
    }
    pos += length;
  }
  return content.length;
}

/** Merges neighbouring text items with equal marks (the model's canonical form). */
export function normalise(content) {
  const out = [];
  for (const item of content) {
    if (item.type === 'text' && !item.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === 'text' && item.type === 'text' && sameMarks(last.marks ?? [], item.marks ?? [])) {
      out[out.length - 1] = { ...last, text: last.text + item.text };
    } else {
      out.push(item);
    }
  }
  return out.map((item) => {
    if (item.marks && item.marks.length === 0) {
      const { marks, ...rest } = item;
      return rest;
    }
    return item;
  });
}

/** Removes the text characters [from, to) of `tagFreeText` positions (pictures stay). */
export function removeTextRange(content, map, from, to) {
  if (to <= from) return content;
  const drop = new Set();
  for (let i = from; i < to; i += 1) drop.add(map.at[i]);
  const out = [];
  let pos = 0;
  for (const item of content) {
    if (item.type !== 'text') {
      out.push(item);
      pos += 1;
      continue;
    }
    let text = '';
    for (let k = 0; k < item.text.length; k += 1) if (!drop.has(pos + k)) text += item.text[k];
    if (text) out.push({ ...item, text });
    pos += item.text.length;
  }
  return normalise(out);
}

/* ------------------------------------------------------------------------------------------ */
/* The page                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * The book: working copies of the description and the bodies. `created` holds the bodies the
 * script added, `changed` the bodies it changed; `descriptionChanged` the annotation/history.
 */
export async function loadBook() {
  const doc = await mfbe.doc.get();
  return {
    description: copy(doc.description ?? {}),
    bodies: (doc.bodies ?? []).map(copy),
    created: new Set(),
    changed: new Set(),
    descriptionChanged: false,
  };
}

/** The page's top elements in order: the annotation, the history (null when absent), the bodies. */
export function pageRoots(book) {
  const roots = [
    { kind: 'annotation', node: book.description?.titleInfo?.annotation ?? null },
    { kind: 'history', node: book.description?.documentInfo?.history ?? null },
  ];
  for (const body of book.bodies) roots.push({ kind: 'body', node: body });
  return roots;
}

/** Marks a root (body or description block) as changed. */
export function touch(book, root) {
  if (root.kind === 'body') book.changed.add(root.node);
  else book.descriptionChanged = true;
}

/**
 * Every text block and empty line of the page in order, as `{ node, parents, root }` - the
 * parents nearest first. The empty paragraph shown for a missing annotation or history holds
 * nothing and is left out.
 */
export function pageBlocks(book, roots = pageRoots(book)) {
  const out = [];
  const visit = (node, parents, root) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type) || node.type === 'empty-line') {
      out.push({ node, parents, root });
      return;
    }
    if (node.type === 'image' || node.type === 'raw-xml') return;
    for (const child of node.content ?? []) visit(child, [node, ...parents], root);
  };
  for (const root of roots) if (root.node) visit(root.node, [], root);
  return out;
}

/** The body of that name (`notes`, `comments`), or null. */
export function bodyNamed(book, name) {
  return book.bodies.find((body) => body.attrs?.name === name) ?? null;
}

/** The node of a subtree with this `attrs.id`, or null. */
export function findById(node, id) {
  if (!node || typeof node !== 'object' || node.type === 'text') return null;
  if (node.attrs?.id === id) return node;
  for (const child of node.content ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/** True when an element of the page has this id (FictionBook Editor's getElementById). */
export function pageHasId(book, id) {
  return pageRoots(book).some((root) => root.node && findById(root.node, id));
}

export function titleNode(text, attrs = {}) {
  return { type: 'title', attrs, content: [{ type: 'p', attrs: {}, content: text ? [{ type: 'text', text }] : [] }] };
}

/** The text of a title (its paragraphs joined by line breaks). */
export function titleText(title) {
  return (title.content ?? []).map((p) => plainText(p.content)).join('\n');
}

/**
 * The renumbering the note scripts end with: the sections of `body`, in order, get the id
 * `prefix`+N and the title N (a section without a title gets one at its start); every link of
 * the page whose local address is the id a section had gets the address "#"+prefix+N and, when
 * `linkContent(n, group)` returns inline items, those as its text, inside the marks around the
 * link (FictionBook Editor set the A element's innerHTML). Returns the number of sections.
 */
export function renumber(book, body, prefix, linkContent) {
  const sections = (body.content ?? []).filter((node) => node.type === 'section');
  const numberById = new Map();
  sections.forEach((section, i) => {
    const n = i + 1;
    const old = section.attrs?.id;
    if (old) numberById.set(old, n);
    section.attrs = { ...(section.attrs ?? {}), id: `${prefix}${n}` };
    const first = section.content?.[0];
    if (first && first.type === 'title') {
      const wanted = titleNode(String(n), first.attrs ?? {});
      const same =
        first.content?.length === 1 &&
        first.content[0].type === 'p' &&
        JSON.stringify(first.content[0].content ?? []) === JSON.stringify(wanted.content[0].content);
      if (!same) section.content[0] = wanted;
    } else {
      section.content = [titleNode(String(n)), ...(section.content ?? [])];
    }
  });
  if (sections.length) book.changed.add(body);
  relink(book, (id) => (numberById.has(id) ? numberById.get(id) : null), prefix, linkContent);
  return sections.length;
}

/**
 * Gives every link of the page whose local address `numberOf(id)` maps to a number the address
 * "#"+prefix+number and, when `linkContent` returns items, that text.
 */
export function relink(book, numberOf, prefix, linkContent) {
  for (const entry of pageBlocks(book)) {
    const content = entry.node.content;
    if (!content || !content.length) continue;
    const groups = linkGroups(content);
    let changed = false;
    for (let g = groups.length - 1; g >= 0; g -= 1) {
      const group = groups[g];
      const id = localHref(group.href);
      if (id === null) continue;
      const n = numberOf(id);
      if (n === null || n === undefined) continue;
      const href = `#${prefix}${n}`;
      const mark = { ...group.mark, attrs: { ...group.mark.attrs, href } };
      const items = linkContent ? linkContent(n, group) : null;
      const before = JSON.stringify(content.slice(group.first, group.last + 1));
      let replacement;
      if (items) {
        replacement = items.map((item) => ({ ...item, marks: [...group.outer, mark, ...(item.marks ?? [])] }));
      } else {
        replacement = content.slice(group.first, group.last + 1).map((item) => {
          const marks = [...(item.marks ?? [])];
          marks[group.outer.length] = mark;
          return { ...item, marks };
        });
      }
      if (JSON.stringify(replacement) === before) continue;
      content.splice(group.first, group.last - group.first + 1, ...replacement);
      changed = true;
    }
    if (changed) {
      entry.node.content = normalise(content);
      touch(book, entry.root);
    }
  }
}

/** The text of a footnote link ("[N]") and of a comment link ("{N}", superscript). */
export function footnoteLinkText(n) {
  return [{ type: 'text', text: `[${n}]` }];
}

export function commentLinkText(n) {
  return [{ type: 'text', text: `{${n}}`, marks: [{ type: 'sup' }] }];
}

/**
 * Writes the changes: a body the script created goes after the body before it, a changed body
 * replaces its original (its untouched nodes keep their ids, new ones get theirs), a changed
 * annotation or history goes in with the description. The working copy stays the script's: it
 * may change it further and commit again.
 */
export async function commit(book) {
  let previous = null;
  for (const body of book.bodies) {
    if (book.created.has(body)) {
      const ref = await mfbe.doc.insertNode('after', previous, body);
      body.attrs = { ...(body.attrs ?? {}), nodeId: ref.nodeId };
    } else if (book.changed.has(body)) {
      await mfbe.doc.replaceNode(body.attrs.nodeId, body);
    }
    previous = body.attrs.nodeId;
  }
  book.created.clear();
  book.changed.clear();
  if (book.descriptionChanged) {
    await mfbe.doc.setDescription(book.description);
    book.descriptionChanged = false;
  }
}

/** FictionBook Editor's units(): the Russian word form for a number. */
export function units(num, cases) {
  const n = Math.abs(num);
  if (n.toString().indexOf('.') > -1) return cases.gen;
  if (n % 10 === 1 && n % 100 !== 11) return cases.nom;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return cases.gen;
  return cases.plu;
}

/** The time a run took, as the note scripts wrote it ("0.4 с", "1 мин. 2.5 с"). */
export function elapsed(since) {
  const ms = Date.now() - since;
  const min = Math.floor(ms / 60000);
  const sec = Math.ceil(10 * (ms / 1000 - min * 60)) / 10;
  return min > 0 ? `${min} мин. ${sec} с` : `${sec} с`;
}
