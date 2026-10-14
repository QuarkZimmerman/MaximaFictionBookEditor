// Converted from 18_Мелочи редактирования/04_Вставить пустую строку перед стихом или цитатой.js
// (FictionBook Editor 2.7), Tier 2. Inserts an empty line before the poem or cite that contains
// the start of the selection (the original pasted an empty <P>, which FBE saved as <empty-line/>).
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// Скрипт "Вставить пустую строку перед стихом или цитатой"
// Версия 1.0
// Автор Sclex

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection) return;
  const { anchor, head, nodes } = selection;
  const forward = anchor.nodeId === head.nodeId ? anchor.offset <= head.offset : nodes[0]?.nodeId === anchor.nodeId;
  let node = await mfbe.doc.parentOf(forward ? anchor : head);
  while (node && node.type !== 'poem' && node.type !== 'cite') node = await mfbe.doc.parentOf(node);
  if (!node) {
    await mfbe.ui.status(t(ctx, 'Курсор не внутри стиха или цитаты.', 'The caret is not inside a poem or a cite.'));
    return;
  }
  try {
    await mfbe.doc.insertNode('before', node, { type: 'empty-line', attrs: {} });
  } catch (error) {
    await mfbe.ui.message(
      t(ctx, 'Здесь нельзя вставить пустую строку: ', 'An empty line cannot be inserted here: ') + error.message,
      { icon: 'error' },
    );
  }
}
