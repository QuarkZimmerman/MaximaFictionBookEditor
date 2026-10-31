// Shared engine of Sclex's "Создать сноски или комментарии из ... абзацев" scripts of FictionBook
// Editor 2.7.9 (from selected paragraphs; from paragraphs marked with asterisks, hashes, carets or
// configurable markers). Each package carries its own byte-identical copy (the sandbox loads
// modules from the script's own folder only) and passes its settings: the dialog, the markers.
//
// The originals did their work in a modeless HTML dialog (HTML/Создать сноски ... - задание
// параметров.htm) over FictionBook Editor's page, in passes:
//   1. the note texts: the selected paragraphs (12) or the paragraphs that start with the "first
//      paragraph" marker (15-24), each starting a note, a paragraph starting with the
//      continuation marker ("++") continuing the one before; a poem, cite, table or epigraph is
//      taken whole;
//   2. the note signs: the matches of the sign marker in the text before the selection (12) or
//      in every paragraph that is not a note text (15-24), outside links;
//   3. when both numbers agree and the user confirms, every sign becomes a link to a new section
//      of the notes (or comments) body holding the next note text, placed after the section of
//      the note link before it; then every section of that body is renumbered (ids n_N / c_N,
//      titles N) with every link pointing to it ([N], or {N} in superscript for comments);
//   4. (15-24) on a second confirmation the paragraphs the note texts came from are removed with
//      the empty lines around them.
// The dialog becomes a loop of forms: the dialog's buttons are a choice of the form, and the
// form comes back where the dialog stayed open (preview, a count that does not agree, a
// declined confirmation); creating the notes ends the run.

import {
  CONTAINERS,
  NBSP,
  bodyNamed,
  commentLinkText,
  commit,
  copy,
  footnoteLinkText,
  itemLength,
  linkGroups,
  loadBook,
  localHref,
  normalise,
  pageBlocks,
  pageRoots,
  plainText,
  removeTextRange,
  renumber,
  t,
  tagFreeText,
  titleNode,
  touch,
  units,
  withoutIds,
} from './notes-book.js';

/** Notes and comments, as initVarsForNotes() / initVarsForComments() set them. */
export const TARGETS = {
  notes: {
    bodyName: 'notes',
    bodyTitle: 'Примечания',
    prefix: 'n_',
    noteType: 'note',
    linkText: footnoteLinkText,
  },
  comments: {
    bodyName: 'comments',
    bodyTitle: 'Комментарии',
    prefix: 'c_',
    noteType: null,
    linkText: commentLinkText,
  },
};

