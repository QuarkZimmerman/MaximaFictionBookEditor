// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/38_Удалить id картинок.js
// Removes the id attribute of every block picture (<image> between paragraphs) of every body, the
// notes body included; inline pictures have no id. Reports the number of removed ids.
// Differences: none in the result; the run is one undo step.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить id картинок v1.2" 
// Автор Sclex

import { Changes, forEachNode, hasId, t } from './lib/book.js';

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  let removed = 0;
  // Every div.image of every div.body.
  for (const body of snapshot.bodies ?? []) {
    forEachNode(body, (node, ancestors) => {
      if (node.type !== 'image' || !hasId(node)) return;
      delete node.attrs.id;
      changes.mark(node, ancestors);
      removed += 1;
    });
  }
  if (!(await changes.commit(ctx, ctx.script.name))) return;
  await mfbe.ui.message(t(ctx, `Всего удалено id картинок: ${removed}`, `Picture ids removed in all: ${removed}`), { caption: ctx.script.name, icon: 'info' });
}
