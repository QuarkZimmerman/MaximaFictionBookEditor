// Converted from FictionBook Editor 2.7.9: Scripts/34_Управление курсором либо выделением/001_Установить курсор в начало документа.js
// Puts a caret (an empty selection) at the very start of the document and scrolls there. The
// original collapsed a range over its page's body to its start: the first character of the
// book annotation, which that page always showed first, empty when the book has none. The Body
// view shows the book annotation first in the same way, so the caret goes to the start of the
// annotation's first paragraph - the empty one the Body view shows when there is no annotation -
// before every body: a script run next (ctx.startedBy 'script', the combos of 2.7.9) searches
// from before the first body, as there. Should the Body view show no annotation, the caret goes
// to the start of the first text block of the first body. The original's Run() returned nothing,
// nor does run().
// The annotation block is reached through its node id in the Body view, "desc:annotation"
// (feature 004): the script API has no call for the start of the Body view.
// The original's notice, kept as written (FR-029):
// Скрипт "Установить курсор в начало документа"
// Автор Sclex
// Версия 1.0

import { edgeTextBlock, isApiError } from './lib/text-blocks.js';

/** The start of the Body view's annotation block, or null when the view shows none. */
async function annotationStart() {
  try {
    await mfbe.selection.selectNode('desc:annotation');
  } catch (error) {
    if (isApiError(error)) return null;
    throw error;
  }
  const selection = await mfbe.selection.get();
  return selection ? { nodeId: selection.anchor.nodeId, offset: 0 } : null;
}

/** The start of the first text block of the first body, or null. */
async function bodyStart() {
  const [body] = await mfbe.doc.getElementsByTagName('body');
  const block = body ? edgeTextBlock(await mfbe.doc.getNode(body)) : null;
  return block?.attrs?.nodeId ? { nodeId: block.attrs.nodeId, offset: 0 } : null;
}

export default async function run() {
  const start = (await annotationStart()) ?? (await bodyStart());
  if (!start) return;
  await mfbe.selection.set(start);
  await mfbe.selection.scrollIntoView();
}
