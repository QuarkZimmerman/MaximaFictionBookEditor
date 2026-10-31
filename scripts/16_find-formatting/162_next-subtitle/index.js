// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/162_Выделить следующий подзаголовок (любой).js
// Selects the next subtitle of any kind (block-search.js), from the end of the selection; the whole
// subtitle is selected. Returns "Found", or "NotFound" after saying that none was found (as the
// original's Run() did). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий подзаголовок (любой)» (subtitle)
// Автор Sclex, сборка TaKir
// Версия 1.4

import { runParagraphSearch } from './block-search.js';
import { plainText } from './nav-lib.js';

export default async function run(ctx) {
  const subtitleRegExp = /^.*/;
  return runParagraphSearch(ctx, {
    forward: true,
    test: (p) => p.cls === 'subtitle' && subtitleRegExp.test(plainText(p)),
    status: {
      ru: 'Переходим на любой следующий подзаголовок…',
      en: 'Going to the next subtitle of any kind…',
    },
    notFound: {
      ru: 'До конца документа не нашлось ни одного подзаголовка.',
      en: 'No subtitle was found up to the end of the document.',
    },
  });
}
