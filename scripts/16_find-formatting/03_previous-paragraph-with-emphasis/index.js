// Converted from 16_Поиск форматирования/03_Переход на предыдущий абзац с курсивом.js (FictionBook Editor 2.7), Tier 1.
// Go to previous paragraph with italics: the engine in format-search.js is shared by the 24 scripts of the group; this file
// only fixes the mark, the direction and whether the search starts from the next paragraph.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт набора «Поиск форматирования»
//Автор Sclex
//Топик про скрипты FBE: http://www.fictionbook.org/forum/viewtopic.php?t=4412
//Мой сайт про мои скрипты: http://scripts.fictionbook.org
import { runFormatSearch } from './format-search.js';

export default async function run(ctx) {
  await runFormatSearch(ctx, { mark: 'emphasis', direction: 'backward', paragraph: true });
}
