// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/43_Сформатировать абзац(ы) зачеркнутостью.js
// Strikes each paragraph through as a whole: its strikethrough goes first (the original's
// expression removed the STRIKE tags with any attributes before it wrapped the paragraph in
// STRIKE), then the whole content gets one strikethrough mark.
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
// Скрипт «Сформатировать абзац(ы) зачеркнутостью»
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
      'Форматируем абзац(ы) зачеркнутостью…',
      'Formatting the paragraph(s) as strikethrough…',
    ),
    transform: markTransform({ remove: ['strikethrough'], add: ['strikethrough'] }),
  });
}
