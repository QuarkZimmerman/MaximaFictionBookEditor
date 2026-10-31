// Converted from FictionBook Editor 2.7.9: Scripts/14_Цитаты/053_Поиск предположительных цитат (по встроенным регэкспам).js
// Looks for paragraphs that may be citations: a paragraph entirely in quotation marks, with or
// without punctuation and a footnote marker after them, and the start or the end of a citation
// running over several paragraphs (a «...» left open or closed) - in plain paragraphs only, not in
// citations, titles, subtitles, poems or epigraphs (stokber's list, 30.12.2022). Each run starts
// at the end of the selection - a caret one character on: a hit right at the caret is passed -
// and goes on to the end of the book, the book's annotation and history included when the run
// starts there; the first hit is selected and its description shown in the status bar. Nothing
// found: a message. The original's Run() returned nothing, nor does run(). The engine is
// lib/regexp-search.js (the original's, of Sclex's "Поиск по набору регэкспов"); to change the
// list, copy this folder into your scripts folder (Scripts > Open scripts folder), give the copy
// an id of its own in its script.json and edit init() below (its instructions are the
// original's, in Russian).
// Differences from the original: the hit is selected exactly where the expression matched and the
// search starts exactly at the end of the selection (the original moved IE's selection by its own
// character count, which was off after inline pictures - three placeholder characters in the text
// the expressions saw); the editor scrolls the hit into view (the original's scrollIfItNeeds is
// not reproduced). Fixed (FR-023): the message for a selected picture printed the words
// "sel.type" instead of the kind of selection; it says that a picture is selected.
// Notes: docs/scripting/notes-279-drafts/14.md.
// The original's notice, kept as written (FR-029):
// Скрипт "Поиск предположительных цитат".
// Версия 5.0
// Автор скрипта Sclex, набор RegExp-ов - TaKir, 18.10.2022
// Редакция на 18.10.2022.
// Переработанный список регекспов - Stokber, 30.12.2022
// Редакция на 18.10.2022.
  //  _________________________________________________________________________
  //  ВАЖНО!!!
  // Перед запуском данного скрипта лучше обработать текст скриптами "Генеральная уборка", "Расстановка елочек и лапок"
  // Тогда будет гораздо меньше лишних срабатываний.
  //  _________________________________________________________________________
  // ТУТ НАДО НАСТРОИТЬ СПИСОК МАКРОСОВ
  // addMacros("<имя>","регэксп");
  // Допустимые символы в имени: от "a" до "я", от "a" до "z", и символы "/","?","-","_"
  // В регэкспе можно использовать макросы, определенные до этого.
  // ТУТ НАДО НАСТРОИТЬ СПИСОК РЕГЭКСПОВ

import {
  createRegExpSet,
  notFoundMessage,
  prepareSearch,
  search,
  selectHit,
  t,
} from './lib/regexp-search.js';

// The descriptions in the English interface.
const EN = {
  'Найдено: Абзац, целиком заключенный в кавычки': 'Found: a paragraph entirely in quotation marks',
  'Найдено: Абзац, целиком заключенный в кавычки + знаки препинания в конце строки':
    'Found: a paragraph entirely in quotation marks + punctuation at the end of the line',
  'Найдено: Абзац, целиком заключенный в кавычки, + знаки препинания и маркер сноски в конце строки':
    'Found: a paragraph entirely in quotation marks + punctuation and a footnote marker at the end of the line',
  'Найдено: Абзац, целиком заключенный в кавычки + маркер сноски в конце строки':
    'Found: a paragraph entirely in quotation marks + a footnote marker at the end of the line',
  'Найдено: Абзац, целиком заключенный в кавычки + маркер сноски + знаки препинания в конце строки':
    'Found: a paragraph entirely in quotation marks + a footnote marker + punctuation at the end of the line',
  'Найдено: Начало цитаты из нескольких абзацев или непарная кавычка':
    'Found: the start of a citation of several paragraphs, or an unpaired quotation mark',
  'Найдено: Конец цитаты из нескольких абзацев или непарная кавычка':
    'Found: the end of a citation of several paragraphs, or an unpaired quotation mark',
};

