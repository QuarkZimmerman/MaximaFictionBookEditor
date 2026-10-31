// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/25_Превратить таблицы в простой текст.js
// Turns every table of the book into plain text, from the last to the first as the original
// did, also in the book annotation and the history, which its page held too: each cell, row by
// row, becomes a paragraph with the cell's content; the table, its rows and the cells' id,
// style, alignment and spans go (a cell's language stays on its paragraph: the original never
// saw one). A cell with nothing but spaces becomes an empty line, as 2.7.9 saved an empty
// paragraph. The original also split a cell's paragraph at each inline picture and made the
// picture a block of its own (its href and title; here its href and alt), dropping the empty
// paragraphs the split left; where FB2 allows no picture as a block - in a cite, an
// annotation, right after a section's annotation, or as a section's only content - the pictures
// of that table stay inline here (the original wrote invalid FB2 there). Text after a picture
// keeps its formatting (the original's split left the formatting open around the picture
// behind). The status bar says that the tables are turned into text, as in the original,
// which returned nothing from Run(), nor does run().
// The original's notice, kept as written (FR-029):
// Скрипт "Превратить таблицы в простой текст v1.3". Автор Sclex
//      alert("Найден абзац:\n\n"+myOuterHTML)

import { nodesIn, placeOf, writeParentContent } from './lib/containers.js';
import { t } from './lib/text-blocks.js';

/** A paragraph of a cell's content, or an empty line when it has nothing but spaces. */
function paragraph(content, attrs) {
  if (content.every((item) => item.type === 'text' && !/\S/.test(item.text ?? ''))) {
    return { type: 'empty-line', attrs: {} };
  }
  return { type: 'p', attrs: { ...attrs }, content };
}

/** The blocks of a cell: its paragraph, or with `pictures` the paragraph split at its pictures. */
function cellBlocks(cell, pictures) {
  const attrs = typeof cell.attrs?.lang === 'string' ? { lang: cell.attrs.lang } : {};
  const content = cell.content ?? [];
  if (!pictures || !content.some((item) => item.type === 'inline-image')) {
    return [paragraph(content, attrs)];
  }
  const blocks = [];
  let part = [];
  const flush = () => {
    if (part.length) blocks.push(paragraph(part, attrs));
    part = [];
  };
  for (const item of content) {
    if (item.type !== 'inline-image') {
      part.push(item);
      continue;
    }
    flush();
    const image = { href: item.attrs?.href ?? '' };
    if (item.attrs?.alt) image.alt = item.attrs.alt;
    blocks.push({ type: 'image', attrs: image });
  }
  flush();
  return blocks;
}

function tableBlocks(table, pictures) {
  return (table.content ?? []).flatMap((row) =>
    (row.content ?? []).flatMap((cell) => cellBlocks(cell, pictures)),
  );
}

export default async function run(ctx) {
  const tables = await mfbe.doc.getElementsByTagName('table');
  for (let i = tables.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(tables.length - i, tables.length);
    const place = await placeOf(tables[i].nodeId);
    if (!place) continue;
    const { parent, index } = place;
    const table = parent.content[index];
    const candidates = [true, false].map((pictures) => [
      ...parent.content.slice(0, index),
      ...tableBlocks(table, pictures),
      ...parent.content.slice(index + 1),
    ]);
    await writeParentContent(place.parentId, parent, candidates);
  }

  const { description } = await mfbe.doc.get();
  let changed = false;
  for (const root of [description.documentInfo?.history, description.titleInfo?.annotation]) {
    const inside = nodesIn(root, 'table');
    for (let k = inside.length - 1; k >= 0; k -= 1) {
      inside[k].parent.content.splice(inside[k].index, 1, ...tableBlocks(inside[k].node, false));
      changed = true;
    }
  }
  if (changed) await mfbe.doc.setDescription(description);

  await mfbe.ui.status(
    t(ctx, 'Все таблицы успешно превращены в текст.', 'All tables have been turned into text.'),
    { sticky: true },
  );
}
