// Shared helper of the converted «Показать … таблицы в HTML-виде» (FictionBook Editor 2.7.9,
// Scripts/40_Таблицы/01_ and 02_, by stokber). Each package carries its own, byte-identical copy:
// a script may import only files of its own folder.
//
// The originals took the HTML of the IE page (`htmlText` of the selected table, `innerHTML` of the
// whole book), removed the ids and styles, wrote the non-breaking spaces as spaces, took the "fb"
// prefix off the attributes and turned the page's DIV and P elements into an HTML table:
// `<table>`, `<tr align>`, `<td>` / `<th>` with colspan, rowspan, align and valign, the cells'
// formatting as the page held it. Here the same table is written from the table of the document
// model, so every cell and table comes out alike (the originals' expressions missed an empty cell
// in script 01 and a cell or table whose id was not a word); a picture in a cell shows its name,
// since a script cannot read a picture's bytes and a report shows only pictures embedded in it.

import { serializeInline } from './legacy-html.js';

/** `t(ctx, ru, en)`: the Russian text in the Russian interface, else the English one. */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The style of FictionBook Editor's window HTML/Показать таблицы в HTML-виде.html, kept as written. */
export const REPORT_STYLE = `body{ color: #000000; font-family: Arial Unicode MS, Candara, Verdana, Arial, Tahoma, Arial, sans-serif; font-size: 10px; text-align:justify;
 background-color:#FFFFFF; }

 table {
 margin-left: 25px;
 margin-right: auto;
 margin-top: 25px;
 margin-bottom: auto;
 }
 table, th, td, tr {
  border: 1px solid black;
  border-collapse: collapse;
  padding-left: 15px;
  padding-right: 15px;
  padding-bottom: 5px;
  padding-top: 5px;

}`;

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The text of a raw XML element (an unknown element showed its content on the page). */
function rawText(node) {
  return String(node.attrs?.xml ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
}

/** A cell's content in the page's notation, non-breaking spaces as spaces, pictures by name. */
function cellHtml(cell) {
  const extras = [];
  return serializeInline(cell.content ?? [], extras)
    .replace(/&nbsp;/g, ' ')
    .replace(/<X (\d+)>/g, (all, index) => (extras[Number(index)] ? rawText(extras[Number(index)]) : ''))
    .replace(/<IMG href="([^"]*)"(?: alt="([^"]*)")?>/g, (all, href, alt) => `<IMG alt="${alt ?? href}">`);
}

/** A span as the page wrote it: the model's number, or the text kept in `unknownAttrs`. */
function spanAttr(cell, name) {
  const value = cell.attrs?.[name];
  if (value !== undefined && value !== null) return ` ${name}="${escapeAttr(value)}"`;
  const raw = cell.attrs?.unknownAttrs?.[name];
  return raw !== undefined ? ` ${name}="${escapeAttr(raw)}"` : '';
}

/** The HTML table of a table node. */
export function tableHtml(table) {
  let html = '<table>';
  for (const row of (table.content ?? []).filter((r) => r.type === 'tr')) {
    html += `\r\n<tr${row.attrs?.align ? ` align="${escapeAttr(row.attrs.align)}"` : ''}>`;
    for (const cell of (row.content ?? []).filter((c) => c.type === 'td' || c.type === 'th')) {
      const a = cell.attrs ?? {};
      const align = a.align ? ` align="${escapeAttr(a.align)}"` : '';
      const valign = a.valign ? ` valign="${escapeAttr(a.valign)}"` : '';
      html += `\r\n<${cell.type}${spanAttr(cell, 'colspan')}${spanAttr(cell, 'rowspan')}${align}${valign}>${cellHtml(cell)}</${cell.type}>`;
    }
    html += '</tr>';
  }
  return html + '</table>';
}

/** The report's HTML: the window's style, then the content. */
export function reportHtml(content) {
  return `<style type="text/css">\r\n${REPORT_STYLE}\r\n</style>\r\n${content}`;
}
