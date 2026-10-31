// The links of the book and their list, as 2.7.9's "Показать все-все ссылки" builds it.
//
// The original took document.getElementsByTagName("A") of FictionBook Editor's page, which
// holds the book's annotation, the history and then every body (fb2.xsl writes each FB2 <a> as
// an <A>), and wrote each link's innerText and target. Here a link is a run of consecutive
// inline nodes of one text block that carry the same link mark; an inline picture inside a link
// adds no text, as in the page's innerText.

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function sameLink(a, b) {
  return a.href === (b.href ?? '') && a.type === (b.type ?? '') && a.xlinkType === (b.xlinkType ?? '');
}

/** All links of the page in its order (annotation, history, bodies): `{ text, href }`. */
export function collectLinks(doc) {
  const links = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      let current = null;
      for (const item of node.content ?? []) {
        const mark = (item.marks ?? []).find((m) => m.type === 'link');
        if (!mark) {
          current = null;
          continue;
        }
        const attrs = mark.attrs ?? {};
        const text = item.type === 'text' ? (item.text ?? '') : '';
        if (current && sameLink(current, attrs)) current.text += text;
        else {
          current = { text, href: attrs.href ?? '', type: attrs.type ?? '', xlinkType: attrs.xlinkType ?? '' };
          links.push(current);
        }
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc.description?.titleInfo?.annotation);
  visit(doc.description?.documentInfo?.history);
  for (const body of doc.bodies ?? []) visit(body);
  return links.map(({ text, href }) => ({ text, href }));
}

function isExternal(href) {
  return href.indexOf('http://') !== -1 || href.indexOf('https://') !== -1;
}

/** The list as the original's Run() writes it: the internal links, then the external ones. */
export function linksReport(links, labels) {
  let msg = `${labels.internal}\n\n`;
  let cnt = 1;
  for (const link of links) {
    let href = link.href;
    if (isExternal(href)) continue;
    let istr = `${cnt}`;
    if (istr.length < 2) istr = `0${istr}`;
    if (href.indexOf('#') !== 0) istr = `[!!!]  ${istr}`;
    cnt += 1;
    if (href === '') href = '(null)';
    msg += ` ${istr}. ${link.text} → ${href} \n`;
  }
  msg += `\n-------------------------------------------- \n\n${labels.external}\n\n`;
  cnt = 1;
  for (const link of links) {
    let href = link.href;
    if (!isExternal(href)) continue;
    let istr = `${cnt}`;
    if (istr.length < 2) istr = `0${istr}`;
    cnt += 1;
    if (href === '') href = '(null)';
    msg += ` ${istr}. ${link.text} → ${href} \n`;
  }
  return msg;
}
