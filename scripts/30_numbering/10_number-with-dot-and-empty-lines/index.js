// Converted from FictionBook Editor 2.7.9: Scripts/30_'Числовые' скрипты/10_В началах выделенных абзацев добавить нумерацию вида '1.' (нумеровать и пустые строки).js
// Puts "1.", "2.", ... and a non-breaking space before the content of every paragraph of the
// selection - from the one holding its start to the one holding its end: title lines, verses,
// subtitles, text authors, dates, table cells and the book's annotation and history too -,
// empty lines and paragraphs of spaces only included: an empty line becomes a paragraph, the
// empty paragraph of a missing annotation or history a new one; then it re-selects the
// selection, which moved with the text (lib/numbering.js).
// Differences from 2.7.9: a selected picture gets the message for a missing selection (2.7.9
// stopped with a script error); the original's check for a selection in an input field has no
// counterpart (the script works on the Body view). The status text while it runs is the one of
// "Нумерацию в началах строк - надстрочным текстом", as in the original.
// The original's notice, kept as written (FR-029):
//скрипт «В началах выделенных абзацев добавить нумерацию вида '1.'»
//автор Sclex
//v1.2

import { NBSP, numberParagraphs, t, textSelection } from './lib/numbering.js';

export default async function run(ctx) {
  const selected = await textSelection();
  if (!selected) {
    await mfbe.ui.message(
      t(
        ctx,
        'Нет выделения.\n\nПеред запуском скрипта нужно выделить абзацы, которые будут обработаны.',
        'Nothing is selected.\n\nSelect the paragraphs to process before running the script.',
      ),
    );
    return;
  }
  await mfbe.ui.status(
    t(ctx, 'Делаем числа в началах абзацев надстрочным текстом…', 'Making the numbers at the starts of the paragraphs superscript…'),
  );
  await numberParagraphs(ctx, selected, { prefix: (cnt) => cnt + '.' + NBSP, skipEmpty: false });
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'), { sticky: true });
}
