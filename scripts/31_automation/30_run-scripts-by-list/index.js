// Converted from FictionBook Editor 2.7.9: Scripts/31_Автоматизация/30_Запуск скриптов по списку.js
// A template: runs the scripts its list names, one after another and in loops, in one run (Sclex's
// "Запуск скриптов по списку"). The list is meant to be edited - see HOW TO EDIT THE LIST below. As
// shipped it is the original's example, kept as written: as long as
// "31_Автоматизация\\06_Поиск (без замены) ошибок текста (версия с исключениями).js" returns "Found",
// make the paragraph italic (19/paragraphs-to-italics). 2.7.9 has no such file - its error search
// with exceptions is 21_Поиск и замена\\06_...(TaKir-Sclex-stokber).js, which returns no "Found" -,
// so 2.7.9 and this script say "Скрипт ... не был запущен, т.к. не удалось его успешно загрузить..."
// and the loop ends at once: nothing changes (an open question: what should the example run?).
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
// Скрипт "Запуск скриптов по списку"
// Версия 1.5
// Автор Sclex

import { listCommands } from './lib/run-list.js';

export default async function run(ctx) {
  const { runScriptInFolder, runScript } = listCommands(ctx);
  // ======================
  // Тут сами пользовательские команды поиска и обработки (the commands of the list):

  while ((await runScriptInFolder("31_Автоматизация\\06_Поиск (без замены) ошибок текста (версия с исключениями).js")) === "Found")
    await runScriptInFolder("19_Обработка форматирования\\41_Сформатировать абзац(ы) курсивом.js");

  // Конец пользовательских строк с командами (the end of the list)
  // ======================
}
