// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/30_Удалить id абзацев.js
// Removes the id attribute of every text block of every body (the notes body included): paragraphs,
// verses, subtitles, text authors, table cells - what the original's page showed as <P>, the title
// and epigraph paragraphs among them. The title-info annotation and the document-info history are
// not bodies and keep their ids, as in the original. Reports the number of removed ids.
// Differences: none in the result; the run is one undo step (the original opened its undo unit only
// when it removed something).
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить id абзацев v1.2" 
// Автор Sclex

import { Changes, forEachNode, hasId, t } from './lib/book.js';

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  let removed = 0;
  // Every <P> of every div.body: the text blocks of every body; empty ids stay.
  for (const body of snapshot.bodies ?? []) {
    forEachNode(body, (node, ancestors) => {
      if (node.type === 'p' || node.type === 'v' || node.type === 'subtitle' || node.type === 'text-author' || node.type === 'td' || node.type === 'th') {
        if (!hasId(node)) return;
        delete node.attrs.id;
        changes.mark(node, ancestors);
        removed += 1;
      }
    });
  }
  if (!(await changes.commit(ctx, ctx.script.name))) return;
  await mfbe.ui.message(t(ctx, `Всего удалено id абзацев: ${removed}`, `Paragraph ids removed in all: ${removed}`), { caption: ctx.script.name, icon: 'info' });
}
