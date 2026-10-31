// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/164_Выделить следующий подзаголовок (текст).js
// Selects the next text subtitle (block-search.js), from the end of the selection; the whole
// subtitle is selected. Returns "Found", or "NotFound" after saying that none was found (as the
// original's Run() did). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий текстовый подзаголовок» (subtitle)
// Автор Sclex, сборка TaKir
// Версия 1.4

import { runParagraphSearch } from './block-search.js';
import { plainText } from './nav-lib.js';

export default async function run(ctx) {
  const subtitleRegExp = /[A-Za-zА-яЁё|0-9](.*)/;
  return runParagraphSearch(ctx, {
    forward: true,
    test: (p) => p.cls === 'subtitle' && subtitleRegExp.test(plainText(p)),
    status: {
      ru: 'Переходим на следующий текстовый подзаголовок…',
      en: 'Going to the next text subtitle…',
    },
    notFound: {
      ru: 'До конца документа не нашлось ни одного текстового подзаголовка.',
      en: 'No text subtitle was found up to the end of the document.',
    },
  });
}
