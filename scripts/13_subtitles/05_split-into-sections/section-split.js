// Engine shared by the two "Разметить заголовки разделов ..." scripts of FictionBook Editor 2.7.9
// (group 13: 06 "... найденные по регэкспу ... (расширенная версия)" and 07 "... согласно
// оглавлению документа"). Each package carries its own copy (a script may only import files of
// its own package); the copies are identical.
//
// What the originals did. Both walked the children of every section (after its sub-sections),
// put a marker paragraph "Sclex_SplittingIntoSections_<n>_begin" in front of each paragraph that
// becomes a title (and of the paragraphs taken into it) and "..._end" after them, then rewrote
// the section's outerHTML: every begin marker became "</DIV><DIV class=section><DIV
// class=title>", every end marker "</DIV>". So the section is cut in front of each new title:
// the part before the first title stays the section (with its own title and attributes), and
// every new title opens a new section, a sibling that holds the blocks up to the next title.
// The markers took part in the originals' tests of the previous and next paragraph, so the port
// keeps them in the list of a section's children (`markerItem`) exactly where the originals
// inserted them, and splits the list afterwards (`splitAtMarkers`).
//
// Differences the editor imposes (recorded in the notes): a part that would keep only its title,
// epigraphs, image or annotation, and a new section with a title and nothing after it, get an
// <empty-line/> (FB2 and the editor require a block there; 2.7.9 wrote the invalid section);
// when nothing precedes the first new title, the first new section keeps the section's id and
// language (2.7.9 dropped the emptied section, its id with it, when the book was saved).

const NBSP = ' ';

/** The children FictionBook Editor showed as a <P> in a section (the rest were DIVs). */
const P_TYPES = new Set(['p', 'subtitle', 'empty-line', 'text-author', 'v', 'date', 'td', 'th']);
/** What may open a section before its blocks. */
const HEADER_TYPES = new Set(['title', 'epigraph', 'image', 'annotation']);

/** A marker paragraph of the originals. */
export function markerItem(kind, n) {
  return { marker: kind, n };
}

export function isMarker(item) {
  return Boolean(item && item.marker);
}

/** nodeName == "P" in the originals (marker paragraphs included). */
export function isP(item) {
  return isMarker(item) || P_TYPES.has(item.type);
}

/** className of the originals' HTML element. */
export function className(item) {
  if (isMarker(item)) return '';
  if (item.type === 'p' || item.type === 'empty-line' || item.type === 'v') return '';
  if (item.type === 'date') return 'text-author';
  return item.type;
}

function plainText(node) {
  if (!node || node.type === 'text') return node?.text ?? '';
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : plainText(c))).join('');
}

function hasPicture(node) {
  if (!node || node.type === 'text') return false;
  if (node.type === 'image' || node.type === 'inline-image') return true;
  return (node.content ?? []).some(hasPicture);
}

/**
 * The originals' isLineEmpty: the element's innerHTML without its tags (pictures excepted) holds
 * nothing but spaces and non-breaking spaces. Internet Explorer wrote a line break between two
 * block children in innerHTML, which that test did not accept, so a container counts as empty
 * only when it has at most one child and that child is empty.
 */
export function isLineEmpty(item) {
  if (isMarker(item)) return false;
  if (hasPicture(item)) return false;
  if (P_TYPES.has(item.type)) return /^[  ]*$/.test(plainText(item));
  const children = item.content ?? [];
  if (children.length === 0) return true;
  return children.length === 1 && isLineEmpty(children[0]);
}

/** A copy of a block for a new title: a <P> inside a title is a paragraph or an empty line. */
function asTitleLine(item) {
  if (item.type === 'empty-line') return { type: 'empty-line', attrs: {} };
  const attrs = { ...(item.attrs ?? {}) };
  delete attrs.nodeId;
  return { type: 'p', attrs, content: stripIds(item.content ?? []) };
}

/** A copy of a subtree without node ids (the editor issues fresh ones). */
export function stripIds(nodes) {
  return nodes.map((node) => {
    if (node.type === 'text') return node;
    const attrs = { ...(node.attrs ?? {}) };
    delete attrs.nodeId;
    return node.content ? { ...node, attrs, content: stripIds(node.content) } : { ...node, attrs };
  });
}

