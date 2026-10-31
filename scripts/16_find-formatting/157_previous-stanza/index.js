// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/157_Выделить предыдущую строфу (stanza).js
// Selects the previous stanza (block-search.js): from the end of the selection, the first paragraph
// of one other than the stanza the caret is in; that whole stanza is selected. Returns "Found", or
// "NotFound" after saying that none was found (as the original's Run() did). Differences from the
// original: docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущую строфу» (stanza)
// Автор Sclex, сборка TaKir
// Версия 1.3

import { runContainerSearch } from './block-search.js';
import { hasContainer } from './nav-lib.js';

export default async function run(ctx) {
  return runContainerSearch(ctx, {
    forward: false,
    cls: 'stanza',
    check: (p) => hasContainer(p, 'stanza'),
    status: { ru: 'Переходим на предыдущую строфу…', en: 'Going to the previous stanza…' },
    notFound: {
      ru: 'До начала документа не нашлось ни одной строфы.',
      en: 'No stanza was found up to the beginning of the document.',
    },
  });
}
