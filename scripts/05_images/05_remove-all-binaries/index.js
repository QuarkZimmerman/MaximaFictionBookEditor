// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/05_Удалить все вложения.js
// (version 1.4; 2.7beta1's file of the same name, 1.3, before feature 007). Asks for a
// confirmation and removes every binary object of the book (the pictures stay and point to
// nothing, as in the original). 2.7.9 speaks of the document where 2.7beta1 said the book.
//
// LIMITATION (docs/scripting/conversion-notes-279-a.md, group 05): the script interface has no
// call to remove a binary object. The script therefore explains the situation after the
// confirmation; it removes the objects as soon as `mfbe.doc.removeBinary(id)` exists. The undo
// step carries the package's label; the original's ("удаление всех вложений") is its step name.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить все вложения"
// Версия 1.4

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const answer = await mfbe.ui.message(
    t(ctx, 'Вы действительно хотите удалить все вложения из документа?', 'Do you really want to remove all binary objects from the document?'),
    { icon: 'question', buttons: [{ id: 'yes', label: '', default: true }, { id: 'no', label: '', cancel: true }] },
  );
  if (answer !== 'yes') return;
  await mfbe.edit.label(t(ctx, 'удаление всех вложений', 'removing all binary objects'));
  const binaries = await mfbe.doc.binaries();
  if (typeof mfbe.doc.removeBinary !== 'function') {
    await mfbe.ui.message(
      t(ctx,
        `Интерфейс скриптов этой версии не позволяет удалять вложения (в документе их ${binaries.length}). Удалите их в панели «Бинарные объекты».`,
        `The script interface of this version cannot remove binary objects (the document has ${binaries.length}). Remove them in the Binary Objects panel.`),
      { icon: 'warning' },
    );
    return;
  }
  for (let i = 0; i < binaries.length; i += 1) {
    await mfbe.doc.removeBinary(binaries[i].id);
    await mfbe.ui.progress(i + 1, binaries.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.message(t(ctx, 'Работа скрипта завершена, все вложения удалены из документа.', 'Done: all binary objects were removed from the document.'));
}
