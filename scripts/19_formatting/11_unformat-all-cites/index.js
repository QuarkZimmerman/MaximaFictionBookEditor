// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/11_Расформатировать все цитаты.js
// Dissolves every cite of the book, from the last to the first as the original did (a cite
// nested in another one goes first): its content stays in its place and its own text authors
// become paragraphs; the cite and its id go. Those of the book annotation and the history too,
// which the original's page held. The original's DOM edit could leave what FB2 does not allow,
// which 2.7.9 refused to save until it was mended; here the result stays valid:
// - in an epigraph a subtitle of the cite becomes a paragraph (an epigraph holds no subtitles);
// - a cite whose content cannot stand in its place even so (a table in an epigraph) stays, and
//   the status bar says how many stayed;
// - an empty cite that was all the text of a section leaves an empty line.
// The count goes to the status bar; without any cite a message says so. The original's Run()
// returned nothing, nor does run().
// The original's notice, kept as written (FR-029):
// Скрипт "Расформатировать все цитаты" v1.2
// Автор Sclex

import {
  isEmptyBlock,
  linesOf,
  nodesIn,
  placeOf,
  placements,
  writeParentContent,
} from './lib/containers.js';
import { t } from './lib/text-blocks.js';

/** What an epigraph may hold besides its text authors (an annotation holds all a cite does). */
const EPIGRAPH_BLOCKS = new Set(['p', 'poem', 'cite', 'empty-line']);

export default async function run(ctx) {
  let found = 0;
  let unformatted = 0;
  const cites = await mfbe.doc.getElementsByTagName('cite');
  for (let i = cites.length - 1; i >= 0; i -= 1) {
    if (ctx.cancelled) return;
    await mfbe.ui.progress(cites.length - i, cites.length);
    const place = await placeOf(cites[i].nodeId);
    if (!place) continue;
    found += 1;
    const cite = place.parent.content[place.index];
    const lines = linesOf(cite, { subtitlesToParagraphs: place.parent.type === 'epigraph' });
    const candidates = placements(place.parent, place.index, lines);
    if (lines.length === 0) {
      const content = [...place.parent.content];
      content[place.index] = { type: 'empty-line', attrs: {} };
      candidates.push(content);
    }
    if (await writeParentContent(place.parentId, place.parent, candidates)) unformatted += 1;
  }

  const { description } = await mfbe.doc.get();
  let changed = false;
  for (const [owner, key] of [
    [description.documentInfo, 'history'],
    [description.titleInfo, 'annotation'],
  ]) {
    const inside = nodesIn(owner?.[key], 'cite');
    for (let k = inside.length - 1; k >= 0; k -= 1) {
      const { node, parent, index } = inside[k];
      found += 1;
      const inEpigraph = parent.type === 'epigraph';
      const lines = linesOf(node, { subtitlesToParagraphs: inEpigraph });
      if (inEpigraph && lines.some((line) => !EPIGRAPH_BLOCKS.has(line.type))) continue;
      parent.content.splice(index, 1, ...lines);
      unformatted += 1;
      changed = true;
    }
    if (inside.length && isEmptyBlock(owner[key])) delete owner[key];
  }
  if (changed) await mfbe.doc.setDescription(description);

  if (found === 0) {
    await mfbe.ui.message(
      t(ctx, 'Цитат в документе не нашлось.', 'No cites were found in the document.'),
    );
    return;
  }
  const left = found - unformatted;
  await mfbe.ui.status(
    t(
      ctx,
      `Расформатировано цитат: ${unformatted}.` +
        (left ? ` Оставлено цитат: ${left} — их содержимое недопустимо на их месте.` : ''),
      `Cites unformatted: ${unformatted}.` +
        (left ? ` Cites left: ${left} - their content cannot stand in their place.` : ''),
    ),
    { sticky: true },
  );
}
