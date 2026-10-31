// Converted from FictionBook Editor 2.7.9: Scripts/14_Цитаты/054_Расширенный поиск предположительных цитат.js
// Looks for paragraphs that may be citations (stokber's extended list): a paragraph in
// guillemets «...» throughout (with or without punctuation and a footnote marker after them), a
// line wholly in italics or bold, a paragraph in CAPITAL letters, a letter's closing ("С
// уважением..."), the start or the end of a citation over several paragraphs - and the paragraph
// that follows a line ending with a stop word and a colon ("Надпись гласила:"). Passed over: a
// paragraph with guillemets inside, punctuation followed by a dash in an italic or bold line, a
// line of dialogue, and the paragraphs of citations, titles, subtitles, poems and epigraphs.
// Each run starts at the end of the selection and goes on to the end of the book, the book's
// annotation and history included when the run starts there; the first hit is selected and its
// description shown in the status bar. A stop word's line is not selected: the search goes on
// with the next paragraph of two characters or more and selects that one, unless it lies in a
// citation, a stanza, a poem, a title or an epigraph, or looks like a line of dialogue - then the
// main search goes on after it. Nothing found: "Поиск завершен!" in the status bar, the
// selection collapsed where the last search started, and a message. The original's Run() returned
// nothing, nor does run(). The engine is lib/regexp-search.js with lib/extended-search.js; to
// change the lists, copy this folder into your scripts folder (Scripts > Open scripts folder),
// give the copy an id of its own in its script.json and edit init1() and init2() below (their
// instructions are the original's, in Russian).
// Differences from the original: the hit is selected exactly where the expression matched and the
// search starts exactly at the end of the selection (the original moved IE's selection by its own
// character count, which was off after inline pictures - three placeholder characters in the text
// the expressions saw - and soft hyphens, which it did not decode); the editor scrolls the hit into
// view (the original's scrollIfItNeeds is not reproduced); a run in which Run1 and Run2 call each
// other many times is a loop, not a recursion. Fixed (FR-023): the message for a selected picture
// printed the words "sel.type" instead of the kind of selection; it says that a picture is
// selected. Notes: docs/scripting/notes-279-drafts/14.md.
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск предположительных цитат» для редактора Fiction Book Editor (FBE).
// Версия 1.42.
// Автор Sclex.
// Идеи скрипта и регекспов TaKir.
// Регекспы, костыли и протезы - stokber.
 // -------------------------------------------
  //Скрипт будет останавливаться на абзацах расположенных
  //  после строк со стоп-словами и двоеточиями в конце:

import { runExtendedSearch } from './lib/extended-search.js';

// The stop words of the original, kept as written.
/*  //  С этими словами строка будет пропускаться:
    var exceptWord = 'Глава'+
'|Часть'+
'|Книга'+
'|Повесть'+
'|Рассказ'+
'|Предисловие'+
'|Послесловие'+
'|От[\\x20\\xA0]автора'+
'|Пролог'+
'|Эпилог'+
'|Анонс'+
'|Введение'+
'|Вступление'+
'|Заключение'; */

  //Скрипт будет останавливаться на абзацах расположенных
  //  после строк со стоп-словами и двоеточиями в конце:
  // стоп-слова:
    var stopWord = 'табличк(а|е|и|ой)'+
'|таблиц(а|е|ы|ей|у)'+
'|вывеск(а|е|и|ой|у)'+
'|надпис(ью?|и|ей|)'+
'|сообщени(ем?|и|ю|я)'+
'|строк(а|е|и|ой|у)?'+
'|заголов(ок|к(а|у|е|ом))'+
'|написал(а|и)?'+
'|написано'+
'|гласил(а|и|о)?'+
'|текст(а|е|у|ом)?'+
'|смс'+
'|смс[-]к(а|е|и|ой|у)'+
'|письм(о|а|е|у|ом)'+
'|новост(ью?|и)'+
'|послани(ем?|и|ю|я)'+
'|записк(а|е|и|ой|у)'+
'|ясно';

    var stopWord2 = 'букв(ами)?'+
