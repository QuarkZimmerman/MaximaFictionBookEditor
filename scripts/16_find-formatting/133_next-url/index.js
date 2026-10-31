// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/133_Выделить следующую ссылку.js
// Selects the text from the next address (ftp, mail, file, www, http, or anything up to an @) to
// the end of its paragraph: the search goes paragraph by paragraph from the end of the selection to
// the end of the book (regexp-set.js); the description of the match goes to the status bar. Returns
// "Found", or "NotFound" after saying that nothing is found up to the end (as the original's Run()
// did). Differences from the original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующую ссылку» для редактора Fiction Book Editor (FBE).
// Версия 5.1
// Основано на скрипте "Поиск по набору регэкспов"
// Автор Sclex, сборка TaKir
// Скрипт производит переход на ближайшую ссылку вниз по тексту.
//  _________________________________________________________________________

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

export default async function run(ctx) {
  const set = createRegExpSet();
  set.addRegExp(String.raw`(ftp.*|mail.*|.*@.*|file.*|www.*|http.*|https.*)`, 'i', {
    ru: 'Найдено: Ссылка',
    en: 'Found: a link',
  });
  return runRegExpSearch(ctx, set, { engine: 'current' });
}
