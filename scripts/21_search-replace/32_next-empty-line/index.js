// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/32_Перейти на следующую пустую строку.js
// Goes to the next empty line: an empty paragraph or a line of spaces only. The original kept
// the older 5.4 engine of the search by a set of regexps for that ("used for working correctly
// with empty lines"): a caret skips a hit right at it, so repeated runs walk on.
// Differences: the hit is selected exactly where the expression matched (the original moved
// IE's selection by characters and was off after inline pictures and soft hyphens), and the view
// scrolls it into sight in place of the original's own scrolling; an inline picture selected as
// text is searched past like text (the original refused a clicked picture, a "Control"
// selection, but selected a hit on a picture as text, which the editor cannot tell apart).
// An empty line cannot hold the caret in this editor: the hit selects from the end of the line
// before it to the start of the line after it (consecutive empty lines are passed in one step);
// an empty paragraph gets the caret. The original's crutch that moved the caret by a word at
// IE's DIV boundaries (cursorShift) is not needed and dropped.
// The original's notice, kept as written (FR-029):
// Скрипт «Перейти на следующую пустую строку» для редактора Fiction Book Editor (FBE).
// Версия 5.4 (СТАРАЯ, используется для корректной работы с пустыми строками)
// Автор Sclex.
// Идеи скрипта и регекспов TaKir.
//  _________________________________________________________________________
import { CONDITION_NAMES, createRegExpSet, searchRegExpSet } from './regexp-set.js';

// The original's list of expressions, kept as written (with its instructions and comments).
function init({ addMacros, addRegExp, tagRegExp }) {


   addRegExp("(^$)","","Найдено: Пустая строка");
   addRegExp("(^[\\x20\\xA0]+$)","","Найдено: Строка из одних пробелов");



 }

export default async function run(ctx) {
  const set = createRegExpSet({ conditionNames: [...CONDITION_NAMES, 'annotation'] });
  init(set);
  await searchRegExpSet(ctx, set, { engine: '5.4-old', image: '~~~', decodeShy: true, trackAnnotation: true, finishedStatus: false });
}
