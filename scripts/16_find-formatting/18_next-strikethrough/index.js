// Converted from 16_Поиск форматирования/18_Переход на следующее зачеркивание.js (FictionBook Editor 2.7), Tier 1.
// Go to next strikethrough: the engine in format-search.js is shared by the 24 scripts of the group; this file
// only fixes the mark, the direction and whether the search starts from the next paragraph.
import { runFormatSearch } from './format-search.js';

export default async function run(ctx) {
  await runFormatSearch(ctx, { mark: 'strikethrough', direction: 'forward', paragraph: false });
}
