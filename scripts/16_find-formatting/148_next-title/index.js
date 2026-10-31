// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/148_Выделить следующий заголовок.js
// Selects the next title (block-search.js): from the end of the selection, the first paragraph of
// one other than the title the caret is in; that whole title is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий заголовок» (title)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: true,
    cls: 'title',
    check: (p) => hasContainer(p, 'title'),
    status: { ru: 'Переходим на следующий заголовок…', en: 'Going to the next title…' },
    notFound: {
      ru: 'До конца документа не нашлось ни одного заголовка.',
      en: 'No title was found up to the end of the document.',
    },
  });
}
