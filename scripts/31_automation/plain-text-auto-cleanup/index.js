// Converted from FictionBook Editor 2.7.9: Scripts/31_Автоматизация/Автоматическая чистка простых текстов.js
// Cleans a book made from plain text by running nine scripts one after another, as the original's
// list (on Sclex's "Запуск скриптов по списку") ran them:
//   1. 08/structure-cleanup "Почистить структуру";
//   2. 06/general-cleanup "Генеральная уборка";
//   3. 06/remove-styles-and-ids "Удалить теги style, id разделов, id абзацев и id картинок";
//   4. 06/unformat-empty-links "Расформатировать ссылки, адрес которых - пустая строка";
//   5. 06/external-links-to-text "Превратить внешние ссылки в текст";
//   6. 06/remove-fbd-bookmark-links "Удалить ссылки 'bookmark', созданные FBD";
//   7. 13/subtitles-empty-lines-plain-titles "Разметка подзаголовков, чистка пустых строк, удаление
//      жирности и курсива в заголовках";
//   8. 13/remove-title-formatting "Удалить форматирование в заголовках и подзаголовках";
//   9. 06/general-cleanup-alexander-ka "Генеральная уборка (версия Александра Ка)".
// Each asks and reports as it does when run by itself. They run through mfbe.scripts.run by their
// 2.7.9 paths (lib/run-list.js).
// Fix: the original names 8 by an earlier name, "13_Заголовки, подзаголовки, пустые
// строки\\529_Удаление жирности и курсива в заголовках и подзаголовках.js", which 2.7.9 does not
// have - the script's own history says that its version 2.0 renamed it ("было «Удаление
// жирности/курсива в заголовках и подзаголовках»") -, so in 2.7.9 the list said "Скрипт ... не был
// запущен ..." there and went on; here it runs the script by its 2.7.9 path.
// Differences from 2.7.9: the whole run is one undo step under this script's name, and one Cancel
// stops it and leaves the book as it was (each script of the original's list made an undo step of
// its own). Everything else is the behaviour of the scripts it runs,
// with their own recorded differences (the conversion notes of groups 06, 08 and 13).
// The original's notice, kept as written (FR-029):
// Скрипт "Автоматическая чистка простых текстов"
// Версия 1.3
// Автор Sclex

import { listCommands } from './lib/run-list.js';

export default async function run(ctx) {
  const { runScriptInFolder } = listCommands(ctx);
  // The original's commands ("Тут сами пользовательские команды поиска и обработки"):
  await runScriptInFolder("08_Структура разделов\\13_Почистить структуру.js");
  await runScriptInFolder("06_Чистка\\02_Генеральная уборка.js");
  await runScriptInFolder("06_Чистка\\40_Удалить теги style, id разделов, id абзацев и id картинок.js");
  await runScriptInFolder("06_Чистка\\50_Расформатировать ссылки, адрес которых - пустая строка.js");
  await runScriptInFolder("06_Чистка\\17_Превратить внешние ссылки в текст.js");
  await runScriptInFolder("06_Чистка\\55_Удалить ссылки 'bookmark', созданные FBD.js");
  await runScriptInFolder("13_Заголовки, подзаголовки, пустые строки\\528_Разметка подзаголовков, чистка пустых строк, удаление жирности и курсива в заголовках.js");
  // The original: runScriptInFolder("13_Заголовки, подзаголовки, пустые строки\\529_Удаление жирности и курсива в заголовках и подзаголовках.js");
  await runScriptInFolder("13_Заголовки, подзаголовки, пустые строки\\529_Удалить форматирование в заголовках и подзаголовках.js");
  await runScriptInFolder("06_Чистка\\68_Генеральная уборка (версия Александра Ка).js");
}
