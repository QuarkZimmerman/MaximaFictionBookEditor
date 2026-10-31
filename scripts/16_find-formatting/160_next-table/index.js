// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/160_Выделить следующую таблицу.js
// Selects the next table (block-search.js): from the end of the selection, the first paragraph of
// one other than the table the caret is in; that whole table is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующую таблицу» (table)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: true,
    cls: 'table',
    check: (p) => hasContainer(p, 'table'),
    status: { ru: 'Переходим на следующую таблицу…', en: 'Going to the next table…' },
    notFound: {
      ru: 'До конца документа не нашлось ни одной таблицы.',
      en: 'No table was found up to the end of the document.',
    },
  });
}
