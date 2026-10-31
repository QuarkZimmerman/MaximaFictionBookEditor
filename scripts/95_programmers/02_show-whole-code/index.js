// Converted from FictionBook Editor 2.7: Scripts/20_Инструменты отладки/02_Показать весь код.js,
// brought up to FictionBook Editor 2.7.9: Scripts/95_Для программистов/02_Показать весь код.js
// (no header version), Tier 4.
// The original opens a window of its own with the full HTML of the nearest container of the
// caret, for debugging scripts against the editor's internal representation; 2.7.9 opens it from
// HTML/Показать весь код.html (2.7beta1's Scripts/debug.htm, the same page) and makes it
// resizable. Scripts now see the book as the JSON document model, so the complete JSON of the
// nearest container (section, title, poem, cite, …) is shown, in a report window
// (mfbe.ui.report): like the original's window it can be resized and stays open after the run,
// and its text can be copied or saved. The element is looked up in the whole book, so that a
// caret in the book's annotation or history - which the Body view shows first, as FictionBook
// Editor did - shows the annotation or the history.
// The original's notice, kept as written (FR-029):
//======================================
// Отображение HTML кода текущего раздела (only for script debugging)
// THX to mkb (Konstantin Matveev) for ingenious idea
//======================================
// The notice of the original's page HTML/Показать весь код.html, kept as written:
// <meta name="author" content="Jurgen">

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/**
 * The node with this id and its parent, from the whole book: the annotation and the history,
 * then the bodies.
 */
function locate(doc, nodeId) {
  const visit = (node, parent) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return null;
    if (node.attrs?.nodeId === nodeId) return { node, parent };
    for (const child of node.content ?? []) {
      const found = visit(child, node);
      if (found) return found;
    }
    return null;
  };
  const roots = [doc.description?.titleInfo?.annotation, doc.description?.documentInfo?.history, ...(doc.bodies ?? [])];
  for (const root of roots) {
    const found = visit(root, null);
    if (found) return found;
  }
  return null;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  const found = selection ? locate(await mfbe.doc.get(), selection.anchor.nodeId) : null;
  if (!found) {
    await mfbe.ui.message(t(ctx, 'Поставьте курсор в текст книги.', 'Place the caret in the text of the book.'), { icon: 'warning' });
    return;
  }
  const container = ['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date'].includes(found.node.type) && found.parent
    ? found.parent
    : found.node;
  const text = JSON.stringify(container, null, 2);
  await mfbe.ui.report({
    title: t(ctx, `Код элемента «${container.type}» (${text.length} символов)`, `Code of the "${container.type}" element (${text.length} characters)`),
    text,
  });
}
