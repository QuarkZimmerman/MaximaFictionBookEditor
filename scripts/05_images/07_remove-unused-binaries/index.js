// Converted from 05_Иллюстрации/07_Удаление неиспользуемых вложений....js (FictionBook Editor 2.7),
// Tier 2. Removes the binary objects that no image (block or inline) and no cover page refers
// to. An image with an external address (no "#") makes the script ask whether to go on, as the
// original did; ids are compared case-insensitively like the original.
//
// LIMITATION (documented in docs/scripting/conversion-notes-a.md): the script API has no call to
// remove a binary object. The unused objects are listed instead; they are removed as soon as
// `mfbe.doc.removeBinary(id)` exists.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт «Удаление неиспользуемых картинок»
//Автор Sclex
//http://www.fictionbook.org/forum/viewtopic.php?t=4412

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function localHref(href) {
  if (typeof href !== 'string' || !href.startsWith('#')) return null;
  return href.slice(1);
}

export default async function run(ctx) {
  const started = Date.now();
  const doc = await mfbe.doc.get();
  const used = new Set();
  let nonLocal = false;
  const visit = (node) => {
    if (node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') {
      const id = localHref(node.attrs?.href ?? '');
      if (id === null) nonLocal = true;
      else used.add(id.toLowerCase());
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body);
  for (const info of [doc.description.titleInfo, doc.description.srcTitleInfo]) {
    for (const ref of info?.coverpage ?? []) {
      const id = localHref(ref.href ?? '');
      if (id === null) nonLocal = true;
      else used.add(id.toLowerCase());
    }
  }
  if (nonLocal) {
    const answer = await mfbe.ui.message(
      t(ctx,
        'В книге есть по меньшей мере одна картинка, которая имеет адрес без решетки, т.е. указывает на картинку вне документа. Хотите ли вы продолжить удаление неиспользуемых картинок?',
        'At least one image of the book has an address without "#", i.e. it points outside the document. Do you want to continue removing unused binary objects?'),
      { icon: 'question', buttons: [{ id: 'ok', label: '', default: true }, { id: 'cancel', label: '', cancel: true }] },
    );
    if (answer !== 'ok') return;
  }
  const unused = doc.binaries.filter((b) => !used.has(b.id.toLowerCase()));
  if (typeof mfbe.doc.removeBinary !== 'function') {
    const list = unused.map((b) => `\n   "${b.id}"`).join('');
    await mfbe.ui.message(
      t(ctx,
        `Неиспользуемых вложений: ${unused.length}.${list}\n\nИнтерфейс скриптов этой версии не позволяет удалять вложения; удалите их в панели «Бинарные объекты».`,
        `Unused binary objects: ${unused.length}.${list}\n\nThe script interface of this version cannot remove binary objects; remove them in the Binary Objects panel.`),
      { icon: unused.length ? 'warning' : 'info' },
    );
    return;
  }
  for (const b of unused) await mfbe.doc.removeBinary(b.id);
  const ms = Date.now() - started;
  const time = `${ms < 1000 ? Math.ceil(ms) / 1000 : Math.ceil(ms / 100) / 10} ${t(ctx, 'сек', 's')}`;
  await mfbe.ui.message(
    t(ctx, `Удаление неиспользуемых картинок v1.0\nАвтор Sclex.\n\nЗатраченное время: ${time}.\nУдалено вложений: ${unused.length}.`,
      `Removal of unused binary objects v1.0\nAuthor: Sclex.\n\nTime taken: ${time}.\nBinary objects removed: ${unused.length}.`),
  );
}
