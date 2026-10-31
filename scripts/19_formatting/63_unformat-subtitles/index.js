// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/63_Расформатировать подзаголовок(-ки).js
// Turns every subtitle among the paragraphs into plain text, keeping its content and
// attributes. The original set the subtitle's class to "normal" (SetStyleEx) and removed it,
// which made a paragraph of it - a verse inside a stanza. A subtitle that stands directly in
// a poem, between its stanzas, becomes a stanza of one verse: the original's paragraph there
// would have made the poem invalid FB2 (as 19/element-browser does).
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
// Скрипт «Расформатировать подзаголовок(-ки)»
// Автор Sclex
// Версия 1.6
 //имя тэга, который будет использован для маркеров начала и конца выделения
  //alert("Вошли в getNextNode.");

import { formatSelectedParagraphs, unformatSubtitle } from './lib/paragraph-format.js';
import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  await formatSelectedParagraphs(ctx, {
    status: t(ctx, 'Расформатируем подзаголовок(-ки)…', 'Unformatting the subtitle(s)…'),
    transform: unformatSubtitle,
  });
}
