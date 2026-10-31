// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/130_Выделить следующий КАПС (рус-лат).js
// Selects the next run of two or more capital letters (Russian or Latin): the search goes paragraph
// by paragraph from the end of the selection to the end of the book (regexp-set.js); the
// description of the match goes to the status bar. Returns "Found", or "NotFound" after saying that
// nothing is found up to the end (as the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующее cлово заглавными буквами, "КАПС" (рус-лат)» для редактора Fiction Book Editor (FBE).
// Версия 5.1
// Основано на скрипте "Поиск по набору регэкспов"
// Автор Sclex, сборка TaKir
// Скрипт производит переход на ближайшее cлово (2 и более букв) заглавными буквами, "КАПС" (рус-лат) вниз по тексту.
//  _________________________________________________________________________

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

export default async function run(ctx) {
  const set = createRegExpSet();
  set.addRegExp(String.raw`[A-ZА-ЯЁ]{2,}`, '', {
    ru: 'Найдено: Слово заглавными буквами - КАПС.',
    en: 'Found: a word in capital letters - CAPS.',
  });
  return runRegExpSearch(ctx, set, { engine: 'current' });
}
