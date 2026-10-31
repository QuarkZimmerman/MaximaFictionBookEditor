// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/16_Удалить иллюстрации, не 'ссылающиеся' на наличествующий бинарник.js
// Removes the pictures whose address does not name a binary object of the book - the inline
// pictures of the book annotation, the history and every body, then such block pictures together
// with the empty lines next to them - and reports the counts, or that there is none. The steps and
// their order are those of script 10 (image-removal.js), which the original was written from.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - fixes: the address is compared with "#" and the binary's id exactly (the original tested it
//   against a regular expression of all ids joined by "|", so "#old-pic1.png" passed for an
//   existing "pic1.png"); the pictures kept are no longer counted as removed "unclear" ones (the
//   original's last loop took every picture left for one); plus the two fixes of image-removal.js;
// - as in script 10: an empty line whose removal would leave a section with nothing but its title
//   stays, and a formatting element or a link that held a removed picture goes with it.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить иллюстрации, не 'ссылающиеся' на наличествующий бинарник"
// Версия 1.0
// Автор stokber (сентябрь, 2025)
// Скрипт написан по мотивам скрипта "Удалить все теги иллюстраций - теги image -  v1.6" за авторством Sclex-а.

import { removePictures, t } from './image-removal.js';

const name = "Удалить иллюстрации, не 'ссылающиеся' на наличествующий бинарник";
const nameEn = "Remove illustrations that do not 'refer' to an existing binary";
const versionStr = '1.0';

export default async function run(ctx) {
  const ids = new Set((await mfbe.doc.binaries()).map((binary) => binary.id));
  const counts = await removePictures(ctx, (href) => !(href.startsWith('#') && ids.has(href.slice(1))));
  if (!counts) return;
  const total = counts.block + counts.inline;
  if (total === 0) {
    await mfbe.ui.message(
      t(
        ctx,
        `Изображений не 'ссылающихся' на наличествующий бинарник не найдено!\n\nСкрипт «${name}» v${versionStr}`,
        `No pictures that do not 'refer' to an existing binary were found!\n\nScript "${nameEn}" v${versionStr}`,
      ),
    );
    return;
  }
  await mfbe.ui.message(
    t(
      ctx,
      `Скрипт «${name}» v${versionStr}.\n` +
        '\n' +
        `Удалено «блочных» иллюстраций: ${counts.block}.\n` +
        `Удалено внутриабзацных иллюстраций: ${counts.inline}.\n` +
        '\n' +
        `Всего удалено иллюстраций (тегов image): ${total}.\n` +
        '\n' +
        `Удалено пустых строк (которые были рядом с иллюстрациями): ${counts.emptyLines}.`,
      `Script "${nameEn}" v${versionStr}.\n` +
        '\n' +
        `Block illustrations removed: ${counts.block}.\n` +
        `Inline illustrations removed: ${counts.inline}.\n` +
        '\n' +
        `Illustrations (image tags) removed in all: ${total}.\n` +
        '\n' +
        `Empty lines removed (those next to illustrations): ${counts.emptyLines}.`,
    ),
  );
}
