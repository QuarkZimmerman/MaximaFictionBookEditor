// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/153_Выделить предыдущий стих (poem).js
// Selects the previous poem (block-search.js): from the end of the selection, the first paragraph
// of one other than the poem the caret is in; that whole poem is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущий стих» (poem)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: false,
    cls: 'poem',
    check: (p) => hasContainer(p, 'poem'),
    status: { ru: 'Переходим на предыдущий стих…', en: 'Going to the previous poem…' },
    notFound: {
      ru: 'До начала документа не нашлось ни одного стиха.',
      en: 'No poem was found up to the beginning of the document.',
    },
  });
}
