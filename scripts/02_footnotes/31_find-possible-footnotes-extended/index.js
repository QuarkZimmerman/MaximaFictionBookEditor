// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/31_Расширенный поиск возможных сносок.js
// Searches for places that look like footnotes not marked up yet: a "]" or (outside subtitles)
// a "*" at the start of a paragraph, an asterisk or an opening bracket right after a letter, a
// digit or a punctuation mark, and one to four digits stuck to a letter or a punctuation mark.
// The search goes paragraph by paragraph from the end of the selection to the end of the book
// (regexp-set.js, engine 'current', the one of group 16, copied unchanged): the earliest match
// in the first paragraph with one is selected and its description shown in the status bar; at
// the end "Поиск завершен!" and a message. Like the original's, run() returns nothing.
// The expressions as JScript read the original's strings: "^[\]]" was "^[]]", which JScript (like
// Perl) took for a "]" at the start; it is written "^[\]]" here, its JavaScript form.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск по набору регэкспов (разрывы абзацев)» для редактора Fiction Book Editor (FBE).
// Версия 1.2
// Автор Sclex, набор RegExp-ов - TaKir, Sclex, 21.11.2022
// Редакция на 22.11.2024.
//  _________________________________________________________________________
  // ТУТ НАДО НАСТРОИТЬ СПИСОК МАКРОСОВ
  // addMacros("<имя>","регэксп");
  // Допустимые символы в имени: от "a" до "я", от "a" до "z", и символы "/","?","-","_"
  // В регэкспе можно использовать макросы, определенные до этого.
  // ТУТ НАДО НАСТРОИТЬ СПИСОК РЕГЭКСПОВ
  // Каждый регэксп настраивается строкой такого формата:
  //  addRegExp("регэксп","ключи","описание","в каких тегах искать","лимит для просмотра назад");
  // Слеши \ в регэкспе надо удвоить
  // Если регэксп содержит прямые кавычки, перед ними надо поставить слеш: \"
  // (этот слеш перед кавычкой не надо удваивать)
  // "Ключ" (пока) поддерживается только один:
  //   i – поиск без учета регистра (case Insensitive)
  // По умолчанию поиск происходит с учетом регистра
  // "Описание" – это текст, который выведется в строке статуса, когда
  //  по регэкспу будет что-то найдено
  // "В каких тегах искать" – параметр должен содержать сочетания
  //  "плюс или минус, потом имя элемента", разделенные пробелом.
  //  К примеру, если этот параметр имеет значение "+poem -stanza +title",
  //  то скрипт будет искать по регэкспу только в абзацах P,

import { createRegExpSet, runRegExpSearch } from './regexp-set.js';

const BEFORE = String.raw`([A-Za-zА-яЁё…,;.»"!?:%“™”©\)])`;

export default async function run(ctx) {
  const set = createRegExpSet();
  // -------------начало блока TaKir - регэкспы (TaKir, 22.11.2024)---------------
  set.addRegExp(String.raw`^[\]]`, '', { ru: 'Найдено: скобки в начале строки', en: 'Found: a bracket at the start of the line' });
  set.addRegExp(String.raw`^[\*]`, '', { ru: 'Найдено: звездочки в начале строки', en: 'Found: asterisks at the start of the line' }, '-subtitle');
  set.addRegExp(String.raw`([A-Za-zА-яЁё0-9…,;.»"!?:%“™”©\)])[[*]`, '', {
    ru: 'Найдено: звездочки или скобки после букв, цифр и знаков препинания',
    en: 'Found: asterisks or brackets after letters, digits and punctuation marks',
  });
  set.addRegExp(String.raw`${BEFORE}([0-9])([0-9])([0-9])([0-9])`, '', { ru: 'Найдено: 4 цифры, прилипшие к словам', en: 'Found: 4 digits stuck to words' });
  set.addRegExp(String.raw`${BEFORE}([0-9])([0-9])([0-9])`, '', { ru: 'Найдено: 3 цифры, прилипшие к словам', en: 'Found: 3 digits stuck to words' });
  set.addRegExp(String.raw`${BEFORE}([0-9])([0-9])`, '', { ru: 'Найдено: 2 цифры, прилипшие к словам', en: 'Found: 2 digits stuck to words' });
  set.addRegExp(String.raw`${BEFORE}([0-9])`, '', { ru: 'Найдено: 1 цифра, прилипшая к словам', en: 'Found: 1 digit stuck to words' });
  // -------------конец блока TaKir - регэкспы (TaKir, 22.11.2024)---------------
  await runRegExpSearch(ctx, set, { engine: 'current', returns: false });
}
