// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/166_Выделить следующий подзаголовок (звездочки).js
// Selects the next non-text subtitle (block-search.js), from the end of the selection; the whole
// subtitle is selected. Returns "Found", or "NotFound" after saying that none was found (as the
// original's Run() did). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий нетекстовый подзаголовок»
// Возможные варианты оформления: звездочки, решетки, буллеты, плюсы с пробелами и без
// Автор Sclex, сборка TaKir
// Версия 1.4

import { runParagraphSearch } from './block-search.js';
import { plainText } from './nav-lib.js';

export default async function run(ctx) {
  const subtitleRegExp = /\*|#|•|\+\s?\*|#|•|\+\s?\*|#|•|\+/;
  return runParagraphSearch(ctx, {
    forward: true,
    test: (p) => p.cls === 'subtitle' && subtitleRegExp.test(plainText(p)),
    status: {
      ru: 'Переходим на следующий нетекстовый подзаголовок…',
      en: 'Going to the next non-text subtitle…',
    },
    notFound: {
      ru: 'До конца документа не нашлось ни одного нетекстового подзаголовка.',
      en: 'No non-text subtitle was found up to the end of the document.',
    },
  });
}
