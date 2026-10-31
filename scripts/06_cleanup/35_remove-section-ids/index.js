// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/35_Удалить id разделов.js
// Removes the id attribute of every section, at any depth, of every body except the notes body (and
// a body named "comments"): there the section ids are the targets of the note links. Reports the
// number of removed ids.
// Differences: none in the result; the run is one undo step.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить id разделов v1.2" 
// Автор Sclex

import { Changes, bodyName, forEachNode, hasId, t } from './lib/book.js';

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  let removed = 0;
  // Every div.section of every div.body whose fbname is neither "notes" nor "comments".
  for (const body of snapshot.bodies ?? []) {
    const name = bodyName(body);
    if (name === 'notes' || name === 'comments') continue;
    forEachNode(body, (node, ancestors) => {
      if (node.type !== 'section' || !hasId(node)) return;
      delete node.attrs.id;
      changes.mark(node, ancestors);
      removed += 1;
    });
  }
  if (!(await changes.commit(ctx, ctx.script.name))) return;
  await mfbe.ui.message(t(ctx, `Всего удалено id разделов: ${removed}`, `Section ids removed in all: ${removed}`), { caption: ctx.script.name, icon: 'info' });
}