'|радио'+
'|голос(а|е|ом|у)?'+
'|слов(ах?|ом?|е|у|ами?)?'+
'|фраз(а|е|у|ы)?'+
'|подпис(ью?|и)'+
'|запис(ью?|и)'+
'|объявлени(ем?|и|й|ю|я(х|ми?))'+
'|прочитал(а|и)?'+
'|услышал(а|и)?'+
'|перевод(а|е|у|ом)?'+
'|телефон(а|е|у|а|ом)?'+
'|информаци(и|я|ю|ей)'+
'|журнал(а[мх]?|е|у|о[вм])?'+
'|сообщал(а|и|о(сь)?)?'+
'|газет(е|ах?|ами?|у|ы|ой|)?'+
'|заметк(а|е|и|у|ой)';

// The descriptions in the English interface (the status bar shows the Russian ones in Russian).
const EN = {
  'Пропустить: Абзац с внутренними ёлочками': 'Skipped: a paragraph with guillemets inside',
  'Пропустить: нехарактерные для цитат сочетания знаков препинания':
    'Skipped: punctuation that citations do not have',
  'Найдено: курсивная или жирная строка': 'Found: a line in italics or bold',
  'Найдено: Абзац, целиком заключенный в кавычки': 'Found: a paragraph entirely in quotation marks',
  'Найдено: Абзац, целиком заключенный в кавычки + знаки препинания в конце строки':
    'Found: a paragraph entirely in quotation marks + punctuation at the end of the line',
  'Найдено: Абзац, целиком заключенный в кавычки и маркер сноски в конце строки':
    'Found: a paragraph entirely in quotation marks and a footnote marker at the end of the line',
  'Найдено: Абзац, целиком заключенный в кавычки + знаки препинания + маркер сноски в конце строки':
    'Found: a paragraph entirely in quotation marks + punctuation + a footnote marker at the end of the line',
  'Найдено: Абзац, целиком заключенный в кавычки + маркер сноски + знаки препинания в конце строки':
    'Found: a paragraph entirely in quotation marks + a footnote marker + punctuation at the end of the line',
  'Стоп-слово: Абзац после строки со стоп-словом и двоеточием в конце.':
    'Stop word: the paragraph after a line that ends with a stop word and a colon.',
  'Найдено: абзац целиком ЗАГЛАВНЫМИ буквами': 'Found: a paragraph entirely in CAPITAL letters',
  'Найдено: возможно цитата': 'Found: possibly a citation',
  'Найдено: Начало цитаты из нескольких абзацев или непарная кавычка':
    'Found: the start of a citation of several paragraphs, or an unpaired quotation mark',
  'Найдено: Конец цитаты из нескольких абзацев или непарная кавычка':
    'Found: the end of a citation of several paragraphs, or an unpaired quotation mark',
  DIVs: 'DIVs',
  'Найдено: Абзац после строки со стоп-словом и двоеточием в конце':
    'Found: the paragraph after a line that ends with a stop word and a colon',
};

