// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/169_Выделить заглавный заголовок или подзаголовок (КАПС).js
// Selects the next title paragraph or subtitle with two or more capital letters in a row (the whole
// paragraph): the search goes from the end of the selection to the end of the book (regexp-set.js);
// the description of the match goes to the status bar. Returns nothing, as the original's Run()
// did. Differences from the original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий заголовок или подзаголовок, набранный ЗАГЛАВНЫМИ БУКВАМИ, "КАПС" (рус-лат)» для редактора Fiction Book Editor (FBE).
// Версия 5.3
// Основано на скрипте «Поиск по набору регэкспов»
// Автор Sclex, набор RegExp-ов - TaKir, май, 2025
// 30 января 2023 года исправлены недочеты поисковых команд, на которые (недочеты) указал пользователь stokber
// 06 апреля 2023 года исправлены недочеты поисковых команд, на которые (недочеты) указал пользователь stokb
//
// Скрипт производит поиск и выделение ближайшего заголовка или подзаголовка, набранного ЗАГЛАВНЫМИ БУКВАМИ (2 и более букв), "КАПС" (рус-лат) вниз по тексту.
//  _________________________________________________________________________

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

export default async function run(ctx) {
  const set = createRegExpSet();
  // -------------начало блока регэкспов (TaKir, 22.05.2025)---------------
  // 1) Ищем заголовки или подзаголовки ЗАГЛАВНЫМИ БУКВАМИ со знаками препинания в конце:
  // (in the original's string "\d" and "\s" are a plain "d" and "s", as JScript read them)
  set.addRegExp(
    String.raw`^(.*?)[A-ZА-ЯЁ]{2,}([-—–d.,;:'’?\!…«»()“”„s]){1,}(.*?)$`,
    '',
    {
      ru: 'Найдено: Заголовок ЗАГЛАВНЫМИ БУКВАМИ со знаками препинания в конце',
      en: 'Found: a title in CAPITAL LETTERS with punctuation at the end',
    },
    '+title',
  );
  set.addRegExp(
    String.raw`^(.*?)[A-ZА-ЯЁ]{2,}([-—–d.,;:'’?\!…«»()“”„s]){1,}(.*?)$`,
    '',
    {
      ru: 'Найдено: Подзаголовок ЗАГЛАВНЫМИ БУКВАМИ со знаками препинания в конце',
      en: 'Found: a subtitle in CAPITAL LETTERS with punctuation at the end',
    },
    '+subtitle',
  );
  // 2) Ищем заголовки или подзаголовки набранные ЗАГЛАВНЫМИ БУКВАМИ без знаков препинания в конце:
  set.addRegExp(
    String.raw`^(.*?)[A-ZА-ЯЁ]{2,}(.*?)$`,
    '',
    {
      ru: 'Найдено: Заголовок ЗАГЛАВНЫМИ БУКВАМИ без знаков препинания в конце',
      en: 'Found: a title in CAPITAL LETTERS without punctuation at the end',
    },
    '+title',
  );
  set.addRegExp(
    String.raw`^(.*?)[A-ZА-ЯЁ]{2,}(.*?)$`,
    '',
    {
      ru: 'Найдено: Подзаголовок ЗАГЛАВНЫМИ БУКВАМИ без знаков препинания в конце',
      en: 'Found: a subtitle in CAPITAL LETTERS without punctuation at the end',
    },
    '+subtitle',
  );
  // -------------конец блока регэкспов (TaKir, 22.05.2025)---------------
  return runRegExpSearch(ctx, set, { engine: 'current', returns: false });
}
