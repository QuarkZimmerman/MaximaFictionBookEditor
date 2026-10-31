// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/15_Скрипт-конструктор (поиск).js
// A template for your own counting searches. Add operations to Opertiones() below (the original's
// instructions follow it, in Russian): each counts the matches of a regular expression in the text
// of the paragraphs (without tags), optionally only in some kinds of paragraphs (annotation,
// history, title, subtitle, poem, stanza, cite, epigraph, table, text_author, text). The run goes
// through the book's annotation and the document's history (as the settings below have it) and the
// bodies, then shows the original's statistics window - run time, number of lines, every
// operation's count. As shipped it has no operations. Nothing is changed.
// In the operations, new RegExp compiles like FictionBook Editor's JScript: \s and \S know only
// [ \f\n\r\t\v] (not U+00A0 nor the other Unicode spaces of JavaScript) and a ] right after [ or
// [^ belongs to the class; nbspEntity is "&nbsp;", as with FictionBook Editor's default setting
// (the text the operations see holds the non-breaking space itself, U+00A0).
// Differences: the window shows no proverb - the original added one from a list of wartime
// sayings, left out pending the requester's decision (Poslovitsa_on_off has no effect); the
// annotation and the history are read from the description, where the editor keeps them
// (FictionBook Editor showed them above the first body); an empty line counts as an empty
// paragraph, as it did there.
// The original's notice, kept as written (FR-029):
//======================================
//             «Скрипт-конструктор (поиск)»
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

var NazvanieSkripta = "Скрипт-конструктор (поиск)";      // текст //


         //     Номер версии скрипта

var NumerusVersion="1.2";      // текст //

// * Название и версия скрипта отображаются  в окне статистики

// ---------------------------------------------------------------

         //     Обработка текста внутри "Истории изменений файла"

var ObrabotkaHistory_on_off = 1;      // 0 ; 1 //      ("0" — отключить, "1" — включить)


         //     Обработка текста внутри аннотации к книге

var ObrabotkaAnnotation_on_off = 1;      // 0 ; 1 //      ("0" — отключить, "1" — включить)

// ---------------------------------------------------------------

         //     Ориентировочный максимум строк колонки в окне результатов.
//  Скрипт постарается не превышать это значение, и при необходимости добавит 1-2 колонки.
//  Максимальное число колонок — 3.

var Vysota_kolonki = 37;      // 12-46 //      Число строк в одной колонке.

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
