// Converted from FictionBook Editor 2.7.9: Scripts/16_Поиск форматирования/141_Выделить предыдущий целиком курсивный, но НЕ целиком жирный абзац.js
// Selects the previous paragraph that is italic throughout but not bold throughout
// (block-search.js), from the start of the selection. Returns "Found", or "NotFound" after saying
// that none was found (as the original's Run() did). Differences from the original:
// docs/scripting/conversion-notes-279-b.md (group 16).
// The original's notice, kept as written (FR-029):
// Скрипт «Выделить предыдущий целиком курсивный, но НЕ целиком жирный абзац»
// Автор Sclex
// Версия 1.2

import { entirely, runParagraphSearch } from './block-search.js';

export default async function run(ctx) {
  return runParagraphSearch(ctx, {
    forward: false,
    test: (p) => entirely(p, 'emphasis') && !entirely(p, 'strong'),
    status: {
      ru: 'Переходим на предыдущий целиком курсивный, но НЕ целиком жирный абзац…',
      en: 'Going to the previous entirely italic but NOT entirely bold paragraph…',
    },
    notFound: {
      ru: 'До начала документа не нашлось ни одного целиком курсивного, но НЕ целиком жирного абзаца.',
      en: 'No entirely italic but NOT entirely bold paragraph was found up to the beginning of the document.',
    },
  });
}
