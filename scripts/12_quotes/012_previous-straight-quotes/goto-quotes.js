// Engine of the "Перейти на предыдущие / следующие ..." quote scripts of FictionBook Editor
// 2.7.9's group 12_Обработка кавычек (008-015, Sclex, version 2.9; converted from their
// 2.7beta1 versions first and brought up to 2.7.9 in feature 007). Each of the eight packages
// carries an identical copy: the sandbox only loads modules from the script's own folder.
//
// The originals walked the text of the book as FictionBook Editor showed it (lib/nav-lib.js
// rebuilds that page: the book's annotation and its history first, then every body) from the end
// of the selection (forward) or its start (backward) to the nearest of the given characters and
// selected it. At the end (start) of the book they asked whether to go on from the other end
// (confirm: OK / Cancel), then searched up to the selection and said "Ничего не найдено, поиск
// завершен." when they got there. A selected picture is refused with the original's message.
// Run() returned nothing; so does run().
//
// Differences from 2.7.9 (docs/scripting/conversion-notes-279-b.md, group 12): the editor scrolls
// the selection into view (the original: 60 pixels below the window's top edge); a picture
// inside a paragraph counts as one character of its text, as the editor counts offsets.
// The original's notice, kept as written (FR-029):
//Перейти на кавычки v2.9
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org

import { loadBook, locate, textOf, t } from './lib/nav-lib.js';

/** The nearest of `chars` in `text` at or after `from`, -1 when none. */
function findForward(text, chars, from) {
  let best = -1;
  for (const ch of chars) {
    const index = text.indexOf(ch, from);
    if (index !== -1 && (best === -1 || index < best)) best = index;
  }
  return best;
}

/** The nearest of `chars` in `text` before `before`, -1 when none. */
function findBackward(text, chars, before) {
  let best = -1;
  if (before <= 0) return best;
  for (const ch of chars) best = Math.max(best, text.lastIndexOf(ch, before - 1));
  return best;
}

/**
 * Runs one search: `forward` the direction, `chars` the characters, `version` {ru, en} the
 * script's line in its messages ("Скрипт «Перейти на кавычки v2.9».").
 */
export async function goToQuotes(ctx, { forward, chars, version }) {
  const versionStr = `${t(ctx, version.ru, version.en)}\n${t(ctx, 'Автор Sclex.', 'Author: Sclex.')}\n\n`;
  const book = await loadBook();
  const where = await locate(book, forward);
  if (!where) return undefined;
  if (where.picture) {
    await mfbe.ui.message(
      versionStr +
        t(
          ctx,
          'Выделена картинка, а чтобы сработал скрипт,\nнадо, чтобы курсор был в тексте.\nТак что перейти на кавычку не выйдет.',
          'A picture is selected, but the script needs\nthe caret in the text.\nSo it cannot go to a quote.',
        ),
      { caption: ctx.script.name, icon: 'warning' },
    );
    return undefined;
  }
  const ps = book.ps;
  const texts = ps.map((p) => textOf(p));
  const select = async (index, offset) => {
    await mfbe.selection.set(
      { nodeId: ps[index].nodeId, offset },
      { nodeId: ps[index].nodeId, offset: offset + 1 },
    );
    await mfbe.selection.scrollIntoView();
    return undefined;
  };
  // A point between paragraphs (in a container) has a fractional index.
  const { start, end } = where;
  if (forward) {
    // From the end of the selection to the end of the book.
    for (let i = Math.ceil(end.index); i < ps.length; i += 1) {
      const found = findForward(texts[i], chars, i === end.index ? end.offset : 0);
      if (found !== -1) return select(i, found);
    }
  } else {
    // From the start of the selection back to the start of the book.
    for (let i = Math.floor(start.index); i >= 0; i -= 1) {
      const found = findBackward(texts[i], chars, i === start.index ? start.offset : texts[i].length);
      if (found !== -1) return select(i, found);
    }
  }
  // The original's confirm(): OK and Cancel, with the editor's own button labels.
  const question = forward
    ? t(ctx, 'Достигнут конец документа.\nПродолжить поиск с начала документа?', 'The end of the document has been reached.\nContinue searching from the beginning?')
    : t(ctx, 'Достигнуто начало документа.\nПродолжить поиск с конца документа?', 'The beginning of the document has been reached.\nContinue searching from the end?');
  const answer = await mfbe.ui.message(versionStr + question, {
    caption: ctx.script.name,
    icon: 'question',
    buttons: [
      { id: 'ok', label: '', default: true },
      { id: 'cancel', label: '', cancel: true },
    ],
  });
  if (answer !== 'ok') return undefined;
  if (forward) {
    // From the start of the book up to the start of the selection.
    for (let i = 0; i <= Math.floor(start.index) && i < ps.length; i += 1) {
      const found = findForward(texts[i], chars, 0);
      if (found !== -1 && (i < start.index || found < start.offset)) return select(i, found);
    }
  } else {
    // From the end of the book back to the end of the selection.
    for (let i = ps.length - 1; i >= Math.ceil(end.index) && i >= 0; i -= 1) {
      const found = findBackward(texts[i], chars, texts[i].length);
      if (found !== -1 && (i > end.index || found >= end.offset)) return select(i, found);
    }
  }
  await mfbe.ui.message(
    versionStr + t(ctx, 'Ничего не найдено, поиск завершен.', 'Nothing found, the search is finished.'),
    { caption: ctx.script.name, icon: 'info' },
  );
  return undefined;
}
