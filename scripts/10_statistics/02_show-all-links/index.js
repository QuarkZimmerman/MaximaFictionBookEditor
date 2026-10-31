// Converted from FictionBook Editor 2.7.9: Scripts/10_Статистика/02_Показать все-все ссылки.js
// Lists every link of the book in a report window (mfbe.ui.report): first the internal ones
// (every target without "http://" or "https://"), numbered, with "[!!!]" before a target that
// does not start with "#" and "(null)" for an empty one, then the external ones. The links are
// those FictionBook Editor's page held, in its order: the book's annotation, the history, then
// every body (links.js). 2.7.9 opened its page HTML/Показать все-все ссылки.html (2.7beta1's
// Scripts/links.htm, the same file) in a window of its own, now with the feature resizable=yes
// spelt right (2.7beta1 wrote resizeble), and wrote the list into it; the report window is
// modeless too and stays open after the run.
// Differences from 2.7.9: the window is the editor's report window (title " :: Links :: ", the
// list as written, in the window's type, with Copy and Save as...; it has the report windows'
// size and scrolls, it cannot be resized), not an IE window of 300 x 710 pixels in the page's
// small grey centred type; two links with the same target and type written right next to each
// other count as one, since the editor reads them as one link.
// The original's notice, kept as written (FR-029):
//======================================
// Shows all links in browser
// modified by mkb
//======================================
// The notice of its page HTML/Показать все-все ссылки.html, kept as written (FR-029):
// <meta name="author" content="Jurgen">
import { collectLinks, linksReport } from './links.js';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const links = collectLinks(await mfbe.doc.get());
  if (links.length === 0) {
    await mfbe.ui.message(t(ctx, '\nДокумент не содержит ссылок. \n\n', '\nThe document contains no links.\n\n'), { icon: 'info' });
    return;
  }
  const msg = linksReport(links, {
    internal: t(ctx, 'ВНУТРЕННИЕ ССЫЛКИ:', 'INTERNAL LINKS:'),
    external: t(ctx, 'ВНЕШНИЕ ССЫЛКИ:', 'EXTERNAL LINKS:'),
  });
  // The page's title, " :: Links :: ", in both languages as in the original.
  await mfbe.ui.report({ title: ' :: Links :: ', text: msg });
}