const SPACES = /^[ \u00A0]*/;
/** A paragraph of asterisks and spaces only ("* * *"): pIsSubtitleRegExp of the originals. */
const ASTERISK_LINE = /^[ \u00A0*]*[*][ \u00A0*]*$/;
/** upperNumberRegExp: a number in superscript (Unicode superscript digits or <SUP> digits). */
const SUP_NUMBER =
  /([¹²³⁴⁵⁶⁷⁸⁹⁰]+)(<SUP>[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]*(?=[^<]*<\/SUP>)(<\/SUP>[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)*|([¹²³⁴⁵⁶⁷⁸⁹⁰]+<SUP>)?[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]+(?=[^<]*<\/SUP>)(<\/SUP>[¹²³⁴⁵⁶⁷⁸⁹⁰]+(<SUP>[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]+(?=[^<]*<\/SUP>))?)*/g;
/** The sign marker "число надстрочным текстом" of the dialogs (refMarkerRegExp). */
const SUP_SIGN =
  /(([¹²³⁴⁵⁶⁷⁸⁹⁰]+)(<SUP>[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]*(?=[^<]*<\/SUP>)(<\/SUP>[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)*)|(([¹²³⁴⁵⁶⁷⁸⁹⁰]+<SUP>)?[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]+(?=[^<]*<\/SUP>)(<\/SUP>[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)/g;

/* ------------------------------------------------------------------------------------------ */
/* Text and markers                                                                           */
/* ------------------------------------------------------------------------------------------ */

function inLink(item) {
  return (item?.marks ?? []).some((mark) => mark.type === 'link');
}

function hasSup(marks) {
  return (marks ?? []).some((mark) => mark.type === 'sup');
}

/**
 * The paragraph with only its first-level superscripts as <SUP> tags, the way the superscript
 * expressions saw it (leaveOnlySupsRegExp + leaveOnlyFirstLevelSups; "<", ">" and "&" as
 * entities, as in innerHTML; pictures, being tags, leave nothing). `pos[i]` is the tag-free
 * text position of character i, -1 for a tag. Text positions before `from` are left out (the
 * leading spaces the originals removed). With `linksAsX` every link's content is one "x" (the
 * count of the originals did so), whose position is -2.
 */
function supHtml(content, linksAsX = false, from = 0) {
  let html = '';
  const pos = [];
  let open = false;
  const put = (s, p) => {
    for (const ch of s) {
      html += ch;
      pos.push(p);
    }
  };
  const emit = (ch, sup, p) => {
    if (sup !== open) {
      put(sup ? '<SUP>' : '</SUP>', -1);
      open = sup;
    }
    put(ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch, p);
  };
  const groups = linksAsX ? linkGroups(content) : [];
  let textPos = 0;
  for (let index = 0; index < content.length; index += 1) {
    const item = content[index];
    const group = groups.find((g) => index >= g.first && index <= g.last);
    if (group) {
      if (index === group.first) emit('x', hasSup(group.outer), -2);
      if (item.type === 'text') textPos += item.text.length;
      continue;
    }
    if (item.type !== 'text') continue;
    for (let k = 0; k < item.text.length; k += 1, textPos += 1) {
      if (textPos < from) continue;
      emit(item.text[k], hasSup(item.marks), textPos);
    }
  }
  if (open) put('</SUP>', -1);
  return { html, pos };
}

/** The tag-free positions a match of a superscript expression covers (tags left out). */
function supMatchPositions(sup, m) {
  const out = [];
  for (let k = m.index; k < m.index + m[0].length; k += 1) {
    const p = sup.pos[k];
    if (p >= 0 && out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

/** findMarkerLen: leading spaces, the marker and the spaces after it, when the text starts so. */
export function continuationLength(text, marker) {
  const lead = SPACES.exec(text)[0].length;
  const rest = text.slice(lead);
  if (rest.indexOf(marker) !== 0) return 0;
  const trail = SPACES.exec(rest.slice(marker.length))[0].length;
  return lead + marker.length + trail;
}

/**
 * The "first paragraph" marker at the start of a paragraph (after spaces): `{ lead, length }`
 * or null. Kinds: 'regexp' (a pattern that must match at the start; `noLinks` - not inside a
 * link), 'superscript', 'text'.
 */
function firstMarkerAt(content, marker, checkLinks) {
  const map = tagFreeText(content);
  const lead = SPACES.exec(map.text)[0].length;
  const rest = map.text.slice(lead);
  if (marker.kind === 'text') {
    return rest.startsWith(marker.text) ? { lead, length: marker.text.length } : null;
  }
  if (marker.kind === 'superscript') {
    // containsFirstNotePMarker with upperIndex2: the leading spaces removed, a number in
    // superscript right at the start (its <SUP> may come first)
    const sup = supHtml(content, false, lead);
    SUP_NUMBER.lastIndex = 0;
    const m = SUP_NUMBER.exec(sup.html);
    if (!m || !(m.index === 0 || (m.index === 5 && sup.html.startsWith('<SUP>')))) return null;
    return { lead, length: supMatchPositions(sup, m).length };
  }
  marker.re.lastIndex = 0;
  const m = marker.re.exec(rest);
  if (!m || m.index !== 0) return null;
  if (checkLinks) {
    for (let i = lead; i < lead + m[0].length; i += 1) if (inLink(map.items[i])) return null;
  }
  return { lead, length: m[0].length };
}

/**
 * removeMarkerAtBeginning: the paragraph without the "first paragraph" marker at its start and
 * the spaces around it (the content is returned unchanged when it does not start with one).
 */
function withoutFirstMarker(content, marker) {
  const found = firstMarkerAt(content, marker, false);
  if (!found || (marker.kind === 'regexp' && found.length === 0)) return content;
  const map = tagFreeText(content);
  let end = found.lead + found.length;
  while (end < map.text.length && (map.text[end] === ' ' || map.text[end] === NBSP)) end += 1;
  return removeTextRange(content, map, 0, end);
}

function withoutContinuation(content, length) {
  if (!length) return content;
  return removeTextRange(content, tagFreeText(content), 0, length);
}

/**
 * The sign markers of a paragraph, in order: `[{ positions }]` (tag-free text positions).
 * `forCount` takes the originals' count (processP_3) instead of their search (processP_2):
 * for superscripts it counts the matches with every link's content replaced by "x".
 */
function signMarkers(content, options, forCount) {
  const sign = options.sign;
  const map = tagFreeText(content);
  const out = [];
  const linked = (positions) => positions.some((p) => inLink(map.items[p]));
  if (sign.kind === 'superscript') {
    if (forCount) {
      const sup = supHtml(content, true);
      SUP_NUMBER.lastIndex = 0;
      const all = sup.html.match(SUP_NUMBER) ?? [];
      return all.map(() => ({ positions: [] }));
    }
    const sup = supHtml(content);
    SUP_SIGN.lastIndex = 0;
    let m;
    while ((m = SUP_SIGN.exec(sup.html))) {
      if (m[0].length === 0) {
        SUP_SIGN.lastIndex += 1;
        continue;
      }
      if (options.notFromStart && m.index === 0) continue;
      const positions = supMatchPositions(sup, m);
      if (!positions.length || linked(positions)) continue;
      out.push({ positions });
    }
    return out;
  }
  if (sign.kind === 'text') {
    if (!sign.text) return out;
    let from = 0;
    for (;;) {
      const at = map.text.indexOf(sign.text, from);
      if (at < 0) break;
      from = at + sign.text.length;
      const positions = [];
      for (let k = at; k < at + sign.text.length; k += 1) positions.push(k);
      if (options.notFromStart && at === 0) continue;
      if (linked(positions)) continue;
      out.push({ positions });
    }
    return out;
  }
  const re = sign.re.global ? sign.re : new RegExp(sign.re.source, `${sign.re.flags}g`);
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(map.text))) {
    if (m[0].length === 0) {
      // an empty match: 2.7.9 looped for ever on it
      re.lastIndex += 1;
      continue;
    }
    if (options.notFromStart && m.index === 0) continue;
    const positions = [];
    for (let k = m.index; k < m.index + m[0].length; k += 1) positions.push(k);
    if (linked(positions)) continue;
    out.push({ positions });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* The page as the dialogs walked it                                                          */
/* ------------------------------------------------------------------------------------------ */

const isP = (node) => node.type === 'empty-line' || ['p', 'subtitle', 'v', 'text-author', 'date', 'td', 'th'].includes(node.type);

/**
 * The page's block-level elements in document order (a container before its content):
 * `{ node, parents, root, end }`, `end` the index after the element's subtree.
 */
function pageItems(book) {
  const out = [];
  const visit = (node, parents, root) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    const item = { node, parents, root, end: 0 };
    out.push(item);
    if (!isP(node) && node.type !== 'image' && node.type !== 'raw-xml') {
      for (const child of node.content ?? []) visit(child, [node, ...parents], root);
    }
    item.end = out.length;
  };
  for (const root of pageRoots(book)) if (root.node) visit(root.node, [], root);
  return out;
}

/** The P elements of a container (getElementsByTagName("P")): text blocks and empty lines. */
function paragraphsOf(node) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object' || n.type === 'text') return;
    if (isP(n)) {
      out.push(n);
      return;
    }
    for (const child of n.content ?? []) visit(child);
  };
  visit(node);
  return out;
}

/** The note text a paragraph gives: <P> (a subtitle stays one), an empty one an empty line. */
function noteParagraph(node, content) {
  if (node.type === 'subtitle') return { type: 'subtitle', attrs: {}, content: withoutIds(content) };
  const text = plainText(content);
  if (/^[ \u00A0]*$/.test(text)) return { type: 'empty-line', attrs: {} };
  return { type: 'p', attrs: {}, content: withoutIds(content) };
}

/** A container copied into a note, each of its paragraphs changed by `change(node)`. */
function noteContainer(node, change) {
  const clone = withoutIds(node);
  const visit = (n) => {
    if (!n || typeof n !== 'object' || n.type === 'text') return;
    if (isP(n)) {
      if (n.content) n.content = change(n);
      return;
    }
    for (const child of n.content ?? []) visit(child);
  };
  visit(clone);
  return clone;
}

/**
 * The note texts: `{ notes: [[node...]...], sources: [{ node, parents, root }] }`. A note text
 * is a list of FB2 nodes for the note's section.
 */
class NoteTexts {
  constructor() {
    this.notes = [];
    this.sources = [];
    this.first = true;
  }

  /** A unit that does not continue the note before it starts a new one (except the first). */
  add(nodes, continues) {
    if (this.notes.length === 0) this.notes.push([]);
    else if (!continues && !this.first) this.notes.push([]);
    this.notes[this.notes.length - 1].push(...nodes);
    this.first = false;
  }
}

/** 12: the units the selection covers (extractNotesInMyWin of 12). */
function selectedNotes(book, selection, options) {
  const items = pageItems(book);
  const index = new Map(items.map((item, i) => [item.node.attrs?.nodeId, i]));
  const blocks = pageBlocks(book);
  const order = new Map(blocks.map((b, i) => [b.node.attrs?.nodeId, i]));
  const a = order.get(selection.anchor.nodeId);
  const h = order.get(selection.head.nodeId);
  if (a === undefined || h === undefined) return null;
  const forward = a < h || (a === h && selection.anchor.offset <= selection.head.offset);
  const start = forward ? selection.anchor : selection.head;
  const end = forward ? selection.head : selection.anchor;
  const startBlock = blocks[order.get(start.nodeId)];
  const endBlock = blocks[order.get(end.nodeId)];
  const texts = new NoteTexts();
  const marker = options.continuation;

  const processP = (node) => {
    // a paragraph the selection ends at the very start of is not taken (processP's check)
    if (node === endBlock.node && end.offset === 0 && node !== startBlock.node) return;
    const content = node.content ?? [];
    const length = continuationLength(tagFreeText(content).text, marker);
    texts.add([noteParagraph(node, withoutContinuation(content, length))], length > 0);
  };
  const processContainer = (node) => {
    const ps = paragraphsOf(node);
    if (!ps.length) return;
    const length = continuationLength(tagFreeText(ps[0].content ?? []).text, marker);
    const clone = noteContainer(node, (p) => {
      const content = p.content ?? [];
      return withoutContinuation(content, continuationLength(tagFreeText(content).text, marker));
    });
    texts.add([clone], length > 0);
  };
  const holdsEnd = (item) => {
    const i = index.get(endBlock.node.attrs?.nodeId);
    const self = items.indexOf(item);
    return i !== undefined && i >= self && i < item.end;
  };

  let i = index.get(startBlock.node.attrs?.nodeId);
  const startItem = items[i];
  const container = startItem.parents.find((p) => CONTAINERS.has(p.type));
  if (container) {
    const ci = items.findIndex((item) => item.node === container);
    processContainer(container);
    if (holdsEnd(items[ci])) return texts;
    i = items[ci].end;
  } else {
    processP(startItem.node);
    if (startItem.node === endBlock.node) return texts;
    i += 1;
  }
  while (i < items.length) {
    const item = items[i];
    const node = item.node;
    if (isP(node)) {
      processP(node);
      if (node === endBlock.node) break;
      i += 1;
      continue;
    }
    if (CONTAINERS.has(node.type)) {
      processContainer(node);
      if (holdsEnd(item)) break;
      i = item.end;
      continue;
    }
    i += 1;
  }
  return texts;
}

/** 15-24: the paragraphs marked as note texts (extractNotesInMyWin of 15-24). */
function markedNotes(book, options) {
  const items = pageItems(book);
  const texts = new NoteTexts();
  const marker = options.continuation;
  const first = options.first;
  const isSource = (content) => firstMarkerAt(content, first, first.kind === 'regexp') !== null;
  const strip = (content) => {
    const length = continuationLength(tagFreeText(content).text, marker);
    return withoutFirstMarker(withoutContinuation(content, length), first);
  };

  for (let i = 0; i < items.length; ) {
    const item = items[i];
    const node = item.node;
    if (node.type === 'body' && (node.attrs?.name === 'notes' || node.attrs?.name === 'comments')) {
      // the notes and comments bodies hold no note sources (2.7.9 meant to skip them)
      i = item.end;
      continue;
    }
    if (isP(node)) {
      const content = node.content ?? [];
      const text = tagFreeText(content).text;
      if (!ASTERISK_LINE.test(text)) {
        const length = continuationLength(text, marker);
        if (length > 0 || isSource(content)) {
          texts.add([noteParagraph(node, strip(content))], length > 0);
          texts.sources.push(item);
        }
      }
      i += 1;
      continue;
    }
    if (CONTAINERS.has(node.type)) {
      const ps = paragraphsOf(node);
      if (ps.length) {
        const content = ps[0].content ?? [];
        const text = tagFreeText(content).text;
        const length = continuationLength(text, marker);
        const taken = (length > 0 || isSource(content)) && !(options.asteriskContainers && length === 0 && ASTERISK_LINE.test(text));
        if (taken) {
          texts.add([noteContainer(node, (p) => strip(p.content ?? []))], length > 0);
          texts.sources.push(item);
        }
      }
      i = item.end;
      continue;
    }
    i += 1;
  }
  return texts;
}

/* ------------------------------------------------------------------------------------------ */
/* The signs and the new notes                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * Whether a paragraph may hold signs: every text block of the page (12: those before the
 * selection's first one). A poem's date is left alone: FB2 allows no link in it. In 15-24 an
 * asterisk line and a paragraph starting with the "first paragraph" marker hold none.
 */
function holdsSigns(entry, options) {
  if (entry.node.type === 'empty-line' || entry.node.type === 'date') return false;
  if (options.mode !== 'markers') return true;
  const content = entry.node.content ?? [];
  if (ASTERISK_LINE.test(tagFreeText(content).text)) return false;
  return firstMarkerAt(content, options.first, false) === null;
}

/** The text blocks the passes go through: all, or (12) those before the selection's first. */
function scannedBlocks(book, limitNodeId) {
  const out = [];
  for (const entry of pageBlocks(book)) {
    if (limitNodeId && entry.node.attrs?.nodeId === limitNodeId) break;
    out.push(entry);
  }
  return out;
}

export function countSigns(book, options, limitNodeId) {
  let n = 0;
  for (const entry of scannedBlocks(book, limitNodeId)) {
    if (holdsSigns(entry, options)) n += signMarkers(entry.node.content ?? [], options, true).length;
  }
  return n;
}

/**
 * Turns the signs into note links and the note texts into sections (processP_2 for every
 * paragraph, then renumberNotes). Returns `{ created }`, or `{ error }` before anything changed.
 */
function createNotes(book, options, target, texts, limitNodeId) {
  let body = bodyNamed(book, target.bodyName);
  // The ids inside the target body, each with the section of the body that holds it.
  const sectionById = new Map();
  for (const section of body ? body.content : []) {
    if (section.type !== 'section') continue;
    const visit = (node) => {
      if (!node || typeof node !== 'object' || node.type === 'text') return;
      if (node.attrs?.id && !sectionById.has(node.attrs.id)) sectionById.set(node.attrs.id, section);
      for (const child of node.content ?? []) visit(child);
    };
    visit(section);
  }
  const insideBody = new Set();
  const visitBody = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.attrs?.id) insideBody.add(node.attrs.id);
    for (const child of node.content ?? []) visitBody(child);
  };
  if (body) visitBody(body);
  const sectionOf = (id) => sectionById.get(id) ?? null;
  // findPreviousNote: the link before the sign that is a note link (class "note", for notes)
  // or points into the target body; the new section goes after the section it points to.
  // While there is no target body yet, there is no note before (findPreviousNote's first line).
  const plan = [];
  const isCandidate = (group) => {
    if (body === null && plan.length === 0) return false;
    const id = localHref(group.href);
    const intoTarget = id !== null && insideBody.has(id);
    return target.noteType === 'note' ? Boolean(group.type) || intoTarget : intoTarget;
  };
  // Pass 1: the signs in order and where their notes go.
  let previous = null; // { kind: 'section', node } | { kind: 'new', k } | { kind: 'missing', id }
  let k = 0;
  for (const entry of scannedBlocks(book, limitNodeId)) {
    const content = entry.node.content ?? [];
    const map = tagFreeText(content);
    const signs = holdsSigns(entry, options) ? signMarkers(content, options, false) : [];
    const events = [
      ...linkGroups(content).map((group) => ({ at: group.start, group })),
      ...signs.map((sign) => ({ at: map.at[sign.positions[0]], sign })),
    ].sort((x, y) => x.at - y.at || (x.sign ? 1 : 0) - (y.sign ? 1 : 0));
    for (const event of events) {
      if (event.group) {
        if (!isCandidate(event.group)) continue;
        const id = localHref(event.group.href);
        const section = sectionOf(id);
        previous = section ? { kind: 'section', node: section } : { kind: 'missing', id };
        continue;
      }
      k += 1;
      if (previous && previous.kind === 'missing') return { error: 'missing', id: previous.id };
      plan.push({ entry, sign: event.sign, k, after: previous });
      previous = { kind: 'new', k };
    }
  }
  // Pass 2: the paragraphs, from their last sign to their first.
  const prefix = `tmp_${Math.floor(Math.random() * 1e9)}_`;
  const byEntry = new Map();
  for (const step of plan) {
    if (!byEntry.has(step.entry)) byEntry.set(step.entry, []);
    byEntry.get(step.entry).push(step);
  }
  for (const [entry, steps] of byEntry) {
    let content = copy(entry.node.content ?? []);
    for (const step of [...steps].reverse()) content = placeLink(content, step.sign, `#${prefix}${step.k}`, target);
    entry.node.content = normalise(content);
    touch(book, entry.root);
  }
  // Pass 3: the sections.
  const newSections = new Map();
  for (const step of plan) {
    const section = {
      type: 'section',
      attrs: { id: `${prefix}${step.k}` },
      content: [titleNode('0'), ...sectionContent(texts.notes[step.k - 1] ?? [])],
    };
    newSections.set(step.k, section);
    if (!body) {
      body = { type: 'body', attrs: { name: target.bodyName }, content: [titleNode(target.bodyTitle), section] };
      book.bodies.push(body);
      book.created.add(body);
      continue;
    }
    const content = body.content;
    let at;
    if (step.after && step.after.kind === 'section') at = content.indexOf(step.after.node) + 1;
    else if (step.after && step.after.kind === 'new') at = content.indexOf(newSections.get(step.after.k)) + 1;
    else {
      // no note before it: at the start of the body's sections, the body titled first if needed
      if (!content.some((node) => node.type === 'title')) {
        const image = content[0] && content[0].type === 'image' ? 1 : 0;
        content.splice(image, 0, titleNode(target.bodyTitle));
      }
      at = content.findIndex((node) => node.type === 'section');
      if (at < 0) at = content.length;
    }
    content.splice(at, 0, section);
    if (!book.created.has(body)) book.changed.add(body);
  }
  if (plan.length) renumber(book, body, target.prefix, (n) => target.linkText(n));
  return { created: plan.length };
}

/** The note text as section content: an epigraph that does not open it becomes a cite. */
function sectionContent(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.type === 'epigraph' && out.some((n) => n.type !== 'epigraph')) out.push(epigraphAsCite(node));
    else out.push(node);
  }
  if (!out.length) out.push({ type: 'empty-line', attrs: {} });
  return out;
}

function epigraphAsCite(node) {
  const content = [];
  for (const child of node.content ?? []) {
    if (child.type === 'cite') {
      for (const inner of child.content ?? []) content.push(inner.type === 'text-author' ? { ...inner, type: 'p' } : inner);
    } else content.push(child);
  }
  return { type: 'cite', attrs: {}, content };
}

/**
 * Replaces a sign with a note link: the sign's characters go, the spaces before it too
 * (removeSpacesBeyondTags - pictures in between stay), the link takes the formatting of the
 * sign's first character without superscript (unsupReferences).
 */
function placeLink(content, sign, href, target) {
  const map = tagFreeText(content);
  const first = sign.positions[0];
  const offset = map.at[first];
  const outer = (map.items[first].marks ?? []).filter((mark) => mark.type !== 'sup' && mark.type !== 'link');
  const drop = new Set(sign.positions.map((p) => map.at[p]));
  const rest = [];
  let insertAt = -1;
  let pos = 0;
  for (const item of content) {
    if (item.type !== 'text') {
      if (insertAt < 0 && pos >= offset) insertAt = rest.length;
      rest.push(item);
      pos += 1;
      continue;
    }
    let before = '';
    let after = '';
    for (let c = 0; c < item.text.length; c += 1) {
      if (drop.has(pos + c)) continue;
      if (pos + c < offset) before += item.text[c];
      else after += item.text[c];
    }
    if (before) rest.push({ ...item, text: before });
    if (insertAt < 0 && pos + item.text.length > offset) insertAt = rest.length;
    if (after) rest.push({ ...item, text: after });
    pos += item.text.length;
  }
  if (insertAt < 0) insertAt = rest.length;
  for (let i = insertAt - 1; i >= 0; i -= 1) {
    const item = rest[i];
    if (item.type !== 'text') continue;
    const trimmed = item.text.replace(/[ \u00A0]+$/, '');
    if (trimmed) {
      rest[i] = { ...item, text: trimmed };
      break;
    }
    rest.splice(i, 1);
    insertAt -= 1;
  }
  const mark = { type: 'link', attrs: target.noteType ? { href, type: target.noteType } : { href } };
  const linkItems = target.linkText(0).map((li) => ({ ...li, marks: [...outer, mark, ...(li.marks ?? [])] }));
  rest.splice(insertAt, 0, ...linkItems);
  return rest;
}

/* ------------------------------------------------------------------------------------------ */
/* Removing the source paragraphs                                                             */
/* ------------------------------------------------------------------------------------------ */

function isLineEmpty(node) {
  if (!isP(node)) return false;
  if (node.type === 'empty-line') return true;
  return (node.content ?? []).every((item) => item.type === 'text' && /^[ \u00A0]*$/.test(item.text));
}

/**
 * removeSourceNodes: every source with the empty lines right before and after it. A section left
 * without content keeps an empty line (FB2 wants content in a section).
 */
function removeSources(book, sources) {
  for (const source of sources) {
    const parent = source.parents[0];
    if (!parent) continue;
    const siblings = parent.content;
    let at = siblings.indexOf(source.node);
    if (at < 0) continue;
    while (at > 0 && isLineEmpty(siblings[at - 1])) {
      siblings.splice(at - 1, 1);
      at -= 1;
    }
    while (at + 1 < siblings.length && isLineEmpty(siblings[at + 1])) siblings.splice(at + 1, 1);
    siblings.splice(at, 1);
    if (parent.type === 'section' && !siblings.some((n) => !['title', 'epigraph', 'image', 'annotation'].includes(n.type))) {
      siblings.push({ type: 'empty-line', attrs: {} });
    }
    // An annotation or history left empty goes, as 2.7.9 saved none (MakeTitleInfo, IsEmpty).
    if (source.root.kind !== 'body' && source.root.node.content.every((n) => isLineEmpty(n))) {
      if (source.root.kind === 'annotation') delete book.description.titleInfo.annotation;
      else delete book.description.documentInfo.history;
    }
    touch(book, source.root);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The preview                                                                                */
/* ------------------------------------------------------------------------------------------ */

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TAGS = { strong: 'strong', emphasis: 'em', strikethrough: 's', sub: 'sub', sup: 'sup', code: 'code' };

function inlineHtml(content) {
  let html = '';
  for (const item of content ?? []) {
    let piece = item.type === 'text' ? escapeHtml(item.text ?? '') : item.type === 'inline-image' ? '[&#9635;]' : '';
    for (const mark of [...(item.marks ?? [])].reverse()) {
      if (TAGS[mark.type]) piece = `<${TAGS[mark.type]}>${piece}</${TAGS[mark.type]}>`;
      else if (mark.type === 'link') piece = `<u>${piece}</u>`;
    }
    html += piece;
  }
  return html;
}

function blockHtml(node) {
  switch (node.type) {
    case 'p':
    case 'v':
      return `<p>${inlineHtml(node.content)}</p>`;
    case 'subtitle':
      return `<p class="subtitle">${inlineHtml(node.content)}</p>`;
    case 'text-author':
    case 'date':
      return `<p class="author">${inlineHtml(node.content)}</p>`;
    case 'empty-line':
      return '<p>&nbsp;</p>';
    case 'td':
    case 'th':
      return `<${node.type}>${inlineHtml(node.content)}</${node.type}>`;
    case 'tr':
      return `<tr>${(node.content ?? []).map(blockHtml).join('')}</tr>`;
    case 'table':
      return `<table>${(node.content ?? []).map(blockHtml).join('')}</table>`;
    case 'title':
      return `<div class="title">${(node.content ?? []).map(blockHtml).join('')}</div>`;
    default:
      return `<div class="${escapeHtml(node.type)}">${(node.content ?? []).map(blockHtml).join('')}</div>`;
  }
}

/** showNotesTexts: the note texts in a report window, numbered. */
async function preview(ctx, texts, heading, windowTitle) {
  let html =
    '<style>body{font-family:Tahoma,sans-serif}div.title{text-align:center;font-weight:bold}' +
    'p.subtitle{text-align:center;font-weight:bold}p.author{text-align:right;font-style:italic}' +
    'div.poem,div.cite,div.epigraph{margin-left:2em}table{border-collapse:collapse}' +
    'td,th{border:1px solid #888;padding:2px 4px}div.section{margin-top:1em}</style>';
  html += `<div class="title"><p>${escapeHtml(heading)}</p><p>${escapeHtml(t(ctx, 'Количество: ', 'Count: '))}${texts.notes.length}</p></div>`;
  texts.notes.forEach((nodes, i) => {
    html += `<div class="section"><div class="title"><p>${i + 1}</p></div>${nodes.map(blockHtml).join('')}</div>`;
  });
  await mfbe.ui.report({ title: windowTitle, html });
}

/* ------------------------------------------------------------------------------------------ */
/* The run                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function words(ctx, target, mode) {
  const notes = target.bodyName !== 'comments';
  return {
    found: { nom: 'Найден', gen: 'Найдены', plu: 'Найдено' },
    texts: notes
      ? { nom: 'текст сноски', gen: 'текста сносок', plu: 'текстов сносок' }
      : { nom: 'текст комментария', gen: 'текста комментариев', plu: 'текстов комментариев' },
    signs:
      mode === 'markers' && !notes
        ? { nom: 'маркер знака комментария', gen: 'маркера знака комментария', plu: 'маркеров знаков комментария' }
        : { nom: 'маркер знака сноски', gen: 'маркера знака сноски', plu: 'маркеров знаков сноски' },
    // 12 wrote "маркера знаков сноски" in its confirmation
    signsConfirm:
      mode === 'selection'
        ? { nom: 'маркер знака сноски', gen: 'маркера знаков сноски', plu: 'маркеров знаков сноски' }
        : null,
    name1: notes ? 'сносок' : 'комментариев',
    name2: notes ? 'сноски' : 'комментарии',
    en: notes
      ? { sign: 'footnote sign marker', text: 'footnote text', items: 'footnotes' }
      : { sign: mode === 'markers' ? 'comment sign marker' : 'footnote sign marker', text: 'comment text', items: 'comments' },
  };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function counts(ctx, w, signs, notes, confirm) {
  const signWords = confirm && w.signsConfirm ? w.signsConfirm : w.signs;
  return t(
    ctx,
    `${units(signs, w.found)} ${signs} ${units(signs, signWords)}.\n\n${units(notes, w.found)} ${notes} ${units(notes, w.texts)}.\n\n`,
    `Found ${plural(signs, w.en.sign)}.\n\nFound ${plural(notes, w.en.text)}.\n\n`,
  );
}

const OK_CANCEL = { buttons: [{ id: 'ok', label: '', default: true }, { id: 'cancel', label: '', cancel: true }], icon: 'question' };

/**
 * Runs one of the scripts. `script`: `{ mode: 'selection' | 'markers', defaults, form(ctx,
 * values), resolve(ctx, values) -> options | null, previewHeading(ctx), previewTitle(ctx) }`;
 * `options`: `{ mode, sign, first, notFromStart, continuation, asteriskContainers }`.
 */
export async function runParagraphNotes(ctx, script) {
  let values = { ...script.defaults };
  for (;;) {
    const answer = await mfbe.ui.form(script.form(ctx, values));
    if (!answer) return;
    values = { ...values, ...answer };
    const options = await script.resolve(ctx, values);
    if (!options) continue;
    const outcome = await act(ctx, script, options, values.action);
    if (outcome === 'done') return;
  }
}

async function act(ctx, script, options, action) {
  const book = await loadBook();
  let texts;
  let limit = null;
  let selection = null;
  if (options.mode === 'selection') {
    selection = await mfbe.selection.get();
    const collapsed = !selection || (selection.anchor.nodeId === selection.head.nodeId && selection.anchor.offset === selection.head.offset);
    if (collapsed || selection.nodes.length === 0) {
      await mfbe.ui.message(
        t(ctx, 'Пожалуйста вначале выделите абзацы, из которых будут извлечены тексты сносок.', 'Please select the paragraphs to take the footnote texts from first.'),
        { icon: 'warning' },
      );
      return 'done';
    }
    texts = selectedNotes(book, selection, options);
    if (!texts) {
      await mfbe.ui.message(
        t(ctx, 'Ошибка. Должно быть выделение в тексте книги, а не в поле ввода.', 'Error: the selection must be in the text of the book, not in an input field.'),
        { icon: 'error' },
      );
      return 'done';
    }
    const blocks = pageBlocks(book);
    const ids = blocks.map((b) => b.node.attrs?.nodeId);
    const a = ids.indexOf(selection.anchor.nodeId);
    const h = ids.indexOf(selection.head.nodeId);
    const startId = a < h || (a === h && selection.anchor.offset <= selection.head.offset) ? selection.anchor.nodeId : selection.head.nodeId;
    limit = startId;
  } else {
    texts = markedNotes(book, options);
  }

  if (action === 'preview') {
    if (texts.notes.length === 0) {
      if (options.mode === 'markers') {
        await mfbe.ui.message(
          t(ctx, 'В документе не нашлось ни одного абзаца-исходника текста сноски.', 'The document holds no paragraph to take a footnote text from.'),
          { icon: 'info' },
        );
      }
      return 'stay';
    }
    await preview(ctx, texts, script.previewHeading(ctx), script.previewTitle(ctx));
    return 'stay';
  }

  const target = TARGETS[action === 'comments' ? 'comments' : 'notes'];
  const w = words(ctx, target, options.mode);
  if (texts.notes.length === 0) {
    if (options.mode === 'markers') {
      await mfbe.ui.message(
        target.bodyName !== 'comments'
          ? t(ctx, 'В документе не нашлось ни одного абзаца-исходника текста сноски.', 'The document holds no paragraph to take a footnote text from.')
          : t(ctx, 'В документе не нашлось ни одного абзаца-исходника текста комментария.', 'The document holds no paragraph to take a comment text from.'),
        { icon: 'info' },
      );
    }
    return 'stay';
  }
  const signs = countSigns(book, options, limit);
  const notes = texts.notes.length;
  if (signs !== notes) {
    await mfbe.ui.message(
      counts(ctx, w, signs, notes, false) +
        t(ctx, `Поскольку эти числа не совпадают, добавление ${w.name1} не будет произведено.`, `As these numbers differ, no ${w.en.items} will be added.`),
      { icon: 'warning' },
    );
    return 'stay';
  }
  const answer = await mfbe.ui.message(
    counts(ctx, w, signs, notes, true) +
      t(ctx, `Ура! Эти числа совпали. А значит, ${w.name2} можно создать.\n\nСоздать ${w.name2}?`, `Hooray! The numbers match, so the ${w.en.items} can be created.\n\nCreate the ${w.en.items}?`),
    OK_CANCEL,
  );
  if (answer !== 'ok') return 'stay';

  const result = createNotes(book, options, target, texts, limit);
  if (result.error) {
    await mfbe.ui.message(
      options.mode === 'markers'
        ? t(ctx, 'Ошибка! Ссылка в документе указывает на элемент, которого не существует.', 'Error! A link of the document points to an element that does not exist.')
        : t(ctx, 'Ошибка!', 'Error!'),
      { icon: 'error' },
    );
    return 'stay';
  }
  await commit(book);
  await mfbe.ui.status(
    t(ctx, `${units(notes, { nom: 'Был добавлен', gen: 'Были добавлены', plu: 'Было добавлено' })} ${notes} ${units(notes, w.texts)}.`, `Added ${plural(notes, w.en.text)}.`),
    { sticky: true },
  );
  if (options.mode === 'markers') {
    const remove = await mfbe.ui.message(
      target.bodyName !== 'comments'
        ? t(ctx, 'Удалить ли абзацы-исходники текстов сносок?', 'Remove the paragraphs the footnote texts came from?')
        : t(ctx, 'Удалить ли абзацы-исходники текстов комментариев?', 'Remove the paragraphs the comment texts came from?'),
      OK_CANCEL,
    );
    if (remove === 'ok') {
      removeSources(book, texts.sources);
      await commit(book);
    }
  } else if (selection) {
    await restoreSelection(book, selection);
  }
  return 'done';
}

/** 12 left the selection where it was. */
async function restoreSelection(book, selection) {
  const lengthOf = new Map(pageBlocks(book).map((b) => [b.node.attrs?.nodeId, (b.node.content ?? []).reduce((n, i) => n + itemLength(i), 0)]));
  const clamp = (p) => ({ nodeId: p.nodeId, offset: Math.min(p.offset, lengthOf.get(p.nodeId) ?? p.offset) });
  try {
    await mfbe.selection.set(clamp(selection.anchor), clamp(selection.head));
  } catch {
    // the selection could not be put back; the notes are made all the same
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Dialog helpers shared by the packages                                                      */
/* ------------------------------------------------------------------------------------------ */

/** The marker kinds of the dialogs' radio buttons (the "свой" one is the caller's). */
export const SIGN_PRESETS = {
  '1': /\[\d+\]/g,
  '2': /\{\d+\}/g,
  '3': /\[~\d+~\]/g,
  '4': /\{~\d+~\}/g,
};

/** Compiles a pattern of the dialog; `{ re }` or `{ error }` with the engine's message. */
export function compile(source, flags) {
  try {
    return { re: new RegExp(source, flags) };
  } catch (error) {
    return { error };
  }
}

/** The action field: the dialog's buttons. */
export function actionField(ctx, previewLabel, value) {
  return {
    kind: 'radio',
    id: 'action',
    label: t(ctx, 'Действие:', 'Action:'),
    options: [
      { value: 'notes', label: t(ctx, 'Создать сноски', 'Create footnotes') },
      { value: 'comments', label: t(ctx, 'Создать комментарии', 'Create comments') },
      { value: 'preview', label: previewLabel },
    ],
    value: value ?? 'notes',
  };
}

export function continuationField(ctx, value) {
  return {
    kind: 'text',
    id: 'notFirstParagraphStr',
    label: t(
      ctx,
      'Маркер 2-го, 3-го и т.д. абзацев текста сноски (не регэксп, а простой текст):',
      'Marker of the 2nd, 3rd etc. paragraph of a footnote text (plain text, not a regular expression):',
    ),
    value: value ?? '++',
  };
}
