// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/024_Перейти на следующий абзац, содержащий код.js
// (converted from 2.7beta1's Scripts/16_Поиск форматирования/24_Переход на следующий абзац, содержащий код.js first, brought up to 2.7.9 in feature 007).
// Goes to the next paragraph holding code, to the start of its first run (format-search.js);
// at the end of the book it asks whether to go on from the beginning.
// Returns "Found", or "NotFound" when nothing is found or the user declines to go on; nothing
// for a selected picture (as the original's Run() did), so that other scripts can run it in
// loops (mfbe.scripts.run). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
//Скрипт набора «Поиск форматирования»
//Автор Sclex
//Топик про скрипты FBE: http://www.fictionbook.org/forum/viewtopic.php?t=4412
//Мой сайт про мои скрипты: http://scripts.fictionbook.org

import { runFormatSearch } from './format-search.js';

export default async function run(ctx) {
  return runFormatSearch(ctx, { mark: 'code', forward: true, paragraph: true });
}
