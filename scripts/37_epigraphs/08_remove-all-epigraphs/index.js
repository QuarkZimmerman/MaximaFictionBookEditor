// Converted from FictionBook Editor 2.7.9: Scripts/37_Эпиграфы/08_Удалить все эпиграфы и их содержимое.js
// Removes every epigraph of the book with its content - those of the bodies, the sections and
// the poems - from the last to the first as the original did (an epigraph of a poem inside an
// epigraph goes first, then the outer one; both are counted). The count goes to the status bar;
// without any epigraph a message says so. The original's Run() returned nothing, nor does run().
// The 2.7.9 file is the same, byte for byte, as 19_Обработка форматирования/15_Удалить все
// эпиграфы и их содержимое.js (package 19/remove-all-epigraphs); this package carries the same
// code under the place and the id of its own group. No difference from the original.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все эпиграфы и их содержимое" v1.0
// Автор Sclex

import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  const epigraphs = await mfbe.doc.getElementsByTagName('epigraph');
  for (let i = epigraphs.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(epigraphs.length - i, epigraphs.length);
    await mfbe.doc.removeNode(epigraphs[i]);
  }
  if (epigraphs.length === 0) {
    await mfbe.ui.message(
      t(ctx, 'Эпиграфов в документе не нашлось.', 'No epigraphs were found in the document.'),
    );
    return;
  }
  await mfbe.ui.status(
    t(
      ctx,
      `Удалено эпиграфов с их содержимым: ${epigraphs.length}.`,
      `Epigraphs removed with their content: ${epigraphs.length}.`,
    ),
    { sticky: true },
  );
}
