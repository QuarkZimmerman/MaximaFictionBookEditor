// Converted from FictionBook Editor 2.7.9: Scripts/32_Маркеры сносок/11_Создать таблицу расположения имеющихся маркеров сносок.js
// Asks for the kind of footnote markers - superscript numbers, *, #, [1], {1}, [~1~] or {~1~} - and
// makes an HTML table of them: in the left column each footnote reference marker with up to 120
// characters of the text before it, in the right column each footnote text marker (a marker at the
// start of a paragraph) with up to 120 characters after it, a "page" starting at each reference
// marker that follows a text marker, the rows of the markers numbered 1 highlighted. As the
// original's default (display = 1) the table is written into a file - the Save dialog proposes
// "temp.html" - and shown in a report window; display = 0 only shows it. No markers of the kind, or
// none of either side: a message (or a table of one side only).
// A book holding the characters ☺ or ☻, which the script uses as marks, gets the original's
// warning and the expression that finds them on the clipboard. The original's code runs as written
// in engine.js, on FictionBook Editor's page rebuilt from the book (lib/marker-page.js,
// lib/table-host.js).
// Differences from 2.7.9: the file is written where the user chooses (the original wrote
// HTML/temp.html next to the program, or the path set in filePatch) and the table is shown in the
// editor's report window instead of the default browser, which needed another program; the dialog
// is a form.
// The original's notice, kept as written (FR-029):
// Создать таблицу расположения имеющихся маркеров сносок. v. 1.4.
// Автор: stokber

import { engine } from './engine.js';
import { js, t, tableHost } from './lib/table-host.js';

export default async function run(ctx) {
  const host = tableHost(ctx, await mfbe.doc.get());
  return engine(host, (ru, en) => t(ctx, ru, en), js);
}
