// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/149_Выделить предыдущий эпиграф.js
// Selects the previous epigraph (block-search.js): from the end of the selection, the first
// paragraph of one other than the epigraph the caret is in; that whole epigraph is selected.
// Returns "Found", or "NotFound" after saying that none was found (as the original's Run() did).
// Differences from the original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущий эпиграф» (epigraph)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: false,
    cls: 'epigraph',
    check: (p) => hasContainer(p, 'epigraph'),
    status: { ru: 'Переходим на предыдущий эпиграф…', en: 'Going to the previous epigraph…' },
    notFound: {
      ru: 'До начала документа не нашлось ни одного эпиграфа.',
      en: 'No epigraph was found up to the beginning of the document.',
    },
  });
}
