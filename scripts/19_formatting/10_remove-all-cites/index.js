// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/10_Удалить все цитаты и их содержимое.js
// Removes every cite of the book with its content, from the last to the first as the original
// did (a cite nested in another one goes first): those of the bodies and those of the book
// annotation and the history, which the original's page held too. A cite that is all the text a
// section has leaves an empty line in its place: FB2 wants text in a section, and the original
// left the section with its title only, which 2.7.9 refused to save until it was mended. An
// annotation or a history left with nothing but empty lines goes, as 2.7.9 saved no such
// element. The count goes to the status bar; without any cite a message says so. The
// original's Run() returned nothing, nor does run().
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все цитаты и их содержимое" v1.0
// Автор Sclex

import { isEmptyBlock, nodesIn } from './lib/containers.js';
import { isApiError, t } from './lib/text-blocks.js';

export default async function run(ctx) {
  let removed = 0;
  const cites = await mfbe.doc.getElementsByTagName('cite');
  for (let i = cites.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(cites.length - i, cites.length);
    try {
      await mfbe.doc.removeNode(cites[i]);
    } catch (error) {
      if (!isApiError(error, 'notAllowed')) throw error;
      await mfbe.doc.replaceNode(cites[i], { type: 'empty-line', attrs: {} });
    }
    removed += 1;
  }

  const { description } = await mfbe.doc.get();
  let changed = false;
  for (const [owner, key] of [
    [description.documentInfo, 'history'],
    [description.titleInfo, 'annotation'],
  ]) {
    const found = nodesIn(owner?.[key], 'cite');
    for (let k = found.length - 1; k >= 0; k -= 1) {
      found[k].parent.content.splice(found[k].index, 1);
      removed += 1;
      changed = true;
    }
    if (found.length && isEmptyBlock(owner[key])) delete owner[key];
  }
  if (changed) await mfbe.doc.setDescription(description);

  if (removed === 0) {
    await mfbe.ui.message(
      t(ctx, 'Цитат в документе не нашлось.', 'No cites were found in the document.'),
    );
    return;
  }
  await mfbe.ui.status(
    t(
      ctx,
      `Удалено цитат с их содержимым: ${removed}.`,
      `Cites removed with their content: ${removed}.`,
    ),
    { sticky: true },
  );
}
