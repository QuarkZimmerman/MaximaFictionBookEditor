// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/50_Расформатировать ссылки, адрес которых - пустая строка.js
// Unformats (removes, keeping the text) every link of the book - the title-info annotation and the
// document-info history included - whose address is empty. Reports the number of links unformatted.
// The original compared getAttribute("href") with "" and with the folder of its page, which the
// page's IE7 document mode gave for an empty address; an address of spaces only resolved there too
// and counts as empty here.
// Differences: a run of text that carries one link counts as one link.
// The original's notice, kept as written (FR-029):
// Скритп "Расформатировать ссылки, адрес которых - пустая строка"
// Версия 1.2

import { Changes, TEXT_BLOCK_TYPES, forEachNode, pageParts, stripMarks, t, units } from './lib/book.js';

const isEmptyLink = (mark) => mark.type === 'link' && String(mark.attrs?.href ?? '').trim() === '';

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  let removedLinksCnt = 0;
  // Every <A> of fbw_body.
  for (const part of pageParts(snapshot)) {
    forEachNode(part.node, (node, ancestors) => {
      if (!TEXT_BLOCK_TYPES.has(node.type) || !node.content) return;
      const { content, removed } = stripMarks(node.content, isEmptyLink);
      if (!removed) return;
      node.content = content;
      changes.mark(node, ancestors, part);
      removedLinksCnt += removed;
    });
  }
  if (!(await changes.commit(ctx, ctx.script.name))) return;
  const n = removedLinksCnt;
  const msg =
    n !== 0
      ? t(
          ctx,
          `${units(n, { nom: 'Была расформатирована', gen: 'Были расформатированы', plu: 'Было расформатировано' })} ${n} ${units(n, { nom: 'ссылка', gen: 'ссылки', plu: 'ссылок' })}.`,
          n === 1 ? '1 link was unformatted.' : `${n} links were unformatted.`,
        )
      : t(ctx, 'Ссылок с пустым адресом — в документе не нашлось.', 'The document has no link with an empty address.');
  await mfbe.ui.message(msg, { caption: ctx.script.name, icon: 'info' });
}
