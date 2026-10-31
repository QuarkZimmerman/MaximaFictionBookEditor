// Shared helper of the scripts of "Обработка форматирования" converted from FictionBook Editor
// 2.7.9 that remove or dissolve containers - cites (19/10, 19/11), epigraphs (19/15, 19/16),
// section annotations (19/17, 19/18) - and tables (19/25). Each package carries its own copy:
// the sandbox only allows imports from inside the script's folder.
//
// The originals walked the DIVs of the editor's page from the last to the first and removed
// each container with its content (removeNode(true)) or without it, leaving its children in its
// place (removeNode(false)). That page was not checked against the FB2 schema: a dissolved body
// epigraph left paragraphs directly in the body, and 2.7.9 refused to save such a book until it
// was mended by hand. Here every change is a new content of the container's parent that the
// editor checks before anything changes (doc.replaceNode): the places are tried in order and the
// first one the schema accepts is taken (see placements()).

import { isApiError } from './text-blocks.js';

const STRUCTURE_ERRORS = ['invalidNode', 'notAllowed'];
const HEADER = new Set(['title', 'epigraph', 'image', 'annotation']);

/** A copy of a node without the editor's node ids (a new node gets new ones). */
export function withoutIds(node) {
  if (!node || node.type === 'text') return node;
  const { nodeId, ...attrs } = node.attrs ?? {};
  const copy = { ...node, attrs };
  if (node.content) copy.content = node.content.map(withoutIds);
  return copy;
}

/**
 * Whether the book annotation or the history holds nothing but empty lines: 2.7.9 saved no such
 * element (main.js, MakeTitleInfo / MakeDocInfo with IsEmpty), so a script that empties one
 * removes it.
 */
export function isEmptyBlock(node) {
  return (node?.content ?? []).every((child) => child.type === 'empty-line');
}

/** The nodes of `type` in a tree (an annotation or the history), document order: {node, parent, index}. */
export function nodesIn(root, type) {
  const out = [];
  const visit = (parent) => {
    (parent.content ?? []).forEach((node, index) => {
      if (!node || node.type === 'text') return;
      if (node.type === type) out.push({ node, parent, index });
      visit(node);
    });
  };
  if (root) visit(root);
  return out;
}

/**
 * Writes the first of the candidate contents of the parent (a node of the bodies, as read) that
 * the editor accepts; returns whether one was written. A candidate the schema refuses changes
 * nothing.
 */
export async function writeParentContent(parentId, parent, candidates) {
  for (const content of candidates) {
    if (!content) continue;
    try {
      await mfbe.doc.replaceNode(parentId, { ...parent, content });
      return true;
    } catch (error) {
      if (!isApiError(error, ...STRUCTURE_ERRORS)) throw error;
    }
  }
  return false;
}

/**
 * The children of a container as plain blocks: its own text authors become paragraphs (the
 * originals removed their class), and with `subtitlesToParagraphs` its subtitles too.
 */
export function linesOf(container, { subtitlesToParagraphs = false } = {}) {
  return (container.content ?? []).map((child) =>
    child.type === 'text-author' || (subtitlesToParagraphs && child.type === 'subtitle')
      ? { ...child, type: 'p' }
      : child,
  );
}

/** Lines as stanzas (paragraphs as verses, an empty line between two stanzas), or null. */
export function stanzasOf(lines) {
  const stanzas = [];
  let verses = [];
  for (const line of lines) {
    if (line.type === 'empty-line') {
      if (verses.length) stanzas.push({ type: 'stanza', attrs: {}, content: verses });
      verses = [];
    } else if (line.type === 'p') {
      verses.push({ ...line, type: 'v' });
    } else {
      return null;
    }
  }
  if (verses.length) stanzas.push({ type: 'stanza', attrs: {}, content: verses });
  return stanzas;
}

/**
 * Candidate contents of `parent` with its child at `index` dissolved into `lines`, in the
 * order they are tried:
 *  1. in its place (what the originals did);
 *  2. in a section, at the start of its text, after its title, epigraphs, picture and
 *     annotation (where paragraphs may stand: an epigraph before an annotation);
 *  3. in a body or a section of sections, as a section of their own, untitled, before the
 *     first child section (a body holds no paragraphs);
 *  4. in a poem, as stanzas (paragraphs as verses; a poem holds no paragraphs).
 */
export function placements(parent, index, lines) {
  const content = parent.content ?? [];
  const before = content.slice(0, index);
  const after = content.slice(index + 1);
  const rest = [...before, ...after];
  const candidates = [[...before, ...lines, ...after]];
  if (lines.length === 0) return candidates;
  if (parent.type === 'section') {
    let start = 0;
    while (start < rest.length && HEADER.has(rest[start].type)) start += 1;
    if (start < rest.length && rest[start].type !== 'section') {
      candidates.push([...rest.slice(0, start), ...lines, ...rest.slice(start)]);
    }
  }
  if (parent.type === 'section' || parent.type === 'body') {
    const first = rest.findIndex((child) => child.type === 'section');
    if (first >= 0) {
      const section = { type: 'section', attrs: {}, content: lines };
      candidates.push([...rest.slice(0, first), section, ...rest.slice(first)]);
    }
  }
  if (parent.type === 'poem') {
    const stanzas = stanzasOf(lines);
    if (stanzas) candidates.push([...before, ...stanzas, ...after]);
  }
  return candidates;
}

/** The parent of a node of the bodies and the node's index among the parent's children. */
export async function placeOf(nodeId) {
  const parentRef = await mfbe.doc.parentOf(nodeId);
  if (!parentRef) return null;
  const parent = await mfbe.doc.getNode(parentRef);
  const index = (parent.content ?? []).findIndex((child) => child.attrs?.nodeId === nodeId);
  return index < 0 ? null : { parentId: parentRef.nodeId, parent, index };
}
