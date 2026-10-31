// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/125_Выделить следующий список.js
// Selects a paragraph that starts like a list item (digits or a letter followed by ")" or ".", or
// one of the signs ♠♣♦♥•■∙▶~): the search goes paragraph by paragraph from the end of the selection
// to the end of the book (regexp-set.js); the description of the match goes to the status bar.
// Returns "Found", or "NotFound" after saying that nothing is found up to the end (as the
// original's Run() did). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий нумерованный или маркированный "список"» для редактора Fiction Book Editor (FBE).
// Версия 5.1
// Основано на скрипте "Поиск по набору регэкспов"
// Автор Sclex, сборка TaKir
// Скрипт производит переход на ближайший "список" вниз по тексту.
//  _________________________________________________________________________

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

export default async function run(ctx) {
  const set = createRegExpSet();
  // The original's strings as JScript read them ("\)" and "\." are ")" and ".").
  set.addRegExp(String.raw`(^[0-9]{1,}[)|.](.*?)$)`, '', {
    ru: 'Найдено: Нумерованный список - с цифрами в начале строки',
    en: 'Found: a numbered list - digits at the start of the line',
  });
  set.addRegExp(String.raw`(^[a-zA-Zа-яА-Я][)|.](.*?)$)`, '', {
    ru: 'Найдено: Маркированный список - с буквами в начале строки',
    en: 'Found: a bulleted list - a letter at the start of the line',
  });
  set.addRegExp(String.raw`(^[♠♣♦♥•■∙▶~][\x20\xA0]{0,1}(.*?)$)`, '', {
    ru: 'Найдено: Маркированный список - с графическими маркерами в начале строки',
    en: 'Found: a bulleted list - a bullet sign at the start of the line',
  });
  return runRegExpSearch(ctx, set, { engine: 'current' });
}
