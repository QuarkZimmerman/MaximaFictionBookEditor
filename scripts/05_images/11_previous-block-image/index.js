// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/11_Перейти на предыдущую 'блочную' иллюстрацию.js
// Goes to the previous block picture (a picture between paragraphs) in the order FictionBook
// Editor showed the book in - the bodies after the book annotation and the history -, from the
// start of the selection, and puts the caret right before it: at the end of the text right before
// it, or - when another picture or nothing lies before it - right at its side, so that the next
// run goes on from there.
// When there is none, it says so. Returns nothing, as the original's Run() did. Engine:
// image-nav.js (identical in 11, 12, 18 and 19).
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - a selected picture: the original stepped off it (Shift+Esc and an arrow key) and then stopped
//   with a script error; here the search starts beside it, where the step had put the caret
//   (fix);
// - the check "Установите курсор в документ!" is dropped: scripts see the Body view's selection
//   only; the editor scrolls the place into view (the original's GoTo).
// The original's notice, kept as written (FR-029):
// Скрипт «Перейти на предыдущую 'блочную' иллюстрацию» v.1.1
// автор — Sсlex.
// костыль от ошибки выделения — stokber (сентябрь 2025).

import { caretBesidePicture, findBlockPicture, loadBook, startPlace, t } from './image-nav.js';

const name = "Перейти на предыдущую 'блочную' иллюстрацию";
const nameEn = "Go to the previous 'block' illustration";
const vers = '1.1';
//направление поиска картинок
//0 - вперед
//другие значения - назад
const Direction = 1;

export default async function run(ctx) {
  const forward = Direction === 0;
  const book = await loadBook();
  const place = await startPlace(book, forward);
  if (place === null) return;
  const index = findBlockPicture(book, place, forward);
  if (index < 0) {
    await mfbe.ui.message(
      t(
        ctx,
        `  Иллюстраций больше нет.  \n\nСкрипт '${name}' v.${vers}`,
        `  There are no more illustrations.  \n\nScript '${nameEn}' v.${vers}`,
      ),
    );
    return;
  }
  await caretBesidePicture(book, index, forward);
}