/**
 * A section made valid for the editor: when nothing but its title, epigraphs, image and
 * annotation is left, an <empty-line/> is added; a second picture right after the section's
 * picture would be its first block, which FB2 does not allow, so an <empty-line/> goes in front.
 */
export function ensureBlocks(section) {
  const content = section.content ?? [];
  let i = 0;
  if (content[i]?.type === 'title') i += 1;
  while (content[i]?.type === 'epigraph') i += 1;
  if (content[i]?.type === 'image') i += 1;
  if (content[i]?.type === 'annotation') i += 1;
  if (i >= content.length) return { ...section, content: [...content, { type: 'empty-line', attrs: {} }] };
  if (content[i].type === 'image') {
    return { ...section, content: [...content.slice(0, i), { type: 'empty-line', attrs: {} }, ...content.slice(i)] };
  }
  return section;
}

/**
 * Splits a section whose children list holds marker items, the way the originals' outerHTML
 * rewrite did. `mergeAdjacent` is 07's "join titles that touch": an end marker followed directly
 * by a begin marker joins the two titles (and the second section) into one. Returns the
 * sections that replace the section, in order; the first one has the section's node id when the
 * section keeps a part, and the section's attributes when it keeps a part or nothing precedes the
 * first title.
 */
export function splitAtMarkers(section, items, mergeAdjacent = false) {
  let list = items;
  if (mergeAdjacent) {
    list = [];
    for (let i = 0; i < items.length; i += 1) {
      if (isMarker(items[i]) && items[i].marker === 'end' && isMarker(items[i + 1]) && items[i + 1].marker === 'begin') {
        i += 1; // both markers disappear: the title goes on
        continue;
      }
      list.push(items[i]);
    }
  }
  const leading = [];
  const parts = [];
  let current = null; // { title: [], body: [] }
  let inTitle = false;
  for (const item of list) {
    if (isMarker(item)) {
      if (item.marker === 'begin') {
        current = { title: [], body: [] };
        parts.push(current);
        inTitle = true;
      } else if (inTitle) {
        inTitle = false;
      }
      continue;
    }
    if (!current) leading.push(item);
    else if (inTitle) current.title.push(item);
    else current.body.push(item);
  }
  if (parts.length === 0) return [{ ...section, content: list }];
  const result = [];
  const sectionAttrs = { ...(section.attrs ?? {}) };
  if (leading.length > 0) result.push(ensureBlocks({ ...section, content: leading }));
  parts.forEach((part, index) => {
    const attrs = index === 0 && leading.length === 0 ? { ...sectionAttrs } : {};
    if (index !== 0 || leading.length !== 0) delete attrs.nodeId;
    const title = { type: 'title', attrs: {}, content: part.title.map(asTitleLine) };
    result.push(ensureBlocks({ type: 'section', attrs, content: [title, ...part.body] }));
  });
  return result;
}

/** Text of the originals' tests: innerHTML without tags, entities decoded (NBSP kept). */
export function testText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, NBSP)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** True when the section holds blocks (not sub-sections) besides its header. */
export function hasBlocks(section) {
  return (section.content ?? []).some((c) => c.type !== 'section' && !HEADER_TYPES.has(c.type));
}

/**
 * Writes the result back: each top-level section of a body is replaced by the first of the
 * sections that replace it (which keeps the section's node id) and the others are inserted after
 * it. The blocks that move keep their node ids (they are free once the section is replaced, and
 * the editor keeps the ids it is given); the new sections and titles get fresh ones. `transform`
 * maps a section to that list; it recurses into sub-sections itself and returns [section]
 * unchanged when nothing changes.
 */
export async function applyToBodies(bodies, transform, ctx) {
  const sections = bodies.flatMap((body) => (body.content ?? []).filter((child) => child.type === 'section'));
  for (let i = 0; i < sections.length; i += 1) {
    const child = sections[i];
    const pieces = transform(child);
    if (pieces.length !== 1 || pieces[0] !== child) {
      let ref = await mfbe.doc.replaceNode(child.attrs.nodeId, pieces[0]);
      for (const piece of pieces.slice(1)) ref = await mfbe.doc.insertNode('after', ref, piece);
    }
    if (i % 20 === 19) await mfbe.ui.progress(i + 1, sections.length);
    if (ctx.cancelled) return false;
  }
  return true;
}
