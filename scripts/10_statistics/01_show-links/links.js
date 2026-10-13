// Link collection shared by the "show links" scripts: a link is a run of consecutive text
// pieces of one text block that carry the same link mark (the legacy scripts iterated the
// rendered <a> elements, which is the same thing).

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

/** All links of the bodies in document order: `{ text, href }`. */
export function collectLinks(snapshot) {
  const links = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      let current = null;
      for (const item of node.content ?? []) {
        const mark = item.type === 'text' ? (item.marks ?? []).find((m) => m.type === 'link') : null;
        if (!mark) {
          current = null;
          continue;
        }
        const href = mark.attrs?.href ?? '';
        if (current && current.href === href) current.text += item.text ?? '';
        else {
          current = { text: item.text ?? '', href };
          links.push(current);
        }
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of snapshot.bodies ?? []) visit(body);
  return links;
}

export function isExternal(href) {
  return href.includes('http://') || href.includes('https://');
}

/** The two numbered lists of the legacy scripts (internal first, external second). */
export function formatLinkReport(links, labels) {
  const lines = [`${labels.internal}\n`];
  let count = 1;
  for (const link of links) {
    if (isExternal(link.href)) continue;
    let number = String(count).padStart(2, '0');
    if (!link.href.startsWith('#')) number = `[!!!]  ${number}`;
    count += 1;
    lines.push(` ${number}. ${link.text} ${labels.arrow} ${link.href || '(null)'} `);
  }
  lines.push(`\n${labels.divider}\n\n${labels.external}\n`);
  count = 1;
  for (const link of links) {
    if (!isExternal(link.href)) continue;
    const number = String(count).padStart(2, '0');
    count += 1;
    lines.push(` ${number}. ${link.text} ${labels.arrow} ${link.href || '(null)'} `);
  }
  return lines.join('\n');
}
