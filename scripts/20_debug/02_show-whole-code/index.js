// Converted from 20_Инструменты отладки/02_Показать весь код.js (FictionBook Editor 2.7), Tier 4.
// The original opened debug.htm in a separate window with the full HTML of the nearest
// container of the caret. Scripts now see the book as the JSON document model, so the complete
// JSON of the nearest container (section, title, poem, cite, …) is shown in a form with a
// multi-line box from which it can be copied.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
// Отображение HTML кода текущей секции (only for script debugging)
// THX to mkb (Konstantin Matveev) for ingenious idea
//======================================
// Notice of the original page Scripts/debug.htm (FictionBook Editor 2.7, GPL-3.0), kept as written:
// <meta name="author" content="Jurgen">

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection) {
    await mfbe.ui.message(t(ctx, 'Поставьте курсор в текст книги.', 'Place the caret in the text of the book.'), { icon: 'warning' });
    return;
  }
  const node = await mfbe.doc.getNode(selection.anchor);
  const container = ['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date'].includes(node.type)
    ? await mfbe.doc.getNode(await mfbe.doc.parentOf(selection.anchor))
    : node;
  const text = JSON.stringify(container, null, 2);
  await mfbe.ui.form({
    title: t(ctx, `Код элемента «${container.type}» (${text.length} символов)`, `Code of the "${container.type}" element (${text.length} characters)`),
    width: 1000,
    fields: [
      { kind: 'static', id: 'help', text: t(ctx, 'Документная модель элемента в формате JSON (так его видят скрипты). Изменения в этом окне в книгу не попадают.', 'The document model of the element as JSON (the way scripts see it). Edits made here do not reach the book.') },
      { kind: 'text', id: 'code', label: 'JSON', multiline: true, value: text },
    ],
    okLabel: t(ctx, 'Закрыть', 'Close'),
  });
}
