// Converted from FictionBook Editor 2.7.9: Scripts/08_Структура разделов/03_Раздел под курсором -
// обрамить другим (новым) разделом.js (2.7beta1's 03_Опустить раздел на один уровень.js before
// feature 007, the same code under a new name and with new messages), Tier 2. The innermost
// section holding the start of the selection keeps its title, epigraphs, image and annotation;
// everything after them is wrapped into one new nested section. The original happily produced an
// empty nested section when there was nothing to wrap; here that case is reported instead,
// because an empty section is not valid FB2.
// The original's notice, kept as written (FR-029):
// СКрипт "Раздел под курсором - обрамить другим (новым) разделом
// Автор  Sclex
// версия 1.0

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const HEADER = new Set(['title', 'epigraph', 'image', 'annotation']);

/** The start of a selection in document order (its caret when it is collapsed). */
function startOf(selection) {
  const { anchor, head, nodes } = selection;
  if (anchor.nodeId === head.nodeId) return anchor.offset <= head.offset ? anchor : head;
  return nodes.length && nodes[0].nodeId === head.nodeId ? head : anchor;
}

export default async function run(ctx) {
  // The original marked the start of the selection (tr.collapse() collapses to the start) and
  // went up from the mark to the nearest section.
  const sel = await mfbe.selection.get();
  const start = sel ? startOf(sel) : null;
  let ref = start ? { nodeId: start.nodeId, type: (await mfbe.doc.getNode(start.nodeId)).type } : null;
  while (ref && ref.type !== 'section') ref = await mfbe.doc.parentOf(ref);
  if (!ref) {
    await mfbe.ui.message(t(ctx, 'Ошибка. Курсор не внутри раздела.', 'Error: the caret is not inside a section.'), { icon: 'error' });
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
      t(
        ctx,
        'В разделе нет содержимого, которое можно обрамить другим разделом.',
        'The section has no content to wrap in another section.',
      ),
      { icon: 'warning' },
    );
    return;
  }
  await mfbe.doc.replaceNode(ref, {
    ...section,
    content: [...header, { type: 'section', attrs: {}, content: rest }],
  });
  await mfbe.ui.message(
    t(
      ctx,
      'Раздел под курсором был успешно обрамлен другим (новым) разделом.',
      'The section at the caret was wrapped in another (new) section.',
    ),
  );
}
