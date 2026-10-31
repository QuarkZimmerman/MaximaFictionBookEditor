// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/156_Выделить следующий заголовок стиха.js
// Selects the next poem title (a title inside a poem but outside its stanzas) (block-search.js):
// from the end of the selection, the first paragraph of one other than the poem title the caret is
// in; that whole poem title is selected. Returns "Found", or "NotFound" after saying that none was
// found (as the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий заголовок стиха» (title внутри poem)
// Автор Sclex, сборка TaKir
// Версия 1.4

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: true,
    cls: 'title',
    check: (p) => hasContainer(p, 'title') && hasContainer(p, 'poem') && !hasContainer(p, 'stanza'),
    status: { ru: 'Переходим на следующий заголовок стиха…', en: 'Going to the next poem title…' },
    notFound: {
      ru: 'До конца документа не нашлось ни одного заголовка стиха.',
      en: 'No poem title was found up to the end of the document.',
    },
  });
}