// Run1's list of expressions, kept as written (with its instructions and comments).
function init1({ addMacros, addRegExp, tagRegExp }) {

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

  addMacros("<откр-закр-em-str>","<emphasis>|</emphasis>|<strong>|</strong>");
  // addMacros("<тэги-кроме-IMG-и-закр-A>","(<(?!IMG)(?!/A\>)/?[A-Za-z]+[^\>]*>)*");
  // addMacros("<впереди-нет-закр-A>","(?![^\<\>]*(<(?!A[ \>])/?[A-Za-z]+(/s+[^\>]+)?\>)*[^\<\>]*</A>)");
  // addMacros("<мы-не-внутри-тэга>","(^|\>)[^\<]*");
  // addMacros("<впереди-закр-тэги-но-не-A>","(</?(?!A>)[A-Za-z]+(/s+[^>]+)?>)*");
  // addMacros("<пустота-теги-или-ничего>","([\\x20\\xA0]|<(?!IMG)(?!/A\>)/?[A-Za-z]+[^\>]*>)*");

  // addMacros("<сокращения>","(т<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>д|т<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>п|т<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>к|т<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>е|т<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>о|т<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>ч|Р<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>Х|т<тэги-кроме-IMG-и-закр-A>ы<тэги-кроме-IMG-и-закр-A>с<тэги-кроме-IMG-и-закр-A>|м<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>н<тэги-кроме-IMG-и-закр-A>|ч<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>|э<тэги-кроме-IMG-и-закр-A>к<тэги-кроме-IMG-и-закр-A>з<тэги-кроме-IMG-и-закр-A>|р<тэги-кроме-IMG-и-закр-A>у<тэги-кроме-IMG-и-закр-A>б<тэги-кроме-IMG-и-закр-A>|к<тэги-кроме-IMG-и-закр-A>о<тэги-кроме-IMG-и-закр-A>п<тэги-кроме-IMG-и-закр-A>|н<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>м<тэги-кроме-IMG-и-закр-A>|и<тэги-кроме-IMG-и-закр-A>с<тэги-кроме-IMG-и-закр-A>п<тэги-кроме-IMG-и-закр-A>|л<тэги-кроме-IMG-и-закр-A>а<тэги-кроме-IMG-и-закр-A>т<тэги-кроме-IMG-и-закр-A>|а<тэги-кроме-IMG-и-закр-A>в<тэги-кроме-IMG-и-закр-A>т<тэги-кроме-IMG-и-закр-A>|р<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>д<тэги-кроме-IMG-и-закр-A>|о<тэги-кроме-IMG-и-закр-A>б<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>|ц<тэги-кроме-IMG-и-закр-A>и<тэги-кроме-IMG-и-закр-A>т<тэги-кроме-IMG-и-закр-A>|р<тэги-кроме-IMG-и-закр-A>у<тэги-кроме-IMG-и-закр-A>к<тэги-кроме-IMG-и-закр-A>|м<тэги-кроме-IMG-и-закр-A>и<тэги-кроме-IMG-и-закр-A>н<тэги-кроме-IMG-и-закр-A>|с<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>к<тэги-кроме-IMG-и-закр-A>|с<тэги-кроме-IMG-и-закр-A>т<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|м<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>д<тэги-кроме-IMG-и-закр-A>|т<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>н<тэги-кроме-IMG-и-закр-A>|с<тэги-кроме-IMG-и-закр-A>о<тэги-кроме-IMG-и-закр-A>к<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|д<тэги-кроме-IMG-и-закр-A>о<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>|п<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>о<тэги-кроме-IMG-и-закр-A>ч<тэги-кроме-IMG-и-закр-A>|а<тэги-кроме-IMG-и-закр-A>н<тэги-кроме-IMG-и-закр-A>г<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>|п<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>и<тэги-кроме-IMG-и-закр-A>м<тэги-кроме-IMG-и-закр-A>|п<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>в<тэги-кроме-IMG-и-закр-A>|в<тэги-кроме-IMG-и-закр-A>в<тэги-кроме-IMG-и-закр-A>|д<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|г<тэги-кроме-IMG-и-закр-A>о<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|г<тэги-кроме-IMG-и-закр-A>г<тэги-кроме-IMG-и-закр-A>|д<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|п<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|г<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|с<тэги-кроме-IMG-и-закр-A>м<тэги-кроме-IMG-и-закр-A>|с<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|ф<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|м<тэги-кроме-IMG-и-закр-A>м<тэги-кроме-IMG-и-закр-A>|к<тэги-кроме-IMG-и-закр-A>г<тэги-кроме-IMG-и-закр-A>|у<тэги-кроме-IMG-и-закр-A>л<тэги-кроме-IMG-и-закр-A>|с<тэги-кроме-IMG-и-закр-A>т<тэги-кроме-IMG-и-закр-A>|г<тэги-кроме-IMG-и-закр-A>|в<тэги-кроме-IMG-и-закр-A>|П<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>и<тэги-кроме-IMG-и-закр-A>м<тэги-кроме-IMG-и-закр-A>|П<тэги-кроме-IMG-и-закр-A>е<тэги-кроме-IMG-и-закр-A>р<тэги-кроме-IMG-и-закр-A>|С<тэги-кроме-IMG-и-закр-A>м<тэги-кроме-IMG-и-закр-A>|н<тэги-кроме-IMG-и-закр-A>\\.<пустота-теги-или-ничего>э)");
  
	//---------------------------------------------------------------------------------------------------------
  // Начало регекспов:

// это не срабатывает:
  // addRegExp("^«(.*?[^а-яё])?("+exceptWord+")(?![а-яё]).*»$","","Пропустить: слова-исключения в закавыченном абзаце","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^«.*?[«»].*»$","","Пропустить: Абзац с внутренними ёлочками","-cite -title -subtitle -stanza -poem -epigraph");
 //// addRegExp("^[-—–][\\x20\\xA0]{0,2}.+$","","Пропустить: Реплика диалога","-cite -title -subtitle -stanza -poem -epigraph");
  // addRegExp("^[-—–][^a-zа-яё]+$","","Пропустить: Реплика диалога в абзаце из Заглавных букв","-cite -title -subtitle -stanza -poem -epigraph");
  // addRegExp("^«.+?[.,:!?][\\x20\\xA0]{0,2}[-—–].+?»((\\[|\\{)\\d+(\\]|\\}))?$","","Пропустить: нехарактерные для цитат сочетания знаков препинания в закавыченном абзаце","-cite -title -subtitle -stanza -poem -epigraph");
  // addRegExp("^[^a-zа-яё]+?[.,:!?][\\x20\\xA0]{0,2}[-—–][^a-zа-яё]+$","","Пропустить: нехарактерные для цитат сочетания знаков препинания в абзаце из Заглавных букв","-cite -title -subtitle -stanza -poem -epigraph");
  tagRegExp("^(<откр-закр-em-str>)+.+?([.,:!?][\\x20\\xA0]{0,2}[—–-]).+(<откр-закр-em-str>)+$","i","Пропустить: нехарактерные для цитат сочетания знаков препинания","-cite -title -subtitle -stanza -poem -epigraph");
 //// addRegExp("^.+?[.,:!?][\\x20\\xA0]{0,2}[-—–].+?$","","Пропустить: нехарактерные для цитат сочетания знаков препинания в закавыченном абзаце","-cite -title -subtitle -stanza -poem -epigraph");
 //// tagRegExp("^(<откр-закр-em-str>)+[-—–].+(<откр-закр-em-str>)+$","i","Пропустить: предположительно реплика диалога","-cite -title -subtitle -stanza -poem -epigraph");
  // tagRegExp("^(<откр-закр-em-str>)+.*([.,:!?](\\\s|"+nbspEntity+"){0,2}[-—–]).*(<откр-закр-em-str>)+$","i","Найти: нехарактерные для цитат (болдом или курсивом) сочетания знаков препинания","-cite -title -subtitle -stanza -poem -epigraph");
////  addRegExp("^.*[^а-яё]?("+exceptWord+")[^а-яё]?.*$","i","Пропустить: слово-исключение, предположительно заголовок","-cite -title -subtitle -stanza -poem -epigraph");
 ////   tagRegExp("^(<откр-закр-em-str>)+«(.*[^а-яё])?("+exceptWord+")(?![а-яё]).*?»(<откр-закр-em-str>)+$","i","Пропустить: слово-исключение в курсивной или болдовой строке, предположительно заголовок","-cite -title -subtitle -stanza -poem -epigraph");
  ////  addRegExp("^.*?[^а-яё]?("+exceptWord+")(?![а-яё]).*?$","i","Пропустить: слово-исключение, предположительно заголовок","-cite -title -subtitle -stanza -poem -epigraph");
////  tagRegExp("^(<откр-закр-em-str>)+(.*?[^а-яё])?("+exceptWord+")(?![а-яё]).*?(<откр-закр-em-str>)+$","i","Пропустить: слово-исключение в курсивной или болдовой строке, предположительно заголовок","-cite -title -subtitle -stanza -poem -epigraph");
  tagRegExp("^(<откр-закр-em-str>)+?[^—–-].*?(<откр-закр-em-str>)+?$","i","Найдено: курсивная или жирная строка","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^«[^«»]+?»$","","Найдено: Абзац, целиком заключенный в кавычки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^«[^«»]+?»[.!?]$","","Найдено: Абзац, целиком заключенный в кавычки + знаки препинания в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^«[^«»]+?»(\\[|\\{)\\d+(\\]|\\})$","","Найдено: Абзац, целиком заключенный в кавычки и маркер сноски в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^«[^«»]+?»[.!?](\\[|\\{)\\d+(\\]|\\})$","","Найдено: Абзац, целиком заключенный в кавычки + знаки препинания + маркер сноски в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^«[^«»]+?»(\\[|\\{)\\d+(\\]|\\})[.!?]$","","Найдено: Абзац, целиком заключенный в кавычки + маркер сноски + знаки препинания в конце строки","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("(?<![а-яё])("+stopWord+"):[\\x20\\xA0]*$","i","Стоп-слово: Абзац после строки со стоп-словом и двоеточием в конце.","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("(?<![а-яё])("+stopWord2+"):[\\x20\\xA0]*$","i","Стоп-слово: Абзац после строки со стоп-словом и двоеточием в конце.","-cite -title -subtitle -stanza -poem -epigraph");
  
  // addRegExp("(?=[^а-яё]"+stopWord+":[\\x20\\xA0]*)$","i","Стоп-слово: Абзац после строки со стоп-словом и двоеточием в конце.","-cite -title -subtitle -stanza -poem -epigraph");
  // addRegExp("(?=[^а-яё]"+stopWord2+":[\\x20\\xA0]*)$","i","Стоп-слово: Абзац после строки со стоп-словом и двоеточием в конце.","-cite -title -subtitle -stanza -poem -epigraph");
  
  // addRegExp("[a-zа-яё]+:$","i","Найдено: Абзац с двоеточием в конце строки. Возможно, следующий абзац — цитата","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[^a-zA-Zа-яА-ЯёЁ]*([A-ZА-ЯЁ][^a-zA-Zа-яА-ЯёЁ]*){2,}$","","Найдено: абзац целиком ЗАГЛАВНЫМИ буквами","-cite -title -subtitle -stanza -poem -epigraph");
    // addRegExp("^[^a-zA-Zа-яА-ЯёЁ]*([A-ZА-ЯЁ](?![A-ZА-ЯЁ])[^a-zA-Zа-яА-ЯёЁ]*)+$","","Найдено: абзац целиком ЗАГЛАВНЫМИ буквами","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^(С уважением|Искренне ваш|С наилучшими пожеланиями|С любовью).+$","i","Найдено: возможно цитата","-cite -title -subtitle -stanza -poem -epigraph");
  
    var punktMark="[.!?…]+"
    var marker="\\*+|\\d+|\\[.+\\]|\\{\\d+\\}"
  addRegExp("^«[^»]+$","","Найдено: Начало цитаты из нескольких абзацев или непарная кавычка","-cite -title -subtitle -stanza -poem -epigraph");
  
  // Для игнорирования конечной части предполагаемой цитаты закомментируйте два следующих регекспа.
  addRegExp("^[^«]+»$","","Найдено: Конец цитаты из нескольких абзацев или непарная кавычка","-cite -title -subtitle -stanza -poem -epigraph");
  addRegExp("^[^«]+»("+punktMark+"|"+marker+")*$","","Найдено: Конец цитаты из нескольких абзацев или непарная кавычка","-cite -title -subtitle -stanza -poem -epigraph");

  // Конец регекспов.
  // ===============================================================
}

// Run2's list: the paragraph after a stop word's line.
function init2({ addMacros, addRegExp, tagRegExp }) {
  addMacros("<откр-закр-em-str>","<emphasis>|</emphasis>|<strong>|</strong>");
  addMacros("<тэги-кроме-IMG-и-закр-A>","(<(?!IMG)(?!/A\>)/?[A-Za-z]+[^\>]*>)*");
  // addMacros("<впереди-нет-закр-A>","(?![^\<\>]*(<(?!A[ \>])/?[A-Za-z]+(/s+[^\>]+)?\>)*[^\<\>]*</A>)");
  // addMacros("<мы-не-внутри-тэга>","(^|\>)[^\<]*");
  // addMacros("<впереди-закр-тэги-но-не-A>","(</?(?!A>)[A-Za-z]+(/s+[^>]+)?>)*");
  // addMacros("<пустота-теги-или-ничего>","([\\x20\\xA0]|<(?!IMG)(?!/A\>)/?[A-Za-z]+[^\>]*>)*");
	//---------------------------------------------------------------------------------------------------------
  // Начало регекспов:

  addRegExp("^.+$","i","DIVs","+cite");
  addRegExp("^.+$","i","DIVs","+stanza");
  addRegExp("^.+$","i","DIVs","+poem");
  addRegExp("^.+$","i","DIVs","+title");
  addRegExp("^.+$","i","DIVs","+epigraph");
  addRegExp("^..+$","","Найдено: Абзац после строки со стоп-словом и двоеточием в конце");

  // Конец регекспов поиска строки после стоп-слова.
  // ===============================================================
}

export default async function run(ctx) {
  await runExtendedSearch(ctx, init1, init2, EN);
}
