// Converted from FictionBook Editor 2.7.9: Scripts/40_Таблицы/01_Показать следующую таблицу в HTML-виде.js
// Selects the next table after the caret (or after the end of the selection; a table the caret is
// in is skipped) and shows it as an HTML table in a report window (lib/table-html.js), where Copy
// and Save as… give its HTML. Without a table up to the end of the book it says so and puts the
// caret at the end of the selection.
// Differences from 2.7.9: the window is the editor's report window (mfbe.ui.report), not an IE
// window; the setting "display" for the default browser is gone, it needed a temporary file and
// another program (Save as… gives the file); the table is written from the book's table, not by
// rewriting the page's HTML; the characters □▫◦ stay (they stood for non-breaking spaces in
// FictionBook Editor's view, while this editor keeps non-breaking spaces as such); a picture in a
// cell shows its name; the tables of the book's annotation and history are not looked at (the
// search runs through the bodies). Fixed: an empty cell no longer takes the next cell's text
// (2.7.9's expression wanted at least one character in a cell).
// The original's notice, kept as written (FR-029):
// Скрипт "Показать следующую таблицу в HTML-виде"
// В скрипте использован код из скрипта
// "Перейти на следующую таблицу" (автор Sclex, сборка TaKir).
// Доработка до заявленного функционала — stokber.
// Версия 1.3 (сентябрь, 2025).

import { reportHtml, t, tableHtml } from './lib/table-html.js';

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date', 'empty-line']);

export default async function run(ctx) {
  const name = 'Показать следующую таблицу в HTML-виде';
  const ver = '1.3';
  const selection = await mfbe.selection.get();
  if (!selection) return;
  await mfbe.ui.status(t(ctx, 'Переходим на следующую таблицу…', 'Going to the next table…'));

  // The P elements of the page: the text blocks of the bodies in document order, with the table
  // each one is in.
  const doc = await mfbe.doc.get();
  const blocks = [];
  const visit = (node, table) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      blocks.push({ nodeId: node.attrs?.nodeId, table });
      return;
    }
    for (const child of node.content ?? []) visit(child, node.type === 'table' ? node : table);
  };
  for (const body of doc.bodies) visit(body, null);

  // The search starts after the block of the selection's end.
  const index = (pos) => blocks.findIndex((b) => b.nodeId === pos.nodeId);
  const [a, h] = [index(selection.anchor), index(selection.head)];
  const end = a > h || (a === h && selection.anchor.offset > selection.head.offset) ? selection.anchor : selection.head;
  const endIndex = Math.max(a, h);
  const blockElementAtStart = endIndex >= 0 ? blocks[endIndex].table : null;
  let found = null;
  for (let i = endIndex + 1; i < blocks.length; i++) {
    if (blocks[i].table && blocks[i].table !== blockElementAtStart) {
      found = blocks[i].table;
      break;
    }
  }

  if (!found) {
    await mfbe.ui.message(
      t(
        ctx,
        "До конца документа не нашлось ни одной таблицы!\n\nСкрипт '" + name + "' " + ver + '.',
        "No table was found up to the end of the document!\n\nScript 'Show the next table as HTML' " + ver + '.',
      ),
      { caption: ctx.script.name },
    );
    await mfbe.selection.set(end); // the caret goes to the end of the selection
    return;
  }

  await mfbe.selection.selectNode(found.attrs.nodeId);
  await mfbe.ui.report({ title: t(ctx, ' :: Таблицы в виде HTML :: ', ' :: Tables as HTML :: '), html: reportHtml(tableHtml(found)) });
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'));
}
