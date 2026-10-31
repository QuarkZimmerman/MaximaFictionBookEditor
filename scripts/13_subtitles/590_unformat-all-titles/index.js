// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/590_Расформатировать все заголовки_Комбо.js
// Turns every title of the book into plain text. The original - TaKir's list on Sclex's "Запуск
// скриптов по списку", whole-document form ("множественный автомат") - puts the caret at the start
// of the document (34/caret-to-document-start), then, as long as "Выделить следующий заголовок"
// (16/next-title) selects a title and returns "Found", runs "Снять форматирование блочным
// элементом" (18/unwrap-poem-cite-epigraph, 19_Обработка форматирования/05) on it. That script
// dissolves the title the selection starts in together with the epigraphs and the annotation that
// follow it: their lines become paragraphs in their place - for the title of a body or of a section
// of sections, at the start of its first subsection or in a new untitled section before it -; a
// stanza's title becomes verses; a poem's title dissolves the whole poem. Every title counts: of the
// bodies, the sections, the poems and the stanzas, those of the notes too. The loop ends when
// 16/next-title says that no title was found up to the end of the document and returns
// "NotFound". The scripts run through mfbe.scripts.run by the 2.7.9 paths the original names
// (lib/run-list.js), each on the selection the previous one left.
// Differences from 2.7.9: the whole run is one undo step under this script's name, and one Cancel
// stops it and leaves the book as it was (each script of the original's list made an undo step of
// its own); the run reports the number of titles done as its progress.
// Everything else is the behaviour of the scripts it runs, with their own recorded differences (the
// conversion notes of groups 16, 19 and 34).
// The original's notice, kept as written (FR-029):
// Скрипт "Расформатировать все заголовки" (множественный автомат)
// Версия 1.5
// Автор Sclex, составление TaKir

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

import { listCommands, t } from './lib/run-list.js';

export default async function run(ctx) {
  const { runScriptInFolder } = listCommands(ctx);
  // The original's commands ("Тут сами пользовательские команды поиска и обработки"):
  await runScriptInFolder("\\34_Управление курсором либо выделением\\001_Установить курсор в начало документа.js");
  let done = 0;
  while (
    !ctx.cancelled &&
    (await runScriptInFolder("16_Поиск форматирования\\148_Выделить следующий заголовок.js")) === "Found"
  ) {
    await runScriptInFolder("\\19_Обработка форматирования\\05_Снять форматирование блочным элементом.js");
    done += 1;
    await mfbe.ui.progress(done, undefined, t(ctx, 'Обработано заголовков', 'Titles done'));
  }
}
