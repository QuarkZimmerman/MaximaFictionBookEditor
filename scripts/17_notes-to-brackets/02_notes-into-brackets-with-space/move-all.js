// Shared body of scripts 01 and 02 of 17_Перенос примечаний в скобки: every reference to a note
// or comment is replaced by the bracketed note text, then the notes/comments bodies are removed.
import { indexTargets, loadBodies, moveReferencesOfBlock, t, textBlocksOf } from './notes-lib.js';

export async function moveAllNotes(ctx, { spaceBefore }) {
  const bodies = await loadBodies();
  const targets = indexTargets(bodies);
  const moved = [];
  const isNoteBody = (b) => b.json.attrs?.name === 'notes' || b.json.attrs?.name === 'comments';
  // Like the original: first the note links inside the notes/comments bodies (a note quoting
  // another note), then every link of the ordinary bodies; always last to first.
  for (const pass of [
    { bodies: bodies.filter(isNoteBody), eligible: (run) => run.type === 'note' },
    { bodies: bodies.filter((b) => !isNoteBody(b)), eligible: () => true },
  ]) {
    for (const body of [...pass.bodies].reverse()) {
      for (const block of textBlocksOf(body.json).reverse()) {
        await moveReferencesOfBlock(block.attrs.nodeId, targets, pass.eligible, spaceBefore, moved);
      }
    }
  }
  // The original deleted the notes and comments bodies wholesale. The script API cannot remove
  // a body (doc.removeNode refuses bodies), so the inlined note sections are removed instead
  // and the user is told when a body is left behind.
  let bodiesLeft = 0;
  for (const body of bodies.filter(isNoteBody)) {
    try {
      await mfbe.doc.removeNode(body.ref);
      continue;
    } catch {
      bodiesLeft += 1;
    }
    for (const sectionId of new Set(moved)) {
      try {
        await mfbe.doc.removeNode(sectionId);
      } catch {
        // the last section of a body cannot go: FB2 needs one
      }
    }
  }
  const lines = [
    t(ctx, `Перенесено примечаний и комментариев: ${moved.length}`, `Notes and comments moved into brackets: ${moved.length}`),
  ];
  if (bodiesLeft) {
    lines.push('', t(ctx,
      'Тела примечаний/комментариев удалить не удалось (скриптам это недоступно): перенесённые примечания удалены по отдельности, остальное удалите вручную в дереве документа.',
      'The notes/comments bodies could not be removed (scripts are not allowed to): the moved note sections were removed one by one, delete the rest by hand in the Document Tree.'));
  }
  await mfbe.ui.message(lines.join('\n'));
}
