// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/05_Снять
// форматирование блочным элементом.js (v2.7, moved there from 18_Мелочи редактирования/03_Снятие
// форматирования стихом, цитатой или эпиграфом.js v1.3 of 2.7beta1, from which this package was
// first converted; its id and folder stay).
//
// Dissolves the block element the caret is in - the innermost poem, epigraph, cite, title,
// annotation or table around the start of the selection (a selection counts from its start, as
// the original collapsed it; a poem's title or epigraph means the poem) - into plain text:
//  - a poem: stanzas, title, epigraphs, verses, subtitles, text authors and the date become
//    paragraphs, with an empty line between two stanzas that follow each other;
//  - a cite: everything in it becomes paragraphs (its poems, tables and subtitles too);
//  - an epigraph: it and the epigraphs and annotation that follow it;
//  - a title: it and the epigraphs and annotation that follow it (a stanza's title becomes
//    verses);
//  - a table: each cell becomes a paragraph, without the cells' and rows' attributes;
//  - a section's annotation: its content stays as it is, in its place (the book annotation stays);
//  - a title, epigraph or annotation of a section of sections or of a body: its text, and that of
//    the title, epigraphs and annotation after it, opens the first subsection when that one
//    starts with text, or else goes into a new untitled section before it.
// The caret is then put at the start of the first paragraph that came out (the original left
// the selection to the browser). A run started by another script (the combos of 2.7.9 select
// a title, poem, cite… and call this script) works on the selection that script left.
// Differences from 2.7.9 (docs/scripting/conversion-notes of feature 007): where its result was
// invalid FB2 (which 2.7.9 then refused to save) the text goes to the first place the schema
// accepts - after a section's picture and annotation that stay, after a stanza's subtitle - and
// a book annotation's cite, poem or table is dissolved through doc.setDescription; a blank table
// cell becomes an empty line, as 2.7.9 saved it; a cell's language stays; a status-bar line
// tells when the caret is in none of these elements.

import { TextBlocks, TEXT_BLOCK_TYPES, isApiError, t } from './lib/text-blocks.js';
import { placements, withoutIds } from './lib/containers.js';

const TARGETS = new Set(['poem', 'epigraph', 'cite', 'title', 'annotation', 'table']);
const HEAD = new Set(['title', 'epigraph', 'annotation']);
const STRUCTURE_ERRORS = ['invalidNode', 'notAllowed'];
// a P of the original's page: what unformatDivsAndParagraphsInsideElement turned into a plain P
const P_TYPES = new Set([...TEXT_BLOCK_TYPES, 'empty-line']);
const KEEP_ON_P = ['id', 'style', 'lang'];

/** A text block as a paragraph (its class removed): its id, style and language stay. */
function asParagraph(node, type = 'p') {
  if (node.type === 'empty-line' || ((node.type === 'td' || node.type === 'th') && isBlank(node))) {
    return { type: 'empty-line', attrs: {} };
  }
  const attrs = {};
  for (const key of KEEP_ON_P) if (node.attrs?.[key] !== undefined) attrs[key] = node.attrs[key];
  return { type, attrs, content: withoutIds({ type: 'x', content: node.content ?? [] }).content };
}

/** A cell with nothing but spaces (and no picture): 2.7.9 saved that paragraph as an empty line. */
function isBlank(node) {
  return (node.content ?? []).every((item) => item.type === 'text' && /^[\s\u00A0]*$/.test(item.text ?? ''));
}

/**
 * unformatDivsAndParagraphsInsideElement, then the element itself unwrapped: its content as a
 * flat list - every text block a paragraph, every container but pictures and sections dissolved;
 * with `stanzaBreaks` (a poem) an empty line after a stanza that another stanza follows.
 */
function flatten(children, stanzaBreaks) {
  const out = [];
  (children ?? []).forEach((child, i) => {
    if (!child || child.type === 'text') return;
    if (P_TYPES.has(child.type)) out.push(asParagraph(child));
    else if (child.type === 'image' || child.type === 'section') out.push(withoutIds(child));
    else {
      out.push(...flatten(child.content, stanzaBreaks));
      if (stanzaBreaks && child.type === 'stanza' && children[i + 1]?.type === 'stanza') out.push({ type: 'empty-line', attrs: {} });
    }
  });
  return out;
}

