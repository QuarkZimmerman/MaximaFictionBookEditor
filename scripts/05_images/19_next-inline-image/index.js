// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/19_Перейти на следующую инлайн-иллюстрацию.js
// Goes to the next inline picture (a picture inside a paragraph) in the
// order FictionBook Editor showed the book in - the book annotation, the history, every body -,
// from the start of the selection, and puts the caret right after it (the original's setting
// `sel` selects one character to its right besides).
// When there is none, it says so. Returns nothing, as the original's Run() did. Engine:
// image-nav.js (identical in 11, 12, 18 and 19).
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - a selected picture: the original stepped off it (Shift+Esc and an arrow key) and then stopped
//   with a script error; here the search starts beside it, where the step had put the caret
//   (fix);
// - the check "Установите курсор в документ!" is dropped: scripts see the Body view's selection
//   only; the editor scrolls the place into view (the original's GoTo).
// The original's notice, kept as written (FR-029):
// Скрипт «Перейти на следующую инлайн-иллюстрацию» v.1.0
// Является слегка изменённым скриптом «Следующая иллюстрация» за авторством Sсlex-а.
//Доведение до заявленного функционала — stokber (сентябрь 2025).

import { caretBesideInline, findInlinePicture, loadBook, startPlace, t } from './image-nav.js';

const name = "Перейти на следующую инлайн-иллюстрацию";
const nameEn = "Go to the next inline illustration";
const vers = '1.0';
           /// НАСТРОЙКА ТИПА ВЫДЕЛЕНИЯ:
// если 0, то курсор просто останавливается правее картинки ничего не выделяя, если любое другое
// число — будет выделен один символ для лучшей заметности. Картинку скрипт не выделяет!!!
// (0: the caret stops right of the picture and nothing is selected; any other number selects one
// character to the right of the caret, for visibility.)
const sel = 0;
//направление поиска картинок
//0 - вперед
//другие значения - назад
const Direction = 0;

export default async function run(ctx) {
  const forward = Direction === 0;
  const book = await loadBook();
  const place = await startPlace(book, forward);
  if (place === null) return;
  const found = findInlinePicture(book, place, forward);
  if (!found) {
    await mfbe.ui.message(
      t(
        ctx,
        `  Инлайн-иллюстраций больше нет.  \n\nСкрипт '${name}' v.${vers}`,
        `  There are no more inline illustrations.  \n\nScript '${nameEn}' v.${vers}`,
      ),
    );
    return;
  }
  await caretBesideInline(found, forward, sel !== 0);
}
