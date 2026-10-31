// Converted from FictionBook Editor 2.7.9: Scripts/30_'Числовые' скрипты/37_Удалить все 'слои' нумерации вида '1.' и '1)' в началах выделенных абзацев.js
// Removes every layer of numbering like "1." and "1)": numbers with a dot or a parenthesis in a
// row, each with the spaces and non-breaking spaces after it, from the start of every paragraph of
// the selection - from the one holding its start to the one holding its end -, counting the
// characters outside the tags of the paragraph's HTML as the original did (lib/numbering.js); a
// paragraph left with nothing but white space is an empty line, as FictionBook Editor saved it.
// Then it re-selects the selection.
// Fixed: a paragraph at whose very start the selection ends is left alone, and the walk stops
// there (2.7.9 went on to the end of the book when that paragraph directly followed the previous
// one); the original also put the HTML of the whole Body view on the clipboard at every run (a
// debugging line), which the conversion leaves out.
// Differences from 2.7.9: a selected picture gets the message for a missing selection (2.7.9
// stopped with a script error); the original's check for a selection in an input field has no
// counterpart (the script works on the Body view).
// The original's notice, kept as written (FR-029):
//скрипт «Удалить все 'слои' нумерации вида "1." и "1)" в началах выделенных абзацев»
//автор Sclex
//v1.3

import { NBSP, removeNumbering, t, textSelection } from './lib/numbering.js';

// The original's re3.
const re3 = new RegExp('^(\\d+[.)]( |' + NBSP + ')*)+', '');

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
    t(
      ctx,
      "Удаляем все 'слои' нумерации вида '1.' и '1)' в началах выделенных абзацев...",
      "Removing all 'layers' of numbering like '1.' and '1)' at the starts of the selected paragraphs...",
    ),
  );
  await removeNumbering(ctx, selected, re3);
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'), { sticky: true });
}
