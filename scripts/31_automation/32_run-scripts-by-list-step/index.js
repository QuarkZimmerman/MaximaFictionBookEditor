// Converted from FictionBook Editor 2.7.9: Scripts/31_Автоматизация/32_Запуск скриптов по списку_(ПОШАГОВЫЙ вариант).js
// A template: runs the scripts its list names one after another, each on the selection the previous
// one left, in one run (Sclex's "Запуск скриптов по списку", step-by-step form). The list is meant to
// be edited - see HOW TO EDIT THE LIST below. As shipped it is the original's example: select the
// next epigraph after the selection (16/next-epigraph), make its paragraphs bold
// (19/paragraphs-to-bold) and italic (19/paragraphs-to-italics), then remove the block formatting
// around the start of the selection (18/unwrap-poem-cite-epigraph, "Снять форматирование блочным
// элементом": the epigraph and the epigraphs and annotation that follow it become plain paragraphs;
// a poem's epigraph dissolves the poem). As in 2.7.9 the list runs whatever the first script returns:
// when no epigraph follows, the other three work on the selection as it is.
// Fix: the original names "\\19_Обработка форматирования\\50_Перейти на следующий эпиграф.js", a file
// 2.7.9 does not have; the script meant is 16_Поиск форматирования\\150_Выделить следующий
// эпиграф.js (the original's own instructions name it "16_Поиск форматирования\\50_Перейти на
// следующий эпиграф.js", its earlier file). In 2.7.9 the list said "Скрипт ... не был запущен ..."
// and then formatted the caret's paragraph and removed the block formatting around the caret; here
// it selects the next epigraph first.
// Differences from 2.7.9: the whole run is one undo step under this script's name, and one Cancel
// stops it and leaves the book as it was (each script of the original's list made an undo step of
// its own); the original's scriptsFolder(...) and its message for a list without it are gone (the
// editor knows its scripts); the message for a script that is not found names the path as the list
// writes it, not as a path on the disk. Everything else is the behaviour of the scripts the list
// runs, with their own recorded differences.
// HOW TO EDIT THE LIST (the original's instructions above, for this editor; in Russian below).
//   Copy this script's folder into your own scripts folder (Scripts > Open scripts folder) and edit
//   index.js of the copy: with this script's id the copy replaces it in the menu, with an id and a
//   name of its own it appears next to it (docs/scripting/en.md, section 1); then Scripts > Reload
//   scripts. The list is the code between the two "======================" lines of run() below.
//   Each command runs one script of the Scripts menu, named by its FictionBook Editor path (the
//   legacy.source of its script.json; backslashes or slashes, letter case and a leading backslash do
//   not count) or by its id, and gives back what that script returns:
//     await runScriptInFolder("16_Поиск форматирования\\150_Выделить следующий эпиграф.js");
//     await runScriptInFolder("19/paragraphs-to-italics");
//   runScriptInFolder is mfbe.scripts.run with the original's message for a script that is not found
//   (the list then goes on); runScript is the same command, and it also takes a whole path of the
//   original's installation ("C:\\Program Files\\FBE\\Scripts\\06_Чистка\\..."). The editor finds
//   its scripts itself: the original's scriptsFolder(...) line is not needed. Write await before
//   each command.
//   1) Step by step: the commands run one after another, each on the selection the previous script
//      left - select the next epigraph, then format its paragraphs:
//        await runScriptInFolder("16_Поиск форматирования\\150_Выделить следующий эпиграф.js");
//        await runScriptInFolder("19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
//   2) In the whole document: a loop that goes on while a script that selects (or goes to) the next
//      element returns "Found" - the "Выделить следующий ..." and "Перейти на следующий ..." scripts
//      of group 16 return "Found" or "NotFound"; the braces hold the commands of each round:
//        while ((await runScriptInFolder("16_Поиск форматирования\\152_Выделить следующую цитату.js")) === "Found") {
//          await runScriptInFolder("19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
//        }
//      For different elements write one loop each, and put the caret at the start of the document
//      before each loop:
//        await runScriptInFolder("34_Управление курсором либо выделением\\001_Установить курсор в начало документа.js");
//      The "Перейти на ..." scripts of group 16 (001-024) ask at the end of the book whether to go on
//      from its start: Cancel ends such a loop.
//   The whole list is one run: one Edit > Undo takes back everything it changed, and Cancel stops
//   it and leaves the book as it was. Scripts run scripts at most 8 deep.
// КАК ИЗМЕНИТЬ СПИСОК (инструкция оригинала выше - для этого редактора).
//   Скопируйте папку этого скрипта в свою папку скриптов (Скрипты > Открыть папку скриптов) и
//   правьте index.js копии: с id этого скрипта копия заменяет его в меню, с собственными id и
//   названием появляется рядом с ним (docs/scripting/ru.md, раздел 1); затем Скрипты > Перечитать
//   скрипты. Список - это код между двумя строками "======================" в run() ниже.
//   Каждая команда запускает один скрипт меню «Скрипты», заданный путём FictionBook Editor (поле
//   legacy.source его script.json; обратная или прямая косая черта, регистр букв и начальная
//   обратная косая черта значения не имеют) или своим id, и возвращает то, что вернул этот скрипт:
//     await runScriptInFolder("16_Поиск форматирования\\150_Выделить следующий эпиграф.js");
//     await runScriptInFolder("19/paragraphs-to-italics");
//   runScriptInFolder - это mfbe.scripts.run с сообщением оригинала о ненайденном скрипте (список
//   при этом продолжается); runScript - та же команда, и она понимает также полный путь установки
//   оригинала ("C:\\Program Files\\FBE\\Scripts\\06_Чистка\\..."). Редактор сам находит свои
//   скрипты: строка scriptsFolder(...) оригинала не нужна. Перед каждой командой пишите await.
//   1) Пошагово: команды выполняются одна за другой, каждая с выделением, которое оставил
//      предыдущий скрипт, - выделить следующий эпиграф, затем сформатировать его абзацы:
//        await runScriptInFolder("16_Поиск форматирования\\150_Выделить следующий эпиграф.js");
//        await runScriptInFolder("19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
//   2) Во всём документе: цикл, который повторяется, пока скрипт, выделяющий следующий элемент (или
//      переходящий к нему), возвращает "Found" - скрипты «Выделить следующий ...» и «Перейти на
//      следующий ...» группы 16 возвращают "Found" или "NotFound"; в фигурных скобках - команды
//      каждого повтора:
//        while ((await runScriptInFolder("16_Поиск форматирования\\152_Выделить следующую цитату.js")) === "Found") {
//          await runScriptInFolder("19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
//        }
//      Для разных элементов - по циклу на каждый, а перед каждым циклом - курсор в начало документа:
//        await runScriptInFolder("34_Управление курсором либо выделением\\001_Установить курсор в начало документа.js");
//      Скрипты «Перейти на ...» группы 16 (001-024) в конце книги спрашивают, продолжить ли поиск с
//      начала: «Отмена» завершает такой цикл.
//   Весь список - один запуск: одна команда Правка > Отменить отменяет всё, что он изменил, а
//   «Отмена» останавливает его и оставляет книгу такой, какой она была. Скрипты запускают скрипты
//   не глубже 8 уровней.
// The original's notice, kept as written (FR-029):
// Скрипт "Запуск скриптов по списку" (пошаговый вариант)
// Версия 1.5
// Автор Sclex

   // ======================

   // Инструкция к скрипту:

   // Скрипт "Запуск скриптов по списку" может работать в 2 режимах:

   // 1) Пошаговый режим выполнения указанных действий.
   // 2) Выполнение указанных действий сразу во всем документе (цикл с условием).

   // 1) Для пошаговой работы скрипта надо указать 1 или более строк, начинающихся с runScriptInFolder
   // Пошаговая версия более удобна для постепенной контролируемой обработки
   // какого-то одного из элементов от места установки курсора вниз или вверх по тексту документа.

   // Например:
   // runScriptInFolder("16_Поиск форматирования\\50_Перейти на следующий эпиграф.js");
   // runScriptInFolder("\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\55_Расформатировать абзац(ы) от жирности.js");


   // ======================

   // 2) Для выполнения указанных действий сразу во всем документе (цикл с условием),
   // надо указать 2 или более строк, первая из которых должна начинаться с while (runScriptInFolder

   // Например:

   // while (runScriptInFolder("31_Автоматизация\\50_Перейти на следующий эпиграф.js")=="Found") {
   // runScriptInFolder("\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\46_Сформатировать абзац(ы) программным кодом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\43_Сформатировать абзац(ы) зачеркнутостью.js");
   // runScriptInFolder("\\19_Обработка форматирования\\45_Сформатировать абзац(ы) нижним индексом.js");
   // }

   // while означает цикл.

   // Условие
   // (runScriptInFolder("16_Поиск форматирования\\50_Перейти на следующий эпиграф.js")=="Found")
   // означает "выполнять цикл, пока что-то оказывается найденным скриптом "50_Перейти на следующий эпиграф.js".

   // Строки
   // runScriptInFolder("\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\46_Сформатировать абзац(ы) программным кодом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\43_Сформатировать абзац(ы) зачеркнутостью.js");
   // runScriptInFolder("\\19_Обработка форматирования\\45_Сформатировать абзац(ы) нижним индексом.js");

   // То есть, скрипт с таким кодом сформатирует курсивом, потом программным кодом, зачеркнутостью и нижним индексом
   // все найденные эпиграфы (от позиции курсора до конца документа).

   // Для выполнения более, чем 1 скрипта после строки, содержащей while, обязательно наличие фигурных скобок:
   // после =="Found") {
   // и
   // } после последней строки с последним по очереди скриптом.


   // Если надо произвести ОДИНАКОВЫЕ действия (например, назначить курсив и снять жирность)
   // с РАЗНЫМИ элементами (например с цитатами и эпиграфами), или
   // Если надо произвести РАЗНЫЕ действия (например назначить жирность и снять курсив)
   // с РАЗНЫМИ элементами (например с цитатами и эпиграфами):

   // То для каждой обработки нужно прописать отдельный блок с while - у каждого блока должно быть свое условие и свои выполняемые команды.

   // Также перед каждым таким блоком нужно разместить строку со скриптом, устанавливающим курсор
   // в начало документа перед выполнением каждого из блоков.

   // ======================
   // Пример выполнения нескольких действий с разными выбранными элементами во всем документе:

   // Устанавливаем курсор в начало документа соответствующим скриптом:
   // runScriptInFolder("\\31_Автоматизация\\001_Установить курсор в начало документа.js");

   // Указываем блок действий № 1:
   // while (runScriptInFolder("16_Поиск форматирования\\52_Перейти на следующую цитату.js")=="Found") {
   // runScriptInFolder("\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\44_Сформатировать абзац(ы) верхним индексом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\05_Снять форматирование блочным элементом.js");
   // }

   // Устанавливаем курсор в начало документа соответствующим скриптом:
   // runScriptInFolder("\\31_Автоматизация\\001_Установить курсор в начало документа.js");

   // Указываем блок действий № 2:
   // while (runScriptInFolder("16_Поиск форматирования\\48_Перейти на следующий заголовок.js")=="Found") {
   // runScriptInFolder("\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
   // runScriptInFolder("\\19_Обработка форматирования\\40_Сформатировать абзац(ы) жирностью.js");
   // }

   // Устанавливаем курсор в начало документа соответствующим скриптом:
   // runScriptInFolder("\\31_Автоматизация\\001_Установить курсор в начало документа.js");

   // Указываем блок действий № 3:
   // while (runScriptInFolder("16_Поиск форматирования\\24_Перейти на следующий абзац, содержащий код.js")=="Found") {
   // runScriptInFolder("\\19_Обработка форматирования\\43_Сформатировать абзац(ы) зачеркнутостью.js");
   // runScriptInFolder("\\19_Обработка форматирования\\40_Сформатировать абзац(ы) жирностью.js");
   // }

   // ...
   // Теоретически, кол-во блоков выполняемых действий быть любым.

   // Конец описания работы скрипта
   // ======================

import { listCommands } from './lib/run-list.js';

export default async function run(ctx) {
  const { runScriptInFolder, runScript } = listCommands(ctx);
  // ======================
  // Тут сами пользовательские команды поиска и обработки (the commands of the list):

  // The original: runScriptInFolder("\\19_Обработка форматирования\\50_Перейти на следующий эпиграф.js"); {
  await runScriptInFolder("\\16_Поиск форматирования\\150_Выделить следующий эпиграф.js");
  await runScriptInFolder("\\19_Обработка форматирования\\40_Сформатировать абзац(ы) жирностью.js");
  await runScriptInFolder("\\19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");
  await runScriptInFolder("\\19_Обработка форматирования\\05_Снять форматирование блочным элементом.js");

  // Конец пользовательских строк с командами (the end of the list)
  // ======================
}
