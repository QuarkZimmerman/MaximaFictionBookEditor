// Converted from FictionBook Editor 2.7.9: Scripts/10_Статистика/18_Показать жанры.js
// Shows the book's genres in a message: every genre of title-info and, under a line, of
// src-title-info, each code decoded to its name with the original's table of 295 genres
// (genres.js; a code the table does not know is shown as it is), "<основной жанр не указан>"
// when title-info has none. The English interface shows English genre names (genres.js).
// Difference from the original: while its message was open the original also wrote each genre's
// name, in green, next to the code in the Description view (when that view was shown) and took
// it away afterwards; scripts cannot add to the editor's own page, and the Description view
// names the genres itself. See docs/scripting/notes-279-drafts/10.md.
// The original's notice, kept as written (FR-029):
//------------------------------------------------------------------------------------------
//  Скрипт «Показать жанры»
//  предназначен для расшифровки кодов жанра
//  тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//------------------------------------------------------------------------------------------
// v.1.0 — Создание скрипта — Александр Ка (16.03.2025)
//------------------------------------------------------------------------------------------
import { GENRE_CODES, GENRE_NAMES_EN, GENRE_NAMES_RU } from './genres.js';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The original's Show(): the list of the genres of one block, decoded. */
function show(ctx, genres) {
  const names = ctx.uiLanguage === 'ru' ? GENRE_NAMES_RU : GENRE_NAMES_EN;
  let Zhanry = '';
  for (const genre of genres ?? []) {
    let bookGenre = genre.code ?? '';
    if (bookGenre === '') continue;
    const k = GENRE_CODES.indexOf(bookGenre);
    if (k >= 0) bookGenre = names[k];
    Zhanry += ` • ${bookGenre}   \n`;
  }
  return Zhanry;
}

export default async function run(ctx) {
  const { description } = await mfbe.doc.get();
  let Txt2 = t(ctx, 'ЖАНРЫ:\n\n', 'GENRES:\n\n');
  // Основные жанры
  let Zhanry = show(ctx, description.titleInfo?.genres);
  if (Zhanry !== '') Txt2 += Zhanry;
  else Txt2 += t(ctx, '   <основной жанр не указан>   \n', '   <no main genre given>   \n');
  // Жанры оригинала
  Zhanry = show(ctx, description.srcTitleInfo?.genres);
  if (Zhanry !== '') Txt2 += `-----------------------------------------------   \n${Zhanry}`;
  await mfbe.ui.message(Txt2, { caption: ctx.script.name, icon: 'info' });
}
