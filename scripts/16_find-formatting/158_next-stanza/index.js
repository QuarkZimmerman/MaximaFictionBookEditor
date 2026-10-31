// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/158_Выделить следующую строфу (stanza).js
// Selects the next stanza (block-search.js): from the end of the selection, the first paragraph of
// one other than the stanza the caret is in; that whole stanza is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующую строфу» (stanza)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: true,
    cls: 'stanza',
    check: (p) => hasContainer(p, 'stanza'),
    status: { ru: 'Переходим на следующую строфу…', en: 'Going to the next stanza…' },
    notFound: {
      ru: 'До конца документа не нашлось ни одной строфы.',
      en: 'No stanza was found up to the end of the document.',
    },
  });
}
