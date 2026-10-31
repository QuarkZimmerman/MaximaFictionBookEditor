// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/16_Скрипт-конструктор (поиск) - пример.js
// The example of the "Скрипт-конструктор (поиск)" template: its operations count the Russian
// letters, every letter of the Russian alphabet, the Latin letters, every Latin letter, and the
// spaces (ordinary, non-breaking - the original looked for "&nbsp;", which the text never holds,
// so it counts none - and others) in the text of the paragraphs of the book's annotation (not the
// history, as the settings below have it) and the bodies, then shows the original's statistics
// window. Nothing is changed. Add or edit operations in Opertiones() below.
// In the operations, new RegExp compiles like FictionBook Editor's JScript: \s and \S know only
// [ \f\n\r\t\v] (not U+00A0 nor the other Unicode spaces of JavaScript) and a ] right after [ or
// [^ belongs to the class; nbspEntity is "&nbsp;", as with FictionBook Editor's default setting.
// Differences: the window shows no proverb - the original added one from a list of wartime
// sayings, left out pending the requester's decision (Poslovitsa_on_off has no effect); the
// annotation and the history are read from the description, where the editor keeps them
// (FictionBook Editor showed them above the first body); an empty line counts as an empty
// paragraph, as it did there.
// The original's notice, kept as written (FR-029):
//======================================
//             «Скрипт-конструктор (поиск)» - пример
//  Предназначен для быстрого и удобного создания несложных скриптов по поиску в строках текста (без тегов).
//  * Раздел для добавления операций начинается сразу после "настроек";  чуть ниже шаблон операций  и  пояснения.
//  ** Скрипт создавался и тестировался в FBE 2.7.4, система win XP, IE8
//======================================
// v.1.0 — Создание оболочки скрипта — Александр Ка (12.08.2024)
// v.1.1 — Небольшое улучшение — Александр Ка (16.08.2024)
// Все полезные разделы перенесены в начало скрипта
// Добавлена возможность добавления операции с номером "0"
// v.1.2 — исправлена ошибка с невозможностью добавления области поиска — Александр Ка (22.08.2024)
//======================================
import { innerText, JScriptRegExp, paragraphsOf, showStatistics } from './search-builder.js';

// ---------------------------------------------------------------
                 ///  НАСТРОЙКИ

// ---------------------------------------------------------------

         //     Название скрипта

var NazvanieSkripta = "Скрипт-конструктор (поиск) - пример";      // текст //


         //     Номер версии скрипта

var NumerusVersion="1.2";      // текст //

// * Название и версия скрипта отображаются  в окне статистики

// ---------------------------------------------------------------

         //     Обработка текста внутри "Истории изменений файла"

var ObrabotkaHistory_on_off = 0;      // 0 ; 1 //      ("0" — отключить, "1" — включить)


         //     Обработка текста внутри аннотации к книге

var ObrabotkaAnnotation_on_off = 1;      // 0 ; 1 //      ("0" — отключить, "1" — включить)

// ---------------------------------------------------------------

         //     Ориентировочный максимум строк колонки в окне результатов.
//  Скрипт постарается не превышать это значение, и при необходимости добавит 1-2 колонки.
//  Максимальное число колонок — 3.

var Vysota_kolonki = 43;      // 12-46 //      Число строк в одной колонке.

// * При максимальной высоте колонки менее 12 строк возможны ошибки в оформлении.
// * 46 строк соответствует максимальной высоте окна для монитора 1024х768.

// ---------------------------------------------------------------

         //     Добавлять пословицу

var Poslovitsa_on_off = 1;      // 0 ; 1 //      ("0" — НЕ добавлять, "1" — добавлять)
// The proverb is left out pending the requester's decision: this setting has no effect.

// ---------------------------------------------------------------

         //     Демонстрационный режим
//  Включает присмотр всех возможных строк статистики.
//  Помогает находить ошибки в строках статистики, регулировать длину строки, расставлять ряд точек.

var VseStroki_on_off = 0;      // 0 ; 1 //      ("0" — отключить, "1" — включить)

