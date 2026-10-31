// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/151_Выделить предыдущую цитату.js
// Selects the previous cite (block-search.js): from the end of the selection, the first paragraph
// of one other than the cite the caret is in; that whole cite is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущую цитату» (cite)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: false,
    cls: 'cite',
    check: (p) => hasContainer(p, 'cite'),
    status: { ru: 'Переходим на предыдущую цитату…', en: 'Going to the previous cite…' },
    notFound: {
      ru: 'До начала документа не нашлось ни одной цитаты.',
      en: 'No cite was found up to the beginning of the document.',
    },
  });
}
