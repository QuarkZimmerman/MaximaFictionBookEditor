// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/140_Выделить следующий целиком курсивный и жирный абзац.js
// Selects the next paragraph that is both italic and bold throughout (block-search.js), from the
// end of the selection. Returns "Found", or "NotFound" after saying that none was found (as the
// original's Run() did). Differences from the original: docs/scripting/conversion-notes-279-b.md
// (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить следующий целиком курсивный и жирный абзац»
// Автор Sclex
// Версия 1.2

import { entirely, runParagraphSearch } from './block-search.js';

export default async function run(ctx) {
  return runParagraphSearch(ctx, {
    forward: true,
    test: (p) => entirely(p, 'emphasis') && entirely(p, 'strong'),
    status: {
      ru: 'Переходим на следующий целиком курсивный и жирный абзац…',
      en: 'Going to the next entirely italic and bold paragraph…',
    },
    notFound: {
      ru: 'До конца документа не нашлось ни одного целиком курсивного и жирного абзаца.',
      en: 'No entirely italic and bold paragraph was found up to the end of the document.',
    },
  });
}
