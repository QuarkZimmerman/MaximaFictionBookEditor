// Shared helper of the scripts converted from FictionBook Editor 2.7.9's group 05_Иллюстрации that
// go to the previous / next picture (11, 12: block pictures; 18, 19: inline pictures). Each
// package carries its own copy: the sandbox only loads modules from the script's own folder.
//
// The originals pasted a marker at the caret (the start of the selection) into FictionBook
// Editor's fbw_body - the book's annotation, the history, then every body - walked the tree from
// there forwards or backwards to the first block picture (DIV.image) or inline picture
// (SPAN.image), went to it and stepped off it with Shift+Esc and an arrow key, so that the caret
// stood right before (previous) or right after (next) the picture. Here the book is rebuilt in
// that order from the document model: a list of "events" - the text blocks and the block
// pictures - on one number line, where a caret in a text block is its block's start plus its
// offset and a place between blocks lies between the events around it. The caret is put back
// with `selection.set`: into the text next to the picture where nothing else lies between, else
// right at the picture's side (the place between blocks the original's arrow key reached).

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);
const OBJECT = '￼';

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The size of a node in the Body view's positions: a text its length, a leaf one, else 2 + its content. */
function sizeOf(node) {
  if (node.type === 'text') return (node.text ?? '').length;
  if (TEXT_BLOCKS.has(node.type)) return 2 + inlineLength(node);
  if (!node.content || node.content.length === 0) {
    return node.type === 'image' || node.type === 'empty-line' || node.type === 'raw-xml' ? 1 : 2;
  }
  let size = 2;
  for (const child of node.content) size += sizeOf(child);
  return size;
}

/** The length of a text block's content: its texts, and one for each picture or inline object. */
function inlineLength(node) {
  let length = 0;
  for (const child of node.content ?? []) length += child.type === 'text' ? (child.text ?? '').length : 1;
  return length;
}

/**
 * The book in fbw_body order: `events` (text blocks `{ kind: 'text', nodeId, length, pictures }`,
 * `pictures` being the offsets and nodes of their inline pictures, and block pictures
 * `{ kind: 'image', nodeId, node, parent }`, each with `start` / `end` on the number line), and
 * what is needed to read a place between blocks. The description blocks hold their paragraphs or,
 * when the book has no annotation or no history, the empty paragraph the Body view shows there
 * (`placeholder`: the block's fixed id for `selection.selectNode`).
 */
export async function loadBook() {
  let description = null;
  let bodies;
  try {
    const doc = await mfbe.doc.get();
    description = doc.description ?? null;
    bodies = doc.bodies ?? [];
  } catch {
    // Above the API's size limit for a snapshot: the bodies one by one, without the description.
    bodies = [];
    for (const ref of await mfbe.doc.getElementsByTagName('body')) bodies.push(await mfbe.doc.getNode(ref));
  }
  const events = [];
  const byId = new Map(); // nodeId -> { node, event? } for text blocks and containers
  const first = new Map(); // node -> index of the first event at or after it
  const after = new Map(); // container -> index of the first event after it
  const placeholders = [];
  let line = 0;
  const add = (event, length) => {
    line += 1;
    event.start = line;
    line += length;
    event.end = line;
    line += 1;
    events.push(event);
    return event;
  };
  const build = (node, parent) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    first.set(node, events.length);
    const nodeId = node.attrs?.nodeId ?? null;
    if (TEXT_BLOCKS.has(node.type)) {
      const pictures = [];
      let offset = 0;
      for (const child of node.content ?? []) {
        if (child.type === 'inline-image') pictures.push({ offset, node: child });
        offset += child.type === 'text' ? (child.text ?? '').length : 1;
      }
      const event = add({ kind: 'text', nodeId, length: offset, pictures }, offset);
      if (nodeId) byId.set(nodeId, { node, event });
      return;
    }
    if (node.type === 'image') {
      add({ kind: 'image', nodeId, node, parent }, 1);
      return;
    }
    if (node.type === 'empty-line' || node.type === 'raw-xml') return;
    if (nodeId) byId.set(nodeId, { node });
    for (const child of node.content ?? []) build(child, node);
    after.set(node, events.length);
  };
  const block = (key, node) => {
    if (node && (node.content ?? []).length) {
      build(node, null);
      return;
    }
    // The empty paragraph the Body view shows to type into (it has a UI id of its own).
    placeholders.push(add({ kind: 'text', nodeId: null, length: 0, pictures: [], placeholder: `desc:${key}` }, 0));
  };
  if (description) {
    block('annotation', description.titleInfo?.annotation);
    block('history', description.documentInfo?.history);
  }
  for (const body of bodies) build(body, null);
  return { events, byId, first, after, placeholders, end: line + 1 };
}

/** The place on the number line before the event of index `index` (the end of the book after the last). */
function beforeEvent(book, index) {
  return index < book.events.length ? book.events[index].start - 0.5 : book.end;
}

/**
 * The place of a selection point `{ nodeId, offset }`: in a text block its start plus the offset;
 * in a container (a place between blocks: a selected block picture, or the caret these scripts
 * leave beside one) the child boundary its offset falls on, counted in the Body view's positions;
 * in a description block's empty paragraph that paragraph.
 */
