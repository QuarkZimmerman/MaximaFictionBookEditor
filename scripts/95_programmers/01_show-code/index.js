// Converted from 20_Инструменты отладки/01_Показать код.js (FictionBook Editor 2.7), Tier 4.
// The original showed the HTML of the nearest container of the caret in a message box, for
// debugging scripts against the editor's internal representation. Scripts now see the book as
// the JSON document model, so that is what is shown: the JSON of the nearest container
// (section, title, poem, cite, …) of the caret, shortened like a message box would be. The
// companion "Show whole code" opens the complete text in a report window. FictionBook Editor
// 2.7.9 has the same code (Scripts/95_Для программистов/01_Показать код.js).
// The element is looked up in the whole book, so that a caret in the book's annotation or
// history - which the Body view shows first, as FictionBook Editor did - shows the annotation or
// the history (the conversion of 0.0.1 asked doc.getNode, which knows the bodies only).
// The original's header, kept as written:
//======================================
// Displays HTML code for the current
// section (only for script debugging)
//======================================

const LIMIT = 2000;

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

/** JSON of the nearest structural container of the selection, with node ids left in. */
async function containerJson() {
  const selection = await mfbe.selection.get();
  if (!selection) return null;
  const found = locate(await mfbe.doc.get(), selection.anchor.nodeId);
  if (!found) return null;
  const container = ['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date'].includes(found.node.type) && found.parent
    ? found.parent
    : found.node;
  return { type: container.type, text: JSON.stringify(container, null, 2) };
}

export default async function run(ctx) {
  const code = await containerJson();
  if (!code) {
    await mfbe.ui.message(t(ctx, 'Поставьте курсор в текст книги.', 'Place the caret in the text of the book.'), { icon: 'warning' });
    return;
  }
  const text = code.text.length > LIMIT
    ? code.text.slice(0, LIMIT) + t(ctx, `\n… (ещё ${code.text.length - LIMIT} символов — см. «Показать весь код»)`, `\n… (${code.text.length - LIMIT} more characters - see "Show whole code")`)
    : code.text;
  await mfbe.ui.message(text, { caption: t(ctx, `Код элемента «${code.type}»`, `Code of the "${code.type}" element`) });
}
