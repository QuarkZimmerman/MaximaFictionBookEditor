// The page of FictionBook Editor 2.7.9 that "Обзор и превращение элементов" edited, and the
// original's procedures that restructure it (HTML/Обзор и превращение элементов - фрейм 2.html:
// reformatTitlesToSubtitlesOrText, moveHtmlCodeIntoTargetContainer, moveBlockIntoPreviousBlock,
// moving1, createTargetContainer, reformatSubtitlesToTitles), ported statement by statement.
//
// The original walked FictionBook Editor's page: every container a DIV named by its element
// (section, title, epigraph, annotation, cite, poem, stanza, table, tr; a picture DIV.image),
// every text block a P (P.subtitle, P.text-author for a text author and a poem's date, P.td /
// P.th; an empty line an empty P), no text between them. A body of the book is read into such a
// tree of Boxes, the procedure moves Boxes as the original moved DOM nodes, and the body is
// written back the way 2.7.9 saved its page (FBDoc.cpp ProcessDiv / ProcessP after
// CFBEView::Normalize): a classless P is a paragraph, a verse in a stanza; a container left empty
// is dropped; an empty P the procedure created is an empty line. The editor checks the written
// body against the schema before anything changes (mfbe.doc.replaceNode).
//
// Three defects of 2.7.9 are fixed here (FR-023; marked FIX 1-3 below and listed in the
// conversion notes): lines moved to a previous section ending with empty lines were dropped, empty
// lines were added around an insertion of nothing, and a merge of a section holding nothing but
// subtitles stopped with a script error.

const WITH_EMPTY_LINES = 'subtitles with empty lines before and after';
const CLASS_OF = { p: '', v: '', 'empty-line': '', subtitle: 'subtitle', 'text-author': 'text-author', date: 'text-author', td: 'td', th: 'th' };

export class Box {
  constructor(tag, kind) {
    this.tag = tag; // 'DIV', 'P' or 'SPAN' (the original's markers)
    this.kind = kind; // a DIV's class: 'body', 'section', 'title', …, 'image'
    this.cls = ''; // a P's class: '', 'subtitle', 'text-author', 'td', 'th'
    this.orig = null; // a P's element as read (null: created by the procedure)
    this.attrs = {};
    this.inline = [];
    this.kids = [];
    this.parent = null;
    this.keepId = true;
    this.json = null; // a picture as read
    this.wasEmpty = false; // a container that was empty in the book already
  }

  get firstChild() {
    return this.kids[0] ?? null;
  }

  get lastChild() {
    return this.kids[this.kids.length - 1] ?? null;
  }

  get nextSibling() {
    if (!this.parent) return null;
    const kids = this.parent.kids;
    return kids[kids.indexOf(this) + 1] ?? null;
  }

  get previousSibling() {
    if (!this.parent) return null;
    const kids = this.parent.kids;
    const index = kids.indexOf(this);
    return index > 0 ? kids[index - 1] : null;
  }

  /** removeNode(true): out of the tree, with its content. */
  remove() {
    if (this.parent) {
      const kids = this.parent.kids;
      kids.splice(kids.indexOf(this), 1);
      this.parent = null;
    }
    return this;
  }

  /** removeNode(false): its children take its place. */
  unwrap() {
    const parent = this.parent;
    if (!parent) return this;
    for (const kid of this.kids) kid.parent = parent;
    parent.kids.splice(parent.kids.indexOf(this), 1, ...this.kids);
    this.kids = [];
    this.parent = null;
    return this;
  }

