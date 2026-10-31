// Engines of the "select the next/previous <element>" scripts of FictionBook Editor 2.7.9's group
// 16_Поиск форматирования (Sclex, TaKir): each walks the paragraphs from the caret the way the
// originals did (getNextP / getPreviousP, getNextPOrDiv / getPreviousPOrDiv), selects what it
// finds and returns "Found", or says that nothing was found and returns "NotFound" - the values
// the originals' Run() returned to the scripts that run them in loops. Each package carries its
// own copy (the sandbox loads modules from the script's own folder only).

import {
  containerOf,
  isLineEmpty,
  loadBook,
  locate,
  nextNode,
  nextSibling,
  paragraphsIn,
  previousNode,
  previousSibling,
  refusePicture,
  selectContainer,
  selectParagraph,
  setRange,
  t,
  textOf,
} from './nav-lib.js';

/** Paragraph indices after (`forward`) or before a point, nearest first. */
function* indicesFrom(book, point, forward) {
  if (forward) {
    for (let i = Math.floor(point.index) + 1; i < book.ps.length; i += 1) yield i;
  } else {
    for (let i = Math.ceil(point.index) - 1; i >= 0; i -= 1) yield i;
  }
}

/** The common start: the book, the selection, a refused picture selection, the first status. */
async function begin(ctx, options) {
  const book = await loadBook();
  const where = await locate(book, options.forward);
  if (!where) return null;
  if (where.picture) {
    await refusePicture(ctx);
    return null;
  }
  await mfbe.ui.status(t(ctx, options.status.ru, options.status.en));
  return { book, where };
}

async function finish(ctx, options, found) {
  if (!found) await mfbe.ui.message(t(ctx, options.notFound.ru, options.notFound.en));
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'));
  return found ? 'Found' : 'NotFound';
}

/**
 * Annotations, titles, epigraphs, cites, poems, poem titles, stanzas, tables (145-160): from the
 * end of the selection, the first paragraph that `check` accepts and whose nearest container of
 * class `cls` is not the one the caret is in; that container is selected.
 */
export async function runContainerSearch(ctx, options) {
  const started = await begin(ctx, options);
  if (!started) return undefined;
  const { book, where } = started;
  const from = where.end;
  const atStart = from.item ? containerOf(from.item, options.cls) : null;
  let found = null;
  for (const i of indicesFrom(book, from, options.forward)) {
    const p = book.ps[i];
    if (options.check(p) && containerOf(p, options.cls) !== atStart) {
      found = containerOf(p, options.cls);
      break;
    }
  }
  if (found) await selectContainer(found);
  return finish(ctx, options, found);
}

/**
 * Entirely italic / bold paragraphs (135-144) and subtitles (161-166): from the start
 * (`forward` false) or the end of the selection, the first other paragraph that `test`
 * accepts; it is selected.
 */
export async function runParagraphSearch(ctx, options) {
  const started = await begin(ctx, options);
  if (!started) return undefined;
  const { book, where } = started;
  const from = options.forward ? where.end : where.start;
  let found = null;
  for (const i of indicesFrom(book, from, options.forward)) {
    if (options.test(book.ps[i])) {
      found = book.ps[i];
      break;
    }
  }
  if (found) await selectParagraph(found);
  return finish(ctx, options, found);
}

/**
 * Text authors (167, 168): from the start (backward) or the end of the selection, the next
 * group of text authors that follow each other (a poem's date counts: FictionBook Editor showed
 * it as a text author); the group the caret is in is skipped. The group is selected.
 */
export async function runTextAuthorSearch(ctx, options) {
  const started = await begin(ctx, options);
  if (!started) return undefined;
  const { book, where } = started;
  const from = options.forward ? where.end : where.start;
  const isAuthor = (p) => p.cls === 'text-author';
  let state = from.item && from.item.kind === 'p' && isAuthor(from.item) ? -1 : 0;
  let first = null;
  let last = null;
  for (const i of indicesFrom(book, from, options.forward)) {
    const p = book.ps[i];
    if (state === -1 && !isAuthor(p)) state = 0;
    else if (state === 0 && isAuthor(p)) {
      state = 1;
      first = p;
      last = p;
    } else if (state === 1 && isAuthor(p)) last = p;
    else if (state === 1 && !isAuthor(p)) {
      state = 2;
      break;
    }
  }
  const found = state === 1 || state === 2;
  if (found) {
    const top = options.forward ? first : last;
    const bottom = options.forward ? last : first;
    await setRange(top, 0, bottom, textOf(bottom).length);
  }
  return finish(ctx, options, found);
}

const REPEATED = /^(cite|poem|subtitle|epigraph)$/i;

/**
 * Elements of one type that follow each other (200, 201): from the start (backward) or the end
 * of the selection, every paragraph and container in the originals' order; the first cite,
 * poem, subtitle or epigraph whose next (previous) sibling - empty paragraphs between them left
 * out - is of the same type. Its first paragraph is selected.
 */
export async function runRepeatedSearch(ctx, options) {
  const started = await begin(ctx, options);
  if (!started) return undefined;
  const { book, where } = started;
  const point = options.forward ? where.end : where.start;
  const step = options.forward ? nextNode : previousNode;
  const sibling = options.forward ? nextSibling : previousSibling;
  const sameNeighbour = (item) => {
    let other = sibling(item);
    while (other && other.kind === 'p' && isLineEmpty(other)) other = sibling(other);
    return other !== null && other.cls === item.cls;
  };
  // An unknown place counts as the document's start: everything lies after it, nothing before.
  let node = point.item ?? (options.forward ? book.root : null);
  let found = null;
  while (node) {
    node = step(node);
    if (node && REPEATED.test(node.cls) && sameNeighbour(node)) {
      found = node;
      break;
    }
  }
  if (found) {
    const target = found.kind === 'div' ? (paragraphsIn(found)[0] ?? found) : found;
    if (target.kind === 'div') await selectContainer(target);
    else await selectParagraph(target);
  }
  return finish(ctx, options, found);
}

/* ------------------------------------------------------------------------------------------ */
/* Tests of the paragraph scripts                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * The originals' isEntirelyItalic / isEntirelyBold: not empty, and once every run of the mark
 * is removed only spaces and non-breaking spaces are left (pictures do not count).
 */
export function entirely(p, mark) {
  if (p.kind !== 'p' || isLineEmpty(p)) return false;
  for (const child of p.node.content ?? []) {
    if (child.type !== 'text') continue;
    if ((child.marks ?? []).some((m) => m.type === mark)) continue;
    if (!/^[ \u00A0]*$/.test(child.text)) return false;
  }
  return true;
}
