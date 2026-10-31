// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/132_Выделить следующую пустую строку.js
// Selects the next empty line or line of spaces only (the old engine of the original, version 5.3):
// the search goes paragraph by paragraph from the end of the selection to the end of the book
// (regexp-set.js); the description of the match goes to the status bar. Returns nothing, as the
// original's Run() did. Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующую пустую строку» для редактора Fiction Book Editor (FBE).
// Версия 5.3 (СТАРАЯ, используется для корректной работы с пустыми строками)
// Автор Sclex.
// Идеи скрипта и регекспов TaKir.
//  _________________________________________________________________________

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

export default async function run(ctx) {
  const set = createRegExpSet();
  set.addRegExp(String.raw`(^$)`, '', { ru: 'Найдено: Пустая строка', en: 'Found: an empty line' });
  set.addRegExp(String.raw`(^[\x20\xA0]+$)`, '', {
    ru: 'Найдено: Строка из одних пробелов',
    en: 'Found: a line of spaces only',
  });
  return runRegExpSearch(ctx, set, { engine: 'old' });
}
