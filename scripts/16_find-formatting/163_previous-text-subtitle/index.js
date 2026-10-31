// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/163_Выделить предыдущий подзаголовок (текст).js
// Selects the previous text subtitle (block-search.js), from the start of the selection; the whole
// subtitle is selected. Returns "Found", or "NotFound" after saying that none was found (as the
// original's Run() did). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущий текстовый подзаголовок»
// Автор Sclex, сборка TaKir
// Версия 1.4

import { runParagraphSearch } from './block-search.js';
import { plainText } from './nav-lib.js';

export default async function run(ctx) {
  const subtitleRegExp = /[A-Za-zА-яЁё|0-9](.*)/;
  return runParagraphSearch(ctx, {
    forward: false,
    test: (p) => p.cls === 'subtitle' && subtitleRegExp.test(plainText(p)),
    status: {
      ru: 'Переходим на предыдущий текстовый подзаголовок…',
      en: 'Going to the previous text subtitle…',
    },
    notFound: {
      ru: 'До начала документа не нашлось ни одного текстового подзаголовка.',
      en: 'No text subtitle was found up to the beginning of the document.',
    },
  });
}
