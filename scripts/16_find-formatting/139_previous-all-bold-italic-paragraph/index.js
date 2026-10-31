// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/139_Выделить предыдущий целиком курсивный и жирный абзац.js
// Selects the previous paragraph that is both italic and bold throughout (block-search.js), from
// the start of the selection. Returns "Found", or "NotFound" after saying that none was found (as
// the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущий целиком курсивный и жирный абзац»
// Автор Sclex
// Версия 1.2

import { entirely, runParagraphSearch } from './block-search.js';

export default async function run(ctx) {
  return runParagraphSearch(ctx, {
    forward: false,
    test: (p) => entirely(p, 'emphasis') && entirely(p, 'strong'),
    status: {
      ru: 'Переходим на предыдущий целиком курсивный и жирный абзац…',
      en: 'Going to the previous entirely italic and bold paragraph…',
    },
    notFound: {
      ru: 'До начала документа не нашлось ни одного целиком курсивного и жирного абзаца.',
      en: 'No entirely italic and bold paragraph was found up to the beginning of the document.',
    },
  });
}
