// Converted from 20_Инструменты отладки/01_Показать код.js (FictionBook Editor 2.7), Tier 4.
// The original showed the HTML of the nearest container of the caret in a message box, for
// debugging scripts against the editor's internal representation. Scripts now see the book as
// the JSON document model, so that is what is shown: the JSON of the nearest container
// (section, title, poem, cite, …) of the caret, shortened like a message box would be. The
// companion "Show whole code" opens the complete text in an editable box.

const LIMIT = 2000;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** JSON of the nearest structural container of the selection, with node ids left in. */
async function containerJson() {
  const selection = await mfbe.selection.get();
  if (!selection) return null;
  const node = await mfbe.doc.getNode(selection.anchor);
  const container = ['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date'].includes(node.type)
    ? await mfbe.doc.getNode(await mfbe.doc.parentOf(selection.anchor))
    : node;
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
