// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/150_Выделить следующий эпиграф.js
// Selects the next epigraph (block-search.js): from the end of the selection, the first paragraph
// of one other than the epigraph the caret is in; that whole epigraph is selected. Returns "Found",
// or "NotFound" after saying that none was found (as the original's Run() did). Differences from
// the original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий эпиграф» (epigraph)
// Автор Sclex, сборка TaKir
// Версия 1.4

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: true,
    cls: 'epigraph',
    check: (p) => hasContainer(p, 'epigraph'),
    status: { ru: 'Переходим на следующий эпиграф…', en: 'Going to the next epigraph…' },
    notFound: {
      ru: 'До конца документа не нашлось ни одного эпиграфа.',
      en: 'No epigraph was found up to the end of the document.',
    },
  });
}
