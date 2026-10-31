// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/16_Расформатировать все эпиграфы.js
// Dissolves every epigraph of the book, from the last to the first as the original did: its
// content stays in its place and its own text authors become paragraphs (a cite's text authors
// stay with their cite); the epigraph and its id go. The original only removed the epigraph's
// element, which left what FB2 does not allow wherever paragraphs cannot follow - 2.7.9 then
// refused to save the book until it was mended. Here the content goes to the first place where
// it may stand (lib/containers.js, placements()):
// - in its place, as in the original, when that is valid (a section epigraph before the text,
//   or before the section's picture);
// - before a section's annotation it cannot stand: it opens the section's text, after the
//   annotation;
// - a body holds no paragraphs, nor does a section of sections: it becomes a section of its
//   own, untitled, before the first section;
// - a poem holds no paragraphs: its paragraphs become the verses of stanzas there (an empty line
//   separates two stanzas); an epigraph of a poem holding a poem or a cite stays, and the status
//   bar says how many stayed.
// The count goes to the status bar; without any epigraph a message says so. The original's
// Run() returned nothing, nor does run().
// The original's notice, kept as written (FR-029):
// Скрипт "Расформатировать все эпиграфы" v1.2
// Автор Sclex

import { linesOf, placeOf, placements, writeParentContent } from './lib/containers.js';
import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  let found = 0;
  let unformatted = 0;
  const epigraphs = await mfbe.doc.getElementsByTagName('epigraph');
  for (let i = epigraphs.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(epigraphs.length - i, epigraphs.length);
    const place = await placeOf(epigraphs[i].nodeId);
    if (!place) continue;
    found += 1;
    const lines = linesOf(place.parent.content[place.index]);
    if (
      await writeParentContent(
        place.parentId,
        place.parent,
        placements(place.parent, place.index, lines),
      )
    ) {
      unformatted += 1;
    }
  }
  if (found === 0) {
    await mfbe.ui.message(
      t(ctx, 'Эпиграфов в документе не нашлось.', 'No epigraphs were found in the document.'),
    );
    return;
  }
  const left = found - unformatted;
  await mfbe.ui.status(
    t(
      ctx,
      `Расформатировано эпиграфов: ${unformatted}.` +
        (left ? ` Оставлено эпиграфов: ${left} — их содержимое недопустимо на их месте.` : ''),
      `Epigraphs unformatted: ${unformatted}.` +
        (left ? ` Epigraphs left: ${left} - their content cannot stand in their place.` : ''),
    ),
    { sticky: true },
  );
}
