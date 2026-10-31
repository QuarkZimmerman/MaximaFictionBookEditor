// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/168_Выделить следующих авторов текста.js
// Selects the next group of text authors that follow each other (block-search.js), from the end of
// the selection; the group the caret is in is skipped. Returns "Found", or "NotFound" after saying
// that none was found (as the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующих авторов текста»
// Автор Sclex
// Версия 1.7

import { runTextAuthorSearch } from './block-search.js';

export default async function run(ctx) {
  return runTextAuthorSearch(ctx, {
    forward: true,
    status: { ru: 'Переходим на следующих авторов текста…', en: 'Going to the next text authors…' },
    notFound: {
      ru: 'До конца документа не нашлось ни одного автора текста.',
      en: 'No text author was found up to the end of the document.',
    },
  });
}
