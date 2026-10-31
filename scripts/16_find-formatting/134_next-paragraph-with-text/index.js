// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/134_Выделить следующий абзац с искомым текстом.js
// Selects the next paragraph that contains the text set below ("сказа", in any letter case): the
// search goes paragraph by paragraph from the end of the selection to the end of the book
// (regexp-set.js); the description of the match goes to the status bar. Returns "Found", or
// "NotFound" after saying that nothing is found up to the end (as the original's Run() did).
// Differences from the original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий абзац с искомым текстом» для редактора Fiction Book Editor (FBE).
// Версия 5.0
// Основано на скрипте "Поиск по набору регэкспов"
// Автор Sclex, сборка TaKir
// Скрипт производит переход на ближайший абзац с определенным текстом вниз по тексту.
//  _________________________________________________________________________

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

export default async function run(ctx) {
  const set = createRegExpSet();
  // Тут впишите в скобках нужный вам текст или сочетание символов.
  // Put the text or the characters you look for between the brackets (in a copy of this
  // package in your own scripts folder, with an id of its own).
  set.addRegExp(String.raw`^(.*?)(сказа)(.*?)$`, 'i', {
    ru: 'Найдено: Слово или часть слова \\-сказа-\\.',
    en: 'Found: the word or part of a word \\-сказа-\\.',
  });
  // Весь абзац с указанным текстом будет выделен и с ним можно выполнять необходимые действия с помощью горячих клавиш или скриптов.
  // The whole paragraph with the text is selected, for hotkeys or other scripts to work on.
  return runRegExpSearch(ctx, set, { engine: 'current' });
}