/** The table branch: the rows go, each cell becomes a paragraph without its attributes. */
function cellsOf(table) {
  const out = [];
  for (const row of table.content ?? []) {
    for (const cell of row.content ?? []) {
      if (!cell || cell.type === 'text') continue;
      if (isBlank(cell)) out.push({ type: 'empty-line', attrs: {} });
      else {
        const attrs = cell.attrs?.lang !== undefined ? { lang: cell.attrs.lang } : {};
        out.push({ type: 'p', attrs, content: withoutIds({ type: 'x', content: cell.content ?? [] }).content });
      }
    }
  }
  return out;
}

/** The start of the selection: the text block it starts in, or null (a picture, nothing). */
function startBlock(selection) {
  if (!selection || !Array.isArray(selection.nodes) || selection.nodes.length === 0) return null;
  return selection.nodes[0].nodeId;
}

/** Ancestors of a node of the bodies, innermost first, as { nodeId, type }. */
async function bodyPath(nodeId) {
  const path = [];
  let ref = await mfbe.doc.parentOf(nodeId);
  while (ref) {
    path.push(ref);
    ref = await mfbe.doc.parentOf(ref);
  }
  return path;
}

/** The chain of nodes from a description root down to the node with this id, or null. */
function descriptionPath(roots, nodeId) {
  const walk = (node, chain) => {
    if (!node || node.type === 'text') return null;
    const next = [...chain, node];
    if (node.attrs?.nodeId === nodeId) return next;
    for (const child of node.content ?? []) {
      const found = walk(child, next);
      if (found) return found;
    }
    return null;
  };
  for (const root of roots) {
    const found = walk(root, []);
    if (found) return found;
  }
  return null;
}

/**
 * What dissolving `el` (the child at `index` of `parent`) gives: the children it takes with it
 * (`count`), the flat content that replaces them (`lines`), or `subsection` when the head goes
 * into the sections that follow it; null when nothing is to be done (the book annotation).
 */
function dissolve(parent, index, inBody) {
  const content = parent.content ?? [];
  const el = content[index];
  if (HEAD.has(el.type) && (parent.type === 'section' || parent.type === 'body')) {
    let j = index;
    while (j < content.length && HEAD.has(content[j].type)) j += 1;
    if (content[j]?.type === 'section') {
      const lines = content.slice(index, j).flatMap((head) => flatten(head.content, false));
      return { count: j - index, lines, subsection: j };
    }
  }
  if (el.type === 'poem') return { count: 1, lines: flatten(el.content, true) };
  if (el.type === 'cite') return { count: 1, lines: flatten(el.content, false) };
  if (el.type === 'table') return { count: 1, lines: cellsOf(el) };
  if (el.type === 'epigraph' || el.type === 'title') {
    let j = index + 1;
    while (j < content.length && (content[j].type === 'epigraph' || content[j].type === 'annotation')) j += 1;
    let lines = content.slice(index, j).flatMap((node) => flatten(node.content, false));
    if (parent.type === 'stanza') lines = lines.map((line) => (line.type === 'p' ? { ...line, type: 'v' } : line));
    return { count: j - index, lines };
  }
  if (el.type === 'annotation') return inBody ? { count: 1, lines: withoutIds(el).content ?? [] } : null;
  return null;
}

/** The parent's contents to try, in order: 2.7.9's result first, then the places FB2 allows. */
function candidates(parent, index, plan) {
  const content = parent.content ?? [];
  if (plan.subsection !== undefined) {
    const before = content.slice(0, index);
    const sub = content[plan.subsection];
    const after = content.slice(plan.subsection + 1);
    const first = (sub.content ?? [])[0];
    // the first subsection opens with text (a P of the page, a cite, a poem, a table): the
    // head's text goes to its start; else into a new section in front of it
    if (first && (P_TYPES.has(first.type) || ['cite', 'poem', 'table'].includes(first.type))) {
      return [[...before, { ...sub, content: [...plan.lines, ...sub.content] }, ...after]];
    }
    return [[...before, { type: 'section', attrs: {}, content: plan.lines }, sub, ...after]];
  }
  const merged = { ...parent, content: [...content.slice(0, index), { type: '#taken' }, ...content.slice(index + plan.count)] };
  const out = placements(merged, index, plan.lines);
  if (parent.type === 'stanza') {
    // a stanza's title before its subtitle: the verses after the subtitle
    const rest = merged.content.filter((node) => node.type !== '#taken');
    const at = rest[0]?.type === 'subtitle' ? 1 : 0;
    out.push([...rest.slice(0, at), ...plan.lines, ...rest.slice(at)]);
  }
  // an emptied container keeps an empty line (an empty annotation was all its section had)
  if (plan.lines.length === 0) out.push([...content.slice(0, index), { type: 'empty-line', attrs: {} }, ...content.slice(index + plan.count)]);
  return out;
}

