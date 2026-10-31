// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/60_Расформатировать абзац(ы) от верхнего индекса.js
// Removes every sup mark of each paragraph, with or without a language (the original's
// expression removed the SUP tags with any attributes); a footnote link keeps its link.
// The paragraphs are the text blocks from the one holding the selection's start to the one
// holding its end (the caret's paragraph when nothing is selected): paragraphs, title lines,
// subtitles, verses, text authors and table cells, those of the book annotation and the
// history too, as the original's <P> were. A poem's date is left alone, since FB2 allows no
// formatting in it (the original showed the date as a text-author paragraph and formatted it).
// The run leaves the processed paragraphs selected, from the start of the first to the end of
// the last, as the original did; started by another script (ctx.startedBy 'script'), it works
// on the selection that script left. The original's Run() returned nothing, nor does run().
// Its error message for a selection in an input field is gone: a script sees the Body view only.
// The engine is lib/paragraph-format.js, shared by 19/40-46, 19/55-63 and 19/20.
// The original's notice, kept as written (FR-029):
// Скрипт «Расформатировать абзац(ы) от верхнего индекса»
// Автор Sclex
// Версия 1.5
 //имя тэга, который будет использован для маркеров начала и конца выделения
  //alert("Вошли в getNextNode.");

import { formatSelectedParagraphs, markTransform } from './lib/paragraph-format.js';
import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  await formatSelectedParagraphs(ctx, {
    status: t(
      ctx,
      'Расформатируем абзац(ы) от верхнего индекса…',
      'Removing superscript from the paragraph(s)…',
    ),
    transform: markTransform({ remove: ['sup'] }),
  });
}
