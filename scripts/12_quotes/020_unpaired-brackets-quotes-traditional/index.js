// Converted from FictionBook Editor 2.7.9: Scripts/12_Обработка кавычек/020_Поиск абзацев с непарными скобками и кавычками („традиционные“ лапки).js
// Finds, from the caret on, the next paragraph whose brackets and quotes do not pair up, the inner
// quotes being the traditional „…“: in the paragraph the text from the first bracket or quote at
// or after the caret to the last one is selected and the status bar names the characters left
// unpaired; a list marker "1)" or "а)" at the start of the paragraph is not counted. "От позиции
// курсора до конца документа ничего не найдено." when there is none. The book's annotation and the
// history count as part of the text, as they did. The engine is unpaired.js (shared with 025),
// built on nav-lib.js of the converted group 16 (copied unchanged). Returns nothing.
// Differences from the original: a picture is one character of the text (2.7.9 counted "~~~",
// which moved a selection after a picture by two characters per picture); the original's set of
// user expressions, macros and tag expressions, unused by this script, is not carried over; the
// editor scrolls the selection into view. Fix: a selected picture is refused with a message that
// says so (the original's message printed the words "sel.type"). See
// docs/scripting/notes-279-drafts/12.md.
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск абзацев с непарными скобками и кавычками („традиционные“ лапки) v.1.1» для редактора Fiction Book Editor (FBE).
// Создано на базе скрипта «Поиск (без замены) ошибок текста (версия с исключениями)» Версия 4.8. Автор Sclex.
// Добавлены  фрагменты, обрамленные закомментироваными строками из дефисов и знаков равенства, 
// сверху и снизу соответственно. (stokber).
import { runUnpairedSearch } from './unpaired.js';

export default async function run(ctx) {
  // выбор вида лапок: rX = sTrad
  await runUnpairedSearch(ctx, 'traditional');
}
