// Converted from 08_Структура разделов/03_Опустить раздел на один уровень.js (FictionBook Editor
// 2.7), Tier 2. The innermost section holding the caret keeps its title, epigraphs, image and
// annotation; everything after them is wrapped into one new nested section.
// The original happily produced an empty nested section when there was nothing to wrap; here
// that case is reported instead, because an empty section is not valid FB2.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const HEADER = new Set(['title', 'epigraph', 'image', 'annotation']);

export default async function run(ctx) {
  const sel = await mfbe.selection.get();
  let ref = sel ? { nodeId: sel.anchor.nodeId, type: (await mfbe.doc.getNode(sel.anchor.nodeId)).type } : null;
  while (ref && ref.type !== 'section') ref = await mfbe.doc.parentOf(ref);
  if (!ref) {
    await mfbe.ui.message(t(ctx, 'Ошибка. Курсор не внутри секции.', 'Error: the caret is not inside a section.'), { icon: 'error' });
    return;
  }
  const section = await mfbe.doc.getNode(ref);
  const header = [];
  const rest = [];
  let inHeader = true;
  for (const child of section.content ?? []) {
    if (inHeader && HEADER.has(child.type)) header.push(child);
    else {
      inHeader = false;
      rest.push(child);
    }
  }
  if (rest.length === 0) {
    await mfbe.ui.message(
      t(ctx, 'В секции нет содержимого, которое можно опустить.', 'The section has no content to lower.'),
      { icon: 'warning' },
    );
    return;
  }
  await mfbe.doc.replaceNode(ref, {
    ...section,
    content: [...header, { type: 'section', attrs: {}, content: rest }],
  });
  await mfbe.ui.message(t(ctx, 'Внутренности секции опущенны.', 'The content of the section was lowered one level.'));
}
