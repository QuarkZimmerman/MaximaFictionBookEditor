// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/025_Перейти на предыдущее совмещение курсива с жирностью.js
// Moves the caret to the end of the previous run of text that is both italic and bold
// (combo-search.js); at the beginning of the book it asks whether to go on from the end. Returns
// "Found", or "NotFound" when nothing is found or the user declines to go on; nothing for a
// selected picture (as the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущее совмещение курсива с жирностью»
//Автор Sclex
//Топик про скрипты FBE: http://www.fictionbook.org/forum/viewtopic.php?t=4412
//Мой сайт про мои скрипты: http://scripts.fictionbook.org

import { runComboSearch } from './combo-search.js';

export default async function run(ctx) {
  return runComboSearch(ctx, { forward: false });
}
