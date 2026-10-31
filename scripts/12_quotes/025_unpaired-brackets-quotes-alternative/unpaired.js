// Engine of the two "Поиск абзацев с непарными скобками и кавычками" scripts of FictionBook Editor
// 2.7.9 (12_Обработка кавычек 020 and 025, stokber's additions to Sclex's "Поиск (без замены)
// ошибок текста (версия с исключениями)" 4.8). Each package carries its own copy.
//
// The search goes paragraph by paragraph from the end of the selection to the end of the book
// (the book's annotation and the history first, as FictionBook Editor showed them; no
// wrap-around). Its one expression finds the text from the first bracket or quote at or after the
// caret to the last one of the paragraph. For such a paragraph the original removed a leading
// list marker ("1)", "а)") and everything but the brackets and quotes from the paragraph's whole
// text, then took away adjacent pairs - "", «», {}, [], (), <> and „“ (traditional) or “”
// (alternative) - until none was left: when nothing remains the paragraph is passed over (its
// description began with "Пропустить"), otherwise the match is selected and the characters left
// are named in the status bar. Run() returns nothing.

import { loadBook, locate, setCaret, setRange, t, textOf } from './nav-lib.js';

// The original's expression, as JScript read its string (\{ \} \[ \] \( \) inside the class).
const SEARCH = /["„“”{}[\]()«»<>].*["„“”{}[\]()«»<>]|["„“”{}[\]()«»<>]/g;

// The pairs removed again and again (sTrad and sAlt of the original), compiled without the u flag
// as JScript did: "\{}" and "\[]" are a bracket and its partner.
const PAIRS = {
  traditional: '""|„“|«»|\\{}|\\[]|\\(\\)|<>',
  alternative: '""|“”|«»|\\{}|\\[]|\\(\\)|<>',
};

/** What the original left of a paragraph's text: its unpaired brackets and quotes, or ''. */
export function unpairedOf(text, kind) {
  // удалить всё кроме указанных скобок и кавычек + перечни типа 1), 2), 3), а), б), в) с начала строки
  let s = text.replace(/^[1-9а-е][)]|[^"„“”«»{}[\]()<>]/g, '');
  let result = 0;
  while (result !== null) {
    result = s.match(new RegExp(PAIRS[kind], 'g'));
    s = s.replace(new RegExp(PAIRS[kind], 'g'), '');
  }
  return s;
}

function description(ctx, kind, rest) {
  if (kind === 'traditional') {
    return t(
      ctx,
      `Найдено: Следующие символы непарные: ${rest}.          Вы выбрали проверку документа с „традиционными“ лапками (н99…в66).`,
      `Found: these characters are unpaired: ${rest}.          You chose to check a document with „traditional“ quotes (low 99…high 66).`,
    );
  }
  return t(
    ctx,
    `Найдено: Следующие символы непарные: ${rest}.          Вы выбрали проверку документа с “альтернативными лапками” (в66…в99).`,
    `Found: these characters are unpaired: ${rest}.          You chose to check a document with “alternative quotes” (high 66…high 99).`,
  );
}

/** Runs the search with the traditional („“) or the alternative (“”) inner quotes. */
export async function runUnpairedSearch(ctx, kind) {
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return undefined;
  if (where.picture) {
    // The original printed the words "sel.type" here instead of the kind of selection.
    await mfbe.ui.message(
      t(
        ctx,
        'Не обрабатываемый тип выделения: выделена картинка.',
        'Unsupported kind of selection: a picture is selected.',
      ),
      { icon: 'error' },
    );
    return undefined;
  }
  const from = where.end;
  let index = Math.floor(from.index);
  let offset = from.item && from.item.kind === 'p' ? from.offset : 0;
  if (index < 0 || index !== from.index) {
    // Not in a paragraph: the search starts with the next one.
    index = Math.floor(from.index) + 1;
    offset = 0;
  }
  for (let steps = 0; index < book.ps.length; steps += 1) {
    if (ctx.cancelled) return undefined;
    if (steps % 500 === 499) await mfbe.ui.progress(index, book.ps.length);
    const p = book.ps[index];
    const text = textOf(p);
    // The caret's paragraph counts unless the caret is at its end (an empty one always counts).
    if (offset < text.length || text.length === 0) {
      SEARCH.lastIndex = offset;
      const m = SEARCH.exec(text);
      if (m) {
        const rest = unpairedOf(text, kind);
        if (!rest) {
          // "Пропустить": the search goes on after the match, in the same paragraph.
          await mfbe.ui.status(t(ctx, 'Пропустить: ', 'Skip: '), { sticky: true });
          offset = m.index + Math.max(m[0].length, 1);
          continue;
        }
        await mfbe.ui.status(description(ctx, kind, rest), { sticky: true });
        if (m[0].length === 0) await setCaret(p, m.index);
        else await setRange(p, m.index, p, m.index + m[0].length);
        return undefined;
      }
    }
    index += 1;
    offset = 0;
  }
  await mfbe.ui.status(t(ctx, 'Поиск завершен!', 'Search finished!'), { sticky: true });
  await mfbe.ui.message(
    t(
      ctx,
      'От позиции курсора до конца документа ничего не найдено.',
      'Nothing was found between the caret and the end of the document.',
    ),
  );
  return undefined;
}