function placeOf(book, point, placeholderIds) {
  const entry = book.byId.get(point.nodeId);
  if (entry?.event) return entry.event.start + Math.max(0, Math.min(point.offset, entry.event.length));
  if (entry) {
    const children = entry.node.content ?? [];
    let at = 0;
    let index = 0;
    while (index < children.length && at + sizeOf(children[index]) <= point.offset) {
      at += sizeOf(children[index]);
      index += 1;
    }
    const next = index < children.length ? book.first.get(children[index]) : book.after.get(entry.node);
    return beforeEvent(book, next ?? book.events.length);
  }
  const placeholder = placeholderIds.get(point.nodeId);
  if (placeholder) return placeholder.start;
  return 0; // an unknown place: the start of the book
}

/**
 * The UI ids of the description blocks' empty paragraphs the selection may lie in: with one such
 * paragraph it can only be that one; with two (no annotation and no history) each block is
 * selected once to learn its paragraph's id, and the selection is put back.
 */
async function placeholderIdsFor(book, selection) {
  const map = new Map();
  const unknown = [selection.anchor.nodeId, selection.head.nodeId].filter((id) => !book.byId.has(id));
  if (!unknown.length || !book.placeholders.length) return map;
  if (book.placeholders.length === 1) {
    for (const id of unknown) map.set(id, book.placeholders[0]);
    return map;
  }
  try {
    for (const placeholder of book.placeholders) {
      await mfbe.selection.selectNode(placeholder.placeholder);
      const probe = await mfbe.selection.get();
      if (probe) map.set(probe.anchor.nodeId, placeholder);
    }
  } finally {
    await mfbe.selection.set(selection.anchor, selection.head).catch(() => {});
  }
  return map;
}

/**
 * Where the search starts: the start of the selection (the original collapsed its range to the
 * start); for a selected picture - where the original stepped off it with Shift+Esc and the arrow
 * key before it searched - its end going forwards and its start going backwards. Null without a
 * book.
 */
export async function startPlace(book, forward) {
  const selection = await mfbe.selection.get();
  if (!selection) return null;
  const ids = await placeholderIdsFor(book, selection);
  const anchor = placeOf(book, selection.anchor, ids);
  const head = placeOf(book, selection.head, ids);
  const start = Math.min(anchor, head);
  const end = Math.max(anchor, head);
  const picture = selection.text === OBJECT;
  return picture && forward ? end : start;
}

/** The index of the next block picture from `place` (forwards) or of the previous one, or -1. */
export function findBlockPicture(book, place, forward) {
  const { events } = book;
  if (forward) return events.findIndex((event) => event.kind === 'image' && event.start >= place);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === 'image' && events[index].end <= place) return index;
  }
  return -1;
}

/** The next inline picture from `place` (forwards) or the previous one: `{ event, offset }` or null. */
export function findInlinePicture(book, place, forward) {
  const { events } = book;
  if (forward) {
    for (const event of events) {
      if (event.kind !== 'text' || event.end < place) continue;
      for (const picture of event.pictures) if (event.start + picture.offset >= place) return { event, offset: picture.offset };
    }
    return null;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind !== 'text' || event.start > place) continue;
    for (let k = event.pictures.length - 1; k >= 0; k -= 1) {
      const picture = event.pictures[k];
      if (event.start + picture.offset + 1 <= place) return { event, offset: picture.offset };
    }
  }
  return null;
}

/** The Body view's position of the place right before a block picture, inside its container. */
function offsetBefore(event) {
  let at = 0;
  for (const child of event.parent?.content ?? []) {
    if (child === event.node) break;
    at += sizeOf(child);
  }
  return at;
}

/** Puts the caret at the end of a text event (a description block's empty paragraph: into it). */
async function caretAtEnd(event) {
  if (event.placeholder) await mfbe.selection.selectNode(event.placeholder);
  else await mfbe.selection.set({ nodeId: event.nodeId, offset: event.length });
}

/**
 * Puts the caret beside the block picture of index `index`: after it (next) - at the start of the
 * text right after it, or right at its side when another picture or nothing follows -, or before
 * it (previous) - at the end of the text right before it, or right after the picture before it.
 */
export async function caretBesidePicture(book, index, after) {
  const { events } = book;
  const picture = events[index];
  if (after) {
    const next = events[index + 1];
    if (next && next.kind === 'text' && !next.placeholder) await mfbe.selection.set({ nodeId: next.nodeId, offset: 0 });
    else await mfbe.selection.set({ nodeId: picture.nodeId, offset: 0 });
    return;
  }
  const previous = events[index - 1];
  if (previous?.kind === 'text') await caretAtEnd(previous);
  else if (previous) await mfbe.selection.set({ nodeId: previous.nodeId, offset: 0 });
  else await mfbe.selection.set({ nodeId: picture.parent.attrs.nodeId, offset: offsetBefore(picture) });
}

/**
 * Puts the caret right before (previous) or right after (next) an inline picture; with
 * `selectOne` (the original's setting `sel`) one character to its right is selected besides.
 */
export async function caretBesideInline(found, after, selectOne) {
  const { event, offset } = found;
  const at = after ? offset + 1 : offset;
  const head = selectOne ? Math.min(at + 1, event.length) : at;
  await mfbe.selection.set({ nodeId: event.nodeId, offset: at }, { nodeId: event.nodeId, offset: head });
}
