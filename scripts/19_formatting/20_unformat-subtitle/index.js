// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/20_Расформатировать подзаголовок.js
// (version 1.2 by its code; it has no header). Turns the subtitle holding the caret - the start
// of the selection - into plain text, keeping its content and attributes, also in the book
// annotation (the original pasted a marker at the selection's start and changed the <P> holding
// it). The original set the paragraph's class to "normal" (SetStyleEx) and removed it, which
// made a paragraph of it - a verse inside a stanza. A subtitle that stands directly in a poem,
// between its stanzas, becomes a stanza of one verse: a paragraph there would make the poem
// invalid FB2 (as 19/element-browser does). Any other block, or a selected picture (the original
// stopped on a control selection), is left alone; the selection is not changed. The original's
// Run() returned nothing, nor does run(). The subtitle rule is lib/paragraph-format.js
// (unformatSubtitle), shared with 19/63.
// The original's notice, kept as written (FR-029):
// (the original has no notice)

import { unformatSubtitle } from './lib/paragraph-format.js';
import { TextBlocks } from './lib/text-blocks.js';

export default async function run() {
  const selection = await mfbe.selection.get();
  const first = selection?.nodes?.[0];
  if (!first) return;
  const blocks = new TextBlocks();
  const entry = await blocks.get(first.nodeId);
  if (!entry) return;
  const next = await unformatSubtitle(entry.node, entry, blocks);
  if (!next) return;
  await blocks.put(entry, next);
  await blocks.commit();
}
