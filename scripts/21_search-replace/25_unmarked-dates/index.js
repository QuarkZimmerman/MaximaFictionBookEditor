// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/25_Поиск (без замены) неразмеченных дат.js
// Searches - without replacing anything - for dates that are not marked up: short lines holding a
// year (1700-2029), a year with "г.", or a day and a month ("12 апреля"), outside text authors,
// titles and subtitles; a hit in a table cell is passed over, as the original did.
// Each run starts at the end of the selection (a caret: at the caret) and goes on to the end of the
// book; the first hit is selected and its description is shown in the status bar (the
// descriptions stay in Russian, as the expressions are about Russian text). The engine is
// regexp-set.js, a faithful port of the original's (see there).
// Differences: the hit is selected exactly where the expression matched (the original moved
// IE's selection by characters and was off after inline pictures and soft hyphens), and the view
// scrolls it into sight in place of the original's own scrolling; an inline picture selected as
// text is searched past like text (the original refused a clicked picture, a "Control"
// selection, but selected a hit on a picture as text, which the editor cannot tell apart).
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск (без замены) неразмеченных дат» для редактора Fiction Book Editor (FBE).
// Версия 1.01 (stokber, октябрь 2025)
// За основу взят скрипт ув. Sclex-а «Поиск по набору регекспов».
import { createRegExpSet, searchRegExpSet } from './regexp-set.js';

// The original's list of expressions, kept as written (with its instructions and comments).
function init({ addMacros, addRegExp, tagRegExp }) {
 
    // везде, кроме (под)заголовков и таблиц:
    addRegExp("^(?:[^©№]{0,30}\\\D)?(?:[1][789][0-9][0-9]|[2][0][0-2][0-9])(?!(?:[0-9]| год[а-я]|[-](?:й|е|х|м|го)))(?:.{0,30}[^.])?$","i","Найдено: неразмеченная дата?","-text-author -title -subtitle");
    
	addRegExp("^.{1,55}(?:[1][789][0-9][0-9]|[2][0][0-2][0-9])[\\x20\\xA0]г[.\\\)][\\x20\\xA0]?$","i","Найдено: неразмеченная дата?","-text-author -title -subtitle");
	
	addRegExp("^([1-9]|1[0-9]|2[0-9]|3[01])([–—-]([1-9]|1[0-9]|2[0-9]|3[01]))?[\\x20\\xA0]{1,2}(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[\\x20\\xA0]{0,1}$","i","Найдено: неразмеченная дата?","-text-author -title -subtitle");
	
//	addRegExp("^[^©–—-].{1,65}[\\\wа-яё][\\x20\\xA0]{0,1}$","i","Найдено: бесхозная короткая строка?","-text-author -title -subtitle -cite -poem -epigraph");
	
    // только в стихах:
    // addRegExp("^(?:.*\\\D)?(?:[1][789][0-9][0-9]|[2][0][0-2][0-9])(?!(?:[0-9]| год[а-я]|[-](?:й|е|х|м|го)))(?:.*[^.])?$","i","Найдено: неразмеченная дата в стихах?","-text-author +poem");

 }

export default async function run(ctx) {
  const set = createRegExpSet();
  init(set);
  await searchRegExpSet(ctx, set, { image: 'ǾǾǾ', decodeShy: true, skipCells: true });
}
