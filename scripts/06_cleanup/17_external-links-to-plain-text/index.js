// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/17_Превратить внешние ссылки в текст.js
// Unformats (removes, keeping the text) every link of the book - the title-info annotation and the
// document-info history included - whose address is not a local one: an address that does not start
// with "#" or "file://", and also a local address "#..." that holds an http(s) address ("#http://").
// Reports the number of links turned into text.
// The original tested getAttribute("href"), which in the IE7 document mode of FictionBook Editor
// 2.7.9's page gave the address resolved against the page (file:///.../main.html): an empty or a
// relative address became a file:// address and was kept. The same resolution is applied here, so
// those links are kept too (06/50 unformats the empty ones).
// Differences: a run of text that carries one link counts as one link.
// The original's notice, kept as written (FR-029):
//скрипт "Превращение внешних ссылок в текст"
//Автор Sclex
//Версия 1.2
//Топик про скрипты FBE: http://www.fictionbook.org/forum/viewtopic.php?t=4412
//Мой сайт про мои скрипты: http://scripts.fictionbook.org

import { Changes, TEXT_BLOCK_TYPES, forEachNode, pageParts, stripMarks, t, units } from './lib/book.js';

// The original's page: file:///<the editor's folder>/main.html.
const PAGE_FOLDER = 'file:///C:/Program%20Files/FictionBook%20Editor/';

/** getAttribute("href") in the page's IE7 document mode: the address resolved against the page. */
function resolvedHref(href) {
  const address = String(href ?? '').trim();
  if (/^[A-Za-z][A-Za-z0-9+.\-]+:/.test(address)) return address;
  if (address.indexOf('#') === 0) return `${PAGE_FOLDER}main.html${address}`;
  return PAGE_FOLDER + address;
}

const re1 = new RegExp('^ *?(file://|#)', 'i');
const re2 = new RegExp('# *https?:', 'i');

function isExternal(mark) {
  if (mark.type !== 'link') return false;
  const href = resolvedHref(mark.attrs?.href);
  return href.search(re1) < 0 || href.search(re2) !== -1;
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  let removesCnt = 0;
  for (const part of pageParts(snapshot)) {
    forEachNode(part.node, (node, ancestors) => {
      if (!TEXT_BLOCK_TYPES.has(node.type) || !node.content) return;
      const { content, removed } = stripMarks(node.content, isExternal);
      if (!removed) return;
      node.content = content;
      changes.mark(node, ancestors, part);
      removesCnt += removed;
    });
  }
  if (!(await changes.commit(ctx, ctx.script.name))) return;
  let msgStr;
  if (removesCnt === 0) {
    msgStr = t(ctx, 'В документе не нашлось ни одной ссылки, подлежащей расформатированию.', 'The document has no link to unformat.');
  } else {
    msgStr = t(
      ctx,
      units(removesCnt, { nom: 'Была превращена в простой текст ', gen: 'Были превращены в простой текст ', plu: 'Было превращено в простой текст ' }) +
        removesCnt +
        units(removesCnt, { nom: ' ссылка.', gen: ' ссылки.', plu: ' ссылок.' }),
      removesCnt === 1 ? '1 link was turned into plain text.' : `${removesCnt} links were turned into plain text.`,
    );
  }
  await mfbe.ui.message(msgStr, { caption: ctx.script.name, icon: 'info' });
}