// The original's list of expressions, kept as written (with its instructions and comments).
function init({ addMacros, addRegExp, tagRegExp }) {
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
  //  вложенных в <poem> и в <title>, но при этом не вложенных в <stanza>.
  //  Указывать имена инлайн-тегов не разрешено.
  // "Лимит для просмотра назад" – устанавливает максимальную длину подстроки,
  //  которая может быть найдена конструкцией (?<= ...) или (?= ...) данного
  //  регэкспа. Чем меньше значение данного параметра, тем быстрее будет 
  //  выполняться поиск. Чтобы искать без ограничения длины (самый медленный поиск),
  //  можно прописать значение 0 или undefined, или вообще не задавать параметр.
  // Пример:
  //  addRegExp("\\d-\\d","","Найдено: две цифры с дефисом между ними.");
  //  addRegExp("\"","","Найдено: прямая кавычка.");
  //  tagRegExp("(?<![а-яё])пего(?![а-яё])","i","Найдено: слово \"пего\" (\"него\" с опечаткой).");
  // Если надо, чтобы найденный текст не выделялся, а просто курсор стал
  // в позицию перед этим найденным текстом, используйте конструкцию (?= ... )
  //  addRegExp("(?=\")","","Найдено: прямая кавычка.");
  // Конструкции look behind, т.е. (?<! ...) и (?<= ...) разрешены только
  //   только в начале регэкспа и проверяются независимо от остальной части
  //   регэкспа. То есть (?<=а)б|в найдет не "б, перед которым а" либо "в",
  //   а "{б или в}, перед которым а".
  //  addRegExp("","i","Задайте список регэкспов, отредактировав скрипт в текстовом редакторе (кодировка UTF-8). Инструкция – в скрипте.");

  // Когда будете задавать свои регэкспы, сотрите или закомментируйте предыдущую строку.
  //   tagRegExp("(?<=[а-яё])<strong>[а-яё]+?</strong>","i","Найдено: курсив в слове.");
  //   tagRegExp("<strong>[а-яё]+?</strong>(?=[а-яё])","i","Найдено: курсив в слове.");
  // Команда   tagRegExp с аналогичным форматом ищет текст с учетом тегов.
  // В регэкспах команды   tagRegExp можно использовать макросы (см. выше).
  // Например: можно определить макрос строкой
  //   addMacros("<открывающий-emphasis-или-strong>","<emphasis>|<strong>");
  // И потом использовать его:
  //  tagRegExp("а<открывающий-emphasis-или-strong>б","i","Найдено: аб.");
  // Работают предопределенные макросы <emphasis>, </emphasis>, <strong>, </strong>,
  //   <sup>, </sup>, <sub>, </sub>, <strikethrough>, </strikethrough>,
  //   <code>, </code>, <любые-теги>


// -------------начало блока TaKir - регэкспы для поиска возможных цитат(TaKir, 18.10.2022)---------------

 
/*  var charB=new Array('"','«','„','“');
 var charE=new Array('"','»','”','”');

  addRegExp("^[\«|\"|\„|\“](.*?)[\»|\"|\„|\“]$","","Найдено: Абзац, целиком заключенный в кавычки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[\«|\"|\„|\“](.*?)[\»|\"|\„|\“][.!?…]$","","Найдено: Абзац, целиком заключенный в кавычки + знаки препинания в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[\«|\"|\„|\“](.*?)[\»|\"|\„|\“][.!?…]{1,}\\[.*?]{1,}$","","Найдено: Абзац, целиком заключенный в кавычки, + знаки препинания и маркер сноски в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[\«|\"|\„|\“](.*?)[\»|\"|\„|\“]\\[.*?]{1,}$","","Найдено: Абзац, целиком заключенный в кавычки + маркер сноски в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[\«|\"|\„|\“](.*?)[\»|\"|\„|\“]\\[.*?]{1,}[.!?…]$","","Найдено: Абзац, целиком заключенный в кавычки + маркер сноски + знаки препинания в конце строки","-cite -title -subtitle -stanza -poem -epigraph"); */

  
// -------------конец блока TaKir - регэкспы (18.10.2022):---------------

// -------------начало блока Stokber - регэкспы для поиска возможных цитат(Stokber, 30.12.2022)---------------


  var openQ="[«\"„“]"
  var closeQ="[»\"„“]"
  var punktMark="[.!?…]+"
  var marker="\\*+|\\d+|\\[.+\\]|\\{\\d+\\}"

  addRegExp("^("+openQ+")(.*)("+closeQ+")$","","Найдено: Абзац, целиком заключенный в кавычки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^("+openQ+")(.*)("+closeQ+")("+punktMark+")$","","Найдено: Абзац, целиком заключенный в кавычки + знаки препинания в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^("+openQ+")(.*)("+closeQ+")("+punktMark+")("+marker+")$","","Найдено: Абзац, целиком заключенный в кавычки, + знаки препинания и маркер сноски в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^("+openQ+")(.*)("+closeQ+")("+marker+")$","","Найдено: Абзац, целиком заключенный в кавычки + маркер сноски в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^("+openQ+")(.*)("+closeQ+")("+marker+")("+punktMark+")$","","Найдено: Абзац, целиком заключенный в кавычки + маркер сноски + знаки препинания в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  
  
  
  
  addRegExp("^«[^»]+$","","Найдено: Начало цитаты из нескольких абзацев или непарная кавычка","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[^«]+»$","","Найдено: Конец цитаты из нескольких абзацев или непарная кавычка","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[^«]+»("+punktMark+"|"+marker+")*$","","Найдено: Конец цитаты из нескольких абзацев или непарная кавычка","-cite -title -subtitle -stanza -poem -epigraph");
// -------------конец блока Stokber - регэкспы (30.12.2022):---------------
}

export default async function run(ctx) {
  const set = createRegExpSet();
  init(set);
  const ready = await prepareSearch(ctx, set);
  if (!ready) return;
  const { found } = await search(ctx, set, ready.book, ready.start, {
    engine: 'old',
    image: '~~~',
    decodeShy: true,
    finished: false,
    describe: (desc) => t(ctx, desc, EN[desc] ?? desc),
  });
  if (found) await selectHit(found);
  else await notFoundMessage(ctx);
}
