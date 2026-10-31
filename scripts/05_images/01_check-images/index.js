// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/01_Проверить иллюстрации.js
// (Alex Saveliev, version 1.11; 2.7beta1's 01_Проверка иллюстраций.js, 1.1, before feature 007).
// Reports the binary objects that no picture and no cover uses and the pictures whose binary
// object is missing. Read-only: the book is not changed. The pictures are those the original read
// in FictionBook Editor's text view: the book's annotation, the history and every body. 2.7.9 (a
// fix by stokber) gives up with "no cover nor illustrations" only when the book has neither
// pictures nor binary objects, so pictures in a book without binary objects are listed as missing.
//
// Differences from the original (docs/scripting/conversion-notes-279-a.md, group 05):
// - the src-title-info cover counts as used too, and a binary is a cover when its id is the
//   cover's address (the original looked for the id in the text of the title-info cover list);
// - a picture with an address outside the book is listed under its address; the original listed
//   what follows the 14th character of the picture's internal address, so "ttp://..." for a web
//   address;
// - the banner lines are not centred with spaces.
// The original's notice, kept as written (FR-029):
//======================================
// Поиск отсутствующих или неиспользуемых изображений
//                  Alex Saveliev script for FBW2         version 1.11
//======================================

// TO DO: Go to the first broken image if any

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The binary an address names ("#id"), or null for an address outside the book. */
function localHref(href) {
  return typeof href === 'string' && href.startsWith('#') ? href.slice(1) : null;
}

export default async function run(ctx) {
  const doc = await mfbe.doc.get();
  const covers = new Set();
  for (const info of [doc.description.titleInfo, doc.description.srcTitleInfo]) {
    for (const ref of info?.coverpage ?? []) {
      const id = localHref(ref.href);
      if (id) covers.add(id);
    }
  }
  // The pictures in the order of the original's text view: the book's annotation, the history,
  // then the bodies.
  const images = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') images.push(node.attrs?.href ?? '');
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc.description.titleInfo?.annotation);
  visit(doc.description.documentInfo?.history);
  for (const body of doc.bodies) visit(body);
  const imageIds = new Set(images.map(localHref).filter(Boolean));
  const binaries = doc.binaries.map((b) => b.id);
  const binaryIds = new Set(binaries);

  if (images.length === 0 && binaries.length === 0) {
    await mfbe.ui.message(t(ctx, '\nВ этой книге нет ни обложки, ни иллюстраций. \n\n', '\nThis book has neither a cover nor illustrations. \n\n'));
    return;
  }

  let unused = binaries.filter((id) => !imageIds.has(id) && !covers.has(id)).map((id) => ` • ${id}\n`).join('');
  if (!unused) {
    unused = binaries.length > 0
      ? t(ctx, ' • все используются\n', ' • all are used\n')
      : t(ctx, ' • нет бинарных объектов\n', ' • no binary objects\n');
  }
  // Every picture without a binary of the book: by the id it names, or by its address.
  let broken = images
    .filter((href) => !binaryIds.has(localHref(href)))
    .map((href) => ` • ${localHref(href) ?? href}\n`)
    .join('');
  if (!broken) broken = t(ctx, ' • не найдено\n', ' • none\n');

  await mfbe.ui.message(
    t(ctx,
      `—= AlexS Script=—\n«Проверка иллюстраций» v.1.11\n\n\nНеиспользуемые бинарные объекты: \n${unused}\nОтсутствующие иллюстрации: \n${broken}\n`,
      `—= AlexS Script=—\n"Check illustrations" v.1.11\n\n\nUnused binary objects: \n${unused}\nMissing illustrations: \n${broken}\n`),
  );
}
