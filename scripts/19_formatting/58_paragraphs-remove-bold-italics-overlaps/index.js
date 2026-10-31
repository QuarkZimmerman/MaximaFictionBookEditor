// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/58_Расформатировать абзац(ы) от совмещений курсива с жирностью.js
// Text that is both italic and bold loses both; text that is only italic or only bold keeps
// it. The original walked the tags of innerHTML with two counters (bold and italic levels):
// on entering italics inside bold (or bold inside italics) it closed the outer tag, on
// leaving it reopened it, and it dropped the tags met while both were open - so text under
// both lost both and the rest kept its formatting. Here each text node's marks are looked
// at directly, which gives the same result. A difference: formatting of one kind nested in
// itself (here only possible with different languages) is handled like any other - the
// original's counters lost track of it and let italics or bold run on past their end.
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
// Скрипт «Расформатировать абзац(ы) от совмещений курсива с жирностью»
// Автор Sclex
// Версия 1.6
 //имя тэга, который будет использован для маркеров начала и конца выделения
   //alert("match: "+match+"\n\nboldLevel: "+boldLevel+"\n\nitalicLevel: "+italicLevel);

import { boldAndItalic, formatSelectedParagraphs, markTransform } from './lib/paragraph-format.js';
import { t } from './lib/text-blocks.js';

export default async function run(ctx) {
  await formatSelectedParagraphs(ctx, {
    status: t(
      ctx,
      'Расформатируем абзац(ы) от совмещений курсива с жирностью…',
      'Removing italics combined with bold from the paragraph(s)…',
    ),
    transform: markTransform({ remove: ['strong', 'emphasis'], when: boldAndItalic }),
  });
}