// ---------------------------------------------------------------
// ----------------------------------------------

// ---------------------------------------------------------------
                 /// ОБЩИЕ ПЕРЕМЕННЫЕ

// The operations' new RegExp: compiled as FictionBook Editor's JScript compiled it.
// eslint-disable-next-line no-shadow-restricted-names, no-redeclare
const RegExp = JScriptRegExp;

//   Неразрывные пробелы:  ("+nbspEntity+") - для формулы поиска  ;
// (the editor keeps U+00A0; FictionBook Editor's default setting gave "&nbsp;")
let nbspChar = '\u00A0';
let nbspEntity = '&nbsp;';
void nbspChar;

let k = 0; //   Локальная переменная для небольших областей.
let s = ''; // Cтрока без тегов из параграфа <P>  (<P>строка</P>)
let count = []; // Счетчики
let re = []; // Регулярные выражения для поиска
let stroka_v_statistike = []; // Строки в статистике
let n; // Номер операции
let count_P = 0; // Счетчик строк
let title, history, stanza, poem, epigraph, annotation, cite, table, subtitle, text_author, text;
let nachalo = true;

// ---------------------------------------------------------------
                 /// ОПЕРАЦИИ

 function Opertiones() {

//  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 ///  Сюда можно добавлять новые операции по поиску.
//  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

   n = 0;
   if (nachalo) {
           re[n] = new RegExp("[А-ЯЁ]","gi");
           stroka_v_statistike[n] = "  Русские буквы  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 1;
   if (nachalo) {
           re[n] = new RegExp("А","gi");
           stroka_v_statistike[n] = "Буква А  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 2;
   if (nachalo) {
           re[n] = new RegExp("Б","gi");
           stroka_v_statistike[n] = "Буква Б  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 3;
   if (nachalo) {
           re[n] = new RegExp("В","gi");
           stroka_v_statistike[n] = "Буква В  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 4;
   if (nachalo) {
           re[n] = new RegExp("Г","gi");
           stroka_v_statistike[n] = "Буква Г  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 5;
   if (nachalo) {
           re[n] = new RegExp("Д","gi");
           stroka_v_statistike[n] = "Буква Д  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 6;
   if (nachalo) {
           re[n] = new RegExp("Е","gi");
           stroka_v_statistike[n] = "Буква Е  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 7;
   if (nachalo) {
           re[n] = new RegExp("Ё","gi");
           stroka_v_statistike[n] = "Буква Ё  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 8;
   if (nachalo) {
           re[n] = new RegExp("Ж","gi");
           stroka_v_statistike[n] = "Буква Ж .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 9;
   if (nachalo) {
           re[n] = new RegExp("З","gi");
           stroka_v_statistike[n] = "Буква З  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 10;
   if (nachalo) {
           re[n] = new RegExp("И","gi");
           stroka_v_statistike[n] = "Буква И  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 11;
   if (nachalo) {
           re[n] = new RegExp("Й","gi");
           stroka_v_statistike[n] = "Буква Й  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 12;
   if (nachalo) {
           re[n] = new RegExp("К","gi");
           stroka_v_statistike[n] = "Буква К  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 13;
   if (nachalo) {
           re[n] = new RegExp("Л","gi");
           stroka_v_statistike[n] = "Буква Л  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 14;
   if (nachalo) {
           re[n] = new RegExp("М","gi");
           stroka_v_statistike[n] = "Буква М  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 15;
   if (nachalo) {
           re[n] = new RegExp("Н","gi");
           stroka_v_statistike[n] = "Буква Н  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 16;
   if (nachalo) {
           re[n] = new RegExp("О","gi");
           stroka_v_statistike[n] = "Буква О  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 17;
   if (nachalo) {
           re[n] = new RegExp("П","gi");
           stroka_v_statistike[n] = "Буква П  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 18;
   if (nachalo) {
           re[n] = new RegExp("Р","gi");
           stroka_v_statistike[n] = "Буква Р  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 19;
   if (nachalo) {
           re[n] = new RegExp("С","gi");
           stroka_v_statistike[n] = "Буква С  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 20;
   if (nachalo) {
           re[n] = new RegExp("Т","gi");
           stroka_v_statistike[n] = "Буква Т  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 21;
   if (nachalo) {
           re[n] = new RegExp("У","gi");
           stroka_v_statistike[n] = "Буква У  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 22;
   if (nachalo) {
           re[n] = new RegExp("Ф","gi");
           stroka_v_statistike[n] = "Буква Ф  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 23;
   if (nachalo) {
           re[n] = new RegExp("Х","gi");
           stroka_v_statistike[n] = "Буква Х  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 24;
   if (nachalo) {
           re[n] = new RegExp("Ц","gi");
           stroka_v_statistike[n] = "Буква Ц  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 25;
   if (nachalo) {
           re[n] = new RegExp("Ч","gi");
           stroka_v_statistike[n] = "Буква Ч  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 26;
   if (nachalo) {
           re[n] = new RegExp("Ш","gi");
           stroka_v_statistike[n] = "Буква Ш .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 27;
   if (nachalo) {
           re[n] = new RegExp("Щ","gi");
           stroka_v_statistike[n] = "Буква Щ .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 28;
   if (nachalo) {
           re[n] = new RegExp("Ъ","gi");
           stroka_v_statistike[n] = "Буква Ъ  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 29;
   if (nachalo) {
           re[n] = new RegExp("Ы","gi");
           stroka_v_statistike[n] = "Буква Ы  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 30;
   if (nachalo) {
           re[n] = new RegExp("Ь","gi");
           stroka_v_statistike[n] = "Буква Ь  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 31;
   if (nachalo) {
           re[n] = new RegExp("Э","gi");
           stroka_v_statistike[n] = "Буква Э  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 32;
   if (nachalo) {
           re[n] = new RegExp("Ю","gi");
           stroka_v_statistike[n] = "Буква Ю .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 33;
   if (nachalo) {
           re[n] = new RegExp("Я","gi");
           stroka_v_statistike[n] = "Буква Я  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 100;
   if (nachalo) {
           re[n] = new RegExp("[A-Z]","gi");
           stroka_v_statistike[n] = "  Латинские буквы   .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 101;
   if (nachalo) {
           re[n] = new RegExp("A","gi");
           stroka_v_statistike[n] = "Буква A  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 102;
   if (nachalo) {
           re[n] = new RegExp("B","gi");
           stroka_v_statistike[n] = "Буква B  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 103;
   if (nachalo) {
           re[n] = new RegExp("C","gi");
           stroka_v_statistike[n] = "Буква C  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 104;
   if (nachalo) {
           re[n] = new RegExp("D","gi");
           stroka_v_statistike[n] = "Буква D  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 105;
   if (nachalo) {
           re[n] = new RegExp("E","gi");
           stroka_v_statistike[n] = "Буква E  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 106;
   if (nachalo) {
           re[n] = new RegExp("F","gi");
           stroka_v_statistike[n] = "Буква F  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 107;
   if (nachalo) {
           re[n] = new RegExp("G","gi");
           stroka_v_statistike[n] = "Буква G  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 108;
   if (nachalo) {
           re[n] = new RegExp("H","gi");
           stroka_v_statistike[n] = "Буква H  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 109;
   if (nachalo) {
           re[n] = new RegExp("I","gi");
           stroka_v_statistike[n] = "Буква I  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 110;
   if (nachalo) {
           re[n] = new RegExp("J","gi");
           stroka_v_statistike[n] = "Буква J  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 111;
   if (nachalo) {
           re[n] = new RegExp("K","gi");
           stroka_v_statistike[n] = "Буква K  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 112;
   if (nachalo) {
           re[n] = new RegExp("L","gi");
           stroka_v_statistike[n] = "Буква L  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 113;
   if (nachalo) {
           re[n] = new RegExp("M","gi");
           stroka_v_statistike[n] = "Буква M  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 114;
   if (nachalo) {
           re[n] = new RegExp("N","gi");
           stroka_v_statistike[n] = "Буква N  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 115;
   if (nachalo) {
           re[n] = new RegExp("O","gi");
           stroka_v_statistike[n] = "Буква O  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 116;
   if (nachalo) {
           re[n] = new RegExp("P","gi");
           stroka_v_statistike[n] = "Буква P  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 117;
   if (nachalo) {
           re[n] = new RegExp("Q","gi");
           stroka_v_statistike[n] = "Буква Q  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 118;
   if (nachalo) {
           re[n] = new RegExp("R","gi");
           stroka_v_statistike[n] = "Буква R  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 119;
   if (nachalo) {
           re[n] = new RegExp("S","gi");
           stroka_v_statistike[n] = "Буква S  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 120;
   if (nachalo) {
           re[n] = new RegExp("T","gi");
           stroka_v_statistike[n] = "Буква T  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 121;
   if (nachalo) {
           re[n] = new RegExp("U","gi");
           stroka_v_statistike[n] = "Буква U  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 122;
   if (nachalo) {
           re[n] = new RegExp("V","gi");
           stroka_v_statistike[n] = "Буква V  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 123;
   if (nachalo) {
           re[n] = new RegExp("W","gi");
           stroka_v_statistike[n] = "Буква W .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 124;
   if (nachalo) {
           re[n] = new RegExp("X","gi");
           stroka_v_statistike[n] = "Буква X  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 125;
   if (nachalo) {
           re[n] = new RegExp("Y","gi");
           stroka_v_statistike[n] = "Буква Y  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 126;
   if (nachalo) {
           re[n] = new RegExp("Z","gi");
           stroka_v_statistike[n] = "Буква Z  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 200;
   if (nachalo) {
           re[n] = new RegExp(nbspEntity+"|[            ​  ⁠　]","g");
           stroka_v_statistike[n] = "  Пробелы  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 201;
   if (nachalo) {
           re[n] = new RegExp(" ","g");
           stroka_v_statistike[n] = "Обычный пробел   .  .  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 202;
   if (nachalo) {
           re[n] = new RegExp(nbspEntity,"g");
           stroka_v_statistike[n] = "Неразрывный пробел  .  .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

   n = 203;
   if (nachalo) {
           re[n] = new RegExp("[           ​  ⁠　]","g");
           stroka_v_statistike[n] = "Другие виды пробелов   .  .  .  .  .  .  .  .  .	";
           }
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length;
           }

//  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

   }

  /* /// начало большого комментария

                 ///  ФОРМА ЗАПИСИ ДЛЯ ОПЕРАЦИИ ПОИСКА (шаблон)

   n = 0;   //  Номер операции
   if (nachalo) {
           re[n] = new RegExp("<Регулярное выражение для поиска>","g");
           stroka_v_statistike[n] = "<Текст в статистике>   .  .  .  .  .  .  .  .  .	";
           }
   if (annotation)      //  annotation, history, title, subtitle, poem, stanza, cite, epigraph, table, text_author, text
   if (s.search(re[n]) != -1) {
           count[n] += s.match(re[n]).length; // для статистики
           }

                 ///  ПОЯСНЕНИЯ

Для создания новой операции достаточно скопировать шаблон в подходящее место.
Добавить:  номер операции,  регулярное выражение  и  текст, который будет отображаться в статистике.
При необходимости:  указать область поиска  и  удалить лишнюю строку.

* Изменять скрипт лучше при включенном FBE, иначе если в скрипте окажется ошибка, то при запуске программы, FBE удалит этот скрипт из меню программы и панели скриптов.

•  n = 0;
В этой строке записывается строго уникальный номер для каждой операции.
Номер операции задается в промежутке от  0  до  999.

•  if (nachalo) {
Эта строка нужна для того, чтобы скрипт тысячу раз не присваивал одним и тем же переменным одни и те же значения.
Здесь ничего изменять не требуется.

•  re[n] = new RegExp("& Регулярное выражение для поиска","g");
В этой строке записывается регулярное выражение для поиска.
Записи регулярных выражений немного отличаются от записей, используемых для поиска в текстовых редакторах.
Вместо специального символа «\» здесь применяется удвоенный (или утроенный) символ:  «\\»  (или «\\\»).
Кроме того в регулярные выражения можно добавлять переменные, которые могут значительно расширить возможности поиска.
В первую очередь это касается неразрывного пробела, который в зависимости от настроек FBE, может принимать 4 разных значения.
Поэтому в регулярное выражение для поиска   вместо символа неразрывного пробела следует вставлять переменную ("+nbspEntity+").

Пример строки поиска:
(Буква или кавычки + тире + обычный или н/р пробел)
re[n] = new RegExp("([А-яA-Za-zЁё“»”\\\"])—(\\\s|"+nbspEntity+")","g");

•  stroka_v_statistike[n] = "<Текст в статистике>   .  .  .  .  .  .  .  .  .	";    };
В эту строку вписывается текст, который будет отображаться в статистике.
Для нормального отображения статистики  требуется, чтобы все ее строки были одинаковой длины.
Добиться этого можно сокращая или увеличивая строку.
Кроме того, чтобы все строки были идеально ровными, в конце должен стоять знак табуляции (Tab).
Проверить качество всех строк статистики можно включением демонстрационного режима.

•  if (annotation)
Эта строка определяет область поиска.
Внутрь скобок оператора условия «if» добавляется переменная, имя которой совпадает с названием раздела, в котором может быть  поиск.
Можно использовать следующие названия:
    annotation, history, title, subtitle, poem, stanza, cite, epigraph, table, text_author, text.
    (названием «text_author»  обозначается формат «text-author»)
    (названием «text»  обозначается текст без форматирования)
Если область поиска не должна включать в себя некий формат, то название предваряется оператором отрицания «!»
    например:  if (! annotation)
Если область поиска включает в себя несколько форматов, то названия следует записывать с использованием оператора логического сложения «||».
    например:  if (annotation  ||  epigraph)
Если область поиска НЕ включает в себя несколько форматов, то названия следует записывать с использованием оператора логического умножения «&&».
    например:  if (! annotation  &&  ! epigraph)
Если область поиска ничем не ограничена, то эта строка просто удаляется.

•  if (s.search(re[n]) != -1) {
Эта строка запускает поиск в тексте параграфа, и, если поиск результативен, то выполняются строки в фигурных скобках.
Здесь ничего изменять не требуется.

•  count[n] += s.match(re[n]).length;
Эта строка подсчитывает количество найденных фрагментов в строке, и добавляет это число к счетчику.
Здесь ничего изменять не требуется.

•  }
Последняя строка операции.

*/  /// конец комментария

export default async function run(ctx) {
  const Ts = new Date().getTime();
  k = 0;
  s = '';
  count = [];
  for (k = 0; k <= 999; k++) count[k] = 0; // Обнуление всех возможных счетчиков
  re = [];
  stroka_v_statistike = [];
  n = undefined;
  count_P = 0;
  nachalo = true;

  const snapshot = await mfbe.doc.get();
  const paragraphs = paragraphsOf(snapshot, { history: ObrabotkaHistory_on_off != 0, annotation: ObrabotkaAnnotation_on_off != 0 });
  for (let i = 0; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i];
    s = innerText(paragraph.node); //  получение текста параграфа (без внутренних тегов)
    count_P++; // Счетчик строк
    ({ title, history, stanza, poem, epigraph, annotation, cite, table, subtitle, text_author, text } = paragraph.flags);
    Opertiones(); //  Выполнение пользовательских операций
    nachalo = false;
    if (i % 200 === 0) await mfbe.ui.progress(i, paragraphs.length, ctx.script.name);
    if (ctx.cancelled) return;
  }

  await showStatistics(ctx, {
    name: NazvanieSkripta,
    version: NumerusVersion,
    column: Vysota_kolonki,
    all: VseStroki_on_off,
    started: Ts,
    count_P,
    count,
    stroka: stroka_v_statistike,
  });
}
