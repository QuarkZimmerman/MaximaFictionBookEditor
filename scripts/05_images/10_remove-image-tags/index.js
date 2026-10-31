// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/10_Удалить все теги иллюстраций - теги image.js
// Removes every picture from the text of the book - the inline pictures of the paragraphs of the
// book annotation, the history and every body, then the block pictures together with the empty
// lines next to them - and reports the counts. The cover pages stay. The steps and their order
// are the original's (image-removal.js).
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - fixes: the word "undefined" no longer counts as an empty line, and the empty line after a
//   picture that opens its section goes when more text follows (both, see image-removal.js);
// - an empty line whose removal would leave a section with nothing but its title stays, and a
//   formatting element or a link that held a removed picture goes with it (the original left
//   them empty); the count of "unclear" pictures (an IMG outside an image element) is gone, the
//   editor's document has none.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все теги иллюстраций - теги image -  v1.6"
// Автор Sclex

import { removePictures, t } from './image-removal.js';

const versionStr = '1.6';

export default async function run(ctx) {
  const counts = await removePictures(ctx, () => true);
  if (!counts) return;
  const total = counts.block + counts.inline;
  await mfbe.ui.message(
    t(
      ctx,
      `Скрипт «Удалить все теги иллюстраций – теги image» v${versionStr} (автор Sclex).\n` +
        '\n' +
        `Удалено тегов «блочных» иллюстраций: ${counts.block}.\n` +
        `Удалено тегов внутриабзацных иллюстраций: ${counts.inline}.\n` +
        '\n' +
        `Всего удалено тегов иллюстраций (тегов image): ${total}.\n` +
        '\n' +
        `Удалено пустых строк (которые были рядом с иллюстрациями): ${counts.emptyLines}.`,
      `Script "Remove all illustration tags – image tags" v${versionStr} (author Sclex).\n` +
        '\n' +
        `Block illustration tags removed: ${counts.block}.\n` +
        `Inline illustration tags removed: ${counts.inline}.\n` +
        '\n' +
        `Illustration tags (image tags) removed in all: ${total}.\n` +
        '\n' +
        `Empty lines removed (those next to illustrations): ${counts.emptyLines}.`,
    ),
  );
}
