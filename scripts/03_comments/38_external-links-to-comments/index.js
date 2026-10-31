// Converted from FictionBook Editor 2.7.9: Scripts/03_Комментарии/38_Превратить внешние ссылки в комментарии.js
// Turns every external link of the book (an address starting with http:, https:, ftp:, file: or
// mailto:, a link without a type; the annotation and the history included) into its text and a
// comment link to a new section that holds the address. The section goes before the section of the
// next comment link of the book, or at the end of the comments body without one; then the sections
// of the comments body are renumbered (ids c_N, titles N, links {N} in superscript). The original
// chained two scripts through the temporary brackets 【♣★ ★♣】; the engine (lib/external-links.js)
// does both at once and keeps the original's refusal of a book that already holds those characters
// (the pattern goes to the clipboard, as it did).
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 03).
// The original's notice, kept as written (FR-029):
//======================================
//            «Превратить внешние ссылки в комментарии» 1.3 (декабрь, 2024)
//
// Сценарий представляет собой компиляцию из незначительно 
// изменённых двух скриптов за авторством Sclex-а: 
// "Генеральная уборка" и "Комментарии из скобок".
// Автор сборки — stokber
//~~~~~~~~~~~~~~~~~~
//обрабатывать ли history
//обрабатывать ли annotation
// обрабатывать ли сноски                       // отключаю касательство к сноскам
// var Snoska=false;
//  var PromptSnoska=true;
// Проверяем случайное наличие в документе символов ☺ и ☻, которые 

import { COMMENTS, runExternalLinks } from './lib/external-links.js';

export default async function run(ctx) {
  await runExternalLinks(ctx, COMMENTS);
}
