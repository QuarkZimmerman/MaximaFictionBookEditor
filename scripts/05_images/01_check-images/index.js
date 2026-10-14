// Converted from 05_Иллюстрации/01_Проверка иллюстраций.js (FictionBook Editor 2.7), Tier 2.
// Reports the binary objects no image refers to (the cover pages count as references) and the
// images whose binary object is missing. Read-only: the document is not changed.
// The original only knew the title-info cover; the src-title-info cover is honoured here too so
// that it is not reported as unused.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
// Поиск отсутствующих или неиспользуемых изображений
//                  Alex Saveliev script for FBW2         version 1.1
//======================================
//
// TO DO: Go to the first broken image if any

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function localHref(href) {
  const hash = typeof href === 'string' ? href.indexOf('#') : -1;
  return hash < 0 ? null : href.slice(hash + 1);
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
  const images = [];
  const visit = (node) => {
    if (node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') images.push(node.attrs?.href ?? '');
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies) visit(body);
  const imageIds = new Set(images.map(localHref).filter(Boolean));
  const binaries = doc.binaries.map((b) => b.id);
  const binaryIds = new Set(binaries);

  if (binaries.length === 0) {
    // The original's test (`imgs.length==0, bins.length==0`) only looked at the binaries.
    await mfbe.ui.message(t(ctx, '\nВ этой книге нет ни обложки, ни иллюстраций. \n\n', '\nThis book has neither a cover nor illustrations. \n\n'));
    return;
  }

  let unused = binaries.filter((id) => !imageIds.has(id) && !covers.has(id)).map((id) => ` • ${id}\n`).join('');
  if (!unused) unused = t(ctx, ' • все используются\n', ' • all are used\n');
  let broken = images.map(localHref).filter((id) => id && !binaryIds.has(id)).map((id) => ` • ${id}\n`).join('');
  if (!broken) broken = t(ctx, ' • не найдено\n', ' • none\n');

  await mfbe.ui.message(
    t(ctx,
      `—= AlexS Script=—\n«Проверка иллюстраций» v.1.1\n\n\nНеиспользуемые бинарные объекты: \n${unused}\nОтсутствующие иллюстрации: \n${broken}\n`,
      `—= AlexS Script=—\n"Check illustrations" v.1.1\n\n\nUnused binary objects: \n${unused}\nMissing illustrations: \n${broken}\n`),
  );
}