function nodeIds(node, out = new Set()) {
  if (!node || node.type === 'text') return out;
  if (node.attrs?.nodeId) out.add(node.attrs.nodeId);
  for (const child of node.content ?? []) nodeIds(child, out);
  return out;
}

/** The first text block in document order that was not there before. */
function firstNewTextBlock(node, old) {
  if (!node || node.type === 'text') return null;
  if (TEXT_BLOCK_TYPES.has(node.type)) return old.has(node.attrs?.nodeId) ? null : node;
  for (const child of node.content ?? []) {
    const found = firstNewTextBlock(child, old);
    if (found) return found;
  }
  return null;
}

async function notInside(ctx) {
  await mfbe.ui.status(
    t(ctx, 'Курсор не внутри стиха, эпиграфа, цитаты, заголовка, аннотации или таблицы.',
      'The caret is not inside a poem, an epigraph, a cite, a title, an annotation or a table.'),
  );
}

async function cannot(ctx) {
  await mfbe.ui.message(
    t(ctx, 'Снять форматирование нельзя: схема FB2 не допускает содержимое этого элемента ни на одном месте рядом с ним.',
      'The formatting cannot be removed: the FB2 schema allows the content of this element nowhere near it.'),
    { icon: 'warning' },
  );
}

/** The element to dissolve on a chain of ancestors (innermost first), with its parent's index in it. */
function pick(types) {
  let at = types.findIndex((type) => TARGETS.has(type));
  if (at < 0) return -1;
  // a poem's title or epigraph: the poem
  if ((types[at] === 'title' || types[at] === 'epigraph') && types[at + 1] === 'poem') at += 1;
  return at;
}

async function inBodies(ctx, path) {
  const at = pick(path.map((ref) => ref.type));
  if (at < 0 || at + 1 >= path.length) return notInside(ctx);
  const el = path[at];
  const parentId = path[at + 1].nodeId;
  const parent = await mfbe.doc.getNode(parentId);
  const index = (parent.content ?? []).findIndex((child) => child.attrs?.nodeId === el.nodeId);
  if (index < 0) return notInside(ctx);
  const plan = dissolve(parent, index, true);
  if (!plan) return undefined;
  const old = nodeIds(parent);
  for (const content of candidates(parent, index, plan)) {
    try {
      await mfbe.doc.replaceNode(parentId, { ...parent, content });
    } catch (error) {
      if (isApiError(error, ...STRUCTURE_ERRORS)) continue;
      throw error;
    }
    const first = firstNewTextBlock(await mfbe.doc.getNode(parentId), old);
    if (first) await mfbe.selection.set({ nodeId: first.attrs.nodeId, offset: 0 });
    return undefined;
  }
  return cannot(ctx);
}

async function inDescription(ctx, blocks, nodeId) {
  const chain = descriptionPath(await blocks.descriptionRoots(), nodeId);
  if (!chain) return undefined; // the empty paragraph shown for a missing annotation or history
  const ancestors = chain.slice(0, -1).reverse(); // innermost first
  const at = pick(ancestors.map((node) => node.type));
  if (at < 0) return notInside(ctx);
  // the book annotation itself stays, without a word (2.7.9: thereIsParentBodyDiv)
  if (at + 1 >= ancestors.length) return undefined;
  const parent = ancestors[at + 1];
  const index = parent.content.indexOf(ancestors[at]);
  const plan = dissolve(parent, index, false);
  if (!plan) return undefined;
  const saved = parent.content;
  for (const content of candidates(parent, index, plan)) {
    parent.content = content;
    try {
      await mfbe.doc.setDescription(blocks.description);
      return undefined;
    } catch (error) {
      parent.content = saved;
      if (!isApiError(error, ...STRUCTURE_ERRORS)) throw error;
    }
  }
  return cannot(ctx);
}

export default async function run(ctx) {
  const nodeId = startBlock(await mfbe.selection.get());
  if (!nodeId) return; // a selected picture (2.7.9: a control selection) or no book
  let path;
  try {
    path = await bodyPath(nodeId);
  } catch (error) {
    if (!isApiError(error, 'unknownNode')) throw error;
    return inDescription(ctx, new TextBlocks(), nodeId);
  }
  return inBodies(ctx, path);
}
