// Converted from 05_Иллюстрации/05_Удалить все вложения.js (FictionBook Editor 2.7), Tier 2.
// Asks for confirmation and removes every binary object of the book (the images stay and point
// to nothing, as in the original).
//
// LIMITATION (documented in docs/scripting/conversion-notes-a.md): the script API exposes binary
// objects as metadata only and has no call to remove one. The script therefore explains the
// situation after the confirmation; it removes the objects as soon as `mfbe.doc.removeBinary(id)`
// exists.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const answer = await mfbe.ui.message(
    t(ctx, 'Вы действительно хотите удалить все вложения из книги?', 'Do you really want to remove all binary objects from the book?'),
    { icon: 'question', buttons: [{ id: 'yes', label: '', default: true }, { id: 'no', label: '', cancel: true }] },
  );
  if (answer !== 'yes') return;
  const binaries = await mfbe.doc.binaries();
  if (typeof mfbe.doc.removeBinary !== 'function') {
    await mfbe.ui.message(
      t(ctx,
        `Интерфейс скриптов этой версии не позволяет удалять вложения (в книге их ${binaries.length}). Удалите их в панели «Бинарные объекты».`,
        `The script interface of this version cannot remove binary objects (the book has ${binaries.length}). Remove them in the Binary Objects panel.`),
      { icon: 'warning' },
    );
    return;
  }
  for (let i = 0; i < binaries.length; i += 1) {
    await mfbe.doc.removeBinary(binaries[i].id);
    await mfbe.ui.progress(i + 1, binaries.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.message(t(ctx, 'Работа скрипта завершена, все вложения удалены из книги.', 'Done: all binary objects were removed from the book.'));
}
