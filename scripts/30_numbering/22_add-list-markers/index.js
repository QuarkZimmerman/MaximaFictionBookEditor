// Converted from FictionBook Editor 2.7.9: Scripts/30_'Числовые' скрипты/22_Добавить маркеры списка (по выбору пользователя) (не маркировать пустые строки)....js
// Asks for a list marker - one of the ten signs of the original's dialog "HTML/Добавить маркеры
// списка (по выбору пользователя) - основной диалог.htm" or one of your own - and puts it with a
// non-breaking space before the content of every paragraph of the selection - from the one holding
// its start to the one holding its end -, leaving out empty lines and paragraphs of spaces only
// (isLineEmpty); then it re-selects the selection, which moved with the text (lib/numbering.js).
// An empty marker of your own does nothing, as in the original.
// Differences from 2.7.9: the dialog is a form (ui.form) whose choice of your own marker counts
// when that option is chosen (the original's dialog chose it when its field got the focus); a
// selected picture gets the message for a missing selection (2.7.9 stopped with a script error);
// the original's check for a selection in an input field has no counterpart (the script works on
// the Body view). The status text while it runs is the one of "Нумерацию в началах строк -
// надстрочным текстом", as in the original.
// The original's notice, kept as written (FR-029):
//скрипт «Добавить маркеры списка (по выбору пользователя) (не нумеровать пустые строки).js»
//автор Sclex
//v1.3

import { NBSP, numberParagraphs, t, textSelection } from './lib/numbering.js';

// The signs of the dialog, in its order (radio1 ... radio8, radio10, radio11).
const SIGNS = ['—', '~', '•', '■', '♠', '♣', '♥', '♦', '#', '^'];

/** The dialog: the marker chosen, its own text for "Задать свой маркер:", or null on Cancel. */
async function askMarker(ctx) {
  const answer = await mfbe.ui.form({
    title: ctx.script.name,
    fields: [
      {
        kind: 'radio',
        id: 'marker',
        label: t(ctx, 'Выберите вид маркера пунктов списка:', 'Choose the marker of the list items:'),
        options: [
          ...SIGNS.map((sign) => ({ value: sign, label: sign })),
          { value: 'own', label: t(ctx, 'Задать свой маркер:', 'A marker of your own:') },
        ],
        value: SIGNS[0],
      },
      { kind: 'text', id: 'own', label: t(ctx, 'Свой маркер', 'Your own marker'), value: '' },
    ],
    okLabel: t(ctx, 'Добавить маркеры списка', 'Add list markers'),
    cancelLabel: t(ctx, 'Отмена', 'Cancel'),
  });
  if (!answer) return null;
  return answer.marker === 'own' ? String(answer.own ?? '') : String(answer.marker);
}

export default async function run(ctx) {
  const selected = await textSelection();
  if (!selected) {
    await mfbe.ui.message(
      t(
        ctx,
        'Нет выделения.\n\nПеред запуском скрипта нужно выделить текст, который будет обработан.',
        'Nothing is selected.\n\nSelect the text to process before running the script.',
      ),
    );
    return;
  }
  const markerSign = await askMarker(ctx);
  if (!markerSign) return;
  await mfbe.ui.status(
    t(ctx, 'Делаем числа в началах абзацев надстрочным текстом…', 'Making the numbers at the starts of the paragraphs superscript…'),
  );
  await numberParagraphs(ctx, selected, { prefix: () => markerSign + NBSP, skipEmpty: true });
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'), { sticky: true });
}
