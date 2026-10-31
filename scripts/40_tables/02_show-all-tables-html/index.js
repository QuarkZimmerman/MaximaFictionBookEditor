// Converted from FictionBook Editor 2.7.9: Scripts/40_Таблицы/02_Показать все-все таблицы в HTML-виде.js
// Shows every table of the book (the annotation, the history and all bodies, in this order) as
// HTML tables in one report window (lib/table-html.js), each under a line "Табл. N из M", where
// Copy and Save as… give the HTML. A book without tables gets a message.
// Differences from 2.7.9: the window is the editor's report window (mfbe.ui.report), not an IE
// window; the setting "display" for the default browser is gone, it needed a temporary file and
// another program (Save as… gives the file); the tables are written from the book's tables, not
// by keeping the table lines of the page's HTML; the characters □▫◦ stay (they stood for
// non-breaking spaces in FictionBook Editor's view, while this editor keeps non-breaking spaces as
// such); a picture in a cell shows its name. Fixed: a table or cell whose id was not a word (a
// hyphen in it) is shown and counted like the others (2.7.9 left it out of the count and showed
// its rows without the table).
// The original's notice, kept as written (FR-029):
// Скрипт "Показать все-все таблицы в HTML-виде v.1.3"
// автор - stokber, (сентябрь, 2025).

import { reportHtml, t, tableHtml } from './lib/table-html.js';

export default async function run(ctx) {
  const name = 'Показать все-все таблицы в HTML-виде';
  const ver = '1.3';
  const doc = await mfbe.doc.get();

  // The page held the annotation and the history before the bodies.
  const tables = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (node.type === 'table') {
      tables.push(node);
      return;
    }
    if (['p', 'subtitle', 'text-author', 'v', 'date'].includes(node.type)) return;
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc.description.titleInfo.annotation);
  visit(doc.description.documentInfo.history);
  for (const body of doc.bodies) visit(body);

  if (!tables.length) {
    await mfbe.ui.message(
      t(ctx, "В документе таблиц не найдено!\n\nСкрипт '" + name + "' v." + ver + '.', "No tables were found in the document!\n\nScript 'Show all tables as HTML' v." + ver + '.'),
      { caption: ctx.script.name },
    );
    return;
  }
  const countTable = tables.length;
  const html = tables
    .map((table, i) => `<P>${t(ctx, 'Табл.', 'Table')} ${i + 1} ${t(ctx, 'из', 'of')} ${countTable}</P>\r\n${tableHtml(table)}<BR><BR><BR><BR>`)
    .join('\r\n');
  await mfbe.ui.report({ title: t(ctx, ' :: Таблицы в виде HTML :: ', ' :: Tables as HTML :: '), html: reportHtml(html) });
}
