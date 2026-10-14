// Converted from 18_Мелочи редактирования/05_Вставить пустую строку за стихом, эпиграфом или цитатой.js
// (FictionBook Editor 2.7), Tier 2. Inserts an empty line after the poem, epigraph or cite that
// contains the end of the selection (the original pasted an empty <P>, saved as <empty-line/>).
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
// Скрипт "Вставить пустую строку за стихом, эпиграфом или цитатой"
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
  let node = await mfbe.doc.parentOf(forward ? head : anchor);
  while (node && node.type !== 'poem' && node.type !== 'cite' && node.type !== 'epigraph') {
    node = await mfbe.doc.parentOf(node);
  }
  if (!node) {
    await mfbe.ui.status(t(ctx, 'Курсор не внутри стиха, эпиграфа или цитаты.', 'The caret is not inside a poem, an epigraph or a cite.'));
    return;
  }
  try {
    await mfbe.doc.insertNode('after', node, { type: 'empty-line', attrs: {} });
  } catch (error) {
    // E.g. after an epigraph of a body or an epigraph followed by an annotation: FB2 forbids it.
    await mfbe.ui.message(
      t(ctx, 'Здесь нельзя вставить пустую строку: ', 'An empty line cannot be inserted here: ') + error.message,
      { icon: 'error' },
    );
  }
}
