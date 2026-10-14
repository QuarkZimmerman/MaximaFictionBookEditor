// Converted from 05_Иллюстрации/09_Сделать обычный рисунок из рисунка в тексте.js (FictionBook
// Editor 2.7), Tier 2. The selected inline image, when it is the only content of its paragraph,
// becomes a block image in place of the paragraph (href and alt are kept). Paragraphs that also
// hold text are left alone, as in the original.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт «Сделать обычный рисунок из рисунка в тексте.js»
//Версия 1.0

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const sel = await mfbe.selection.get();
  // A selected image shows up as a one-character selection whose text is U+FFFC.
  if (!sel || sel.text !== '\uFFFC') {
    await mfbe.ui.message(t(ctx, 'Картинка не выделена, скрипту нечего делать.', 'No image is selected; nothing to do.'), { icon: 'warning' });
    return;
  }
  if (sel.nodes.length !== 1) {
    await mfbe.ui.message(t(ctx, 'Выделена не инлайн-картинка.', 'The selected image is not an inline image.'), { icon: 'warning' });
    return;
  }
  const paragraph = await mfbe.doc.getNode(sel.nodes[0]);
  const content = paragraph.content ?? [];
  const offset = Math.min(sel.anchor.offset, sel.head.offset);
  let pos = 0;
  let image = null;
  for (const child of content) {
    const len = child.type === 'text' ? child.text.length : 1;
    if (pos === offset && child.type === 'inline-image') image = child;
    pos += len;
  }
  if (!image) {
    await mfbe.ui.message(t(ctx, 'Выделена не инлайн-картинка.', 'The selected image is not an inline image.'), { icon: 'warning' });
    return;
  }
  if (content.some((c) => c.type === 'text')) return; // the paragraph has text too: not converted
  const attrs = { href: image.attrs.href };
  if (image.attrs.alt) attrs.alt = image.attrs.alt;
  await mfbe.doc.replaceNode(paragraph.attrs.nodeId, { type: 'image', attrs });
}
