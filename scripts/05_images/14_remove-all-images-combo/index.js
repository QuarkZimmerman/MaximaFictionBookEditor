// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/14_Удалить все иллюстрации, их тэги и пустые строки (комбо).js
// Removes the illustrations of the book with their tags and the empty lines around them by running
// seven scripts one after another, as the original's list (built on Sclex's "Запуск скриптов по
// списку") ran them:
//   1. 05/empty-lines-near-images "Добавить либо удалить пустые строки возле иллюстраций..." - its
//      question: Cancel removes the empty lines before and after the pictures;
//   2. 05/remove-all-binaries "Удалить все вложения";
//   3. 05/unify-binaries "Унифицировать иллюстрации и вложения";
//   4. 05/remove-unused-binaries "Удалить неиспользуемые вложения...";
//   5. 05/remove-image-tags "Удалить все теги иллюстраций - теги image";
//   6. 06/remove-styles-and-ids "Удалить теги style, id разделов, id абзацев и id картинок";
//   7. 13/subtitles-empty-lines-plain-titles "Разметка подзаголовков, чистка пустых строк, удаление
//      жирности и курсива в заголовках".
// Each asks and reports as it does when run by itself. They run through mfbe.scripts.run
// (lib/run-list.js) by the 2.7.9 paths the original names, 4 by its id: that package, converted
// from 2.7beta1 and unchanged in 2.7.9, names its 2.7beta1 file ("07_Удаление неиспользуемых
// вложений....js") in legacy.source, so the 2.7.9 path does not resolve.
// Differences from 2.7.9: the whole run is one undo step under this script's name, and one Cancel
// stops it and leaves the book as it was (each script of the original's list made an undo step of
// its own). Everything else is the behaviour of the scripts it runs,
// with their own recorded differences (the conversion notes of groups 05, 06 and 13): among them,
// the script API cannot remove a binary object, so 2 and 4 leave the binaries in the book and say
// so.
// The original's notice, kept as written (FR-029):
// Скрипт "Удаление картинок и чистка тэгов (комбо)"
// Скрипт предназначен для полного удаления всех иллюстраций, их тэгов, пустых строк вокруг иллюстраций

// Основано на скрипте "Запуск скриптов по списку"
// Версия 1.3
// Автор Sclex

import { listCommands } from './lib/run-list.js';

export default async function run(ctx) {
  const { runScriptInFolder } = listCommands(ctx);
  // The original's commands (a commented line: the original's, where the call names the id):
  await runScriptInFolder("05_Иллюстрации\\06_Добавить либо удалить пустые строки возле иллюстраций....js");
  await runScriptInFolder("05_Иллюстрации\\05_Удалить все вложения.js");
  await runScriptInFolder("05_Иллюстрации\\02_Унифицировать иллюстрации и вложения.js");
  // runScriptInFolder("05_Иллюстрации\\07_Удалить неиспользуемые вложения....js");
  await runScriptInFolder("05/remove-unused-binaries");
  await runScriptInFolder("05_Иллюстрации\\10_Удалить все теги иллюстраций - теги image.js");
  await runScriptInFolder("06_Чистка\\40_Удалить теги style, id разделов, id абзацев и id картинок.js");
  await runScriptInFolder("13_Заголовки, подзаголовки, пустые строки\\528_Разметка подзаголовков, чистка пустых строк, удаление жирности и курсива в заголовках.js");
}
