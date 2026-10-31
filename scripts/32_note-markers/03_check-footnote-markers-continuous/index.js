// Converted from FictionBook Editor 2.7.9: Scripts/32_Маркеры сносок/03_Поиск некорректных маркеров постраничных сносок со сквозной нумерацией.js
// Checks the numbering of the footnote markers of the kind chosen in a form - superscript numbers,
// asterisks, [1], {1}, [~1~] or {~1~} - for page (or chapter) footnotes numbered through the whole book. A marker at the start of a paragraph
// is a footnote text marker, any other one a footnote reference marker. Each "page" is a run of reference markers followed by the run of text markers that closes it; the numbers go on from page to page.
// The first fault found (in the original's order of checks) is explained in the status bar and its
// marker is selected; with different numbers of reference and text markers on a "page" the script
// asks which of the two last correct markers to go to. No markers of the kind, or no fault: a
// message. The original's code runs as written in engine.js, on FictionBook Editor's page rebuilt
// from the book (lib/marker-page.js, lib/search-host.js); run() returns what its Run() returned
// (true when no fault is found).
// Differences from 2.7.9: the marker is selected where it is in the book - the original moved the
// selection by its own count of characters from the start of the Body view, which went wrong
// after pictures, tables, soft hyphens and other places where its count and Internet Explorer's
// differed; the dialog is a form without its Help button (a window of hints); the status text
// stays until another one replaces it.
// The original's notice, kept as written (FR-029):
// Поиск некорректных маркеров постраничных сносок со сквозной нумерацией v.1.2
// Находит ошибки нумерации:
// постраничных сносок со сквозной нумерацией;
// поглавных сносок со сквозной нумерацией;
// Автор stokber

import { engine } from './engine.js';
import { searchHost, t } from './lib/search-host.js';

export default async function run(ctx) {
  const host = searchHost(ctx, await mfbe.doc.get());
  return engine(host, (ru, en) => t(ctx, ru, en));
}
