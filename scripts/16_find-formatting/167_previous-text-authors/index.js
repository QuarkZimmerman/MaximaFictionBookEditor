// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/167_Выделить предыдущих авторов текста.js
// Selects the previous group of text authors that follow each other (block-search.js), from the
// start of the selection; the group the caret is in is skipped. Returns "Found", or "NotFound"
// after saying that none was found (as the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущих авторов текста»
// Автор Sclex
// Версия 1.7

import { runTextAuthorSearch } from './block-search.js';

export default async function run(ctx) {
  return runTextAuthorSearch(ctx, {
    forward: false,
    status: {
      ru: 'Переходим на предыдущих авторов текста…',
      en: 'Going to the previous text authors…',
    },
    notFound: {
      ru: 'До начала документа не нашлось ни одного автора текста.',
      en: 'No text author was found up to the beginning of the document.',
    },
  });
}
