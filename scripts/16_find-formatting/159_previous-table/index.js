// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/159_Выделить предыдущую таблицу.js
// Selects the previous table (block-search.js): from the end of the selection, the first paragraph
// of one other than the table the caret is in; that whole table is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущую таблицу» (table)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: false,
    cls: 'table',
    check: (p) => hasContainer(p, 'table'),
    status: { ru: 'Переходим на предыдущую таблицу…', en: 'Going to the previous table…' },
    notFound: {
      ru: 'До начала документа не нашлось ни одной таблицы.',
      en: 'No table was found up to the beginning of the document.',
    },
  });
}