  insertBefore(node, ref) {
    node.remove();
    node.parent = this;
    const index = ref ? this.kids.indexOf(ref) : -1;
    if (index < 0) this.kids.push(node);
    else this.kids.splice(index, 0, node);
    return node;
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  /** insertAdjacentElement */
  insertAdjacent(where, node) {
    if (where === 'beforeBegin') return this.parent.insertBefore(node, this);
    if (where === 'afterBegin') return this.insertBefore(node, this.firstChild);
    if (where === 'beforeEnd') return this.appendChild(node);
    return this.parent.insertBefore(node, this.nextSibling); // 'afterEnd'
  }

  /** The P descendants in document order (getElementsByTagName("P")). */
  paragraphs(out = []) {
    for (const kid of this.kids) {
      if (kid.tag === 'P') out.push(kid);
      else kid.paragraphs(out);
    }
    return out;
  }
}

const div = (kind) => new Box('DIV', kind);

/** mainDoc.createElement("P") made visible with InflateIt: an empty line. */
function emptyLine() {
  return new Box('P', '');
}

/* ---------------------------------------------------------------------------------------- */
/* Reading and writing                                                                       */
/* ---------------------------------------------------------------------------------------- */

/** A body (or any node) of the document model as a Box tree; `byId` maps node ids to boxes. */
export function toBox(node, byId) {
  let box;
  if (Object.hasOwn(CLASS_OF, node.type)) {
    box = new Box('P', '');
    box.cls = CLASS_OF[node.type];
    box.orig = node.type;
    box.inline = node.content ?? [];
  } else if (node.type === 'image') {
    box = div('image');
    box.json = node;
  } else {
    box = div(node.type);
    for (const child of node.content ?? []) {
      if (child && child.type !== 'text') box.appendChild(toBox(child, byId));
    }
    box.wasEmpty = box.kids.length === 0;
  }
  box.attrs = { ...(node.attrs ?? {}) };
  if (byId && box.attrs.nodeId) byId.set(box.attrs.nodeId, box);
  return box;
}

/** Text only of spaces and non-breaking spaces, nothing else (no picture). */
function blankInline(inline) {
  return (inline ?? []).every((item) => item.type === 'text' && /^[ \u00A0]*$/.test(item.text ?? ''));
}

function withoutIds(node) {
  if (!node || node.type === 'text') return node;
  const { nodeId, ...attrs } = node.attrs ?? {};
  const copy = { ...node, attrs };
  if (node.content) copy.content = node.content.map(withoutIds);
  return copy;
}

/** The Box tree back as a node of the document model, as 2.7.9 saved its page; null for an empty container. */
export function toJson(box) {
  if (box.tag === 'SPAN') return null;
  const attrs = { ...box.attrs };
  if (!box.keepId) delete attrs.nodeId;
  if (box.tag === 'P') {
    const inStanza = box.parent?.tag === 'DIV' && box.parent.kind === 'stanza';
    let type;
    if (box.cls === 'subtitle') type = box.orig === 'empty-line' ? 'empty-line' : 'subtitle';
    else if (box.cls === 'text-author') type = box.orig === 'date' ? 'date' : 'text-author';
    else if (box.cls === 'td' || box.cls === 'th') type = box.orig;
    else if (box.orig === 'empty-line' || (box.orig === null && blankInline(box.inline))) type = 'empty-line';
    else type = inStanza ? 'v' : 'p';
    if (type === 'empty-line') {
      // ProcessP: an empty P in a stanza is a verse of one space
      if (inStanza) return { type: 'v', attrs, content: [{ type: 'text', text: ' ' }] };
      const { nodeId } = attrs;
      return nodeId ? { type, attrs: { nodeId } } : { type, attrs: {} };
    }
    return { type, attrs, content: box.inline };
  }
  if (box.kind === 'image') return box.keepId ? box.json : withoutIds(box.json);
  const content = box.kids.map(toJson).filter(Boolean);
  // RemoveEmptyNodes: a container the procedure left empty is dropped (one that was empty in
  // the book stays: that was 2.7.9's saving, not the script)
  if (!content.length && !box.wasEmpty) return null;
  return { type: box.kind, attrs, content };
}

/* ---------------------------------------------------------------------------------------- */
/* The original's tests                                                                       */
/* ---------------------------------------------------------------------------------------- */

/** isEmptyLine: a P whose HTML, without the NBSP and without tags other than IMG, is only spaces. */
function isEmptyLine(ptr) {
  if (!ptr || ptr.tag !== 'P') return false;
  return (ptr.inline ?? []).every(
    (item) => item.type !== 'inline-image' && (item.type !== 'text' || /^[ \u00A0]*$/.test(item.text ?? '')),
  );
}

const isSubtitle = (ptr) => Boolean(ptr) && ptr.tag === 'P' && ptr.cls === 'subtitle';
const isDiv = (ptr, kind) => Boolean(ptr) && ptr.tag === 'DIV' && ptr.kind === kind;
const isSection = (ptr) => isDiv(ptr, 'section');
const isTitle = (ptr) => isDiv(ptr, 'title');
const isEpigraph = (ptr) => isDiv(ptr, 'epigraph');
const isAnnotation = (ptr) => isDiv(ptr, 'annotation');
const isStanza = (ptr) => isDiv(ptr, 'stanza');
const isPoem = (ptr) => isDiv(ptr, 'poem');

function getSectionOrPoemOrStanzaByElement(el) {
  let ptr4 = el;
  while (ptr4 && !(ptr4.tag === 'DIV' && (ptr4.kind === 'section' || ptr4.kind === 'stanza' || ptr4.kind === 'poem'))) ptr4 = ptr4.parent;
  return ptr4 ?? null;
}

function getTitleByElement(el) {
  let ptr5 = el;
  while (ptr5 && !isTitle(ptr5)) ptr5 = ptr5.parent;
  return ptr5 ?? null;
}

function prevNotSection(ff) {
  if (ff.kind === 'body') return false;
  return ff.previousSibling === null || !isSection(ff);
}

function getDeepestSection(sect) {
  if (!isSection(sect)) return null;
  let sect1 = sect;
  while (isSection(sect1.firstChild)) sect1 = sect1.firstChild;
  return sect1;
}

function getParentSection(el) {
  let el1 = el;
  while (el1 && !isSection(el1)) el1 = el1.parent;
  return el1 ?? null;
}

function countEmptyLinesInTheEnd(lastElem) {
  let ptr = lastElem;
  let cnt = 0;
  while (isEmptyLine(ptr)) {
    cnt += 1;
    ptr = ptr.previousSibling;
  }
  return cnt;
}

function removeEmptyLinesUpward(elem) {
  while (isEmptyLine(elem)) {
    const saveElem = elem.previousSibling;
    elem.remove();
    elem = saveElem;
  }
}

/** removeEpigraphAuthors: the text authors of an epigraph become paragraphs. */
function removeEpigraphAuthors(tt) {
  for (const p of tt.paragraphs()) if (p.cls === 'text-author' && isEpigraph(p.parent)) p.cls = '';
}

/* ---------------------------------------------------------------------------------------- */
/* Titles as subtitles, subtitles framed by empty lines or text                              */
/* ---------------------------------------------------------------------------------------- */

/**
 * reformatTitlesToSubtitlesOrText: `lines` are the selected title lines (P boxes of section
 * titles) in document order; `target` is 'subtitle', 'subtitles with empty lines before and
 * after' or 'p'.
 */
export function reformatTitles(lines, target) {
  let sectionOrPoemOrStanza = null;
  let prevSectionOrPoemOrStanza = null;
  let tt = null;
  let nextTt = null;
  let ttt = null;
  let pInPreviousContainer = null;
  let saveNextSiblingAfterSubtitle = null;
  let weMovedSubtitles = false;
  let thereAreSubtitlesInPreviousContainer = false;
  let lastMovingWasNotSubtitleMoving = false;
  let previousSection = null;
  let markerBegin = null;
  let markerEnd = null;
  let alreadyAddedEmptyLine = false;
  let sectionToRemove = null;
  let parentTitle = null;
  let htmlStr = [];

  function moving1(moveIfThereAreNotEmptyLines) {
    // moves the subtitles at the start of the source container in front of the empty lines at
    // the end of prevSectionOrPoemOrStanza
    if (prevSectionOrPoemOrStanza && prevSectionOrPoemOrStanza.lastChild) pInPreviousContainer = prevSectionOrPoemOrStanza.lastChild;
    else pInPreviousContainer = sectionOrPoemOrStanza.previousSibling;
    if (isEmptyLine(pInPreviousContainer)) {
      while (isEmptyLine(pInPreviousContainer)) pInPreviousContainer = pInPreviousContainer.previousSibling;
      if (isSubtitle(pInPreviousContainer)) {
        thereAreSubtitlesInPreviousContainer = true;
        while (isEmptyLine(tt)) {
          nextTt = tt.nextSibling;
          tt.remove();
          tt = nextTt;
        }
        saveNextSiblingAfterSubtitle = pInPreviousContainer.nextSibling;
        if (tt && isSubtitle(tt) && saveNextSiblingAfterSubtitle) {
          while (tt && isSubtitle(tt) && saveNextSiblingAfterSubtitle) {
            nextTt = tt.nextSibling;
            saveNextSiblingAfterSubtitle.insertAdjacent('beforeBegin', tt.remove());
            tt = nextTt;
          }
          weMovedSubtitles = true;
        } else return;
        const numberOfLinesToRemove = prevSectionOrPoemOrStanza
          ? countEmptyLinesInTheEnd(prevSectionOrPoemOrStanza.lastChild)
          : countEmptyLinesInTheEnd(sectionOrPoemOrStanza.previousSibling);
        for (let i = 1; i <= numberOfLinesToRemove; i += 1) {
          // FIX 3: 2.7.9 read tt.nextSibling here also when the source container had nothing
          // left (only subtitles, all moved) and stopped with a script error.
          if (!tt) break;
          nextTt = tt.nextSibling;
          if (isEmptyLine(tt)) tt.remove();
          else break;
          tt = nextTt;
        }
      }
    } else if (moveIfThereAreNotEmptyLines) {
      while (tt && isSubtitle(tt)) {
        nextTt = tt.nextSibling;
        prevSectionOrPoemOrStanza.appendChild(tt.remove());
        weMovedSubtitles = true;
        tt = nextTt;
      }
    }
  }

  function createTargetContainer() {
    if (isSection(sectionOrPoemOrStanza)) {
      // the title lines belong to a section's title
      let el9 = sectionOrPoemOrStanza;
      while (prevNotSection(el9) && el9.parent.kind !== 'body') el9 = el9.parent;
      if (isSection(el9.previousSibling)) prevSectionOrPoemOrStanza = el9.previousSibling;
      else if (el9 !== sectionOrPoemOrStanza) prevSectionOrPoemOrStanza = el9.insertAdjacent('afterBegin', div('section'));
      else prevSectionOrPoemOrStanza = sectionOrPoemOrStanza.insertAdjacent('beforeBegin', div('section'));
    } else if (isStanza(sectionOrPoemOrStanza)) {
      if (isStanza(sectionOrPoemOrStanza.previousSibling)) prevSectionOrPoemOrStanza = sectionOrPoemOrStanza.previousSibling;
      else prevSectionOrPoemOrStanza = sectionOrPoemOrStanza.insertAdjacent('beforeBegin', div('stanza'));
    } else if (isPoem(sectionOrPoemOrStanza)) {
      if (isPoem(sectionOrPoemOrStanza.previousSibling)) prevSectionOrPoemOrStanza = sectionOrPoemOrStanza.previousSibling;
      else prevSectionOrPoemOrStanza = sectionOrPoemOrStanza.insertAdjacent('beforeBegin', div('poem'));
    }
    if (!prevSectionOrPoemOrStanza || prevSectionOrPoemOrStanza.tag !== 'DIV' || prevSectionOrPoemOrStanza.kind !== sectionOrPoemOrStanza.kind) return;
    if (isSection(sectionOrPoemOrStanza)) {
      while (isSection(prevSectionOrPoemOrStanza.lastChild)) prevSectionOrPoemOrStanza = prevSectionOrPoemOrStanza.lastChild;
    }
  }

  function moveBlockIntoPreviousBlock() {
    weMovedSubtitles = false;
    thereAreSubtitlesInPreviousContainer = false;
    tt = sectionOrPoemOrStanza.firstChild;
    lastMovingWasNotSubtitleMoving = false;
    createTargetContainer();
    while (tt) {
      pInPreviousContainer = prevSectionOrPoemOrStanza.lastChild;
      moving1(true);
      if (target === WITH_EMPTY_LINES) {
        if (prevSectionOrPoemOrStanza && prevSectionOrPoemOrStanza.lastChild) pInPreviousContainer = prevSectionOrPoemOrStanza.lastChild;
        else pInPreviousContainer = sectionOrPoemOrStanza.previousSibling;
        while (isEmptyLine(pInPreviousContainer)) pInPreviousContainer = pInPreviousContainer.previousSibling;
        if (isSubtitle(pInPreviousContainer)) {
          while (isSubtitle(pInPreviousContainer.previousSibling)) pInPreviousContainer = pInPreviousContainer.previousSibling;
          if (!isEmptyLine(pInPreviousContainer.previousSibling)) pInPreviousContainer.insertAdjacent('beforeBegin', emptyLine());
        }
      }
      // empty lines and then a subtitle at the start of the source container: those empty
      // lines go, and so do the empty lines at the end of prevSectionOrPoemOrStanza
      if (weMovedSubtitles && isEmptyLine(tt)) {
        ttt = tt;
        while (isEmptyLine(ttt)) ttt = ttt.nextSibling;
        if (isSubtitle(ttt)) {
          ttt = tt;
          while (isEmptyLine(ttt)) {
            ttt = ttt.nextSibling;
            ttt.previousSibling.remove();
          }
          while (isEmptyLine(prevSectionOrPoemOrStanza.lastChild)) prevSectionOrPoemOrStanza.lastChild.remove();
          tt = ttt;
        }
      }
      if (tt) moving1(true);
      ttt = tt;
      if (!lastMovingWasNotSubtitleMoving && isEmptyLine(ttt)) {
        while (isEmptyLine(ttt)) ttt = ttt.nextSibling;
        if (isSubtitle(ttt)) {
          while (isEmptyLine(tt)) {
            nextTt = tt.nextSibling;
            tt.remove();
            tt = nextTt;
          }
        }
      }
      if (isSubtitle(tt)) {
        while (isSubtitle(tt)) {
          nextTt = tt.nextSibling;
          const tt3 = prevSectionOrPoemOrStanza.insertAdjacent('beforeEnd', tt.remove());
          // 2.7.9: `if (!tt3.previousSibling && "subtitles with empty lines before and after")` -
          // the second operand is a string, always true; kept as written
          if (!tt3.previousSibling) tt3.insertAdjacent('beforeBegin', emptyLine());
          weMovedSubtitles = true;
          lastMovingWasNotSubtitleMoving = false;
          tt = nextTt;
        }
      }
      // empty lines after the subtitles moved to the end of prevSectionOrPoemOrStanza
      if (
        target === WITH_EMPTY_LINES &&
        weMovedSubtitles &&
        !thereAreSubtitlesInPreviousContainer &&
        !isEmptyLine(prevSectionOrPoemOrStanza.lastChild) &&
        !(isSection(getSectionOrPoemOrStanzaByElement(tt)) && isEmptyLine(getDeepestSection(getParentSection(tt)).firstChild)) &&
        !(isStanza(getSectionOrPoemOrStanzaByElement(tt)) && isEmptyLine(tt))
      ) {
        prevSectionOrPoemOrStanza.appendChild(emptyLine());
      }
      if (target === 'subtitle') removeEmptyLinesUpward(prevSectionOrPoemOrStanza.lastChild);
      // the rest of the source container (after the subtitles) into prevSectionOrPoemOrStanza;
      // epigraphs and annotations become plain text
      while (tt && !isSection(tt)) {
        nextTt = tt.nextSibling;
        if (prevSectionOrPoemOrStanza) tt = prevSectionOrPoemOrStanza.insertAdjacent('beforeEnd', tt.remove());
        else tt = sectionOrPoemOrStanza.insertAdjacent('beforeBegin', tt.remove());
        if (isEpigraph(tt)) removeEpigraphAuthors(tt);
        if (isEpigraph(tt) || isAnnotation(tt)) tt.unwrap();
        weMovedSubtitles = false;
        tt = nextTt;
        lastMovingWasNotSubtitleMoving = true;
      }
      if (!tt) {
        // the source container goes, and so do the sections it leaves empty
        tt = sectionOrPoemOrStanza.parent;
        sectionOrPoemOrStanza.remove();
        while (isSection(tt) && !tt.firstChild) {
          nextTt = tt.parent;
          tt.remove();
          tt = nextTt;
        }
        tt = null;
      } else if (isSection(sectionOrPoemOrStanza)) {
        // subsections follow: the source section is dissolved and its first deepest subsection
        // goes on, unless it has a title
        nextTt = sectionOrPoemOrStanza;
        while (isSection(nextTt.firstChild)) nextTt = nextTt.firstChild;
        const oldSectionOrPoemOrStanza = sectionOrPoemOrStanza;
        sectionOrPoemOrStanza = nextTt;
        nextTt = nextTt.firstChild;
        oldSectionOrPoemOrStanza.unwrap();
        tt = nextTt;
        if (tt && isTitle(tt)) tt = null;
      } else tt = null;
    }
  }

  function collectHtmlCodeForMoving(p) {
    const el3 = getSectionOrPoemOrStanzaByElement(parentTitle);
    previousSection = el3.previousSibling;
    // a copy of the line (the original's cloneNode + outerHTML: a new element, same id)
    const myEl = new Box('P', '');
    myEl.orig = p.orig;
    myEl.attrs = { ...p.attrs };
    myEl.keepId = false;
    myEl.inline = p.inline;
    if (target === 'subtitle' || target === WITH_EMPTY_LINES) myEl.cls = 'subtitle';
    htmlStr.push(myEl);
    p.remove();
  }

  function reformatTextAuthorsToParagraphs(epigraph1) {
    for (const child of epigraph1.kids) if (child.tag === 'P' && child.cls === 'text-author') child.cls = '';
  }

  function insertCode(parent, before) {
    markerBegin = new Box('SPAN', 'marker');
    markerEnd = new Box('SPAN', 'marker');
    parent.insertBefore(markerBegin, before);
    for (const node of htmlStr) parent.insertBefore(node, before);
    parent.insertBefore(markerEnd, before);
  }

  function moveHtmlCodeIntoTargetContainer(flag1) {
    // FIX 2: nothing was collected (the last, unselected lines of a title while the selection
    // goes on in a later title): 2.7.9 still framed the empty insertion with two empty lines.
    if (htmlStr.length === 0) return;
    const el3 = getSectionOrPoemOrStanzaByElement(parentTitle);
    markerBegin = null;
    markerEnd = null;
    if (flag1) {
      // the whole title: the lines go in front of it
      if (target === WITH_EMPTY_LINES && (!el3.previousSibling || el3.previousSibling.kind !== el3.kind)) {
        if (!parentTitle.previousSibling || !isEmptyLine(parentTitle.previousSibling)) parentTitle.parent.insertBefore(emptyLine(), parentTitle);
        if (!parentTitle.nextSibling || !isEmptyLine(parentTitle.nextSibling)) parentTitle.parent.insertBefore(emptyLine(), parentTitle.nextSibling);
      }
      insertCode(parentTitle.parent, parentTitle);
      let el5 = parentTitle.nextSibling;
      while (isEpigraph(el5)) {
        const saveEl5 = el5;
        el5 = el5.nextSibling;
        reformatTextAuthorsToParagraphs(saveEl5);
        saveEl5.unwrap();
      }
      sectionOrPoemOrStanza = el3;
    } else {
      // the lines go into the previous container
      if (isSection(el3)) {
        if (!isSection(el3.previousSibling)) {
          previousSection = el3.insertAdjacent('beforeBegin', div(el3.kind));
          if (el3.previousSibling && el3.parent && isSection(el3.parent) && !isSection(el3.parent.lastChild)) sectionToRemove = previousSection;
        } else {
          while (isSection(previousSection.lastChild)) previousSection = previousSection.lastChild;
        }
      } else if (isStanza(el3)) {
        if (!isStanza(el3.previousSibling)) previousSection = el3.insertAdjacent('beforeBegin', div('stanza'));
        else previousSection = el3.previousSibling;
      }
      let pInPreviousSection = previousSection.lastChild;
      if (isEmptyLine(pInPreviousSection)) {
        if (target === 'subtitle') removeEmptyLinesUpward(pInPreviousSection);
        pInPreviousSection = previousSection.lastChild;
        while (isEmptyLine(pInPreviousSection)) pInPreviousSection = pInPreviousSection.previousSibling;
        if (isSubtitle(pInPreviousSection)) {
          // after the subtitle in front of the empty lines at the end of the previous section
          insertCode(pInPreviousSection.parent, pInPreviousSection.nextSibling);
        } else {
          // FIX 1: 2.7.9 had `else if (isSubtitle(pInPreviousSection))` here - the condition of
          // the `if` again - so the lines, already taken out of the title, were inserted nowhere
          // and the script stopped with an error. This is that branch's body: at the end.
          insertCode(previousSection, null);
          if (target === WITH_EMPTY_LINES) previousSection.appendChild(emptyLine());
        }
      } else {
        // the last child of the previous section is not an empty line
        insertCode(previousSection, null);
        if (target === WITH_EMPTY_LINES) {
          let el2 = markerBegin;
          if (markerBegin.previousSibling) {
            el2 = markerBegin.previousSibling;
            if (isSubtitle(el2)) {
              while (isSubtitle(el2.previousSibling)) el2 = el2.previousSibling;
              if (!isEmptyLine(el2.previousSibling)) {
                el2.insertAdjacent('beforeBegin', emptyLine());
                alreadyAddedEmptyLine = true;
              }
            }
            el2 = markerBegin;
          } else {
            // nothing in front of the start marker: an empty line there
            markerBegin.parent.insertBefore(emptyLine(), markerBegin);
            alreadyAddedEmptyLine = true;
          }
          // (2.7.9 then tested isEmptyLine(el2) - el2 is the marker here, never an empty line)
          if (!alreadyAddedEmptyLine && el2) markerBegin.parent.insertBefore(emptyLine(), markerBegin);
          // empty lines after the subtitles, if needed
          if (!isEmptyLine(markerEnd.nextSibling)) markerEnd.parent.insertBefore(emptyLine(), markerEnd.nextSibling);
        }
      }
    }
    alreadyAddedEmptyLine = false;
    markerBegin?.remove();
    markerEnd?.remove();
  }

  /** getNext: the next P of the title after `ggg`, or the title itself after the last. */
  function getNext(ggg) {
    let saveNext = ggg;
    if (saveNext.firstChild && saveNext.tag !== 'P') saveNext = saveNext.firstChild;
    else {
      while (saveNext !== parentTitle && saveNext.nextSibling === null) saveNext = saveNext.parent;
      if (saveNext !== parentTitle) saveNext = saveNext.nextSibling;
    }
    while (saveNext !== parentTitle && saveNext.tag !== 'P') {
      if (saveNext.firstChild && saveNext.tag !== 'P') saveNext = saveNext.firstChild;
      else {
        while (saveNext !== parentTitle && saveNext.nextSibling === null) saveNext = saveNext.parent;
        if (saveNext !== parentTitle) saveNext = saveNext.nextSibling;
      }
    }
    return saveNext;
  }

  const sorted = lines;
  let nPtr = 0;
  while (nPtr < sorted.length) {
    const firstElFromCurrentBlock = sorted[nPtr];
    parentTitle = getTitleByElement(firstElFromCurrentBlock);
    let elemInMainDoc = parentTitle.firstChild;
    while (elemInMainDoc !== parentTitle && elemInMainDoc.tag !== 'P') {
      if (elemInMainDoc.firstChild) elemInMainDoc = elemInMainDoc.firstChild;
      else {
        while (elemInMainDoc !== parentTitle && elemInMainDoc.nextSibling === null) elemInMainDoc = elemInMainDoc.parent;
        if (elemInMainDoc !== parentTitle) elemInMainDoc = elemInMainDoc.nextSibling;
      }
    }
    if (elemInMainDoc === firstElFromCurrentBlock) {
      // FIRST PROCESSING: the selected lines at the start of the title
      htmlStr = [];
      while (elemInMainDoc && nPtr < sorted.length && elemInMainDoc === sorted[nPtr]) {
        if (elemInMainDoc !== parentTitle) {
          const saveNext = getNext(elemInMainDoc);
          collectHtmlCodeForMoving(elemInMainDoc);
          nPtr += 1;
          elemInMainDoc = saveNext;
        }
        if (elemInMainDoc !== sorted[nPtr]) break;
      }
      sectionToRemove = null;
      moveHtmlCodeIntoTargetContainer(elemInMainDoc === parentTitle);
      sectionOrPoemOrStanza = getSectionOrPoemOrStanzaByElement(parentTitle);
      if (!parentTitle.firstChild || elemInMainDoc === parentTitle) parentTitle.remove();
    } else {
      elemInMainDoc = getNext(parentTitle);
      sectionOrPoemOrStanza = getSectionOrPoemOrStanzaByElement(parentTitle);
    }
    if (elemInMainDoc === parentTitle) moveBlockIntoPreviousBlock();
    else {
      // SECOND PROCESSING: unselected and selected lines after the first selected group
      while (elemInMainDoc && elemInMainDoc !== parentTitle && nPtr < sorted.length) {
        const elemInListMatchInMainDoc = sorted[nPtr];
        // a container like sectionOrPoemOrStanza, with a title, in front of it
        const el4 = div(sectionOrPoemOrStanza.kind);
        const newTitleElement = el4.appendChild(div('title'));
        sectionOrPoemOrStanza.insertAdjacent('beforeBegin', el4);
        previousSection = el4;
        // the unselected lines stay title lines, of the new container
        while (elemInMainDoc !== parentTitle && elemInMainDoc !== elemInListMatchInMainDoc) {
          const saveNext = getNext(elemInMainDoc);
          newTitleElement.appendChild(elemInMainDoc.remove());
          elemInMainDoc = saveNext;
        }
        // the selected ones
        htmlStr = [];
        while (elemInMainDoc && elemInMainDoc !== parentTitle && nPtr < sorted.length && elemInMainDoc === sorted[nPtr]) {
          const saveNext = getNext(elemInMainDoc);
          collectHtmlCodeForMoving(elemInMainDoc);
          nPtr += 1;
          elemInMainDoc = saveNext;
          if (elemInMainDoc !== sorted[nPtr]) break;
        }
        sectionToRemove = null;
        moveHtmlCodeIntoTargetContainer(false);
      }
      if (elemInMainDoc === parentTitle) {
        parentTitle.remove();
        moveBlockIntoPreviousBlock();
      }
    }
    if (sectionToRemove) sectionToRemove.unwrap();
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Subtitles as titles                                                                        */
/* ---------------------------------------------------------------------------------------- */

/** Whether `nodes` may follow the last child of a container `prev` (the FB2 schema). */
function appendable(prev, nodes) {
  const last = prev.lastChild;
  if (prev.kind === 'section') {
    if (last && (isSection(last) || last.tag === 'SPAN')) return false;
    return nodes.every((n) => n.tag === 'P' ? n.cls === '' || n.cls === 'subtitle' : ['poem', 'cite', 'table', 'image'].includes(n.kind));
  }
  if (prev.kind === 'poem') {
    if (last && last.tag === 'P' && last.cls === 'text-author') return false;
    return nodes.every((n) => isStanza(n) || isSubtitle(n));
  }
  if (prev.kind === 'stanza') return nodes.every((n) => n.tag === 'P' && n.cls === '');
  return false;
}

/**
 * reformatSubtitlesToTitles: `subtitles` are the selected subtitles (P boxes) in document order.
 * Returns whether some of them stood in cites (the original's warning).
 */
export function reformatSubtitles(subtitles) {
  let thereWasSubtitlesInCite = false;
  for (const elemInMainDoc of subtitles) {
    if (isDiv(elemInMainDoc.parent, 'cite')) {
      thereWasSubtitlesInCite = true;
      continue;
    }
    const sectionOrPoemOrStanza = getSectionOrPoemOrStanzaByElement(elemInMainDoc);
    // a subtitle that is not a child of its section, poem or stanza (one in a section's
    // annotation): the original's moves made no valid book of it; it stays a subtitle
    if (!sectionOrPoemOrStanza || elemInMainDoc.parent !== sectionOrPoemOrStanza) continue;
    let myEl = sectionOrPoemOrStanza.firstChild;
    if (elemInMainDoc.previousSibling && !isTitle(elemInMainDoc.previousSibling)) {
      // what stands in front of the subtitle goes to the end of the previous container of the
      // same kind - 2.7.9 made a new one only when the container starts with a title (2.7beta1:
      // with any DIV) - or to a new container when FB2 allows it nowhere else
      const moving = [];
      for (let n = myEl; n && n !== elemInMainDoc; n = n.nextSibling) moving.push(n);
      let prev = sectionOrPoemOrStanza.previousSibling;
      if (!prev || prev.kind !== sectionOrPoemOrStanza.kind || isTitle(sectionOrPoemOrStanza.firstChild) || !appendable(prev, moving)) {
        prev = sectionOrPoemOrStanza.insertAdjacent('beforeBegin', div(sectionOrPoemOrStanza.kind));
      }
      while (myEl && myEl !== elemInMainDoc) {
        const saveNext = myEl.nextSibling;
        prev.insertAdjacent('beforeEnd', myEl);
        myEl = saveNext;
      }
    }
    // the subtitle becomes a title line
    let titleElement;
    if (!(elemInMainDoc.previousSibling && isTitle(elemInMainDoc.previousSibling))) {
      titleElement = elemInMainDoc.parent.insertAdjacent('afterBegin', div('title'));
    } else titleElement = elemInMainDoc.previousSibling;
    elemInMainDoc.cls = '';
    elemInMainDoc.orig = 'p';
    titleElement.appendChild(elemInMainDoc.remove());
    if (titleElement.parent.lastChild === titleElement) {
      // a title at the end of its container goes to the next one, joining its title
      let nextSectionOrPoemOrStanza = sectionOrPoemOrStanza.nextSibling;
      if (!nextSectionOrPoemOrStanza || nextSectionOrPoemOrStanza.tag !== 'DIV' || nextSectionOrPoemOrStanza.kind !== sectionOrPoemOrStanza.kind) {
        nextSectionOrPoemOrStanza = div(sectionOrPoemOrStanza.kind);
        nextSectionOrPoemOrStanza.appendChild(emptyLine());
        sectionOrPoemOrStanza.insertAdjacent('afterEnd', nextSectionOrPoemOrStanza);
      }
      if (!nextSectionOrPoemOrStanza.firstChild || !isTitle(nextSectionOrPoemOrStanza.firstChild)) {
        nextSectionOrPoemOrStanza.insertAdjacent('afterBegin', titleElement.remove());
      } else {
        const titleInNextSection = nextSectionOrPoemOrStanza.firstChild;
        for (const line of [...titleElement.kids].reverse()) {
          line.keepId = false;
          titleInNextSection.insertAdjacent('afterBegin', line);
        }
        if (titleElement.parent.firstChild === titleElement && titleElement.parent.lastChild === titleElement) titleElement.parent.remove();
        else titleElement.remove();
      }
    }
  }
  return thereWasSubtitlesInCite;
}
