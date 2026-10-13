// Converted from 17_Перенос примечаний в скобки/03_Перенос одного примечания в скобки.js
// (FictionBook Editor 2.7), Tier 2. With the caret inside a note (a section with an id in the
// notes or comments body) every reference to that note is replaced by its text in brackets
// (with a leading space), the note section is removed and the remaining notes and comments
// are renumbered (ids n_N / c_N, titles N, link texts [N] / {N}). Outside a note the original
// did nothing at all; a status line says so here.
import { indexTargets, loadBodies, localHref, moveReferencesOfBlock, t, textBlocksOf, unify } from './notes-lib.js';

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection) return;
  // The nearest section above the caret must have an id and sit in a notes/comments body.
  let node = await mfbe.doc.parentOf(selection.anchor);
  let section = null;
  while (node) {
    if (!section && node.type === 'section') section = node;
    if (node.type === 'body') break;
    node = await mfbe.doc.parentOf(node);
  }
  const body = node ? await mfbe.doc.getNode(node) : null;
  const bodyName = body?.attrs?.name;
  const sectionJson = section ? await mfbe.doc.getNode(section) : null;
  const id = sectionJson?.attrs?.id;
  if (!id || (bodyName !== 'notes' && bodyName !== 'comments')) {
    await mfbe.ui.status(t(ctx, 'Курсор должен стоять внутри примечания или комментария.', 'Place the caret inside a note or a comment.'));
    return;
  }
  const bodies = await loadBodies();
  const targets = indexTargets(bodies);
  const moved = [];
  for (const b of [...bodies].reverse()) {
    for (const block of textBlocksOf(b.json).reverse()) {
      await moveReferencesOfBlock(block.attrs.nodeId, targets, (run) => localHref(run.href) === id, true, moved);
    }
  }
  if (!moved.length) {
    await mfbe.ui.status(t(ctx, `Ссылок на примечание «${id}» не найдено.`, `No references to the note "${id}" were found.`));
    return;
  }
  try {
    await mfbe.doc.removeNode(section);
  } catch {
    await mfbe.ui.message(
      t(ctx, `Секцию примечания «${id}» удалить не удалось — это единственная секция тела; удалите её вручную.`,
        `The note section "${id}" could not be removed - it is the only section of its body; delete it by hand.`),
      { icon: 'warning' },
    );
  }
  if (await unify(ctx, 'notes')) await unify(ctx, 'comments');
  await mfbe.ui.status(t(ctx, `Перенесено ссылок: ${moved.length}`, `References moved into brackets: ${moved.length}`), { sticky: true });
}
