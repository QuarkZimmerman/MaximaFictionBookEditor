// Converted from FictionBook Editor 2.7.9: Scripts/14_Цитаты/052_Сформатировать абзац(ы) цитатой.js
// Puts paragraphs into a new citation. The paragraphs are those from the one holding the start
// of the selection to the one holding its end (a caret: its own paragraph; an end at the very
// start of a paragraph takes that paragraph too, as the marker the original pasted there did),
// the empty lines between them included. The citation is made only when every one of them is a
// plain paragraph or an empty line standing directly in one and the same section - not a title
// line, a subtitle, a verse, a text author, a table cell, nor a paragraph of a citation, an
// epigraph, an annotation or the book's annotation or history; otherwise nothing changes. The
// paragraphs move into the citation as they are (ids, styles and formatting included), in the
// place of the first of them; a picture standing between them stays, after the citation. The
// status bar shows "ОК" at the end, as in the original; its Run() returned nothing, nor does
// run(). Started by another script (ctx.startedBy 'script'), it works on the selection that
// script left: 2.7.9's combos 14/059-062 run it after "Выделить следующий целиком жирный
// (курсивный) абзац".
// Differences from the original: afterwards the caret stands at the end of the citation's last
// paragraph (the original replaced the paragraphs the selection was in and had commented out
// the code that would have selected them again, so the selection was left wherever Internet
// Explorer put it); a selected picture changes nothing (the original stopped with a script
// error: its range of a picture has no parentElement); the message for a selection in an input
// field is gone, since a script sees the Body view only. Notes:
// docs/scripting/notes-279-drafts/14.md.
// The original's notice, kept as written (FR-029):
// Скрипт «Сформатировать абзац(ы) цитатой»
// Автор Sclex
// Версия 1.3
 //имя тэга, который будет использован для маркеров начала и конца выделения
  //alert("Вошли в getNextNode.");

import { isTextBlock, loadBook, locate, t, textOf } from './nav-lib.js';

/**
 * Every P of the page from the one holding the start of the selection to the one holding its
 * end, in document order (getNextP of the original): text blocks and empty lines at any depth.
 */
function paragraphsOfSelection(book, where) {
  const from = Math.ceil(where.start.index);
  const to = Math.floor(where.end.index);
  return from <= to ? book.ps.slice(from, to + 1) : [];
}

/**
 * processPs() of the original: the first P must stand in a section, and every P must have that
 * section for its parent and no class (a paragraph or an empty line; a verse's parent is a
 * stanza, a subtitle and a text author have classes of their own).
 */
function canBecomeCite(ps) {
  const section = ps[0].parent;
  if (!section || section.kind !== 'div' || section.cls !== 'section') return false;
  return ps.every((p) => p.parent === section && p.cls === '' && !p.isPlaceholder);
}

export default async function run(ctx) {
  const book = await loadBook();
  const where = await locate(book, true);
  // A selected picture is no text selection: nothing to do.
  if (!where || where.picture) return;
  await mfbe.ui.status(
    t(ctx, 'Форматируем абзац(ы) цитатой…', 'Formatting the paragraph(s) as a citation…'),
  );
  const ps = paragraphsOfSelection(book, where);
  if (ps.length > 0 && canBecomeCite(ps)) {
    const section = ps[0].parent;
    const moved = new Set(ps.map((p) => p.node));
    // The citation takes the place of the first paragraph; whatever stood between the
    // paragraphs and is not one of them (a picture) follows it, in its order.
    const cite = { type: 'cite', attrs: {}, content: ps.map((p) => p.node) };
    const content = [];
    let placed = false;
    for (const child of section.node.content ?? []) {
      if (moved.has(child)) {
        if (!placed) content.push(cite);
        placed = true;
      } else {
        content.push(child);
      }
    }
    await mfbe.doc.replaceNode(section.nodeId, { ...section.node, content });
    const last = ps[ps.length - 1];
    if (isTextBlock(last)) {
      await mfbe.selection.set({ nodeId: last.nodeId, offset: textOf(last).length });
    }
  }
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'), { sticky: true });
}
